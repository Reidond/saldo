// Dependencies that services receive from the composition root
// (src/worker.ts). Tests substitute fakes for every one of them.
import type { chatSchema, Proposal, Subscription } from "@saldo/domain";
import type { z } from "zod";

/** D1; services use it for db.batch and pass it to repository functions. */
export type Database = D1Database;

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  uuid(): string;
}

/** Claims of a Cloudflare Access application token whose signature passed. */
export interface AccessTokenClaims {
  issuer: string;
  subject: string;
  /** Unix seconds. */
  issuedAt: number;
  email?: unknown;
  name?: unknown;
}

export interface AccessTokenVerifier {
  /**
   * Checks the signature against the team's JWKS, the issuer
   * (https://<teamDomain>), the audience and the expiry. Throws if any fails.
   */
  verify(
    token: string,
    expected: { teamDomain: string; audience: string },
  ): Promise<AccessTokenClaims>;
}

export type ChatInput = z.infer<typeof chatSchema>;

export interface ExtractionInput extends ChatInput {
  subscriptions: Subscription[];
}

export interface ExtractionResult {
  reply: string | null;
  /** Schema-valid but not yet reviewed or saved. */
  proposals: Proposal[];
}

/** Where AI extraction runs. Manual workflows never depend on it. */
export interface AiProvider {
  /** False when no provider is configured; extract must not be called. */
  readonly enabled: boolean;
  status(): Promise<{ connected: boolean }>;
  /** Throws AiRequestFailedError when the provider rejects the request. */
  extract(
    input: ExtractionInput,
    signal: AbortSignal,
  ): Promise<ExtractionResult>;
}
