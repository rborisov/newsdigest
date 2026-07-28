import { signOutAction } from "@/app/sign-out-action";

export function SignOutButton({ className = "nav-link" }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
