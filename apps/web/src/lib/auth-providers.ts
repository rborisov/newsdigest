import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import Yandex from "@/lib/yandex-provider";

export const DEFAULT_OIDC_PROVIDER_ID = "oidc";

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

export function buildAuthProvidersFromResolved(
  resolved: ResolvedAuthProvider[],
): NextAuthConfig["providers"] {
  return resolved.map((row) => {
    // Same verified email may already exist from a prior Google/Yandex login;
    // allow linking the company OIDC (or other) account to that user.
    const linkSameEmail = { allowDangerousEmailAccountLinking: true as const };

    if (row.kind === "oidc") {
      return {
        id: row.id,
        name: row.name,
        type: "oidc" as const,
        issuer: row.issuer!,
        clientId: row.clientId,
        clientSecret: row.clientSecret,
        ...linkSameEmail,
        authorization: {
          params: { scope: row.scopes || "openid email profile" },
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
    if (row.kind === "google") {
      return Google({
        clientId: row.clientId,
        clientSecret: row.clientSecret,
        ...linkSameEmail,
      });
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
