/** User-operated only. Never invoke this CLI from the web app or an automated build. */
import { createServer } from "node:http";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import {
  accountSchema,
  activeAccount,
  bundleSchema,
  emptyVault,
  exchangeCode,
  hasGrant,
  ISSUER,
  RESOURCE,
  SCOPES,
  vaultSchema,
  type Pending,
  type Vault,
} from "./auth.js";
import { seal, stateKey, unseal, type Envelope } from "./crypto.js";
import { transferSecrets } from "./transfer.js";
const directory = resolve(
  process.env.SALDO_STATE_DIR ?? join(homedir(), ".config", "saldo"),
);
const keyFile = resolve(
  process.env.SALDO_KEY_FILE ?? join(directory, "state.key"),
);
const stateFile = join(directory, "oauth.enc.json");
const options = {
  headers: {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
  },
};
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await stat(path);
  if (!info.isDirectory() || info.mode & 0o077)
    throw new Error("State directory must be owner-only (0700).");
}
async function protectedRead(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.mode & 0o077)
      throw new Error("Credential/key files must be owner-only (0600).");
    return await file.readFile("utf8");
  } finally {
    await file.close();
  }
}
async function atomicWrite(path: string, text: string) {
  await privateDirectory(dirname(path));
  const temporary = `${path}.${Buffer.from(randomBytes(8)).toString("hex")}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
    const dir = await open(dirname(path), "r");
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  } catch (e) {
    await rm(temporary, { force: true });
    throw e;
  }
}
async function localKey() {
  return stateKey((await protectedRead(keyFile)).trim());
}
async function load(key: CryptoKey): Promise<Vault> {
  try {
    return vaultSchema.parse(
      await unseal(JSON.parse(await protectedRead(stateFile)) as Envelope, key),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyVault();
    throw error;
  }
}
async function save(vault: Vault, key: CryptoKey) {
  await atomicWrite(
    stateFile,
    JSON.stringify(await seal(vaultSchema.parse(vault), key)),
  );
}
async function login(vault: Vault, key: CryptoKey, args: string[]) {
  let selected =
    args[0] && args[0] !== "--new" && args[0] !== "--resume"
      ? vault.accounts.find((a) => a.client_id === args[0])
      : undefined;
  if (args[0] && !["--new", "--resume"].includes(args[0]) && !selected)
    throw new Error(
      "Unknown account. Run accounts, then pass the exact client ID.",
    );
  if (!args[0]) {
    selected = activeAccount(vault);
    if (!selected)
      throw new Error(
        'Use login --new "Personal" for your first registration.',
      );
  }
  const resumed = args[0] === "--resume" ? vault.pending : undefined;
  if (
    args[0] === "--resume" &&
    (!resumed || resumed.client_id === "dynamic_agent_client")
  )
    throw new Error("No issued registration to resume.");
  if (
    args[0] === "--new" &&
    vault.pending?.client_id !== "dynamic_agent_client" &&
    vault.pending?.client_id
  )
    throw new Error(
      "An issued registration is pending. Use login --resume first.",
    );
  const label = selected?.label ?? resumed?.label ?? args[1]?.trim();
  if (!label || label.length > 160)
    throw new Error("Provide an account label of 1–160 characters.");
  const clientId =
    selected?.client_id ?? resumed?.client_id ?? "dynamic_agent_client";
  const verifier = Buffer.from(randomBytes(32)).toString("base64url"),
    nonce = Buffer.from(randomBytes(32)).toString("base64url"),
    state = Buffer.from(randomBytes(32)).toString("base64url");
  const ticket = Buffer.from(randomBytes(32)).toString("base64url");
  let startUsed = false,
    callbackUsed = false;
  let pending: Pending;
  let authorization: URL;
  let expectedHost = "";
  let finish: (value?: unknown) => void = () => {},
    fail: (reason: unknown) => void = () => {};
  const completed = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const server = createServer(async (req, res) => {
    const respond = (status: number, text: string) => {
      res.writeHead(status, {
        ...options.headers,
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(text);
    };
    if (req.method !== "GET" || req.headers.host !== expectedHost) {
      respond(400, "Invalid request.");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${expectedHost}`);
    if (url.pathname === "/start") {
      if (startUsed || url.searchParams.get("ticket") !== ticket) {
        respond(400, "This link is invalid or already used.");
        return;
      }
      startUsed = true;
      res.writeHead(302, {
        ...options.headers,
        Location: authorization.toString(),
      });
      res.end();
      return;
    }
    if (url.pathname !== "/auth/callback") {
      respond(404, "Not found.");
      return;
    }
    if (
      callbackUsed ||
      url.searchParams.getAll("state").length !== 1 ||
      url.searchParams.get("state") !== state
    ) {
      respond(400, "Invalid sign-in state.");
      return;
    }
    callbackUsed = true;
    if (url.searchParams.has("error")) {
      respond(400, "Sign-in was not completed. Return to the terminal.");
      fail(new Error("Authorization declined or failed."));
      return;
    }
    try {
      const callbackClient = url.searchParams.get("client_id");
      const code = url.searchParams.get("code");
      if (
        url.searchParams.getAll("code").length !== 1 ||
        url.searchParams.getAll("client_id").length > 1 ||
        !code
      )
        throw new Error("Invalid callback.");
      const issued =
        clientId === "dynamic_agent_client" ? callbackClient : clientId;
      if (
        !issued ||
        issued === "dynamic_agent_client" ||
        issued.length > 500 ||
        (clientId !== "dynamic_agent_client" &&
          callbackClient &&
          callbackClient !== clientId)
      )
        throw new Error("Client registration mismatch.");
      // Save an issued registration before exchange, so invalid_grant can resume it rather than register again.
      pending.client_id = issued;
      vault.pending = pending;
      await save(vault, key);
      const account = await exchangeCode(code, issued, pending);
      const previous = vault.accounts.find((a) => a.client_id === issued);
      if (previous && previous.subject !== account.subject)
        throw new Error("Identity mismatch.");
      vault.accounts = vault.accounts.filter((a) => a.client_id !== issued);
      vault.accounts.push(accountSchema.parse(account));
      vault.active_client_id = issued;
      delete vault.pending;
      await save(vault, key);
      respond(
        200,
        "Saldo is authorized. You can close this tab and return to your terminal.",
      );
      finish();
    } catch {
      respond(
        400,
        "Sign-in could not be validated. Return to the terminal. No tokens are shown here.",
      );
      fail(
        new Error(
          "Sign-in failed. If an issued registration was saved, retry with login --resume.",
        ),
      );
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Loopback listener failed.");
    expectedHost = `127.0.0.1:${address.port}`;
    const redirectUri = `http://${expectedHost}/auth/callback`;
    pending = {
      state,
      nonce,
      verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
      label,
      subject: selected?.subject ?? resumed?.subject,
      created_at: Date.now(),
    };
    vault.pending = pending;
    await save(vault, key);
    authorization = new URL(`${ISSUER}/api/accounts/authorize`);
    for (const [name, value] of Object.entries({
      client_id: clientId,
      ext_agent_host_id: vault.host_id,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }))
      authorization.searchParams.set(name, value);
    if (clientId === "dynamic_agent_client")
      authorization.searchParams.set("agent_name_hint", "Saldo");
    if (selected?.tokens?.id_token)
      authorization.searchParams.set("id_token_hint", selected.tokens.id_token);
    if (selected?.email)
      authorization.searchParams.set("login_hint", selected.email);
    // Print only a local, one-use launch URL; never log an authorization URL with id_token_hint.
    process.stdout.write(
      `Continue with ChatGPT: http://${expectedHost}/start?ticket=${ticket}\nThis local link expires in five minutes.\n`,
    );
    const timer = setTimeout(
      () => fail(new Error("Sign-in expired. Run login again.")),
      300_000,
    );
    try {
      await completed;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  await privateDirectory(directory);
  // No stale-lock auto-recovery: two processes must never refresh or overwrite the same account.
  const lock = join(directory, ".bootstrap-lock");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch {
    throw new Error(
      "Bootstrap is already running, or a stale lock remains. Stop all bootstrap processes before removing .bootstrap-lock.",
    );
  }
  try {
    if (command === "init") {
      try {
        await stat(stateFile);
        throw new Error(
          "Local OAuth state already exists; do not reinitialize it.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await privateDirectory(dirname(keyFile));
      const file = await open(keyFile, "wx", 0o600);
      try {
        await file.writeFile(Buffer.from(randomBytes(32)).toString("hex"));
        await file.sync();
      } finally {
        await file.close();
      }
      const key = await localKey();
      await save(emptyVault(), key);
      process.stdout.write(
        "Created protected local Saldo state and encryption key. No account was connected.\n",
      );
      return;
    }
    const key = await localKey();
    const vault = await load(key);
    if (command === "login") {
      await login(vault, key, args);
      process.stdout.write(
        "Validated and saved the selected ChatGPT registration locally.\n",
      );
      return;
    }
    if (command === "accounts") {
      for (const account of vault.accounts)
        process.stdout.write(
          `${account.client_id === vault.active_client_id ? "*" : " "} ${account.label} | ${account.client_id}\n`,
        );
      return;
    }
    if (command === "export") {
      const account = activeAccount(vault);
      if (!hasGrant(account)) throw new Error("Sign in before exporting.");
      if (!args[0])
        throw new Error(
          "Provide an output file in a protected directory outside the repository.",
        );
      const bundle = bundleSchema.parse({
        version: 1,
        bundle_id: crypto.randomUUID(),
        created_at: Date.now(),
        account,
      });
      const destination = resolve(args[0]);
      if (destination === stateFile || destination === keyFile)
        throw new Error("Choose a separate bundle file.");
      const encrypted = JSON.stringify(await seal(bundle, key));
      const chunks = transferSecrets(encrypted);
      await atomicWrite(destination, encrypted);
      await atomicWrite(`${destination}.secrets.json`, JSON.stringify(chunks));
      await atomicWrite(
        `${destination}.cleanup.json`,
        JSON.stringify(
          Object.fromEntries(Object.keys(chunks).map((name) => [name, null])),
        ),
      );
      process.stdout.write(
        "Wrote an encrypted transfer bundle and its .secrets.json import file, and its .cleanup.json secret-removal file. Import within 30 minutes. Let the remote runtime own all future refreshes.\n",
      );
      return;
    }
    throw new Error(
      'Commands: init | login --new "Personal" | login [issued-client-id] | login --resume | accounts | export /private/path/bundle.enc.json',
    );
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Bootstrap failed."}\n`,
  );
  process.exitCode = 1;
});
