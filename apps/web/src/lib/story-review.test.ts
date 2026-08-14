import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyReviewPromptPlaceholders,
  enrichBoardHtmlWithReviewLinks,
  extractStoryIdsFromHtml,
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
  });

  it("adds admin start link when no review", () => {
    const html = "<p>Story · cnew0000000000000000000001</p>";
    const enriched = enrichBoardHtmlWithReviewLinks(html, new Map(), { isAdmin: true });
    assert.match(enriched, /\/admin\/reviews\/start\?storyId=cnew/);
  });
});
