import { NextResponse } from "next/server";

import {
  listPublicAuthProviderRows,
  migrateAuthProviderRows,
  replaceAuthProviders,
  type AuthProviderInput,
} from "@/lib/auth-settings";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  await migrateAuthProviderRows();
  const providers = await listPublicAuthProviderRows();
  return NextResponse.json({
    providers,
    note: "Add any OpenID Connect issuers here. When any is enabled and configured, they override OIDC_/GOOGLE_ env bootstrap.",
  });
}

export async function PUT(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    providers?: AuthProviderInput[];
  };

  if (!Array.isArray(body.providers)) {
    return NextResponse.json({ error: "providers array is required." }, { status: 400 });
  }

  try {
    const providers = await replaceAuthProviders(body.providers);
    return NextResponse.json({ providers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** @deprecated Prefer PUT with full list. Kept for older Admin clients. */
export async function PATCH(request: Request) {
  return PUT(request);
}
