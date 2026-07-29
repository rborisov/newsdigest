import { PrismaClient, TriggerType } from "@prisma/client";

import { formatIndexLinkLabel } from "./digest-display";
import { prisma as defaultPrisma } from "./db";
import { appendJobLogLine } from "./job-logs";
import {
  clearTopicIllustrations,
  enrichHtmlWithStoryIllustrations,
  prepareBoardHtmlWithIllustrations,
  stripIllustrationsForTelegraph,
} from "./topic-illustrations";
import { resolveStoryIds, stampStoryIdsInHtml } from "./story-ids";

export const INDEX_SOFT_LIMIT_BYTES = 55_000;
export const INDEX_PAGE_TITLE = "n. digests";
export const OLDER_DIGESTS_LABEL = "Older digests →";
export const TELEGRAPH_API_BASE = "https://api.telegra.ph";

/**
 * Telegra.ph requires author_url to be empty or a real http(s) URL.
 * Admin often has bare domains / t.me paths / @handles — normalize or drop.
 */
export function sanitizeAuthorUrl(raw: string | null | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return undefined;
  }

  let candidate = trimmed;
  if (candidate.startsWith("@") && candidate.length > 1) {
    candidate = `https://t.me/${candidate.slice(1)}`;
  } else if (/^(t\.me|telegram\.me)\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (!url.hostname) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export type TelegraphNodeElement = {
  tag: string;
  attrs?: Record<string, string>;
  children?: TelegraphNode[];
};

export type TelegraphNode = string | TelegraphNodeElement;

export type IndexDigestLink = {
  title: string;
  url: string;
};

export type PublishStoryInput = {
  title: string;
  canonicalUrl?: string | null;
  titleKey?: string | null;
};

export type PublishDigestInput = {
  title: string;
  html: string;
  stories: PublishStoryInput[];
  jobId: string;
  topicId?: string | null;
  topicName: string;
  stepId?: string | null;
  triggerType: TriggerType;
  triggeredBy: string;
};

export type PublishDigestResult = {
  digestUrl: string;
  digestPath: string;
  indexUrl: string;
  indexPath: string;
  topicPageId: string;
};

export type IndexDigestPage = {
  id: string;
  title: string;
  telegraphUrl: string;
  telegraphPath: string;
  publishedAt: Date;
  storyTitles?: string[];
};

export type IndexPageKind = "topic" | "published";

export type IndexUpdateAction = "create_first" | "edit" | "rotate";

export type IndexAssemblyPage = {
  id: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  stories?: { title: string }[];
  storyTitles?: string[];
};

/** Merge legacy PublishedPage and TopicPage index rows; prefer TopicPage on duplicate telegraphUrl. */
export function mergeIndexPagesForAssembly(
  publishedPages: IndexAssemblyPage[],
  topicPages: IndexAssemblyPage[],
): IndexAssemblyPage[] {
  const byUrl = new Map<string, IndexAssemblyPage>();
  for (const page of publishedPages) {
    byUrl.set(page.telegraphUrl, page);
  }
  for (const page of topicPages) {
    byUrl.set(page.telegraphUrl, page);
  }
  return Array.from(byUrl.values()).sort(
    (left, right) => right.publishedAt.getTime() - left.publishedAt.getTime(),
  );
}

type TelegraphPageResult = {
  path: string;
  url: string;
};

type TelegraphApiResponse = {
  ok: boolean;
  result?: TelegraphPageResult;
  error?: string;
};

type TelegraphDeps = {
  prisma?: PrismaClient;
  fetchFn?: typeof fetch;
};

const ALLOWED_TAGS = new Set([
  "h3",
  "h4",
  "p",
  "a",
  "blockquote",
  "br",
  "hr",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
]);
const VOID_TAGS = new Set(["hr", "br"]);
const TAG_ALIASES: Record<string, string> = {
  h1: "h3",
  h2: "h3",
  b: "strong",
  i: "em",
};
const TAG_PATTERN = /<\/?([a-z][a-z0-9]*)\b([^>]*)\/?>/gi;

function mapHtmlTag(tag: string): string {
  const lower = tag.toLowerCase();
  return TAG_ALIASES[lower] ?? lower;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, "\u00a0");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text);
}

function parseAnchorHref(attrString: string): string | undefined {
  const hrefMatch = attrString.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!hrefMatch) {
    return undefined;
  }
  return hrefMatch[2] ?? hrefMatch[3] ?? hrefMatch[4];
}

function appendText(stack: TelegraphNodeElement[], text: string): void {
  const normalized = text.replace(/\s+/g, " ");
  if (!normalized.trim()) {
    return;
  }

  const parent = stack[stack.length - 1];
  parent.children ??= [];
  parent.children.push(normalized);
}

function appendNode(stack: TelegraphNodeElement[], node: TelegraphNodeElement): void {
  const parent = stack[stack.length - 1];
  parent.children ??= [];
  parent.children.push(node);
}

function createElement(tag: string, attrString: string): TelegraphNodeElement | null {
  const mapped = mapHtmlTag(tag);
  if (!ALLOWED_TAGS.has(mapped)) {
    return null;
  }

  const node: TelegraphNodeElement = { tag: mapped };
  if (mapped === "a") {
    const href = parseAnchorHref(attrString);
    if (href) {
      node.attrs = { href };
    }
  }
  return node;
}

/** Bare root text (e.g. from stripped headings) becomes paragraphs so Telegra.ph keeps line breaks. */
export function wrapOrphanTextNodes(nodes: TelegraphNode[]): TelegraphNode[] {
  const result: TelegraphNode[] = [];
  for (const node of nodes) {
    if (typeof node !== "string") {
      result.push(node);
      continue;
    }
    const text = node.trim();
    if (!text) {
      continue;
    }
    result.push({ tag: "p", children: [text] });
  }
  return result;
}

export function htmlToTelegraphNodes(html: string): TelegraphNode[] {
  const trimmed = html.trim();
  if (!trimmed) {
    return [];
  }

  const root: TelegraphNodeElement = { tag: "root", children: [] };
  const stack: TelegraphNodeElement[] = [root];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TAG_PATTERN.lastIndex = 0;
  while ((match = TAG_PATTERN.exec(trimmed)) !== null) {
    const textBefore = trimmed.slice(lastIndex, match.index);
    if (textBefore) {
      appendText(stack, decodeHtmlEntities(textBefore));
    }

    const fullTag = match[0];
    const tag = mapHtmlTag(match[1]);
    const attrString = match[2];
    const isClosingTag = fullTag.startsWith("</");
    const isSelfClosing = fullTag.endsWith("/>") || VOID_TAGS.has(tag);

    if (isClosingTag) {
      const hasMatch = stack.some((frame) => frame.tag === tag);
      if (hasMatch) {
        while (stack.length > 1) {
          const current = stack.pop();
          if (current?.tag === tag) {
            break;
          }
        }
      }
    } else if (VOID_TAGS.has(tag) || isSelfClosing) {
      const node = createElement(tag, attrString);
      if (node) {
        appendNode(stack, node);
      }
    } else {
      const node = createElement(tag, attrString);
      if (node) {
        appendNode(stack, node);
        stack.push(node);
      }
    }

    lastIndex = TAG_PATTERN.lastIndex;
  }

  const trailingText = trimmed.slice(lastIndex);
  if (trailingText) {
    appendText(stack, decodeHtmlEntities(trailingText));
  }

  return wrapOrphanTextNodes(root.children ?? []);
}

export function estimateSize(nodes: TelegraphNode[]): number {
  return Buffer.byteLength(JSON.stringify(nodes), "utf8");
}

export function buildIndexHtml(
  digestLinks: IndexDigestLink[],
  previousIndexUrl?: string,
): string {
  // Do not repeat INDEX_PAGE_TITLE here — Telegra.ph already shows createPage title as H1.
  const parts = [
    "<p><em>Newest first. Each link opens a full digest.</em></p>",
    "<hr/>",
  ];

  for (const link of digestLinks) {
    parts.push(
      `<p><a href="${escapeAttr(link.url)}">${escapeHtml(link.title)}</a></p>`,
    );
  }

  if (previousIndexUrl) {
    parts.push("<hr/>");
    parts.push(
      `<p><a href="${escapeAttr(previousIndexUrl)}">${OLDER_DIGESTS_LABEL}</a></p>`,
    );
  }

  return parts.join("\n");
}

export function decideIndexUpdateAction(
  hasCurrentIndex: boolean,
  candidateHtml: string,
  softLimitBytes: number = INDEX_SOFT_LIMIT_BYTES,
): IndexUpdateAction {
  if (!hasCurrentIndex) {
    return "create_first";
  }

  const size = estimateSize(htmlToTelegraphNodes(candidateHtml));
  return size <= softLimitBytes ? "edit" : "rotate";
}

function truncateTitle(title: string): string {
  return title.length <= 256 ? title : title.slice(0, 256);
}

async function callTelegraphApi(
  method: "createPage" | "editPage",
  params: {
    accessToken: string;
    title: string;
    content: TelegraphNode[];
    authorName?: string;
    authorUrl?: string;
    path?: string;
    fetchFn?: typeof fetch;
  },
): Promise<TelegraphPageResult> {
  const fetchFn = params.fetchFn ?? fetch;
  const body = new URLSearchParams();
  body.set("access_token", params.accessToken);
  body.set("title", truncateTitle(params.title));
  body.set("content", JSON.stringify(params.content));
  if (params.authorName) {
    body.set("author_name", params.authorName);
  }
  const authorUrl = sanitizeAuthorUrl(params.authorUrl);
  if (authorUrl) {
    body.set("author_url", authorUrl);
  }

  const url =
    method === "editPage"
      ? `${TELEGRAPH_API_BASE}/editPage/${encodeURIComponent(params.path ?? "")}`
      : `${TELEGRAPH_API_BASE}/createPage`;

  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Telegra.ph HTTP ${response.status}`);
  }

  const payload = (await response.json()) as TelegraphApiResponse;
  if (!payload.ok || !payload.result) {
    const apiError = payload.error ?? "Telegra.ph request failed";
    if (apiError === "AUTHOR_URL_INVALID") {
      throw new Error(
        "AUTHOR_URL_INVALID: set Author URL in Admin to a full https:// link (e.g. https://t.me/yourchannel), or clear it.",
      );
    }
    throw new Error(apiError);
  }

  return payload.result;
}

export async function createPage(
  params: {
    accessToken: string;
    title: string;
    content: TelegraphNode[] | string;
    authorName?: string;
    authorUrl?: string;
    fetchFn?: typeof fetch;
  },
): Promise<TelegraphPageResult> {
  const content =
    typeof params.content === "string"
      ? htmlToTelegraphNodes(params.content)
      : params.content;

  return callTelegraphApi("createPage", {
    accessToken: params.accessToken,
    title: params.title,
    content,
    authorName: params.authorName,
    authorUrl: params.authorUrl,
    fetchFn: params.fetchFn,
  });
}

export async function editPage(
  params: {
    accessToken: string;
    path: string;
    title: string;
    content: TelegraphNode[] | string;
    authorName?: string;
    authorUrl?: string;
    fetchFn?: typeof fetch;
  },
): Promise<TelegraphPageResult> {
  const content =
    typeof params.content === "string"
      ? htmlToTelegraphNodes(params.content)
      : params.content;

  return callTelegraphApi("editPage", {
    accessToken: params.accessToken,
    path: params.path,
    title: params.title,
    content,
    authorName: params.authorName,
    authorUrl: params.authorUrl,
    fetchFn: params.fetchFn,
  });
}

async function resolveAccessToken(db: PrismaClient): Promise<string> {
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  const token = meta?.accessToken.trim() || process.env.TELEGRAPH_ACCESS_TOKEN?.trim() || "";
  if (!token) {
    throw new Error("Telegra.ph access token is not configured");
  }
  return token;
}

async function loadAuthorFields(db: PrismaClient): Promise<{ authorName: string; authorUrl: string }> {
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  return {
    authorName: meta?.authorName ?? "",
    authorUrl: meta?.authorUrl ?? "",
  };
}

/** How long an acquired index lock is held before another writer may steal it. */
export const INDEX_LOCK_TTL_MS = 60_000;

export const INDEX_LOCK_BUSY_ERROR =
  "Index update already in progress; retry shortly.";

/**
 * SQLite-friendly mutex on TelegraphMeta.indexLockUntil so concurrent publishes
 * cannot race while rewriting the shared index page.
 */
export async function withIndexUpdateLock<T>(
  db: PrismaClient,
  fn: () => Promise<T>,
  options?: { ttlMs?: number; now?: Date },
): Promise<T> {
  const ttlMs = options?.ttlMs ?? INDEX_LOCK_TTL_MS;
  const now = options?.now ?? new Date();
  const lockUntil = new Date(now.getTime() + ttlMs);

  const acquired = await db.telegraphMeta.updateMany({
    where: {
      id: "default",
      OR: [{ indexLockUntil: null }, { indexLockUntil: { lt: now } }],
    },
    data: { indexLockUntil: lockUntil },
  });

  if (acquired.count !== 1) {
    throw new Error(INDEX_LOCK_BUSY_ERROR);
  }

  try {
    return await fn();
  } finally {
    await db.telegraphMeta.update({
      where: { id: "default" },
      data: { indexLockUntil: null },
    });
  }
}

async function updateIndexAfterPublishUnlocked(
  params: {
    digestPage: IndexDigestPage;
    pageKind: IndexPageKind;
  } & TelegraphDeps,
): Promise<{ indexUrl: string; indexPath: string; action: IndexUpdateAction }> {
  const db = params.prisma ?? defaultPrisma;
  const fetchFn = params.fetchFn;
  const accessToken = await resolveAccessToken(db);
  const { authorName, authorUrl } = await loadAuthorFields(db);
  const meta = await db.telegraphMeta.findUnique({ where: { id: "default" } });
  if (!meta) {
    throw new Error("Telegraph config not found");
  }

  const currentIndex = meta.currentIndexPath
    ? await db.telegraphIndexPage.findFirst({
        where: { telegraphPath: meta.currentIndexPath, isCurrent: true },
        include: {
          previousIndex: true,
          publishedPages: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              title: true,
              telegraphUrl: true,
              createdAt: true,
              stories: {
                take: 4,
                orderBy: { firstSeenAt: "asc" },
                select: { title: true },
              },
            },
          },
          topicPages: {
            orderBy: { publishedAt: "desc" },
            select: {
              id: true,
              title: true,
              telegraphUrl: true,
              publishedAt: true,
              stories: {
                take: 4,
                orderBy: { firstSeenAt: "asc" },
                select: { title: true },
              },
            },
          },
        },
      })
    : null;

  const promptConfig = await db.promptConfig.findUnique({
    where: { id: "default" },
    select: { displayTimezone: true },
  });
  const displayTimezone = promptConfig?.displayTimezone?.trim() || "UTC";

  const toIndexLink = (page: {
    title: string;
    telegraphUrl: string;
    publishedAt: Date;
    stories?: { title: string }[];
    storyTitles?: string[];
  }): IndexDigestLink => ({
    title: formatIndexLinkLabel({
      title: page.title,
      createdAt: page.publishedAt,
      storyTitles: page.storyTitles ?? page.stories?.map((story) => story.title) ?? [],
      timeZone: displayTimezone,
    }),
    url: page.telegraphUrl,
  });

  const newDigestLink = toIndexLink(params.digestPage);

  const indexedPages = mergeIndexPagesForAssembly(
    (currentIndex?.publishedPages ?? []).map((page) => ({
      id: page.id,
      title: page.title,
      telegraphUrl: page.telegraphUrl,
      publishedAt: page.createdAt,
      stories: page.stories,
    })),
    (currentIndex?.topicPages ?? []).map((page) => ({
      id: page.id,
      title: page.title,
      telegraphUrl: page.telegraphUrl,
      publishedAt: page.publishedAt,
      stories: page.stories,
    })),
  );

  const existingLinks: IndexDigestLink[] = indexedPages
    .filter((page) => page.id !== params.digestPage.id)
    .map((page) => toIndexLink(page));

  const digestLinksForCandidate = [newDigestLink, ...existingLinks];
  const previousIndexUrl = currentIndex?.previousIndex?.telegraphUrl;
  const candidateHtml = buildIndexHtml(digestLinksForCandidate, previousIndexUrl);
  const action = decideIndexUpdateAction(Boolean(currentIndex), candidateHtml);

  const linkPageToIndex = (indexPageId: string) => {
    if (params.pageKind === "topic") {
      return db.topicPage.update({
        where: { id: params.digestPage.id },
        data: { indexPageId },
      });
    }
    return db.publishedPage.update({
      where: { id: params.digestPage.id },
      data: { indexPageId },
    });
  };

  if (action === "create_first") {
    const indexHtml = buildIndexHtml([newDigestLink]);
    const created = await createPage({
      accessToken,
      title: INDEX_PAGE_TITLE,
      content: indexHtml,
      authorName,
      authorUrl,
      fetchFn,
    });

    const indexPage = await db.telegraphIndexPage.create({
      data: {
        telegraphPath: created.path,
        telegraphUrl: created.url,
        isCurrent: true,
      },
    });

    await db.$transaction([
      db.telegraphMeta.update({
        where: { id: "default" },
        data: {
          currentIndexPath: created.path,
          currentIndexUrl: created.url,
        },
      }),
      linkPageToIndex(indexPage.id),
    ]);

    return { indexUrl: created.url, indexPath: created.path, action };
  }

  if (action === "edit") {
    if (!currentIndex) {
      throw new Error("Current index page not found");
    }

    const edited = await editPage({
      accessToken,
      path: currentIndex.telegraphPath,
      title: INDEX_PAGE_TITLE,
      content: candidateHtml,
      authorName,
      authorUrl,
      fetchFn,
    });

    await db.$transaction([
      db.telegraphMeta.update({
        where: { id: "default" },
        data: {
          currentIndexPath: edited.path,
          currentIndexUrl: edited.url,
        },
      }),
      linkPageToIndex(currentIndex.id),
    ]);

    return { indexUrl: edited.url, indexPath: edited.path, action };
  }

  if (!currentIndex) {
    throw new Error("Current index page not found");
  }

  const rotatedHtml = buildIndexHtml([newDigestLink], currentIndex.telegraphUrl);
  const created = await createPage({
    accessToken,
    title: INDEX_PAGE_TITLE,
    content: rotatedHtml,
    authorName,
    authorUrl,
    fetchFn,
  });

  const newIndexPage = await db.telegraphIndexPage.create({
    data: {
      telegraphPath: created.path,
      telegraphUrl: created.url,
      previousIndexId: currentIndex.id,
      isCurrent: true,
    },
  });

  await db.$transaction([
    db.telegraphIndexPage.update({
      where: { id: currentIndex.id },
      data: {
        isCurrent: false,
        closedAt: new Date(),
      },
    }),
    db.telegraphMeta.update({
      where: { id: "default" },
      data: {
        currentIndexPath: created.path,
        currentIndexUrl: created.url,
      },
    }),
    linkPageToIndex(newIndexPage.id),
  ]);

  return { indexUrl: created.url, indexPath: created.path, action: "rotate" };
}

export async function updateIndexAfterPublish(
  params: {
    digestPage: IndexDigestPage;
    pageKind: IndexPageKind;
  } & TelegraphDeps,
): Promise<{ indexUrl: string; indexPath: string; action: IndexUpdateAction }> {
  const db = params.prisma ?? defaultPrisma;
  return withIndexUpdateLock(db, () => updateIndexAfterPublishUnlocked(params));
}

/**
 * Resume index linking for a digest that was created but never attached to the
 * index (partial publish). Does not create another Telegra.ph digest page.
 */
export async function linkDigestToIndex(
  pageId: string,
  deps: TelegraphDeps = {},
): Promise<{ indexUrl: string; indexPath: string; action: IndexUpdateAction }> {
  const db = deps.prisma ?? defaultPrisma;

  const topicPage = await db.topicPage.findUnique({
    where: { id: pageId },
    include: {
      stories: {
        take: 4,
        orderBy: { firstSeenAt: "asc" },
        select: { title: true },
      },
    },
  });

  if (topicPage) {
    if (topicPage.indexPageId) {
      const indexPage = await db.telegraphIndexPage.findUnique({
        where: { id: topicPage.indexPageId },
      });
      if (!indexPage) {
        throw new Error("Index page linked to topic digest is missing");
      }
      return {
        indexUrl: indexPage.telegraphUrl,
        indexPath: indexPage.telegraphPath,
        action: "edit",
      };
    }

    return updateIndexAfterPublish({
      digestPage: {
        id: topicPage.id,
        title: topicPage.title,
        telegraphUrl: topicPage.telegraphUrl,
        telegraphPath: topicPage.telegraphPath,
        publishedAt: topicPage.publishedAt,
        storyTitles: topicPage.stories.map((story) => story.title),
      },
      pageKind: "topic",
      prisma: db,
      fetchFn: deps.fetchFn,
    });
  }

  const publishedPage = await db.publishedPage.findUnique({
    where: { id: pageId },
    include: {
      stories: {
        take: 4,
        orderBy: { firstSeenAt: "asc" },
        select: { title: true },
      },
    },
  });

  if (!publishedPage) {
    throw new Error("Published page not found");
  }

  if (publishedPage.indexPageId) {
    const indexPage = await db.telegraphIndexPage.findUnique({
      where: { id: publishedPage.indexPageId },
    });
    if (!indexPage) {
      throw new Error("Index page linked to published digest is missing");
    }
    return {
      indexUrl: indexPage.telegraphUrl,
      indexPath: indexPage.telegraphPath,
      action: "edit",
    };
  }

  return updateIndexAfterPublish({
    digestPage: {
      id: publishedPage.id,
      title: publishedPage.title,
      telegraphUrl: publishedPage.telegraphUrl,
      telegraphPath: publishedPage.telegraphPath,
      publishedAt: publishedPage.createdAt,
      storyTitles: publishedPage.stories.map((story) => story.title),
    },
    pageKind: "published",
    prisma: db,
    fetchFn: deps.fetchFn,
  });
}

export async function publishDigest(
  input: PublishDigestInput,
  deps: TelegraphDeps = {},
): Promise<PublishDigestResult> {
  const db = deps.prisma ?? defaultPrisma;
  const fetchFn = deps.fetchFn ?? fetch;
  const accessToken = await resolveAccessToken(db);
  const { authorName, authorUrl } = await loadAuthorFields(db);

  let topicId = input.topicId?.trim() || null;
  if (!topicId && input.topicName.trim()) {
    const topic = await db.topic.findFirst({
      where: { name: input.topicName.trim() },
      select: { id: true },
    });
    topicId = topic?.id ?? null;
  }

  let sourceHtml = input.html;
  let enrichedFromStories = 0;

  if (topicId) {
    const enriched = await enrichHtmlWithStoryIllustrations(sourceHtml, fetchFn);
    sourceHtml = enriched.html;
    enrichedFromStories = enriched.injected;
    if (enriched.injected > 0) {
      appendJobLogLine(
        input.jobId,
        `illustrations: injected ${enriched.injected} og:image figure(s) for topic ${input.topicName}`,
        input.stepId ?? undefined,
      );
    }
  }

  let telegraphHtml = stripIllustrationsForTelegraph(sourceHtml);
  let boardHtml = telegraphHtml;

  if (topicId) {
    await clearTopicIllustrations(topicId);
    const prepared = await prepareBoardHtmlWithIllustrations(topicId, sourceHtml, fetchFn);
    boardHtml = prepared.html;
    telegraphHtml = stripIllustrationsForTelegraph(boardHtml);
    prepared.enrichedFromStories = enrichedFromStories;

    appendJobLogLine(
      input.jobId,
      `illustrations: attempted=${prepared.attempted} saved=${prepared.saved} enriched=${prepared.enrichedFromStories}` +
        (prepared.failed.length > 0 ? ` failed=${prepared.failed.join("; ")}` : ""),
      input.stepId ?? undefined,
    );
  } else {
    appendJobLogLine(
      input.jobId,
      `illustrations: skipped (no topicId for ${input.topicName})`,
      input.stepId ?? undefined,
    );
  }

  const storiesWithIds = await resolveStoryIds(db, input.stories);
  boardHtml = stampStoryIdsInHtml(boardHtml, storiesWithIds);
  telegraphHtml = stripIllustrationsForTelegraph(boardHtml);

  const digest = await createPage({
    accessToken,
    title: input.title,
    content: telegraphHtml,
    authorName,
    authorUrl,
    fetchFn,
  });

  const topicPage = await db.topicPage.create({
    data: {
      topicId,
      topicName: input.topicName,
      title: input.title,
      htmlContent: boardHtml,
      telegraphPath: digest.path,
      telegraphUrl: digest.url,
      triggerType: input.triggerType,
      triggeredBy: input.triggeredBy,
      jobId: input.jobId,
      stepId: input.stepId ?? null,
    },
  });

  for (const story of storiesWithIds) {
    if (story.canonicalUrl) {
      await db.storyIndex.upsert({
        where: { canonicalUrl: story.canonicalUrl },
        update: {
          title: story.title,
          titleKey: story.titleKey ?? null,
          topicPageId: topicPage.id,
        },
        create: {
          id: story.id,
          title: story.title,
          canonicalUrl: story.canonicalUrl,
          titleKey: story.titleKey ?? null,
          topicPageId: topicPage.id,
        },
      });
      continue;
    }

    await db.storyIndex.create({
      data: {
        id: story.id,
        title: story.title,
        titleKey: story.titleKey ?? null,
        topicPageId: topicPage.id,
      },
    });
  }

  const index = await updateIndexAfterPublish({
    digestPage: {
      id: topicPage.id,
      title: topicPage.title,
      telegraphUrl: topicPage.telegraphUrl,
      telegraphPath: topicPage.telegraphPath,
      publishedAt: topicPage.publishedAt,
      storyTitles: storiesWithIds.map((story) => story.title),
    },
    pageKind: "topic",
    prisma: db,
    fetchFn,
  });

  return {
    digestUrl: digest.url,
    digestPath: digest.path,
    indexUrl: index.indexUrl,
    indexPath: index.indexPath,
    topicPageId: topicPage.id,
  };
}
