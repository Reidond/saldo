import { describe, it, expect } from "vite-plus/test";
import { authenticate, validOrigin } from "../src/auth";
describe("boundaries", () => {
  it("fails closed without auth setup or on forged headers", async () => {
    expect(
      await authenticate(
        new Request("https://saldo.test", {
          headers: {
            "Cf-Access-Authenticated-User-Email": "owner@example.com",
          },
        }),
        {},
      ),
    ).toBeNull();
  });
  it("rejects cross-origin mutations", () => {
    expect(
      validOrigin(
        new Request("https://saldo.test/api", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
        }),
        "https://saldo.test",
      ),
    ).toBe(false);
    expect(
      validOrigin(
        new Request("https://saldo.test/api", {
          method: "POST",
          headers: { Origin: "https://saldo.test" },
        }),
        "https://saldo.test",
      ),
    ).toBe(true);
  });
});
