import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { refreshFaqFromIngest } from "@/lib/faq-space-db";
import { requireAdminApi } from "@/lib/require-admin";

type RouteContext = { params: Promise<{ id: string }> };

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
    const result = await refreshFaqFromIngest(topicId);
    return NextResponse.json({ topic, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "FAQ refresh failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
