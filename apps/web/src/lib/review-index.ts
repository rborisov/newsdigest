import type { PrismaClient } from "@prisma/client";

import { formatDigestWhen } from "@/lib/digest-display";
import { prisma as defaultPrisma } from "@/lib/db";
import {
  INDEX_SOFT_LIMIT_BYTES,
  createPage,
  decideIndexUpdateAction,
  editPage,
  type IndexDigestLink,
  type IndexUpdateAction,
  withIndexUpdateLock,
} from "@/lib/telegraph";

export const REVIEW_INDEX_PAGE_TITLE = "n. reviews";
export const OLDER_REVIEWS_LABEL = "Older reviews →";

export type IndexReviewPage = {
  id: string;
  title: string;
  telegraphUrl: string;
  telegraphPath: string;
  publishedAt: Date;
  storyTitle: string;
  topicName: string;
};

export type ReviewListItem = {
  id: string;
  title: string;
  storyTitle: string;
  topicName: string;
  telegraphUrl: string;
  publishedAt: Date;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

export function formatReviewIndexLinkLabel(input: {
  reviewTitle: string;
  storyTitle: string;
  topicName: string;
  publishedAt: Date;
  timeZone?: string;
}): string {
  const timeZone = input.timeZone?.trim() || "UTC";
  const when = formatDigestWhen(input.publishedAt, timeZone);
  const headline = input.storyTitle.trim() || input.reviewTitle.trim() || "Review";
  const topic = input.topicName.trim() || "Digest";
  const label = `${when} · ${topic} · ${headline}`;
  return label.length > 140 ? `${label.slice(0, 137).trimEnd()}…` : label;
}

export function buildReviewIndexHtml(
  reviewLinks: IndexDigestLink[],
  previousIndexUrl?: string,
): string {
  const parts = [
    "<p><em>Newest first. Each link opens a story review.</em></p>",
    "<hr/>",
  ];

  for (const link of reviewLinks) {
    parts.push(
      `<p><a href="${escapeAttr(link.url)}">${escapeHtml(link.title)}</a></p>`,
    );
  }

  if (previousIndexUrl) {
    parts.push("<hr/>");
    parts.push(
      `<p><a href="${escapeAttr(previousIndexUrl)}">${OLDER_REVIEWS_LABEL}</a></p>`,
    );
  }

  return parts.join("\n");
}

async function resolveAccessToken(db: PrismaClient): Promise<string> {
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  const token = meta?.accessToken.trim() || process.env.TELEGRAPH_ACCESS_TOKEN?.trim() || "";
  if (!token) {
    throw new Error("Telegra.ph access token is not configured");
  }
  return token;
}

async function loadAuthorFields(db: PrismaClient): Promise<{ authorName: string; authorUrl: string }> {
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  return {
    authorName: meta?.authorName ?? "",
    authorUrl: meta?.authorUrl ?? "",
  };
}

type ReviewRow = {
  id: string;
  title: string;
  telegraphUrl: string;
  telegraphPath: string;
  publishedAt: Date | null;
  story: {
    title: string;
    topicPage: { topicName: string };
  };
};

function toIndexReviewPage(review: ReviewRow): IndexReviewPage {
  if (!review.publishedAt) {
    throw new Error(`Review ${review.id} has no publishedAt`);
  }
  return {
    id: review.id,
    title: review.title,
    telegraphUrl: review.telegraphUrl,
    telegraphPath: review.telegraphPath,
    publishedAt: review.publishedAt,
    storyTitle: review.story.title,
    topicName: review.story.topicPage.topicName,
  };
}

async function loadAllPublishedReviews(db: PrismaClient): Promise<IndexReviewPage[]> {
  const rows = await db.storyReview.findMany({
    where: {
      status: "published",
      telegraphUrl: { not: "" },
      publishedAt: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    include: {
      story: {
        include: {
          topicPage: { select: { topicName: true } },
        },
      },
    },
  });
  return rows.map(toIndexReviewPage);
}

async function loadReviewsForIndexAssembly(
  db: PrismaClient,
  currentIndexId: string | null,
  newReviewId: string,
): Promise<IndexReviewPage[]> {
  if (!currentIndexId) {
    return loadAllPublishedReviews(db);
  }

  const [onIndex, latest] = await Promise.all([
    db.storyReview.findMany({
      where: {
        reviewIndexPageId: currentIndexId,
        status: "published",
        telegraphUrl: { not: "" },
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: "desc" },
      include: {
        story: {
          include: {
            topicPage: { select: { topicName: true } },
          },
        },
      },
    }),
    db.storyReview.findUnique({
      where: { id: newReviewId },
      include: {
        story: {
          include: {
            topicPage: { select: { topicName: true } },
          },
        },
      },
    }),
  ]);

  const merged = new Map<string, IndexReviewPage>();
  if (latest?.publishedAt && latest.telegraphUrl) {
    merged.set(latest.id, toIndexReviewPage(latest));
  }
  for (const review of onIndex) {
    merged.set(review.id, toIndexReviewPage(review));
  }

  return [...merged.values()].sort(
    (left, right) => right.publishedAt.getTime() - left.publishedAt.getTime(),
  );
}

async function updateReviewIndexAfterPublishUnlocked(
  params: {
    reviewPage: IndexReviewPage;
    prisma?: PrismaClient;
    fetchFn?: typeof fetch;
  },
): Promise<{ indexUrl: string; indexPath: string; action: IndexUpdateAction }> {
  const db = params.prisma ?? defaultPrisma;
  const fetchFn = params.fetchFn;
  const accessToken = await resolveAccessToken(db);
  const { authorName, authorUrl } = await loadAuthorFields(db);
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  if (!meta) {
    throw new Error("Telegraph config not found");
  }

  const promptConfig = await db.promptConfig.findUnique({
    where: { id: "default" },
    select: { displayTimezone: true },
  });
  const displayTimezone = promptConfig?.displayTimezone?.trim() || "UTC";

  const currentIndex = meta.currentReviewIndexPath
    ? await db.telegraphReviewIndexPage.findFirst({
        where: { telegraphPath: meta.currentReviewIndexPath, isCurrent: true },
        include: { previousIndex: true },
      })
    : null;

  const toReviewLink = (page: IndexReviewPage): IndexDigestLink => ({
    title: formatReviewIndexLinkLabel({
      reviewTitle: page.title,
      storyTitle: page.storyTitle,
      topicName: page.topicName,
      publishedAt: page.publishedAt,
      timeZone: displayTimezone,
    }),
    url: page.telegraphUrl,
  });

  const newReviewLink = toReviewLink(params.reviewPage);
  const indexedReviews = await loadReviewsForIndexAssembly(
    db,
    currentIndex?.id ?? null,
    params.reviewPage.id,
  );

  const reviewLinks = indexedReviews.map(toReviewLink);
  const previousIndexUrl = currentIndex?.previousIndex?.telegraphUrl;
  const candidateHtml = buildReviewIndexHtml(reviewLinks, previousIndexUrl);
  const action = decideIndexUpdateAction(Boolean(currentIndex), candidateHtml, INDEX_SOFT_LIMIT_BYTES);

  const linkReviewToIndex = (indexPageId: string) =>
    db.storyReview.update({
      where: { id: params.reviewPage.id },
      data: { reviewIndexPageId: indexPageId },
    });

  if (action === "create_first") {
    const indexHtml = buildReviewIndexHtml(reviewLinks);
    const created = await createPage({
      accessToken,
      title: REVIEW_INDEX_PAGE_TITLE,
      content: indexHtml,
      authorName,
      authorUrl,
      fetchFn,
    });

    const indexPage = await db.telegraphReviewIndexPage.create({
      data: {
        telegraphPath: created.path,
        telegraphUrl: created.url,
        isCurrent: true,
      },
    });

    await db.$transaction([
      db.telegraphMeta.update({
        where: { id: "default" },
        data: {
          currentReviewIndexPath: created.path,
          currentReviewIndexUrl: created.url,
        },
      }),
      linkReviewToIndex(indexPage.id),
    ]);

    return { indexUrl: created.url, indexPath: created.path, action };
  }

  if (action === "edit") {
    if (!currentIndex) {
      throw new Error("Current review index page not found");
    }

    const edited = await editPage({
      accessToken,
      path: currentIndex.telegraphPath,
      title: REVIEW_INDEX_PAGE_TITLE,
      content: candidateHtml,
      authorName,
      authorUrl,
      fetchFn,
    });

    await db.$transaction([
      db.telegraphMeta.update({
        where: { id: "default" },
        data: {
          currentReviewIndexPath: edited.path,
          currentReviewIndexUrl: edited.url,
        },
      }),
      linkReviewToIndex(currentIndex.id),
    ]);

    return { indexUrl: edited.url, indexPath: edited.path, action };
  }

  if (!currentIndex) {
    throw new Error("Current review index page not found");
  }

  const rotatedHtml = buildReviewIndexHtml([newReviewLink], currentIndex.telegraphUrl);
  const created = await createPage({
    accessToken,
    title: REVIEW_INDEX_PAGE_TITLE,
    content: rotatedHtml,
    authorName,
    authorUrl,
    fetchFn,
  });

  const newIndexPage = await db.telegraphReviewIndexPage.create({
    data: {
      telegraphPath: created.path,
      telegraphUrl: created.url,
      previousIndexId: currentIndex.id,
      isCurrent: true,
    },
  });

  await db.$transaction([
    db.telegraphReviewIndexPage.update({
      where: { id: currentIndex.id },
      data: {
        isCurrent: false,
        closedAt: new Date(),
      },
    }),
    db.telegraphMeta.update({
      where: { id: "default" },
      data: {
        currentReviewIndexPath: created.path,
        currentReviewIndexUrl: created.url,
      },
    }),
    linkReviewToIndex(newIndexPage.id),
  ]);

  return { indexUrl: created.url, indexPath: created.path, action: "rotate" };
}

export async function updateReviewIndexAfterPublish(
  params: {
    reviewPage: IndexReviewPage;
    prisma?: PrismaClient;
    fetchFn?: typeof fetch;
  },
): Promise<{ indexUrl: string; indexPath: string; action: IndexUpdateAction }> {
  const db = params.prisma ?? defaultPrisma;
  return withIndexUpdateLock(db, () => updateReviewIndexAfterPublishUnlocked(params));
}

/** Backfill the Telegra.ph reviews index when published reviews exist but no index URL yet. */
export async function ensureReviewIndex(
  db: PrismaClient = defaultPrisma,
): Promise<{ indexUrl: string; indexPath: string } | null> {
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  if (meta?.currentReviewIndexUrl?.trim()) {
    return null;
  }

  const latest = await db.storyReview.findFirst({
    where: {
      status: "published",
      telegraphUrl: { not: "" },
      publishedAt: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    include: {
      story: {
        include: {
          topicPage: { select: { topicName: true } },
        },
      },
    },
  });

  if (!latest?.publishedAt) {
    return null;
  }

  const result = await updateReviewIndexAfterPublish({
    prisma: db,
    reviewPage: toIndexReviewPage(latest),
  });
  return { indexUrl: result.indexUrl, indexPath: result.indexPath };
}

export async function loadRecentReviews(
  prisma: PrismaClient,
  take = 48,
): Promise<{
  items: ReviewListItem[];
  reviewIndexUrl: string;
  displayTimezone: string;
}> {
  const [meta, reviews, promptConfig] = await Promise.all([
    prisma.telegraphMeta.findUnique({ where: { id: "default" } }),
    prisma.storyReview.findMany({
      where: {
        status: "published",
        telegraphUrl: { not: "" },
        publishedAt: { not: null },
      },
      orderBy: { publishedAt: "desc" },
      take,
      include: {
        story: {
          include: {
            topicPage: { select: { topicName: true } },
          },
        },
      },
    }),
    prisma.promptConfig.findUnique({
      where: { id: "default" },
      select: { displayTimezone: true },
    }),
  ]);

  return {
    items: reviews.map((review) => ({
      id: review.id,
      title: review.title,
      storyTitle: review.story.title,
      topicName: review.story.topicPage.topicName,
      telegraphUrl: review.telegraphUrl,
      publishedAt: review.publishedAt!,
    })),
    reviewIndexUrl: meta?.currentReviewIndexUrl?.trim() ?? "",
    displayTimezone: promptConfig?.displayTimezone?.trim() || "UTC",
  };
}
