import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenerationJobStatus, GenerationStepStatus } from "@prisma/client";

import {
  isStaleRunningJob,
  reconcileStaleRunningJobs,
  STALE_JOB_ERROR,
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
});
