import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXCLUDE_LOOKBACK_DAYS,
  EXCLUDE_MAX_STORIES,
  areAllStoriesKnown,
  formatExcludeStories,
  normalizeCanonicalUrl,
  normalizeTitleKey,
  parseStoriesFromHtml,
} from "./dedup";
import {
  applyPromptPlaceholders,
  appendJobMetadata,
  appendTopicDraftMetadata,
  buildMergePromptBody,
  formatMergeDrafts,
  formatPromptDate,
  formatTopicWithKeywords,
  formatTopicsList,
} from "./prompt";

describe("dedup", () => {
  describe("normalizeCanonicalUrl", () => {
    it("strips common tracking query params", () => {
      const normalized = normalizeCanonicalUrl(
        "https://example.com/news/story?utm_source=twitter&fbclid=abc&id=1",
      );
      assert.equal(normalized, "https://example.com/news/story?id=1");
    });

    it("returns trimmed input when URL parsing fails", () => {
      assert.equal(normalizeCanonicalUrl("  not-a-url  "), "not-a-url");
    });
  });

  describe("normalizeTitleKey", () => {
    it("lowercases and removes punctuation", () => {
      assert.equal(normalizeTitleKey("Breaking: AI News!"), "breaking ai news");
    });
  });

  describe("formatExcludeStories", () => {
    it("formats url and title lines", () => {
      const formatted = formatExcludeStories([
        { title: "Story A", canonicalUrl: "https://a.test" },
        { title: "Story B", canonicalUrl: null },
      ]);

      assert.match(formatted, /- https:\/\/a\.test — Story A/);
      assert.match(formatted, /- Story B/);
    });

    it("returns (none) for empty list", () => {
      assert.equal(formatExcludeStories([]), "(none)");
    });
  });

  describe("parseStoriesFromHtml", () => {
    it("extracts anchor links as story fingerprints", () => {
      const stories = parseStoriesFromHtml(
        '<p>Read <a href="https://news.test/a?utm_source=x">Alpha</a></p>',
      );

      assert.equal(stories.length, 1);
      assert.equal(stories[0]?.title, "Alpha");
      assert.equal(stories[0]?.canonicalUrl, "https://news.test/a");
      assert.equal(stories[0]?.titleKey, "alpha");
    });

    it("uses strong headline when link text is Source", () => {
      const stories = parseStoriesFromHtml(
        '<p><strong>Amazon Leo filing</strong> — summary. <a href="https://satnews.test/a">Source</a></p>',
      );
      assert.equal(stories.length, 1);
      assert.equal(stories[0]?.title, "Amazon Leo filing");
      assert.equal(stories[0]?.canonicalUrl, "https://satnews.test/a");
    });
  });

  describe("areAllStoriesKnown", () => {
    it("returns false when there are no stories", () => {
      assert.equal(areAllStoriesKnown([], [{ canonicalUrl: "https://a.test", titleKey: "a" }]), false);
    });

    it("matches by canonical URL or title key", () => {
      const known = [{ canonicalUrl: "https://a.test", titleKey: "alpha" }];
      const allKnown = areAllStoriesKnown(
        [{ title: "Alpha", canonicalUrl: "https://a.test?utm_source=x" }],
        known,
      );
      const notAllKnown = areAllStoriesKnown([{ title: "Beta", canonicalUrl: "https://b.test" }], known);

      assert.equal(allKnown, true);
      assert.equal(notAllKnown, false);
    });
  });

  it("exports exclude window constants", () => {
    assert.equal(EXCLUDE_LOOKBACK_DAYS, 30);
    assert.equal(EXCLUDE_MAX_STORIES, 150);
  });
});

describe("prompt", () => {
  describe("formatTopicsList", () => {
    it("formats enabled topics as bullets", () => {
      assert.equal(formatTopicsList(["AI", "Politics"]), "- AI\n- Politics");
    });

    it("handles empty topic list", () => {
      assert.equal(formatTopicsList([]), "(no topics enabled)");
    });
  });

  describe("formatPromptDate", () => {
    it("uses ISO date prefix", () => {
      assert.equal(formatPromptDate(new Date("2026-07-28T15:00:00.000Z")), "2026-07-28");
    });
  });

  describe("applyPromptPlaceholders", () => {
    it("replaces template placeholders", () => {
      const result = applyPromptPlaceholders(
        "Topics:\n{{TOPICS}}\nHours: {{PERIOD_HOURS}}\nDate: {{DATE}}\nExclude:\n{{EXCLUDE_STORIES}}",
        {
          topics: "- AI",
          periodHours: 24,
          date: "2026-07-28",
          excludeStories: "- https://a.test — Story",
        },
      );

      assert.match(result, /- AI/);
      assert.match(result, /Hours: 24/);
      assert.match(result, /Date: 2026-07-28/);
      assert.match(result, /- https:\/\/a\.test — Story/);
      assert.doesNotMatch(result, /\{\{/);
    });
  });

  describe("appendJobMetadata", () => {
    it("appends generation job id for MCP publish callback", () => {
      const prompt = appendJobMetadata("Base prompt", "job_123");
      assert.match(prompt, /Generation job ID: job_123/);
      assert.match(prompt, /publish_digest_page with jobId "job_123"/);
    });
  });

  describe("formatTopicWithKeywords", () => {
    it("includes keywords when present", () => {
      assert.equal(
        formatTopicWithKeywords({ name: "Private 5G", keywords: "campus, CBRS" }),
        "- Private 5G\n  Keywords: campus, CBRS",
      );
    });

    it("omits keywords line when empty", () => {
      assert.equal(formatTopicWithKeywords({ name: "Open RAN", keywords: "  " }), "- Open RAN");
    });
  });

  describe("appendTopicDraftMetadata", () => {
    it("requires save_topic_draft and forbids publish", () => {
      const prompt = appendTopicDraftMetadata("Base", "job_1", "Open RAN");
      assert.match(prompt, /save_topic_draft/);
      assert.match(prompt, /Topic name \(pass exactly to save_topic_draft\): Open RAN/);
      assert.match(prompt, /Do NOT call publish_digest_page/);
      assert.match(prompt, /<h3>Open RAN<\/h3>/);
      assert.match(prompt, /Do NOT use <h1> or <h2>/);
    });
  });

  describe("merge draft helpers", () => {
    it("formats draft sections", () => {
      const formatted = formatMergeDrafts([
        { topicName: "A", html: "<p>one</p>" },
        { topicName: "B", html: "" },
      ]);
      assert.match(formatted, /## Topic: A/);
      assert.match(formatted, /<p>one<\/p>/);
      assert.match(formatted, /## Topic: B/);
      assert.match(formatted, /\(empty draft\)/);
    });

    it("builds merge body with excludes and drafts", () => {
      const body = buildMergePromptBody(
        {
          topics: "",
          periodHours: 24,
          date: "2026-07-28",
          excludeStories: "(none)",
        },
        [{ topicName: "LEO", html: "<p>Starlink</p>" }],
      );
      assert.match(body, /merging topic drafts/i);
      assert.match(body, /## Topic: LEO/);
      assert.match(body, /EXCLUDE_STORIES/);
      assert.match(body, /Starlink/);
      assert.match(body, /<h3>Topic Name<\/h3>/);
      assert.match(body, /Put <hr\/> between topics/);
      assert.match(body, /TITLE for publish_digest_page/);
      assert.match(body, /\{HH:MM\} UTC/);
    });
  });
});
