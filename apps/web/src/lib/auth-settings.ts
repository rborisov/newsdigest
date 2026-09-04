import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/connection-secrets";
import {
  authCallbackUrl,
  buildAuthProvidersFromResolved,
  defaultDisplayNameForKind,
  defaultProviderIdForKind,
  effectiveProviderId,
  isOidcStyleKind,
  normalizeIssuer,
  publicAuthBaseUrl,
  resolveEnvAuthProviders,
  resolveIssuerForKind,
  type AuthProviderKind,
  type ResolvedAuthProvider,
} from "@/lib/auth-providers";
import type { NextAuthConfig } from "next-auth";

export const AUTH_PROVIDER_KINDS: AuthProviderKind[] = ["oidc", "google", "yandex"];

export type AuthProviderPublicRow = {
  id: AuthProviderKind;
  enabled: boolean;
  clientId: string;
  clientSecretConfigured: boolean;
  /** True when ciphertext exists but cannot be decrypted (e.g. CONNECTIONS_SECRET rotated). */
  clientSecretUnreadable: boolean;
  issuer: string;
  providerId: string;
  displayName: string;
  callbackUrl: string;
};

function asKind(id: string): AuthProviderKind | null {
  if (id === "oidc" || id === "google" || id === "yandex") return id;
  return null;
}

export async function ensureAuthProviderRows(): Promise<void> {
  for (const id of AUTH_PROVIDER_KINDS) {
    await prisma.authProvider.upsert({
      where: { id },
      update: {},
      create: { id, providerId: defaultProviderIdForKind(id) },
    });
  }
}

function decryptClientSecret(enc: string, providerId?: string): string {
  const trimmed = enc.trim();
  if (!trimmed) return "";
  try {
    return decryptSecret(trimmed);
  } catch {
    console.warn(
      `[auth] Failed to decrypt AuthProvider secret${providerId ? ` for ${providerId}` : ""}. ` +
        "Check CONNECTIONS_SECRET / NEXTAUTH_SECRET were not rotated; re-enter the client secret in Admin → Sign-in.",
    );
    return "";
  }
}

function rowConfigured(row: {
  id: string;
  enabled: boolean;
  clientId: string;
  clientSecretEnc: string;
  issuer: string;
}): boolean {
  if (!row.enabled) return false;
  if (!row.clientId.trim()) return false;
  if (!decryptClientSecret(row.clientSecretEnc, row.id)) return false;
  const kind = asKind(row.id);
  if (!kind) return false;
  if (isOidcStyleKind(kind) && !resolveIssuerForKind(kind, row.issuer)) return false;
  return true;
}

/** True when Admin has at least one enabled+configured provider in the DB. */
export async function hasDatabaseAuthConfigured(): Promise<boolean> {
  await ensureAuthProviderRows();
  const rows = await prisma.authProvider.findMany();
  return rows.some(rowConfigured);
}

export function toPublicAuthProviderRow(row: {
  id: string;
  enabled: boolean;
  clientId: string;
  clientSecretEnc: string;
  issuer: string;
  providerId: string;
  displayName: string;
}): AuthProviderPublicRow | null {
  const kind = asKind(row.id);
  if (!kind) return null;

  const providerId = effectiveProviderId(kind, row.providerId);
  const displayName = row.displayName.trim() || defaultDisplayNameForKind(kind);
  // Show effective issuer for OIDC-style slots (Google defaults when blank).
  const issuer = isOidcStyleKind(kind)
    ? resolveIssuerForKind(kind, row.issuer)
    : row.issuer;

  const hasCiphertext = Boolean(row.clientSecretEnc.trim());
  const decrypted = hasCiphertext ? decryptClientSecret(row.clientSecretEnc, kind) : "";
  return {
    id: kind,
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecretConfigured: hasCiphertext,
    clientSecretUnreadable: hasCiphertext && !decrypted,
    issuer,
    providerId,
    displayName,
    callbackUrl: authCallbackUrl(publicAuthBaseUrl(), providerId),
  };
}

export async function listPublicAuthProviderRows(): Promise<AuthProviderPublicRow[]> {
  await ensureAuthProviderRows();
  const rows = await prisma.authProvider.findMany();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return AUTH_PROVIDER_KINDS.map((id) => {
    const row = byId.get(id);
    return row ? toPublicAuthProviderRow(row) : null;
  }).filter((row): row is AuthProviderPublicRow => row !== null);
}

function dbRowsToResolved(
  rows: {
    id: string;
    enabled: boolean;
    clientId: string;
    clientSecretEnc: string;
    issuer: string;
    providerId: string;
    displayName: string;
  }[],
): ResolvedAuthProvider[] {
  const out: ResolvedAuthProvider[] = [];
  for (const row of rows) {
    if (!rowConfigured(row)) continue;
    const kind = asKind(row.id);
    if (!kind) continue;
    const secret = decryptClientSecret(row.clientSecretEnc, row.id);
    if (isOidcStyleKind(kind)) {
      out.push({
        kind,
        id: effectiveProviderId(kind, row.providerId),
        name: row.displayName.trim() || defaultDisplayNameForKind(kind),
        clientId: row.clientId.trim(),
        clientSecret: secret,
        issuer: resolveIssuerForKind(kind, row.issuer),
        scopes: "openid email profile",
        tokenAuthMethod: "client_secret_post",
      });
      continue;
    }
    out.push({
      kind: "yandex",
      id: effectiveProviderId("yandex", row.providerId),
      name: row.displayName.trim() || "Yandex",
      clientId: row.clientId.trim(),
      clientSecret: secret,
    });
  }
  return out;
}

/**
 * Resolve active providers: DB wins when any enabled+configured row exists;
 * otherwise fall back to env bootstrap.
 */
export async function resolveActiveAuthProviders(): Promise<ResolvedAuthProvider[]> {
  await ensureAuthProviderRows();
  const rows = await prisma.authProvider.findMany();
  const fromDb = dbRowsToResolved(rows);
  if (fromDb.length > 0) {
    return fromDb;
  }
  return resolveEnvAuthProviders();
}

export async function loadAuthProviders(): Promise<NextAuthConfig["providers"]> {
  return buildAuthProvidersFromResolved(await resolveActiveAuthProviders());
}

/** Sign-in page buttons (id + label only). */
export async function listSignInButtons(): Promise<{ id: string; name: string }[]> {
  const providers = await resolveActiveAuthProviders();
  return providers.map((p) => ({ id: p.id, name: p.name }));
}

export type AuthProviderPatch = {
  id: AuthProviderKind;
  enabled?: boolean;
  clientId?: string;
  /** Empty / omitted = keep existing secret. Non-empty = replace. */
  clientSecret?: string;
  issuer?: string;
  providerId?: string;
  displayName?: string;
};

export async function patchAuthProvider(
  patch: AuthProviderPatch,
): Promise<AuthProviderPublicRow> {
  await ensureAuthProviderRows();
  const existing = await prisma.authProvider.findUnique({ where: { id: patch.id } });
  if (!existing) {
    throw new Error("Auth provider not found.");
  }

  const data: {
    enabled?: boolean;
    clientId?: string;
    clientSecretEnc?: string;
    issuer?: string;
    providerId?: string;
    displayName?: string;
  } = {};

  if (patch.enabled !== undefined) {
    data.enabled = Boolean(patch.enabled);
  }
  if (patch.clientId !== undefined) {
    data.clientId = patch.clientId.trim();
  }
  if (patch.clientSecret !== undefined && patch.clientSecret.trim()) {
    data.clientSecretEnc = encryptSecret(patch.clientSecret.trim());
  }
  if (patch.issuer !== undefined) {
    data.issuer = normalizeIssuer(patch.issuer);
  }
  if (patch.providerId !== undefined) {
    const id = effectiveProviderId(patch.id, patch.providerId);
    if (!/^[a-z0-9_-]+$/i.test(id)) {
      throw new Error("providerId must be alphanumeric (plus _ -).");
    }
    data.providerId = id;
  }
  if (patch.displayName !== undefined) {
    data.displayName = patch.displayName.trim();
  }

  if (isOidcStyleKind(patch.id)) {
    const nextEnabled = data.enabled ?? existing.enabled;
    const nextIssuer = resolveIssuerForKind(
      patch.id,
      data.issuer ?? existing.issuer,
    );
    if (nextEnabled && !nextIssuer) {
      throw new Error("OIDC issuer URL is required when enabled.");
    }
  }

  const updated = await prisma.authProvider.update({
    where: { id: patch.id },
    data,
  });
  const publicRow = toPublicAuthProviderRow(updated);
  if (!publicRow) {
    throw new Error("Invalid provider.");
  }
  return publicRow;
}
