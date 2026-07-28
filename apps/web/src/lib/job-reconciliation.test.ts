import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenerationJobStatus } from "@prisma/client";

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
    it("fails only running jobs older than the cutoff", async () => {
      const now = new Date("2026-07-28T12:00:00.000Z");
      let capturedWhere: unknown;
      let capturedData: unknown;

      const mockDb = {
        generationJob: {
          updateMany: async ({
            where,
            data,
          }: {
            where: unknown;
            data: unknown;
          }) => {
            capturedWhere = where;
            capturedData = data;
            return { count: 2 };
          },
        },
      };

      const count = await reconcileStaleRunningJobs(mockDb as never, { now });
      assert.equal(count, 2);
      assert.deepEqual(capturedWhere, {
        status: GenerationJobStatus.running,
        updatedAt: { lte: new Date(now.getTime() - STALE_RUNNING_JOB_MAX_AGE_MS) },
      });
      assert.deepEqual(capturedData, {
        status: GenerationJobStatus.failed,
        error: STALE_JOB_ERROR,
      });
    });
  });
});
