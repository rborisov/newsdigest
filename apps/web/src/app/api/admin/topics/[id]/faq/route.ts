import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import {
  ensureFaqSpaceForTopic,
  listActiveFaqEntries,
  updateFaqSpace,
} from "@/lib/faq-space-db";
import { requireAdminApi } from "@/lib/require-admin";

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

  const faq = await ensureFaqSpaceForTopic(topicId);
  const entries = await listActiveFaqEntries(faq.id);

  return NextResponse.json({
    topic,
    faq: {
      ...faq,
      publicPath: `/faq/${faq.slug}`,
    },
    entries,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id: topicId } = await context.params;
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true },
  });
  if (!topic) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    enabled?: boolean;
    name?: string;
    promptTemplate?: string;
    keywords?: string;
  };

  try {
    const faq = await updateFaqSpace(topicId, body);
    return NextResponse.json({
      faq: {
        ...faq,
        publicPath: `/faq/${faq.slug}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update FAQ.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
