import type { PrismaClient } from "@prisma/client";

import type { ReviewLinkInfo } from "@/lib/story-review";
import { extractStoryIdsFromHtml } from "@/lib/story-review";

export async function loadStoryReviewsForHtml(
  prisma: PrismaClient,
  htmlChunks: string[],
): Promise<Map<string, ReviewLinkInfo>> {
  const storyIds = new Set<string>();
  for (const html of htmlChunks) {
    for (const id of extractStoryIdsFromHtml(html)) {
      storyIds.add(id);
    }
  }

  if (storyIds.size === 0) {
    return new Map();
  }

  const reviews = await prisma.storyReview.findMany({
    where: { storyIndexId: { in: [...storyIds] } },
    select: {
      storyIndexId: true,
      status: true,
      telegraphUrl: true,
    },
  });

  const map = new Map<string, ReviewLinkInfo>();
  for (const review of reviews) {
    map.set(review.storyIndexId, {
      storyIndexId: review.storyIndexId,
      status: review.status,
      telegraphUrl: review.telegraphUrl,
    });
  }
  return map;
}
