import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
export const ISSUER = "https://auth.openai.com";
export const RESOURCE = "https://api.openai.com/v1";
export const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const secret = z.string().min(1).max(100_000);
export const tokenSchema = z
  .object({
    access_token: secret,
    refresh_token: secret,
    id_token: secret,
    token_type: z.literal("Bearer"),
    scopes: z.array(z.string()).max(100),
    expires_at: z.number().finite().positive(),
    saved_at: z.string().datetime(),
  })
  .strict();
export const accountSchema = z
  .object({
    client_id: z
      .string()
      .min(1)
      .max(500)
      .refine((v) => v !== "dynamic_agent_client"),
    subject: z.string().min(1).max(500),
    issuer: z.literal(ISSUER),
    label: z.string().min(1).max(160),
    email: z.string().max(320).optional(),
    tokens: tokenSchema.optional(),
    reconnect_required: z.boolean().optional(),
  })
  .strict();
export type Account = z.infer<typeof accountSchema>;
export const pendingSchema = z
  .object({
    state: secret,
    nonce: secret,
    verifier: secret,
    redirect_uri: z.string(),
    client_id: z.string(),
    label: z.string(),
    subject: z.string().optional(),
    created_at: z.number(),
  })
  .strict();
export type Pending = z.infer<typeof pendingSchema>;
export const vaultSchema = z
  .object({
    version: z.literal(1),
    host_id: z.string().regex(/^urn:uuid:[a-f0-9-]{36}$/),
    accounts: z.array(accountSchema).max(20),
    active_client_id: z.string().optional(),
    pending: pendingSchema.optional(),
    imported_bundles: z.array(z.string()).default([]),
    refreshing_client_id: z.string().optional(),
  })
  .strict();
export type Vault = z.infer<typeof vaultSchema>;
export const bundleSchema = z
  .object({
    version: z.literal(1),
    bundle_id: z.string().uuid(),
    created_at: z.number(),
    account: accountSchema,
  })
  .strict();
export function emptyVault(): Vault {
  return {
    version: 1,
    host_id: `urn:uuid:${crypto.randomUUID()}`,
    accounts: [],
    imported_bundles: [],
  };
}
export function activeAccount(vault: Vault) {
  return vault.accounts.find((a) => a.client_id === vault.active_client_id);
}
export function hasGrant(
  account: Account | undefined,
): account is Account & { tokens: z.infer<typeof tokenSchema> } {
  return (
    !!account?.tokens &&
    !account.reconnect_required &&
    account.tokens.scopes.includes("chatgpt.tokens.use.direct")
  );
}
export async function validateIdentity(
  idToken: string,
  clientId: string,
  nonce?: string,
  subject?: string,
) {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ISSUER,
    audience: clientId,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });
  if (
    !payload.sub ||
    (nonce !== undefined && payload.nonce !== nonce) ||
    (subject !== undefined && payload.sub !== subject)
  )
    throw new Error("IDENTITY_MISMATCH");
  return {
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}
export async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    // Do not log/propagate provider bodies; these may contain confidential context.
    throw new Error(
      response.status === 400 || response.status === 401
        ? "RECONNECT_REQUIRED"
        : "TOKEN_SERVICE_UNAVAILABLE",
    );
  }
  return z
    .object({
      access_token: secret,
      refresh_token: secret.optional(),
      id_token: secret.optional(),
      token_type: z.string(),
      expires_in: z.number().positive().max(31_536_000),
      scope: z.string().optional(),
    })
    .parse(await response.json());
}
export async function exchangeCode(
  code: string,
  clientId: string,
  pending: Pending,
): Promise<Account> {
  const result = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirect_uri,
      resource: RESOURCE,
    }),
  );
  if (
    !result.id_token ||
    !result.refresh_token ||
    result.token_type.toLowerCase() !== "bearer"
  )
    throw new Error("INVALID_TOKEN_RESPONSE");
  const identity = await validateIdentity(
    result.id_token,
    clientId,
    pending.nonce,
    pending.subject,
  );
  const scopes = (result.scope ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes("chatgpt.tokens.use.direct"))
    throw new Error("PLAN_PERMISSION_REQUIRED");
  return accountSchema.parse({
    client_id: clientId,
    issuer: ISSUER,
    ...identity,
    label: pending.label,
    tokens: {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      id_token: result.id_token,
      token_type: "Bearer",
      scopes,
      expires_at: Date.now() + result.expires_in * 1000,
      saved_at: new Date().toISOString(),
    },
  });
}
/** Caller MUST serialize and durably mark a refresh in progress before calling. Never blindly retry a rotating refresh. */
export async function refreshAccount(account: Account): Promise<Account> {
  if (!hasGrant(account)) throw new Error("RECONNECT_REQUIRED");
  const result = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: account.client_id,
      refresh_token: account.tokens.refresh_token,
      resource: RESOURCE,
    }),
  );
  if (result.token_type.toLowerCase() !== "bearer")
    throw new Error("INVALID_TOKEN_RESPONSE");
  const scopes =
    result.scope === undefined
      ? account.tokens.scopes
      : result.scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes("chatgpt.tokens.use.direct"))
    throw new Error("PLAN_PERMISSION_REQUIRED");
  if (result.id_token)
    await validateIdentity(
      result.id_token,
      account.client_id,
      undefined,
      account.subject,
    );
  return accountSchema.parse({
    ...account,
    reconnect_required: false,
    tokens: {
      access_token: result.access_token,
      refresh_token: result.refresh_token ?? account.tokens.refresh_token,
      id_token: result.id_token ?? account.tokens.id_token,
      token_type: "Bearer",
      scopes,
      expires_at: Date.now() + result.expires_in * 1000,
      saved_at: new Date().toISOString(),
    },
  });
}
