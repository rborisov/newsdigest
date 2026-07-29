import Link from "next/link";

import { SignOutButton } from "@/app/sign-out-button";
import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import { siteFooterLinks } from "@/lib/about-page";
import { auth } from "@/lib/auth";
import { digestListTags, formatDigestWhen } from "@/lib/digest-display";
import { prisma } from "@/lib/db";
import { loadRecentDigests } from "@/lib/topic-board";

export const dynamic = "force-dynamic";

export default async function DigestsPage() {
  const [session, { items, indexUrl, displayTimezone }, about] = await Promise.all([
    auth(),
    loadRecentDigests(prisma),
    prisma.aboutPage.findUnique({ where: { id: "default" } }),
  ]);

  const isSignedIn = Boolean(session?.user?.email);
  const isAdmin = session?.user?.isAdmin ?? false;

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
        <h1>Recent digests</h1>
        <p>Latest topic digests published to Telegra.ph, newest first.</p>
      </section>

      <section className="panel digests-page">
        {indexUrl ? (
          <a
            className="index-link index-link-sidebar"
            href={indexUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Telegra.ph index →
          </a>
        ) : null}

        {items.length === 0 ? (
          <p className="muted">No digests yet.</p>
        ) : (
          <ul className="digest-list">
            {items.map((page) => {
              const tags = digestListTags({
                title: page.title,
                storyTitles: page.storyTitles,
              });
              return (
                <li key={page.id}>
                  <a
                    className="digest-item"
                    href={page.telegraphUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="digest-meta">
                      <span className="digest-time">
                        {formatDigestWhen(page.publishedAt, displayTimezone)}
                      </span>
                    </div>
                    <div className="digest-title">{page.topicName}</div>
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

      <SiteFooter links={siteFooterLinks(about)} />
    </main>
  );
}
