import { GenerationJobStatus, GenerationStepStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { releaseAgentMutexBestEffort } from "@/lib/agent-mutex";
import {
  completeTopicPublishStep,
  failJobWithError,
  failTopicPublishStep,
  startStep,
} from "@/lib/generation-pipeline";
import { appendJobLogLine } from "@/lib/job-logs";
import { recordStepTokenUsage } from "@/lib/record-step-token-usage";
import { requireInternalApi } from "@/lib/require-internal";

type Body = {
  jobId?: string;
  stepId?: string;
  exitCode?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Called by the agent spawn wrapper after Cursor exits. If the step/job is still
 * marked running, the agent left without MCP completion — fail so Generate unlocks.
 * Delayed by the wrapper; we also recover when publish already wrote TopicPage,
 * and only abandon the current topic so later topics can still run.
 */
export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json()) as Body;
  const jobId = body.jobId?.trim() ?? "";
  const stepId = body.stepId?.trim() || null;
  const exitCode = typeof body.exitCode === "number" ? body.exitCode : null;

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const storyReview = await prisma.storyReview.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, telegraphUrl: true },
  });
  if (storyReview) {
    if (storyReview.status === "published" || storyReview.status === "failed") {
      releaseAgentMutexBestEffort();
      return NextResponse.json({ ok: true, ignored: true, kind: "story_review", status: storyReview.status });
    }
    if (storyReview.telegraphUrl) {
      await prisma.storyReview.update({
        where: { id: jobId },
        data: { status: "published", error: null },
      });
      releaseAgentMutexBestEffort();
      appendJobLogLine(jobId, "agent-exited recovered story review: telegraphUrl present");
      return NextResponse.json({ ok: true, recovered: true, kind: "story_review" });
    }

    // Publish/index can finish shortly after the agent process exits.
    await sleep(12_000);

    const afterWait = await prisma.storyReview.findUnique({
      where: { id: jobId },
      select: { status: true, telegraphUrl: true },
    });
    if (
      afterWait?.status === "published" ||
      (afterWait?.telegraphUrl && afterWait.telegraphUrl.trim())
    ) {
      if (afterWait.status !== "published") {
        await prisma.storyReview.update({
          where: { id: jobId },
          data: { status: "published", error: null },
        });
      }
      releaseAgentMutexBestEffort();
      appendJobLogLine(jobId, "agent-exited recovered story review after wait");
      return NextResponse.json({ ok: true, recovered: true, kind: "story_review" });
    }

    const code = exitCode;
    await prisma.storyReview.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error:
          code !== 0 && code !== null
            ? `Agent exited with code ${code} without publishing a review.`
            : "Agent exited without publishing a review.",
      },
    });
    releaseAgentMutexBestEffort();
    appendJobLogLine(jobId, `story review agent-exited failed (code=${code ?? "?"})`);
    return NextResponse.json({ ok: true, failed: true, kind: "story_review" });
  }

  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  });

  if (stepId) {
    try {
      await recordStepTokenUsage(jobId, stepId);
    } catch {
      // Usage recording must never block exit handling.
    }
  }

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (
    job.status === GenerationJobStatus.completed ||
    job.status === GenerationJobStatus.failed
  ) {
    releaseAgentMutexBestEffort();
    return NextResponse.json({ ok: true, ignored: true, reason: `job_${job.status}` });
  }

  // Publish often finishes after the agent process exits (Cursor exit code 1 is common).
  // If TopicPage already exists for this step, treat as success and advance.
  if (stepId) {
    const published = await prisma.topicPage.findFirst({
      where: { stepId, jobId },
      select: { id: true },
    });
    if (published) {
      const advanced = await completeTopicPublishStep(jobId, stepId);
      appendJobLogLine(
        jobId,
        `agent-exited recovered step ${stepId}: TopicPage already present`,
        stepId,
      );
      return NextResponse.json({
        ok: true,
        recovered: true,
        advanced: advanced.ok,
        jobId,
      });
    }
  }

  if (stepId) {
    let step = await prisma.generationStep.findFirst({
      where: { id: stepId, jobId },
      select: { id: true, status: true, kind: true, topicName: true, sortOrder: true },
    });

    if (!step) {
      return NextResponse.json({ ok: true, ignored: true, reason: "step_missing" });
    }

    if (step.status !== GenerationStepStatus.running) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: `step_${step.status}`,
      });
    }

    // Extra grace: publish/index can still be in flight after the wrapper delay.
    await sleep(12_000);

    step = await prisma.generationStep.findFirst({
      where: { id: stepId, jobId },
      select: { id: true, status: true, kind: true, topicName: true, sortOrder: true },
    });

    if (!step || step.status !== GenerationStepStatus.running) {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: step ? `step_${step.status}_after_wait` : "step_missing_after_wait",
      });
    }

    const publishedAfterWait = await prisma.topicPage.findFirst({
      where: { stepId, jobId },
      select: { id: true },
    });
    if (publishedAfterWait) {
      const advanced = await completeTopicPublishStep(jobId, stepId);
      appendJobLogLine(
        jobId,
        `agent-exited recovered step ${stepId} after wait: TopicPage present`,
        stepId,
      );
      return NextResponse.json({
        ok: true,
        recovered: true,
        advanced: advanced.ok,
        jobId,
      });
    }

    const message =
      exitCode == null
        ? "Agent exited without completing this step."
        : `Agent exited without completing this step (exit code ${exitCode}).`;

    await failTopicPublishStep(jobId, stepId, message);
    appendJobLogLine(jobId, message, stepId);

    // Continue remaining topics instead of aborting the whole job.
    const next = await prisma.generationStep.findFirst({
      where: { jobId, status: GenerationStepStatus.pending },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });

    if (next) {
      const started = await startStep(jobId, next.id);
      appendJobLogLine(
        jobId,
        started.ok
          ? `continued after step failure → next step ${next.id}`
          : `failed to continue after step failure: ${started.error}`,
      );
      return NextResponse.json({
        ok: true,
        failedStep: true,
        continued: started.ok,
        nextStepId: started.ok ? next.id : null,
        jobId,
      });
    }

    const completedSteps = await prisma.generationStep.count({
      where: { jobId, status: GenerationStepStatus.completed },
    });

    if (completedSteps > 0) {
      await prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: GenerationJobStatus.completed,
          error: message,
        },
      });
      appendJobLogLine(jobId, `job completed with step failures: ${message}`);
      releaseAgentMutexBestEffort();
      return NextResponse.json({ ok: true, failedStep: true, jobCompleted: true, jobId });
    }

    await failJobWithError(jobId, message);
    return NextResponse.json({ ok: true, failed: true, jobId });
  }

  // Legacy / missing stepId path
  const runningStep = await prisma.generationStep.findFirst({
    where: { jobId, status: GenerationStepStatus.running },
    select: { id: true },
  });
  if (!runningStep) {
    const pending = await prisma.generationStep.count({
      where: { jobId, status: GenerationStepStatus.pending },
    });
    if (pending === 0) {
      const stepCount = await prisma.generationStep.count({ where: { jobId } });
      if (stepCount > 0) {
        return NextResponse.json({ ok: true, ignored: true, reason: "no_running_step" });
      }
    }
  }

  const message =
    exitCode == null
      ? "Agent exited without completing this step."
      : `Agent exited without completing this step (exit code ${exitCode}).`;

  await failJobWithError(jobId, message);
  appendJobLogLine(jobId, message);

  return NextResponse.json({ ok: true, failed: true, jobId });
}
