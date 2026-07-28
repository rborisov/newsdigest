import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { triggerGeneration } from "@/lib/trigger-generation";

export async function POST() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const triggered = await triggerGeneration({
    triggerType: "manual",
    triggeredBy: result.session.user.email ?? "admin",
  });

  if (!triggered.ok) {
    return NextResponse.json(
      {
        error: triggered.error,
        jobId: triggered.jobId,
      },
      { status: triggered.status },
    );
  }

  return NextResponse.json({
    ok: true,
    jobId: triggered.jobId,
    pid: triggered.pid,
    message: "Generation triggered.",
    triggeredBy: result.session.user.email,
  });
}
