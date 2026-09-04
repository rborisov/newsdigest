import type { NextAuthConfig } from "next-auth";

export const DEFAULT_OIDC_PROVIDER_ID = "oidc";

/** Google OpenID Connect issuer (discovery at /.well-known/openid-configuration). */
export const GOOGLE_OIDC_ISSUER = "https://accounts.google.com";

export type ResolvedAuthProvider = {
  /** Auth.js provider id (callback path segment). */
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
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
  [key: string]: string | undefined;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

export function assertValidProviderId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed || !/^[a-z0-9_-]+$/i.test(trimmed)) {
    throw new Error("provider id must be alphanumeric (plus _ -).");
  }
  return trimmed;
}

/** Resolve issuer; blank + id `google` → Google's OIDC issuer for legacy rows. */
export function resolveOidcIssuer(providerId: string, issuer: string): string {
  const normalized = normalizeIssuer(issuer);
  if (normalized) return normalized;
  if (providerId === "google") return GOOGLE_OIDC_ISSUER;
  return "";
}

/** Providers built from environment (bootstrap when Admin DB has none configured). */
export function resolveEnvAuthProviders(
  env: AuthProviderEnv = process.env,
): ResolvedAuthProvider[] {
  const out: ResolvedAuthProvider[] = [];

  const oidcIssuer = normalizeIssuer(trim(env.OIDC_ISSUER));
  const oidcId = trim(env.OIDC_CLIENT_ID);
  const oidcSecret = trim(env.OIDC_CLIENT_SECRET);
  if (oidcIssuer && oidcId && oidcSecret) {
    out.push({
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
      id: "google",
      name: "Google",
      clientId: trim(env.GOOGLE_CLIENT_ID),
      clientSecret: trim(env.GOOGLE_CLIENT_SECRET),
      issuer: GOOGLE_OIDC_ISSUER,
      scopes: "openid email profile",
      tokenAuthMethod: "client_secret_post",
    });
  }

  return out;
}

export function buildAuthProvidersFromResolved(
  resolved: ResolvedAuthProvider[],
): NextAuthConfig["providers"] {
  return resolved.map((row) => {
    const linkSameEmail = { allowDangerousEmailAccountLinking: true as const };
    return {
      id: row.id,
      name: row.name,
      type: "oidc" as const,
      issuer: row.issuer,
      clientId: row.clientId,
      clientSecret: row.clientSecret,
      ...linkSameEmail,
      authorization: {
        params: {
          scope: row.scopes || "openid email profile",
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
  });
}

/** @deprecated Prefer resolveEnvAuthProviders + DB. */
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
