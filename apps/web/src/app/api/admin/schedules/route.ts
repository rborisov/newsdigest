import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const schedules = await prisma.schedule.findMany({
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ schedules });
}

export async function POST(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    name?: string;
    cronExpr?: string;
    timezone?: string;
    enabled?: boolean;
  };

  const name = body.name?.trim() ?? "";
  const cronExpr = body.cronExpr?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!cronExpr) {
    return NextResponse.json({ error: "Cron expression is required." }, { status: 400 });
  }

  const schedule = await prisma.schedule.create({
    data: {
      name,
      cronExpr,
      timezone: body.timezone?.trim() || "UTC",
      enabled: body.enabled ?? true,
    },
  });

  return NextResponse.json({ schedule }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    id?: string;
    name?: string;
    cronExpr?: string;
    timezone?: string;
    enabled?: boolean;
  };

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
  } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    data.name = name;
  }
  if (body.cronExpr !== undefined) {
    const cronExpr = body.cronExpr.trim();
    if (!cronExpr) {
      return NextResponse.json({ error: "Cron expression is required." }, { status: 400 });
    }
    data.cronExpr = cronExpr;
  }
  if (body.timezone !== undefined) {
    data.timezone = body.timezone.trim() || "UTC";
  }
  if (typeof body.enabled === "boolean") {
    data.enabled = body.enabled;
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
