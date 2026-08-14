import { notFound } from "next/navigation";

import { StartReviewForm } from "@/app/admin/reviews/start/start-review-form";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { loadDefaultReviewTemplate } from "@/lib/start-story-review";

type PageProps = {
  searchParams: Promise<{ storyId?: string }>;
};

export default async function StartReviewPage({ searchParams }: PageProps) {
  await requireAdmin();

  const { storyId: rawStoryId } = await searchParams;
  const storyId = rawStoryId?.trim() ?? "";
  if (!storyId) {
    notFound();
  }

  const story = await prisma.storyIndex.findUnique({
    where: { id: storyId },
    include: {
      topicPage: { select: { topicName: true } },
      review: {
        select: {
          status: true,
          error: true,
          telegraphUrl: true,
          promptUsed: true,
        },
      },
    },
  });

  if (!story) {
    notFound();
  }

  const defaultTemplate = await loadDefaultReviewTemplate(prisma);
  const initialPrompt =
    story.review?.promptUsed?.trim() && story.review.status === "failed"
      ? story.review.promptUsed
      : defaultTemplate;

  return (
    <main>
      <StartReviewForm
        storyId={story.id}
        storyTitle={story.title}
        storyUrl={story.canonicalUrl}
        topicName={story.topicPage.topicName}
        initialPrompt={initialPrompt}
        reviewStatus={story.review?.status ?? null}
        reviewError={story.review?.error ?? null}
        reviewUrl={story.review?.telegraphUrl ?? null}
      />
    </main>
  );
}
