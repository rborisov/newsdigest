import Link from "next/link";

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "That email is not on this site’s allowlist (Admin → People). Add the address shown below, or sign in with a listed address.",
  NoEmail:
    "The identity provider did not return an email. On a.rclmx.info, use Google/Yandex and set the app to send that mailbox (not only a Synology username).",
  NotAdmin:
    "You are signed in, but this account is not an admin. Ask an admin to enable Admin for your email under People.",
  Configuration: "Authentication is misconfigured. Contact the site operator.",
  Verification: "The sign-in link is invalid or has expired.",
  Default: "Sign-in failed. Please try again or contact the site operator.",
};

type AuthErrorPageProps = {
  searchParams: Promise<{ error?: string; email?: string }>;
};

export default async function AuthErrorPage({ searchParams }: AuthErrorPageProps) {
  const { error, email } = await searchParams;
  const message =
    (error && ERROR_MESSAGES[error]) ?? ERROR_MESSAGES.Default;
  const shownEmail = email?.trim().toLowerCase();

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Sign-in error</h1>
      <p>{message}</p>
      {shownEmail ? (
        <p>
          Provider returned: <code>{shownEmail}</code>
        </p>
      ) : null}
      {error ? <p style={{ color: "#666" }}>Code: {error}</p> : null}
      <p>
        <Link href="/auth/signin">Try signing in again</Link>
      </p>
    </main>
  );
}
