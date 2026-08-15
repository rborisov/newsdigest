import { classifyIngestText, type IngestQuality } from "@/lib/ingest-filter";
import { parseSourceConfigJson, type TelegramSourceConfig } from "@/lib/topic-sources";
import { withLinkedTelegramClient } from "@/lib/telegram-connection";

export type CollectedTelegramMessage = {
  peer: string;
  externalId: string;
  url: string | null;
  title: string | null;
  text: string;
  publishedAt: Date | null;
  quality: IngestQuality;
  rawJson: string;
};

const MAX_MESSAGES_PER_PEER = 120;

function messageDate(message: { date?: number }): Date | null {
  if (typeof message.date !== "number" || !Number.isFinite(message.date)) return null;
  return new Date(message.date * 1000);
}

function messageText(message: {
  message?: string;
  rawText?: string;
  text?: string;
}): string {
  if (typeof message.message === "string") return message.message;
  if (typeof message.rawText === "string") return message.rawText;
  if (typeof message.text === "string") return message.text;
  return "";
}

function isServiceMessage(message: { className?: string; action?: unknown }): boolean {
  if (message.action) return true;
  const name = message.className ?? "";
  return name.includes("MessageService") || name.includes("MessageEmpty");
}

/**
 * Fetch recent messages for telegram TopicSource peers and classify them.
 * Does not write to the DB.
 */
export async function collectTelegramSourceMessages(input: {
  configJson: string;
  periodHours: number;
  now?: Date;
}): Promise<CollectedTelegramMessage[]> {
  const config = parseSourceConfigJson("telegram", input.configJson) as TelegramSourceConfig;
  const peers = config.peers ?? [];
  if (peers.length === 0) return [];

  const now = input.now ?? new Date();
  const lookbackHours =
    typeof config.lookbackHours === "number" && config.lookbackHours > 0
      ? config.lookbackHours
      : input.periodHours;
  const sinceMs = now.getTime() - lookbackHours * 60 * 60 * 1000;

  return withLinkedTelegramClient(async (client) => {
    const out: CollectedTelegramMessage[] = [];
    for (const peer of peers) {
      let messages: unknown[] = [];
      try {
        messages = (await client.getMessages(peer, { limit: MAX_MESSAGES_PER_PEER })) as unknown[];
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch Telegram history.";
        throw new Error(`Telegram peer @${peer}: ${msg}`);
      }

      for (const raw of messages) {
        const message = raw as {
          id?: number;
          date?: number;
          message?: string;
          className?: string;
          action?: unknown;
          media?: unknown;
        };
        if (typeof message.id !== "number") continue;
        const publishedAt = messageDate(message);
        if (publishedAt && publishedAt.getTime() < sinceMs) continue;

        const text = messageText(message);
        const service = isServiceMessage(message);
        const quality = classifyIngestText(text, {
          isService: service,
          hasMediaOnly: !text.trim() && Boolean(message.media),
        });

        out.push({
          peer,
          externalId: `${peer.toLowerCase()}:${message.id}`,
          url: `https://t.me/${peer}/${message.id}`,
          title: null,
          text,
          publishedAt,
          quality,
          rawJson: JSON.stringify({
            peer,
            id: message.id,
            date: message.date ?? null,
          }),
        });
      }
    }
    return out;
  });
}
