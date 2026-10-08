import { it, expect } from "vite-plus/test";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { verifyOwnerToken } from "../src/auth";
it("cryptographically isolates owner and rejects forged, expired, wrong audience and issuer tokens", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const env = {
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ACCESS_AUD: "saldo-only",
    OWNER_SUB: "owner",
  };
  async function token(
    sub = "owner",
    aud = "saldo-only",
    issuer = "https://example.cloudflareaccess.com",
    exp = "1h",
  ) {
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject(sub)
      .setAudience(aud)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  }
  expect(await verifyOwnerToken(await token(), env, keys)).toBe("owner");
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
    "forged",
  ])
    expect(await verifyOwnerToken(t, env, keys)).toBeNull();
});
