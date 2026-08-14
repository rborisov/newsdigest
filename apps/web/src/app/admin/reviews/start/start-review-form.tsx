"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  storyId: string;
  storyTitle: string;
  storyUrl: string | null;
  topicName: string;
  initialPrompt: string;
  reviewStatus: string | null;
  reviewError: string | null;
  reviewUrl: string | null;
};

async function postReview(storyId: string, prompt: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("/api/admin/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storyId, prompt }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    return { ok: false, error: data.error ?? `Request failed (${response.status})` };
  }
  return { ok: true };
}

export function StartReviewForm({
  storyId,
  storyTitle,
  storyUrl,
  topicName,
  initialPrompt,
  reviewStatus,
  reviewError,
  reviewUrl,
}: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    setMessage(undefined);

    const result = await postReview(storyId, prompt);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setMessage("Review agent started. Return to the home board to watch progress.");
    router.refresh();
  }

  const running = reviewStatus === "running" || reviewStatus === "pending";

  return (
    <div className="panel" style={{ maxWidth: "48rem", margin: "2rem auto", padding: "1.5rem" }}>
      <p>
        <Link href="/admin" className="nav-link">
          ← Admin
        </Link>
        {" · "}
        <Link href="/" className="nav-link">
          Home board
        </Link>
      </p>

      <h1 style={{ marginTop: "1rem" }}>Start story review</h1>

      <dl style={{ display: "grid", gridTemplateColumns: "8rem 1fr", gap: "0.35rem 1rem", margin: "1rem 0" }}>
        <dt className="muted">Story id</dt>
        <dd style={{ margin: 0, fontFamily: "monospace" }}>{storyId}</dd>
        <dt className="muted">Headline</dt>
        <dd style={{ margin: 0 }}>{storyTitle}</dd>
        <dt className="muted">Topic</dt>
        <dd style={{ margin: 0 }}>{topicName}</dd>
        <dt className="muted">Source</dt>
        <dd style={{ margin: 0 }}>
          {storyUrl ? (
            <a href={storyUrl} target="_blank" rel="noopener noreferrer">
              {storyUrl}
            </a>
          ) : (
            <span className="muted">(none)</span>
          )}
        </dd>
      </dl>

      {reviewStatus === "published" && reviewUrl ? (
        <p>
          Published review:{" "}
          <a href={reviewUrl} target="_blank" rel="noopener noreferrer">
            {reviewUrl}
          </a>
        </p>
      ) : null}

      {reviewError ? (
        <p style={{ color: "var(--danger, #b00020)" }}>Last error: {reviewError}</p>
      ) : null}

      {running ? (
        <p className="muted">A review is already in progress for this story.</p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>Review prompt</span>
            <textarea
              required
              rows={16}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              style={{ fontFamily: "monospace", width: "100%", padding: "0.5rem" }}
            />
          </label>
          <p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
            Placeholders: {"{{STORY_ID}}"}, {"{{STORY_TITLE}}"}, {"{{STORY_URL}}"}, {"{{TOPIC_NAME}}"},{" "}
            {"{{LANGUAGE}}"}, {"{{DATE}}"}
          </p>
          <button
            type="submit"
            disabled={pending}
            style={{ padding: "0.375rem 0.75rem", font: "inherit", cursor: "pointer", alignSelf: "start" }}
          >
            {pending ? "Starting…" : "Start review"}
          </button>
        </form>
      )}

      {message ? <p style={{ color: "var(--accent)" }}>{message}</p> : null}
      {error ? <p style={{ color: "var(--danger, #b00020)" }}>{error}</p> : null}
    </div>
  );
}
