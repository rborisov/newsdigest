import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeCanonicalUrl, parseStoriesFromHtml } from "./dedup";

const MAX_ILLUSTRATIONS = 8;
const MAX_OG_STORIES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (compatible; NewsDigestPortal/1.0; +https://github.com/rborisov/newsdigest)",
};
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const IMG_TAG_PATTERN =
  /<img\b([^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*)\/?>/gi;
const FIGURE_BLOCK_PATTERN = /<figure\b[^>]*>[\s\S]*?<\/figure>/gi;
const STANDALONE_IMG_PATTERN = /<img\b[^>]*\/?>/gi;

export type IllustrationPrepareResult = {
  html: string;
  attempted: number;
  saved: number;
  failed: string[];
  enrichedFromStories: number;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveAbsoluteUrl(raw: string, baseUrl: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function sniffImageContentType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "RIFF") {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
      bytes.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  return null;
}

export function extractOgImageFromHtml(pageHtml: string, baseUrl: string): string | null {
  const patterns = [
    /<meta\s+[^>]*property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta\s+[^>]*name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(pageHtml);
    if (match?.[1]) {
      const resolved = resolveAbsoluteUrl(match[1], baseUrl);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

async function fetchOgImageForStory(
  storyUrl: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const normalized = normalizeCanonicalUrl(storyUrl);
  try {
    const response = await fetchFn(normalized, {
      redirect: "follow",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return null;
    }

    const headerType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (headerType.startsWith("image/")) {
      return normalized;
    }

    const text = await response.text();
    if (text.length > 500_000) {
      return null;
    }
    return extractOgImageFromHtml(text, normalized);
  } catch {
    return null;
  }
}

function paragraphHasFigureAfter(html: string, storyUrl: string): boolean {
  const normalized = normalizeCanonicalUrl(storyUrl);
  const pattern = new RegExp(
    `<p\\b[^>]*>[\\s\\S]*?href\\s*=\\s*(?:"${escapeRegExp(normalized)}"|'${escapeRegExp(normalized)}'|${escapeRegExp(normalized)})[\\s\\S]*?<\\/p>\\s*(<figure[\\s\\S]*?<\\/figure>)?`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) {
    return false;
  }
  return Boolean(match[1]);
}

function injectFigureAfterStoryParagraph(
  html: string,
  storyUrl: string,
  imageUrl: string,
  caption: string,
): string {
  const normalized = normalizeCanonicalUrl(storyUrl);
  const figure =
    `<figure><img src="${imageUrl}"/><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  const pattern = new RegExp(
    `(<p\\b[^>]*>[\\s\\S]*?href\\s*=\\s*(?:"${escapeRegExp(normalized)}"|'${escapeRegExp(normalized)}'|${escapeRegExp(normalized)})[\\s\\S]*?<\\/p>)`,
    "i",
  );
  if (!pattern.test(html)) {
    return html;
  }
  return html.replace(pattern, `$1${figure}`);
}

/**
 * When the agent omitted images, fetch og:image (or twitter:image) from story pages
 * and inject <figure> blocks after matching story paragraphs.
 */
export async function enrichHtmlWithStoryIllustrations(
  html: string,
  fetchFn: typeof fetch = fetch,
  options?: { maxStories?: number },
): Promise<{ html: string; injected: number }> {
  const maxStories = options?.maxStories ?? MAX_OG_STORIES;
  const stories = parseStoriesFromHtml(html)
    .filter((story) => story.canonicalUrl?.trim())
    .slice(0, maxStories);

  let result = html;
  let injected = 0;

  for (const story of stories) {
    const storyUrl = story.canonicalUrl!.trim();
    if (paragraphHasFigureAfter(result, storyUrl)) {
      continue;
    }

    const imageUrl = await fetchOgImageForStory(storyUrl, fetchFn);
    if (!imageUrl) {
      continue;
    }

    const next = injectFigureAfterStoryParagraph(result, storyUrl, imageUrl, story.title);
    if (next !== result) {
      result = next;
      injected += 1;
    }
  }

  return { html: result, injected };
}

export function resolveIllustrationsRoot(): string {
  const explicit = process.env.ILLUSTRATIONS_DIR?.trim();
  if (explicit) {
    return explicit;
  }

  const dbUrl = process.env.DATABASE_URL?.trim();
  if (dbUrl?.startsWith("file:")) {
    const dbPath = dbUrl.slice("file:".length);
    return path.join(path.dirname(dbPath), "illustrations");
  }

  return path.join(process.cwd(), "data", "illustrations");
}

export function illustrationPublicUrl(topicId: string, filename: string): string {
  return `/api/illustrations/${topicId}/${filename}`;
}

export function isSafeIllustrationFilename(filename: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(filename) && !filename.includes("..");
}

export function isSafeTopicId(topicId: string): boolean {
  return /^[a-z0-9]+$/i.test(topicId) && topicId.length >= 8 && topicId.length <= 64;
}

export function isAllowedBoardIllustrationSrc(src: string, topicId?: string): boolean {
  const trimmed = src.trim();
  if (!trimmed.startsWith("/api/illustrations/")) {
    return false;
  }
  const parts = trimmed.split("/");
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "api" || parts[2] !== "illustrations") {
    return false;
  }
  const srcTopicId = parts[3] ?? "";
  const filename = parts[4] ?? "";
  if (!isSafeTopicId(srcTopicId) || !isSafeIllustrationFilename(filename)) {
    return false;
  }
  if (topicId && srcTopicId !== topicId) {
    return false;
  }
  return true;
}

export async function resolveIllustrationFile(
  topicId: string,
  filename: string,
): Promise<string | null> {
  if (!isSafeTopicId(topicId) || !isSafeIllustrationFilename(filename)) {
    return null;
  }

  const absolute = path.join(resolveIllustrationsRoot(), topicId, filename);
  const root = path.resolve(resolveIllustrationsRoot());
  if (!path.resolve(absolute).startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return absolute;
}

function extensionForContentType(contentType: string): string {
  const lower = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  switch (lower) {
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/jpg":
    case "image/jpeg":
    default:
      return "jpg";
  }
}

function contentTypeForFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

export async function readIllustrationFile(
  topicId: string,
  filename: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const absolute = await resolveIllustrationFile(topicId, filename);
  if (!absolute) {
    return null;
  }

  try {
    const bytes = await readFile(absolute);
    return {
      bytes,
      contentType: contentTypeForFilename(filename),
    };
  } catch {
    return null;
  }
}

async function downloadIllustration(
  sourceUrl: string,
  fetchFn: typeof fetch,
): Promise<{ bytes: Buffer; contentType: string }> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error(`Invalid image URL: ${sourceUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported image protocol: ${parsed.protocol}`);
  }

  const response = await fetchFn(sourceUrl, {
    redirect: "follow",
    headers: FETCH_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status})`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("Downloaded image is empty");
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
  }

  const headerType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  const sniffedType = sniffImageContentType(bytes);
  const contentType =
    sniffedType ??
    (ALLOWED_IMAGE_TYPES.has(headerType) || headerType.startsWith("image/")
      ? headerType
      : null);
  if (!contentType) {
    throw new Error(`Unsupported image content-type: ${headerType || "unknown"}`);
  }

  const normalizedType = ALLOWED_IMAGE_TYPES.has(contentType) ? contentType : "image/jpeg";
  return { bytes, contentType: normalizedType };
}

async function saveIllustration(
  topicId: string,
  sourceUrl: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const { bytes, contentType } = await downloadIllustration(sourceUrl, fetchFn);
  const ext = extensionForContentType(contentType);
  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 12);
  const filename = `${hash}-${randomUUID().slice(0, 8)}.${ext}`;
  const topicDir = path.join(resolveIllustrationsRoot(), topicId);
  await mkdir(topicDir, { recursive: true });
  await writeFile(path.join(topicDir, filename), bytes);
  return illustrationPublicUrl(topicId, filename);
}

/** Remove all illustration files for a topic (called before a fresh publish). */
export async function clearTopicIllustrations(topicId: string): Promise<void> {
  if (!isSafeTopicId(topicId)) {
    return;
  }
  const topicDir = path.join(resolveIllustrationsRoot(), topicId);
  await rm(topicDir, { recursive: true, force: true });
}

/** Strip figure/img blocks from HTML before publishing to Telegra.ph. */
export function stripIllustrationsForTelegraph(html: string): string {
  return html
    .replace(FIGURE_BLOCK_PATTERN, "")
    .replace(STANDALONE_IMG_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectExternalImageUrls(html: string): string[] {
  const urls = new Set<string>();
  IMG_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMG_TAG_PATTERN.exec(html)) !== null) {
    const src = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (src.startsWith("http://") || src.startsWith("https://")) {
      urls.add(src);
    }
  }
  return [...urls];
}

function replaceImgSources(
  html: string,
  replacements: Map<string, string | null>,
): string {
  IMG_TAG_PATTERN.lastIndex = 0;
  return html.replace(IMG_TAG_PATTERN, (full, _attrs, q1, q2, q3) => {
    const src = (q1 ?? q2 ?? q3 ?? "").trim();
    if (!src.startsWith("http://") && !src.startsWith("https://")) {
      if (isAllowedBoardIllustrationSrc(src)) {
        return full;
      }
      return "";
    }
    const local = replacements.get(src);
    if (!local) {
      return "";
    }
    return `<img src="${local}"/>`;
  });
}

/**
 * Download external illustration URLs to the VPS and rewrite img src for the home board.
 * Illustrations are not sent to Telegra.ph.
 */
export async function prepareBoardHtmlWithIllustrations(
  topicId: string,
  html: string,
  fetchFn: typeof fetch = fetch,
): Promise<IllustrationPrepareResult> {
  const externalUrls = collectExternalImageUrls(html).slice(0, MAX_ILLUSTRATIONS);
  const replacements = new Map<string, string | null>();
  const failed: string[] = [];
  let saved = 0;

  for (const sourceUrl of externalUrls) {
    try {
      const localUrl = await saveIllustration(topicId, sourceUrl, fetchFn);
      replacements.set(sourceUrl, localUrl);
      saved += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "download failed";
      failed.push(`${sourceUrl}: ${message}`);
      replacements.set(sourceUrl, null);
    }
  }

  let boardHtml = replaceImgSources(html, replacements);
  boardHtml = boardHtml.replace(/<figure\b[^>]*>\s*<\/figure>/gi, "");
  return {
    html: boardHtml.trim(),
    attempted: externalUrls.length,
    saved,
    failed,
    enrichedFromStories: 0,
  };
}
