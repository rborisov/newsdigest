import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";
import {
  createTopicWithSources,
  ensureTopicSourcesMigrated,
  updateTopicAndSources,
} from "@/lib/topic-sources-db";
import { parseTopicSourcesBody, type TopicSourceInput } from "@/lib/topic-sources";
import { toPublicTopicSource } from "@/lib/topic-sources";

function topicWithSourcesJson(topic: {
  id: string;
  name: string;
  keywords: string;
  enabled: boolean;
  sortOrder: number;
  scheduleId: string | null;
  sources?: Array<{
    id: string;
    kind: string;
    enabled: boolean;
    sortOrder: number;
    configJson: string;
    connectionId: string | null;
    lastSyncAt: Date | null;
    lastError: string | null;
  }>;
}) {
  return {
    id: topic.id,
    name: topic.name,
    keywords: topic.keywords,
    enabled: topic.enabled,
    sortOrder: topic.sortOrder,
    scheduleId: topic.scheduleId,
    sources: (topic.sources ?? []).map(toPublicTopicSource),
  };
}

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  await ensureTopicSourcesMigrated();

  const topics = await prisma.topic.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      sources: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });

  return NextResponse.json({ topics: topics.map(topicWithSourcesJson) });
}

export async function POST(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  await ensureTopicSourcesMigrated();

  const body = (await request.json()) as {
    name?: string;
    keywords?: string;
    enabled?: boolean;
    sortOrder?: number;
    scheduleId?: string | null;
    sources?: unknown;
  };

  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  let sources: TopicSourceInput[];
  if (body.sources !== undefined) {
    const parsed = parseTopicSourcesBody(body.sources);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    sources = parsed;
  } else {
    const keywords = body.keywords?.trim() ?? "";
    if (!keywords) {
      return NextResponse.json(
        { error: "Add a web source with keywords, or a Telegram source with peers." },
        { status: 400 },
      );
    }
    sources = [
      {
        kind: "web",
        enabled: true,
        sortOrder: 0,
        config: { keywords },
      },
    ];
  }

  let scheduleId: string | null = null;
  if (body.scheduleId !== undefined && body.scheduleId !== null && body.scheduleId !== "") {
    const schedule = await prisma.schedule.findUnique({ where: { id: body.scheduleId } });
    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found." }, { status: 400 });
    }
    scheduleId = schedule.id;
  }

  try {
    const created = await createTopicWithSources({
      name,
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      scheduleId,
      sources,
    });
    return NextResponse.json(
      {
        topic: {
          id: created.topic.id,
          name: created.topic.name,
          keywords: created.topic.keywords,
          enabled: created.topic.enabled,
          sortOrder: created.topic.sortOrder,
          scheduleId: created.topic.scheduleId,
          sources: created.sources,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create topic.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  await ensureTopicSourcesMigrated();

  const body = (await request.json()) as {
    id?: string;
    name?: string;
    keywords?: string;
    enabled?: boolean;
    sortOrder?: number;
    scheduleId?: string | null;
    sources?: unknown;
  };

  if (!body.id) {
    return NextResponse.json({ error: "Topic id is required." }, { status: 400 });
  }

  let sources: TopicSourceInput[] | undefined;
  if (body.sources !== undefined) {
    const parsed = parseTopicSourcesBody(body.sources);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    sources = parsed;
  } else if (body.keywords !== undefined) {
    // Legacy PATCH: update mirrored keywords by rewriting the primary web source.
    const keywords = body.keywords.trim();
    if (!keywords) {
      return NextResponse.json(
        { error: "Keywords / notes are required so the agent can scan the web." },
        { status: 400 },
      );
    }
    const existingSources = await prisma.topicSource.findMany({
      where: { topicId: body.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (existingSources.length === 0) {
      sources = [{ kind: "web", enabled: true, sortOrder: 0, config: { keywords } }];
    } else {
      sources = existingSources.map((row, index) => {
        const pub = toPublicTopicSource(row);
        if (pub.kind === "web") {
          return {
            kind: "web" as const,
            enabled: pub.enabled,
            sortOrder: pub.sortOrder ?? index,
            config: { keywords },
            connectionId: null,
          };
        }
        return {
          kind: "telegram" as const,
          enabled: pub.enabled,
          sortOrder: pub.sortOrder ?? index,
          config: pub.config as { peers: string[]; lookbackHours: number | null },
          connectionId: pub.connectionId,
        };
      });
      if (!sources.some((source) => source.kind === "web")) {
        sources = [
          { kind: "web", enabled: true, sortOrder: 0, config: { keywords } },
          ...sources.map((source, index) => ({ ...source, sortOrder: index + 1 })),
        ];
      }
    }
  }

  let scheduleId: string | null | undefined;
  if (body.scheduleId !== undefined) {
    if (body.scheduleId === null || body.scheduleId === "") {
      scheduleId = null;
    } else {
      const schedule = await prisma.schedule.findUnique({ where: { id: body.scheduleId } });
      if (!schedule) {
        return NextResponse.json({ error: "Schedule not found." }, { status: 400 });
      }
      scheduleId = schedule.id;
    }
  }

  try {
    const updated = await updateTopicAndSources({
      id: body.id,
      name: body.name?.trim(),
      enabled: body.enabled,
      sortOrder: body.sortOrder,
      scheduleId,
      sources,
    });
    return NextResponse.json({
      topic: {
        id: updated.topic.id,
        name: updated.topic.name,
        keywords: updated.topic.keywords,
        enabled: updated.topic.enabled,
        sortOrder: updated.topic.sortOrder,
        scheduleId: updated.topic.scheduleId,
        sources: updated.sources,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update topic.";
    const status = message === "Topic not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "Topic id is required." }, { status: 400 });
  }

  const existing = await prisma.topic.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  await prisma.topic.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
