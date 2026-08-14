import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";
import { startStoryReview } from "@/lib/start-story-review";

const bodySchema = z.object({
  storyId: z.string().min(1),
  prompt: z.string().min(1),
});

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await startStoryReview(prisma, {
    storyIndexId: parsed.data.storyId,
    prompt: parsed.data.prompt,
    createdBy: auth.session.user.email ?? "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }

  return NextResponse.json({
    ok: true,
    reviewId: result.reviewId,
    pid: result.pid,
  });
}
