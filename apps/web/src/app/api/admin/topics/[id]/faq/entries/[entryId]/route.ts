import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { deleteFaqEntry } from "@/lib/faq-space-db";
import { requireAdminApi } from "@/lib/require-admin";

type RouteContext = { params: Promise<{ id: string; entryId: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id: topicId, entryId } = await context.params;
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true },
  });
  if (!topic) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  try {
    await deleteFaqEntry(topicId, entryId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete FAQ entry.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
