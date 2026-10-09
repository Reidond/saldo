import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  realpathSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, relative, dirname, basename } from "node:path";
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
 * job uploads exactly that output with `cf deploy --prebuilt`. They deploy in
 * this order, so the web never binds to an API that is not there yet.
 */
export const components = {
  bridge: { worker: "saldo-ai-bridge", dir: "apps/bridge" },
  api: { worker: "saldo-api", dir: "apps/api" },
  web: { worker: "saldo-web", dir: "apps/web" },
} as const;
export type Component = keyof typeof components;
export const deployOrder: Component[] = ["bridge", "api", "web"];
/**
 * The single app Worker that served pages and API before the split. Releases
 * never change it; it keeps the custom domain until the owner moves it to
 * saldo-web, and deleting it is a separate owner decision.
 */
export const legacyWorker = "saldo";

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

const accessVars = (settings: ReleaseSettings) =>
  [
    ["APP_ORIGIN", settings.appOrigin],
    ["ACCESS_TEAM_DOMAIN", settings.teamDomain],
    ["ACCESS_AUD", settings.audience],
  ] as const;
/**
 * A live Worker must already carry the identifiers the release will deploy,
 * so a mistyped Environment value cannot replace a working Access
 * configuration. A deliberate change updates both, then re-runs.
 */
function assertVars(
  live: Settings,
  expected: readonly (readonly [string, string])[],
) {
  for (const [name, value] of expected) {
    const binding = live.bindings.find((b) => b.name === name);
    if (binding?.type !== "plain_text" || binding.text !== value)
      throw new Error(
        `Live ${name} differs from the protected environment; refusing to replace live configuration`,
      );
  }
}
function assertOnly(live: Settings, allowed: string[], label: string) {
  for (const b of live.bindings)
    if (
      !["secret_text", "secret_key"].includes(b.type) &&
      !allowed.includes(b.name)
    )
      throw new Error(`Unexpected ${label} binding; review before deployment`);
}
const bindingOf = (live: Settings, name: string) =>
  live.bindings.find((b) => b.name === name);
function assertService(binding: Binding | undefined, service: string) {
  if (
    binding?.type !== "service" ||
    binding.service !== service ||
    binding.entrypoint !== undefined ||
    !["production", undefined].includes(
      binding.environment as string | undefined,
    )
  )
    throw new Error(`Unexpected ${binding?.name ?? service} service binding`);
}
function assertDatabase(live: Settings, settings: ReleaseSettings) {
  const db = bindingOf(live, "DB");
  if (db?.type !== "d1" || db.id !== settings.databaseId)
    throw new Error("D1 binding does not match the approved database variable");
}
/** The live API Worker: Access settings, D1, R2 and the bridge, nothing else. */
export function validateApi(live: Settings, settings: ReleaseSettings) {
  assertOnly(
    live,
    [...accessVars(settings).map(([n]) => n), "OWNER_SUB", "DB", "FILES", "AI"],
    "API",
  );
  assertVars(live, [
    ...accessVars(settings),
    ["OWNER_SUB", settings.ownerSubject],
  ]);
  assertDatabase(live, settings);
  const files = bindingOf(live, "FILES");
  if (
    files?.type !== "r2_bucket" ||
    files.bucket_name !== "saldo-private" ||
    files.jurisdiction !== undefined
  )
    throw new Error("Unexpected R2 binding");
  assertService(bindingOf(live, "AI"), "saldo-ai-bridge");
}
/** The live web Worker: Access settings, its assets and the API binding. */
export function validateWeb(live: Settings, settings: ReleaseSettings) {
  assertOnly(
    live,
    [...accessVars(settings).map(([n]) => n), "ASSETS", "API"],
    "web",
  );
  assertVars(live, accessVars(settings));
  if (bindingOf(live, "ASSETS")?.type !== "assets")
    throw new Error("Protected asset binding is missing");
  assertService(bindingOf(live, "API"), "saldo-api");
}
/** The legacy app Worker still holds today's Access settings and database. */
export function validateLegacy(live: Settings, settings: ReleaseSettings) {
  assertVars(live, [
    ...accessVars(settings),
    ["OWNER_SUB", settings.ownerSubject],
  ]);
  assertDatabase(live, settings);
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
export function validateBridge(settings: Settings) {
  for (const binding of settings.bindings) {
    if (
      binding.name !== "SALDO_AI" &&
      ["secret_text", "secret_key"].includes(binding.type)
    )
      continue;
    // cf deploy keeps secrets but deletes undeclared plain or JSON vars.
    if (
      binding.name !== "SALDO_AI" &&
      ["plain_text", "json"].includes(binding.type)
    )
      throw new Error(
        "The live bridge has a plain variable that cf deploy would delete; declare it in apps/bridge/cloudflare.config.ts or remove it first",
      );
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
/** Each live Worker against the release, once it exists. */
export function validateLive(
  component: Component,
  live: Settings,
  settings: ReleaseSettings,
) {
  if (component === "bridge") validateBridge(live);
  else if (component === "api") validateApi(live, settings);
  else validateWeb(live, settings);
}

type OutputBinding = Record<string, unknown> & { type: string };
export interface BuiltWorker {
  name: string;
  workersDev?: boolean;
  previewUrls?: boolean;
  domains?: unknown;
  triggers?: unknown;
  assets?: unknown;
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
  const access = {
    APP_ORIGIN: text(settings.appOrigin),
    ACCESS_TEAM_DOMAIN: text(settings.teamDomain),
    ACCESS_AUD: text(settings.audience),
  };
  if (component === "bridge")
    return {
      SALDO_AI: {
        type: "durable-object",
        worker: "saldo-ai-bridge",
        exportName: "SaldoAI",
      },
    };
  if (component === "web")
    return {
      ASSETS: { type: "assets" },
      API: { type: "worker", worker: "saldo-api" },
      ...access,
    };
  return {
    ...access,
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
  // Only the web serves assets, and every asset request runs its Worker first.
  if (
    component === "web"
      ? canonical(worker.assets) !== canonical({ runWorkerFirst: true })
      : worker.assets !== undefined
  )
    throw new Error(`${component}: unexpected static asset routing`);
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

const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(directory, entry.name))
      : [join(directory, entry.name)],
  );
}
/**
 * The files the bridge image is built from: the allow-list in .dockerignore
 * (`!path`, with `*` only in the last segment).
 */
export function dockerContextFiles(root: string): string[] {
  const files = new Set<string>([".dockerignore"]);
  for (const line of readFileSync(join(root, ".dockerignore"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("!"))) {
    const pattern = line.slice(1);
    if (!pattern.includes("*")) {
      files.add(pattern);
      continue;
    }
    const matcher = new RegExp(
      `^${basename(pattern)
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*")}$`,
    );
    for (const name of readdirSync(join(root, dirname(pattern))))
      if (matcher.test(name)) files.add(join(dirname(pattern), name));
  }
  return [...files].sort();
}
/**
 * A content hash of what a release would upload: the Build Output, and for
 * the bridge the image's sources instead of its local image reference (image
 * builds are not byte-reproducible). A deploy records it on the version, so
 * an unchanged component is skipped and a re-run is idempotent.
 */
export function contentHash(component: Component, root: string): string {
  const output = resolve(
    root,
    components[component].dir,
    ".cloudflare/output/v0",
  );
  const parts = filesUnder(output)
    .sort()
    .map((file) => {
      const name = relative(output, file);
      let content: string | Buffer = readFileSync(file);
      if (
        name.startsWith("containers/") &&
        name.endsWith("container.config.json")
      ) {
        const config = JSON.parse(content.toString("utf8"));
        delete config.image?.localReference;
        content = canonical(config);
      }
      return `${name}\0${sha256(content)}`;
    });
  if (component === "bridge")
    for (const file of dockerContextFiles(root))
      parts.push(`image:${file}\0${sha256(readFileSync(join(root, file)))}`);
  return sha256(parts.join("\n"));
}
export const contentMessage = (hash: string) => `saldo-content ${hash}`;

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
  "worker-settings": "Worker settings read",
  "worker-endpoints": "Worker private-endpoint settings read",
  "worker-deployments": "Worker deployments read",
  "worker-version": "Worker version read",
  "worker-domains": "Worker custom-domain read",
  "workers-subdomain": "workers.dev subdomain read",
  "d1-recovery": "D1 recovery-bookmark read",
} as const;
type ApiOperation = keyof typeof apiOperations;
/**
 * A read-only Cloudflare API call. With `missing: true`, a 404 (the Worker
 * does not exist yet) returns undefined instead of failing.
 */
export async function api(
  path: string,
  operation: ApiOperation,
  fetcher: typeof fetch = fetch,
  { missing = false }: { missing?: boolean } = {},
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
  if (missing && r.status === 404) return undefined;
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
/** A live Worker's bindings, after checking its alternate endpoints are off. */
async function inspect(name: string): Promise<Settings | undefined> {
  const settings = await api(
    `workers/scripts/${name}/settings`,
    "worker-settings",
    fetch,
    { missing: true },
  );
  if (settings === undefined) return undefined;
  validatePrivateEndpoints(
    await api(`workers/scripts/${name}/subdomain`, "worker-endpoints"),
  );
  return parseSettings(settings);
}
interface Active {
  version: string;
  tag?: string;
  message?: string;
}
/** The version that serves all of a Worker's traffic, with its annotations. */
async function activeVersion(name: string): Promise<Active | undefined> {
  const result = (await api(
    `workers/scripts/${name}/deployments`,
    "worker-deployments",
    fetch,
    { missing: true },
  )) as
    | {
        deployments?: {
          versions?: { version_id: string; percentage: number }[];
        }[];
      }
    | undefined;
  const versions = result?.deployments?.[0]?.versions ?? [];
  if (versions.length !== 1 || versions[0].percentage !== 100) return undefined;
  const version = (await api(
    `workers/workers/${name}/versions/${versions[0].version_id}`,
    "worker-version",
  )) as { annotations?: Record<string, string> };
  return {
    version: versions[0].version_id,
    tag: version.annotations?.["workers/tag"],
    message: version.annotations?.["workers/message"],
  };
}

/** What happened to each component in this run (shown by `record`). */
export type Outcome = "deployed" | "unchanged" | "failed" | "not attempted";
export interface ReleaseState {
  commit: string;
  tag: string;
  components: Record<
    Component,
    { hash: string; outcome: Outcome; version?: string }
  >;
}
const statePath = (temp: string) => join(temp, "saldo-release.json");
const snapshotPath = (temp: string) =>
  join(temp, "saldo-production-snapshot.json");
function readState(temp: string): ReleaseState {
  return JSON.parse(readFileSync(statePath(temp), "utf8")) as ReleaseState;
}
const outputOf = (root: string, component: Component) =>
  resolve(root, components[component].dir, ".cloudflare/output/v0");
const releaseTag = () => {
  const tag = process.env.SALDO_RELEASE_TAG ?? "";
  if (!/^[a-f0-9]{40}-\d+-\d+$/.test(tag))
    throw new Error("SALDO_RELEASE_TAG is missing or malformed");
  return tag;
};
/** Masks the release identifiers for the rest of the job. */
export function maskSettings() {
  const values = release();
  for (const value of Object.values(values)) mask(value);
  console.log("Release settings are present and well formed; values withheld.");
}
export async function prepare() {
  const c = context(),
    settings = release(),
    tag = releaseTag();
  mkdirSync(c.temp, { recursive: true });
  const state: ReleaseState = {
    commit: tag.slice(0, 40),
    tag,
    components: {} as ReleaseState["components"],
  };
  for (const component of deployOrder) {
    const directory = outputOf(c.root, component);
    validateBuildOutput(component, readBuildOutput(directory), settings);
    assertNoSecretValues(directory, [
      c.token,
      settings.audience,
      settings.ownerSubject,
    ]);
    state.components[component] = {
      hash: contentHash(component, c.root),
      outcome: "not attempted",
    };
  }
  const live: Partial<Record<Component | "legacy", Settings>> = {};
  for (const component of deployOrder) {
    const settingsOf = await inspect(components[component].worker);
    if (settingsOf) {
      validateLive(component, settingsOf, settings);
      live[component] = settingsOf;
    } else if (component === "bridge")
      throw new Error("The bridge Worker is missing; deployment blocked");
  }
  // Until the cutover, the legacy app Worker is the live Access setup.
  const legacy = await inspect(legacyWorker);
  if (legacy) validateLegacy(legacy, settings);
  const recovery = (await api(
    `d1/database/${settings.databaseId}/time_travel/bookmark`,
    "d1-recovery",
  )) as { bookmark?: unknown };
  if (typeof recovery.bookmark !== "string" || !recovery.bookmark)
    throw new Error("No verified D1 recovery point; migrations blocked");
  const timestamp = new Date().toISOString();
  privateWrite(snapshotPath(c.temp), {
    live,
    recovery: { timestamp, bookmark: recovery.bookmark },
  });
  privateWrite(statePath(c.temp), state);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Pre-deployment safety\nBuild Output and private Worker settings verified. D1 Time Travel recovery point checked at ${timestamp}. No database contents exported.\n`,
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
  const snapshot = JSON.parse(readFileSync(snapshotPath(c.temp), "utf8"));
  if (!snapshot.recovery?.bookmark)
    throw new Error("Recovery preflight required");
  try {
    // Remote unless --local; non-interactive runs confirm the prompt.
    cf(
      components.api.dir,
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
/**
 * Uploads the verified Build Output and sends all traffic to it, unless the
 * active version already carries the same content. The new version must be
 * the active one afterwards.
 */
export async function deploy(component: Component) {
  const c = context();
  const state = readState(c.temp);
  const entry = state.components[component];
  const worker = components[component].worker;
  const message = contentMessage(entry.hash);
  const before = await activeVersion(worker);
  if (before?.message === message) {
    entry.outcome = "unchanged";
    entry.version = before.version;
    privateWrite(statePath(c.temp), state);
    console.log(`${worker} is unchanged; kept version ${before.version}.`);
    return;
  }
  entry.outcome = "failed";
  privateWrite(statePath(c.temp), state);
  cf(
    components[component].dir,
    [
      "deploy",
      "--prebuilt",
      "--mode",
      "production",
      "--no-provision",
      "--tag",
      state.tag,
      "--message",
      message,
      "--quiet",
      ...(component === "bridge" ? ["--containers-rollout", "immediate"] : []),
    ],
    { timeout: component === "bridge" ? 900000 : 300000, quiet: false },
  );
  const after = await activeVersion(worker);
  if (after?.message !== message || after.tag !== state.tag)
    throw new Error(`${worker} is not serving the uploaded version`);
  entry.outcome = "deployed";
  entry.version = after.version;
  privateWrite(statePath(c.temp), state);
  console.log(`${worker} now serves version ${after.version}.`);
}
/** Anonymous requests must meet Access: a redirect to the team, or 401. */
export function assertAccessDenied(
  status: number,
  location: string | null,
  settings: ReleaseSettings,
) {
  if ([301, 302, 303, 307, 308].includes(status)) {
    if (
      !location ||
      new URL(location, settings.appOrigin).hostname !== settings.teamDomain
    )
      throw new Error("Unexpected authentication redirect");
  } else if (status !== 401)
    throw new Error("Anonymous access is not verified as blocked");
}
export async function verify() {
  const c = context(),
    settings = release();
  const before = JSON.parse(readFileSync(snapshotPath(c.temp), "utf8")) as {
    live: Partial<Record<Component, Settings>>;
  };
  for (const component of deployOrder) {
    const worker = components[component].worker;
    const live = await inspect(worker);
    if (!live) throw new Error(`${worker} is missing after deployment`);
    const original = before.live[component];
    if (original) assertPreserved(original, live);
    validateLive(component, live, settings);
  }
  // No custom domain on the API or the bridge; the web holds the app's
  // hostname once the owner moves it from the legacy Worker.
  const host = new URL(settings.appOrigin).hostname;
  for (const component of ["api", "bridge"] as const) {
    const domains = (await api(
      `workers/domains?service=${components[component].worker}`,
      "worker-domains",
    )) as unknown[];
    if (!Array.isArray(domains) || domains.length)
      throw new Error(`${components[component].worker} has a custom domain`);
  }
  const owners = (await api(
    `workers/domains?hostname=${encodeURIComponent(host)}`,
    "worker-domains",
  )) as { service?: string }[];
  const holder = Array.isArray(owners) ? owners[0]?.service : undefined;
  if (holder !== components.web.worker && holder !== legacyWorker)
    throw new Error("The app hostname is not served by the web Worker");
  // workers.dev answers 404 (error 1042) for a Worker that has it disabled.
  const { subdomain } = (await api(
    "workers/subdomain",
    "workers-subdomain",
  )) as { subdomain?: string };
  if (!subdomain)
    throw new Error("The account workers.dev subdomain is unknown");
  for (const component of deployOrder) {
    const response = await fetch(
      `https://${components[component].worker}.${subdomain}.workers.dev/api/status`,
      { redirect: "manual", signal: AbortSignal.timeout(30000) },
    );
    if (response.status !== 404)
      throw new Error(
        `${components[component].worker} is reachable on workers.dev`,
      );
  }
  for (const path of ["/", "/api/status"]) {
    const response = await fetch(`${settings.appOrigin}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    assertAccessDenied(
      response.status,
      response.headers.get("Location"),
      settings,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      holder === components.web.worker
        ? "The app hostname is served by saldo-web.\n"
        : "The app hostname is still served by the legacy saldo Worker: the owner's cutover is pending.\n",
    );
  console.log(
    "Bindings, private endpoints, domains, workers.dev and anonymous access verified. Owner login and live ChatGPT acceptance remain separate.",
  );
}
/** A summary of the run for the job summary; fails if anything failed. */
export function summarize(
  state: ReleaseState | undefined,
  jobStatus = "success",
) {
  if (!state)
    return {
      ok: false,
      text: "### Release\nNo component was deployed: the run stopped before the pre-deployment checks finished.\n",
    };
  const rows = deployOrder.map((component) => {
    const { outcome, version } = state.components[component];
    return `| ${components[component].worker} | ${outcome} | ${version ?? "-"} |`;
  });
  const outcomes = deployOrder.map((c) => state.components[c].outcome);
  const failed = outcomes.includes("failed");
  const deployed = outcomes.every((o) => o === "deployed" || o === "unchanged");
  const done = deployed && jobStatus === "success";
  const status = done
    ? "complete"
    : deployed
      ? "deployed, but a later check failed"
      : failed && outcomes.some((o) => o === "deployed")
        ? "partial: some components changed before a failure"
        : "failed";
  return {
    ok: done,
    text: [
      `### Release ${status}`,
      `Commit \`${state.commit}\`, tag \`${state.tag}\`.`,
      "",
      "| Worker | Outcome | Active version |",
      "| --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  };
}
export function record() {
  const temp = process.env.RUNNER_TEMP ?? "";
  const state =
    temp && existsSync(statePath(temp)) ? readState(temp) : undefined;
  const { ok, text: summary } = summarize(state, process.env.SALDO_JOB_STATUS);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (!ok) throw new Error("The release did not complete");
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
      await deploy(component as Component);
    else if (action === "verify") await verify();
    else if (action === "record") record();
    else
      throw new Error(
        "Choose current-main, settings, prepare, migrate, deploy <component>, verify or record",
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
