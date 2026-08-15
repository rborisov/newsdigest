import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { getTelegramConnectionPublic } from "@/lib/telegram-connection";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) {
    return auth.error;
  }

  const payload = await getTelegramConnectionPublic();
  return NextResponse.json(payload);
}
