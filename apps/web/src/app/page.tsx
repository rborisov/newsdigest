import Link from "next/link";

import { GenerateButton } from "@/app/generate-button";
import { SignOutButton } from "@/app/sign-out-button";
import { SiteHeader } from "@/app/site-header";
import { auth } from "@/lib/auth";
import {
  digestContentTags,
  formatDigestHeading,
  formatDigestWhen,
} from "@/lib/digest-display";
import { prisma } from "@/lib/db";

export default async function HomePage() {
  const [meta, pages, session] = await Promise.all([
    prisma.telegraphMeta.findUnique({ where: { id: "default" } }),
    prisma.publishedPage.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        telegraphUrl: true,
        createdAt: true,
        stories: {
          take: 6,
          orderBy: { firstSeenAt: "asc" },
          select: { title: true },
        },
      },
    }),
    auth(),
  ]);

  const isSignedIn = Boolean(session?.user?.email);
  const isAdmin = session?.user?.isAdmin ?? false;
  const currentIndexUrl = meta?.currentIndexUrl?.trim() ?? "";

  return (
    <main className="shell">
      <SiteHeader
        actions={
          isSignedIn ? (
            <>
              {isAdmin ? (
                <>
                  <Link href="/admin" className="nav-link">
                    Admin
                  </Link>
                  <GenerateButton />
                </>
              ) : null}
              <SignOutButton />
            </>
          ) : (
            <Link href="/auth/signin" className="nav-link">
              Sign in
            </Link>
          )
        }
      />

      <section className="hero">
        <h1>Signal, distilled.</h1>
        <p>
          Short digests on mobile networking, embedded, and Android — researched
          automatically, published to Telegra.ph.
        </p>
      </section>

      <section className="panel">
        <h2>Current index</h2>
        {currentIndexUrl ? (
          <a
            className="index-link"
            href={currentIndexUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Telegra.ph index →
          </a>
        ) : (
          <p className="muted">No index published yet.</p>
        )}
      </section>

      <section className="panel" style={{ animationDelay: "0.08s" }}>
        <h2>Recent digests</h2>
        {pages.length === 0 ? (
          <p className="muted">No digests yet.</p>
        ) : (
          <ul className="digest-list">
            {pages.map((page) => {
              const tags = digestContentTags(page.stories.map((story) => story.title));
              return (
                <li key={page.id}>
                  <a
                    className="digest-item"
                    href={page.telegraphUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="digest-meta">
                      <span className="digest-time">{formatDigestWhen(page.createdAt)}</span>
                    </div>
                    <div className="digest-title">
                      {formatDigestHeading(page.title, page.createdAt)}
                    </div>
                    {tags.length > 0 ? (
                      <div className="tag-row">
                        {tags.map((tag) => (
                          <span key={tag} className="tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
