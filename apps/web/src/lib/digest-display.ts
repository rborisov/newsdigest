/** Display helpers for digest list titles / tags on the portal home. */

const GENERIC_TITLE = /^(news|daily)\s*digest\b/i;
const AGENT_DIGEST_TITLE = /^digest · .+ utc\b/i;

export function formatDigestWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDigestClock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Topic chips parsed from agent titles like:
 * "Digest · 2026-07-28 15:32 UTC · Opportunities · Выставки"
 */
export function topicsFromDigestTitle(title: string): string[] {
  const trimmed = title.trim();
  const match = trimmed.match(/^digest · .+?\butc\s*·\s*(.+)$/i);
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
}

/**
 * Distinct Telegra.ph title for the portal list, or null when it only repeats
 * date/time (and topics, which we show as tags instead).
 */
export function formatDigestHeading(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || GENERIC_TITLE.test(trimmed)) {
    return null;
  }
  // Legacy portal fallback: "Digest · HH:MM"
  if (/^digest · \d{1,2}:\d{2}/i.test(trimmed) && !/utc/i.test(trimmed)) {
    return null;
  }
  // Agent format already encoded in meta time + topic tags
  if (AGENT_DIGEST_TITLE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Label for a digest entry on the Telegra.ph index page. */
export function formatIndexLinkLabel(input: {
  title: string;
  createdAt: Date;
  storyTitles?: string[];
}): string {
  const when = input.createdAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const topics = topicsFromDigestTitle(input.title);
  const storyTags = digestContentTags(input.storyTitles ?? [], 3);
  const bits = topics.length > 0 ? topics : storyTags;
  if (bits.length > 0) {
    const label = `${when} · ${bits.join(" · ")}`;
    return label.length > 140 ? `${label.slice(0, 137).trimEnd()}…` : label;
  }

  const heading = formatDigestHeading(input.title);
  if (heading) {
    return heading.length > 120 ? `${heading.slice(0, 117).trimEnd()}…` : heading;
  }
  return when;
}

/** Labels that appear as Telegra.ph / HTML link text, not real headlines. */
const NOISE_TAG = /^(source|sources|link|read more|more|here|click|url|http|https|www)$/i;

function isUsefulTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (trimmed.length < 3) {
    return false;
  }
  if (NOISE_TAG.test(trimmed)) {
    return false;
  }
  return true;
}

/** Merge topic + story chips for the portal list (deduped). */
export function digestListTags(input: {
  title: string;
  storyTitles: string[];
  limit?: number;
}): string[] {
  const limit = input.limit ?? 5;
  const tags: string[] = [];
  const seen = new Set<string>();

  // Prefer topic names from the digest title; story titles are often "Source".
  for (const tag of [...topicsFromDigestTitle(input.title), ...digestContentTags(input.storyTitles, limit * 2)]) {
    if (!isUsefulTag(tag)) {
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(tag);
    if (tags.length >= limit) {
      break;
    }
  }
  return tags;
}

/** Short chips from story titles (content tags). */
export function digestContentTags(storyTitles: string[], limit = 4): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const raw of storyTitles) {
    const cleaned = raw
      .replace(/\s+/g, " ")
      .replace(/^[\d.)\-\s]+/, "")
      .trim();
    if (!cleaned || !isUsefulTag(cleaned)) {
      continue;
    }
    const short =
      cleaned.length > 36 ? `${cleaned.slice(0, 34).trimEnd()}…` : cleaned;
    const key = short.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tags.push(short);
    if (tags.length >= limit) {
      break;
    }
  }

  return tags;
}
