import { GenerationJobStatus, TriggerType } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  areAllStoriesKnown,
  normalizeStoryFingerprints,
  parseStoriesFromHtml,
  type StoryFingerprint,
} from "@/lib/dedup";
import { prisma } from "@/lib/db";
import { requireInternalApi } from "@/lib/require-internal";
import { publishDigest, type PublishStoryInput } from "@/lib/telegraph";

type PublishRequestBody = {
  jobId?: string;
  title?: string;
  htmlContent?: string;
  html?: string;
  triggeredBy?: string;
  stories?: StoryFingerprint[];
};

function toPublishStories(stories: StoryFingerprint[]): PublishStoryInput[] {
  return normalizeStoryFingerprints(stories).map((story) => ({
    title: story.title,
    canonicalUrl: story.canonicalUrl,
    titleKey: story.titleKey,
  }));
}

export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json()) as PublishRequestBody;
  const jobId = body.jobId?.trim() ?? "";
  const title = body.title?.trim() ?? "";
  const html = (body.htmlContent ?? body.html ?? "").trim();

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  if (!html) {
    return NextResponse.json({ error: "htmlContent is required." }, { status: 400 });
  }

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return NextResponse.json({ error: "Generation job not found." }, { status: 404 });
  }

  const stories =
    body.stories && body.stories.length > 0
      ? normalizeStoryFingerprints(body.stories)
      : parseStoriesFromHtml(html);

  const knownStories = await prisma.publishedStory.findMany({
    select: {
      canonicalUrl: true,
      titleKey: true,
    },
  });

  if (areAllStoriesKnown(stories, knownStories)) {
    const message = "All stories in this digest were already published; skipping empty duplicate publish.";
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.failed,
        error: message,
      },
    });

    return NextResponse.json({ error: message, jobId, softFail: true }, { status: 409 });
  }

  const triggerType: TriggerType = job.triggerType;
  const triggeredBy =
    body.triggeredBy?.trim() ||
    (job.triggerType === "scheduled" && job.scheduleId
      ? `schedule:${job.scheduleId}`
      : job.triggerType === "manual"
        ? "manual"
        : "agent");

  try {
    const result = await publishDigest({
      title,
      html,
      stories: toPublishStories(stories),
      jobId,
      triggerType,
      triggeredBy,
    });

    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.completed,
        error: null,
      },
    });

    return NextResponse.json({
      ok: true,
      jobId,
      digestUrl: result.digestUrl,
      digestPath: result.digestPath,
      indexUrl: result.indexUrl,
      indexPath: result.indexPath,
      publishedPageId: result.publishedPageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.failed,
        error: message,
      },
    });

    return NextResponse.json({ error: message, jobId }, { status: 502 });
  }
}
