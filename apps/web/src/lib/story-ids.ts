import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

import { normalizeTitleKey } from "./dedup";
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Append ` · {storyId}` before `</p>` if not already present. */
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

  type Planned = { start: number; end: number; paragraph: string; id: string };
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
    });
  }

  planned.sort((a, b) => b.start - a.start);

  let result = html;
  for (const item of planned) {
    const stamped = appendStoryIdSuffix(item.paragraph, item.id);
    result = result.slice(0, item.start) + stamped + result.slice(item.end);
  }

  return result;
}
