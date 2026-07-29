import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  appendStoryIdSuffix,
  createCuid,
  stampStoryIdsInHtml,
} from "./story-ids";

describe("story-ids", () => {
  it("createCuid returns a c-prefixed id", () => {
    const id = createCuid();
    assert.match(id, /^c[a-z0-9]+$/i);
    assert.ok(id.length >= 20);
  });

  it("appendStoryIdSuffix adds the cuid before </p>", () => {
    assert.equal(
      appendStoryIdSuffix("<p>Hello. <a href=\"https://a.test\">Src</a></p>", "clabc123"),
      "<p>Hello. <a href=\"https://a.test\">Src</a> · clabc123</p>",
    );
  });

  it("appendStoryIdSuffix is idempotent for the same id", () => {
    const once = appendStoryIdSuffix("<p>Hello</p>", "clabc123");
    assert.equal(appendStoryIdSuffix(once, "clabc123"), once);
  });

  it("stamps ids by canonical URL", () => {
    const html =
      "<h3>Topic</h3>" +
      "<p><strong>One</strong> — a. <a href=\"https://a.test/1\">Src</a></p>" +
      "<p><strong>Two</strong> — b. <a href=\"https://a.test/2\">Src</a></p>";

    const stamped = stampStoryIdsInHtml(html, [
      { id: "cid111111111111111111111", title: "One", canonicalUrl: "https://a.test/1" },
      { id: "cid222222222222222222222", title: "Two", canonicalUrl: "https://a.test/2" },
    ]);

    assert.match(stamped, /One[\s\S]* · cid111111111111111111111<\/p>/);
    assert.match(stamped, /Two[\s\S]* · cid222222222222222222222<\/p>/);
  });

  it("falls back to strong title when URL is missing", () => {
    const html = "<p><strong>Solo headline</strong> — summary only.</p>";
    const stamped = stampStoryIdsInHtml(html, [
      { id: "cidsolo00000000000000001", title: "Solo headline", canonicalUrl: null },
    ]);
    assert.equal(
      stamped,
      "<p><strong>Solo headline</strong> — summary only. · cidsolo00000000000000001</p>",
    );
  });
});
