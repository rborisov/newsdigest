import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";
import {
  compileCronExpr,
  type ScheduleRecurrence,
  validateHumanSchedule,
} from "@/lib/schedule-human";
import { syncScheduleHumanFieldsFromCron } from "@/lib/sync-schedule-human";

type ScheduleBody = {
  id?: string;
  name?: string;
  timezone?: string;
  enabled?: boolean;
  isDefault?: boolean;
  recurrence?: string;
  timeOfDay?: string;
  weekday?: number | null;
  intervalHours?: number | null;
};

function asRecurrence(value: string | undefined): ScheduleRecurrence | null {
  if (value === "daily" || value === "weekly" || value === "interval_hours") {
    return value;
  }
  return null;
}

async function clearOtherDefaults(exceptId?: string) {
  await prisma.schedule.updateMany({
    where: exceptId ? { id: { not: exceptId }, isDefault: true } : { isDefault: true },
    data: { isDefault: false },
  });
}

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  await syncScheduleHumanFieldsFromCron();

  const schedules = await prisma.schedule.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({ schedules });
}

export async function POST(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as ScheduleBody;
  const name = body.name?.trim() ?? "";
  const recurrence = asRecurrence(body.recurrence);
  const timeOfDay = body.timeOfDay?.trim() ?? "09:00";
  const timezone = body.timezone?.trim() || "UTC";

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!recurrence) {
    return NextResponse.json(
      { error: "Recurrence must be daily, weekly, or interval_hours." },
      { status: 400 },
    );
  }

  const human = {
    recurrence,
    timeOfDay,
    timezone,
    weekday: body.weekday ?? null,
    intervalHours: body.intervalHours ?? null,
  };
  const valid = validateHumanSchedule(human);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }
  const compiled = compileCronExpr(human);
  if (!compiled.ok) {
    return NextResponse.json({ error: compiled.error }, { status: 400 });
  }

  const isDefault =
    Boolean(body.isDefault) ||
    !(await prisma.schedule.findFirst({ where: { isDefault: true }, select: { id: true } }));
  if (isDefault) {
    await clearOtherDefaults();
  }

  const schedule = await prisma.schedule.create({
    data: {
      name,
      cronExpr: compiled.cronExpr,
      timezone,
      enabled: body.enabled ?? true,
      isDefault,
      recurrence,
      timeOfDay,
      weekday: recurrence === "weekly" ? (body.weekday ?? null) : null,
      intervalHours: recurrence === "interval_hours" ? (body.intervalHours ?? null) : null,
    },
  });

  return NextResponse.json({ schedule }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as ScheduleBody;
  if (!body.id) {
    return NextResponse.json({ error: "Schedule id is required." }, { status: 400 });
  }

  const existing = await prisma.schedule.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  const data: {
    name?: string;
    cronExpr?: string;
    timezone?: string;
    enabled?: boolean;
    isDefault?: boolean;
    recurrence?: string;
    timeOfDay?: string;
    weekday?: number | null;
    intervalHours?: number | null;
  } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    data.name = name;
  }

  if (typeof body.enabled === "boolean") {
    data.enabled = body.enabled;
  }

  if (typeof body.isDefault === "boolean") {
    data.isDefault = body.isDefault;
    if (body.isDefault) {
      await clearOtherDefaults(body.id);
    }
  }

  const recurrence = asRecurrence(body.recurrence) ?? (existing.recurrence as ScheduleRecurrence);
  const timeOfDay = body.timeOfDay?.trim() ?? existing.timeOfDay;
  const timezone = body.timezone !== undefined ? body.timezone.trim() || "UTC" : existing.timezone;
  const weekday =
    body.weekday !== undefined ? body.weekday : existing.weekday;
  const intervalHours =
    body.intervalHours !== undefined ? body.intervalHours : existing.intervalHours;

  const scheduleFieldsTouched =
    body.recurrence !== undefined ||
    body.timeOfDay !== undefined ||
    body.timezone !== undefined ||
    body.weekday !== undefined ||
    body.intervalHours !== undefined;

  if (scheduleFieldsTouched) {
    const human = {
      recurrence: asRecurrence(recurrence) ?? "daily",
      timeOfDay,
      timezone,
      weekday,
      intervalHours,
    };
    const valid = validateHumanSchedule(human);
    if (!valid.ok) {
      return NextResponse.json({ error: valid.error }, { status: 400 });
    }
    const compiled = compileCronExpr(human);
    if (!compiled.ok) {
      return NextResponse.json({ error: compiled.error }, { status: 400 });
    }
    data.recurrence = human.recurrence;
    data.timeOfDay = timeOfDay;
    data.timezone = timezone;
    data.weekday = human.recurrence === "weekly" ? weekday : null;
    data.intervalHours = human.recurrence === "interval_hours" ? intervalHours : null;
    data.cronExpr = compiled.cronExpr;
  }

  const schedule = await prisma.schedule.update({
    where: { id: body.id },
    data,
  });

  return NextResponse.json({ schedule });
}

export async function DELETE(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "Schedule id is required." }, { status: 400 });
  }

  const existing = await prisma.schedule.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "Schedule not found." }, { status: 404 });
  }

  await prisma.schedule.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
