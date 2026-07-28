import type { AllowedUser } from "@prisma/client";

import { prisma } from "@/lib/db";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getAllowedUserByEmail(
  email: string,
  client: Pick<typeof prisma, "allowedUser"> = prisma,
): Promise<AllowedUser | null> {
  return client.allowedUser.findUnique({
    where: { email: normalizeEmail(email) },
  });
}

export async function isEmailAllowed(
  email: string,
  client: Pick<typeof prisma, "allowedUser"> = prisma,
): Promise<boolean> {
  const allowedUser = await getAllowedUserByEmail(email, client);
  return allowedUser !== null;
}

export async function getIsAdmin(
  email: string,
  client: Pick<typeof prisma, "allowedUser"> = prisma,
): Promise<boolean> {
  const allowedUser = await getAllowedUserByEmail(email, client);
  return allowedUser?.isAdmin ?? false;
}
