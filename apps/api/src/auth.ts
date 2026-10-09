import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_SUB?: string;
}
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function authenticate(
  request: Request,
  env: AuthEnv,
): Promise<string | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_SUB) return null;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN))
    return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  try {
    let keys = keysets.get(env.ACCESS_TEAM_DOMAIN);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`),
      );
      keysets.set(env.ACCESS_TEAM_DOMAIN, keys);
    }
    return await verifyOwnerToken(token, env, keys);
  } catch {
    return null;
  }
}
export function validOrigin(request: Request, origin: string) {
  return (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    request.headers.get("Origin") === origin
  );
}

export async function verifyOwnerToken(
  token: string,
  env: AuthEnv,
  keys: JWTVerifyGetKey,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
      requiredClaims: ["sub", "exp", "iat"],
    });
    return payload.sub && payload.sub === env.OWNER_SUB ? payload.sub : null;
  } catch {
    return null;
  }
}
