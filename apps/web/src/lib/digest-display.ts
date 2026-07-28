/** Display helpers for digest list titles / tags on the portal home. */

const GENERIC_TITLE = /^(news|daily)\s*digest\b/i;

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

/** Prefer a short label when Telegra.ph titles are near-duplicates. */
export function formatDigestHeading(title: string, createdAt: Date): string {
  const trimmed = title.trim();
  if (!trimmed || GENERIC_TITLE.test(trimmed)) {
    return `Digest · ${formatDigestClock(createdAt)}`;
  }
  return trimmed;
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
    if (!cleaned) {
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
