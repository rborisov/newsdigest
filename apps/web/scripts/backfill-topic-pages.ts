import { PrismaClient } from "@prisma/client";

import { topicsFromDigestTitle } from "../src/lib/digest-display";

const LEGACY_TOPIC_NAME = "Legacy";

export type BackfillStats = {
  scanned: number;
  skippedExisting: number;
  created: number;
  storiesCreated: number;
  storiesSkippedConflict: number;
  legacyTopicPages: number;
  matchedTopicPages: number;
};

type TopicRef = { id: string; name: string };

export function resolveTopicForTitle(
  title: string,
  topicsByLowerName: Map<string, TopicRef>,
): { topicId: string | null; topicName: string } {
  const tokens = topicsFromDigestTitle(title);
  const matched = new Map<string, TopicRef>();

  for (const token of tokens) {
    const topic = topicsByLowerName.get(token.toLowerCase());
    if (topic) {
      matched.set(topic.id, topic);
    }
  }

  if (matched.size === 1) {
    const topic = [...matched.values()][0]!;
    return { topicId: topic.id, topicName: topic.name };
  }

  return { topicId: null, topicName: LEGACY_TOPIC_NAME };
}

export async function backfillTopicPages(
  prisma: PrismaClient,
): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    skippedExisting: 0,
    created: 0,
    storiesCreated: 0,
    storiesSkippedConflict: 0,
    legacyTopicPages: 0,
    matchedTopicPages: 0,
  };

  const topics = await prisma.topic.findMany({
    select: { id: true, name: true },
  });
  const topicsByLowerName = new Map(
    topics.map((topic) => [topic.name.toLowerCase(), topic]),
  );

  const existingUrls = new Set(
    (await prisma.topicPage.findMany({ select: { telegraphUrl: true } })).map(
      (page) => page.telegraphUrl,
    ),
  );

  const publishedPages = await prisma.publishedPage.findMany({
    include: { stories: true },
    orderBy: { createdAt: "asc" },
  });

  for (const page of publishedPages) {
    stats.scanned += 1;

    if (existingUrls.has(page.telegraphUrl)) {
      stats.skippedExisting += 1;
      continue;
    }

    const { topicId, topicName } = resolveTopicForTitle(
      page.title,
      topicsByLowerName,
    );

    const topicPage = await prisma.topicPage.create({
      data: {
        topicId,
        topicName,
        title: page.title,
        telegraphPath: page.telegraphPath,
        telegraphUrl: page.telegraphUrl,
        indexPageId: page.indexPageId,
        triggerType: page.triggerType,
        triggeredBy: page.triggeredBy,
        jobId: page.jobId,
        publishedAt: page.createdAt,
      },
    });

    existingUrls.add(page.telegraphUrl);
    stats.created += 1;
    if (topicId) {
      stats.matchedTopicPages += 1;
    } else {
      stats.legacyTopicPages += 1;
    }

    for (const story of page.stories) {
      if (story.canonicalUrl) {
        const existing = await prisma.storyIndex.findUnique({
          where: { canonicalUrl: story.canonicalUrl },
        });
        if (existing) {
          stats.storiesSkippedConflict += 1;
          continue;
        }
      }

      await prisma.storyIndex.create({
        data: {
          topicPageId: topicPage.id,
          title: story.title,
          canonicalUrl: story.canonicalUrl,
          titleKey: story.titleKey,
          firstSeenAt: story.firstSeenAt,
        },
      });
      stats.storiesCreated += 1;
    }
  }

  return stats;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    const stats = await backfillTopicPages(prisma);
    console.log("Backfill complete:", stats);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
