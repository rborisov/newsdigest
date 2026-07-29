import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const topics = await prisma.topic.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ topics });
}

export async function POST(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    name?: string;
    keywords?: string;
    enabled?: boolean;
    sortOrder?: number;
    scheduleId?: string | null;
  };

  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  let scheduleId: string | null = null;
  if (body.scheduleId !== undefined && body.scheduleId !== null && body.scheduleId !== "") {
    const schedule = await prisma.schedule.findUnique({ where: { id: body.scheduleId } });
    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found." }, { status: 400 });
    }
    scheduleId = schedule.id;
  }

  const topic = await prisma.topic.create({
    data: {
      name,
      keywords: body.keywords?.trim() ?? "",
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
      scheduleId,
    },
  });

  return NextResponse.json({ topic }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    id?: string;
    name?: string;
    keywords?: string;
    enabled?: boolean;
    sortOrder?: number;
    scheduleId?: string | null;
  };

  if (!body.id) {
    return NextResponse.json({ error: "Topic id is required." }, { status: 400 });
  }

  const existing = await prisma.topic.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  const data: {
    name?: string;
    keywords?: string;
    enabled?: boolean;
    sortOrder?: number;
    scheduleId?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    data.name = name;
  }
  if (body.keywords !== undefined) {
    data.keywords = body.keywords.trim();
  }
  if (typeof body.enabled === "boolean") {
    data.enabled = body.enabled;
  }
  if (typeof body.sortOrder === "number") {
    data.sortOrder = body.sortOrder;
  }
  if (body.scheduleId !== undefined) {
    if (body.scheduleId === null || body.scheduleId === "") {
      data.scheduleId = null;
    } else {
      const schedule = await prisma.schedule.findUnique({ where: { id: body.scheduleId } });
      if (!schedule) {
        return NextResponse.json({ error: "Schedule not found." }, { status: 400 });
      }
      data.scheduleId = schedule.id;
    }
  }

  const topic = await prisma.topic.update({
    where: { id: body.id },
    data,
  });

  return NextResponse.json({ topic });
}

export async function DELETE(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "Topic id is required." }, { status: 400 });
  }

  const existing = await prisma.topic.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  await prisma.topic.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
