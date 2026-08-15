import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { startTelegramLink } from "@/lib/telegram-connection";

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const body = (await request.json().catch(() => ({}))) as { phone?: string };
  try {
    const result = await startTelegramLink(body.phone ?? "", auth.session.user?.email ?? "");
    if ("alreadyLinked" in result && result.alreadyLinked) {
      return NextResponse.json({
        connection: result.connection,
        alreadyLinked: true,
      });
    }
    return NextResponse.json({ connection: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start Telegram link.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
