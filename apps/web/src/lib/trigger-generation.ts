import { GenerationJobStatus, TriggerType } from "@prisma/client";

import { spawnAgent } from "./cursor";
import { prisma as defaultPrisma } from "./db";
import { reconcileStaleRunningJobs } from "./job-reconciliation";
import { buildPrompt } from "./prompt";

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

  const job = await defaultPrisma.generationJob.create({
    data: {
      status: GenerationJobStatus.pending,
      triggerType: input.triggerType,
      scheduleId: input.scheduleId ?? null,
    },
  });

  try {
    const prompt = await buildPrompt(job.id, {}, input.triggeredBy);

    const spawnResult = spawnAgent(prompt);
    if (!spawnResult.ok) {
      await defaultPrisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: GenerationJobStatus.failed,
          error: spawnResult.error,
        },
      });

      return {
        ok: false,
        error: spawnResult.error,
        status: 503,
        jobId: job.id,
      };
    }

    await defaultPrisma.generationJob.update({
      where: { id: job.id },
      data: { status: GenerationJobStatus.running },
    });

    return { ok: true, jobId: job.id, pid: spawnResult.pid };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger generation.";
    await defaultPrisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: GenerationJobStatus.failed,
        error: message,
      },
    });

    return {
      ok: false,
      error: message,
      status: 500,
      jobId: job.id,
    };
  }
}
