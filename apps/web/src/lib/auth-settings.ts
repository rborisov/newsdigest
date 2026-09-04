import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/connection-secrets";
import {
  assertValidProviderId,
  authCallbackUrl,
  buildAuthProvidersFromResolved,
  normalizeIssuer,
  publicAuthBaseUrl,
  resolveEnvAuthProviders,
  resolveOidcIssuer,
  type ResolvedAuthProvider,
} from "@/lib/auth-providers";
import type { NextAuthConfig } from "next-auth";

export type AuthProviderPublicRow = {
  /** Auth.js provider id / DB primary key. */
  id: string;
  enabled: boolean;
  clientId: string;
  clientSecretConfigured: boolean;
  /** True when ciphertext exists but cannot be decrypted (e.g. CONNECTIONS_SECRET rotated). */
  clientSecretUnreadable: boolean;
  issuer: string;
  displayName: string;
  sortOrder: number;
  callbackUrl: string;
};

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
  if (!resolveOidcIssuer(row.id, row.issuer)) return false;
  return true;
}

/**
 * One-time cleanup: drop legacy non-OIDC Yandex slot; backfill Google issuer.
 * Dynamic OIDC rows use `id` as the Auth.js callback segment.
 */
export async function migrateAuthProviderRows(): Promise<void> {
  const yandex = await prisma.authProvider.findUnique({ where: { id: "yandex" } });
  if (yandex && !normalizeIssuer(yandex.issuer)) {
    await prisma.authProvider.delete({ where: { id: "yandex" } });
  }

  const google = await prisma.authProvider.findUnique({ where: { id: "google" } });
  if (google && !normalizeIssuer(google.issuer) && google.clientId.trim()) {
    await prisma.authProvider.update({
      where: { id: "google" },
      data: { issuer: resolveOidcIssuer("google", "") },
    });
  }
}

/** @deprecated Use migrateAuthProviderRows — no fixed slots anymore. */
export async function ensureAuthProviderRows(): Promise<void> {
  await migrateAuthProviderRows();
}

/** True when Admin has at least one enabled+configured provider in the DB. */
export async function hasDatabaseAuthConfigured(): Promise<boolean> {
  await migrateAuthProviderRows();
  const rows = await prisma.authProvider.findMany();
  return rows.some(rowConfigured);
}

export function toPublicAuthProviderRow(row: {
  id: string;
  enabled: boolean;
  clientId: string;
  clientSecretEnc: string;
  issuer: string;
  displayName: string;
  sortOrder?: number;
}): AuthProviderPublicRow {
  const issuer = resolveOidcIssuer(row.id, row.issuer);
  const hasCiphertext = Boolean(row.clientSecretEnc.trim());
  const decrypted = hasCiphertext ? decryptClientSecret(row.clientSecretEnc, row.id) : "";
  return {
    id: row.id,
    enabled: row.enabled,
    clientId: row.clientId,
    clientSecretConfigured: hasCiphertext,
    clientSecretUnreadable: hasCiphertext && !decrypted,
    issuer,
    displayName: row.displayName.trim() || row.id,
    sortOrder: row.sortOrder ?? 0,
    callbackUrl: authCallbackUrl(publicAuthBaseUrl(), row.id),
  };
}

export async function listPublicAuthProviderRows(): Promise<AuthProviderPublicRow[]> {
  await migrateAuthProviderRows();
  const rows = await prisma.authProvider.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return rows.map(toPublicAuthProviderRow);
}

function dbRowsToResolved(
  rows: {
    id: string;
    enabled: boolean;
    clientId: string;
    clientSecretEnc: string;
    issuer: string;
    displayName: string;
  }[],
): ResolvedAuthProvider[] {
  const out: ResolvedAuthProvider[] = [];
  for (const row of rows) {
    if (!rowConfigured(row)) continue;
    const secret = decryptClientSecret(row.clientSecretEnc, row.id);
    const issuer = resolveOidcIssuer(row.id, row.issuer);
    out.push({
      id: row.id,
      name: row.displayName.trim() || row.id,
      clientId: row.clientId.trim(),
      clientSecret: secret,
      issuer,
      scopes: "openid email profile",
      tokenAuthMethod: "client_secret_post",
    });
  }
  return out;
}

/**
 * Resolve active providers: DB wins when any enabled+configured row exists;
 * otherwise fall back to env bootstrap.
 */
export async function resolveActiveAuthProviders(): Promise<ResolvedAuthProvider[]> {
  await migrateAuthProviderRows();
  const rows = await prisma.authProvider.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
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

export type AuthProviderInput = {
  /** Auth.js provider id (callback segment). Required. */
  id: string;
  enabled?: boolean;
  clientId?: string;
  /** Empty / omitted = keep existing secret when updating. */
  clientSecret?: string;
  issuer?: string;
  displayName?: string;
  sortOrder?: number;
};

/**
 * Replace the full OIDC issuer list from Admin.
 * - Creates / updates by `id`
 * - Deletes rows not present in the payload
 * - Empty clientSecret keeps the previous ciphertext
 */
export async function replaceAuthProviders(
  inputs: AuthProviderInput[],
): Promise<AuthProviderPublicRow[]> {
  await migrateAuthProviderRows();

  if (!Array.isArray(inputs)) {
    throw new Error("providers array is required.");
  }

  const normalized = inputs.map((input, index) => {
    const id = assertValidProviderId(input.id);
    const issuer = resolveOidcIssuer(id, input.issuer ?? "");
    const enabled = Boolean(input.enabled);
    if (enabled && !issuer) {
      throw new Error(`Issuer URL is required when enabling “${id}”.`);
    }
    if (enabled && !(input.clientId ?? "").trim()) {
      throw new Error(`Client ID is required when enabling “${id}”.`);
    }
    return {
      id,
      enabled,
      clientId: (input.clientId ?? "").trim(),
      clientSecret: input.clientSecret,
      issuer,
      displayName: (input.displayName ?? "").trim() || id,
      sortOrder: input.sortOrder ?? index,
    };
  });

  const ids = normalized.map((row) => row.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate provider ids are not allowed.");
  }

  const existing = await prisma.authProvider.findMany();
  const existingById = new Map(existing.map((row) => [row.id, row]));

  for (const row of normalized) {
    const prev = existingById.get(row.id);
    let clientSecretEnc = prev?.clientSecretEnc ?? "";
    if (row.clientSecret !== undefined && row.clientSecret.trim()) {
      clientSecretEnc = encryptSecret(row.clientSecret.trim());
    }
    if (row.enabled && !decryptClientSecret(clientSecretEnc, row.id)) {
      throw new Error(`Client secret is required when enabling “${row.id}”.`);
    }

    await prisma.authProvider.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        enabled: row.enabled,
        clientId: row.clientId,
        clientSecretEnc,
        issuer: row.issuer,
        providerId: row.id,
        displayName: row.displayName,
        sortOrder: row.sortOrder,
      },
      update: {
        enabled: row.enabled,
        clientId: row.clientId,
        clientSecretEnc,
        issuer: row.issuer,
        providerId: row.id,
        displayName: row.displayName,
        sortOrder: row.sortOrder,
      },
    });
  }

  const keep = new Set(ids);
  const toDelete = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (toDelete.length > 0) {
    await prisma.authProvider.deleteMany({ where: { id: { in: toDelete } } });
  }

  return listPublicAuthProviderRows();
}

/** @deprecated Prefer replaceAuthProviders. */
export type AuthProviderPatch = AuthProviderInput;

/** @deprecated Prefer replaceAuthProviders. */
export async function patchAuthProvider(
  patch: AuthProviderInput,
): Promise<AuthProviderPublicRow> {
  const existing = await listPublicAuthProviderRows();
  const others = existing.filter((row) => row.id !== patch.id);
  const merged: AuthProviderInput[] = [
    ...others.map((row) => ({
      id: row.id,
      enabled: row.enabled,
      clientId: row.clientId,
      issuer: row.issuer,
      displayName: row.displayName,
      sortOrder: row.sortOrder,
    })),
    patch,
  ];
  const updated = await replaceAuthProviders(merged);
  const row = updated.find((item) => item.id === patch.id);
  if (!row) {
    throw new Error("Provider not found after save.");
  }
  return row;
}
