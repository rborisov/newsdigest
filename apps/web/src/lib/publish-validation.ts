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

export function shouldReturnExistingPublish(
  jobStatus: GenerationJobStatus,
  hasPublishedPage: boolean,
): boolean {
  return jobStatus === GenerationJobStatus.completed || hasPublishedPage;
}

export type ExistingPublishPayload = {
  publishedPageId: string;
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
    publishedPageId: page.publishedPageId,
  };
}
