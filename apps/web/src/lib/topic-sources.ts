export const TOPIC_SOURCE_KINDS = ["web", "telegram"] as const;
export type TopicSourceKind = (typeof TOPIC_SOURCE_KINDS)[number];

export type WebSourceConfig = {
  keywords: string;
};

export type TelegramSourceConfig = {
  peers: string[];
  lookbackHours: number | null;
};

export type TopicSourceConfig = WebSourceConfig | TelegramSourceConfig;

export type TopicSourceInput = {
  id?: string;
  kind: TopicSourceKind;
  enabled: boolean;
  sortOrder: number;
  config: TopicSourceConfig;
  connectionId?: string | null;
};

export type PublicTopicSource = {
  id: string;
  kind: TopicSourceKind;
  enabled: boolean;
  sortOrder: number;
  config: TopicSourceConfig;
  connectionId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
};

/** Normalize a Telegram peer: drop @, t.me/ URLs, whitespace. */
export function normalizeTelegramPeer(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/^(?:www\.)?(?:t\.me|telegram\.me)\//i, "");
  value = value.replace(/^@+/, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.trim();
  if (!value || !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value)) {
    return "";
  }
  return value;
}

/** Parse peers from textarea / comma / JSON array. */
export function parseTelegramPeers(raw: string | string[]): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : raw
        .split(/[\n,]+/)
        .map((part) => part.trim())
        .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const peer = normalizeTelegramPeer(part);
    if (!peer) continue;
    const key = peer.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(peer);
  }
  return out;
}

export function parseSourceConfigJson(kind: string, configJson: string): TopicSourceConfig {
  let raw: unknown = {};
  try {
    raw = JSON.parse(configJson || "{}") as unknown;
  } catch {
    raw = {};
  }
  if (kind === "telegram") {
    const obj = (raw && typeof raw === "object" ? raw : {}) as {
      peers?: unknown;
      lookbackHours?: unknown;
    };
    const peers = parseTelegramPeers(
      Array.isArray(obj.peers) ? obj.peers.map(String) : typeof obj.peers === "string" ? obj.peers : [],
    );
    const lookback =
      typeof obj.lookbackHours === "number" && Number.isFinite(obj.lookbackHours) && obj.lookbackHours > 0
        ? Math.floor(obj.lookbackHours)
        : null;
    return { peers, lookbackHours: lookback };
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as { keywords?: unknown };
  return { keywords: typeof obj.keywords === "string" ? obj.keywords : "" };
}

export function serializeSourceConfig(kind: TopicSourceKind, config: TopicSourceConfig): string {
  if (kind === "telegram") {
    const tg = config as TelegramSourceConfig;
    return JSON.stringify({
      peers: parseTelegramPeers(tg.peers ?? []),
      lookbackHours: tg.lookbackHours ?? null,
    });
  }
  const web = config as WebSourceConfig;
  return JSON.stringify({ keywords: (web.keywords ?? "").trim() });
}

export function toPublicTopicSource(row: {
  id: string;
  kind: string;
  enabled: boolean;
  sortOrder: number;
  configJson: string;
  connectionId: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}): PublicTopicSource {
  const kind = (TOPIC_SOURCE_KINDS.includes(row.kind as TopicSourceKind)
    ? row.kind
    : "web") as TopicSourceKind;
  return {
    id: row.id,
    kind,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    config: parseSourceConfigJson(kind, row.configJson),
    connectionId: row.connectionId,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastError: row.lastError,
  };
}

/** Keywords string mirrored onto Topic for the current digest pipeline. */
export function mirrorKeywordsFromSources(sources: TopicSourceInput[]): string {
  const web = sources
    .filter((source) => source.kind === "web" && source.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const source of web) {
    const keywords = ((source.config as WebSourceConfig).keywords ?? "").trim();
    if (keywords) return keywords;
  }
  return "";
}

export function validateTopicSources(sources: TopicSourceInput[]): string | null {
  if (sources.length === 0) {
    return "Add at least one source (web and/or Telegram).";
  }
  let usable = 0;
  for (const [index, source] of sources.entries()) {
    if (!TOPIC_SOURCE_KINDS.includes(source.kind)) {
      return `Source #${index + 1}: unsupported kind.`;
    }
    if (!source.enabled) continue;
    if (source.kind === "web") {
      const keywords = ((source.config as WebSourceConfig).keywords ?? "").trim();
      if (!keywords) {
        return `Web source #${index + 1}: keywords / notes are required when enabled.`;
      }
      usable += 1;
    } else if (source.kind === "telegram") {
      const peers = parseTelegramPeers((source.config as TelegramSourceConfig).peers ?? []);
      if (peers.length === 0) {
        return `Telegram source #${index + 1}: add at least one peer (e.g. Abkhaziaz).`;
      }
      usable += 1;
    }
  }
  if (usable === 0) {
    return "Enable at least one source with valid config.";
  }
  return null;
}

export function parseTopicSourcesBody(raw: unknown): TopicSourceInput[] | { error: string } {
  if (!Array.isArray(raw)) {
    return { error: "sources must be an array." };
  }
  const out: TopicSourceInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      return { error: `Source #${index + 1} is invalid.` };
    }
    const row = item as Record<string, unknown>;
    const kind = String(row.kind ?? "");
    if (!TOPIC_SOURCE_KINDS.includes(kind as TopicSourceKind)) {
      return { error: `Source #${index + 1}: kind must be web or telegram.` };
    }
    const enabled = row.enabled !== false;
    const sortOrder = typeof row.sortOrder === "number" ? row.sortOrder : index;
    const configRaw = row.config;
    if (kind === "telegram") {
      const cfg = (configRaw && typeof configRaw === "object" ? configRaw : {}) as {
        peers?: unknown;
        lookbackHours?: unknown;
      };
      const peers = parseTelegramPeers(
        Array.isArray(cfg.peers)
          ? cfg.peers.map(String)
          : typeof cfg.peers === "string"
            ? cfg.peers
            : "",
      );
      const lookbackHours =
        typeof cfg.lookbackHours === "number" && Number.isFinite(cfg.lookbackHours) && cfg.lookbackHours > 0
          ? Math.floor(cfg.lookbackHours)
          : null;
      out.push({
        id: typeof row.id === "string" ? row.id : undefined,
        kind: "telegram",
        enabled,
        sortOrder,
        config: { peers, lookbackHours },
        connectionId: typeof row.connectionId === "string" ? row.connectionId : null,
      });
    } else {
      const cfg = (configRaw && typeof configRaw === "object" ? configRaw : {}) as {
        keywords?: unknown;
      };
      out.push({
        id: typeof row.id === "string" ? row.id : undefined,
        kind: "web",
        enabled,
        sortOrder,
        config: { keywords: typeof cfg.keywords === "string" ? cfg.keywords : "" },
        connectionId: null,
      });
    }
  }
  return out;
}
