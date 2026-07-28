import { GenerationJobStatus, TriggerType } from "@prisma/client";

import { prisma as defaultPrisma } from "./db";
import {
  createPipelineSteps,
  failJobWithError,
  startFirstPendingStep,
} from "./generation-pipeline";
import { reconcileStaleRunningJobs } from "./job-reconciliation";

export type TriggerGenerationInput = {
  triggerType: TriggerType;
  triggeredBy: string;
  scheduleId?: string | null;
};

export type TriggerGenerationResult =
  | { ok: true; jobId: string; pid: number }
  | { ok: false; error: string; status: number; jobId?: string };

export async function triggerGeneration(
  input: TriggerGenerationInput,
): Promise<TriggerGenerationResult> {
  await reconcileStaleRunningJobs(defaultPrisma);

  const active = await defaultPrisma.generationJob.findFirst({
    where: {
      status: { in: [GenerationJobStatus.pending, GenerationJobStatus.running] },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
  });

  if (active) {
    return {
      ok: false,
      error: `Generation already in progress (job ${active.id}, ${active.status}). Wait for it to finish.`,
      status: 409,
      jobId: active.id,
    };
  }

  const topics = await defaultPrisma.topic.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });

  if (topics.length === 0) {
    return {
      ok: false,
      error: "No enabled topics. Add or enable at least one topic in Admin.",
      status: 400,
    };
  }

  const job = await defaultPrisma.generationJob.create({
    data: {
      status: GenerationJobStatus.pending,
      triggerType: input.triggerType,
      scheduleId: input.scheduleId ?? null,
    },
  });

  try {
    await createPipelineSteps(job.id, topics, {
      spawnedBy: input.triggeredBy,
    });

    const started = await startFirstPendingStep(job.id, {
      spawnedBy: input.triggeredBy,
    });

    if (!started.ok) {
      await failJobWithError(job.id, started.error);
      return {
        ok: false,
        error: started.error,
        status: 503,
        jobId: job.id,
      };
    }

    return { ok: true, jobId: job.id, pid: started.pid };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger generation.";
    await failJobWithError(job.id, message);

    return {
      ok: false,
      error: message,
      status: 500,
      jobId: job.id,
    };
  }
}
