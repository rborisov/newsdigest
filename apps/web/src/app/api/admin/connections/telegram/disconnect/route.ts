import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { disconnectTelegram } from "@/lib/telegram-connection";

export async function POST() {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  try {
    const connection = await disconnectTelegram();
    return NextResponse.json({ connection });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to disconnect Telegram.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
