import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AccessSettings } from "./config";

export interface AccessIdentity {
  sub: string;
  email: string | null;
  /** The verified token, forwarded unchanged to the API Worker. */
  assertion: string;
}

const keySets = new Map<string, JWTVerifyGetKey>();

function remoteKeys(teamDomain: string) {
  let keys = keySets.get(teamDomain);
  if (!keys) {
    keys = createRemoteJWKSet(
      new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
    );
    keySets.set(teamDomain, keys);
  }
  return keys;
}

/**
 * Verifies the Cloudflare Access application token on a request: RS256
 * signature from the team's keys, issuer, audience, expiry, a non-empty `sub`
 * (service tokens have none) and `type: "app"`. Returns null on any failure.
 */
export async function verifyAccess(
  request: Request,
  settings: AccessSettings,
  keys: JWTVerifyGetKey = remoteKeys(settings.teamDomain),
): Promise<AccessIdentity | null> {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) return null;
  try {
    const { payload } = await jwtVerify(assertion, keys, {
      issuer: `https://${settings.teamDomain}`,
      audience: settings.audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 5,
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (payload.type !== "app") return null;
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      assertion,
    };
  } catch {
    return null;
  }
}
