import { prisma } from "@/lib/db";
import {
  compileCronExpr,
  humanFieldsMatchCron,
  inferHumanFromCron,
  type ScheduleRecurrence,
} from "@/lib/schedule-human";

function asRecurrence(value: string | undefined | null): ScheduleRecurrence | null {
  if (value === "daily" || value === "weekly" || value === "interval_hours") {
    return value;
  }
  return null;
}

/** Legacy interval form rejected by node-cron v4 (`9/5` without a range). */
function isLegacySlashHourCron(cronExpr: string): boolean {
  return /^\d{1,2} \d{1,2}\/\d{1,2} \* \* (\*|\d)$/.test(cronExpr.trim());
}

/** Upgrade legacy cron-only rows so Admin shows the real schedule, not schema defaults. */
export async function syncScheduleHumanFieldsFromCron(): Promise<void> {
  const schedules = await prisma.schedule.findMany();
  for (const schedule of schedules) {
    const current = {
      recurrence: asRecurrence(schedule.recurrence) ?? ("daily" as const),
      timeOfDay: schedule.timeOfDay,
      weekday: schedule.weekday,
      intervalHours: schedule.intervalHours,
    };

    // Rewrite slash-step hour crons to an explicit hour list node-cron accepts.
    if (isLegacySlashHourCron(schedule.cronExpr)) {
      const inferred = inferHumanFromCron(schedule.cronExpr);
      const source = inferred ?? current;
      const compiled = compileCronExpr(source);
      if (compiled.ok) {
        await prisma.schedule.update({
          where: { id: schedule.id },
          data: {
            cronExpr: compiled.cronExpr,
            recurrence: source.recurrence,
            timeOfDay: source.timeOfDay,
            weekday: source.weekday ?? null,
            intervalHours: source.intervalHours ?? null,
          },
        });
        continue;
      }
    }

    if (humanFieldsMatchCron(schedule.cronExpr, current)) {
      continue;
    }
    const inferred = inferHumanFromCron(schedule.cronExpr);
    if (!inferred) {
      continue;
    }
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        recurrence: inferred.recurrence,
        timeOfDay: inferred.timeOfDay,
        weekday: inferred.weekday ?? null,
        intervalHours: inferred.intervalHours ?? null,
      },
    });
  }

  const hasDefault = await prisma.schedule.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!hasDefault) {
    const first = await prisma.schedule.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (first) {
      await prisma.schedule.update({
        where: { id: first.id },
        data: { isDefault: true },
      });
    }
  }
}
