import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";
import { syncTopicIngest } from "@/lib/sync-topic-ingest";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id: topicId } = await context.params;
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, name: true },
  });
  if (!topic) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  const [items, sources] = await Promise.all([
    prisma.ingestItem.findMany({
      where: { topicId },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        kind: true,
        externalId: true,
        url: true,
        title: true,
        text: true,
        publishedAt: true,
        quality: true,
        topicSourceId: true,
        createdAt: true,
      },
    }),
    prisma.topicSource.findMany({
      where: { topicId, kind: "telegram" },
      select: {
        id: true,
        enabled: true,
        lastSyncAt: true,
        lastError: true,
        configJson: true,
      },
    }),
  ]);

  const counts = {
    total: items.length,
    kept: items.filter((item) => item.quality === "kept").length,
    ads: items.filter((item) => item.quality === "ads").length,
    fluff: items.filter((item) => item.quality === "fluff").length,
    question: items.filter((item) => item.quality === "question").length,
    other: items.filter((item) => item.quality === "other").length,
  };

  return NextResponse.json({
    topic,
    counts,
    sources: sources.map((source) => ({
      id: source.id,
      enabled: source.enabled,
      lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
      lastError: source.lastError,
    })),
    items: items.map((item) => ({
      ...item,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id: topicId } = await context.params;
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true, name: true },
  });
  if (!topic) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  try {
    const sync = await syncTopicIngest(topicId);
    const kept = await prisma.ingestItem.count({
      where: { topicId, quality: "kept" },
    });
    return NextResponse.json({ topic, sync, kept });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ingest sync failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
