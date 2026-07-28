import Link from "next/link";

import { SignOutButton } from "@/app/sign-out-button";
import { SiteHeader } from "@/app/site-header";
import { auth } from "@/lib/auth";
import {
  digestListTags,
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
                <Link href="/admin" className="nav-link">
                  Admin
                </Link>
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
        <h1>News digest</h1>
        <p>
          Scheduled and on-demand digests from your topics — researched by an agent and
          published to Telegra.ph.
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
              const tags = digestListTags({
                title: page.title,
                storyTitles: page.stories.map((story) => story.title),
              });
              const heading = formatDigestHeading(page.title);
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
                    {heading ? <div className="digest-title">{heading}</div> : null}
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
