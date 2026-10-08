import { it, expect } from "vite-plus/test";
import worker, { type Env } from "../src/worker";
const env = { APP_ORIGIN: "https://saldo.test" } as Env;
it("never serves assets or personal API without configured identity", async () => {
  for (const path of ["/", "/api/subscriptions", "/api/chat"])
    expect(
      (await worker.fetch(new Request(`https://saldo.test${path}`), env))
        .status,
    ).toBe(401);
});
it("status is honest when disconnected and contains no user data", async () =>
  expect(
    await (
      await worker.fetch(new Request("https://saldo.test/api/status"), env)
    ).json(),
  ).toEqual({ authenticated: false, aiConnected: false }));
it("blocks cross-site state changes before storage/auth calls", async () =>
  expect(
    (
      await worker.fetch(
        new Request("https://saldo.test/api/review", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
        }),
        env,
      )
    ).status,
  ).toBe(403));
