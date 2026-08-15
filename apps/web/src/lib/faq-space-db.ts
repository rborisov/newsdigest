import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "@/lib/db";
import {
  buildFaqCandidatesFromIngest,
  buildFaqSlug,
  DEFAULT_FAQ_PROMPT,
} from "@/lib/faq-space";

export type PublicFaqSpace = {
  id: string;
  topicId: string;
  enabled: boolean;
  slug: string;
  name: string;
  promptTemplate: string;
  keywords: string;
  sourceMode: string;
  entryCount: number;
};

export async function ensureFaqSpaceForTopic(
  topicId: string,
  deps: { prisma?: PrismaClient } = {},
): Promise<PublicFaqSpace> {
  const client = deps.prisma ?? defaultPrisma;
  const topic = await client.topic.findUnique({
    where: { id: topicId },
    select: { id: true, name: true },
  });
  if (!topic) {
    throw new Error("Topic not found.");
  }

  let space = await client.faqSpace.findUnique({
    where: { topicId },
    include: { _count: { select: { entries: true } } },
  });

  if (!space) {
    space = await client.faqSpace.create({
      data: {
        topicId,
        slug: buildFaqSlug(topic.name, topic.id),
        name: `${topic.name} FAQ`,
        promptTemplate: DEFAULT_FAQ_PROMPT,
        keywords: "",
        enabled: false,
        sourceMode: "inherit_topic",
      },
      include: { _count: { select: { entries: true } } },
    });
  }

  return {
    id: space.id,
    topicId: space.topicId,
    enabled: space.enabled,
    slug: space.slug,
    name: space.name,
    promptTemplate: space.promptTemplate,
    keywords: space.keywords,
    sourceMode: space.sourceMode,
    entryCount: space._count.entries,
  };
}

export async function updateFaqSpace(
  topicId: string,
  input: {
    enabled?: boolean;
    name?: string;
    promptTemplate?: string;
    keywords?: string;
  },
  deps: { prisma?: PrismaClient } = {},
): Promise<PublicFaqSpace> {
  const client = deps.prisma ?? defaultPrisma;
  await ensureFaqSpaceForTopic(topicId, deps);

  const data: {
    enabled?: boolean;
    name?: string;
    promptTemplate?: string;
    keywords?: string;
  } = {};
  if (typeof input.enabled === "boolean") data.enabled = input.enabled;
  if (input.name !== undefined) data.name = input.name.trim() || "FAQ";
  if (input.promptTemplate !== undefined) data.promptTemplate = input.promptTemplate;
  if (input.keywords !== undefined) data.keywords = input.keywords;

  const space = await client.faqSpace.update({
    where: { topicId },
    data,
    include: { _count: { select: { entries: true } } },
  });

  return {
    id: space.id,
    topicId: space.topicId,
    enabled: space.enabled,
    slug: space.slug,
    name: space.name,
    promptTemplate: space.promptTemplate,
    keywords: space.keywords,
    sourceMode: space.sourceMode,
    entryCount: space._count.entries,
  };
}

export type FaqRefreshResult = {
  faqSpaceId: string;
  upserted: number;
  candidates: number;
};

/** Refresh FaqEntry rows from telegram ingest (questions + kept), no Cursor agent. */
export async function refreshFaqFromIngest(
  topicId: string,
  deps: { prisma?: PrismaClient; now?: Date } = {},
): Promise<FaqRefreshResult> {
  const client = deps.prisma ?? defaultPrisma;
  const now = deps.now ?? new Date();
  const space = await ensureFaqSpaceForTopic(topicId, deps);

  const [questions, kept] = await Promise.all([
    client.ingestItem.findMany({
      where: { topicId, quality: "question" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 80,
      select: { text: true, externalId: true, url: true, publishedAt: true },
    }),
    client.ingestItem.findMany({
      where: { topicId, quality: "kept" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 120,
      select: { text: true, externalId: true, url: true, publishedAt: true },
    }),
  ]);

  const candidates = buildFaqCandidatesFromIngest({
    questions,
    kept,
    keywords: space.keywords,
  });

  let upserted = 0;
  for (const candidate of candidates) {
    await client.faqEntry.upsert({
      where: {
        faqSpaceId_questionKey: {
          faqSpaceId: space.id,
          questionKey: candidate.questionKey,
        },
      },
      create: {
        faqSpaceId: space.id,
        question: candidate.question,
        questionKey: candidate.questionKey,
        answer: candidate.answer,
        status: "active",
        lastConfirmedAt: now,
        confidence: candidate.confidence,
        evidenceJson: JSON.stringify(candidate.evidence),
      },
      update: {
        question: candidate.question,
        answer: candidate.answer,
        status: "active",
        lastConfirmedAt: now,
        confidence: candidate.confidence,
        evidenceJson: JSON.stringify(candidate.evidence),
      },
    });
    upserted += 1;
  }

  return { faqSpaceId: space.id, upserted, candidates: candidates.length };
}

export async function listActiveFaqEntries(
  faqSpaceId: string,
  deps: { prisma?: PrismaClient } = {},
) {
  const client = deps.prisma ?? defaultPrisma;
  return client.faqEntry.findMany({
    where: { faqSpaceId, status: "active" },
    orderBy: [{ lastConfirmedAt: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      question: true,
      answer: true,
      lastConfirmedAt: true,
      confidence: true,
    },
  });
}
