import Link from "next/link";

import { SignOutButton } from "@/app/sign-out-button";
import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import { siteFooterLinks } from "@/lib/about-page";
import { auth } from "@/lib/auth";
import { digestListTags, formatDigestWhen } from "@/lib/digest-display";
import { prisma } from "@/lib/db";
import { layoutBoardStoryBlocks } from "@/lib/topic-illustrations";
import { sanitizeDigestHtml, stripLeadingTopicHeading } from "@/lib/sanitize-digest-html";
import { loadTopicBoard } from "@/lib/topic-board";

export default async function HomePage() {
  const [session, { board, nav, indexUrl, displayTimezone }, about] = await Promise.all([
    auth(),
    loadTopicBoard(prisma),
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
        <h1>News digest</h1>
        <p>
          Scheduled and on-demand digests from your topics — researched by an agent and
          published to Telegra.ph.
        </p>
      </section>

      <div className="home-layout">
        <aside className="home-sidebar panel">
          <h2 className="home-sidebar-title">Topics</h2>
          {indexUrl ? (
            <a
              className="index-link index-link-sidebar"
              href={indexUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Telegra.ph index →
            </a>
          ) : null}
          {nav.length === 0 ? (
            <p className="muted">No cached topics yet.</p>
          ) : (
            <ul className="topic-nav">
              {nav.map((item) => {
                const tags = digestListTags({
                  title: item.title,
                  storyTitles: item.storyTitles,
                });
                return (
                  <li key={item.topicId}>
                    <a className="topic-nav-item" href={`#topic-${item.topicId}`}>
                      <span className="digest-time">
                        {formatDigestWhen(item.publishedAt, displayTimezone)}
                      </span>
                      <span className="topic-nav-name">{item.topicName}</span>
                      {tags.length > 0 ? (
                        <span className="tag-row">
                          {tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="tag">
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="home-board panel">
          <h2>Current topics</h2>
          {board.length === 0 ? (
            <p className="muted">No topics on the board yet.</p>
          ) : (
            <div className="board-list">
              {board.map((card) => {
                const body = sanitizeDigestHtml(
                  layoutBoardStoryBlocks(
                    stripLeadingTopicHeading(card.htmlContent, card.topicName),
                  ),
                  card.topicId,
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
                    <a
                      className="board-link"
                      href={card.telegraphUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open on Telegra.ph →
                    </a>
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

      <SiteFooter links={siteFooterLinks(about)} />
    </main>
  );
}
