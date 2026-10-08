import { it, expect } from "vite-plus/test";
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
    return new SignJWT({})
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
    await new SignJWT({})
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
    new SignJWT({})
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
