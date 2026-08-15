import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "@/lib/db";
import { resolveSchedulePeriodHours } from "@/lib/prompt";
import { collectTelegramSourceMessages } from "@/lib/telegram-ingest";

export type SyncTopicIngestResult = {
  topicId: string;
  periodHours: number;
  sources: Array<{
    topicSourceId: string;
    kind: string;
    fetched: number;
    kept: number;
    error: string | null;
  }>;
  keptTotal: number;
};

async function resolveTopicPeriodHours(topicId: string, client: PrismaClient): Promise<number> {
  const [topic, promptConfig] = await Promise.all([
    client.topic.findUnique({
      where: { id: topicId },
      select: { scheduleId: true },
    }),
    client.promptConfig.findUnique({
      where: { id: "default" },
      select: { periodHours: true },
    }),
  ]);
  const defaultPeriod = promptConfig?.periodHours ?? 24;
  if (!topic) return defaultPeriod;
  const schedule = topic.scheduleId
    ? await client.schedule.findUnique({
        where: { id: topic.scheduleId },
        select: { periodHours: true },
      })
    : await client.schedule.findFirst({
        where: { isDefault: true },
        select: { periodHours: true },
      });
  return resolveSchedulePeriodHours(schedule, defaultPeriod);
}

/**
 * Sync enabled telegram TopicSources for a topic into IngestItem rows.
 * Web sources are agent-browsed; no row fetch here.
 */
export async function syncTopicIngest(
  topicId: string,
  deps: { prisma?: PrismaClient; now?: Date } = {},
): Promise<SyncTopicIngestResult> {
  const client = deps.prisma ?? defaultPrisma;
  const now = deps.now ?? new Date();
  const periodHours = await resolveTopicPeriodHours(topicId, client);

  const sources = await client.topicSource.findMany({
    where: { topicId, enabled: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const result: SyncTopicIngestResult = {
    topicId,
    periodHours,
    sources: [],
    keptTotal: 0,
  };

  for (const source of sources) {
    if (source.kind !== "telegram") {
      result.sources.push({
        topicSourceId: source.id,
        kind: source.kind,
        fetched: 0,
        kept: 0,
        error: null,
      });
      continue;
    }

    try {
      const messages = await collectTelegramSourceMessages({
        configJson: source.configJson,
        periodHours,
        now,
      });

      await client.$transaction(async (tx) => {
        await tx.ingestItem.deleteMany({ where: { topicSourceId: source.id } });
        if (messages.length > 0) {
          await tx.ingestItem.createMany({
            data: messages.map((message) => ({
              topicId,
              topicSourceId: source.id,
              kind: "telegram",
              externalId: message.externalId,
              url: message.url,
              title: message.title,
              text: message.text,
              publishedAt: message.publishedAt,
              quality: message.quality,
              rawJson: message.rawJson,
            })),
          });
        }
        await tx.topicSource.update({
          where: { id: source.id },
          data: { lastSyncAt: now, lastError: null },
        });
      });

      const kept = messages.filter((message) => message.quality === "kept").length;
      result.keptTotal += kept;
      result.sources.push({
        topicSourceId: source.id,
        kind: "telegram",
        fetched: messages.length,
        kept,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Telegram sync failed.";
      await client.topicSource.update({
        where: { id: source.id },
        data: { lastError: message },
      });
      result.sources.push({
        topicSourceId: source.id,
        kind: "telegram",
        fetched: 0,
        kept: 0,
        error: message,
      });
    }
  }

  return result;
}

/** Format kept telegram ingest for the digest agent prompt. */
export async function formatKeptIngestForPrompt(
  topicId: string,
  deps: { prisma?: PrismaClient; maxItems?: number; maxChars?: number } = {},
): Promise<string> {
  const client = deps.prisma ?? defaultPrisma;
  const maxItems = deps.maxItems ?? 40;
  const maxChars = deps.maxChars ?? 12_000;

  const rows = await client.ingestItem.findMany({
    where: { topicId, quality: "kept", kind: "telegram" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: maxItems,
    select: {
      text: true,
      url: true,
      publishedAt: true,
      externalId: true,
    },
  });

  if (rows.length === 0) {
    return "";
  }

  const lines: string[] = [
    "COMBINED_SOURCES — use BOTH web research (keywords above) AND the Telegram messages below.",
    "Attribute Telegram lines as Telegram @peer (with link when present). Prefer concrete facts; ignore ads/fluff already filtered out.",
    "TELEGRAM_INGEST (kept messages from the linked account; do not invent chats):",
  ];
  let used = lines.join("\n").length;
  for (const row of rows) {
    const peer = row.externalId.split(":")[0] ?? "unknown";
    const when = row.publishedAt ? row.publishedAt.toISOString().slice(0, 16) : "unknown-time";
    const text = row.text.trim().replace(/\s+/g, " ").slice(0, 500);
    if (!text) continue;
    const line = `- [@${peer} ${when}] ${text}${row.url ? ` (${row.url})` : ""}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }

  if (lines.length <= 1) return "";
  return lines.join("\n");
}

export function summarizeSyncForLog(result: SyncTopicIngestResult): string {
  const parts = result.sources.map((source) => {
    if (source.kind !== "telegram") return `${source.kind}:skip`;
    if (source.error) return `telegram:error`;
    return `telegram:fetched=${source.fetched},kept=${source.kept}`;
  });
  return `ingest sync period=${result.periodHours}h keptTotal=${result.keptTotal} [${parts.join("; ")}]`;
}
