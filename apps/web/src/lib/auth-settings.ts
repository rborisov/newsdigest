import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/connection-secrets";
import {
  authCallbackUrl,
  buildAuthProvidersFromResolved,
  DEFAULT_OIDC_PROVIDER_ID,
  normalizeIssuer,
  publicAuthBaseUrl,
  resolveEnvAuthProviders,
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
      create: { id },
    });
  }
}

function decryptClientSecret(enc: string): string {
  const trimmed = enc.trim();
  if (!trimmed) return "";
  try {
    return decryptSecret(trimmed);
  } catch {
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
  if (!decryptClientSecret(row.clientSecretEnc)) return false;
  if (row.id === "oidc" && !normalizeIssuer(row.issuer)) return false;
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

  const providerId =
    kind === "oidc"
      ? row.providerId.trim() || DEFAULT_OIDC_PROVIDER_ID
      : kind;
  const displayName =
    row.displayName.trim() ||
    (kind === "oidc" ? "OIDC" : kind === "google" ? "Google" : "Yandex");

  return {
    id: kind,
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecretConfigured: Boolean(row.clientSecretEnc.trim()),
    issuer: row.issuer,
    providerId,
    displayName,
    callbackUrl: authCallbackUrl(publicAuthBaseUrl(), providerId),
  };
}

export async function listPublicAuthProviderRows(): Promise<AuthProviderPublicRow[]> {
  await ensureAuthProviderRows();
  const rows = await prisma.authProvider.findMany({
    orderBy: { id: "asc" },
  });
  return rows
    .map(toPublicAuthProviderRow)
    .filter((row): row is AuthProviderPublicRow => row !== null);
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
    const secret = decryptClientSecret(row.clientSecretEnc);
    if (kind === "oidc") {
      out.push({
        kind: "oidc",
        id: row.providerId.trim() || DEFAULT_OIDC_PROVIDER_ID,
        name: row.displayName.trim() || "OIDC",
        clientId: row.clientId.trim(),
        clientSecret: secret,
        issuer: normalizeIssuer(row.issuer),
        scopes: "openid email profile",
        tokenAuthMethod: "client_secret_post",
      });
      continue;
    }
    out.push({
      kind,
      id: kind,
      name: row.displayName.trim() || (kind === "google" ? "Google" : "Yandex"),
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
    const id = patch.providerId.trim() || DEFAULT_OIDC_PROVIDER_ID;
    if (!/^[a-z0-9_-]+$/i.test(id)) {
      throw new Error("providerId must be alphanumeric (plus _ -).");
    }
    data.providerId = id;
  }
  if (patch.displayName !== undefined) {
    data.displayName = patch.displayName.trim();
  }

  if (patch.id === "oidc") {
    const nextEnabled = data.enabled ?? existing.enabled;
    const nextIssuer = data.issuer ?? existing.issuer;
    if (nextEnabled && !normalizeIssuer(nextIssuer)) {
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
