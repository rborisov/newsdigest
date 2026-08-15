"use client";

import { useCallback, useEffect, useState } from "react";

import { digestListTags, formatDigestWhen } from "@/lib/digest-display";
import type { SidebarItem } from "@/lib/topic-board";

type Props = {
  nav: SidebarItem[];
  indexUrl: string;
  displayTimezone: string;
};

export function HomeTopicsNav({ nav, indexUrl, displayTimezone }: Props) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className="topics-menu-trigger"
        aria-expanded={open}
        aria-controls="home-topics-menu"
        onClick={() => setOpen(true)}
      >
        Topics
        {nav.length > 0 ? <span className="topics-menu-count">{nav.length}</span> : null}
      </button>

      <div
        className={`topics-menu-backdrop${open ? " is-visible" : ""}`}
        aria-hidden={!open}
        onClick={close}
      />

      <aside
        id="home-topics-menu"
        className={`home-sidebar${open ? " is-open" : ""}`}
        aria-label="Cached topics"
        aria-hidden={isMobile && !open}
      >
        <div className="home-sidebar-inner">
          <section className="panel home-board home-sidebar-board">
            <div className="topics-menu-head">
              <h2>Topics</h2>
              <button
                type="button"
                className="topics-menu-close"
                aria-label="Close topics menu"
                onClick={close}
              >
                ×
              </button>
            </div>
            {indexUrl ? (
              <a
                className="index-link index-link-sidebar"
                href={indexUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                Telegra.ph index →
              </a>
            ) : null}
            {nav.length === 0 ? (
              <p className="muted">No cached topics yet.</p>
            ) : (
              <>
                <ul className="board-list topic-nav">
                  {nav.map((item) => {
                    const tags = digestListTags({
                      title: item.title,
                      storyTitles: item.storyTitles,
                    });
                    return (
                      <li key={item.topicId}>
                        <a
                          className="board-card topic-nav-item"
                          href={`#topic-${item.topicId}`}
                          onClick={close}
                        >
                          <div className="board-card-header">
                            <span className="board-topic topic-nav-name">{item.topicName}</span>
                            <time
                              className="digest-time"
                              dateTime={item.publishedAt.toISOString()}
                            >
                              {formatDigestWhen(item.publishedAt, displayTimezone)}
                            </time>
                          </div>
                          {tags.length > 0 ? (
                            <div className="tag-row">
                              {tags.slice(0, 3).map((tag) => (
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
                <p className="muted topic-nav-footnote">Newest topics · full list below</p>
              </>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
