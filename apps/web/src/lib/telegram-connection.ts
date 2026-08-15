import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { computeCheck } from "teleproto/Password";
import { LogLevel } from "teleproto/extensions/Logger";

import { decryptSecret, encryptSecret } from "@/lib/connection-secrets";
import { prisma } from "@/lib/db";

export const TELEGRAM_PROVIDER = "telegram";

export type ConnectionStatus = "linked" | "linking" | "error" | "disconnected";

export type TelegramLinkStep = "awaiting_code" | "awaiting_password";

type TelegramLinkState = {
  phone: string;
  phoneCodeHash: string;
  session: string;
  step: TelegramLinkStep;
  isCodeViaApp?: boolean;
  passwordHint?: string;
};

export type PublicSocialConnection = {
  provider: string;
  status: ConnectionStatus;
  displayName: string;
  externalId: string;
  lastError: string | null;
  linkedAt: string | null;
  linkStep: TelegramLinkStep | null;
  isCodeViaApp: boolean | null;
  passwordHint: string | null;
};

export type TelegramApiConfig = {
  apiId: number;
  apiHash: string;
};

/** Normalize international phone: digits with leading +. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (!digits) {
    throw new Error("Phone number is required.");
  }
  const withPlus = digits.startsWith("+") ? digits : `+${digits.replace(/^\+/, "")}`;
  const only = `+${withPlus.replace(/\D/g, "")}`;
  if (only.length < 8) {
    throw new Error("Phone number looks too short.");
  }
  return only;
}

export function formatTelegramDisplayName(user: {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  id?: { toString(): string } | number | bigint | null;
}): string {
  const username = user.username?.trim();
  if (username) {
    return username.startsWith("@") ? username : `@${username}`;
  }
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.id != null) return `id:${String(user.id)}`;
  return "Telegram user";
}

export function resolveTelegramApiConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): TelegramApiConfig | null {
  const apiIdRaw = env.TELEGRAM_API_ID?.trim();
  const apiHash = env.TELEGRAM_API_HASH?.trim();
  if (!apiIdRaw || !apiHash) return null;
  const apiId = Number(apiIdRaw);
  if (!Number.isFinite(apiId) || apiId <= 0) return null;
  return { apiId, apiHash };
}

function parseLinkState(enc: string): TelegramLinkState | null {
  if (!enc.trim()) return null;
  try {
    const raw = JSON.parse(decryptSecret(enc)) as TelegramLinkState;
    if (!raw.phone || !raw.phoneCodeHash || !raw.session || !raw.step) return null;
    return raw;
  } catch {
    return null;
  }
}

export function toPublicConnection(row: {
  provider: string;
  status: string;
  displayName: string;
  externalId: string;
  lastError: string | null;
  linkedAt: Date | null;
  linkStateEnc: string;
}): PublicSocialConnection {
  const link = parseLinkState(row.linkStateEnc);
  return {
    provider: row.provider,
    status: (row.status as ConnectionStatus) || "disconnected",
    displayName: row.displayName,
    externalId: row.externalId,
    lastError: row.lastError,
    linkedAt: row.linkedAt ? row.linkedAt.toISOString() : null,
    linkStep: link?.step ?? null,
    isCodeViaApp: link?.isCodeViaApp ?? null,
    passwordHint: link?.passwordHint ?? null,
  };
}

function rpcMessage(err: unknown): string {
  if (err && typeof err === "object" && "errorMessage" in err) {
    const msg = (err as { errorMessage?: string }).errorMessage;
    if (msg) return msg;
  }
  if (err instanceof Error) return err.message;
  return "Telegram request failed.";
}

async function createClient(sessionString: string, cfg: TelegramApiConfig): Promise<TelegramClient> {
  const client = new TelegramClient(new StringSession(sessionString), cfg.apiId, cfg.apiHash, {
    connectionRetries: 3,
  });
  client.setLogLevel(LogLevel.NONE);
  await client.connect();
  return client;
}

function sessionStringOf(client: TelegramClient): string {
  return String(client.session.save());
}

async function upsertTelegramRow(
  data: {
    status: ConnectionStatus;
    displayName?: string;
    externalId?: string;
    sessionEnc?: string;
    linkStateEnc?: string;
    lastError?: string | null;
    linkedAt?: Date | null;
    linkedBy?: string;
  },
) {
  return prisma.socialConnection.upsert({
    where: { provider: TELEGRAM_PROVIDER },
    create: {
      provider: TELEGRAM_PROVIDER,
      status: data.status,
      displayName: data.displayName ?? "",
      externalId: data.externalId ?? "",
      sessionEnc: data.sessionEnc ?? "",
      linkStateEnc: data.linkStateEnc ?? "",
      lastError: data.lastError ?? null,
      linkedAt: data.linkedAt ?? null,
      linkedBy: data.linkedBy ?? "",
    },
    update: {
      status: data.status,
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.externalId !== undefined ? { externalId: data.externalId } : {}),
      ...(data.sessionEnc !== undefined ? { sessionEnc: data.sessionEnc } : {}),
      ...(data.linkStateEnc !== undefined ? { linkStateEnc: data.linkStateEnc } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
      ...(data.linkedAt !== undefined ? { linkedAt: data.linkedAt } : {}),
      ...(data.linkedBy !== undefined ? { linkedBy: data.linkedBy } : {}),
    },
  });
}

export async function getTelegramConnectionPublic(): Promise<{
  connection: PublicSocialConnection;
  telegramApiConfigured: boolean;
}> {
  const cfg = resolveTelegramApiConfig();
  const row = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  if (!row) {
    return {
      telegramApiConfigured: Boolean(cfg),
      connection: {
        provider: TELEGRAM_PROVIDER,
        status: "disconnected",
        displayName: "",
        externalId: "",
        lastError: null,
        linkedAt: null,
        linkStep: null,
        isCodeViaApp: null,
        passwordHint: null,
      },
    };
  }
  return {
    telegramApiConfigured: Boolean(cfg),
    connection: toPublicConnection(row),
  };
}

export async function startTelegramLink(phoneRaw: string, linkedBy: string): Promise<PublicSocialConnection> {
  const cfg = resolveTelegramApiConfig();
  if (!cfg) {
    throw new Error(
      "TELEGRAM_API_ID and TELEGRAM_API_HASH are not configured (get them at https://my.telegram.org).",
    );
  }
  const existing = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  if (existing?.status === "linked" && existing.sessionEnc.trim()) {
    throw new Error("Telegram is already linked. Disconnect it before linking another account.");
  }
  const phone = normalizePhone(phoneRaw);
  let client: TelegramClient | null = null;
  try {
    client = await createClient("", cfg);
    const sent = await client.sendCode(
      { apiId: cfg.apiId, apiHash: cfg.apiHash },
      phone,
      false,
    );
    const state: TelegramLinkState = {
      phone,
      phoneCodeHash: sent.phoneCodeHash,
      session: sessionStringOf(client),
      step: "awaiting_code",
      isCodeViaApp: sent.isCodeViaApp,
    };
    const row = await upsertTelegramRow({
      status: "linking",
      displayName: "",
      externalId: "",
      sessionEnc: "",
      linkStateEnc: encryptSecret(JSON.stringify(state)),
      lastError: null,
      linkedAt: null,
      linkedBy,
    });
    return toPublicConnection(row);
  } catch (err) {
    const message = rpcMessage(err);
    // Preserve "already linked" validation errors without wiping state.
    if (message.includes("already linked")) {
      throw err instanceof Error ? err : new Error(message);
    }
    await upsertTelegramRow({
      status: "error",
      linkStateEnc: "",
      sessionEnc: "",
      lastError: message,
      linkedBy,
    });
    throw new Error(message);
  } finally {
    if (client) {
      await client.disconnect().catch(() => undefined);
    }
  }
}

export async function submitTelegramCode(codeRaw: string): Promise<PublicSocialConnection> {
  const cfg = resolveTelegramApiConfig();
  if (!cfg) {
    throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH are not configured.");
  }
  const code = codeRaw.trim().replace(/\s+/g, "");
  if (!code) {
    throw new Error("Login code is required.");
  }

  const existing = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  if (!existing || existing.status !== "linking") {
    throw new Error("No Telegram link in progress. Start again with your phone number.");
  }
  const state = parseLinkState(existing.linkStateEnc);
  if (!state || state.step !== "awaiting_code") {
    throw new Error("Waiting for a different step. Refresh and try again.");
  }

  let client: TelegramClient | null = null;
  try {
    client = await createClient(state.session, cfg);
    try {
      const result = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: state.phone,
          phoneCodeHash: state.phoneCodeHash,
          phoneCode: code,
        }),
      );
      if (result instanceof Api.auth.AuthorizationSignUpRequired) {
        throw new Error("This phone is not registered on Telegram. Register in the Telegram app first.");
      }
      return await finalizeLinked(client, existing.linkedBy);
    } catch (err) {
      if (rpcMessage(err) === "SESSION_PASSWORD_NEEDED") {
        const next: TelegramLinkState = {
          ...state,
          session: sessionStringOf(client),
          step: "awaiting_password",
        };
        try {
          const pwd = await client.invoke(new Api.account.GetPassword());
          next.passwordHint = pwd.hint ?? undefined;
        } catch {
          // hint is optional
        }
        const row = await upsertTelegramRow({
          status: "linking",
          linkStateEnc: encryptSecret(JSON.stringify(next)),
          lastError: null,
        });
        return toPublicConnection(row);
      }
      throw err;
    }
  } catch (err) {
    const message = rpcMessage(err);
    await upsertTelegramRow({
      status: "error",
      lastError: message,
    });
    throw new Error(message);
  } finally {
    if (client) {
      await client.disconnect().catch(() => undefined);
    }
  }
}

export async function submitTelegramPassword(passwordRaw: string): Promise<PublicSocialConnection> {
  const cfg = resolveTelegramApiConfig();
  if (!cfg) {
    throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH are not configured.");
  }
  const password = passwordRaw; // do not trim aggressively; passwords may have spaces
  if (!password) {
    throw new Error("2FA password is required.");
  }

  const existing = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  if (!existing || existing.status !== "linking") {
    throw new Error("No Telegram link in progress. Start again with your phone number.");
  }
  const state = parseLinkState(existing.linkStateEnc);
  if (!state || state.step !== "awaiting_password") {
    throw new Error("Waiting for a different step. Refresh and try again.");
  }

  let client: TelegramClient | null = null;
  try {
    client = await createClient(state.session, cfg);
    const passwordSrp = await client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(passwordSrp, password);
    await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));
    return await finalizeLinked(client, existing.linkedBy);
  } catch (err) {
    const message = rpcMessage(err);
    await upsertTelegramRow({
      status: "error",
      lastError: message,
    });
    throw new Error(message);
  } finally {
    if (client) {
      await client.disconnect().catch(() => undefined);
    }
  }
}

async function finalizeLinked(client: TelegramClient, linkedBy: string): Promise<PublicSocialConnection> {
  const me = await client.getMe();
  if (!me || typeof me !== "object" || !("id" in me)) {
    throw new Error("Telegram login succeeded but profile could not be read.");
  }
  const user = me as {
    id: { toString(): string };
    username?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
  const sessionEnc = encryptSecret(sessionStringOf(client));
  const row = await upsertTelegramRow({
    status: "linked",
    displayName: formatTelegramDisplayName(user),
    externalId: String(user.id),
    sessionEnc,
    linkStateEnc: "",
    lastError: null,
    linkedAt: new Date(),
    linkedBy,
  });
  return toPublicConnection(row);
}

export async function cancelTelegramLink(): Promise<PublicSocialConnection> {
  const existing = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  if (!existing) {
    return (await getTelegramConnectionPublic()).connection;
  }
  const keepLinked = existing.status === "linked" && existing.sessionEnc.trim().length > 0;
  const row = await upsertTelegramRow({
    status: keepLinked ? "linked" : "disconnected",
    linkStateEnc: "",
    lastError: null,
    ...(keepLinked
      ? {}
      : {
          displayName: "",
          externalId: "",
          sessionEnc: "",
          linkedAt: null,
        }),
  });
  return toPublicConnection(row);
}

export async function disconnectTelegram(): Promise<PublicSocialConnection> {
  const existing = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  const cfg = resolveTelegramApiConfig();
  if (existing?.sessionEnc.trim() && cfg) {
    let client: TelegramClient | null = null;
    try {
      const session = decryptSecret(existing.sessionEnc);
      client = await createClient(session, cfg);
      await client.invoke(new Api.auth.LogOut());
    } catch {
      // Best-effort remote logout; always clear local session.
    } finally {
      if (client) {
        await client.disconnect().catch(() => undefined);
      }
    }
  }
  const row = await upsertTelegramRow({
    status: "disconnected",
    displayName: "",
    externalId: "",
    sessionEnc: "",
    linkStateEnc: "",
    lastError: null,
    linkedAt: null,
    linkedBy: "",
  });
  return toPublicConnection(row);
}

/** Decrypt stored session for ingest (Phase 2+). Returns null if not linked. */
export async function getLinkedTelegramSessionString(): Promise<string | null> {
  const row = await prisma.socialConnection.findUnique({ where: { provider: TELEGRAM_PROVIDER } });
  if (!row || row.status !== "linked" || !row.sessionEnc.trim()) return null;
  return decryptSecret(row.sessionEnc);
}
