import Link from "next/link";

import { GenerateButton } from "@/app/generate-button";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function HomePage() {
  const [meta, pages, session] = await Promise.all([
    prisma.telegraphMeta.findUnique({ where: { id: "default" } }),
    prisma.publishedPage.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        telegraphUrl: true,
        createdAt: true,
      },
    }),
    auth(),
  ]);

  const isAdmin = session?.user?.isAdmin ?? false;
  const currentIndexUrl = meta?.currentIndexUrl?.trim() ?? "";

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "48rem", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", marginBottom: "2rem" }}>
        <h1>News Digest</h1>
        {isAdmin ? (
          <nav style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <Link href="/admin">Admin</Link>
            <GenerateButton />
          </nav>
        ) : (
          <nav>
            <Link href="/auth/signin">Sign in</Link>
          </nav>
        )}
      </header>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "0.5rem" }}>Current index</h2>
        {currentIndexUrl ? (
          <a href={currentIndexUrl} target="_blank" rel="noopener noreferrer">
            {currentIndexUrl}
          </a>
        ) : (
          <p style={{ color: "#666" }}>No index published yet.</p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "1.125rem", marginBottom: "0.75rem" }}>Recent digests</h2>
        {pages.length === 0 ? (
          <p style={{ color: "#666" }}>No digests yet.</p>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {pages.map((page) => (
              <li key={page.id}>
                <a href={page.telegraphUrl} target="_blank" rel="noopener noreferrer">
                  {page.title}
                </a>
                <span style={{ color: "#666", marginLeft: "0.5rem" }}>
                  {formatDate(page.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
