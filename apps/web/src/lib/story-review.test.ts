import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyReviewPromptPlaceholders,
  enrichBoardHtmlWithReviewLinks,
  extractStoryIdsFromHtml,
  rewriteReviewDigestSourceLink,
} from "./story-review";

describe("story-review", () => {
  it("extracts story ids from paragraph suffixes", () => {
    const html =
      "<p><strong>One</strong> — text. · cid111111111111111111111</p><p>Two · cid222222222222222222222</p>";
    assert.deepEqual(extractStoryIdsFromHtml(html), [
      "cid111111111111111111111",
      "cid222222222222222222222",
    ]);
  });

  it("applies review prompt placeholders", () => {
    const out = applyReviewPromptPlaceholders(
      "Review {{STORY_TITLE}} from {{TOPIC_NAME}} in {{LANGUAGE}} on {{DATE}} id={{STORY_ID}} url={{STORY_URL}}",
      {
        storyId: "cabc",
        storyTitle: "Headline",
        storyUrl: "https://news.test/a",
        topicName: "AI",
        language: "English",
        date: "2026-08-14",
      },
    );
    assert.match(out, /Headline/);
    assert.match(out, /AI/);
    assert.match(out, /cabc/);
  });

  it("adds public review link when published", () => {
    const html = "<p>Story · cpub0000000000000000001</p>";
    const map = new Map([
      [
        "cpub0000000000000000001",
        {
          storyIndexId: "cpub0000000000000000001",
          status: "published",
          telegraphUrl: "https://telegra.ph/Review-08-14",
        },
      ],
    ]);
    const enriched = enrichBoardHtmlWithReviewLinks(html, map, { isAdmin: false });
    assert.match(enriched, /Review →/);
    assert.match(enriched, /telegra\.ph/);
    assert.doesNotMatch(enriched, /cpub0000000000000000001/);
  });

  it("hides in-progress reviews from regular users", () => {
    const html = "<p>Story · crun000000000000000000001</p>";
    const map = new Map([
      [
        "crun000000000000000000001",
        {
          storyIndexId: "crun000000000000000000001",
          status: "running",
          telegraphUrl: "",
        },
      ],
    ]);
    const enriched = enrichBoardHtmlWithReviewLinks(html, map, { isAdmin: false });
    assert.equal(enriched, "<p>Story</p>");
    assert.doesNotMatch(enriched, /Review/);
  });

  it("strips story ids for regular users when no published review", () => {
    const html = "<p>Story · cnew0000000000000000000001</p>";
    const enriched = enrichBoardHtmlWithReviewLinks(html, new Map(), { isAdmin: false });
    assert.equal(enriched, "<p>Story</p>");
  });

  it("adds admin start link when no review", () => {
    const html = "<p>Story · cnew0000000000000000000001</p>";
    const enriched = enrichBoardHtmlWithReviewLinks(html, new Map(), { isAdmin: true });
    assert.match(enriched, /\/admin\/reviews\/start\?storyId=cnew/);
  });

  it("rewrites Источник link to digest topic on Telegra.ph", () => {
    const html =
      '<p>Summary.</p><p><a href="https://news.test/story?utm_source=x">Источник</a></p>';
    const out = rewriteReviewDigestSourceLink(html, {
      digestTelegraphUrl: "https://telegra.ph/Digest-Topic-08-14",
      storyCanonicalUrl: "https://news.test/story",
    });
    assert.match(out, /href="https:\/\/telegra\.ph\/Digest-Topic-08-14"/);
    assert.match(out, />Источник</);
    assert.doesNotMatch(out, /news\.test/);
  });

  it("rewrites anchors that still point at the story canonical URL", () => {
    const html = '<p><a href="https://news.test/story">news.test</a></p>';
    const out = rewriteReviewDigestSourceLink(html, {
      digestTelegraphUrl: "https://telegra.ph/Digest-Topic-08-14",
      storyCanonicalUrl: "https://news.test/story?utm_source=x",
    });
    assert.match(out, /telegra\.ph\/Digest-Topic-08-14/);
  });
});
