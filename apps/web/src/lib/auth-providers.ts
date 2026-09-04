import type { NextAuthConfig } from "next-auth";

import Yandex from "@/lib/yandex-provider";

export const DEFAULT_OIDC_PROVIDER_ID = "oidc";

/** Google OpenID Connect issuer (discovery at /.well-known/openid-configuration). */
export const GOOGLE_OIDC_ISSUER = "https://accounts.google.com";

export type AuthProviderKind = "oidc" | "google" | "yandex";

export type ResolvedAuthProvider = {
  kind: AuthProviderKind;
  /** Auth.js provider id (callback path segment). */
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  issuer?: string;
  scopes?: string;
  tokenAuthMethod?: string;
};

export type AuthProviderEnv = {
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_PROVIDER_ID?: string;
  OIDC_PROVIDER_NAME?: string;
  OIDC_SCOPES?: string;
  OIDC_TOKEN_AUTH_METHOD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  YANDEX_CLIENT_ID?: string;
  YANDEX_CLIENT_SECRET?: string;
  [key: string]: string | undefined;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

/** OIDC-style slots share the same Auth.js wiring (issuer + client credentials). */
export function isOidcStyleKind(kind: AuthProviderKind): boolean {
  return kind === "oidc" || kind === "google";
}

/** Resolve issuer: stored value, or Google default when blank on the google slot. */
export function resolveIssuerForKind(kind: AuthProviderKind, issuer: string): string {
  const normalized = normalizeIssuer(issuer);
  if (normalized) return normalized;
  if (kind === "google") return GOOGLE_OIDC_ISSUER;
  return "";
}

export function defaultProviderIdForKind(kind: AuthProviderKind): string {
  if (kind === "google") return "google";
  if (kind === "yandex") return "yandex";
  return DEFAULT_OIDC_PROVIDER_ID;
}

/**
 * Effective Auth.js id for callbacks. Schema default providerId is "oidc" for every
 * row, so treat that default as unset for google/yandex slots.
 */
export function effectiveProviderId(kind: AuthProviderKind, stored: string): string {
  const trimmed = stored.trim();
  if (kind === "oidc") {
    return trimmed || DEFAULT_OIDC_PROVIDER_ID;
  }
  if (!trimmed || trimmed === DEFAULT_OIDC_PROVIDER_ID) {
    return defaultProviderIdForKind(kind);
  }
  return trimmed;
}

export function defaultDisplayNameForKind(kind: AuthProviderKind): string {
  if (kind === "google") return "Google";
  if (kind === "yandex") return "Yandex";
  return "OIDC";
}

/** Providers built from environment (bootstrap when Admin DB is empty). */
export function resolveEnvAuthProviders(
  env: AuthProviderEnv = process.env,
): ResolvedAuthProvider[] {
  const out: ResolvedAuthProvider[] = [];

  const oidcIssuer = normalizeIssuer(trim(env.OIDC_ISSUER));
  const oidcId = trim(env.OIDC_CLIENT_ID);
  const oidcSecret = trim(env.OIDC_CLIENT_SECRET);
  if (oidcIssuer && oidcId && oidcSecret) {
    out.push({
      kind: "oidc",
      id: trim(env.OIDC_PROVIDER_ID) || DEFAULT_OIDC_PROVIDER_ID,
      name: trim(env.OIDC_PROVIDER_NAME) || "OIDC",
      clientId: oidcId,
      clientSecret: oidcSecret,
      issuer: oidcIssuer,
      scopes: trim(env.OIDC_SCOPES) || "openid email profile",
      tokenAuthMethod: trim(env.OIDC_TOKEN_AUTH_METHOD) || "client_secret_post",
    });
  }

  if (trim(env.GOOGLE_CLIENT_ID) && trim(env.GOOGLE_CLIENT_SECRET)) {
    out.push({
      kind: "google",
      id: "google",
      name: "Google",
      clientId: trim(env.GOOGLE_CLIENT_ID),
      clientSecret: trim(env.GOOGLE_CLIENT_SECRET),
      issuer: GOOGLE_OIDC_ISSUER,
      scopes: "openid email profile",
      tokenAuthMethod: "client_secret_post",
    });
  }

  if (trim(env.YANDEX_CLIENT_ID) && trim(env.YANDEX_CLIENT_SECRET)) {
    out.push({
      kind: "yandex",
      id: "yandex",
      name: "Yandex",
      clientId: trim(env.YANDEX_CLIENT_ID),
      clientSecret: trim(env.YANDEX_CLIENT_SECRET),
    });
  }

  return out;
}

function buildOidcAuthJsProvider(row: ResolvedAuthProvider) {
  const linkSameEmail = { allowDangerousEmailAccountLinking: true as const };
  return {
    id: row.id,
    name: row.name,
    type: "oidc" as const,
    issuer: row.issuer!,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    ...linkSameEmail,
    authorization: {
      params: {
        scope: row.scopes || "openid email profile",
        // Force the IdP to re-authenticate instead of silent SSO.
        prompt: "login",
      },
    },
    client: {
      token_endpoint_auth_method: row.tokenAuthMethod || "client_secret_post",
    },
    profile(profile: { sub?: string; name?: string; email?: string }) {
      return {
        id: String(profile.sub),
        name: typeof profile.name === "string" ? profile.name : undefined,
        email: typeof profile.email === "string" ? profile.email : undefined,
        image: undefined,
      };
    },
  };
}

export function buildAuthProvidersFromResolved(
  resolved: ResolvedAuthProvider[],
): NextAuthConfig["providers"] {
  return resolved.map((row) => {
    const linkSameEmail = { allowDangerousEmailAccountLinking: true as const };

    if (isOidcStyleKind(row.kind)) {
      return buildOidcAuthJsProvider(row);
    }

    return Yandex({
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      ...linkSameEmail,
    });
  });
}

/** @deprecated Prefer resolveEnvAuthProviders + DB. Kept for env-only bootstrap. */
export function buildAuthProviders(
  env: AuthProviderEnv = process.env,
): NextAuthConfig["providers"] {
  return buildAuthProvidersFromResolved(resolveEnvAuthProviders(env));
}

export function oidcCallbackPath(providerId = DEFAULT_OIDC_PROVIDER_ID): string {
  return `/api/auth/callback/${providerId || DEFAULT_OIDC_PROVIDER_ID}`;
}

export function authCallbackUrl(publicUrl: string, providerId: string): string {
  const base = publicUrl.replace(/\/+$/, "");
  return `${base}/api/auth/callback/${providerId}`;
}

export function publicAuthBaseUrl(): string {
  return (
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}
