import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

const TELEGRAPH_ID = "default";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const telegraph = await prisma.telegraphMeta.findUnique({ where: { id: TELEGRAPH_ID } });
  if (!telegraph) {
    return NextResponse.json({ error: "Telegraph config not found." }, { status: 404 });
  }

  return NextResponse.json({
    telegraph: {
      id: telegraph.id,
      accessTokenConfigured: telegraph.accessToken.trim().length > 0,
      authorName: telegraph.authorName,
      authorUrl: telegraph.authorUrl,
      currentIndexPath: telegraph.currentIndexPath,
      currentIndexUrl: telegraph.currentIndexUrl,
      updatedAt: telegraph.updatedAt,
    },
  });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    accessToken?: string;
    authorName?: string;
    authorUrl?: string;
  };

  const existing = await prisma.telegraphMeta.findUnique({ where: { id: TELEGRAPH_ID } });
  if (!existing) {
    return NextResponse.json({ error: "Telegraph config not found." }, { status: 404 });
  }

  const data: {
    accessToken?: string;
    authorName?: string;
    authorUrl?: string;
  } = {};

  if (body.accessToken !== undefined) {
    data.accessToken = body.accessToken.trim();
  }
  if (body.authorName !== undefined) {
    data.authorName = body.authorName.trim();
  }
  if (body.authorUrl !== undefined) {
    data.authorUrl = body.authorUrl.trim();
  }

  const telegraph = await prisma.telegraphMeta.update({
    where: { id: TELEGRAPH_ID },
    data,
  });

  return NextResponse.json({
    telegraph: {
      id: telegraph.id,
      accessTokenConfigured: telegraph.accessToken.trim().length > 0,
      authorName: telegraph.authorName,
      authorUrl: telegraph.authorUrl,
      currentIndexPath: telegraph.currentIndexPath,
      currentIndexUrl: telegraph.currentIndexUrl,
      updatedAt: telegraph.updatedAt,
    },
  });
}
