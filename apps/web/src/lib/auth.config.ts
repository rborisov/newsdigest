import type { NextAuthConfig } from "next-auth";

/** Static Auth.js options (providers loaded dynamically from Admin / env). */
export default {
  providers: [],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  trustHost: true,
} satisfies NextAuthConfig;
