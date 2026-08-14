import { NextResponse } from "next/server";
import { z } from "zod";

import { releaseAgentMutexBestEffort } from "@/lib/agent-mutex";
import { prisma } from "@/lib/db";
import { requireInternalApi } from "@/lib/require-internal";
import { createPage } from "@/lib/telegraph";
import { stripIllustrationsForTelegraph } from "@/lib/topic-illustrations";

const bodySchema = z.object({
  reviewId: z.string().min(1),
  title: z.string().min(1),
  htmlContent: z.string().min(1),
});

async function resolveAccessToken(): Promise<string> {
  const meta = await prisma.telegraphMeta.findUnique({ where: { id: "default" } });
  const token = meta?.accessToken.trim() || process.env.TELEGRAPH_ACCESS_TOKEN?.trim() || "";
  if (!token) {
    throw new Error("Telegra.ph access token is not configured");
  }
  return token;
}

export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) return auth.error;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { reviewId, title, htmlContent } = parsed.data;

  const review = await prisma.storyReview.findUnique({
    where: { id: reviewId },
    include: {
      story: {
        include: {
          topicPage: { select: { topicName: true } },
        },
      },
    },
  });

  if (!review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (review.status === "published" && review.telegraphUrl) {
    return NextResponse.json({
      ok: true,
      idempotent: true,
      reviewUrl: review.telegraphUrl,
      reviewPath: review.telegraphPath,
    });
  }

  if (review.status !== "running" && review.status !== "pending") {
    return NextResponse.json(
      { error: `Review is not runnable (status=${review.status}).` },
      { status: 409 },
    );
  }

  try {
    const meta = await prisma.telegraphMeta.findUnique({ where: { id: "default" } });
    const accessToken = await resolveAccessToken();
    const telegraphHtml = stripIllustrationsForTelegraph(htmlContent);

    let page: Awaited<ReturnType<typeof createPage>>;
    if (review.telegraphPath) {
      const { editPage } = await import("@/lib/telegraph");
      page = await editPage({
        accessToken,
        path: review.telegraphPath,
        title,
        content: telegraphHtml,
        authorName: meta?.authorName ?? "",
        authorUrl: meta?.authorUrl ?? "",
      });
    } else {
      page = await createPage({
        accessToken,
        title,
        content: telegraphHtml,
        authorName: meta?.authorName ?? "",
        authorUrl: meta?.authorUrl ?? "",
      });
    }

    const updated = await prisma.storyReview.update({
      where: { id: reviewId },
      data: {
        status: "published",
        title,
        telegraphPath: page.path,
        telegraphUrl: page.url,
        publishedAt: new Date(),
        error: null,
      },
    });

    releaseAgentMutexBestEffort();

    return NextResponse.json({
      ok: true,
      reviewId: updated.id,
      storyIndexId: updated.storyIndexId,
      reviewUrl: page.url,
      reviewPath: page.path,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed";
    await prisma.storyReview.update({
      where: { id: reviewId },
      data: { status: "failed", error: message },
    });
    releaseAgentMutexBestEffort();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
