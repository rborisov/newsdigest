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
  };

  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const topic = await prisma.topic.create({
    data: {
      name,
      keywords: body.keywords?.trim() ?? "",
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
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
