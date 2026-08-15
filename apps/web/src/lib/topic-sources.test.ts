import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mirrorKeywordsFromSources,
  normalizeTelegramPeer,
  parseTelegramPeers,
  validateTopicSources,
} from "@/lib/topic-sources";

describe("normalizeTelegramPeer", () => {
  it("strips @ and t.me URLs", () => {
    assert.equal(normalizeTelegramPeer("@Abkhaziaz"), "Abkhaziaz");
    assert.equal(normalizeTelegramPeer("https://t.me/Abkhaziaz"), "Abkhaziaz");
    assert.equal(normalizeTelegramPeer("t.me/Abkhaziaz/"), "Abkhaziaz");
  });

  it("rejects junk", () => {
    assert.equal(normalizeTelegramPeer(""), "");
    assert.equal(normalizeTelegramPeer("abcd"), "");
    assert.equal(normalizeTelegramPeer("123start"), "");
  });
});

describe("parseTelegramPeers", () => {
  it("dedupes case-insensitively", () => {
    assert.deepEqual(parseTelegramPeers("@Abkhaziaz\nabkhaziaz, OtherChannel"), [
      "Abkhaziaz",
      "OtherChannel",
    ]);
  });
});

describe("mirrorKeywordsFromSources", () => {
  it("uses first enabled web keywords", () => {
    assert.equal(
      mirrorKeywordsFromSources([
        { kind: "telegram", enabled: true, sortOrder: 0, config: { peers: ["Abkhaziaz"], lookbackHours: null } },
        { kind: "web", enabled: true, sortOrder: 1, config: { keywords: "  abkhazia news  " } },
      ]),
      "abkhazia news",
    );
  });
});

describe("validateTopicSources", () => {
  it("requires a usable enabled source", () => {
    assert.match(validateTopicSources([]) ?? "", /at least one/i);
    assert.match(
      validateTopicSources([
        { kind: "telegram", enabled: true, sortOrder: 0, config: { peers: [], lookbackHours: null } },
      ]) ?? "",
      /peer/i,
    );
    assert.equal(
      validateTopicSources([
        {
          kind: "telegram",
          enabled: true,
          sortOrder: 0,
          config: { peers: ["Abkhaziaz"], lookbackHours: null },
        },
      ]),
      null,
    );
  });
});
