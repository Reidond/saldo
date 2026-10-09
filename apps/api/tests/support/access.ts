import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { vi } from "vite-plus/test";

/** Synthetic Cloudflare Access settings used by every test. */
export const accessSettings = {
  teamDomain: "example.cloudflareaccess.com",
  issuer: "https://example.cloudflareaccess.com",
  audience: "saldo-test-audience",
  ownerSubject: "owner-subject-0001",
} as const;

export interface AccessTokenClaims {
  sub?: string;
  aud?: string;
  iss?: string;
  exp?: string | number;
  iat?: number;
  email?: string;
  name?: string;
}

export interface AccessKeys {
  jwks: { keys: JWK[] };
  /** Signs an Access-style application token; defaults to the owner. */
  sign(claims?: AccessTokenClaims): Promise<string>;
}

export async function createAccessKeys(kid = "test-key"): Promise<AccessKeys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256" };
  return {
    jwks: { keys: [jwk] },
    sign(claims = {}) {
      const { sub, aud, iss, exp, iat, ...rest } = claims;
      const jwt = new SignJWT({ type: "app", ...rest })
        .setProtectedHeader({ alg: "RS256", kid })
        .setSubject(sub ?? accessSettings.ownerSubject)
        .setAudience(aud ?? accessSettings.audience)
        .setIssuer(iss ?? accessSettings.issuer)
        .setExpirationTime(exp ?? "1h");
      if (iat === undefined) jwt.setIssuedAt();
      else jwt.setIssuedAt(iat);
      return jwt.sign(privateKey);
    },
  };
}

/**
 * Serves the synthetic JWKS at the team domain's certs URL through a fetch
 * spy and passes every other request through unchanged.
 */
export function serveAccessCerts(jwks: { keys: JWK[] }) {
  const original = globalThis.fetch;
  const certs = `${accessSettings.issuer}/cdn-cgi/access/certs`;
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : input;
      return url === certs
        ? Promise.resolve(Response.json(jwks))
        : original(input, init);
    });
}
