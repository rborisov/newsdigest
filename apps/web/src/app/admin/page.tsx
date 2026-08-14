import { AdminClient } from "@/app/admin/admin-ui";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";
import { DEFAULT_REVIEW_TEMPLATE } from "@/lib/story-review";
import { syncScheduleHumanFieldsFromCron } from "@/lib/sync-schedule-human";

export default async function AdminPage() {
  const session = await requireAdmin();

  await syncScheduleHumanFieldsFromCron();

  const [users, topics, schedules, prompt, telegraph, about, jobs] = await Promise.all([
    prisma.allowedUser.findMany({
      orderBy: [{ isAdmin: "desc" }, { email: "asc" }],
      select: { id: true, email: true, isAdmin: true },
    }),
    prisma.topic.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        keywords: true,
        enabled: true,
        sortOrder: true,
        scheduleId: true,
      },
    }),
    prisma.schedule.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        cronExpr: true,
        timezone: true,
        enabled: true,
        isDefault: true,
        recurrence: true,
        timeOfDay: true,
        weekday: true,
        intervalHours: true,
        periodHours: true,
      },
    }),
    prisma.promptConfig.findUnique({
      where: { id: "default" },
      select: {
        template: true,
        periodHours: true,
        boardStaleDays: true,
        displayTimezone: true,
        language: true,
        reviewTemplate: true,
      },
    }),
    prisma.telegraphMeta.findUnique({
      where: { id: "default" },
      select: {
        accessToken: true,
        authorName: true,
        authorUrl: true,
      },
    }),
    prisma.aboutPage.findUnique({
      where: { id: "default" },
      select: {
        enabledEn: true,
        enabledRu: true,
        footerLabelEn: true,
        footerLabelRu: true,
        pageTitleEn: true,
        pageTitleRu: true,
        leadEn: true,
        leadRu: true,
        productEn: true,
        productRu: true,
        outlookEn: true,
        outlookRu: true,
        collaborationEn: true,
        collaborationRu: true,
      },
    }),
    prisma.generationJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        triggerType: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        publishedPage: {
          select: { title: true, telegraphUrl: true },
        },
        steps: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            kind: true,
            status: true,
            sortOrder: true,
            topicName: true,
            error: true,
            updatedAt: true,
          },
        },
      },
    }),
  ]);

  if (!prompt || !telegraph || !about) {
    throw new Error("Default prompt, telegraph, or about config is missing. Run db:seed.");
  }

  return (
    <AdminClient
      data={{
        signedInEmail: session.user.email ?? "",
        users,
        topics,
        schedules,
        prompt: {
          ...prompt,
          reviewTemplate: prompt.reviewTemplate?.trim() || DEFAULT_REVIEW_TEMPLATE,
        },
        about,
        telegraph: {
          accessTokenConfigured: telegraph.accessToken.trim().length > 0,
          authorName: telegraph.authorName,
          authorUrl: telegraph.authorUrl,
        },
        cursorApiKeyConfigured: Boolean(process.env.CURSOR_API_KEY?.trim()),
        jobs: jobs.map((job) => {
          const now = Date.now();
          const createdMs = job.createdAt.getTime();
          const updatedMs = job.updatedAt.getTime();
          return {
            ...job,
            createdAt: job.createdAt.toISOString(),
            updatedAt: job.updatedAt.toISOString(),
            elapsedSec: Math.max(0, Math.floor((now - createdMs) / 1000)),
            idleSec: Math.max(0, Math.floor((now - updatedMs) / 1000)),
            logTail: "",
            hasLog: false,
            steps: job.steps.map((step) => ({
              ...step,
              updatedAt: step.updatedAt.toISOString(),
              logTail: "",
            })),
            activeStepLog: "",
          };
        }),
      }}
    />
  );
}
