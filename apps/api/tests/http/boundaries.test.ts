import { describe, it, expect } from "vite-plus/test";
import { isAllowedOrigin } from "../../src/http/origin";
import worker, { type Env } from "../../src/worker";

describe("boundaries", () => {
  it("fails closed without auth setup or on forged headers", async () => {
    const response = await worker.fetch(
      new Request("https://saldo.test/api/subscriptions", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "owner@example.com",
        },
      }),
      { APP_ORIGIN: "https://saldo.test" } as Env,
    );
    expect(response.status).toBe(401);
  });
  it("rejects cross-origin mutations", () => {
    expect(
      isAllowedOrigin(
        new Request("https://saldo.test/api", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
        }),
        "https://saldo.test",
      ),
    ).toBe(false);
    expect(
      isAllowedOrigin(
        new Request("https://saldo.test/api", {
          method: "POST",
          headers: { Origin: "https://saldo.test" },
        }),
        "https://saldo.test",
      ),
    ).toBe(true);
  });
});
