import { normalizeCanonicalUrl } from "@/lib/dedup";

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
- End with one source link labeled Источник pointing at the original story URL (the portal rewrites it to the digest topic on Telegra.ph when publishing).
- Do not use HTML tables; use bullet lists or labeled paragraphs for comparisons (any tables are converted to lists at publish time).

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

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function publishedReviewLink(telegraphUrl: string): string {
  const href = escapeHtmlAttr(telegraphUrl.trim());
  return `<span class="story-review-link"> · <a href="${href}" target="_blank" rel="noopener noreferrer">Review →</a></span>`;
}

function adminStartReviewLink(storyId: string, label: string): string {
  return `<span class="story-review-admin"> · <a href="/admin/reviews/start?storyId=${encodeURIComponent(storyId)}">${label}</a></span>`;
}

const SOURCE_LINK_LABEL_RE = /^(?:Источник|Source)(?:\s*:)?$/i;

function extractHrefFromAttrs(attrs: string): string {
  const match = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function replaceHrefInAttrs(attrs: string, newHref: string): string {
  const escaped = escapeHtmlAttr(newHref);
  if (/\bhref\s*=/i.test(attrs)) {
    return attrs.replace(/\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `href="${escaped}"`);
  }
  const spacer = attrs.endsWith(" ") || attrs.length === 0 ? "" : " ";
  return `${attrs}${spacer}href="${escaped}"`;
}

/** Point review “Источник” / story URL links at the digest topic on Telegra.ph. */
export function rewriteReviewDigestSourceLink(
  html: string,
  input: {
    digestTelegraphUrl: string;
    storyCanonicalUrl?: string | null;
  },
): string {
  const digestUrl = input.digestTelegraphUrl.trim();
  if (!digestUrl || !html.trim()) {
    return html;
  }

  const storyUrl = input.storyCanonicalUrl?.trim()
    ? normalizeCanonicalUrl(input.storyCanonicalUrl)
    : null;

  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const label = stripHtmlTags(inner);
    const href = extractHrefFromAttrs(attrs);
    const normalizedHref = href ? normalizeCanonicalUrl(href) : "";

    const isSourceLabel = SOURCE_LINK_LABEL_RE.test(label);
    const isStoryUrl = Boolean(storyUrl && normalizedHref && normalizedHref === storyUrl);

    if (!isSourceLabel && !isStoryUrl) {
      return full;
    }

    const newAttrs = replaceHrefInAttrs(attrs, digestUrl);
    return `<a${newAttrs.startsWith(" ") || newAttrs.length === 0 ? newAttrs : ` ${newAttrs}`}>${inner}</a>`;
  });
}

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

  return html.replace(STORY_ID_SUFFIX_RE, (match, storyId: string) => {
    const review = reviewsByStoryId.get(storyId);
    const published =
      review?.status === "published" && Boolean(review.telegraphUrl.trim());

    if (published) {
      const link = publishedReviewLink(review!.telegraphUrl);
      return options.isAdmin ? `${match}${link}` : link;
    }

    if (!options.isAdmin) {
      return "";
    }

    if (!review) {
      return `${match}${adminStartReviewLink(storyId, "Review")}`;
    }

    if (review.status === "running" || review.status === "pending") {
      return `${match}<span class="story-review-admin muted"> · Review in progress…</span>`;
    }

    if (review.status === "failed") {
      return `${match}${adminStartReviewLink(storyId, "Retry review")}`;
    }

    return `${match}${adminStartReviewLink(storyId, "Review")}`;
  });
}
