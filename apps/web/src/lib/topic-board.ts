import { PrismaClient } from "@prisma/client";

export type BoardCard = {
  topicId: string;
  topicName: string;
  pageId: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  storyTitles: string[];
  htmlContent: string;
};

export type SidebarItem = {
  id: string;
  topicId: string;
  topicName: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  storyTitles: string[];
};

type BoardPageInput = {
  id: string;
  topicId: string | null;
  topicName: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  storyTitles: string[];
  htmlContent: string;
};

type TopicInput = {
  id: string;
  name: string;
  sortOrder: number;
};

function boardCutoff(staleDays: number, now: Date): Date {
  return new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);
}

function pageMatchesTopic(page: BoardPageInput, topic: TopicInput): boolean {
  return page.topicId === topic.id || (page.topicId === null && page.topicName === topic.name);
}

export async function getBoardStaleDays(prisma: PrismaClient): Promise<number> {
  const config = await prisma.promptConfig.findUnique({ where: { id: "default" } });
  // 0 = show latest cached page for every topic (no age limit).
  return config?.boardStaleDays ?? 0;
}

export function selectBoardPages(
  pages: BoardPageInput[],
  topics: TopicInput[],
  staleDays: number,
  now: Date,
): BoardCard[] {
  const cutoff = staleDays > 0 ? boardCutoff(staleDays, now) : null;
  const sortedTopics = [...topics].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  const board: BoardCard[] = [];
  for (const topic of sortedTopics) {
    const matching = pages.filter((page) => pageMatchesTopic(page, topic));
    if (matching.length === 0) {
      continue;
    }

    const latest = matching.reduce((newest, page) =>
      page.publishedAt > newest.publishedAt ? page : newest,
    );

    if (cutoff && latest.publishedAt < cutoff) {
      continue;
    }

    board.push({
      topicId: topic.id,
      topicName: topic.name,
      pageId: latest.id,
      title: latest.title,
      telegraphUrl: latest.telegraphUrl,
      publishedAt: latest.publishedAt,
      storyTitles: latest.storyTitles,
      htmlContent: latest.htmlContent,
    });
  }

  // Newest digests first (same order as the topics sidebar).
  return board.sort(
    (a, b) =>
      b.publishedAt.getTime() - a.publishedAt.getTime() ||
      a.topicName.localeCompare(b.topicName),
  );
}

/** Max topics in the home sidebar (newest first). Keeps the rail short — no own scrollbar. */
export const HOME_SIDEBAR_TOPIC_LIMIT = 8;

/** Latest cached page per topic, newest update first (for home sidebar). */
export function boardToNavItems(
  board: BoardCard[],
  limit = HOME_SIDEBAR_TOPIC_LIMIT,
): SidebarItem[] {
  return [...board]
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, Math.max(0, limit))
    .map((card) => ({
      id: card.pageId,
      topicId: card.topicId,
      topicName: card.topicName,
      title: card.title,
      telegraphUrl: card.telegraphUrl,
      publishedAt: card.publishedAt,
      storyTitles: card.storyTitles,
    }));
}

export async function loadRecentDigests(
  prisma: PrismaClient,
  take = 48,
): Promise<{
  items: SidebarItem[];
  indexUrl: string;
  displayTimezone: string;
}> {
  const [meta, pages, promptConfig] = await Promise.all([
    prisma.telegraphMeta.findUnique({ where: { id: "default" } }),
    prisma.topicPage.findMany({
      orderBy: { publishedAt: "desc" },
      take,
      select: {
        id: true,
        topicId: true,
        topicName: true,
        title: true,
        telegraphUrl: true,
        publishedAt: true,
        stories: {
          take: 6,
          orderBy: { firstSeenAt: "asc" as const },
          select: { title: true },
        },
      },
    }),
    prisma.promptConfig.findUnique({
      where: { id: "default" },
      select: { displayTimezone: true },
    }),
  ]);

  return {
    items: pages.map((page) => ({
      id: page.id,
      topicId: page.topicId ?? page.id,
      topicName: page.topicName,
      title: page.title,
      telegraphUrl: page.telegraphUrl,
      publishedAt: page.publishedAt,
      storyTitles: page.stories.map((story) => story.title),
    })),
    indexUrl: meta?.currentIndexUrl?.trim() ?? "",
    displayTimezone: promptConfig?.displayTimezone?.trim() || "UTC",
  };
}

const boardPageSelect = {
  id: true,
  topicId: true,
  topicName: true,
  title: true,
  telegraphUrl: true,
  publishedAt: true,
  htmlContent: true,
  stories: {
    take: 6,
    orderBy: { firstSeenAt: "asc" as const },
    select: { title: true },
  },
} as const;

type BoardPageRow = {
  id: string;
  topicId: string | null;
  topicName: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  htmlContent: string;
  stories: { title: string }[];
};

function toPageInput(page: BoardPageRow): BoardPageInput {
  return {
    id: page.id,
    topicId: page.topicId,
    topicName: page.topicName,
    title: page.title,
    telegraphUrl: page.telegraphUrl,
    publishedAt: page.publishedAt,
    storyTitles: page.stories.map((story) => story.title),
    htmlContent: page.htmlContent,
  };
}

async function loadLatestPageForTopic(
  prisma: PrismaClient,
  topic: TopicInput,
): Promise<BoardPageRow | null> {
  return prisma.topicPage.findFirst({
    where: {
      OR: [{ topicId: topic.id }, { topicId: null, topicName: topic.name }],
    },
    orderBy: { publishedAt: "desc" },
    select: boardPageSelect,
  });
}

export async function loadTopicBoard(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{
  board: BoardCard[];
  nav: SidebarItem[];
  indexUrl: string;
  displayTimezone: string;
}> {
  const staleDays = await getBoardStaleDays(prisma);

  const [meta, topics, promptConfig] = await Promise.all([
    prisma.telegraphMeta.findUnique({ where: { id: "default" } }),
    prisma.topic.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.promptConfig.findUnique({
      where: { id: "default" },
      select: { displayTimezone: true },
    }),
  ]);

  const latestPages = (
    await Promise.all(topics.map((topic) => loadLatestPageForTopic(prisma, topic)))
  ).filter((page): page is BoardPageRow => page !== null);

  const board = selectBoardPages(
    latestPages.map(toPageInput),
    topics,
    staleDays,
    now,
  );

  return {
    board,
    nav: boardToNavItems(board),
    indexUrl: meta?.currentIndexUrl?.trim() ?? "",
    displayTimezone: promptConfig?.displayTimezone?.trim() || "UTC",
  };
}
