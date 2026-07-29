import { GenerationJobStatus, GenerationStepStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { failJobWithError } from "@/lib/generation-pipeline";
import { appendJobLogLine } from "@/lib/job-logs";
import { requireInternalApi } from "@/lib/require-internal";

type Body = {
  jobId?: string;
  stepId?: string;
  exitCode?: number;
};

/**
 * Called by the agent spawn wrapper after Cursor exits. If the step/job is still
 * marked running, the agent left without MCP completion — fail so Generate unlocks.
 * Delayed slightly by the wrapper to avoid racing a successful publish_digest_page.
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

  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (
    job.status === GenerationJobStatus.completed ||
    job.status === GenerationJobStatus.failed
  ) {
    return NextResponse.json({ ok: true, ignored: true, reason: `job_${job.status}` });
  }

  if (stepId) {
    const step = await prisma.generationStep.findFirst({
      where: { id: stepId, jobId },
      select: { id: true, status: true, kind: true, topicName: true },
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
  } else {
    const runningStep = await prisma.generationStep.findFirst({
      where: { jobId, status: GenerationStepStatus.running },
      select: { id: true },
    });
    // Multi-step job with no running step and job still running → odd; fail anyway if pending remains
    if (!runningStep) {
      const pending = await prisma.generationStep.count({
        where: { jobId, status: GenerationStepStatus.pending },
      });
      if (pending === 0) {
        // Legacy single-shot or all steps already completed waiting publish — if job running without steps done publish, fail
        const stepCount = await prisma.generationStep.count({ where: { jobId } });
        if (stepCount > 0) {
          return NextResponse.json({ ok: true, ignored: true, reason: "no_running_step" });
        }
      }
    }
  }

  const message =
    exitCode == null
      ? "Agent exited without completing this step."
      : `Agent exited without completing this step (exit code ${exitCode}).`;

  await failJobWithError(jobId, message);
  appendJobLogLine(jobId, message, stepId ?? undefined);

  return NextResponse.json({ ok: true, failed: true, jobId });
}
