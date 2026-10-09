import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import {
  contentMessage,
  deploy,
  type ReleaseState,
} from "../scripts/ci/deployment";

// deploy() against a fake Cloudflare API and a fake `pnpm` that records the
// cf command instead of running it. No network, credentials or Workers.
const tag = `${"a".repeat(40)}-1-1`;
let temp: string;
let log: string;
let active: { version: string; tag?: string; message?: string } | undefined;
let afterDeploy: typeof active;

function state(): ReleaseState {
  return JSON.parse(readFileSync(join(temp, "saldo-release.json"), "utf8"));
}
function cfCalls(): string[][] {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "saldo-deploy-test-"));
  log = join(temp, "cf.jsonl");
  writeFileSync(
    join(temp, "pnpm"),
    `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.SALDO_TEST_CF_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    { mode: 0o755 },
  );
  const initial: ReleaseState = {
    commit: "a".repeat(40),
    tag,
    components: {
      bridge: { hash: "1".repeat(64), outcome: "not attempted" },
      api: { hash: "2".repeat(64), outcome: "not attempted" },
      web: { hash: "3".repeat(64), outcome: "not attempted" },
    },
  };
  writeFileSync(join(temp, "saldo-release.json"), JSON.stringify(initial));
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic-token-never-valid");
  vi.stubEnv("RUNNER_TEMP", temp);
  vi.stubEnv("SALDO_TEST_CF_LOG", log);
  vi.stubEnv("PATH", `${temp}${delimiter}${process.env.PATH ?? ""}`);
  active = { version: "v-old", tag: "older", message: "saldo-content old" };
  afterDeploy = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const current = cfCalls().length ? afterDeploy : active;
      if (url.endsWith("/deployments"))
        return Response.json({
          success: true,
          result: {
            deployments: current
              ? [
                  {
                    versions: [
                      { version_id: current.version, percentage: 100 },
                    ],
                  },
                ]
              : [],
          },
        });
      if (url.includes("/versions/"))
        return Response.json({
          success: true,
          result: {
            annotations: {
              "workers/tag": current?.tag,
              "workers/message": current?.message,
            },
          },
        });
      return new Response("unexpected", { status: 500 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(temp, { recursive: true, force: true });
});

describe("deploying one Worker", () => {
  it("skips a Worker whose active version already has this content", async () => {
    active = {
      version: "v-same",
      tag: "older",
      message: contentMessage("2".repeat(64)),
    };
    await deploy("api");
    expect(cfCalls()).toEqual([]);
    expect(state().components.api).toMatchObject({
      outcome: "unchanged",
      version: "v-same",
    });
  });

  it("deploys the prebuilt release and records the version that now serves traffic", async () => {
    afterDeploy = {
      version: "v-new",
      tag,
      message: contentMessage("3".repeat(64)),
    };
    await deploy("web");
    expect(cfCalls()).toEqual([
      [
        "exec",
        "cf",
        "deploy",
        "--prebuilt",
        "--mode",
        "production",
        "--no-provision",
        "--tag",
        tag,
        "--message",
        contentMessage("3".repeat(64)),
        "--quiet",
      ],
    ]);
    expect(state().components.web).toMatchObject({
      outcome: "deployed",
      version: "v-new",
    });
    expect(state().components.api.outcome).toBe("not attempted");
  });

  it("rolls the bridge Container out immediately", async () => {
    afterDeploy = {
      version: "v-new",
      tag,
      message: contentMessage("1".repeat(64)),
    };
    await deploy("bridge");
    expect(cfCalls()[0].slice(-2)).toEqual([
      "--containers-rollout",
      "immediate",
    ]);
  });

  it("fails, and records the failure, when the new version is not the active one", async () => {
    afterDeploy = active;
    await expect(deploy("api")).rejects.toThrow(
      "saldo-api is not serving the uploaded version",
    );
    expect(state().components.api.outcome).toBe("failed");
  });

  it("deploys a Worker that does not exist yet", async () => {
    active = undefined;
    afterDeploy = {
      version: "v-first",
      tag,
      message: contentMessage("2".repeat(64)),
    };
    await deploy("api");
    expect(cfCalls()).toHaveLength(1);
    expect(state().components.api.outcome).toBe("deployed");
  });
});
