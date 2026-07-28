import { NextResponse } from "next/server";

import type { StoryFingerprint } from "@/lib/dedup";
import { saveTopicDraft } from "@/lib/generation-pipeline";
import { requireInternalApi } from "@/lib/require-internal";

type SaveDraftBody = {
  jobId?: string;
  topic?: string;
  html?: string;
  htmlContent?: string;
  stories?: StoryFingerprint[];
};

export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json()) as SaveDraftBody;
  const result = await saveTopicDraft({
    jobId: body.jobId ?? "",
    topic: body.topic ?? "",
    html: body.htmlContent ?? body.html ?? "",
    stories: body.stories,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    stepId: result.stepId,
    nextStepId: result.nextStepId,
    nextKind: result.nextKind,
    advanced: result.advanced,
    pid: result.pid,
  });
}
