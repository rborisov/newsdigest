import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeDigestHtml, stripLeadingTopicHeading } from "./sanitize-digest-html";

describe("sanitizeDigestHtml", () => {
  it("keeps telegraph-compatible markup and safe links", () => {
    const html = sanitizeDigestHtml(
      '<h3>Topic</h3><p>Read <a href="https://example.com/x">Source</a>.</p><hr/>',
    );
    assert.match(html, /<h3>Topic<\/h3>/);
    assert.match(html, /href="https:\/\/example\.com\/x"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  it("strips scripts and event handlers", () => {
    const html = sanitizeDigestHtml(
      '<p onclick="alert(1)">Hi</p><script>alert(2)</script><p>Ok</p>',
    );
    assert.doesNotMatch(html, /script/i);
    assert.doesNotMatch(html, /onclick/i);
    assert.doesNotMatch(html, /alert\(2\)/);
    assert.match(html, /<p>Hi<\/p>/);
    assert.match(html, /<p>Ok<\/p>/);
  });

  it("drops javascript hrefs", () => {
    const html = sanitizeDigestHtml('<a href="javascript:alert(1)">x</a>');
    assert.doesNotMatch(html, /javascript:/i);
    assert.match(html, /<a>x<\/a>/);
  });

  it("keeps portal-hosted illustration figures for the matching topic", () => {
    const topicId = "cltopic1234567890";
    const src = `/api/illustrations/${topicId}/photo.png`;
    const html = sanitizeDigestHtml(
      `<figure><img src="${src}"/><figcaption>Launch</figcaption></figure>`,
      topicId,
    );
    assert.match(html, new RegExp(`src="${src}"`));
    assert.match(html, /<figcaption>Launch<\/figcaption>/);
  });

  it("drops external img src values", () => {
    const html = sanitizeDigestHtml(
      '<figure><img src="https://cdn.test/photo.jpg"/></figure>',
      "cltopic1234567890",
    );
    assert.doesNotMatch(html, /img/i);
    assert.doesNotMatch(html, /cdn\.test/);
  });

  it("keeps board-story layout wrappers for side-by-side illustrations", () => {
    const topicId = "cltopic1234567890";
    const src = `/api/illustrations/${topicId}/photo.png`;
    const html = sanitizeDigestHtml(
      `<div class="board-story"><div class="board-story-text"><p><strong>Story</strong></p></div>` +
        `<figure><img src="${src}"/><figcaption>Photo</figcaption></figure></div>`,
      topicId,
    );
    assert.match(html, /class="board-story"/);
    assert.match(html, /class="board-story-text"/);
    assert.match(html, new RegExp(`src="${src}"`));
  });

  it("drops arbitrary div wrappers and their contents", () => {
    const html = sanitizeDigestHtml('<div class="evil"><p>Story</p></div>');
    assert.equal(html, "");
  });
});

describe("stripLeadingTopicHeading", () => {
  it("removes a leading h3 that matches the topic name", () => {
    const html = stripLeadingTopicHeading(
      "<h3>Russian IT industry</h3><p>Story one.</p>",
      "Russian IT industry",
    );
    assert.equal(html, "<p>Story one.</p>");
  });

  it("keeps a different leading h3", () => {
    const html = stripLeadingTopicHeading(
      "<h3>Other</h3><p>Story.</p>",
      "Russian IT industry",
    );
    assert.equal(html, "<h3>Other</h3><p>Story.</p>");
  });

  it("matches topic names with ampersands against escaped headings", () => {
    const html = stripLeadingTopicHeading(
      "<h3>AI &amp; software patents</h3><p>Story.</p>",
      "AI & software patents",
    );
    assert.equal(html, "<p>Story.</p>");
  });

  it("still works when sanitize runs before strip (ampersand topics)", () => {
    const sanitized = sanitizeDigestHtml(
      "<h3>AI & software patents</h3><p><strong>Foo</strong> — bar.</p>",
    );
    const html = stripLeadingTopicHeading(sanitized, "AI & software patents");
    assert.equal(html, "<p><strong>Foo</strong> — bar.</p>");
  });

  it("unwraps double-escaped ampersands after sanitize of entity HTML", () => {
    const sanitized = sanitizeDigestHtml(
      "<h3>AI &amp; software patents</h3><p>Story.</p>",
    );
    const html = stripLeadingTopicHeading(sanitized, "AI & software patents");
    assert.equal(html, "<p>Story.</p>");
  });

  it("allows h3 attributes and inner tags", () => {
    const html = stripLeadingTopicHeading(
      '<h3 class="topic"><strong>AI &amp; software patents</strong></h3><p>Story.</p>',
      "AI & software patents",
    );
    assert.equal(html, "<p>Story.</p>");
  });

  it("decodes named entities and nbsp", () => {
    const html = stripLeadingTopicHeading(
      "<h3>caf&eacute;&nbsp;&mdash;&nbsp;Patents&trade;</h3><p>Story.</p>",
      "café — Patents™",
    );
    assert.equal(html, "<p>Story.</p>");
  });

  it("matches NFC-equivalent unicode", () => {
    const composed = "café";
    const decomposed = "cafe\u0301";
    const html = stripLeadingTopicHeading(`<h3>${decomposed}</h3><p>Story.</p>`, composed);
    assert.equal(html, "<p>Story.</p>");
  });

  it("skips leading HTML comments before the topic h3", () => {
    const html = stripLeadingTopicHeading(
      "<!-- agent -->\n<h3>Topic</h3><p>Story.</p>",
      "Topic",
    );
    assert.equal(html, "<p>Story.</p>");
  });
});
