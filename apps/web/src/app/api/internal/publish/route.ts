import { GenerationJobStatus, GenerationStepKind, GenerationStepStatus, TriggerType } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  enrichStoriesFromHtml,
  loadKnownStories,
  normalizeStoryFingerprints,
  parseStoriesFromHtml,
  type StoryFingerprint,
} from "@/lib/dedup";
import { prisma } from "@/lib/db";
import {
  completeTopicPublishStep,
  failTopicPublishStep,
} from "@/lib/generation-pipeline";
import {
  buildExistingPublishResponse,
  getPublishSoftFailReason,
  needsIndexLinkResume,
  PUBLISH_SOFT_FAIL_MESSAGES,
  shouldReturnExistingPublish,
  shouldReturnLegacyPublish,
} from "@/lib/publish-validation";
import { requireInternalApi } from "@/lib/require-internal";
import {
  linkDigestToIndex,
  publishDigest,
  type PublishStoryInput,
} from "@/lib/telegraph";

type PublishRequestBody = {
  jobId?: string;
  stepId?: string;
  topicId?: string | null;
  topicName?: string;
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

async function findExistingTopicPage(params: {
  stepId: string | null;
  jobId: string;
  topicId: string | null;
  topicName: string;
}) {
  if (params.stepId) {
    return prisma.topicPage.findUnique({
      where: { stepId: params.stepId },
      include: { indexPage: true },
    });
  }

  return prisma.topicPage.findFirst({
    where: {
      jobId: params.jobId,
      ...(params.topicId
        ? { topicId: params.topicId }
        : { topicName: params.topicName }),
    },
    orderBy: { publishedAt: "desc" },
    include: { indexPage: true },
  });
}

async function resolveTopicPublishStepId(
  jobId: string,
  stepId: string | null,
  topicName: string,
): Promise<string | null> {
  if (stepId) {
    return stepId;
  }

  const step = await prisma.generationStep.findFirst({
    where: {
      jobId,
      kind: GenerationStepKind.topic_publish,
      status: {
        in: [GenerationStepStatus.running, GenerationStepStatus.pending],
      },
      topicName,
    },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });

  return step?.id ?? null;
}

async function advanceAfterPublish(
  jobId: string,
  stepId: string | null,
  topicName: string,
  note?: string,
) {
  const resolvedStepId = await resolveTopicPublishStepId(jobId, stepId, topicName);
  if (!resolvedStepId) {
    return null;
  }

  return completeTopicPublishStep(jobId, resolvedStepId, {}, note ? { note } : {});
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
  let stepId = body.stepId?.trim() || null;
  let topicId = body.topicId?.trim() || null;
  let topicName = body.topicName?.trim() ?? "";

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }
  if (!html) {
    return NextResponse.json({ error: "htmlContent is required." }, { status: 400 });
  }

  if (stepId) {
    const step = await prisma.generationStep.findUnique({ where: { id: stepId } });
    if (!step || step.jobId !== jobId) {
      return NextResponse.json({ error: "Generation step not found." }, { status: 404 });
    }
    topicId = topicId ?? step.topicId;
    topicName = topicName || step.topicName || "";
  }

  if (!topicName) {
    return NextResponse.json({ error: "topicName is required." }, { status: 400 });
  }

  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: {
      publishedPage: {
        include: {
          indexPage: true,
        },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Generation job not found." }, { status: 404 });
  }

  const existingTopicPage = await findExistingTopicPage({
    stepId,
    jobId,
    topicId,
    topicName,
  });

  if (shouldReturnExistingPublish(existingTopicPage)) {
    const page = existingTopicPage!;
    const meta = await prisma.telegraphMeta.findUnique({ where: { id: "default" } });
    const indexUrl = page.indexPage?.telegraphUrl ?? meta?.currentIndexUrl ?? "";
    const indexPath = page.indexPage?.telegraphPath ?? meta?.currentIndexPath ?? "";

    const advance = await advanceAfterPublish(jobId, stepId, topicName);

    return NextResponse.json({
      ...buildExistingPublishResponse(jobId, {
        topicPageId: page.id,
        digestUrl: page.telegraphUrl,
        digestPath: page.telegraphPath,
        indexUrl,
        indexPath,
      }),
      ...(advance?.ok && advance.advanced ? { advanced: true, nextStepId: advance.nextStepId } : {}),
      ...(advance?.ok && advance.jobCompleted ? { jobCompleted: true } : {}),
    });
  }

  if (shouldReturnLegacyPublish(job.status, job.publishedPage)) {
    const page = job.publishedPage!;
    const meta = await prisma.telegraphMeta.findUnique({ where: { id: "default" } });
    const indexUrl = page.indexPage?.telegraphUrl ?? meta?.currentIndexUrl ?? "";
    const indexPath = page.indexPage?.telegraphPath ?? meta?.currentIndexPath ?? "";

    return NextResponse.json({
      ok: true,
      jobId,
      idempotent: true,
      digestUrl: page.telegraphUrl,
      digestPath: page.telegraphPath,
      indexUrl,
      indexPath,
      publishedPageId: page.id,
    });
  }

  if (job.status === GenerationJobStatus.completed && !existingTopicPage && !job.publishedPage) {
    return NextResponse.json(
      { error: "Job already completed but published page is missing.", jobId },
      { status: 409 },
    );
  }

  if (needsIndexLinkResume(existingTopicPage)) {
    try {
      const page = existingTopicPage!;
      const index = await linkDigestToIndex(page.id);
      const advance = await advanceAfterPublish(jobId, stepId, topicName);

      if (advance && !advance.ok) {
        return NextResponse.json({ error: advance.error, jobId }, { status: 503 });
      }

      return NextResponse.json({
        ok: true,
        jobId,
        resumed: true,
        digestUrl: page.telegraphUrl,
        digestPath: page.telegraphPath,
        indexUrl: index.indexUrl,
        indexPath: index.indexPath,
        topicPageId: page.id,
        publishedPageId: page.id,
        ...(advance?.ok && advance.advanced ? { advanced: true, nextStepId: advance.nextStepId } : {}),
        ...(advance?.ok && advance.jobCompleted ? { jobCompleted: true } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publish failed.";
      await failTopicPublishStep(jobId, stepId, message);
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

  if (needsIndexLinkResume(job.publishedPage)) {
    try {
      const page = job.publishedPage!;
      const index = await linkDigestToIndex(page.id);

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
        resumed: true,
        digestUrl: page.telegraphUrl,
        digestPath: page.telegraphPath,
        indexUrl: index.indexUrl,
        indexPath: index.indexPath,
        publishedPageId: page.id,
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

  const stories = enrichStoriesFromHtml(
    body.stories && body.stories.length > 0
      ? normalizeStoryFingerprints(body.stories)
      : parseStoriesFromHtml(html),
    html,
  );

  const knownStories = await loadKnownStories(prisma);

  const softFailReason = getPublishSoftFailReason(stories, knownStories);
  if (softFailReason) {
    const message = PUBLISH_SOFT_FAIL_MESSAGES[softFailReason];
    const advance = await advanceAfterPublish(jobId, stepId, topicName, message);

    if (advance && !advance.ok) {
      return NextResponse.json({ error: advance.error, jobId }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      jobId,
      softFail: true,
      reason: softFailReason,
      message,
      ...(advance?.ok && advance.advanced ? { advanced: true, nextStepId: advance.nextStepId } : {}),
      ...(advance?.ok && advance.jobCompleted ? { jobCompleted: true } : {}),
    });
  }

  const otherInProgressPublish = await prisma.topicPage.findFirst({
    where: {
      indexPageId: null,
      ...(stepId
        ? { NOT: { stepId } }
        : {
            NOT: {
              jobId,
              topicName,
            },
          }),
    },
    select: { id: true, jobId: true },
  });

  if (otherInProgressPublish) {
    return NextResponse.json(
      {
        error: "Another publish is in progress; retry after it finishes linking to the index.",
        jobId,
        conflictingTopicPageId: otherInProgressPublish.id,
        conflictingJobId: otherInProgressPublish.jobId,
      },
      { status: 409 },
    );
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
      topicId,
      topicName,
      stepId,
      triggerType,
      triggeredBy,
    });

    const advance = await advanceAfterPublish(jobId, stepId, topicName);

    if (advance && !advance.ok) {
      return NextResponse.json({ error: advance.error, jobId }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      jobId,
      digestUrl: result.digestUrl,
      digestPath: result.digestPath,
      indexUrl: result.indexUrl,
      indexPath: result.indexPath,
      topicPageId: result.topicPageId,
      publishedPageId: result.topicPageId,
      ...(advance?.ok && advance.advanced ? { advanced: true, nextStepId: advance.nextStepId } : {}),
      ...(advance?.ok && advance.jobCompleted ? { jobCompleted: true } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    await failTopicPublishStep(jobId, stepId, message);
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
