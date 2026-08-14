export const DEFAULT_REVIEW_TEMPLATE = `You are an independent news analyst. Write a structured review of ONE story from our digest.

Write in {{LANGUAGE}}.

Story id: {{STORY_ID}}
Headline: {{STORY_TITLE}}
Source URL: {{STORY_URL}}
Digest topic: {{TOPIC_NAME}}
Date: {{DATE}}

Instructions:
- Read the source (and related reporting if needed).
- Explain what happened, why it matters, and what to watch.
- Note uncertainty or conflicting claims when relevant.
- Do not invent quotes or facts not supported by sources.

When the review is ready, publish via publish_story_review MCP with a clear title and HTML body (headings, paragraphs, links).
Do not finish until publish_story_review returns a Telegra.ph URL.`;

export type StoryReviewContext = {
  storyId: string;
  storyTitle: string;
  storyUrl: string;
  topicName: string;
  language: string;
  date: string;
  reviewId: string;
};

export function applyReviewPromptPlaceholders(
  template: string,
  ctx: Omit<StoryReviewContext, "reviewId">,
): string {
  return template
    .replaceAll("{{STORY_ID}}", ctx.storyId)
    .replaceAll("{{STORY_TITLE}}", ctx.storyTitle)
    .replaceAll("{{STORY_URL}}", ctx.storyUrl || "(none)")
    .replaceAll("{{TOPIC_NAME}}", ctx.topicName)
    .replaceAll("{{LANGUAGE}}", ctx.language)
    .replaceAll("{{DATE}}", ctx.date);
}

export function buildStoryReviewAgentPrompt(
  promptSnapshot: string,
  ctx: StoryReviewContext,
): string {
  return `MODE: story_review
reviewId: ${ctx.reviewId}
storyId: ${ctx.storyId}

${promptSnapshot}

MUST: call publish_story_review when done (reviewId=${ctx.reviewId}).`;
}

const STORY_ID_SUFFIX_RE = / · (c[a-z0-9]{8,})\s*(?=<\/p>)/gi;

export function extractStoryIdsFromHtml(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(STORY_ID_SUFFIX_RE)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

export type ReviewLinkInfo = {
  storyIndexId: string;
  status: string;
  telegraphUrl: string;
};

export function enrichBoardHtmlWithReviewLinks(
  html: string,
  reviewsByStoryId: Map<string, ReviewLinkInfo>,
  options: { isAdmin: boolean },
): string {
  if (!html.trim()) {
    return html;
  }
  if (reviewsByStoryId.size === 0 && !options.isAdmin) {
    return html;
  }

  return html.replace(STORY_ID_SUFFIX_RE, (match, storyId: string) => {
    const review = reviewsByStoryId.get(storyId);
    if (!review) {
      if (options.isAdmin) {
        return `${match}<span class="story-review-admin"> · <a href="/admin/reviews/start?storyId=${encodeURIComponent(storyId)}">Review</a></span>`;
      }
      return match;
    }

    if (review.status === "published" && review.telegraphUrl) {
      return `${match}<span class="story-review-link"> · <a href="${review.telegraphUrl}" target="_blank" rel="noopener noreferrer">Review →</a></span>`;
    }

    if (review.status === "running" || review.status === "pending") {
      if (options.isAdmin) {
        return `${match}<span class="story-review-admin muted"> · Review in progress…</span>`;
      }
      return match;
    }

    if (review.status === "failed" && options.isAdmin) {
      return `${match}<span class="story-review-admin"> · <a href="/admin/reviews/start?storyId=${encodeURIComponent(storyId)}">Retry review</a></span>`;
    }

    if (options.isAdmin) {
      return `${match}<span class="story-review-admin"> · <a href="/admin/reviews/start?storyId=${encodeURIComponent(storyId)}">Review</a></span>`;
    }

    return match;
  });
}
