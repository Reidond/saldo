import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AccessTokenClaims, AccessTokenVerifier } from "../services/ports";

/** JWKS per team domain, cached for the isolate's lifetime. */
const keysets = new Map<string, JWTVerifyGetKey>();

export function remoteAccessKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keysets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    keysets.set(teamDomain, keys);
  }
  return keys;
}

/** Verifies Cf-Access-Jwt-Assertion tokens with jose. */
export function createAccessTokenVerifier(
  keysFor: (teamDomain: string) => JWTVerifyGetKey = remoteAccessKeys,
): AccessTokenVerifier {
  return {
    async verify(token, { teamDomain, audience }): Promise<AccessTokenClaims> {
      const issuer = `https://${teamDomain}`;
      const { payload } = await jwtVerify(token, keysFor(teamDomain), {
        issuer,
        audience,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
      });
      if (!payload.sub || typeof payload.iat !== "number")
        throw new Error("Access token has no subject");
      return {
        issuer,
        subject: payload.sub,
        issuedAt: payload.iat,
        email: payload.email,
        name: payload.name,
      };
    },
  };
}
