import { AdminClient } from "@/app/admin/admin-ui";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";

export default async function AdminPage() {
  const session = await requireAdmin();

  const [users, topics, schedules, prompt, telegraph, jobs] = await Promise.all([
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
      },
    }),
    prisma.schedule.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        cronExpr: true,
        timezone: true,
        enabled: true,
      },
    }),
    prisma.promptConfig.findUnique({
      where: { id: "default" },
      select: { template: true, periodHours: true },
    }),
    prisma.telegraphMeta.findUnique({
      where: { id: "default" },
      select: {
        accessToken: true,
        authorName: true,
        authorUrl: true,
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

  if (!prompt || !telegraph) {
    throw new Error("Default prompt or telegraph config is missing. Run db:seed.");
  }

  return (
    <AdminClient
      data={{
        signedInEmail: session.user.email ?? "",
        users,
        topics,
        schedules,
        prompt,
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
