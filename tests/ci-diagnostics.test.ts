import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiOperations } from "../scripts/ci/deployment";
beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
  vi.stubEnv("SALDO_D1_DATABASE_ID", "00000000-0000-0000-0000-000000000001");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic-token-never-valid");
  vi.stubEnv("RUNNER_TEMP", "/tmp/synthetic-ci-test");
});
afterEach(() => vi.unstubAllEnvs());
describe("safe CI read diagnostics", () => {
  for (const operation of Object.keys(
    apiOperations,
  ) as (keyof typeof apiOperations)[]) {
    it(`labels ${operation} without reading or exposing a rejected response`, async () => {
      const response = new Response("private-response-body", { status: 403 });
      const json = vi.spyOn(response, "json");
      const fetcher = vi.fn(async () => response);
      await expect(
        api("private-account-and-resource-path", operation, fetcher),
      ).rejects.toThrow(
        `Cloudflare ${apiOperations[operation]} failed (HTTP 403); deployment stopped.`,
      );
      expect(json).not.toHaveBeenCalled();
    });
  }
  it("does not propagate network errors containing a token, path or settings", async () => {
    await expect(
      api(
        "private-path",
        "app-settings",
        vi.fn(async () => {
          throw new Error(
            "synthetic-token-never-valid private-path private-settings",
          );
        }),
      ),
    ).rejects.toThrow("app Worker settings read failed (request error)");
  });
  it("does not expose malformed or unsuccessful response contents", async () => {
    await expect(
      api(
        "private-path",
        "bridge-settings",
        vi.fn(async () => new Response("private-settings", { status: 200 })),
      ),
    ).rejects.toThrow("bridge Worker settings read failed (invalid response)");
    await expect(
      api(
        "private-path",
        "d1-recovery",
        vi.fn(async () =>
          Response.json({
            success: false,
            errors: [{ message: "private-token-or-setting" }],
          }),
        ),
      ),
    ).rejects.toThrow(
      "D1 recovery-bookmark read failed (HTTP 200, unsuccessful response)",
    );
  });
  it("returns the same successful result without weakening checks", async () => {
    const result = { bookmark: "synthetic-bookmark" };
    await expect(
      api(
        "private-path",
        "d1-recovery",
        vi.fn(async () => Response.json({ success: true, result })),
      ),
    ).resolves.toEqual(result);
  });
});
