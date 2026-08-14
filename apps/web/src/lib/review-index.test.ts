import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReviewIndexHtml, formatReviewIndexLinkLabel } from "./review-index";

describe("review-index", () => {
  it("formats review index link labels with time, topic, and headline", () => {
    const label = formatReviewIndexLinkLabel({
      reviewTitle: "Review: Example headline",
      storyTitle: "Example headline",
      topicName: "AI",
      publishedAt: new Date("2026-08-14T09:30:00.000Z"),
      timeZone: "UTC",
    });
    assert.match(label, /AI/);
    assert.match(label, /Example headline/);
  });

  it("builds review index html with intro and links", () => {
    const html = buildReviewIndexHtml([
      { title: "14 Aug 2026 · AI · Headline", url: "https://telegra.ph/Review-08-14" },
    ]);
    assert.match(html, /story review/i);
    assert.match(html, /telegra\.ph\/Review-08-14/);
    assert.doesNotMatch(html, /<h3>n\. reviews<\/h3>/);
  });

  it("adds older reviews footer when rotating", () => {
    const html = buildReviewIndexHtml(
      [{ title: "Latest review", url: "https://telegra.ph/Latest" }],
      "https://telegra.ph/Older-Reviews-Index",
    );
    assert.match(html, /Older reviews →/);
    assert.match(html, /Older-Reviews-Index/);
  });
});
