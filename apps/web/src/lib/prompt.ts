import type { PrismaClient } from "@prisma/client";

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
};

export function formatTopicsList(topicNames: string[]): string {
  if (topicNames.length === 0) {
    return "(no topics enabled)";
  }

  return topicNames.map((name) => `- ${name}`).join("\n");
}

export function formatPromptDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function applyPromptPlaceholders(
  template: string,
  placeholders: PromptPlaceholders,
): string {
  return template
    .replaceAll("{{TOPICS}}", placeholders.topics)
    .replaceAll("{{PERIOD_HOURS}}", String(placeholders.periodHours))
    .replaceAll("{{DATE}}", placeholders.date)
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

export async function loadExcludeStories(
  deps: PromptDeps = {},
): Promise<StoryFingerprint[]> {
  const db = deps.prisma ?? defaultPrisma;
  const now = deps.now ?? new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - EXCLUDE_LOOKBACK_DAYS);

  const rows = await db.publishedStory.findMany({
    where: { firstSeenAt: { gte: since } },
    orderBy: { firstSeenAt: "desc" },
    take: EXCLUDE_MAX_STORIES,
    select: {
      title: true,
      canonicalUrl: true,
    },
  });

  return rows.map((row) => ({
    title: row.title,
    canonicalUrl: row.canonicalUrl,
  }));
}

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
    db.promptConfig.findUnique({ where: { id: PROMPT_CONFIG_ID } }),
    loadExcludeStories({ prisma: db, now }),
  ]);

  if (!promptConfig) {
    throw new Error("Prompt config not found.");
  }

  const assembled = applyPromptPlaceholders(promptConfig.template, {
    topics: formatTopicsList(topics.map((topic) => topic.name)),
    periodHours: promptConfig.periodHours,
    date: formatPromptDate(now),
    excludeStories: formatExcludeStories(excludeStories),
  });

  return appendJobMetadata(assembled, jobId, triggeredBy);
}
