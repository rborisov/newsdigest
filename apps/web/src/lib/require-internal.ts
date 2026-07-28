import { NextResponse } from "next/server";

type RequireInternalApiResult =
  | { error?: never }
  | { error: NextResponse };

export function requireInternalApi(request: Request): RequireInternalApiResult {
  const configuredKey = process.env.INTERNAL_API_KEY?.trim();
  const providedKey = request.headers.get("x-internal-key")?.trim();

  if (!configuredKey) {
    return {
      error: NextResponse.json({ error: "Internal API key is not configured." }, { status: 503 }),
    };
  }

  if (!providedKey || providedKey !== configuredKey) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {};
}
