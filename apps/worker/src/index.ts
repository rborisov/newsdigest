import { PrismaClient } from "@prisma/client";
import cron, { type ScheduledTask } from "node-cron";

type ManagedJob = {
  cronExpr: string;
  timezone: string;
  task: ScheduledTask;
};

type ScheduleRow = {
  id: string;
  cronExpr: string;
  timezone: string;
};

const RELOAD_INTERVAL_MS = 60_000;
const DB_RETRY_MS = 5_000;
const DB_RETRY_MAX = 24;

const prisma = new PrismaClient();
const jobs = new Map<string, ManagedJob>();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function portalBaseUrl(): string {
  return requireEnv("PORTAL_URL").replace(/\/$/, "");
}

async function triggerSchedule(scheduleId: string): Promise<void> {
  const response = await fetch(`${portalBaseUrl()}/api/internal/trigger`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": requireEnv("INTERNAL_API_KEY"),
    },
    body: JSON.stringify({ scheduleId }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(
      `[scheduler] trigger failed scheduleId=${scheduleId} status=${response.status} body=${body}`,
    );
    return;
  }

  const payload = (await response.json()) as { jobId?: string };
  console.log(
    `[scheduler] triggered scheduleId=${scheduleId} jobId=${payload.jobId ?? "unknown"}`,
  );
}

function startJob(schedule: ScheduleRow): void {
  if (!cron.validate(schedule.cronExpr)) {
    console.error(
      `[scheduler] invalid cron scheduleId=${schedule.id} cronExpr=${schedule.cronExpr}`,
    );
    return;
  }

  const task = cron.schedule(
    schedule.cronExpr,
    () => {
      void triggerSchedule(schedule.id);
    },
    { timezone: schedule.timezone },
  );

  jobs.set(schedule.id, {
    cronExpr: schedule.cronExpr,
    timezone: schedule.timezone,
    task,
  });
}

function stopJob(scheduleId: string): void {
  const managed = jobs.get(scheduleId);
  if (!managed) {
    return;
  }

  managed.task.stop();
  jobs.delete(scheduleId);
}

function needsRecreate(existing: ManagedJob, schedule: ScheduleRow): boolean {
  return (
    existing.cronExpr !== schedule.cronExpr ||
    existing.timezone !== schedule.timezone
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDatabaseNotReadyError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "P2021" || code === "P1001") {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("no such table") ||
    message.includes("SQLITE_ERROR") ||
    message.includes("Unable to open the database file")
  );
}

async function reloadSchedules(): Promise<void> {
  const schedules = await prisma.schedule.findMany({
    where: { enabled: true },
    select: { id: true, cronExpr: true, timezone: true },
  });

  const activeIds = new Set(schedules.map((schedule) => schedule.id));

  for (const scheduleId of jobs.keys()) {
    if (!activeIds.has(scheduleId)) {
      stopJob(scheduleId);
      console.log(`[scheduler] stopped removed/disabled scheduleId=${scheduleId}`);
    }
  }

  for (const schedule of schedules) {
    const existing = jobs.get(schedule.id);
    if (existing) {
      if (!needsRecreate(existing, schedule)) {
        continue;
      }

      stopJob(schedule.id);
      console.log(
        `[scheduler] recreating scheduleId=${schedule.id} cronExpr=${schedule.cronExpr} timezone=${schedule.timezone}`,
      );
    } else {
      console.log(
        `[scheduler] starting scheduleId=${schedule.id} cronExpr=${schedule.cronExpr} timezone=${schedule.timezone}`,
      );
    }

    startJob(schedule);
  }
}

async function reloadSchedulesWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= DB_RETRY_MAX; attempt++) {
    try {
      await reloadSchedules();
      return;
    } catch (error) {
      if (!isDatabaseNotReadyError(error) || attempt === DB_RETRY_MAX) {
        throw error;
      }

      console.warn(
        `[scheduler] database not ready (attempt ${attempt}/${DB_RETRY_MAX}), retrying in ${DB_RETRY_MS}ms...`,
      );
      await sleep(DB_RETRY_MS);
    }
  }
}

async function main(): Promise<void> {
  requireEnv("DATABASE_URL");
  requireEnv("PORTAL_URL");
  requireEnv("INTERNAL_API_KEY");

  console.log("[scheduler] worker starting");

  await reloadSchedulesWithRetry();

  setInterval(() => {
    void reloadSchedules().catch((error) => {
      if (isDatabaseNotReadyError(error)) {
        console.warn("[scheduler] database not ready during reload, will retry on next interval");
        return;
      }
      console.error("[scheduler] reload failed:", error);
    });
  }, RELOAD_INTERVAL_MS);
}

main().catch((error) => {
  console.error("[scheduler] fatal error:", error);
  process.exit(1);
});
