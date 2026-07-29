import { NextResponse } from "next/server";

import { readIllustrationFile } from "@/lib/topic-illustrations";

type RouteParams = {
  params: Promise<{ topicId: string; filename: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { topicId, filename } = await params;
  const file = await readIllustrationFile(topicId, filename);
  if (!file) {
    return NextResponse.json({ error: "Illustration not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
