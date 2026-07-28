export const EXCLUDE_LOOKBACK_DAYS = 30;
export const EXCLUDE_MAX_STORIES = 150;

const TRACKING_QUERY_PREFIXES = ["utm_", "mc_", "fbclid", "gclid", "yclid", "ref", "ref_src"];

export type StoryFingerprint = {
  title: string;
  canonicalUrl?: string | null;
  titleKey?: string | null;
};

export type KnownStory = {
  canonicalUrl: string | null;
  titleKey: string | null;
};

export function normalizeCanonicalUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }

  const params = [...url.searchParams.keys()];
  for (const key of params) {
    const lower = key.toLowerCase();
    if (TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower === prefix)) {
      url.searchParams.delete(key);
    }
  }

  url.hash = "";
  return url.toString();
}

export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatExcludeStoryLine(story: StoryFingerprint): string {
  const url = story.canonicalUrl?.trim();
  const title = story.title.trim();

  if (url && title) {
    return `- ${url} — ${title}`;
  }
  if (url) {
    return `- ${url}`;
  }
  if (title) {
    return `- ${title}`;
  }
  return "";
}

export function formatExcludeStories(stories: StoryFingerprint[]): string {
  const lines = stories
    .map(formatExcludeStoryLine)
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "(none)";
  }

  return lines.join("\n");
}

export function parseStoriesFromHtml(html: string): StoryFingerprint[] {
  const stories: StoryFingerprint[] = [];
  const seen = new Set<string>();
  const anchorPattern =
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const innerText = (match[4] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!href || href.startsWith("#")) {
      continue;
    }

    const canonicalUrl = normalizeCanonicalUrl(href);
    const fromLink = innerText || canonicalUrl;
    const fromContext =
      match.index != null ? headlineNearAnchor(html, match.index) : null;
    const title =
      isNoiseStoryTitle(fromLink) && fromContext ? fromContext : fromLink;
    const dedupeKey = canonicalUrl || normalizeTitleKey(title);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    stories.push({
      title,
      canonicalUrl,
      titleKey: normalizeTitleKey(title),
    });
  }

  return stories;
}

const NOISE_STORY_TITLE =
  /^(source|sources|link|read more|more|here|click|url|http|https|www)$/i;

export function isNoiseStoryTitle(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 3) {
    return true;
  }
  return NOISE_STORY_TITLE.test(trimmed);
}

/** Prefer <strong>headline</strong> in the same paragraph as a weak "Source" link. */
export function headlineNearAnchor(html: string, anchorIndex: number): string | null {
  const before = html.slice(Math.max(0, anchorIndex - 800), anchorIndex);
  const pOpen = Math.max(before.lastIndexOf("<p"), before.lastIndexOf("<p "));
  const chunk = pOpen >= 0 ? before.slice(pOpen) : before;

  const strongMatches = [...chunk.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)];
  const strong = strongMatches.at(-1)?.[1];
  if (strong) {
    const text = strong.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text && !isNoiseStoryTitle(text)) {
      return text;
    }
  }

  const textOnly = chunk.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const beforeDash = textOnly.split(/\s+[—–-]\s+/)[0]?.trim() ?? "";
  if (beforeDash.length >= 12 && !isNoiseStoryTitle(beforeDash)) {
    return beforeDash.length > 120 ? `${beforeDash.slice(0, 117).trimEnd()}…` : beforeDash;
  }

  return null;
}

/** If agent/stories array used "Source" as title, recover headlines from HTML. */
export function enrichStoriesFromHtml(
  stories: StoryFingerprint[],
  html: string,
): StoryFingerprint[] {
  const fromHtml = parseStoriesFromHtml(html);
  if (stories.length === 0) {
    return fromHtml;
  }

  return stories.map((story) => {
    if (!isNoiseStoryTitle(story.title)) {
      return story;
    }
    const url = story.canonicalUrl ? normalizeCanonicalUrl(story.canonicalUrl) : null;
    const match = url
      ? fromHtml.find((row) => row.canonicalUrl === url)
      : fromHtml.find((row) => !isNoiseStoryTitle(row.title));
    if (!match || isNoiseStoryTitle(match.title)) {
      return story;
    }
    return {
      ...story,
      title: match.title,
      titleKey: normalizeTitleKey(match.title),
    };
  });
}

export function isStoryKnown(story: StoryFingerprint, known: KnownStory[]): boolean {
  const normalizedUrl = story.canonicalUrl ? normalizeCanonicalUrl(story.canonicalUrl) : null;
  const titleKey = story.titleKey ?? normalizeTitleKey(story.title);

  return known.some((entry) => {
    if (normalizedUrl && entry.canonicalUrl) {
      return normalizeCanonicalUrl(entry.canonicalUrl) === normalizedUrl;
    }
    if (titleKey && entry.titleKey) {
      return entry.titleKey === titleKey;
    }
    return false;
  });
}

export function areAllStoriesKnown(stories: StoryFingerprint[], known: KnownStory[]): boolean {
  if (stories.length === 0) {
    return false;
  }

  return stories.every((story) => isStoryKnown(story, known));
}

export function normalizeStoryFingerprints(stories: StoryFingerprint[]): StoryFingerprint[] {
  return stories.map((story) => ({
    title: story.title.trim(),
    canonicalUrl: story.canonicalUrl ? normalizeCanonicalUrl(story.canonicalUrl) : null,
    titleKey: story.titleKey ?? normalizeTitleKey(story.title),
  }));
}
