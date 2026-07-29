import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GenerationJobStatus,
  GenerationStepKind,
  GenerationStepStatus,
} from "@prisma/client";

import type { SpawnAgentResult } from "./cursor";
import { completeTopicPublishStep } from "./generation-pipeline";

type StepRow = {
  id: string;
  jobId: string;
  kind: GenerationStepKind;
  status: GenerationStepStatus;
  sortOrder: number;
  topicId: string | null;
  topicName: string | null;
  error?: string | null;
};

function matchesStep(step: StepRow, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "status" && value && typeof value === "object" && "in" in value) {
      const statuses = (value as { in: GenerationStepStatus[] }).in;
      if (!statuses.includes(step.status)) {
        return false;
      }
      continue;
    }
    if ((step as Record<string, unknown>)[key] !== value) {
      return false;
    }
  }
  return true;
}

function createMockPipelineDb(initial: {
  jobId: string;
  steps: StepRow[];
  jobStatus?: GenerationJobStatus;
}) {
  const steps = initial.steps.map((step) => ({ ...step }));
  let jobStatus = initial.jobStatus ?? GenerationJobStatus.running;
  const jobUpdates: Array<{ status: GenerationJobStatus; error: string | null }> = [];

  const mockDb = {
    generationStep: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: Record<string, unknown>;
        orderBy?: { sortOrder: "asc" | "desc" };
      }) => {
        const matches = steps.filter((step) => matchesStep(step, where));
        if (orderBy?.sortOrder === "asc") {
          matches.sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return matches[0] ?? null;
      },
      update: async ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: Partial<StepRow>;
      }) => {
        const step = steps.find((row) => row.id === id);
        if (!step) {
          throw new Error(`Step ${id} not found`);
        }
        Object.assign(step, data);
        return step;
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        steps.filter((step) => matchesStep(step, where)).length,
    },
    generationJob: {
      update: async ({
        data,
      }: {
        where: { id: string };
        data: { status: GenerationJobStatus; error: string | null };
      }) => {
        jobStatus = data.status;
        jobUpdates.push(data);
        return { id: initial.jobId, status: jobStatus };
      },
    },
    topic: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => {
        const step = steps.find((row) => row.topicId === id);
        return {
          id,
          name: step?.topicName ?? "Topic",
          keywords: "",
          enabled: true,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    promptConfig: {
      findUnique: async () => ({
        id: "default",
        template: "Topics:\n{{TOPICS}}\nHours: {{PERIOD_HOURS}}\nDate: {{DATE}}\nExclude:\n{{EXCLUDE_STORIES}}",
        periodHours: 24,
        boardStaleDays: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    storyIndex: {
      findMany: async () => [],
    },
    publishedStory: {
      findMany: async () => [],
    },
  };

  return {
    mockDb,
    getSteps: () => steps,
    getJobStatus: () => jobStatus,
    getJobUpdates: () => jobUpdates,
  };
}

const stubSpawnAgent = (): SpawnAgentResult => ({
  ok: true,
  pid: 4242,
  logPath: "/tmp/test-agent.log",
});

const jobId = "job_test";

describe("completeTopicPublishStep", () => {
  it("advances to the next pending step after completing the current step", async () => {
    const { mockDb, getSteps } = createMockPipelineDb({
      jobId,
      steps: [
        {
          id: "step_a",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.running,
          sortOrder: 0,
          topicId: "topic_a",
          topicName: "Open RAN",
        },
        {
          id: "step_b",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.pending,
          sortOrder: 1,
          topicId: "topic_b",
          topicName: "Private 5G",
        },
      ],
    });

    const result = await completeTopicPublishStep(jobId, "step_a", {
      prisma: mockDb as never,
      spawnAgent: stubSpawnAgent,
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.advanced, true);
    assert.equal(result.jobCompleted, false);
    assert.equal(result.nextStepId, "step_b");
    assert.equal(result.pid, 4242);

    const steps = getSteps();
    assert.equal(steps[0]?.status, GenerationStepStatus.completed);
    assert.equal(steps[0]?.error, null);
    assert.equal(steps[1]?.status, GenerationStepStatus.running);
  });

  it("marks the job completed when the last step finishes", async () => {
    const { mockDb, getSteps, getJobStatus, getJobUpdates } = createMockPipelineDb({
      jobId,
      steps: [
        {
          id: "step_a",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.running,
          sortOrder: 0,
          topicId: "topic_a",
          topicName: "Open RAN",
        },
      ],
    });

    const result = await completeTopicPublishStep(jobId, "step_a", {
      prisma: mockDb as never,
      spawnAgent: stubSpawnAgent,
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.advanced, false);
    assert.equal(result.jobCompleted, true);
    assert.equal(result.nextStepId, null);

    assert.equal(getSteps()[0]?.status, GenerationStepStatus.completed);
    assert.equal(getJobStatus(), GenerationJobStatus.completed);
    assert.deepEqual(getJobUpdates().at(-1), {
      status: GenerationJobStatus.completed,
      error: null,
    });
  });

  it("stores a soft-fail note on the step and still advances", async () => {
    const softFailMessage =
      "All stories in this digest were already published; skipping empty duplicate publish.";
    const { mockDb, getSteps } = createMockPipelineDb({
      jobId,
      steps: [
        {
          id: "step_a",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.running,
          sortOrder: 0,
          topicId: "topic_a",
          topicName: "Open RAN",
        },
        {
          id: "step_b",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.pending,
          sortOrder: 1,
          topicId: "topic_b",
          topicName: "Private 5G",
        },
      ],
    });

    const result = await completeTopicPublishStep(
      jobId,
      "step_a",
      { prisma: mockDb as never, spawnAgent: stubSpawnAgent },
      { note: softFailMessage },
    );

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.advanced, true);
    assert.equal(result.nextStepId, "step_b");

    const steps = getSteps();
    assert.equal(steps[0]?.status, GenerationStepStatus.completed);
    assert.equal(steps[0]?.error, softFailMessage);
    assert.equal(steps[1]?.status, GenerationStepStatus.running);
  });

  it("is idempotent when the step is already completed", async () => {
    const { mockDb, getSteps, getJobStatus } = createMockPipelineDb({
      jobId,
      steps: [
        {
          id: "step_a",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.completed,
          sortOrder: 0,
          topicId: "topic_a",
          topicName: "Open RAN",
          error: null,
        },
        {
          id: "step_b",
          jobId,
          kind: GenerationStepKind.topic_publish,
          status: GenerationStepStatus.pending,
          sortOrder: 1,
          topicId: "topic_b",
          topicName: "Private 5G",
        },
      ],
    });

    let spawnCalls = 0;
    const result = await completeTopicPublishStep(jobId, "step_a", {
      prisma: mockDb as never,
      spawnAgent: () => {
        spawnCalls += 1;
        return stubSpawnAgent();
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.advanced, true);
    assert.equal(result.nextStepId, "step_b");
    assert.equal(spawnCalls, 1);

    const steps = getSteps();
    assert.equal(steps[0]?.status, GenerationStepStatus.completed);
    assert.equal(steps[0]?.error, null);
    assert.equal(steps[1]?.status, GenerationStepStatus.running);
    assert.equal(getJobStatus(), GenerationJobStatus.running);
  });
});
