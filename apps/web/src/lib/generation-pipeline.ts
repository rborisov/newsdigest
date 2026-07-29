import {
  GenerationJobStatus,
  GenerationStepKind,
  GenerationStepStatus,
  type PrismaClient,
  type Topic,
} from "@prisma/client";

import { spawnAgent as defaultSpawnAgent } from "./cursor";
import type { StoryFingerprint } from "./dedup";
import { normalizeStoryFingerprints } from "./dedup";
import { prisma as defaultPrisma } from "./db";
import { appendJobLogLine, jobLogPath } from "./job-logs";
import { buildTopicPublishPrompt } from "./prompt";

export type PipelineDeps = {
  prisma?: PrismaClient;
  now?: Date;
  spawnedBy?: string;
  spawnAgent?: typeof defaultSpawnAgent;
};

function db(deps: PipelineDeps): PrismaClient {
  return deps.prisma ?? defaultPrisma;
}

export async function createPipelineSteps(
  jobId: string,
  topics: Pick<Topic, "id" | "name">[],
  deps: PipelineDeps = {},
): Promise<void> {
  const client = db(deps);
  if (topics.length === 0) {
    throw new Error("No enabled topics — cannot start generation.");
  }

  await client.generationStep.createMany({
    data: topics.map((topic, index) => ({
      jobId,
      kind: GenerationStepKind.topic_publish,
      status: GenerationStepStatus.pending,
      sortOrder: index,
      topicId: topic.id,
      topicName: topic.name,
    })),
  });
}

export async function failJobWithError(
  jobId: string,
  error: string,
  deps: PipelineDeps = {},
): Promise<void> {
  const client = db(deps);
  await client.$transaction([
    client.generationStep.updateMany({
      where: {
        jobId,
        status: GenerationStepStatus.pending,
      },
      data: {
        status: GenerationStepStatus.failed,
        error: "Skipped: job failed.",
      },
    }),
    client.generationStep.updateMany({
      where: {
        jobId,
        status: GenerationStepStatus.running,
      },
      data: {
        status: GenerationStepStatus.failed,
        error,
      },
    }),
    client.generationJob.update({
      where: { id: jobId },
      data: {
        status: GenerationJobStatus.failed,
        error,
      },
    }),
  ]);
  appendJobLogLine(jobId, `job failed: ${error}`);
}

async function markStepRunning(stepId: string, deps: PipelineDeps = {}) {
  const client = db(deps);
  await client.generationStep.update({
    where: { id: stepId },
    data: {
      status: GenerationStepStatus.running,
      error: null,
    },
  });
}

/**
 * Spawns the Cursor agent for a pending/running step and marks job+step running.
 */
export async function startStep(
  jobId: string,
  stepId: string,
  deps: PipelineDeps = {},
): Promise<{ ok: true; pid: number } | { ok: false; error: string }> {
  const client = db(deps);
  const step = await client.generationStep.findFirst({
    where: { id: stepId, jobId },
  });

  if (!step) {
    return { ok: false, error: "Generation step not found." };
  }

  if (
    step.status !== GenerationStepStatus.pending &&
    step.status !== GenerationStepStatus.running
  ) {
    return { ok: false, error: `Step is ${step.status}; cannot start.` };
  }

  if (step.kind !== GenerationStepKind.topic_publish) {
    return { ok: false, error: `Unsupported step kind: ${step.kind}.` };
  }

  if (!step.topicId || !step.topicName) {
    return { ok: false, error: "Topic publish step is missing topic metadata." };
  }

  let prompt: string;
  try {
    const topic = await client.topic.findUnique({ where: { id: step.topicId } });
    if (!topic) {
      return { ok: false, error: `Topic ${step.topicName} no longer exists.` };
    }
    prompt = await buildTopicPublishPrompt(
      jobId,
      step.id,
      topic,
      deps,
      deps.spawnedBy,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build step prompt.";
    await failJobWithError(jobId, message, deps);
    return { ok: false, error: message };
  }

  await markStepRunning(stepId, deps);
  await client.generationJob.update({
    where: { id: jobId },
    data: { status: GenerationJobStatus.running, error: null },
  });

  appendJobLogLine(
    jobId,
    `starting step ${step.sortOrder} (topic_publish:${step.topicName}) → log ${jobLogPath(jobId, step.id)}`,
  );

  const spawn = deps.spawnAgent ?? defaultSpawnAgent;
  const spawnResult = spawn(prompt, jobId, step.id);
  if (!spawnResult.ok) {
    await client.generationStep.update({
      where: { id: stepId },
      data: {
        status: GenerationStepStatus.failed,
        error: spawnResult.error,
      },
    });
    await failJobWithError(jobId, spawnResult.error, deps);
    return { ok: false, error: spawnResult.error };
  }

  appendJobLogLine(jobId, `step ${step.sortOrder} agent wrapper pid=${spawnResult.pid}`);
  return { ok: true, pid: spawnResult.pid };
}

export async function startFirstPendingStep(
  jobId: string,
  deps: PipelineDeps = {},
): Promise<{ ok: true; pid: number; stepId: string } | { ok: false; error: string }> {
  const client = db(deps);
  const step = await client.generationStep.findFirst({
    where: { jobId, status: GenerationStepStatus.pending },
    orderBy: { sortOrder: "asc" },
  });

  if (!step) {
    return { ok: false, error: "No pending generation steps." };
  }

  const started = await startStep(jobId, step.id, deps);
  if (!started.ok) {
    return started;
  }
  return { ok: true, pid: started.pid, stepId: step.id };
}

export type CompleteTopicPublishResult =
  | {
      ok: true;
      jobCompleted: boolean;
      advanced: boolean;
      nextStepId: string | null;
      pid?: number;
    }
  | { ok: false; error: string };

/**
 * Marks the current topic_publish step completed and starts the next pending step,
 * or completes the job when no steps remain.
 */
export async function completeTopicPublishStep(
  jobId: string,
  stepId: string,
  deps: PipelineDeps = {},
  options: { note?: string } = {},
): Promise<CompleteTopicPublishResult> {
  const client = db(deps);
  const step = await client.generationStep.findFirst({
    where: { id: stepId, jobId },
  });

  if (!step) {
    return { ok: false, error: "Generation step not found." };
  }

  if (step.status !== GenerationStepStatus.completed) {
    await client.generationStep.update({
      where: { id: stepId },
      data: {
        status: GenerationStepStatus.completed,
        error: options.note ?? null,
      },
    });

    appendJobLogLine(
      jobId,
      options.note
        ? `step ${step.sortOrder} topic_publish:${step.topicName} skipped (${options.note})`
        : `step ${step.sortOrder} topic_publish:${step.topicName} completed`,
    );
  }

  const next = await client.generationStep.findFirst({
    where: { jobId, status: GenerationStepStatus.pending },
    orderBy: { sortOrder: "asc" },
  });

  if (next) {
    const started = await startStep(jobId, next.id, deps);
    if (!started.ok) {
      return { ok: false, error: started.error };
    }
    return {
      ok: true,
      jobCompleted: false,
      advanced: true,
      nextStepId: next.id,
      pid: started.pid,
    };
  }

  const running = await client.generationStep.count({
    where: { jobId, status: GenerationStepStatus.running },
  });

  if (running > 0) {
    return { ok: true, jobCompleted: false, advanced: false, nextStepId: null };
  }

  await client.generationJob.update({
    where: { id: jobId },
    data: { status: GenerationJobStatus.completed, error: null },
  });
  appendJobLogLine(jobId, "job completed");

  return { ok: true, jobCompleted: true, advanced: false, nextStepId: null };
}

export async function failTopicPublishStep(
  jobId: string,
  stepId: string | null,
  error: string,
  deps: PipelineDeps = {},
): Promise<void> {
  const client = db(deps);
  if (stepId) {
    await client.generationStep.updateMany({
      where: {
        id: stepId,
        jobId,
        status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
      },
      data: {
        status: GenerationStepStatus.failed,
        error,
      },
    });
  } else {
    await client.generationStep.updateMany({
      where: {
        jobId,
        kind: GenerationStepKind.topic_publish,
        status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
      },
      data: {
        status: GenerationStepStatus.failed,
        error,
      },
    });
  }
}

function parseStoriesJson(raw: string | null | undefined): StoryFingerprint[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeStoryFingerprints(
      parsed.map((item) => {
        const row = item as { title?: string; canonicalUrl?: string | null; titleKey?: string };
        return {
          title: row.title ?? "",
          canonicalUrl: row.canonicalUrl ?? null,
          titleKey: row.titleKey,
        };
      }),
    );
  } catch {
    return [];
  }
}

export { parseStoriesJson };
