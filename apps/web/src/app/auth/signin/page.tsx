import Link from "next/link";

import { SiteHeader } from "@/app/site-header";
import { signIn } from "@/lib/auth";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl = "/admin" } = await searchParams;

  return (
    <main className="shell">
      <SiteHeader
        actions={
          <Link href="/" className="nav-link">
            Home
          </Link>
        }
      />

      <section className="hero">
        <h1>Sign in</h1>
        <p>Admin access requires an allowlisted email.</p>
      </section>

      <section className="panel" style={{ maxWidth: "24rem" }}>
        <h2>Continue</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl });
            }}
          >
            <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
              Continue with Google
            </button>
          </form>
          <form
            action={async () => {
              "use server";
              await signIn("yandex", { redirectTo: callbackUrl });
            }}
          >
            <button type="submit" className="btn" style={{ width: "100%" }}>
              Continue with Yandex
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
