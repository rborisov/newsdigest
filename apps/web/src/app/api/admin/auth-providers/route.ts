import { NextResponse } from "next/server";

import {
  ensureAuthProviderRows,
  listPublicAuthProviderRows,
  patchAuthProvider,
  type AuthProviderPatch,
} from "@/lib/auth-settings";
import { requireAdminApi } from "@/lib/require-admin";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  await ensureAuthProviderRows();
  const providers = await listPublicAuthProviderRows();
  return NextResponse.json({
    providers,
    note: "When any provider is enabled and configured in Admin, it overrides OIDC_/GOOGLE_/YANDEX_ env bootstrap.",
  });
}

export async function PATCH(request: Request) {
  const result = await requireAdminApi();
  if (result.error) {
    return result.error;
  }

  const body = (await request.json()) as {
    providers?: AuthProviderPatch[];
  };

  if (!Array.isArray(body.providers) || body.providers.length === 0) {
    return NextResponse.json({ error: "providers array is required." }, { status: 400 });
  }

  try {
    const updated = [];
    for (const patch of body.providers) {
      if (!patch?.id) {
        return NextResponse.json({ error: "Each provider needs an id." }, { status: 400 });
      }
      updated.push(await patchAuthProvider(patch));
    }
    return NextResponse.json({ providers: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
