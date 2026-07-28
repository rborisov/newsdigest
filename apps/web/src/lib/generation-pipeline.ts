import {
  GenerationJobStatus,
  GenerationStepKind,
  GenerationStepStatus,
  type PrismaClient,
  type Topic,
} from "@prisma/client";

import { spawnAgent } from "./cursor";
import type { StoryFingerprint } from "./dedup";
import { normalizeStoryFingerprints } from "./dedup";
import { prisma as defaultPrisma } from "./db";
import { appendJobLogLine, jobLogPath } from "./job-logs";
import {
  buildMergePublishPrompt,
  buildTopicDraftPrompt,
} from "./prompt";

export type PipelineDeps = {
  prisma?: PrismaClient;
  now?: Date;
  spawnedBy?: string;
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
    data: [
      ...topics.map((topic, index) => ({
        jobId,
        kind: GenerationStepKind.topic_draft,
        status: GenerationStepStatus.pending,
        sortOrder: index,
        topicId: topic.id,
        topicName: topic.name,
      })),
      {
        jobId,
        kind: GenerationStepKind.merge_publish,
        status: GenerationStepStatus.pending,
        sortOrder: topics.length,
        topicId: null,
        topicName: null,
      },
    ],
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

  let prompt: string;
  try {
    if (step.kind === GenerationStepKind.topic_draft) {
      if (!step.topicId || !step.topicName) {
        return { ok: false, error: "Topic draft step is missing topic metadata." };
      }
      const topic = await client.topic.findUnique({ where: { id: step.topicId } });
      if (!topic) {
        return { ok: false, error: `Topic ${step.topicName} no longer exists.` };
      }
      prompt = await buildTopicDraftPrompt(jobId, topic, deps, deps.spawnedBy);
    } else {
      const drafts = await client.generationStep.findMany({
        where: {
          jobId,
          kind: GenerationStepKind.topic_draft,
          status: GenerationStepStatus.completed,
        },
        orderBy: { sortOrder: "asc" },
        select: {
          topicName: true,
          draftHtml: true,
          draftStoriesJson: true,
        },
      });
      prompt = await buildMergePublishPrompt(
        jobId,
        drafts.map((draft) => ({
          topicName: draft.topicName ?? "Topic",
          html: draft.draftHtml ?? "",
          storiesJson: draft.draftStoriesJson,
        })),
        deps,
        deps.spawnedBy,
      );
    }
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

  const label =
    step.kind === GenerationStepKind.topic_draft
      ? `topic_draft:${step.topicName}`
      : "merge_publish";
  appendJobLogLine(jobId, `starting step ${step.sortOrder} (${label}) → log ${jobLogPath(jobId, step.id)}`);

  const spawnResult = spawnAgent(prompt, jobId, step.id);
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

export type SaveTopicDraftInput = {
  jobId: string;
  topic: string;
  html: string;
  stories?: StoryFingerprint[];
};

export type SaveTopicDraftResult =
  | {
      ok: true;
      jobId: string;
      stepId: string;
      nextStepId: string | null;
      nextKind: GenerationStepKind | null;
      advanced: boolean;
      pid?: number;
    }
  | { ok: false; error: string; status: number };

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

export async function saveTopicDraft(
  input: SaveTopicDraftInput,
  deps: PipelineDeps = {},
): Promise<SaveTopicDraftResult> {
  const client = db(deps);
  const jobId = input.jobId.trim();
  const topic = input.topic.trim();
  const html = input.html.trim();

  if (!jobId) {
    return { ok: false, error: "jobId is required.", status: 400 };
  }
  if (!topic) {
    return { ok: false, error: "topic is required.", status: 400 };
  }
  if (!html) {
    return { ok: false, error: "html is required.", status: 400 };
  }

  const job = await client.generationJob.findUnique({ where: { id: jobId } });
  if (!job) {
    return { ok: false, error: "Generation job not found.", status: 404 };
  }
  if (job.status === GenerationJobStatus.failed) {
    return { ok: false, error: "Job already failed.", status: 409 };
  }
  if (job.status === GenerationJobStatus.completed) {
    return { ok: false, error: "Job already completed.", status: 409 };
  }

  const steps = await client.generationStep.findMany({
    where: { jobId, kind: GenerationStepKind.topic_draft },
    orderBy: { sortOrder: "asc" },
  });

  const topicKey = topic.toLowerCase();
  const step =
    steps.find(
      (row) =>
        row.status === GenerationStepStatus.running &&
        (row.topicName ?? "").toLowerCase() === topicKey,
    ) ??
    steps.find(
      (row) =>
        row.status === GenerationStepStatus.completed &&
        (row.topicName ?? "").toLowerCase() === topicKey,
    );

  if (!step) {
    const running = steps.find((row) => row.status === GenerationStepStatus.running);
    return {
      ok: false,
      error: running
        ? `Expected draft for topic "${running.topicName}", got "${topic}".`
        : `No topic_draft step found for topic "${topic}".`,
      status: 409,
    };
  }

  const stories = normalizeStoryFingerprints(input.stories ?? []);
  const storiesJson = JSON.stringify(
    stories.map((story) => ({
      title: story.title,
      canonicalUrl: story.canonicalUrl,
      titleKey: story.titleKey,
    })),
  );

  if (step.status === GenerationStepStatus.completed) {
    // Idempotent re-save: keep existing draft unless empty, then ensure pipeline advanced.
    if (!step.draftHtml?.trim()) {
      await client.generationStep.update({
        where: { id: step.id },
        data: { draftHtml: html, draftStoriesJson: storiesJson },
      });
    }
  } else {
    await client.generationStep.update({
      where: { id: step.id },
      data: {
        status: GenerationStepStatus.completed,
        draftHtml: html,
        draftStoriesJson: storiesJson,
        error: null,
      },
    });
    appendJobLogLine(
      jobId,
      `step ${step.sortOrder} topic_draft:${step.topicName} saved (${stories.length} stories)`,
    );
  }

  const next = await client.generationStep.findFirst({
    where: { jobId, status: GenerationStepStatus.pending },
    orderBy: { sortOrder: "asc" },
  });

  if (!next) {
    return {
      ok: true,
      jobId,
      stepId: step.id,
      nextStepId: null,
      nextKind: null,
      advanced: false,
    };
  }

  const alreadyRunning = await client.generationStep.findFirst({
    where: { jobId, status: GenerationStepStatus.running },
    select: { id: true },
  });
  if (alreadyRunning) {
    return {
      ok: true,
      jobId,
      stepId: step.id,
      nextStepId: alreadyRunning.id,
      nextKind: next.kind,
      advanced: false,
    };
  }

  const started = await startStep(jobId, next.id, deps);
  if (!started.ok) {
    return { ok: false, error: started.error, status: 503 };
  }

  return {
    ok: true,
    jobId,
    stepId: step.id,
    nextStepId: next.id,
    nextKind: next.kind,
    advanced: true,
    pid: started.pid,
  };
}

export async function markMergeStepCompleted(
  jobId: string,
  deps: PipelineDeps = {},
): Promise<void> {
  const client = db(deps);
  await client.generationStep.updateMany({
    where: {
      jobId,
      kind: GenerationStepKind.merge_publish,
      status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
    },
    data: {
      status: GenerationStepStatus.completed,
      error: null,
    },
  });
  appendJobLogLine(jobId, "merge_publish completed");
}

export async function markMergeStepFailed(
  jobId: string,
  error: string,
  deps: PipelineDeps = {},
): Promise<void> {
  const client = db(deps);
  await client.generationStep.updateMany({
    where: {
      jobId,
      kind: GenerationStepKind.merge_publish,
      status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
    },
    data: {
      status: GenerationStepStatus.failed,
      error,
    },
  });
}

export { parseStoriesJson };
