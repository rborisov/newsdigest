import { NextResponse } from "next/server";

import { requireInternalApi } from "@/lib/require-internal";

export async function POST(request: Request) {
  const auth = requireInternalApi(request);
  if (auth.error) {
    return auth.error;
  }

  return NextResponse.json(
    {
      error:
        "save_topic_draft is no longer supported. Each topic publish step calls publish_digest_page directly.",
    },
    { status: 410 },
  );
}
