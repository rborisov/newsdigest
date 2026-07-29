import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INDEX_LOCK_BUSY_ERROR,
  INDEX_SOFT_LIMIT_BYTES,
  buildIndexHtml,
  decideIndexUpdateAction,
  estimateSize,
  htmlToTelegraphNodes,
  mergeIndexPagesForAssembly,
  sanitizeAuthorUrl,
  withIndexUpdateLock,
} from "./telegraph";

describe("telegraph", () => {
  describe("sanitizeAuthorUrl", () => {
    it("returns undefined for empty or invalid values", () => {
      assert.equal(sanitizeAuthorUrl(""), undefined);
      assert.equal(sanitizeAuthorUrl("   "), undefined);
      assert.equal(sanitizeAuthorUrl("not a url !!!"), undefined);
    });

    it("keeps valid https URLs", () => {
      assert.equal(sanitizeAuthorUrl("https://t.me/mychannel"), "https://t.me/mychannel");
    });

    it("normalizes @handles and bare t.me paths", () => {
      assert.equal(sanitizeAuthorUrl("@mychannel"), "https://t.me/mychannel");
      assert.equal(sanitizeAuthorUrl("t.me/mychannel"), "https://t.me/mychannel");
    });

    it("adds https to bare hostnames", () => {
      assert.equal(sanitizeAuthorUrl("example.com/news"), "https://example.com/news");
    });
  });
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

    it("maps h2 to h3 so topic headings are not stripped", () => {
      const nodes = htmlToTelegraphNodes(
        "<h2>3GPP NTN</h2><p><strong>Story</strong> — summary. <a href=\"https://a.test\">Source</a></p>",
      );
      assert.deepEqual(nodes[0], { tag: "h3", children: ["3GPP NTN"] });
      assert.equal((nodes[1] as { tag: string }).tag, "p");
    });

    it("supports ul/li lists", () => {
      const nodes = htmlToTelegraphNodes("<h3>Open RAN</h3><ul><li>Item one</li><li>Item two</li></ul>");
      assert.deepEqual(nodes[0], { tag: "h3", children: ["Open RAN"] });
      assert.equal((nodes[1] as { tag: string }).tag, "ul");
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
    it("builds intro, digest links, and optional older-digests footer without repeating the page title", () => {
      const html = buildIndexHtml(
        [
          { title: "2026-07-28 14:06 UTC · Amazon Leo", url: "https://telegra.ph/Daily-Digest-07-28" },
          { title: "2026-07-27 09:00 UTC · Open RAN", url: "https://telegra.ph/Daily-Digest-07-27" },
        ],
        "https://telegra.ph/Daily-News-Digest-Index-2",
      );

      assert.doesNotMatch(html, /<h3>n\. digests<\/h3>/);
      assert.doesNotMatch(html, /<h3>Daily News Digest<\/h3>/);
      assert.match(html, /Newest first/);
      assert.match(html, /Amazon Leo/);
      assert.match(html, /Open RAN/);
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

  describe("mergeIndexPagesForAssembly", () => {
    it("dedupes by telegraphUrl and prefers TopicPage over PublishedPage", () => {
      const sharedUrl = "https://telegra.ph/Daily-Digest-07-28";
      const merged = mergeIndexPagesForAssembly(
        [
          {
            id: "legacy_1",
            title: "Legacy title",
            telegraphUrl: sharedUrl,
            publishedAt: new Date("2026-07-28T10:00:00Z"),
          },
          {
            id: "legacy_2",
            title: "Other legacy",
            telegraphUrl: "https://telegra.ph/Other",
            publishedAt: new Date("2026-07-27T10:00:00Z"),
          },
        ],
        [
          {
            id: "topic_1",
            title: "Topic title",
            telegraphUrl: sharedUrl,
            publishedAt: new Date("2026-07-28T12:00:00Z"),
          },
        ],
      );

      assert.equal(merged.length, 2);
      assert.equal(merged[0]?.id, "topic_1");
      assert.equal(merged[0]?.title, "Topic title");
      assert.equal(merged[1]?.id, "legacy_2");
    });
  });

  describe("withIndexUpdateLock", () => {
    it("acquires when unlocked and releases afterward", async () => {
      const calls: string[] = [];
      const mockDb = {
        telegraphMeta: {
          updateMany: async () => {
            calls.push("acquire");
            return { count: 1 };
          },
          update: async () => {
            calls.push("release");
            return {};
          },
        },
      };

      const result = await withIndexUpdateLock(mockDb as never, async () => {
        calls.push("work");
        return "ok";
      });

      assert.equal(result, "ok");
      assert.deepEqual(calls, ["acquire", "work", "release"]);
    });

    it("throws when the lock is held by another writer", async () => {
      const mockDb = {
        telegraphMeta: {
          updateMany: async () => ({ count: 0 }),
          update: async () => {
            throw new Error("should not release when acquire failed");
          },
        },
      };

      await assert.rejects(
        () => withIndexUpdateLock(mockDb as never, async () => "nope"),
        (error: unknown) =>
          error instanceof Error && error.message === INDEX_LOCK_BUSY_ERROR,
      );
    });
  });
});
