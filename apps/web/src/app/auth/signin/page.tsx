import { signIn } from "@/lib/auth";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl = "/admin" } = await searchParams;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Sign in</h1>
      <p>Admin access requires an allowlisted email.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "20rem" }}>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button type="submit">Continue with Google</button>
        </form>
        <form
          action={async () => {
            "use server";
            await signIn("yandex", { redirectTo: callbackUrl });
          }}
        >
          <button type="submit">Continue with Yandex</button>
        </form>
      </div>
    </main>
  );
}
