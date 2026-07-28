import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INDEX_SOFT_LIMIT_BYTES,
  buildIndexHtml,
  decideIndexUpdateAction,
  estimateSize,
  htmlToTelegraphNodes,
} from "./telegraph";

describe("telegraph", () => {
  describe("htmlToTelegraphNodes", () => {
    it("converts headings, paragraphs, links, and inline tags", () => {
      const html =
        '<h3>Story title</h3><p>Summary. <a href="https://source.com">Source</a></p>';
      const nodes = htmlToTelegraphNodes(html);

      assert.deepEqual(nodes, [
        { tag: "h3", children: ["Story title"] },
        {
          tag: "p",
          children: [
            "Summary. ",
            { tag: "a", attrs: { href: "https://source.com" }, children: ["Source"] },
          ],
        },
      ]);
    });

    it("supports blockquote, hr, strong, and em", () => {
      const html =
        "<blockquote><p><strong>Bold</strong> and <em>italic</em></p></blockquote><hr/>";
      const nodes = htmlToTelegraphNodes(html);

      assert.deepEqual(nodes, [
        {
          tag: "blockquote",
          children: [
            {
              tag: "p",
              children: [
                { tag: "strong", children: ["Bold"] },
                " and ",
                { tag: "em", children: ["italic"] },
              ],
            },
          ],
        },
        { tag: "hr" },
      ]);
    });
  });

  describe("estimateSize", () => {
    it("measures UTF-8 byte length of serialized Telegraph nodes", () => {
      const nodes = htmlToTelegraphNodes("<p>Hello</p>");
      const size = estimateSize(nodes);
      assert.equal(size, Buffer.byteLength(JSON.stringify(nodes), "utf8"));
    });

    it("grows with larger node trees", () => {
      const small = htmlToTelegraphNodes("<p>a</p>");
      const large = htmlToTelegraphNodes(`<p>${"x".repeat(1000)}</p>`);
      assert.ok(estimateSize(large) > estimateSize(small));
    });
  });

  describe("buildIndexHtml", () => {
    it("builds intro, digest links, and optional older-digests footer", () => {
      const html = buildIndexHtml(
        [
          { title: "Daily Digest — 2026-07-28", url: "https://telegra.ph/Daily-Digest-07-28" },
          { title: "Daily Digest — 2026-07-27", url: "https://telegra.ph/Daily-Digest-07-27" },
        ],
        "https://telegra.ph/Daily-News-Digest-Index-2",
      );

      assert.match(html, /<h3>Daily News Digest<\/h3>/);
      assert.match(html, /Daily Digest — 2026-07-28/);
      assert.match(html, /Daily Digest — 2026-07-27/);
      assert.match(html, /Older digests →/);
      assert.match(html, /Daily-News-Digest-Index-2/);
    });
  });

  describe("decideIndexUpdateAction", () => {
    it("returns create_first when no current index exists", () => {
      const html = buildIndexHtml([
        { title: "Daily Digest — 2026-07-28", url: "https://telegra.ph/Daily-Digest-07-28" },
      ]);

      assert.equal(decideIndexUpdateAction(false, html), "create_first");
    });

    it("returns edit when candidate body is under the soft limit", () => {
      const links = Array.from({ length: 5 }, (_, index) => ({
        title: `Daily Digest — 2026-07-${String(index + 1).padStart(2, "0")}`,
        url: `https://telegra.ph/Daily-Digest-07-${String(index + 1).padStart(2, "0")}`,
      }));
      const html = buildIndexHtml(links, "https://telegra.ph/older-index");

      assert.equal(decideIndexUpdateAction(true, html), "edit");
      assert.ok(estimateSize(htmlToTelegraphNodes(html)) <= INDEX_SOFT_LIMIT_BYTES);
    });

    it("returns rotate when candidate body exceeds the soft limit", () => {
      const links = Array.from({ length: 900 }, (_, index) => ({
        title: `Daily Digest — 2026-07-28 #${index} with a longer title to consume bytes`,
        url: `https://telegra.ph/Daily-Digest-07-28-${index}`,
      }));
      const html = buildIndexHtml(links, "https://telegra.ph/older-index");

      assert.equal(decideIndexUpdateAction(true, html), "rotate");
      assert.ok(estimateSize(htmlToTelegraphNodes(html)) > INDEX_SOFT_LIMIT_BYTES);
    });
  });
});
