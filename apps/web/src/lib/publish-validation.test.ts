import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GenerationJobStatus } from "@prisma/client";

import {
  buildExistingPublishResponse,
  getPublishSoftFailReason,
  needsIndexLinkResume,
  shouldReturnExistingPublish,
  shouldReturnLegacyPublish,
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
    it("returns true when the topic page is index-linked", () => {
      assert.equal(
        shouldReturnExistingPublish({
          indexPageId: "idx_1",
        }),
        true,
      );
    });

    it("returns false when a topic page exists but is not index-linked", () => {
      assert.equal(
        shouldReturnExistingPublish({
          indexPageId: null,
        }),
        false,
      );
      assert.equal(shouldReturnExistingPublish(null), false);
    });
  });

  describe("shouldReturnLegacyPublish", () => {
    it("returns true only when job is completed and legacy page is index-linked", () => {
      assert.equal(
        shouldReturnLegacyPublish(GenerationJobStatus.completed, {
          indexPageId: "idx_1",
        }),
        true,
      );
      assert.equal(
        shouldReturnLegacyPublish(GenerationJobStatus.running, {
          indexPageId: "idx_1",
        }),
        false,
      );
    });
  });

  describe("needsIndexLinkResume", () => {
    it("returns true when a page exists without indexPageId", () => {
      assert.equal(needsIndexLinkResume({ indexPageId: null }), true);
    });

    it("returns false when already linked or missing", () => {
      assert.equal(needsIndexLinkResume({ indexPageId: "idx_1" }), false);
      assert.equal(needsIndexLinkResume(null), false);
    });
  });

  describe("buildExistingPublishResponse", () => {
    it("includes idempotent flag and existing page URLs", () => {
      const response = buildExistingPublishResponse("job_1", {
        topicPageId: "page_1",
        digestUrl: "https://telegra.ph/Digest-07-28",
        digestPath: "Digest-07-28",
        indexUrl: "https://telegra.ph/Index",
        indexPath: "Index",
      });

      assert.equal(response.ok, true);
      assert.equal(response.idempotent, true);
      assert.equal(response.jobId, "job_1");
      assert.equal(response.topicPageId, "page_1");
      assert.equal(response.publishedPageId, "page_1");
      assert.equal(response.digestUrl, "https://telegra.ph/Digest-07-28");
    });
  });
});
