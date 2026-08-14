import { NextResponse } from "next/server";
import { z } from "zod";

import { releaseAgentMutexBestEffort } from "@/lib/agent-mutex";
import { prisma } from "@/lib/db";
import { appendJobLogLine } from "@/lib/job-logs";
import { requireInternalApi } from "@/lib/require-internal";

const bodySchema = z.object({
  reviewId: z.string().min(1),
  exitCode: z.number().int().optional(),
});

export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) return auth.error;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { reviewId, exitCode } = parsed.data;

  const review = await prisma.storyReview.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, telegraphUrl: true },
  });

  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (review.status === "published" || review.status === "failed") {
    releaseAgentMutexBestEffort();
    return NextResponse.json({ ok: true, ignored: true, status: review.status });
  }

  if (review.telegraphUrl) {
    await prisma.storyReview.update({
      where: { id: reviewId },
      data: { status: "published", error: null },
    });
    releaseAgentMutexBestEffort();
    appendJobLogLine(reviewId, "agent-exited recovered: telegraphUrl already set");
    return NextResponse.json({ ok: true, recovered: true });
  }

  const failed = exitCode !== 0 && exitCode !== null && exitCode !== undefined;
  await prisma.storyReview.update({
    where: { id: reviewId },
    data: {
      status: "failed",
      error: failed
        ? `Agent exited with code ${exitCode} without publishing a review.`
        : "Agent exited without publishing a review.",
    },
  });
  releaseAgentMutexBestEffort();
  appendJobLogLine(reviewId, `agent-exited marked failed (code=${exitCode ?? "?"})`);

  return NextResponse.json({ ok: true, failed: true });
}
