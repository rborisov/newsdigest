import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const jobs = await prisma.generationJob.findMany({
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
        select: {
          title: true,
          telegraphUrl: true,
        },
      },
    },
  });

  return NextResponse.json({ jobs });
}
