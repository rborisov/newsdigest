import { prisma } from "@/lib/db";

type AdminUserClient = Pick<typeof prisma, "allowedUser">;

export async function countAdmins(
  client: AdminUserClient = prisma,
): Promise<number> {
  return client.allowedUser.count({ where: { isAdmin: true } });
}

export async function isLastAdmin(
  userId: string,
  client: AdminUserClient = prisma,
): Promise<boolean> {
  const user = await client.allowedUser.findUnique({ where: { id: userId } });
  if (!user?.isAdmin) {
    return false;
  }

  const adminCount = await countAdmins(client);
  return adminCount <= 1;
}

export const LAST_ADMIN_ERROR =
  "Cannot remove or demote the last admin.";
