import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { submitTelegramCode } from "@/lib/telegram-connection";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  try {
    const connection = await submitTelegramCode(body.code ?? "");
    return NextResponse.json({ connection });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit Telegram code.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
