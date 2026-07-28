import { NextResponse } from "next/server";

import { requireInternalApi } from "@/lib/require-internal";
import { triggerGeneration } from "@/lib/trigger-generation";

export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) {
    return auth.error;
  }

  let scheduleId: string | undefined;
  try {
    const body = (await request.json()) as { scheduleId?: string };
    scheduleId = body.scheduleId?.trim() || undefined;
  } catch {
    scheduleId = undefined;
  }

  const result = await triggerGeneration({
    triggerType: scheduleId ? "scheduled" : "agent",
    triggeredBy: scheduleId ? `schedule:${scheduleId}` : "internal",
    scheduleId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, jobId: result.jobId },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    pid: result.pid,
  });
}
