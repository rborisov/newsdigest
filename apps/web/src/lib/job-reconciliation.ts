import { GenerationJobStatus, GenerationStepStatus, PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "./db";

/** Running jobs older than this are treated as abandoned (detached CLI spawn). */
export const STALE_RUNNING_JOB_MAX_AGE_MS = 30 * 60 * 1000;

export const STALE_JOB_ERROR =
  "Job timed out: still marked running after 30 minutes with no completion.";

export function isStaleRunningJob(
  updatedAt: Date,
  now: Date = new Date(),
  maxAgeMs: number = STALE_RUNNING_JOB_MAX_AGE_MS,
): boolean {
  return now.getTime() - updatedAt.getTime() >= maxAgeMs;
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

  if (staleJobs.length === 0) {
    return 0;
  }

  const ids = staleJobs.map((job) => job.id);

  await db.$transaction([
    db.generationStep.updateMany({
      where: {
        jobId: { in: ids },
        status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
      },
      data: {
        status: GenerationStepStatus.failed,
        error: STALE_JOB_ERROR,
      },
    }),
    db.generationJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: GenerationJobStatus.failed,
        error: STALE_JOB_ERROR,
      },
    }),
  ]);

  return staleJobs.length;
}
