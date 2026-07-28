import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import {
  getAllowedUserByEmail,
  isEmailAllowed,
  normalizeEmail,
} from "@/lib/allowed-user";
import authConfig from "@/lib/auth.config";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  ...authConfig,
  callbacks: {
    async signIn({ user }) {
      if (!user.email) {
        return false;
      }

      return isEmailAllowed(user.email);
    },
    async jwt({ token, user }) {
      const email =
        user?.email ??
        (typeof token.email === "string" ? token.email : undefined);

      if (email) {
        const normalizedEmail = normalizeEmail(email);
        token.email = normalizedEmail;
        token.isAdmin = await getIsAdminFromAllowlist(normalizedEmail);
      }

      return token;
    },
    async session({ session, token }) {
      if (!session.user) {
        return session;
      }

      if (token.sub) {
        session.user.id = token.sub;
      }

      const email =
        typeof token.email === "string"
          ? token.email
          : session.user.email ?? undefined;

      if (email) {
        const normalizedEmail = normalizeEmail(email);
        session.user.email = normalizedEmail;
        session.user.isAdmin = await getIsAdminFromAllowlist(normalizedEmail);
      } else {
        session.user.isAdmin = false;
      }

      return session;
    },
  },
});

async function getIsAdminFromAllowlist(email: string): Promise<boolean> {
  const allowedUser = await getAllowedUserByEmail(email);
  return allowedUser?.isAdmin ?? false;
}
