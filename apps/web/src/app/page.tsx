import Link from "next/link";

import { SignOutButton } from "@/app/sign-out-button";
import { SiteFooter } from "@/app/site-footer";
import { SiteHeader } from "@/app/site-header";
import { aboutFooterLinks } from "@/lib/about-page";
import { auth } from "@/lib/auth";
import { digestListTags, formatDigestWhen } from "@/lib/digest-display";
import { prisma } from "@/lib/db";
import { layoutBoardStoryBlocks } from "@/lib/topic-illustrations";
import { sanitizeDigestHtml, stripLeadingTopicHeading } from "@/lib/sanitize-digest-html";
import { loadTopicBoard } from "@/lib/topic-board";

export default async function HomePage() {
  const [session, { board, sidebar, indexUrl, displayTimezone }, about] = await Promise.all([
    auth(),
    loadTopicBoard(prisma),
    prisma.aboutPage.findUnique({ where: { id: "default" } }),
  ]);

  const isSignedIn = Boolean(session?.user?.email);
  const isAdmin = session?.user?.isAdmin ?? false;

  return (
    <main className="shell shell-home">
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
          <h2>Recent digests</h2>
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
          {sidebar.length === 0 ? (
            <p className="muted">No digests yet.</p>
          ) : (
            <ul className="digest-list">
              {sidebar.map((page) => {
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
                        <span className="digest-time">{formatDigestWhen(page.publishedAt, displayTimezone)}</span>
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
        </aside>

        <section className="home-board panel">
          <h2>Current topics</h2>
          {board.length === 0 ? (
            <p className="muted">No topics on the board yet.</p>
          ) : (
            <div className="board-list">
              {board.map((card) => {
                const body = stripLeadingTopicHeading(
                  sanitizeDigestHtml(
                    layoutBoardStoryBlocks(card.htmlContent),
                    card.topicId,
                  ),
                  card.topicName,
                );
                return (
                  <article key={card.topicId} className="board-card">
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

      <SiteFooter links={about ? aboutFooterLinks(about) : []} />
    </main>
  );
}
