import "server-only";
import type { ServiceFetcher } from "./api/binding";

/** Bindings and vars of the web Worker (see wrangler.jsonc). */
export interface WebEnv {
  API?: ServiceFetcher;
  ASSETS?: ServiceFetcher;
  APP_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Development and tests only: `synthetic` serves fictional data. */
  SALDO_DATA_SOURCE?: string;
  SALDO_SYNTHETIC_AI?: string;
}

export interface AccessSettings {
  teamDomain: string;
  audience: string;
}

export type WebConfig =
  | {
      mode: "api";
      api: ServiceFetcher;
      assets?: ServiceFetcher;
      appOrigin: string;
      access: AccessSettings;
    }
  | {
      mode: "synthetic";
      assets?: ServiceFetcher;
      ai: "available" | "unavailable";
    };

export type ConfigResult =
  | { ok: true; config: WebConfig }
  | { ok: false; reason: string };

const teamDomainPattern = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

/**
 * Picks the data source for this Worker. Fails closed: production needs the
 * API binding and Access settings, and synthetic data is refused unless this
 * code runs in a Vite dev server or a test (`allowSynthetic`).
 */
export function resolveConfig(
  env: WebEnv,
  { allowSynthetic }: { allowSynthetic: boolean },
): ConfigResult {
  if (env.SALDO_DATA_SOURCE !== undefined) {
    if (env.SALDO_DATA_SOURCE !== "synthetic")
      return { ok: false, reason: "Unknown SALDO_DATA_SOURCE." };
    if (!allowSynthetic)
      return {
        ok: false,
        reason: "Synthetic data is only available in development and tests.",
      };
    return {
      ok: true,
      config: {
        mode: "synthetic",
        assets: env.ASSETS,
        ai:
          env.SALDO_SYNTHETIC_AI === "available" ? "available" : "unavailable",
      },
    };
  }
  if (!env.API)
    return { ok: false, reason: "The API service binding is missing." };
  if (
    !env.ACCESS_TEAM_DOMAIN ||
    !teamDomainPattern.test(env.ACCESS_TEAM_DOMAIN)
  )
    return { ok: false, reason: "ACCESS_TEAM_DOMAIN is missing or invalid." };
  if (!env.ACCESS_AUD) return { ok: false, reason: "ACCESS_AUD is missing." };
  const origin = parseOrigin(env.APP_ORIGIN);
  if (!origin)
    return { ok: false, reason: "APP_ORIGIN is missing or invalid." };
  return {
    ok: true,
    config: {
      mode: "api",
      api: env.API,
      assets: env.ASSETS,
      appOrigin: origin,
      access: { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD },
    },
  };
}

function parseOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}
