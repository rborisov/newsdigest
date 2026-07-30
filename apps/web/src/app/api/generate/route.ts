import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { triggerGeneration } from "@/lib/trigger-generation";

export async function POST(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  let topicId: string | null = null;
  const raw = await request.text();
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as { topicId?: string | null };
      if (typeof body.topicId === "string" && body.topicId.trim()) {
        topicId = body.topicId.trim();
      }
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
  }

  const triggered = await triggerGeneration({
    triggerType: "manual",
    triggeredBy: result.session.user.email ?? "admin",
    topicId,
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
    message: topicId ? "Topic generation triggered." : "Generation triggered.",
    triggeredBy: result.session.user.email,
  });
}
