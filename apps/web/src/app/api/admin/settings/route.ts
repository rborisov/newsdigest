import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  return NextResponse.json({
    settings: {
      cursorApiKey: {
        storage: "env",
        envVar: "CURSOR_API_KEY",
        configured: Boolean(process.env.CURSOR_API_KEY?.trim()),
        note: "CURSOR_API_KEY is read from the server environment only in v1. Set it in .env and restart the app; it is not stored in the database.",
      },
    },
  });
}
