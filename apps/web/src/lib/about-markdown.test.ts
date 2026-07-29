import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderAboutMarkdown } from "./about-markdown";

describe("renderAboutMarkdown", () => {
  it("renders paragraphs and bold", () => {
    const html = renderAboutMarkdown("Hello **world**.\n\nSecond.");
    assert.match(html, /<p>/);
    assert.match(html, /<strong>world<\/strong>/);
  });

  it("renders unordered lists and links", () => {
    const html = renderAboutMarkdown("- one\n- [two](https://example.com)");
    assert.match(html, /<ul>/);
    assert.match(html, /<a href="https:\/\/example.com"/);
  });

  it("strips scripty HTML", () => {
    const html = renderAboutMarkdown('<script>alert(1)</script>\n\nSafe');
    assert.doesNotMatch(html, /<script>/i);
    assert.match(html, /Safe/);
  });

  it("returns empty for blank input", () => {
    assert.equal(renderAboutMarkdown("  "), "");
  });

  it("escapes ampersands once", () => {
    const html = renderAboutMarkdown("Tom & Jerry");
    assert.match(html, /Tom &amp; Jerry/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });
});
