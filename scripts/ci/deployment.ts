import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";

type Binding = Record<string, unknown> & { name: string; type: string };
export interface Settings {
  bindings: Binding[];
}
const authNames = [
  "APP_ORIGIN",
  "ACCESS_TEAM_DOMAIN",
  "ACCESS_AUD",
  "OWNER_SUB",
] as const;
export function parseSettings(value: unknown): Settings {
  const o = value as Settings;
  if (
    !o ||
    !Array.isArray(o.bindings) ||
    o.bindings.some(
      (b) => !b || typeof b.name !== "string" || typeof b.type !== "string",
    )
  )
    throw new Error("Invalid Worker settings response");
  if (new Set(o.bindings.map((b) => b.name)).size !== o.bindings.length)
    throw new Error("Duplicate Worker binding names");
  return { bindings: o.bindings };
}
export function validateApp(settings: Settings, databaseId: string) {
  const binding = (name: string) =>
    settings.bindings.find((b) => b.name === name);
  const vars: Record<string, unknown> = {};
  for (const b of settings.bindings) {
    if (b.type === "plain_text") vars[b.name] = b.text;
    else if (b.type === "json")
      vars[b.name] = typeof b.json === "string" ? JSON.parse(b.json) : b.json;
    else if (
      !["secret_text", "secret_key"].includes(b.type) &&
      !["DB", "FILES", "ASSETS", "AI"].includes(b.name)
    )
      throw new Error(
        "Unexpected app resource binding; review before deployment",
      );
  }
  for (const name of authNames)
    if (typeof vars[name] !== "string" || !(vars[name] as string).trim())
      throw new Error(
        `Existing ${name} is missing or not readable; refusing to replace live configuration`,
      );
  const origin = new URL(vars.APP_ORIGIN as string);
  if (origin.protocol !== "https:" || origin.origin !== vars.APP_ORIGIN)
    throw new Error("Existing app origin must be an HTTPS origin");
  if (
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(
      vars.ACCESS_TEAM_DOMAIN as string,
    )
  )
    throw new Error("Invalid existing Access team domain");
  if (binding("DB")?.type !== "d1" || binding("DB")?.id !== databaseId)
    throw new Error("D1 binding does not match the approved database variable");
  if (
    binding("FILES")?.type !== "r2_bucket" ||
    binding("FILES")?.bucket_name !== "saldo-private"
  )
    throw new Error("Unexpected R2 binding");
  if (binding("ASSETS")?.type !== "assets")
    throw new Error("Protected asset binding is missing");
  if (
    binding("AI") &&
    (binding("AI")?.type !== "service" ||
      binding("AI")?.service !== "saldo-ai-bridge")
  )
    throw new Error("Unexpected AI service binding");
  for (const [name, allowed] of [
    ["AI", ["name", "type", "service", "environment", "entrypoint"]],
    ["FILES", ["name", "type", "bucket_name", "jurisdiction"]],
  ] as const) {
    const item = binding(name);
    if (
      item &&
      Object.keys(item).some(
        (key) => !(allowed as readonly string[]).includes(key),
      )
    )
      throw new Error(
        "Unsupported binding routing property; deployment blocked",
      );
  }
  for (const [name, keys] of [
    ["AI", ["environment", "entrypoint"]],
    ["FILES", ["jurisdiction"]],
  ] as const)
    for (const key of keys) {
      const value = binding(name)?.[key];
      if (value !== undefined && typeof value !== "string")
        throw new Error("Invalid binding routing property");
    }
  return vars;
}
export function validatePrivateEndpoints(value: unknown) {
  const v = value as Record<string, unknown>;
  if (v?.enabled !== false || v?.previews_enabled !== false)
    throw new Error(
      "Public Worker alternate endpoint is enabled or unverified",
    );
}
export function assertPreserved(before: Settings, after: Settings) {
  for (const original of before.bindings) {
    const current = after.bindings.find((b) => b.name === original.name);
    if (!current || current.type !== original.type)
      throw new Error("A pre-existing Worker binding was removed or changed");
    for (const key of [
      "text",
      "json",
      "id",
      "bucket_name",
      "namespace_id",
      "service",
      "environment",
      "entrypoint",
      "jurisdiction",
      "class_name",
      "script_name",
    ])
      if (
        original[key] !== undefined &&
        JSON.stringify(current[key]) !== JSON.stringify(original[key])
      )
        throw new Error("A pre-existing Worker binding value changed");
  }
}
export function makeAppConfig(
  settings: Settings,
  databaseId: string,
  root: string,
) {
  validateApp(settings, databaseId);
  return {
    name: "saldo",
    main: resolve(root, "server/worker.ts"),
    compatibility_date: "2026-10-01",
    workers_dev: false,
    preview_urls: false,
    observability: { enabled: false },
    assets: {
      directory: resolve(root, "dist"),
      binding: "ASSETS",
      run_worker_first: true,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "saldo",
        database_id: databaseId,
        migrations_dir: resolve(root, "migrations"),
      },
    ],
    r2_buckets: [
      {
        binding: "FILES",
        bucket_name: "saldo-private",
        ...(typeof settings.bindings.find((b) => b.name === "FILES")
          ?.jurisdiction === "string"
          ? {
              jurisdiction: settings.bindings.find((b) => b.name === "FILES")!
                .jurisdiction as string,
            }
          : {}),
      },
    ],
    services: [
      {
        binding: "AI",
        service: "saldo-ai-bridge",
        ...Object.fromEntries(
          ["environment", "entrypoint"].flatMap((key) => {
            const value = settings.bindings.find((b) => b.name === "AI")?.[key];
            return typeof value === "string" ? [[key, value]] : [];
          }),
        ),
      },
    ],
  };
}
export function validateBridge(settings: Settings) {
  for (const binding of settings.bindings) {
    if (
      binding.name !== "SALDO_AI" &&
      ["plain_text", "json", "secret_text", "secret_key"].includes(binding.type)
    )
      continue;
    if (
      Object.keys(binding).some(
        (key) =>
          ![
            "name",
            "type",
            "namespace_id",
            "class_name",
            "script_name",
          ].includes(key),
      ) ||
      binding.name !== "SALDO_AI" ||
      binding.type !== "durable_object_namespace" ||
      binding.class_name !== "SaldoAI" ||
      (binding.script_name !== undefined &&
        binding.script_name !== "saldo-ai-bridge") ||
      typeof binding.namespace_id !== "string" ||
      !binding.namespace_id
    )
      throw new Error(
        "Bridge namespace identity is not verified; deployment blocked",
      );
  }
}
export function assertLatestMain(expected: string, actual: string) {
  if (
    !/^[a-f0-9]{40}$/.test(expected) ||
    expected !== actual.trim().split(/\s+/)[0]
  )
    throw new Error(
      "This run is no longer the latest main commit; deployment skipped",
    );
}
function currentMain() {
  let result: string;
  try {
    result = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
  } catch {
    throw new Error("Cannot verify current main; deployment blocked");
  }
  assertLatestMain(process.env.GITHUB_SHA ?? "", result);
}
function context() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    database = process.env.SALDO_D1_DATABASE_ID ?? "",
    token = process.env.CLOUDFLARE_API_TOKEN ?? "",
    temp = process.env.RUNNER_TEMP;
  if (
    !/^[a-f0-9]{32}$/.test(account) ||
    !/^[-a-f0-9]{36}$/.test(database) ||
    !token ||
    !temp
  )
    throw new Error("Required protected environment configuration is missing");
  return { account, database, token, temp, root: process.cwd() };
}
export const apiOperations = {
  "app-settings": "app Worker settings read",
  "app-private-endpoints": "app private-endpoint settings read",
  "bridge-settings": "bridge Worker settings read",
  "bridge-private-endpoints": "bridge private-endpoint settings read",
  "d1-recovery": "D1 recovery-bookmark read",
} as const;
type ApiOperation = keyof typeof apiOperations;
export async function api(
  path: string,
  operation: ApiOperation,
  fetcher: typeof fetch = fetch,
) {
  const c = context();
  const label = apiOperations[operation] ?? "preflight read";
  const failure = (detail: string) =>
    new Error(
      `Cloudflare ${label} failed (${detail}); deployment stopped. Do not broaden token permissions automatically.`,
    );
  let r: Response;
  try {
    r = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${c.account}/${path}`,
      {
        headers: { Authorization: `Bearer ${c.token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw failure("request error");
  }
  if (!r.ok) throw failure(`HTTP ${r.status}`);
  let body: { success?: boolean; result?: unknown };
  try {
    body = (await r.json()) as typeof body;
  } catch {
    throw failure("invalid response");
  }
  if (!body || body.success !== true)
    throw failure(`HTTP ${r.status}, unsuccessful response`);
  return body.result;
}

function privateWrite(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}
function mask(value: unknown) {
  if (typeof value === "string" && value)
    console.log(
      `::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
    );
}
async function inspect(name: "saldo" | "saldo-ai-bridge") {
  const settings = parseSettings(
    await api(
      `workers/scripts/${name}/settings`,
      name === "saldo" ? "app-settings" : "bridge-settings",
    ),
  );
  validatePrivateEndpoints(
    await api(
      `workers/scripts/${name}/subdomain`,
      name === "saldo" ? "app-private-endpoints" : "bridge-private-endpoints",
    ),
  );
  return settings;
}
export async function prepare() {
  const c = context();
  mkdirSync(c.temp, { recursive: true });
  const app = await inspect("saldo"),
    bridge = await inspect("saldo-ai-bridge");
  const vars = validateApp(app, c.database);
  for (const value of Object.values(vars)) mask(value);
  for (const b of bridge.bindings) {
    if (b.type === "plain_text") mask(b.text);
  }
  validateBridge(bridge);
  const recovery = (await api(
    `d1/database/${c.database}/time_travel/bookmark`,
    "d1-recovery",
  )) as { bookmark?: unknown };
  if (typeof recovery.bookmark !== "string" || !recovery.bookmark)
    throw new Error("No verified D1 recovery point; migrations blocked");
  const timestamp = new Date().toISOString();
  privateWrite(join(c.temp, "saldo-production-snapshot.json"), {
    app,
    bridge,
    recovery: { timestamp, bookmark: recovery.bookmark },
  });
  privateWrite(
    join(c.temp, "saldo-app.wrangler.json"),
    makeAppConfig(app, c.database, c.root),
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Pre-deployment safety\nPrivate Worker settings verified. D1 Time Travel recovery point checked at ${timestamp}. No database contents exported.\n`,
    );
  console.log(
    "Private configuration and D1 recovery point verified; values withheld.",
  );
}
export function migrate() {
  const c = context();
  const snapshot = JSON.parse(
    readFileSync(join(c.temp, "saldo-production-snapshot.json"), "utf8"),
  );
  if (!snapshot.recovery?.bookmark)
    throw new Error("Recovery preflight required");
  try {
    execFileSync(
      process.execPath,
      [
        resolve(c.root, "node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "migrations",
        "apply",
        "DB",
        "--remote",
        "--config",
        join(c.temp, "saldo-app.wrangler.json"),
      ],
      {
        cwd: c.root,
        env: { ...process.env, CI: "true", CLOUDFLARE_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      },
    );
  } catch {
    throw new Error(
      "D1 migration failed. Stop deployment and inspect Cloudflare; no destructive recovery was attempted.",
    );
  }
  console.log("Additive D1 migrations completed.");
}
export async function verify() {
  const c = context();
  const before = JSON.parse(
    readFileSync(join(c.temp, "saldo-production-snapshot.json"), "utf8"),
  ) as { app: Settings; bridge: Settings };
  const app = await inspect("saldo"),
    bridge = await inspect("saldo-ai-bridge");
  assertPreserved(before.app, app);
  assertPreserved(before.bridge, bridge);
  validateBridge(bridge);
  const vars = validateApp(app, c.database);
  if (
    !app.bindings.some(
      (b) =>
        b.name === "AI" &&
        b.type === "service" &&
        b.service === "saldo-ai-bridge",
    )
  )
    throw new Error("App-to-bridge binding missing");
  if (
    !bridge.bindings.some(
      (b) => b.name === "SALDO_AI" && b.type === "durable_object_namespace",
    )
  )
    throw new Error("Bridge durable binding missing");
  const response = await fetch(`${vars.APP_ORIGIN}/api/status`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (
      !location ||
      new URL(location, vars.APP_ORIGIN as string).hostname !==
        vars.ACCESS_TEAM_DOMAIN
    )
      throw new Error("Unexpected authentication redirect");
  } else if (response.status !== 401)
    throw new Error("Anonymous access is not verified as blocked");
  console.log(
    "Settings, secret binding names, private endpoints and anonymous access verified. Owner login and live ChatGPT acceptance remain separate.",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const action = process.argv[2];
  try {
    if (action === "current-main") currentMain();
    else if (action === "prepare") await prepare();
    else if (action === "migrate") migrate();
    else if (action === "verify") await verify();
    else throw new Error("Choose prepare, migrate or verify");
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "CI deployment safety check failed",
    );
    process.exitCode = 1;
  }
}
