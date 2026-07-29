import { GenerationJobStatus } from "@prisma/client";

import { areAllStoriesKnown, type KnownStory, type StoryFingerprint } from "./dedup";

export type PublishSoftFailReason = "no_stories" | "all_known";

export const PUBLISH_SOFT_FAIL_MESSAGES: Record<PublishSoftFailReason, string> = {
  no_stories: "No publishable stories found in digest; skipping empty publish.",
  all_known:
    "All stories in this digest were already published; skipping empty duplicate publish.",
};

export function getPublishSoftFailReason(
  stories: StoryFingerprint[],
  known: KnownStory[],
): PublishSoftFailReason | null {
  if (stories.length === 0) {
    return "no_stories";
  }

  if (areAllStoriesKnown(stories, known)) {
    return "all_known";
  }

  return null;
}

export type IndexLinkedPage = {
  indexPageId: string | null;
};

/**
 * Idempotent success when this step/topic page is already linked on the index.
 * A TopicPage without indexPageId is a partial publish that must resume index
 * linking — not short-circuit as success.
 */
export function shouldReturnExistingPublish(
  topicPage: IndexLinkedPage | null | undefined,
): boolean {
  return topicPage != null && topicPage.indexPageId != null;
}

/** Legacy merge publish: job completed with a linked PublishedPage. */
export function shouldReturnLegacyPublish(
  jobStatus: GenerationJobStatus,
  publishedPage: IndexLinkedPage | null | undefined,
): boolean {
  return (
    jobStatus === GenerationJobStatus.completed &&
    publishedPage != null &&
    publishedPage.indexPageId != null
  );
}

/** Digest page exists but was never linked onto the index (partial publish). */
export function needsIndexLinkResume(
  topicPage: IndexLinkedPage | null | undefined,
): boolean {
  return topicPage != null && topicPage.indexPageId == null;
}

export type ExistingPublishPayload = {
  topicPageId: string;
  digestUrl: string;
  digestPath: string;
  indexUrl: string;
  indexPath: string;
};

export function buildExistingPublishResponse(
  jobId: string,
  page: ExistingPublishPayload,
): Record<string, unknown> {
  return {
    ok: true,
    jobId,
    idempotent: true,
    digestUrl: page.digestUrl,
    digestPath: page.digestPath,
    indexUrl: page.indexUrl,
    indexPath: page.indexPath,
    topicPageId: page.topicPageId,
    publishedPageId: page.topicPageId,
  };
}
