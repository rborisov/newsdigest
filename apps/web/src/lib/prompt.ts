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
};

export type MergeDraftSection = {
  topicName: string;
  html: string;
  storiesJson?: string | null;
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

export function appendTopicDraftMetadata(
  prompt: string,
  jobId: string,
  topicName: string,
  triggeredBy?: string,
): string {
  const lines = [
    prompt.trim(),
    "",
    "---",
    "THIS IS A SINGLE-TOPIC DRAFT STEP (not the final publish).",
    `Generation job ID: ${jobId}`,
    `Topic name (pass exactly to save_topic_draft): ${topicName}`,
    "Research ONLY this topic for the lookback period.",
    "Write HTML for this topic section only (heading + story bullets with source links).",
    "If there is no relevant news, still call save_topic_draft with a short HTML note saying no stories found.",
    `Call save_topic_draft with jobId "${jobId}", topic "${topicName}", html, and stories.`,
    "Do NOT call publish_digest_page in this step.",
    "Do not finish until save_topic_draft returns ok.",
  ];

  if (triggeredBy?.trim()) {
    lines.push(`Triggered by: ${triggeredBy.trim()}`);
  }

  return lines.join("\n");
}

export function formatMergeDrafts(drafts: MergeDraftSection[]): string {
  if (drafts.length === 0) {
    return "(no topic drafts)";
  }

  return drafts
    .map((draft) => {
      const body = draft.html.trim() || "(empty draft)";
      return [`## Topic: ${draft.topicName}`, body].join("\n");
    })
    .join("\n\n");
}

export function buildMergePromptBody(placeholders: PromptPlaceholders, drafts: MergeDraftSection[]): string {
  return [
    "You are merging topic drafts into one news digest HTML page.",
    "",
    `Lookback period: ${placeholders.periodHours} hours`,
    `Date: ${placeholders.date}`,
    "",
    "Below are HTML drafts already researched per topic. Merge them into one coherent digest:",
    "- Keep all real stories and source links from the drafts",
    "- Use one h2 (or equivalent) per topic that has news",
    "- Do not invent new stories; light copy-editing for consistency is OK",
    "- Skip topics whose draft says there was no news",
    "",
    "Do NOT include any story listed under EXCLUDE_STORIES.",
    "",
    "EXCLUDE_STORIES:",
    placeholders.excludeStories,
    "",
    "TOPIC DRAFTS:",
    formatMergeDrafts(drafts),
  ].join("\n");
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
    date: formatPromptDate(now),
    excludeStories: formatExcludeStories(excludeStories),
  });

  return appendJobMetadata(assembled, jobId, triggeredBy);
}

export async function buildTopicDraftPrompt(
  jobId: string,
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
    date: formatPromptDate(now),
    excludeStories: formatExcludeStories(excludeStories),
  });

  return appendTopicDraftMetadata(assembled, jobId, topic.name, triggeredBy);
}

export async function buildMergePublishPrompt(
  jobId: string,
  drafts: MergeDraftSection[],
  deps: PromptDeps = {},
  triggeredBy?: string,
): Promise<string> {
  const now = deps.now ?? new Date();
  const [promptConfig, excludeStories] = await Promise.all([
    loadPromptConfig(deps),
    loadExcludeStories(deps),
  ]);

  const body = buildMergePromptBody(
    {
      topics: "",
      periodHours: promptConfig.periodHours,
      date: formatPromptDate(now),
      excludeStories: formatExcludeStories(excludeStories),
    },
    drafts,
  );

  return appendJobMetadata(body, jobId, triggeredBy);
}
