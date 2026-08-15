import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFaqCandidatesFromIngest,
  buildFaqSlug,
  extractExplicitQaPairs,
  normalizeQuestionKey,
  tokenOverlapScore,
} from "@/lib/faq-space";

describe("faq-space helpers", () => {
  it("builds stable slugs", () => {
    const slug = buildFaqSlug("Abkhazia News", "clxyz12345abc");
    assert.match(slug, /^abkhazia-news-/);
  });

  it("normalizes question keys", () => {
    assert.equal(normalizeQuestionKey("  Как дела??? "), "как дела");
  });

  it("scores token overlap", () => {
    assert.ok(tokenOverlapScore("порт сухогруз цемент", "В порту сухогруз с цементом") > 0.3);
  });

  it("extracts explicit Q/A pairs", () => {
    const pairs = extractExplicitQaPairs("Q: Is the border open?\nA: Yes until 18:00.");
    assert.equal(pairs.length, 1);
    assert.match(pairs[0]!.question, /border/i);
  });

  it("builds candidates from questions + kept evidence", () => {
    const candidates = buildFaqCandidatesFromIngest({
      keywords: "border port",
      questions: [
        {
          text: "Is the border open today?",
          externalId: "peer:1",
          url: "https://t.me/peer/1",
          publishedAt: new Date(),
        },
      ],
      kept: [
        {
          text: "Border checkpoint is open today until evening for cars.",
          externalId: "peer:2",
          url: "https://t.me/peer/2",
          publishedAt: new Date(),
        },
      ],
    });
    assert.equal(candidates.length, 1);
    assert.match(candidates[0]!.answer, /Border checkpoint/i);
  });
});
