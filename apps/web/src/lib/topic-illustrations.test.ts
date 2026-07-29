import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  clearTopicIllustrations,
  enrichHtmlWithStoryIllustrations,
  extractOgImageFromHtml,
  illustrationPublicUrl,
  isAllowedBoardIllustrationSrc,
  prepareBoardHtmlWithIllustrations,
  resolveIllustrationsRoot,
  stripIllustrationsForTelegraph,
} from "./topic-illustrations";

const TOPIC_ID = "cltopic1234567890";

describe("topic-illustrations", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) {
      process.env.ILLUSTRATIONS_DIR = tempRoot;
      await clearTopicIllustrations(TOPIC_ID);
      delete process.env.ILLUSTRATIONS_DIR;
      tempRoot = "";
    }
  });

  it("strips figure and img blocks for Telegra.ph HTML", () => {
    const html =
      '<h3>Topic</h3><p><strong>Story</strong></p><figure><img src="https://cdn.test/a.jpg"/><figcaption>Photo</figcaption></figure><p>Next</p>';
    const stripped = stripIllustrationsForTelegraph(html);
    assert.match(stripped, /<p><strong>Story<\/strong><\/p>/);
    assert.doesNotMatch(stripped, /figure|figcaption|<img/i);
    assert.match(stripped, /<p>Next<\/p>/);
  });

  it("allows only portal illustration URLs on the board", () => {
    const local = illustrationPublicUrl(TOPIC_ID, "abc.jpg");
    assert.equal(isAllowedBoardIllustrationSrc(local, TOPIC_ID), true);
    assert.equal(isAllowedBoardIllustrationSrc(local, "otherTopicId123456"), false);
    assert.equal(isAllowedBoardIllustrationSrc("https://evil.test/x.jpg"), false);
  });

  it("downloads external images to the VPS and rewrites board HTML", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "nd-illus-"));
    process.env.ILLUSTRATIONS_DIR = tempRoot;

    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.test/story.png") {
        return new Response(Buffer.from("fake-png"), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const html =
      '<p><strong>Headline</strong></p><figure><img src="https://cdn.test/story.png"/><figcaption>Launch</figcaption></figure>';
    const prepared = await prepareBoardHtmlWithIllustrations(TOPIC_ID, html, fetchFn);

    assert.match(prepared.html, /\/api\/illustrations\//);
    assert.doesNotMatch(prepared.html, /https:\/\/cdn\.test/);
    assert.equal(prepared.attempted, 1);
    assert.equal(prepared.saved, 1);

    const files = await readdir(path.join(resolveIllustrationsRoot(), TOPIC_ID));
    assert.equal(files.length, 1);
    assert.match(files[0] ?? "", /\.png$/);
  });

  it("clears illustrations when a topic is updated", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "nd-illus-"));
    process.env.ILLUSTRATIONS_DIR = tempRoot;

    const fetchFn = (async () =>
      new Response(Buffer.from("bytes"), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })) as typeof fetch;

    await prepareBoardHtmlWithIllustrations(
      TOPIC_ID,
      '<figure><img src="https://cdn.test/old.jpg"/></figure>',
      fetchFn,
    );
    assert.equal((await readdir(path.join(tempRoot, TOPIC_ID))).length, 1);

    await clearTopicIllustrations(TOPIC_ID);
    await assert.rejects(readdir(path.join(tempRoot, TOPIC_ID)));

    await prepareBoardHtmlWithIllustrations(
      TOPIC_ID,
      '<figure><img src="https://cdn.test/new.jpg"/></figure>',
      fetchFn,
    );
    const saved = await readdir(path.join(tempRoot, TOPIC_ID));
    assert.equal(saved.length, 1);
    const bytes = await readFile(path.join(tempRoot, TOPIC_ID, saved[0]!));
    assert.equal(bytes.toString(), "bytes");
  });

  it("extracts og:image from article HTML", () => {
    const image = extractOgImageFromHtml(
      '<html><head><meta property="og:image" content="https://cdn.test/hero.jpg"/></head></html>',
      "https://news.test/story",
    );
    assert.equal(image, "https://cdn.test/hero.jpg");
  });

  it("injects og:image figures when the agent omitted illustrations", async () => {
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://news.test/story-one") {
        return new Response(
          '<html><head><meta property="og:image" content="https://cdn.test/hero.jpg"/></head></html>',
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const html =
      '<p><strong>Big launch</strong> — details. <a href="https://news.test/story-one">Kommersant</a></p>';
    const enriched = await enrichHtmlWithStoryIllustrations(html, fetchFn);
    assert.equal(enriched.injected, 1);
    assert.match(enriched.html, /<figure><img src="https:\/\/cdn\.test\/hero\.jpg"\/>/);
    assert.match(enriched.html, /<figcaption>Kommersant<\/figcaption>/);
  });
});
