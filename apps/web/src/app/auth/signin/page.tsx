import Link from "next/link";

import { SiteHeader } from "@/app/site-header";
import { signIn } from "@/lib/auth";
import { listSignInButtons } from "@/lib/auth-settings";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl = "/" } = await searchParams;
  const buttons = await listSignInButtons();

  async function startSignIn(formData: FormData) {
    "use server";
    const provider = String(formData.get("provider") ?? "").trim();
    const next = String(formData.get("callbackUrl") ?? "/").trim() || "/";
    if (!provider) {
      return;
    }
    await signIn(provider, { redirectTo: next });
  }

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
        <p>
          Sign in with an email listed under Admin → People. If you use company login (
          <code>a.rclmx.info</code>), the email in the token must match that list — not a Synology
          username.
        </p>
      </section>

      <section className="panel" style={{ maxWidth: "24rem" }}>
        <h2>Continue</h2>
        {buttons.length === 0 ? (
          <p className="muted">
            Sign-in is not configured. An admin must enable providers under{" "}
            <strong>Admin → Sign-in</strong> (or set bootstrap{" "}
            <code>OIDC_*</code> / Google / Yandex env for first login).
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {buttons.map((button, index) => (
              <form key={button.id} action={startSignIn}>
                <input type="hidden" name="provider" value={button.id} />
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <button
                  type="submit"
                  className={index === 0 ? "btn btn-primary" : "btn"}
                  style={{ width: "100%" }}
                >
                  Continue with {button.name}
                </button>
              </form>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
