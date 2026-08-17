import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import { GenerationJobStatus, GenerationStepStatus } from "@prisma/client";

import {
  AGENT_EXITED_WITHOUT_COMPLETION,
  isStaleRunningJob,
  logShowsAgentExited,
  reconcileAbandonedStoryReviews,
  reconcileExitedButRunningStoryReviews,
  reconcileStaleRunningJobs,
  reconcileStaleRunningStoryReviews,
  REVIEW_AGENT_EXITED_WITHOUT_PUBLISH,
  STALE_JOB_ERROR,
  STALE_REVIEW_ERROR,
  STALE_RUNNING_JOB_MAX_AGE_MS,
} from "./job-reconciliation";

describe("job-reconciliation", () => {
  describe("isStaleRunningJob", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");

    it("returns false when updated within the max age", () => {
      const updatedAt = new Date(now.getTime() - STALE_RUNNING_JOB_MAX_AGE_MS + 1);
      assert.equal(isStaleRunningJob(updatedAt, now), false);
    });

    it("returns true when updated exactly at the max age boundary", () => {
      const updatedAt = new Date(now.getTime() - STALE_RUNNING_JOB_MAX_AGE_MS);
      assert.equal(isStaleRunningJob(updatedAt, now), true);
    });

    it("returns true when older than the max age", () => {
      const updatedAt = new Date(now.getTime() - STALE_RUNNING_JOB_MAX_AGE_MS - 60_000);
      assert.equal(isStaleRunningJob(updatedAt, now), true);
    });

    it("respects a custom maxAgeMs", () => {
      const updatedAt = new Date(now.getTime() - 5 * 60_000);
      assert.equal(isStaleRunningJob(updatedAt, now, 10 * 60_000), false);
      assert.equal(isStaleRunningJob(updatedAt, now, 4 * 60_000), true);
    });
  });

  describe("logShowsAgentExited", () => {
    it("detects wrapper exit lines", () => {
      assert.equal(logShowsAgentExited("[2026-07-28T12:50:07Z] agent exited with code=0"), true);
      assert.equal(logShowsAgentExited("heartbeat: agent still running"), false);
    });
  });

  describe("reconcileStaleRunningJobs", () => {
    it("fails stale jobs and their open steps", async () => {
      const now = new Date("2026-07-28T12:00:00.000Z");
      let findWhere: unknown;
      let txOps: unknown[] = [];

      const mockDb = {
        generationJob: {
          findMany: async ({ where }: { where: unknown }) => {
            findWhere = where;
            return [{ id: "job_a" }, { id: "job_b" }];
          },
          updateMany: (args: unknown) => args,
        },
        generationStep: {
          updateMany: (args: unknown) => args,
        },
        $transaction: async (ops: unknown[]) => {
          txOps = ops;
          return ops;
        },
      };

      const count = await reconcileStaleRunningJobs(mockDb as never, { now });
      assert.equal(count, 2);
      assert.deepEqual(findWhere, {
        status: GenerationJobStatus.running,
        updatedAt: { lte: new Date(now.getTime() - STALE_RUNNING_JOB_MAX_AGE_MS) },
      });
      assert.equal(txOps.length, 2);
      assert.deepEqual(txOps[0], {
        where: {
          jobId: { in: ["job_a", "job_b"] },
          status: { in: [GenerationStepStatus.pending, GenerationStepStatus.running] },
        },
        data: {
          status: GenerationStepStatus.failed,
          error: STALE_JOB_ERROR,
        },
      });
      assert.deepEqual(txOps[1], {
        where: { id: { in: ["job_a", "job_b"] } },
        data: {
          status: GenerationJobStatus.failed,
          error: STALE_JOB_ERROR,
        },
      });
      assert.match(AGENT_EXITED_WITHOUT_COMPLETION, /Agent exited/);
    });

    it("returns 0 when no stale jobs", async () => {
      const mockDb = {
        generationJob: {
          findMany: async () => [],
        },
      };
      const count = await reconcileStaleRunningJobs(mockDb as never);
      assert.equal(count, 0);
    });
  });

  describe("reconcileStaleRunningStoryReviews", () => {
    it("fails stale pending/running reviews", async () => {
      const now = new Date("2026-07-28T12:00:00.000Z");
      let updateArgs: unknown;

      const mockDb = {
        storyReview: {
          findMany: async () => [{ id: "rev_a" }],
          updateMany: async (args: unknown) => {
            updateArgs = args;
            return { count: 1 };
          },
        },
      };

      const count = await reconcileStaleRunningStoryReviews(mockDb as never, { now });
      assert.equal(count, 1);
      assert.deepEqual(updateArgs, {
        where: { id: { in: ["rev_a"] } },
        data: { status: "failed", error: STALE_REVIEW_ERROR },
      });
    });
  });

  describe("reconcileExitedButRunningStoryReviews", () => {
    const priorLogDir = process.env.JOB_LOG_DIR;
    let tempLogDir = "";

    afterEach(() => {
      if (priorLogDir === undefined) {
        delete process.env.JOB_LOG_DIR;
      } else {
        process.env.JOB_LOG_DIR = priorLogDir;
      }
    });

    it("recovers published URL when log shows exit", async () => {
      tempLogDir = mkdtempSync(join(tmpdir(), "nd-review-logs-"));
      process.env.JOB_LOG_DIR = tempLogDir;
      mkdirSync(tempLogDir, { recursive: true });
      writeFileSync(
        join(tempLogDir, "rev_a.log"),
        "[2026-07-28T12:50:07Z] agent exited with code=1\n",
        "utf8",
      );

      let updateArgs: unknown;
      const mockDb = {
        storyReview: {
          findMany: async () => [{ id: "rev_a", telegraphUrl: "https://telegra.ph/x" }],
          update: async (args: unknown) => {
            updateArgs = args;
            return args;
          },
        },
      };

      const count = await reconcileExitedButRunningStoryReviews(mockDb as never);
      assert.equal(count, 1);
      assert.deepEqual(updateArgs, {
        where: { id: "rev_a" },
        data: { status: "published", error: null },
      });
    });

    it("marks failed when agent exited without publish", async () => {
      tempLogDir = mkdtempSync(join(tmpdir(), "nd-review-logs-"));
      process.env.JOB_LOG_DIR = tempLogDir;
      mkdirSync(tempLogDir, { recursive: true });
      writeFileSync(
        join(tempLogDir, "rev_b.log"),
        "[2026-07-28T12:50:07Z] agent exited with code=1\n",
        "utf8",
      );

      let updateArgs: unknown;
      const mockDb = {
        storyReview: {
          findMany: async () => [{ id: "rev_b", telegraphUrl: "" }],
          update: async (args: unknown) => {
            updateArgs = args;
            return args;
          },
        },
      };

      const count = await reconcileExitedButRunningStoryReviews(mockDb as never);
      assert.equal(count, 1);
      assert.deepEqual(updateArgs, {
        where: { id: "rev_b" },
        data: { status: "failed", error: REVIEW_AGENT_EXITED_WITHOUT_PUBLISH },
      });
    });
  });

  describe("reconcileAbandonedStoryReviews", () => {
    it("runs stale + exited reconcilers", async () => {
      const mockDb = {
        storyReview: {
          findMany: async () => [],
          updateMany: async () => ({ count: 0 }),
        },
      };
      const count = await reconcileAbandonedStoryReviews(mockDb as never);
      assert.equal(count, 0);
    });
  });
});
