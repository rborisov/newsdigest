import type { PrismaClient, Topic } from "@prisma/client";

import {
  EXCLUDE_LOOKBACK_DAYS,
  EXCLUDE_MAX_STORIES,
  formatExcludeStories,
  type StoryFingerprint,
} from "./dedup";
import { prisma as defaultPrisma } from "./db";

const PROMPT_CONFIG_ID = "default";

export type PromptDeps = {
  prisma?: PrismaClient;
  now?: Date;
};

export type PromptPlaceholders = {
  topics: string;
  periodHours: number;
  date: string;
  excludeStories: string;
  language: string;
};

export function formatTopicsList(topicNames: string[]): string {
  if (topicNames.length === 0) {
    return "(no topics enabled)";
  }

  return topicNames.map((name) => `- ${name}`).join("\n");
}

export function formatTopicWithKeywords(topic: Pick<Topic, "name" | "keywords">): string {
  const keywords = topic.keywords.trim();
  if (!keywords) {
    return `- ${topic.name}`;
  }
  return `- ${topic.name}\n  Keywords: ${keywords}`;
}

export function formatPromptDate(date: Date, timeZone = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone.trim() || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function applyPromptPlaceholders(
  template: string,
  placeholders: PromptPlaceholders,
): string {
  return template
    .replaceAll("{{TOPICS}}", placeholders.topics)
    .replaceAll("{{PERIOD_HOURS}}", String(placeholders.periodHours))
    .replaceAll("{{DATE}}", placeholders.date)
    .replaceAll("{{LANGUAGE}}", placeholders.language)
    .replaceAll("{{EXCLUDE_STORIES}}", placeholders.excludeStories);
}

export function appendJobMetadata(
  prompt: string,
  jobId: string,
  triggeredBy?: string,
): string {
  const lines = [
    prompt.trim(),
    "",
    "---",
    `Generation job ID: ${jobId}`,
    `When publishing, call publish_digest_page with jobId "${jobId}".`,
  ];

  if (triggeredBy?.trim()) {
    lines.push(`Triggered by: ${triggeredBy.trim()}`);
  }

  return lines.join("\n");
}

export function appendTopicPublishMetadata(
  prompt: string,
  jobId: string,
  stepId: string,
  topicName: string,
  options: {
    triggeredBy?: string;
    displayTimezone?: string;
    language?: string;
  } = {},
): string {
  const timeZone = options.displayTimezone?.trim() || "UTC";
  const language = options.language?.trim() || "English";
  const lines = [
    prompt.trim(),
    "",
    "---",
    "THIS IS A SINGLE-TOPIC PUBLISH STEP.",
    `Generation job ID: ${jobId}`,
    `Generation step ID: ${stepId}`,
    `Topic name (pass exactly to publish_digest_page): ${topicName}`,
    `Output language: ${language}`,
    "Research ONLY this topic for the lookback period.",
    "Do NOT include other topics in the HTML or title.",
    "",
    "HTML FORMAT (required — Telegra.ph only supports these tags):",
    `- Start with <h3>${topicName}</h3>`,
    "- One <p> per story: <p><strong>Headline</strong> — 1–3 sentence summary. <a href=\"URL\">Publisher</a></p>",
    "- Use a real headline in <strong>; link text should be the publisher/site name (not \"Source\")",
    "- Separate stories with their own <p> tags (never glue headlines together)",
    "- Optional illustration after a story (portal home board only — NOT on Telegra.ph):",
    "  <figure><img src=\"https://...\"/><figcaption>Short caption</figcaption></figure>",
    "- Prefer the story's primary photo / og:image; skip logos, icons, ads, and stock fillers",
    "- Only use real image URLs you found; do not invent URLs",
    "- Do NOT use <h1> or <h2> (they are stripped); use <h3> only",
    "- If there is no relevant news: <h3>…</h3><p><em>No notable stories in the lookback window.</em></p>",
    `- Write the digest body in ${language}`,
    "",
    "TITLE for publish_digest_page (required format):",
    `${topicName} · {date} {HH:MM}`,
    `- Use today's date and current clock time in timezone ${timeZone} (not UTC unless that is the configured zone)`,
    "",
    `Call publish_digest_page with jobId "${jobId}", stepId "${stepId}", topicName "${topicName}", title, htmlContent, and stories.`,
    "Do NOT call save_topic_draft.",
    "Do not finish until publish_digest_page returns ok.",
  ];

  if (options.triggeredBy?.trim()) {
    lines.push(`Triggered by: ${options.triggeredBy.trim()}`);
  }

  return lines.join("\n");
}

/** StoryIndex primary; PublishedStory fallback until legacy backfill completes. */
export async function loadExcludeStories(
  deps: PromptDeps = {},
): Promise<StoryFingerprint[]> {
  const db = deps.prisma ?? defaultPrisma;
  const now = deps.now ?? new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - EXCLUDE_LOOKBACK_DAYS);

  const [storyIndexRows, publishedStoryRows] = await Promise.all([
    db.storyIndex.findMany({
      where: { firstSeenAt: { gte: since } },
      orderBy: { firstSeenAt: "desc" },
      take: EXCLUDE_MAX_STORIES,
      select: {
        title: true,
        canonicalUrl: true,
      },
    }),
    db.publishedStory.findMany({
      where: { firstSeenAt: { gte: since } },
      orderBy: { firstSeenAt: "desc" },
      take: EXCLUDE_MAX_STORIES,
      select: {
        title: true,
        canonicalUrl: true,
      },
    }),
  ]);

  const seen = new Set<string>();
  const result: StoryFingerprint[] = [];

  for (const row of storyIndexRows) {
    const key = row.canonicalUrl ?? row.title;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ title: row.title, canonicalUrl: row.canonicalUrl });
    if (result.length >= EXCLUDE_MAX_STORIES) {
      return result;
    }
  }

  for (const row of publishedStoryRows) {
    const key = row.canonicalUrl ?? row.title;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ title: row.title, canonicalUrl: row.canonicalUrl });
    if (result.length >= EXCLUDE_MAX_STORIES) {
      return result;
    }
  }

  return result;
}

async function loadPromptConfig(deps: PromptDeps) {
  const db = deps.prisma ?? defaultPrisma;
  const promptConfig = await db.promptConfig.findUnique({ where: { id: PROMPT_CONFIG_ID } });
  if (!promptConfig) {
    throw new Error("Prompt config not found.");
  }
  return promptConfig;
}

/** Legacy single-shot prompt (all topics → publish). Kept for tests / fallback. */
export async function buildPrompt(
  jobId: string,
  deps: PromptDeps = {},
  triggeredBy?: string,
): Promise<string> {
  const db = deps.prisma ?? defaultPrisma;
  const now = deps.now ?? new Date();

  const [topics, promptConfig, excludeStories] = await Promise.all([
    db.topic.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    }),
    loadPromptConfig(deps),
    loadExcludeStories({ prisma: db, now }),
  ]);

  const assembled = applyPromptPlaceholders(promptConfig.template, {
    topics: formatTopicsList(topics.map((topic) => topic.name)),
    periodHours: promptConfig.periodHours,
    date: formatPromptDate(now, promptConfig.displayTimezone),
    language: promptConfig.language || "English",
    excludeStories: formatExcludeStories(excludeStories),
  });

  return appendJobMetadata(assembled, jobId, triggeredBy);
}

export async function buildTopicPublishPrompt(
  jobId: string,
  stepId: string,
  topic: Pick<Topic, "name" | "keywords">,
  deps: PromptDeps = {},
  triggeredBy?: string,
): Promise<string> {
  const now = deps.now ?? new Date();
  const [promptConfig, excludeStories] = await Promise.all([
    loadPromptConfig(deps),
    loadExcludeStories(deps),
  ]);

  const assembled = applyPromptPlaceholders(promptConfig.template, {
    topics: formatTopicWithKeywords(topic),
    periodHours: promptConfig.periodHours,
    date: formatPromptDate(now, promptConfig.displayTimezone),
    language: promptConfig.language || "English",
    excludeStories: formatExcludeStories(excludeStories),
  });

  return appendTopicPublishMetadata(assembled, jobId, stepId, topic.name, {
    triggeredBy,
    displayTimezone: promptConfig.displayTimezone,
    language: promptConfig.language,
  });
}
