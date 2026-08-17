import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { readJobLogTail } from "@/lib/job-logs";
import { reconcileAbandonedJobs, reconcileAbandonedStoryReviews } from "@/lib/job-reconciliation";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  // Unlock Generate when agent already exited or job is stale (home page polls this).
  await reconcileAbandonedJobs();
  await reconcileAbandonedStoryReviews();

  const jobs = await prisma.generationJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      status: true,
      triggerType: true,
      error: true,
      createdAt: true,
      updatedAt: true,
      publishedPage: {
        select: {
          title: true,
          telegraphUrl: true,
        },
      },
      steps: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          kind: true,
          status: true,
          sortOrder: true,
          topicName: true,
          error: true,
          updatedAt: true,
        },
      },
    },
  });

  const now = Date.now();
  const enriched = jobs.map((job) => {
    const createdMs = job.createdAt.getTime();
    const updatedMs = job.updatedAt.getTime();
    const elapsedSec = Math.max(0, Math.floor((now - createdMs) / 1000));
    const idleSec = Math.max(0, Math.floor((now - updatedMs) / 1000));
    const logTail = readJobLogTail(job.id, 50);
    const runningStep = job.steps.find((step) => step.status === "running");
    const activeStepLog = runningStep ? readJobLogTail(job.id, 40, runningStep.id) : "";

    return {
      id: job.id,
      status: job.status,
      triggerType: job.triggerType,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      publishedPage: job.publishedPage,
      elapsedSec,
      idleSec,
      logTail,
      hasLog: logTail.length > 0,
      steps: job.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        status: step.status,
        sortOrder: step.sortOrder,
        topicName: step.topicName,
        error: step.error,
        updatedAt: step.updatedAt.toISOString(),
        logTail: readJobLogTail(job.id, 30, step.id),
      })),
      activeStepLog,
    };
  });

  return NextResponse.json({ jobs: enriched, serverTime: new Date().toISOString() });
}
