import { signOut } from "@/lib/auth";

export function SignOutButton({ className = "nav-link" }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
