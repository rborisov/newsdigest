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

function emailFromAuthPayload(
  user: { email?: string | null },
  profile?: unknown,
): string | undefined {
  if (typeof user.email === "string" && user.email.trim()) {
    return user.email.trim();
  }
  if (profile && typeof profile === "object" && profile !== null) {
    const email = (profile as { email?: unknown }).email;
    if (typeof email === "string" && email.trim()) {
      return email.trim();
    }
  }
  return undefined;
}

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
        const raw = emailFromAuthPayload(user, profile);
        if (!raw) {
          return "/auth/error?error=NoEmail";
        }
        const email = normalizeEmail(raw);
        if (!(await isEmailAllowed(email))) {
          return `/auth/error?error=AccessDenied&email=${encodeURIComponent(email)}`;
        }
        return true;
      },
      async jwt({ token, user, profile }) {
        const email =
          emailFromAuthPayload(user ?? {}, profile) ??
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
