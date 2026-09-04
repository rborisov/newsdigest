import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import {
  getAllowedUserByEmail,
  isEmailAllowed,
  normalizeEmail,
} from "@/lib/allowed-user";
import authConfig from "@/lib/auth.config";
import { loadAuthProviders } from "@/lib/auth-settings";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const providers = await loadAuthProviders();
  return {
    adapter: PrismaAdapter(prisma),
    session: { strategy: "jwt" },
    secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
    ...authConfig,
    providers,
    callbacks: {
      async signIn({ user, profile }) {
        const email =
          (typeof user.email === "string" && user.email) ||
          (profile && typeof profile.email === "string" ? profile.email : undefined);
        if (!email) {
          return false;
        }

        return isEmailAllowed(email);
      },
      async jwt({ token, user, profile }) {
        const email =
          user?.email ??
          (profile && typeof profile.email === "string" ? profile.email : undefined) ??
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
  };
});

async function getIsAdminFromAllowlist(email: string): Promise<boolean> {
  const allowedUser = await getAllowedUserByEmail(email);
  return allowedUser?.isAdmin ?? false;
}
