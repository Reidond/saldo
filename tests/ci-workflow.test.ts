import { readFileSync } from "node:fs";
import { describe, it, expect } from "vite-plus/test";
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
describe("CI production boundaries", () => {
  it("pins every official action to an immutable commit", () => {
    const actions = [...workflow.matchAll(/uses:\s+([^\s]+)@([^\s]+)/g)];
    expect(actions.length).toBeGreaterThan(0);
    for (const [, name, ref] of actions) {
      expect([
        "actions/checkout",
        "actions/setup-node",
        "cloudflare/wrangler-action",
      ]).toContain(name);
      expect(ref).toMatch(/^[a-f0-9]{40}$/);
    }
  });
  it("keeps PR checks outside the protected production Environment", () => {
    const checks = workflow.split("  check:")[1].split("  deploy:")[0];
    expect(checks).not.toContain("secrets.");
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
  it("preserves live vars and secrets and avoids app domain mutations", () => {
    expect(workflow).toContain(
      "deploy --config apps/bridge/wrangler.jsonc --keep-vars",
    );
    expect(workflow).toContain("versions upload --config");
    expect(workflow).toContain("--keep-vars --tag");
    expect(workflow).toContain("versions deploy --config");
    expect(workflow).not.toContain("triggers deploy");
    expect(workflow).not.toMatch(/\n\s+secrets:\s/);
    expect(workflow).toContain("deployment.ts verify");
  });
  it("installs the locked pnpm workspace with the Wrangler used for deployment", () => {
    expect(workflow).not.toMatch(/\bnpm (ci|install|run)\b/);
    expect(workflow.match(/corepack enable pnpm/g)).toHaveLength(2);
    expect(workflow.match(/pnpm install --frozen-lockfile/g)).toHaveLength(2);
    expect(workflow.match(/pnpm run check/g)).toHaveLength(2);
    expect(workflow.match(/packageManager: pnpm/g)).toHaveLength(2);
    expect(workflow.match(/--file apps\/bridge\/Dockerfile/g)).toHaveLength(2);
    // wrangler-action skips its own install only when the workspace root
    // already resolves the exact pinned version.
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    expect(root.devDependencies.wrangler).toBe("catalog:");
    const pinned = readFileSync("pnpm-workspace.yaml", "utf8").match(
      /^ {2}wrangler: (\S+)$/m,
    )?.[1];
    const versions = [...workflow.matchAll(/wranglerVersion: "([^"]+)"/g)];
    expect(versions).toHaveLength(2);
    for (const [, version] of versions) expect(version).toBe(pinned);
  });
  it("runs recovery preflight and migrations before either deployment", () => {
    const prepare = workflow.indexOf("deployment.ts prepare"),
      migrate = workflow.indexOf("deployment.ts migrate"),
      bridge = workflow.indexOf("Deploy the private bridge"),
      app = workflow.indexOf("Upload and activate the app");
    expect(prepare).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(bridge);
    expect(bridge).toBeLessThan(app);
    expect(workflow).toContain("--platform linux/amd64");
    expect(workflow).not.toContain("time-travel restore");
    expect(workflow).not.toContain("d1 export");
  });
});
