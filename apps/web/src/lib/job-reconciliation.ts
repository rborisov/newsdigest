import { GenerationJobStatus, GenerationStepStatus, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "./db";
import { readJobLogTail } from "./job-logs";

/** Running jobs older than this are treated as abandoned (detached CLI spawn). */
export const STALE_RUNNING_JOB_MAX_AGE_MS = 30 * 60 * 1000;

export const STALE_JOB_ERROR =
  "Job timed out: still marked running after 30 minutes with no completion.";

export const AGENT_EXITED_WITHOUT_COMPLETION =
  "Agent exited without completing this step (job was still marked running).";

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
