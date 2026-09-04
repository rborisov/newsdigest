import Link from "next/link";

import { SiteHeader } from "@/app/site-header";
import { signIn } from "@/lib/auth";
import { listSignInButtons } from "@/lib/auth-settings";

const SIGNIN_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    "This email is already linked to another sign-in method. Try again, or ask an admin if it keeps failing.",
  AccessDenied:
    "That email is not on the allowlist (Admin → People).",
  OAuthCallback: "Sign-in with the identity provider failed. Try again.",
  Default: "Sign-in failed. Try again.",
};

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl = "/", error } = await searchParams;
  const buttons = await listSignInButtons();
  const errorMessage =
    error && (SIGNIN_ERRORS[error] ?? `${SIGNIN_ERRORS.Default} (${error})`);

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
        <p>Use an email that an admin has added under People.</p>
      </section>

      <section className="panel" style={{ maxWidth: "24rem" }}>
        <h2>Continue</h2>
        {errorMessage ? (
          <p style={{ color: "#b00020", marginBottom: "0.75rem" }}>{errorMessage}</p>
        ) : null}
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
