import { GenerationJobStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { failJobWithError } from "@/lib/generation-pipeline";
import { requireAdminApi } from "@/lib/require-admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Admin: mark a stuck pending/running job as failed so Generate unlocks. */
export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const { id } = await context.params;
  const jobId = id?.trim() ?? "";
  if (!jobId) {
    return NextResponse.json({ error: "job id is required." }, { status: 400 });
  }

  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (
    job.status !== GenerationJobStatus.pending &&
    job.status !== GenerationJobStatus.running
  ) {
    return NextResponse.json(
      { error: `Job is already ${job.status}.`, jobId, status: job.status },
      { status: 409 },
    );
  }

  await failJobWithError(jobId, "Cancelled by admin.");

  return NextResponse.json({ ok: true, jobId, status: "failed" });
}
