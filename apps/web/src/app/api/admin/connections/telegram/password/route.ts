import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { submitTelegramPassword } from "@/lib/telegram-connection";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as { password?: string };
  try {
    const connection = await submitTelegramPassword(body.password ?? "");
    return NextResponse.json({ connection });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to submit Telegram password.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
