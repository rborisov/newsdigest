import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { saveTelegramAppCredentials } from "@/lib/telegram-connection";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as {
    apiId?: string | number;
    apiHash?: string;
  };

  try {
    const result = await saveTelegramAppCredentials(String(body.apiId ?? ""), body.apiHash ?? "");
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save Telegram API credentials.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
