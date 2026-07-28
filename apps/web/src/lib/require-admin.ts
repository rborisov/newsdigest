import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";

export async function requireAdmin(): Promise<Session> {
  const session = await auth();

  if (!session?.user?.email) {
    redirect("/auth/signin?callbackUrl=/admin");
  }

  if (!session.user.isAdmin) {
    redirect("/auth/error?error=AccessDenied");
  }

  return session;
}

type RequireAdminApiResult =
  | { session: Session; error?: never }
  | { session?: never; error: NextResponse };

export async function requireAdminApi(): Promise<RequireAdminApiResult> {
  const session = await auth();

  if (!session?.user?.email) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (!session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session };
}
