import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { normalizeCanonicalUrl, normalizeTitleKey } from "./dedup";
import { findStoryParagraphMatch } from "./topic-illustrations";

export type StoryWithId = {
  id: string;
  title: string;
  canonicalUrl?: string | null;
  titleKey?: string | null;
};

/** Prisma `@default(cuid())`-shaped id: `c` + base36 time/entropy (~25 chars). */
export function createCuid(): string {
  const time = Date.now().toString(36);
  const entropy = randomBytes(10).toString("hex");
  return (`c${time}${entropy}`).slice(0, 25);
}

export async function resolveStoryIds(
  db: PrismaClient,
  stories: Array<{
    title: string;
    canonicalUrl?: string | null;
    titleKey?: string | null;
  }>,
): Promise<StoryWithId[]> {
  const resolved: StoryWithId[] = [];

  for (const story of stories) {
    const canonicalUrl = story.canonicalUrl?.trim() || null;
    if (canonicalUrl) {
      const existing = await db.storyIndex.findUnique({
        where: { canonicalUrl },
        select: { id: true },
      });
      resolved.push({
        id: existing?.id ?? createCuid(),
        title: story.title,
        canonicalUrl,
        titleKey: story.titleKey ?? null,
      });
      continue;
    }

    resolved.push({
      id: createCuid(),
      title: story.title,
      canonicalUrl: null,
      titleKey: story.titleKey ?? null,
    });
  }

  return resolved;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function paragraphHasAnchorForUrl(paragraph: string, url: string): boolean {
  const want = normalizeCanonicalUrl(url);
  for (const match of paragraph.matchAll(
    /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
  )) {
    const href = normalizeCanonicalUrl((match[1] ?? match[2] ?? match[3] ?? "").trim());
    if (href === want) {
      return true;
    }
  }
  return false;
}

function defaultLinkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "Source";
  }
}

/**
 * When the agent omitted a source link, add one from the story canonical URL
 * so portal + Telegra.ph still show a clickable source.
 */
export function ensureStorySourceLink(
  paragraphHtml: string,
  canonicalUrl: string | null | undefined,
): string {
  const url = canonicalUrl?.trim();
  if (!url || !/<\/p>\s*$/i.test(paragraphHtml)) {
    return paragraphHtml;
  }
  if (paragraphHasAnchorForUrl(paragraphHtml, url) || /<a\b/i.test(paragraphHtml)) {
    return paragraphHtml;
  }

  const label = defaultLinkLabel(url);
  const anchor = `<a href="${escapeHtmlAttr(url)}">${escapeHtmlText(label)}</a>`;
  return paragraphHtml.replace(/<\/p>\s*$/i, ` ${anchor}</p>`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function appendStoryIdSuffix(paragraphHtml: string, storyId: string): string {
  const id = storyId.trim();
  if (!id || !/<\/p>\s*$/i.test(paragraphHtml)) {
    return paragraphHtml;
  }

  if (new RegExp(` · ${escapeRegExp(id)}\\s*</p>\\s*$`, "i").test(paragraphHtml)) {
    return paragraphHtml;
  }

  const withoutOld = paragraphHtml.replace(/ · c[a-z0-9]{8,}\s*(?=<\/p>)/i, "");
  return withoutOld.replace(/<\/p>\s*$/i, ` · ${id}</p>`);
}

function findStoryParagraphByTitle(
  html: string,
  title: string,
  usedStarts: Set<number>,
): { paragraph: string; start: number; end: number } | null {
  const want = normalizeTitleKey(title);
  if (!want) {
    return null;
  }

  const paragraphPattern = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(html)) !== null) {
    const start = match.index;
    if (usedStarts.has(start)) {
      continue;
    }

    const paragraph = match[0];
    const strong = /<strong\b[^>]*>([\s\S]*?)<\/strong>/i.exec(paragraph);
    const candidate = strong
      ? strong[1].replace(/<[^>]+>/g, " ")
      : paragraph.replace(/<[^>]+>/g, " ");
    if (normalizeTitleKey(candidate) !== want) {
      continue;
    }

    return {
      paragraph,
      start,
      end: start + paragraph.length,
    };
  }

  return null;
}

/**
 * Stamp each story's full cuid at the end of its matching `<p>` as ` · {id}`.
 * Matches by canonical URL first, then by `<strong>` / paragraph title.
 */
export function stampStoryIdsInHtml(html: string, stories: StoryWithId[]): string {
  if (!html.trim() || stories.length === 0) {
    return html;
  }

  type Planned = { start: number; end: number; paragraph: string; id: string; canonicalUrl?: string | null };
  const planned: Planned[] = [];
  const usedStarts = new Set<number>();

  for (const story of stories) {
    let block: { paragraph: string; start: number; end: number } | null = null;

    if (story.canonicalUrl?.trim()) {
      const byUrl = findStoryParagraphMatch(html, story.canonicalUrl);
      if (byUrl && !usedStarts.has(byUrl.start)) {
        block = byUrl;
      }
    }

    if (!block) {
      block = findStoryParagraphByTitle(html, story.title, usedStarts);
    }

    if (!block) {
      continue;
    }

    usedStarts.add(block.start);
    planned.push({
      start: block.start,
      end: block.end,
      paragraph: block.paragraph,
      id: story.id,
      canonicalUrl: story.canonicalUrl,
    });
  }

  planned.sort((a, b) => b.start - a.start);

  let result = html;
  for (const item of planned) {
    const withSource = ensureStorySourceLink(item.paragraph, item.canonicalUrl);
    const stamped = appendStoryIdSuffix(withSource, item.id);
    result = result.slice(0, item.start) + stamped + result.slice(item.end);
  }

  return result;
}
