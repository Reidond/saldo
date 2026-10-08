import { readFileSync } from "node:fs";
import { describe, it, expect } from "vite-plus/test";
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const checks = workflow.split("\n  check:\n")[1].split("\n  deploy:\n")[0];
const deploy = workflow.split("\n  deploy:\n")[1];
/** The deploy job's steps, each as its own YAML text. */
const steps = deploy.split("\n      - ").slice(1);
const step = (text: string) => {
  const found = steps.filter((s) => s.includes(text));
  expect(found, text).toHaveLength(1);
  return found[0];
};

describe("CI production boundaries", () => {
  it("pins every official action to an immutable commit", () => {
    const actions = [...workflow.matchAll(/uses:\s+([^\s]+)@([^\s]+)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, name, ref] of actions) {
      expect(["actions/checkout", "actions/setup-node"]).toContain(name);
      expect(ref).toMatch(/^[a-f0-9]{40}$/);
    }
  });
  it("keeps PR checks outside the protected production Environment", () => {
    expect(checks).not.toContain("secrets.");
    expect(checks).not.toContain("vars.");
    expect(checks).not.toContain("environment:");
    expect(workflow).toContain("contents: read");
    expect(workflow).not.toContain("write-all");
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("workflow_run:");
  });
  it("restricts deploy to main with a shared serialized Environment", () => {
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("environment: saldo-production");
    expect(workflow).toContain("group: saldo-production");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).not.toContain("ghcr.io");
  });
  it("gives secrets only to the steps that need them", () => {
    const jobEnv = deploy.split("\n    steps:\n")[0];
    expect(jobEnv).not.toContain("secrets.");
    for (const [i, s] of steps.entries())
      if (s.includes("secrets.CLOUDFLARE_API_TOKEN"))
        expect(s, `step ${i}`).toMatch(
          /deployment\.ts (prepare|migrate|deploy|verify)|TOKEN_CONFIGURED/,
        );
    for (const s of steps.filter((s) => s.includes("secrets.SALDO_")))
      expect(s).toMatch(
        /deployment\.ts (settings|prepare|verify)|pnpm run build/,
      );
    expect(step("pnpm install --frozen-lockfile")).not.toContain("secrets.");
  });
});

describe("separate API and web deployment", () => {
  it("deploys each Worker in its own step, so a failure stops the next one", () => {
    for (const component of ["bridge", "api", "web"])
      expect(step(`deployment.ts deploy ${component}`)).not.toContain("if:");
  });
  it("always records the commit and each Worker's version, even after a failure", () => {
    const record = step("deployment.ts record");
    expect(record).toContain("if: always()");
    expect(record).not.toContain("secrets.");
    expect(step("Remove ephemeral private state")).toContain("if: always()");
  });
});

describe("cf replaces Wrangler in CI", () => {
  it("never uses Wrangler or its GitHub Action", () => {
    expect(workflow).not.toMatch(/wrangler/i);
    expect(workflow).toContain('CF_SEND_TELEMETRY: "false"');
  });
  it("installs the locked pnpm workspace and checks it in both jobs", () => {
    expect(workflow).not.toMatch(/\bnpm (ci|install|run)\b/);
    expect(workflow).not.toMatch(/\bnpx\b/);
    expect(workflow.match(/corepack enable pnpm/g)).toHaveLength(2);
    expect(workflow.match(/pnpm install --frozen-lockfile/g)).toHaveLength(2);
    expect(workflow.match(/pnpm run check/g)).toHaveLength(2);
    expect(workflow.match(/node scripts\/ci\/migrations\.ts/g)).toHaveLength(2);
    expect(workflow.match(/pnpm run deploy:check/g)).toHaveLength(2);
    expect(workflow.match(/node scripts\/ci\/smoke-image\.ts/g)).toHaveLength(
      2,
    );
    expect(workflow).toContain("DOCKER_DEFAULT_PLATFORM: linux/amd64");
  });
  it("builds the release with the protected settings before validating it", () => {
    const build = step("pnpm run build");
    expect(build).toContain("SALDO_RELEASE: production");
    expect(build).toContain("secrets.SALDO_ACCESS_AUD");
    expect(build).toContain("secrets.SALDO_OWNER_SUB");
    expect(deploy).toContain("vars.SALDO_APP_ORIGIN");
    expect(deploy).toContain("vars.SALDO_D1_DATABASE_ID");
  });
  it("runs every safety step before the first mutation, in order", () => {
    const order = [
      "deployment.ts settings",
      "pnpm run check",
      "deployment.ts current-main",
      "pnpm run build",
      "pnpm run deploy:check",
      "smoke-image.ts",
      "deployment.ts prepare",
      "deployment.ts migrate",
      "deployment.ts deploy bridge",
      "deployment.ts deploy api",
      "deployment.ts deploy web",
      "deployment.ts verify",
      "deployment.ts record",
    ].map((text) => deploy.indexOf(text));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(workflow).not.toContain("time-travel restore");
    expect(workflow).not.toMatch(/cf (deploy|workers|d1)/);
    expect(workflow).not.toContain("d1 export");
  });
});
