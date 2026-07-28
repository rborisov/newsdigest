import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  return NextResponse.json({
    ok: true,
    admin: result.session.user.email,
  });
}
