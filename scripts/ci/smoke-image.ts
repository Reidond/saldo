import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import process from "node:process";
import console from "node:console";

// `cf build` in apps/bridge builds the Container image and records its local
// reference in the Build Output; `cf deploy --prebuilt` pushes that image. The
// smoke test runs exactly that image.
const buildOutput =
  process.env.SALDO_BRIDGE_BUILD_OUTPUT ??
  fileURLToPath(
    new URL("../../apps/bridge/.cloudflare/output/v0/", import.meta.url),
  );
function builtImage() {
  let reference: unknown;
  try {
    reference = JSON.parse(
      readFileSync(
        join(
          buildOutput,
          "containers/saldo-ai-bridge-saldoai/container.config.json",
        ),
        "utf8",
      ),
    )?.image?.localReference;
  } catch {
    throw new Error(
      "No bridge Build Output; run the bridge build (cf build) first.",
    );
  }
  if (
    typeof reference !== "string" ||
    !/^cloudflare-build\/[a-z0-9]+\/saldo-ai-bridge-saldoai:[a-z0-9]+$/.test(
      reference,
    )
  )
    throw new Error("Unexpected bridge image reference in the Build Output.");
  return reference;
}
const name = `saldo-ai-smoke-${process.pid}-${randomUUID()}`;
// Generated solely for this disposable container. Never use a caller's secret.
const secret = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
const startupLimitMs = 30_000;
let mayExist = false;

function docker(args: string[], timeout = 10_000) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, AI_BRIDGE_SECRET: secret },
  });
}

function removeContainer() {
  if (!mayExist) return;
  const result = docker(["rm", "--force", name]);
  if (result.status !== 0 && !result.stderr?.includes("No such container"))
    throw new Error(
      "Unable to remove the smoke container; inspect Docker before continuing.",
    );
  mayExist = false;
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, () => {
    try {
      removeContainer();
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : "Container cleanup failed.",
      );
    }
    process.exit(code);
  });
}

// All HTTP requests execute inside the network-disabled container, on loopback.
// Probes never include a provider access token or a valid inference payload.
const readyProbe = `
  const response = await fetch('http://127.0.0.1:8080/ci-startup', {
    signal: AbortSignal.timeout(1000)
  });
  if (response.status !== 401) throw new Error('Expected unauthenticated 401 during startup');
  await response.arrayBuffer();
`;

const smokeProbe = `
  import assert from 'node:assert/strict';
  const origin = 'http://127.0.0.1:8080';
  const authorization = 'Bearer ' + process.env.AI_BRIDGE_SECRET;
  async function check(path, options, status, code) {
    const response = await fetch(origin + path, {
      ...options, signal: AbortSignal.timeout(2000)
    });
    assert.equal(response.status, status, path + ' status');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error, code, path + ' error');
  }
  await check('/infer', { method: 'POST' }, 401, 'UNAUTHORIZED');
  await check('/ci-route-does-not-exist', {
    headers: { authorization }
  }, 404, 'NOT_FOUND');
  for (const body of ['{', '{}']) {
    await check('/infer', {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body
    }, 400, 'INVALID_INPUT');
  }
  console.log('Image smoke passed: 401 unauthenticated, 404 missing route, 400 invalid JSON and invalid schema.');
`;

async function main() {
  if (process.argv.length !== 2)
    throw new Error(
      "Usage: node scripts/ci/smoke-image.ts (uses the image of the bridge Build Output).",
    );
  const image = builtImage();
  try {
    // No port publication, mounts, remote image pull, or provider credentials.
    mayExist = true;
    const run = docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      name,
      "--pull",
      "never",
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "128",
      "--memory",
      "256m",
      "--env",
      "AI_BRIDGE_SECRET",
      image,
    ]);
    if (
      run.error &&
      ["ENOENT", "EACCES"].includes(
        (run.error as NodeJS.ErrnoException).code ?? "",
      )
    )
      mayExist = false; // Docker never started, so no container can exist.
    if (run.status !== 0)
      throw new Error(
        `Cannot start prebuilt image ${image}: ${run.error?.message ?? run.stderr.trim()}`,
      );
    const deadline = Date.now() + startupLimitMs;
    let ready = false;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const probe = docker(
        ["exec", name, "node", "--input-type=module", "-e", readyProbe],
        Math.min(3000, Math.max(1, remaining)),
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      const wait = Math.min(500, deadline - Date.now());
      if (wait > 0) await setTimeout(wait);
    }
    if (!ready)
      throw new Error(
        "Container did not reach its unauthenticated rejection path within 30 seconds.",
      );
    const smoke = docker([
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      smokeProbe,
    ]);
    if (smoke.status !== 0)
      throw new Error(
        `Image rejection-path smoke failed: ${smoke.error?.message ?? smoke.stderr.trim()}`,
      );
    console.log(smoke.stdout.trim());
  } finally {
    removeContainer();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Image smoke failed.");
  process.exitCode = 1;
});
