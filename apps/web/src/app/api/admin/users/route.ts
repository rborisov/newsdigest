import { NextResponse } from "next/server";

import { isLastAdmin, LAST_ADMIN_ERROR } from "@/lib/admin-users";
import { normalizeEmail } from "@/lib/allowed-user";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const users = await prisma.allowedUser.findMany({
    orderBy: [{ isAdmin: "desc" }, { email: "asc" }],
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as { email?: string; isAdmin?: boolean };
  const email = normalizeEmail(body.email ?? "");

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
  }

  const user = await prisma.allowedUser.create({
    data: {
      email,
      isAdmin: body.isAdmin ?? false,
    },
  });

  return NextResponse.json({ user }, { status: 201 });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    id?: string;
    email?: string;
    isAdmin?: boolean;
  };

  if (!body.id) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  const existing = await prisma.allowedUser.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (body.isAdmin === false && existing.isAdmin) {
    if (await isLastAdmin(body.id)) {
      return NextResponse.json({ error: LAST_ADMIN_ERROR }, { status: 409 });
    }
  }

  const data: { email?: string; isAdmin?: boolean } = {};
  if (typeof body.isAdmin === "boolean") {
    data.isAdmin = body.isAdmin;
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email is required." }, { status: 400 });
    }
    data.email = email;
  }

  const user = await prisma.allowedUser.update({
    where: { id: body.id },
    data,
  });

  return NextResponse.json({ user });
}

export async function DELETE(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  const existing = await prisma.allowedUser.findUnique({ where: { id: body.id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (existing.isAdmin && (await isLastAdmin(body.id))) {
    return NextResponse.json({ error: LAST_ADMIN_ERROR }, { status: 409 });
  }

  await prisma.allowedUser.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
