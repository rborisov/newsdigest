import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenerationJobStatus } from "@prisma/client";

import {
  buildExistingPublishResponse,
  getPublishSoftFailReason,
  shouldReturnExistingPublish,
} from "./publish-validation";

describe("publish-validation", () => {
  describe("getPublishSoftFailReason", () => {
    it("returns no_stories for an empty story list", () => {
      assert.equal(getPublishSoftFailReason([], []), "no_stories");
    });

    it("returns all_known when every story is already published", () => {
      const known = [{ canonicalUrl: "https://a.test", titleKey: "alpha" }];
      const reason = getPublishSoftFailReason(
        [{ title: "Alpha", canonicalUrl: "https://a.test" }],
        known,
      );
      assert.equal(reason, "all_known");
    });

    it("returns null when there are new stories", () => {
      const reason = getPublishSoftFailReason(
        [{ title: "Beta", canonicalUrl: "https://b.test" }],
        [{ canonicalUrl: "https://a.test", titleKey: "alpha" }],
      );
      assert.equal(reason, null);
    });
  });

  describe("shouldReturnExistingPublish", () => {
    it("returns true when job is completed", () => {
      assert.equal(
        shouldReturnExistingPublish(GenerationJobStatus.completed, false),
        true,
      );
    });

    it("returns true when a published page already exists", () => {
      assert.equal(
        shouldReturnExistingPublish(GenerationJobStatus.running, true),
        true,
      );
    });

    it("returns false for a fresh running job", () => {
      assert.equal(
        shouldReturnExistingPublish(GenerationJobStatus.running, false),
        false,
      );
    });
  });

  describe("buildExistingPublishResponse", () => {
    it("includes idempotent flag and existing page URLs", () => {
      const response = buildExistingPublishResponse("job_1", {
        publishedPageId: "page_1",
        digestUrl: "https://telegra.ph/Digest-07-28",
        digestPath: "Digest-07-28",
        indexUrl: "https://telegra.ph/Index",
        indexPath: "Index",
      });

      assert.equal(response.ok, true);
      assert.equal(response.idempotent, true);
      assert.equal(response.jobId, "job_1");
      assert.equal(response.publishedPageId, "page_1");
      assert.equal(response.digestUrl, "https://telegra.ph/Digest-07-28");
    });
  });
});
