import Link from "next/link";

import { SignOutButton } from "@/app/sign-out-button";
import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import { siteFooterLinks } from "@/lib/about-page";
import { auth } from "@/lib/auth";
import { formatDigestWhen } from "@/lib/digest-display";
import { prisma } from "@/lib/db";
import { layoutBoardStoryBlocks } from "@/lib/topic-illustrations";
import { sanitizeDigestHtml, stripLeadingTopicHeading } from "@/lib/sanitize-digest-html";
import { HomeTopicsNav } from "@/app/home-topics-nav";
import { loadTopicBoard } from "@/lib/topic-board";
import { loadStoryReviewsForHtml } from "@/lib/load-story-reviews";
import { enrichBoardHtmlWithReviewLinks } from "@/lib/story-review";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [session, { board, nav, indexUrl, displayTimezone }, about] = await Promise.all([
    auth(),
    loadTopicBoard(prisma),
    prisma.aboutPage.findUnique({ where: { id: "default" } }),
  ]);

  const isSignedIn = Boolean(session?.user?.email);
  const isAdmin = session?.user?.isAdmin ?? false;

  const rawHtmlChunks = board.map((card) =>
    layoutBoardStoryBlocks(stripLeadingTopicHeading(card.htmlContent, card.topicName)),
  );
  const reviewsByStoryId = await loadStoryReviewsForHtml(prisma, rawHtmlChunks);

  return (
    <main className="home-page">
      <header className="home-page-header">
        <div className="shell shell-wide">
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

          <section className="hero hero-compact">
            <h1>News digest</h1>
            <p>
              Scheduled and on-demand digests from your topics — researched by an agent and
              published to Telegra.ph.
            </p>
          </section>
        </div>
      </header>

      <HomeTopicsNav nav={nav} indexUrl={indexUrl} displayTimezone={displayTimezone} />

      <div className="home-main">
        <section className="home-board panel">
          <h2>Current topics</h2>
          {board.length === 0 ? (
            <p className="muted">No topics on the board yet.</p>
          ) : (
            <div className="board-list">
              {board.map((card, index) => {
                const rawHtml = rawHtmlChunks[index] ?? "";
                const body = enrichBoardHtmlWithReviewLinks(
                  sanitizeDigestHtml(rawHtml, card.topicId),
                  reviewsByStoryId,
                  { isAdmin },
                );
                return (
                  <article key={card.topicId} id={`topic-${card.topicId}`} className="board-card">
                    <div className="board-card-header">
                      <h3 className="board-topic">{card.topicName}</h3>
                      <time className="digest-time" dateTime={card.publishedAt.toISOString()}>
                        {formatDigestWhen(card.publishedAt, displayTimezone)}
                      </time>
                    </div>
                    {body ? (
                      <div
                        className="board-body"
                        dangerouslySetInnerHTML={{ __html: body }}
                      />
                    ) : (
                      <p className="muted">
                        Body not stored for this page yet — open on Telegra.ph.
                      </p>
                    )}
                    <div className="board-card-links">
                      <a
                        className="board-link"
                        href={card.telegraphUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open on Telegra.ph →
                      </a>
                      {card.faqSlug ? (
                        <Link className="board-link" href={`/faq/${card.faqSlug}`}>
                          FAQ →
                        </Link>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!indexUrl ? (
            <p className="muted board-index-fallback">No index published yet.</p>
          ) : null}
        </section>
      </div>

      <footer className="home-page-footer">
        <div className="shell shell-wide">
          <SiteFooter links={siteFooterLinks(about)} />
        </div>
      </footer>
    </main>
  );
}
