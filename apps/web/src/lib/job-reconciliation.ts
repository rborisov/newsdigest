import { GenerationJobStatus, GenerationStepStatus, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "./db";
import { readJobLogTail } from "./job-logs";

/** Running jobs older than this are treated as abandoned (detached CLI spawn). */
export const STALE_RUNNING_JOB_MAX_AGE_MS = 30 * 60 * 1000;

export const STALE_JOB_ERROR =
  "Job timed out: still marked running after 30 minutes with no completion.";

export const STALE_REVIEW_ERROR =
  "Review timed out: still marked running after 30 minutes with no publish.";

export const AGENT_EXITED_WITHOUT_COMPLETION =
  "Agent exited without completing this step (job was still marked running).";

export const REVIEW_AGENT_EXITED_WITHOUT_PUBLISH =
  "Agent exited without publishing a review (review was still marked running).";

const RUNNING_REVIEW_STATUSES = ["pending", "running"] as const;

export function isStaleRunningJob(
  updatedAt: Date,
  now: Date = new Date(),
  maxAgeMs: number = STALE_RUNNING_JOB_MAX_AGE_MS,
): boolean {
  return now.getTime() - updatedAt.getTime() >= maxAgeMs;
}

export function logShowsAgentExited(logTail: string): boolean {
  return /agent exited with code=\d+/i.test(logTail);
}

async function failJobsByIds(
  db: PrismaClient,
  ids: string[],
  error: string,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  await db.$transaction([
    db.generationStep.updateMany({
      where: {
        jobId: { in: ids },
        status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
      },
      data: {
        status: GenerationStepStatus.failed,
        error,
      },
    }),
    db.generationJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: GenerationJobStatus.failed,
        error,
      },
    }),
  ]);

  return ids.length;
}

/**
 * Marks long-running jobs as failed so a detached Cursor CLI spawn that never
 * reconciles cannot block the portal forever. Call before starting new work.
 * Also fails open pipeline steps. Touches of job.updatedAt on each step start
 * reset the stale clock for multi-step digests.
 */
export async function reconcileStaleRunningJobs(
  db: PrismaClient = defaultPrisma,
  options?: { now?: Date; maxAgeMs?: number },
): Promise<number> {
  const now = options?.now ?? new Date();
  const maxAgeMs = options?.maxAgeMs ?? STALE_RUNNING_JOB_MAX_AGE_MS;
  const cutoff = new Date(now.getTime() - maxAgeMs);

  const staleJobs = await db.generationJob.findMany({
    where: {
      status: GenerationJobStatus.running,
      updatedAt: { lte: cutoff },
    },
    select: { id: true },
  });

  return failJobsByIds(
    db,
    staleJobs.map((job) => job.id),
    STALE_JOB_ERROR,
  );
}

/**
 * Fail jobs whose agent already exited (log line) but status was left running —
 * e.g. environment-blocked runs that exit 0 without publish/MCP.
 * Only inspects the current running step log (or parent log for legacy single-shot jobs).
 */
export async function reconcileExitedButRunningJobs(
  db: PrismaClient = defaultPrisma,
): Promise<number> {
  const running = await db.generationJob.findMany({
    where: { status: GenerationJobStatus.running },
    select: {
      id: true,
      steps: {
        where: { status: GenerationStepStatus.running },
        select: { id: true },
        take: 1,
      },
    },
  });

  const toFail: string[] = [];
  for (const job of running) {
    const runningStep = job.steps[0];
    const log = runningStep
      ? readJobLogTail(job.id, 40, runningStep.id)
      : readJobLogTail(job.id, 40);
    if (logShowsAgentExited(log)) {
      toFail.push(job.id);
    }
  }

  return failJobsByIds(db, toFail, AGENT_EXITED_WITHOUT_COMPLETION);
}

/** Run all automatic job cleanups (stale timeout + exited-without-complete). */
export async function reconcileAbandonedJobs(
  db: PrismaClient = defaultPrisma,
  options?: { now?: Date; maxAgeMs?: number },
): Promise<number> {
  const stale = await reconcileStaleRunningJobs(db, options);
  const exited = await reconcileExitedButRunningJobs(db);
  return stale + exited;
}

async function failStoryReviewsByIds(
  db: PrismaClient,
  ids: string[],
  error: string,
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  await db.storyReview.updateMany({
    where: { id: { in: ids } },
    data: { status: "failed", error },
  });

  return ids.length;
}

/**
 * Fail story reviews stuck in pending/running (detached agent never reconciled).
 */
export async function reconcileStaleRunningStoryReviews(
  db: PrismaClient = defaultPrisma,
  options?: { now?: Date; maxAgeMs?: number },
): Promise<number> {
  const now = options?.now ?? new Date();
  const maxAgeMs = options?.maxAgeMs ?? STALE_RUNNING_JOB_MAX_AGE_MS;
  const cutoff = new Date(now.getTime() - maxAgeMs);

  const stale = await db.storyReview.findMany({
    where: {
      status: { in: [...RUNNING_REVIEW_STATUSES] },
      updatedAt: { lte: cutoff },
    },
    select: { id: true },
  });

  return failStoryReviewsByIds(
    db,
    stale.map((row) => row.id),
    STALE_REVIEW_ERROR,
  );
}

/**
 * Fail (or recover) story reviews whose agent log shows exit but DB still running.
 */
export async function reconcileExitedButRunningStoryReviews(
  db: PrismaClient = defaultPrisma,
): Promise<number> {
  const running = await db.storyReview.findMany({
    where: { status: { in: [...RUNNING_REVIEW_STATUSES] } },
    select: { id: true, telegraphUrl: true },
  });

  let changed = 0;
  for (const review of running) {
    const log = readJobLogTail(review.id, 40);
    if (!logShowsAgentExited(log)) {
      continue;
    }

    if (review.telegraphUrl.trim()) {
      await db.storyReview.update({
        where: { id: review.id },
        data: { status: "published", error: null },
      });
      changed += 1;
      continue;
    }

    await db.storyReview.update({
      where: { id: review.id },
      data: { status: "failed", error: REVIEW_AGENT_EXITED_WITHOUT_PUBLISH },
    });
    changed += 1;
  }

  return changed;
}

/** Run story review cleanups before start/poll. */
export async function reconcileAbandonedStoryReviews(
  db: PrismaClient = defaultPrisma,
  options?: { now?: Date; maxAgeMs?: number },
): Promise<number> {
  const stale = await reconcileStaleRunningStoryReviews(db, options);
  const exited = await reconcileExitedButRunningStoryReviews(db);
  return stale + exited;
}
