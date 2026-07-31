import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/require-admin";
import { collectSystemMetrics } from "@/lib/system-metrics";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  try {
    const metrics = await collectSystemMetrics();
    return NextResponse.json(metrics);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load system metrics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
