import type { PrismaClient } from "@prisma/client";

import { tryAcquireAgentMutex } from "@/lib/agent-mutex";
import { spawnAgentBackend } from "@/lib/agent-backend";
import {
  applyReviewPromptPlaceholders,
  buildStoryReviewAgentPrompt,
  DEFAULT_REVIEW_TEMPLATE,
} from "@/lib/story-review";
import { formatPromptDate } from "@/lib/prompt";

export type StartStoryReviewInput = {
  storyIndexId: string;
  prompt: string;
  createdBy: string;
};

export type StartStoryReviewResult =
  | { ok: true; reviewId: string; pid: number }
  | { ok: false; error: string; status?: number };

export async function startStoryReview(
  prisma: PrismaClient,
  input: StartStoryReviewInput,
): Promise<StartStoryReviewResult> {
  const story = await prisma.storyIndex.findUnique({
    where: { id: input.storyIndexId },
    include: {
      topicPage: { select: { topicName: true } },
      review: { select: { id: true, status: true } },
    },
  });

  if (!story) {
    return { ok: false, error: "Story not found.", status: 404 };
  }

  if (story.review?.status === "running" || story.review?.status === "pending") {
    return { ok: false, error: "A review is already in progress for this story.", status: 409 };
  }

  const promptConfig = await prisma.promptConfig.findUnique({ where: { id: "default" } });
  const language = promptConfig?.language?.trim() || "English";
  const timeZone = promptConfig?.displayTimezone?.trim() || "UTC";
  const date = formatPromptDate(new Date(), timeZone);

  const promptSnapshot = applyReviewPromptPlaceholders(input.prompt.trim(), {
    storyId: story.id,
    storyTitle: story.title,
    storyUrl: story.canonicalUrl ?? "",
    topicName: story.topicPage.topicName,
    language,
    date,
  });

  const review = await prisma.storyReview.upsert({
    where: { storyIndexId: story.id },
    create: {
      storyIndexId: story.id,
      status: "pending",
      promptUsed: promptSnapshot,
      createdBy: input.createdBy,
      title: "",
      telegraphPath: "",
      telegraphUrl: "",
    },
    update: {
      status: "pending",
      promptUsed: promptSnapshot,
      createdBy: input.createdBy,
      title: "",
      telegraphPath: "",
      telegraphUrl: "",
      error: null,
      publishedAt: null,
      pid: null,
    },
  });

  const mutex = tryAcquireAgentMutex(`story-review:${review.id}`);
  if (!mutex.ok) {
    await prisma.storyReview.update({
      where: { id: review.id },
      data: { status: "failed", error: mutex.error },
    });
    return { ok: false, error: mutex.error, status: 503 };
  }

  const agentPrompt = buildStoryReviewAgentPrompt(promptSnapshot, {
    reviewId: review.id,
    storyId: story.id,
    storyTitle: story.title,
    storyUrl: story.canonicalUrl ?? "",
    topicName: story.topicPage.topicName,
    language,
    date,
  });

  const spawned = spawnAgentBackend(agentPrompt, review.id);
  if (!spawned.ok) {
    mutex.release();
    await prisma.storyReview.update({
      where: { id: review.id },
      data: { status: "failed", error: spawned.error },
    });
    return { ok: false, error: spawned.error, status: 503 };
  }

  await prisma.storyReview.update({
    where: { id: review.id },
    data: { status: "running", pid: spawned.pid },
  });

  return { ok: true, reviewId: review.id, pid: spawned.pid };
}

export async function loadDefaultReviewTemplate(prisma: PrismaClient): Promise<string> {
  const config = await prisma.promptConfig.findUnique({
    where: { id: "default" },
    select: { reviewTemplate: true },
  });
  const template = config?.reviewTemplate?.trim();
  return template || DEFAULT_REVIEW_TEMPLATE;
}
