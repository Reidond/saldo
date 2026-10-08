import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  realpathSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";

type Binding = Record<string, unknown> & { name: string; type: string };
export interface Settings {
  bindings: Binding[];
}

/**
 * The deployables, each a cf project with its own cloudflare.config.ts. `cf
 * build` writes Build Output to `<dir>/.cloudflare/output/v0`, and the deploy
 * job uploads exactly that output with `cf deploy --prebuilt`.
 */
export const components = {
  bridge: { worker: "saldo-ai-bridge", dir: "apps/bridge" },
  app: { worker: "saldo", dir: "apps/api" },
} as const;
export type Component = keyof typeof components;

/**
 * The account's identifiers. cf replaces every var that a version does not
 * declare (it has no keep_vars), so release builds take them from the
 * protected GitHub Environment (SALDO_RELEASE=production) and this script
 * checks them against the live Workers before anything changes.
 */
export interface ReleaseSettings {
  appOrigin: string;
  teamDomain: string;
  audience: string;
  ownerSubject: string;
  databaseId: string;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value)
    throw new Error(
      `${name} is missing from the protected environment; deployment stopped`,
    );
  return value;
}
/** The approved D1 database (a GitHub Environment variable). */
export function databaseIdOf(env: Record<string, string | undefined>) {
  const id = required(env, "SALDO_D1_DATABASE_ID");
  if (!uuid.test(id)) throw new Error("Invalid SALDO_D1_DATABASE_ID");
  return id;
}
export function releaseSettings(
  env: Record<string, string | undefined>,
): ReleaseSettings {
  const settings = {
    appOrigin: required(env, "SALDO_APP_ORIGIN"),
    teamDomain: required(env, "SALDO_ACCESS_TEAM_DOMAIN"),
    audience: required(env, "SALDO_ACCESS_AUD"),
    ownerSubject: required(env, "SALDO_OWNER_SUB"),
    databaseId: databaseIdOf(env),
  };
  let origin: URL;
  try {
    origin = new URL(settings.appOrigin);
  } catch {
    throw new Error("SALDO_APP_ORIGIN must be an HTTPS origin");
  }
  if (origin.protocol !== "https:" || origin.origin !== settings.appOrigin)
    throw new Error("SALDO_APP_ORIGIN must be an HTTPS origin");
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(settings.teamDomain))
    throw new Error("Invalid SALDO_ACCESS_TEAM_DOMAIN");
  if (!/^[a-f0-9]{64}$/.test(settings.audience))
    throw new Error("Invalid SALDO_ACCESS_AUD");
  if (/\s/.test(settings.ownerSubject))
    throw new Error("Invalid SALDO_OWNER_SUB");
  return settings;
}

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

/**
 * The live app Worker must already carry the identifiers the release will
 * deploy, so a mistyped Environment variable cannot replace a working Access
 * configuration. A deliberate change updates both, then re-runs.
 */
export function validateApp(settings: Settings, expected: ReleaseSettings) {
  const binding = (name: string) =>
    settings.bindings.find((b) => b.name === name);
  for (const b of settings.bindings)
    if (
      !["plain_text", "secret_text", "secret_key"].includes(b.type) &&
      !["DB", "FILES", "ASSETS", "AI"].includes(b.name)
    )
      throw new Error(
        "Unexpected app resource binding; review before deployment",
      );
  for (const [name, value] of [
    ["APP_ORIGIN", expected.appOrigin],
    ["ACCESS_TEAM_DOMAIN", expected.teamDomain],
    ["ACCESS_AUD", expected.audience],
    ["OWNER_SUB", expected.ownerSubject],
  ] as const) {
    const live = binding(name);
    if (live?.type !== "plain_text" || live.text !== value)
      throw new Error(
        `Live ${name} differs from the protected environment; refusing to replace live configuration`,
      );
  }
  if (binding("DB")?.type !== "d1" || binding("DB")?.id !== expected.databaseId)
    throw new Error("D1 binding does not match the approved database variable");
  if (
    binding("FILES")?.type !== "r2_bucket" ||
    binding("FILES")?.bucket_name !== "saldo-private" ||
    binding("FILES")?.jurisdiction !== undefined
  )
    throw new Error("Unexpected R2 binding");
  if (
    binding("AI") &&
    (binding("AI")?.type !== "service" ||
      binding("AI")?.service !== "saldo-ai-bridge" ||
      binding("AI")?.entrypoint !== undefined ||
      !["production", undefined].includes(
        binding("AI")?.environment as string | undefined,
      ))
  )
    throw new Error("Unexpected AI service binding");
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
/**
 * The app Worker served apps/web/dist as a single-page app. apps/web now
 * builds its own RSC Worker that this pipeline does not deploy yet, and the
 * app Worker has no assets, so stop before any change instead of shipping a
 * page-less app.
 */
export function assertLegacyWebBuild(root: string) {
  if (!existsSync(resolve(root, "apps/web/dist/index.html")))
    throw new Error(
      "apps/web builds a separate Worker that this pipeline cannot deploy; deployment stopped before any change",
    );
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

type OutputBinding = Record<string, unknown> & { type: string };
export interface BuiltWorker {
  name: string;
  workersDev?: boolean;
  previewUrls?: boolean;
  domains?: unknown;
  triggers?: unknown;
  env?: Record<string, OutputBinding>;
  exports?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}
export interface BuildOutput {
  root: { buildContext?: { mode?: unknown; isPreview?: unknown } };
  worker: BuiltWorker;
  containers: Record<string, Record<string, unknown>>;
}
/** Reads the Build Output that `cf deploy --prebuilt` will upload. */
export function readBuildOutput(directory: string): BuildOutput {
  const read = (path: string) =>
    JSON.parse(readFileSync(join(directory, path), "utf8")) as unknown;
  let root: BuildOutput["root"], worker: BuiltWorker;
  try {
    root = read("config.json") as BuildOutput["root"];
    worker = read("workers/default/worker.config.json") as BuiltWorker;
  } catch {
    throw new Error(
      "Build Output is missing; build the release before deploying",
    );
  }
  const containers: BuildOutput["containers"] = {};
  if (existsSync(join(directory, "containers")))
    for (const name of readdirSync(join(directory, "containers")))
      containers[name] = read(
        `containers/${name}/container.config.json`,
      ) as Record<string, unknown>;
  return { root, worker, containers };
}
const text = (value: string) => ({ type: "text", value });
/** JSON with sorted keys, so equal configurations compare equal. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : v,
  );
}
/** The exact bindings each release may carry; anything else stops it. */
export function expectedBindings(
  component: Component,
  settings: ReleaseSettings,
): Record<string, OutputBinding> {
  if (component === "bridge")
    return {
      SALDO_AI: {
        type: "durable-object",
        worker: "saldo-ai-bridge",
        exportName: "SaldoAI",
      },
    };
  return {
    APP_ORIGIN: text(settings.appOrigin),
    ACCESS_TEAM_DOMAIN: text(settings.teamDomain),
    ACCESS_AUD: text(settings.audience),
    OWNER_SUB: text(settings.ownerSubject),
    DB: { type: "d1", name: "saldo", id: settings.databaseId },
    FILES: { type: "r2", name: "saldo-private" },
    AI: { type: "worker", worker: "saldo-ai-bridge" },
  };
}
export function validateBuildOutput(
  component: Component,
  output: BuildOutput,
  settings: ReleaseSettings,
) {
  const { root, worker } = output;
  if (root.buildContext?.mode !== "production" || root.buildContext.isPreview)
    throw new Error(`${component}: Build Output is not a production build`);
  if (worker.name !== components[component].worker)
    throw new Error(`${component}: Build Output is for another Worker`);
  if (worker.workersDev !== false || worker.previewUrls !== false)
    throw new Error(`${component}: workers.dev or Preview URLs are enabled`);
  // Domains and routes are owner-managed; a release never moves them.
  if (worker.domains !== undefined || worker.triggers !== undefined)
    throw new Error(`${component}: Build Output declares routes or domains`);
  if (
    canonical(worker.env ?? {}) !==
    canonical(expectedBindings(component, settings))
  )
    throw new Error(
      `${component}: Build Output bindings differ from the approved release`,
    );
  if (component === "bridge") {
    const container = output.containers["saldo-ai-bridge-saldoai"];
    if (
      canonical(worker.exports) !==
        canonical({
          SaldoAI: {
            type: "durable-object",
            storage: "sqlite",
            container: "saldo-ai-bridge-saldoai",
          },
        }) ||
      Object.keys(output.containers).length !== 1 ||
      container?.instanceType !== "lite" ||
      container.maxInstances !== 1
    )
      throw new Error(
        "bridge: Durable Object or Container definition changed; deployment blocked",
      );
  } else if (
    worker.exports !== undefined ||
    Object.keys(output.containers).length
  )
    throw new Error(`${component}: unexpected exports or Containers`);
}
const privateFileName = /(^\.dev\.vars|^\.env|\.pem$|\.key$|secrets\.json$)/;
/**
 * Fails if an uploaded file is a local secret file, or if a secret value (or
 * an identifier that belongs only in binding metadata) appears in uploaded
 * code or assets.
 */
export function assertNoSecretValues(
  directory: string,
  values: string[],
): void {
  const needles = values.filter((v) => v.length >= 8);
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const name = relative(directory, file);
        if (privateFileName.test(entry.name))
          throw new Error(`Build Output contains a private file: ${name}`);
        // Binding metadata carries the vars by design; nothing else may.
        if (entry.name === "worker.config.json") continue;
        const content = readFileSync(file).toString("latin1");
        if (needles.some((needle) => content.includes(needle)))
          throw new Error(`Build Output file ${name} contains a secret value`);
      }
    }
  };
  walk(directory);
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
    token = process.env.CLOUDFLARE_API_TOKEN ?? "",
    temp = process.env.RUNNER_TEMP;
  if (!/^[a-f0-9]{32}$/.test(account) || !token || !temp)
    throw new Error("Required protected environment configuration is missing");
  return { account, token, temp, root: process.cwd() };
}
const release = () => releaseSettings(process.env);
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
async function inspect(component: Component) {
  const name = components[component].worker;
  const settings = parseSettings(
    await api(`workers/scripts/${name}/settings`, `${component}-settings`),
  );
  validatePrivateEndpoints(
    await api(
      `workers/scripts/${name}/subdomain`,
      `${component}-private-endpoints`,
    ),
  );
  return settings;
}
const outputOf = (root: string, component: Component) =>
  resolve(root, components[component].dir, ".cloudflare/output/v0");
/** Masks the release identifiers for the rest of the job. */
export function maskSettings() {
  const values = release();
  for (const value of Object.values(values)) mask(value);
  console.log("Release settings are present and well formed; values withheld.");
}
export async function prepare() {
  const c = context(),
    settings = release();
  assertLegacyWebBuild(c.root);
  mkdirSync(c.temp, { recursive: true });
  for (const component of Object.keys(components) as Component[]) {
    const directory = outputOf(c.root, component);
    validateBuildOutput(component, readBuildOutput(directory), settings);
    assertNoSecretValues(directory, [
      c.token,
      settings.audience,
      settings.ownerSubject,
    ]);
  }
  const app = await inspect("app"),
    bridge = await inspect("bridge");
  validateApp(app, settings);
  validateBridge(bridge);
  const recovery = (await api(
    `d1/database/${settings.databaseId}/time_travel/bookmark`,
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
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Pre-deployment safety\nBuild Output, private Worker settings verified. D1 Time Travel recovery point checked at ${timestamp}. No database contents exported.\n`,
    );
  console.log(
    "Build Output, private configuration and D1 recovery point verified; values withheld.",
  );
}
/**
 * Runs the component's own pinned cf (never a global one) in its directory,
 * where cloudflare.config.ts and the Build Output live.
 */
function cf(
  dir: string,
  args: string[],
  { timeout, quiet }: { timeout: number; quiet: boolean },
) {
  execFileSync("pnpm", ["exec", "cf", ...args], {
    cwd: resolve(process.cwd(), dir),
    env: { ...process.env, CI: "true", CF_SEND_TELEMETRY: "false" },
    stdio: ["ignore", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
    timeout,
  });
}
export function migrate() {
  const c = context();
  const databaseId = databaseIdOf(process.env);
  const snapshot = JSON.parse(
    readFileSync(join(c.temp, "saldo-production-snapshot.json"), "utf8"),
  );
  if (!snapshot.recovery?.bookmark)
    throw new Error("Recovery preflight required");
  try {
    // Remote unless --local; non-interactive runs confirm the prompt.
    cf(
      components.app.dir,
      ["d1", "migrations", "apply", databaseId, "--dir", "migrations"],
      { timeout: 120000, quiet: true },
    );
  } catch {
    throw new Error(
      "D1 migration failed. Stop deployment and inspect Cloudflare; no destructive recovery was attempted.",
    );
  }
  console.log("Additive D1 migrations completed.");
}
/** Uploads the verified Build Output and sends all traffic to it. */
export function deploy(component: Component) {
  context();
  const tag = process.env.SALDO_RELEASE_TAG ?? "";
  if (!/^[a-f0-9]{40}-\d+-\d+$/.test(tag))
    throw new Error("SALDO_RELEASE_TAG is missing or malformed");
  cf(
    components[component].dir,
    [
      "deploy",
      "--prebuilt",
      "--mode",
      "production",
      "--no-provision",
      "--tag",
      tag,
      "--quiet",
      ...(component === "bridge" ? ["--containers-rollout", "immediate"] : []),
    ],
    { timeout: component === "bridge" ? 900000 : 300000, quiet: false },
  );
}
export async function verify() {
  const c = context(),
    settings = release();
  const before = JSON.parse(
    readFileSync(join(c.temp, "saldo-production-snapshot.json"), "utf8"),
  ) as { app: Settings; bridge: Settings };
  const app = await inspect("app"),
    bridge = await inspect("bridge");
  assertPreserved(before.app, app);
  assertPreserved(before.bridge, bridge);
  validateBridge(bridge);
  validateApp(app, settings);
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
  const response = await fetch(`${settings.appOrigin}/api/status`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (
      !location ||
      new URL(location, settings.appOrigin).hostname !== settings.teamDomain
    )
      throw new Error("Unexpected authentication redirect");
  } else if (response.status !== 401)
    throw new Error("Anonymous access is not verified as blocked");
  console.log(
    "Settings, secret binding names, private endpoints and anonymous access verified. Owner login and live ChatGPT acceptance remain separate.",
  );
}
// Compare real paths so a symlinked checkout cannot skip every safety step.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  const [action, component] = process.argv.slice(2);
  try {
    if (action === "current-main") currentMain();
    else if (action === "settings") maskSettings();
    else if (action === "prepare") await prepare();
    else if (action === "migrate") migrate();
    else if (action === "deploy" && component && component in components)
      deploy(component as Component);
    else if (action === "verify") await verify();
    else
      throw new Error(
        "Choose current-main, settings, prepare, migrate, deploy <component> or verify",
      );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "CI deployment safety check failed",
    );
    process.exitCode = 1;
  }
}
