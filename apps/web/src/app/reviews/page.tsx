import Link from "next/link";

import { SignOutButton } from "@/app/sign-out-button";
import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import { siteFooterLinks } from "@/lib/about-page";
import { auth } from "@/lib/auth";
import { formatDigestWhen } from "@/lib/digest-display";
import { prisma } from "@/lib/db";
import { ensureReviewIndex, loadRecentReviews } from "@/lib/review-index";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  await ensureReviewIndex(prisma);

  const [session, { items, reviewIndexUrl, displayTimezone }, about] = await Promise.all([
    auth(),
    loadRecentReviews(prisma),
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
        <h1>Recent reviews</h1>
        <p>Latest story reviews published to Telegra.ph, newest first.</p>
      </section>

      <section className="panel digests-page">
        {reviewIndexUrl ? (
          <a
            className="index-link index-link-sidebar"
            href={reviewIndexUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Telegra.ph index →
          </a>
        ) : null}

        {items.length === 0 ? (
          <p className="muted">No reviews yet.</p>
        ) : (
          <ul className="digest-list">
            {items.map((review) => (
              <li key={review.id}>
                <a
                  className="digest-item"
                  href={review.telegraphUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="digest-meta">
                    <span className="digest-time">
                      {formatDigestWhen(review.publishedAt, displayTimezone)}
                    </span>
                  </div>
                  <div className="digest-title">{review.storyTitle}</div>
                  <div className="tag-row">
                    <span className="tag">{review.topicName}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SiteFooter links={siteFooterLinks(about)} />
    </main>
  );
}
