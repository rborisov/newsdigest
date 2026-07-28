import { PrismaClient, TriggerType } from "@prisma/client";

import { prisma as defaultPrisma } from "./db";

export const INDEX_SOFT_LIMIT_BYTES = 55_000;
export const INDEX_PAGE_TITLE = "Daily News Digest";
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
  triggerType: TriggerType;
  triggeredBy: string;
};

export type PublishDigestResult = {
  digestUrl: string;
  digestPath: string;
  indexUrl: string;
  indexPath: string;
  publishedPageId: string;
};

export type IndexUpdateAction = "create_first" | "edit" | "rotate";

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
  "hr",
  "strong",
  "em",
]);
const VOID_TAGS = new Set(["hr"]);
const TAG_PATTERN = /<\/?([a-z][a-z0-9]*)\b([^>]*)\/?>/gi;

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
  if (!ALLOWED_TAGS.has(tag)) {
    return null;
  }

  const node: TelegraphNodeElement = { tag };
  if (tag === "a") {
    const href = parseAnchorHref(attrString);
    if (href) {
      node.attrs = { href };
    }
  }
  return node;
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
    const tag = match[1].toLowerCase();
    const attrString = match[2];
    const isClosingTag = fullTag.startsWith("</");
    const isSelfClosing = fullTag.endsWith("/>") || VOID_TAGS.has(tag);

    if (isClosingTag) {
      while (stack.length > 1) {
        const current = stack.pop();
        if (current?.tag === tag) {
          break;
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

  return root.children ?? [];
}

export function estimateSize(nodes: TelegraphNode[]): number {
  return Buffer.byteLength(JSON.stringify(nodes), "utf8");
}

export function buildIndexHtml(
  digestLinks: IndexDigestLink[],
  previousIndexUrl?: string,
): string {
  const parts = [
    `<h3>${INDEX_PAGE_TITLE}</h3>`,
    "<p><em>Latest news digests</em></p>",
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
    publishedPage: {
      id: string;
      title: string;
      telegraphUrl: string;
      telegraphPath: string;
    };
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
            select: { id: true, title: true, telegraphUrl: true },
          },
        },
      })
    : null;

  const newDigestLink: IndexDigestLink = {
    title: params.publishedPage.title,
    url: params.publishedPage.telegraphUrl,
  };

  const existingLinks: IndexDigestLink[] =
    currentIndex?.publishedPages
      .filter((page) => page.id !== params.publishedPage.id)
      .map((page) => ({ title: page.title, url: page.telegraphUrl })) ?? [];

  const digestLinksForCandidate = [newDigestLink, ...existingLinks];
  const previousIndexUrl = currentIndex?.previousIndex?.telegraphUrl;
  const candidateHtml = buildIndexHtml(digestLinksForCandidate, previousIndexUrl);
  const action = decideIndexUpdateAction(Boolean(currentIndex), candidateHtml);

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
      db.publishedPage.update({
        where: { id: params.publishedPage.id },
        data: { indexPageId: indexPage.id },
      }),
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
      db.publishedPage.update({
        where: { id: params.publishedPage.id },
        data: { indexPageId: currentIndex.id },
      }),
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
    db.publishedPage.update({
      where: { id: params.publishedPage.id },
      data: { indexPageId: newIndexPage.id },
    }),
  ]);

  return { indexUrl: created.url, indexPath: created.path, action: "rotate" };
}

export async function updateIndexAfterPublish(
  params: {
    publishedPage: {
      id: string;
      title: string;
      telegraphUrl: string;
      telegraphPath: string;
    };
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
  publishedPageId: string,
  deps: TelegraphDeps = {},
): Promise<{ indexUrl: string; indexPath: string; action: IndexUpdateAction }> {
  const db = deps.prisma ?? defaultPrisma;
  const publishedPage = await db.publishedPage.findUnique({
    where: { id: publishedPageId },
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
    publishedPage: {
      id: publishedPage.id,
      title: publishedPage.title,
      telegraphUrl: publishedPage.telegraphUrl,
      telegraphPath: publishedPage.telegraphPath,
    },
    prisma: db,
    fetchFn: deps.fetchFn,
  });
}

export async function publishDigest(
  input: PublishDigestInput,
  deps: TelegraphDeps = {},
): Promise<PublishDigestResult> {
  const db = deps.prisma ?? defaultPrisma;
  const fetchFn = deps.fetchFn;
  const accessToken = await resolveAccessToken(db);
  const { authorName, authorUrl } = await loadAuthorFields(db);

  const digest = await createPage({
    accessToken,
    title: input.title,
    content: input.html,
    authorName,
    authorUrl,
    fetchFn,
  });

  const publishedPage = await db.publishedPage.create({
    data: {
      title: input.title,
      telegraphPath: digest.path,
      telegraphUrl: digest.url,
      triggerType: input.triggerType,
      triggeredBy: input.triggeredBy,
      jobId: input.jobId,
    },
  });

  for (const story of input.stories) {
    if (story.canonicalUrl) {
      await db.publishedStory.upsert({
        where: { canonicalUrl: story.canonicalUrl },
        update: {
          title: story.title,
          titleKey: story.titleKey ?? null,
          publishedPageId: publishedPage.id,
        },
        create: {
          title: story.title,
          canonicalUrl: story.canonicalUrl,
          titleKey: story.titleKey ?? null,
          publishedPageId: publishedPage.id,
        },
      });
      continue;
    }

    await db.publishedStory.create({
      data: {
        title: story.title,
        titleKey: story.titleKey ?? null,
        publishedPageId: publishedPage.id,
      },
    });
  }

  const index = await updateIndexAfterPublish({
    publishedPage: {
      id: publishedPage.id,
      title: publishedPage.title,
      telegraphUrl: publishedPage.telegraphUrl,
      telegraphPath: publishedPage.telegraphPath,
    },
    prisma: db,
    fetchFn,
  });

  return {
    digestUrl: digest.url,
    digestPath: digest.path,
    indexUrl: index.indexUrl,
    indexPath: index.indexPath,
    publishedPageId: publishedPage.id,
  };
}
