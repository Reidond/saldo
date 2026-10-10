import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  type CryptoKey,
} from "jose";
import { createAccessTokenVerifier } from "../../src/infrastructure/access-verifier";
import { IdentityService } from "../../src/services/identity-service";
import {
  FakeDatabase,
  fakeRepositories,
  fixedClock,
  sequentialIds,
} from "../support/fakes";

it("cryptographically isolates owner and rejects forged, expired, wrong audience and issuer tokens", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const verifier = createAccessTokenVerifier(() => keys);
  const db = new FakeDatabase();
  const identity = new IdentityService({
    db: db.d1,
    repos: fakeRepositories(db),
    verifier,
    clock: fixedClock(),
    ids: sequentialIds(),
    config: {
      teamDomain: "example.cloudflareaccess.com",
      audience: "saldo-only",
      ownerSubject: "owner",
    },
  });
  async function token(
    sub = "owner",
    aud = "saldo-only",
    issuer = "https://example.cloudflareaccess.com",
    exp = "1h",
    key: CryptoKey = privateKey,
    alg = "RS256",
  ) {
    return new SignJWT({ type: "app" })
      .setProtectedHeader({ alg, kid: "test" })
      .setSubject(sub)
      .setAudience(aud)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(key);
  }
  expect(await identity.authenticate(await token())).toMatchObject({
    subject: "owner",
    issuer: "https://example.cloudflareaccess.com",
  });
  const otherKey = (await generateKeyPair("RS256")).privateKey;
  const hmacKey = new TextEncoder().encode("x".repeat(32));
  for (const t of [
    await token("another"),
    await token("owner", "other-app"),
    await token("owner", "saldo-only", "https://evil.test"),
    await token(
      "owner",
      "saldo-only",
      "https://example.cloudflareaccess.com",
      "-1h",
    ),
    await token(
      "owner",
      "saldo-only",
      "https://example.cloudflareaccess.com",
      "1h",
      otherKey,
    ),
    await new SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "HS256", kid: "test" })
      .setSubject("owner")
      .setAudience("saldo-only")
      .setIssuer("https://example.cloudflareaccess.com")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(hmacKey),
    "forged",
  ])
    expect(await identity.authenticate(t)).toBeNull();
});

it("requires subject, expiry and issue time claims", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: "test" }],
  });
  const verifier = createAccessTokenVerifier(() => keys);
  const expected = {
    teamDomain: "example.cloudflareaccess.com",
    audience: "saldo-only",
  };
  const base = () =>
    new SignJWT({ type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setAudience("saldo-only")
      .setIssuer("https://example.cloudflareaccess.com");
  for (const token of [
    await base().setIssuedAt().setExpirationTime("1h").sign(privateKey),
    await base()
      .setSubject("")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey),
    await base().setSubject("owner").setExpirationTime("1h").sign(privateKey),
    await base().setSubject("owner").setIssuedAt().sign(privateKey),
  ])
    await expect(verifier.verify(token, expected)).rejects.toThrow();
  const valid = await base()
    .setSubject("owner")
    .setIssuedAt(1_800_000_000)
    .setExpirationTime("1h")
    .sign(privateKey);
  await expect(verifier.verify(valid, expected)).resolves.toEqual({
    issuer: "https://example.cloudflareaccess.com",
    subject: "owner",
    issuedAt: 1_800_000_000,
    email: undefined,
    name: undefined,
  });
});

describe("parity with the web gate", () => {
  const expected = {
    teamDomain: "example.cloudflareaccess.com",
    audience: "saldo-only",
  };
  const now = () => Math.floor(Date.now() / 1000);
  let sign: (
    payload: Record<string, unknown>,
    claims?: { aud?: string; iss?: string; exp?: number; iat?: number },
  ) => Promise<string>;
  let verifier: ReturnType<typeof createAccessTokenVerifier>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(publicKey)), kid: "test" }],
    });
    verifier = createAccessTokenVerifier(() => keys);
    sign = (payload, claims = {}) =>
      new SignJWT({ sub: "owner", ...payload })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setAudience(claims.aud ?? "saldo-only")
        .setIssuer(claims.iss ?? "https://example.cloudflareaccess.com")
        .setIssuedAt(claims.iat ?? now())
        .setExpirationTime(claims.exp ?? now() + 3600)
        .sign(privateKey);
  });

  it("accepts only Access application tokens", async () => {
    await expect(
      verifier.verify(await sign({ type: "app" }), expected),
    ).resolves.toMatchObject({ subject: "owner" });
    for (const payload of [
      {},
      { type: "org" },
      { type: "APP" },
      { type: ["app"] },
      { type: null },
    ])
      await expect(
        verifier.verify(await sign(payload), expected),
      ).rejects.toThrow();
  });

  it("rejects a wrong audience or issuer and an expired token", async () => {
    for (const claims of [
      { aud: "another-app" },
      { iss: "https://evil.cloudflareaccess.com" },
      { iss: "https://example.cloudflareaccess.com/" },
      { exp: now() - 60, iat: now() - 3600 },
    ])
      await expect(
        verifier.verify(await sign({ type: "app" }, claims), expected),
      ).rejects.toThrow();
  });

  it("allows 5 seconds of clock skew on expiry, like the web gate", async () => {
    await expect(
      verifier.verify(
        await sign({ type: "app" }, { exp: now() - 2, iat: now() - 60 }),
        expected,
      ),
    ).resolves.toMatchObject({ subject: "owner" });
    await expect(
      verifier.verify(
        await sign({ type: "app" }, { exp: now() - 30, iat: now() - 60 }),
        expected,
      ),
    ).rejects.toThrow();
  });

  it("refuses any subject other than the owner through the identity service", async () => {
    const identity = new IdentityService({
      db: new FakeDatabase().d1,
      repos: fakeRepositories(new FakeDatabase()),
      verifier,
      clock: fixedClock(),
      ids: sequentialIds(),
      config: { ...expected, ownerSubject: "owner" },
    });
    expect(
      await identity.authenticate(await sign({ type: "app" })),
    ).toMatchObject({ subject: "owner" });
    for (const payload of [
      { type: "app", sub: "another-owner" },
      { type: "app", sub: "" },
      { type: "org" },
    ])
      expect(await identity.authenticate(await sign(payload))).toBeNull();
  });
});
