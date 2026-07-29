import { PrismaClient } from "@prisma/client";

export type BoardCard = {
  topicId: string;
  topicName: string;
  pageId: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  storyTitles: string[];
};

export type SidebarItem = {
  id: string;
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
  return config?.boardStaleDays ?? 1;
}

export function selectBoardPages(
  pages: BoardPageInput[],
  topics: TopicInput[],
  staleDays: number,
  now: Date,
): BoardCard[] {
  const cutoff = boardCutoff(staleDays, now);
  const sortedTopics = [...topics].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  );

  const board: BoardCard[] = [];
  for (const topic of sortedTopics) {
    const inWindow = pages.filter(
      (page) => pageMatchesTopic(page, topic) && page.publishedAt >= cutoff,
    );
    if (inWindow.length === 0) {
      continue;
    }

    const latest = inWindow.reduce((newest, page) =>
      page.publishedAt > newest.publishedAt ? page : newest,
    );

    board.push({
      topicId: topic.id,
      topicName: topic.name,
      pageId: latest.id,
      title: latest.title,
      telegraphUrl: latest.telegraphUrl,
      publishedAt: latest.publishedAt,
      storyTitles: latest.storyTitles,
    });
  }

  return board;
}

export async function loadTopicBoard(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ board: BoardCard[]; sidebar: SidebarItem[]; indexUrl: string }> {
  const staleDays = await getBoardStaleDays(prisma);
  const cutoff = boardCutoff(staleDays, now);

  const pageSelect = {
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
  };

  const [meta, topics, boardPages, sidebarPages] = await Promise.all([
    prisma.telegraphMeta.findUnique({ where: { id: "default" } }),
    prisma.topic.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, sortOrder: true },
    }),
    prisma.topicPage.findMany({
      where: { publishedAt: { gte: cutoff } },
      select: pageSelect,
    }),
    prisma.topicPage.findMany({
      orderBy: { publishedAt: "desc" },
      take: 24,
      select: pageSelect,
    }),
  ]);

  const toPageInput = (page: (typeof boardPages)[number]): BoardPageInput => ({
    id: page.id,
    topicId: page.topicId,
    topicName: page.topicName,
    title: page.title,
    telegraphUrl: page.telegraphUrl,
    publishedAt: page.publishedAt,
    storyTitles: page.stories.map((story) => story.title),
  });

  const board = selectBoardPages(
    boardPages.map(toPageInput),
    topics,
    staleDays,
    now,
  );

  const sidebar: SidebarItem[] = sidebarPages.map((page) => ({
    id: page.id,
    topicName: page.topicName,
    title: page.title,
    telegraphUrl: page.telegraphUrl,
    publishedAt: page.publishedAt,
    storyTitles: page.stories.map((story) => story.title),
  }));

  return {
    board,
    sidebar,
    indexUrl: meta?.currentIndexUrl?.trim() ?? "",
  };
}
