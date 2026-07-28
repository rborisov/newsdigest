import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  digestContentTags,
  formatDigestClock,
  formatDigestHeading,
  formatDigestWhen,
} from "./digest-display";

describe("digest-display", () => {
  const when = new Date("2026-07-28T13:45:00.000Z");

  it("formats when with date and time", () => {
    assert.match(formatDigestWhen(when), /2026/);
    assert.match(formatDigestClock(when), /\d/);
  });

  it("shortens generic Telegra.ph titles", () => {
    assert.match(formatDigestHeading("Daily Digest — 2026-07-28", when), /^Digest ·/);
    assert.match(formatDigestHeading("News Digest — July 28, 2026", when), /^Digest ·/);
    assert.equal(
      formatDigestHeading("Digest · 2026-07-28 13:45 UTC · Private 5G · NTN", when),
      "Digest · 2026-07-28 13:45 UTC · Private 5G · NTN",
    );
  });

  it("builds content tags from story titles", () => {
    const tags = digestContentTags(
      [
        "Amazon files for Leo constellation",
        "Amazon files for Leo constellation",
        "e& UAE activates 1024QAM",
      ],
      2,
    );
    assert.equal(tags.length, 2);
    assert.match(tags[0] ?? "", /Amazon/);
  });
});
