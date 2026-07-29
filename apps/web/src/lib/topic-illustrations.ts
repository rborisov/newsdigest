import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_ILLUSTRATIONS = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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
    headers: { Accept: "image/*,*/*;q=0.8" },
  });
  if (!response.ok) {
    throw new Error(`Failed to download image (${response.status})`);
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
    "image/jpeg";
  if (!ALLOWED_IMAGE_TYPES.has(contentType) && !contentType.startsWith("image/")) {
    throw new Error(`Unsupported image content-type: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("Downloaded image is empty");
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds ${MAX_IMAGE_BYTES} bytes`);
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
): Promise<string> {
  const externalUrls = collectExternalImageUrls(html).slice(0, MAX_ILLUSTRATIONS);
  const replacements = new Map<string, string | null>();

  for (const sourceUrl of externalUrls) {
    try {
      const localUrl = await saveIllustration(topicId, sourceUrl, fetchFn);
      replacements.set(sourceUrl, localUrl);
    } catch {
      replacements.set(sourceUrl, null);
    }
  }

  let boardHtml = replaceImgSources(html, replacements);
  boardHtml = boardHtml.replace(/<figure\b[^>]*>\s*<\/figure>/gi, "");
  return boardHtml.trim();
}
