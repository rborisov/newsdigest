import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { cancelTelegramLink } from "@/lib/telegram-connection";

export async function POST() {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  try {
    const connection = await cancelTelegramLink();
    return NextResponse.json({ connection });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to cancel Telegram link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
