import { it, expect } from "vite-plus/test";
import { readBody, PayloadTooLarge } from "../../src/http/body";
it("bounds actual streamed upload bytes even if Content-Length is absent", async () => {
  await expect(
    readBody(
      new Request("https://saldo.test", {
        method: "POST",
        body: '{"message":"too long"}',
      }),
      10,
    ),
  ).rejects.toBeInstanceOf(PayloadTooLarge);
});
it("rejects oversized declared length before parsing", async () => {
  await expect(
    readBody(
      new Request("https://saldo.test", {
        method: "POST",
        body: "{}",
        headers: { "Content-Length": "1000" },
      }),
      10,
    ),
  ).rejects.toBeInstanceOf(PayloadTooLarge);
});
it("parses bounded valid JSON", async () =>
  expect(
    await readBody(
      new Request("https://saldo.test", {
        method: "POST",
        body: '{"ok":true}',
      }),
    ),
  ).toEqual({ ok: true }));
