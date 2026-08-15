import { prisma } from "@/lib/db";
import {
  mirrorKeywordsFromSources,
  serializeSourceConfig,
  toPublicTopicSource,
  type PublicTopicSource,
  type TopicSourceInput,
  type TopicSourceKind,
  validateTopicSources,
} from "@/lib/topic-sources";

const sourceSelect = {
  id: true,
  kind: true,
  enabled: true,
  sortOrder: true,
  configJson: true,
  connectionId: true,
  lastSyncAt: true,
  lastError: true,
} as const;

/** Ensure every topic has a web TopicSource; backfill from Topic.keywords when missing. */
export async function ensureTopicSourcesMigrated(): Promise<void> {
  const topics = await prisma.topic.findMany({
    select: {
      id: true,
      keywords: true,
      sources: { select: { id: true, kind: true }, take: 1 },
    },
  });

  for (const topic of topics) {
    if (topic.sources.length > 0) continue;
    await prisma.topicSource.create({
      data: {
        topicId: topic.id,
        kind: "web",
        enabled: true,
        sortOrder: 0,
        configJson: serializeSourceConfig("web", { keywords: topic.keywords }),
      },
    });
  }
}

export async function listTopicSources(topicId: string): Promise<PublicTopicSource[]> {
  const rows = await prisma.topicSource.findMany({
    where: { topicId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: sourceSelect,
  });
  return rows.map(toPublicTopicSource);
}

export async function replaceTopicSources(
  topicId: string,
  sources: TopicSourceInput[],
): Promise<PublicTopicSource[]> {
  const validationError = validateTopicSources(sources);
  if (validationError) {
    throw new Error(validationError);
  }

  await prisma.$transaction(async (tx) => {
    await tx.topicSource.deleteMany({ where: { topicId } });
    for (const [index, source] of sources.entries()) {
      await tx.topicSource.create({
        data: {
          topicId,
          kind: source.kind,
          enabled: source.enabled,
          sortOrder: source.sortOrder ?? index,
          configJson: serializeSourceConfig(source.kind, source.config),
          connectionId: source.kind === "telegram" ? (source.connectionId ?? null) : null,
        },
      });
    }
    await tx.topic.update({
      where: { id: topicId },
      data: { keywords: mirrorKeywordsFromSources(sources) },
    });
  });

  return listTopicSources(topicId);
}

export async function createTopicWithSources(input: {
  name: string;
  enabled?: boolean;
  sortOrder?: number;
  scheduleId?: string | null;
  sources: TopicSourceInput[];
}) {
  const validationError = validateTopicSources(input.sources);
  if (validationError) {
    throw new Error(validationError);
  }
  const keywords = mirrorKeywordsFromSources(input.sources);

  return prisma.$transaction(async (tx) => {
    const topic = await tx.topic.create({
      data: {
        name: input.name,
        keywords,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 0,
        scheduleId: input.scheduleId ?? null,
      },
    });
    for (const [index, source] of input.sources.entries()) {
      await tx.topicSource.create({
        data: {
          topicId: topic.id,
          kind: source.kind,
          enabled: source.enabled,
          sortOrder: source.sortOrder ?? index,
          configJson: serializeSourceConfig(source.kind as TopicSourceKind, source.config),
          connectionId: source.kind === "telegram" ? (source.connectionId ?? null) : null,
        },
      });
    }
    const sources = await tx.topicSource.findMany({
      where: { topicId: topic.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: sourceSelect,
    });
    return { topic, sources: sources.map(toPublicTopicSource) };
  });
}

export async function updateTopicAndSources(input: {
  id: string;
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
  scheduleId?: string | null;
  sources?: TopicSourceInput[];
}) {
  const existing = await prisma.topic.findUnique({ where: { id: input.id } });
  if (!existing) {
    throw new Error("Topic not found.");
  }

  if (input.sources) {
    const validationError = validateTopicSources(input.sources);
    if (validationError) {
      throw new Error(validationError);
    }
  }

  return prisma.$transaction(async (tx) => {
    const data: {
      name?: string;
      keywords?: string;
      enabled?: boolean;
      sortOrder?: number;
      scheduleId?: string | null;
    } = {};
    if (input.name !== undefined) data.name = input.name;
    if (typeof input.enabled === "boolean") data.enabled = input.enabled;
    if (typeof input.sortOrder === "number") data.sortOrder = input.sortOrder;
    if (input.scheduleId !== undefined) data.scheduleId = input.scheduleId;
    if (input.sources) {
      data.keywords = mirrorKeywordsFromSources(input.sources);
      await tx.topicSource.deleteMany({ where: { topicId: input.id } });
      for (const [index, source] of input.sources.entries()) {
        await tx.topicSource.create({
          data: {
            topicId: input.id,
            kind: source.kind,
            enabled: source.enabled,
            sortOrder: source.sortOrder ?? index,
            configJson: serializeSourceConfig(source.kind, source.config),
            connectionId: source.kind === "telegram" ? (source.connectionId ?? null) : null,
          },
        });
      }
    }

    const topic = await tx.topic.update({
      where: { id: input.id },
      data,
    });
    const sources = await tx.topicSource.findMany({
      where: { topicId: input.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: sourceSelect,
    });
    return { topic, sources: sources.map(toPublicTopicSource) };
  });
}
