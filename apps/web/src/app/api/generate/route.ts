import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";

export async function POST() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  return NextResponse.json({
    ok: true,
    message: "Generate stub — not implemented yet",
    triggeredBy: result.session.user.email,
  });
}
