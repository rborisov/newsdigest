import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Prefer dedicated CONNECTIONS_SECRET; fall back to NEXTAUTH_SECRET / AUTH_SECRET. */
export function resolveConnectionsSecret(): string {
  const dedicated = process.env.CONNECTIONS_SECRET?.trim();
  if (dedicated) return dedicated;
  const nextAuth = process.env.NEXTAUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (nextAuth) return nextAuth;
  throw new Error(
    "CONNECTIONS_SECRET (or NEXTAUTH_SECRET) is required to store linked social sessions.",
  );
}

/** Encrypt a UTF-8 secret for DB storage (AES-256-GCM). */
export function encryptSecret(plain: string, secret = resolveConnectionsSecret()): string {
  const iv = randomBytes(12);
  const key = keyFromSecret(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(
    ".",
  );
}

/** Decrypt a value produced by encryptSecret. */
export function decryptSecret(payload: string, secret = resolveConnectionsSecret()): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Invalid encrypted secret payload.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, "base64url");
  const tag = Buffer.from(tagB64!, "base64url");
  const data = Buffer.from(dataB64!, "base64url");
  const key = keyFromSecret(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
