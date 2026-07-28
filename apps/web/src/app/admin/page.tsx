import { requireAdmin } from "@/lib/require-admin";

export default async function AdminPage() {
  const session = await requireAdmin();

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Admin</h1>
      <p>Signed in as {session.user.email}</p>
      <p>Admin UI will be implemented in later tasks.</p>
    </main>
  );
}
