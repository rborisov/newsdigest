import { GenerationJobStatus, PrismaClient } from "@prisma/client";

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
 */
export async function reconcileStaleRunningJobs(
  db: PrismaClient = defaultPrisma,
  options?: { now?: Date; maxAgeMs?: number },
): Promise<number> {
  const now = options?.now ?? new Date();
  const maxAgeMs = options?.maxAgeMs ?? STALE_RUNNING_JOB_MAX_AGE_MS;
  const cutoff = new Date(now.getTime() - maxAgeMs);

  const result = await db.generationJob.updateMany({
    where: {
      status: GenerationJobStatus.running,
      updatedAt: { lte: cutoff },
    },
    data: {
      status: GenerationJobStatus.failed,
      error: STALE_JOB_ERROR,
    },
  });

  return result.count;
}
