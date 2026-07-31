import { GenerationJobStatus, TriggerType } from "@prisma/client";

import { tryAcquireAgentMutex } from "./agent-mutex";
import { prisma as defaultPrisma } from "./db";
import {
  createPipelineSteps,
  failJobWithError,
  startFirstPendingStep,
} from "./generation-pipeline";
import { reconcileAbandonedJobs } from "./job-reconciliation";

export type TriggerGenerationInput = {
  triggerType: TriggerType;
  triggeredBy: string;
  scheduleId?: string | null;
  /** When set, run a job for this topic only (manual single-topic test). */
  topicId?: string | null;
};

export type TriggerGenerationResult =
  | { ok: true; jobId: string; pid: number }
  | { ok: false; error: string; status: number; jobId?: string };

export async function triggerGeneration(
  input: TriggerGenerationInput,
): Promise<TriggerGenerationResult> {
  await reconcileAbandonedJobs(defaultPrisma);

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

  const scheduleId = input.scheduleId?.trim() || null;
  const topicId = input.topicId?.trim() || null;
  let topics: { id: string; name: string }[];

  if (topicId) {
    if (scheduleId) {
      return {
        ok: false,
        error: "Pass either topicId or scheduleId, not both.",
        status: 400,
      };
    }

    const topic = await defaultPrisma.topic.findUnique({
      where: { id: topicId },
      select: { id: true, name: true, enabled: true, keywords: true },
    });
    if (!topic) {
      return { ok: false, error: "Topic not found.", status: 404 };
    }
    if (!topic.enabled) {
      return {
        ok: false,
        error: `Topic "${topic.name}" is disabled. Enable it before generating.`,
        status: 400,
      };
    }
    if (!topic.keywords.trim()) {
      return {
        ok: false,
        error: `Topic "${topic.name}" needs keywords / notes before generating.`,
        status: 400,
      };
    }

    topics = [{ id: topic.id, name: topic.name }];
  } else if (scheduleId) {
    const schedule = await defaultPrisma.schedule.findUnique({
      where: { id: scheduleId },
      select: { id: true, isDefault: true, enabled: true, name: true },
    });
    if (!schedule) {
      return { ok: false, error: "Schedule not found.", status: 404 };
    }
    if (!schedule.enabled) {
      return {
        ok: false,
        error: `Schedule "${schedule.name}" is disabled.`,
        status: 400,
      };
    }

    topics = await defaultPrisma.topic.findMany({
      where: {
        enabled: true,
        OR: schedule.isDefault
          ? [{ scheduleId: schedule.id }, { scheduleId: null }]
          : [{ scheduleId: schedule.id }],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });

    if (topics.length === 0) {
      return {
        ok: false,
        error: schedule.isDefault
          ? "No enabled topics for the default schedule (unassigned or linked)."
          : `No enabled topics linked to schedule "${schedule.name}".`,
        status: 400,
      };
    }
  } else {
    // Manual / ad-hoc: all enabled topics
    topics = await defaultPrisma.topic.findMany({
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
  }

  const mutex = tryAcquireAgentMutex(`newsdigest:${input.triggeredBy}`);
  if (!mutex.ok) {
    return {
      ok: false,
      error: mutex.error,
      status: 409,
    };
  }

  const job = await defaultPrisma.generationJob.create({
    data: {
      status: GenerationJobStatus.pending,
      triggerType: input.triggerType,
      scheduleId,
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

    // Held until job completed/failed (released in generation-pipeline).
    void mutex;
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
