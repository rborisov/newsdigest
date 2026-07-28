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
    "",
    "HTML FORMAT (required — Telegra.ph only supports these tags):",
    `- Start with <h3>${topicName}</h3>`,
    "- One <p> per story: <p><strong>Headline</strong> — 1–3 sentence summary. <a href=\"URL\">Publisher</a></p>",
    "- Use a real headline in <strong>; link text should be the publisher/site name (not \"Source\")",
    "- Separate stories with their own <p> tags (never glue headlines together)",
    "- Optional: <hr/> at the end of the topic section",
    "- Do NOT use <h1> or <h2> (they are stripped); use <h3> only",
    "- If there is no relevant news: <h3>…</h3><p><em>No notable stories in the lookback window.</em></p>",
    "",
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
    "You are merging topic drafts into one news digest HTML page for Telegra.ph.",
    "",
    `Lookback period: ${placeholders.periodHours} hours`,
    `Date: ${placeholders.date}`,
    "",
    "Merge the drafts below into ONE htmlContent string with this exact structure:",
    "<p><em>24-hour lookback · {date}</em></p>",
    "Then for each topic that has news:",
    "  <h3>Topic Name</h3>",
    "  <p><strong>Headline</strong> — summary. <a href=\"URL\">Publisher</a></p>",
    "  <p>…next story…</p>",
    "  <hr/>",
    "",
    "Rules:",
    "- Keep all real stories and source links from the drafts",
    "- One <h3> per topic; one <p> per story — never concatenate topics or headlines",
    "- Put <hr/> between topics",
    "- Do NOT use <h1>/<h2> (unsupported); use <h3> only",
    "- Link text = publisher name; stories[].title = the headline (not \"Source\")",
    "- Do not invent new stories; light copy-editing for consistency is OK",
    "- Skip topics whose draft says there was no news",
    "",
    "TITLE for publish_digest_page (required format):",
    `Digest · ${placeholders.date} {HH:MM} UTC · {Topic1} · {Topic2}`,
    "- Include the current UTC clock time (hours:minutes)",
    "- After the time, list 2–4 topic names that appear in this digest (short names)",
    "- Do NOT use a bare title like \"News Digest — date\" or \"Daily Digest — date\"",
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
