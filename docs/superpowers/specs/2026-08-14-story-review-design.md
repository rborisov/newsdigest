# Story AI review (Telegra.ph)

Date: 2026-08-14  
Status: draft — pending user approval

## Goal

Admins can run an on-demand **AI review** of a single digest story (identified by its `StoryIndex` id, shown in board HTML as ` · c…`). Reviews publish to **Telegra.ph**. After publish, **all readers** see a link on that story pointing to the review.

## Context

- Story ids are stamped into digest HTML at publish time (`story-ids.ts` → ` · {cuid}` suffix on each `<p>`).
- `StoryIndex.id` is the canonical article id.
- Topic digests already publish via Cursor agent + MCP + Telegra.ph API (`telegraph.ts`).
- Host-wide Cursor agent mutex applies (one agent at a time).

## User flows

### Admin — start review

1. On the **home board**, admin sees each story paragraph with its id suffix.
2. Next to the id, admin-only control: **Review** (or **Continue review** if a draft prompt exists).
3. Opens review start UI with:
   - Story title, source URL, topic name, story id (read-only)
   - **Prompt** textarea pre-filled from `PromptConfig.reviewTemplate`
   - Admin can edit prompt before starting
   - **Start review** button
4. System creates/updates `StoryReview` (status `running`), spawns Cursor agent with the snapshot prompt.
5. While running: id suffix area shows **Review in progress…** (admin) + link to job log in Admin.

### Agent — run review

1. Prompt includes story metadata + instruction to research the source and write a structured review in `{{LANGUAGE}}`.
2. Agent calls MCP **`publish_story_review`** with HTML body + title.
3. Portal publishes to Telegra.ph (text-only nodes, same sanitizer path as digests).
4. `StoryReview` → `published`, stores `telegraphUrl`, `publishedAt`.

### Reader — read review

1. On home board, story paragraph shows **Review →** link (Telegra.ph) when `StoryReview.status === published`.
2. No sign-in required.
3. No “start review” affordance for non-admins.

### Admin — re-review

- Starting again on the same story creates a new run (or resets existing row): new prompt snapshot, new Telegra.ph page, link updates to latest published review.

## Data model

### `PromptConfig` (extend)

| Field | Purpose |
|-------|---------|
| `reviewTemplate` | Default review prompt. Placeholders: `{{STORY_ID}}`, `{{STORY_TITLE}}`, `{{STORY_URL}}`, `{{TOPIC_NAME}}`, `{{LANGUAGE}}`, `{{DATE}}` |

### `StoryReview` (new)

| Field | Purpose |
|-------|---------|
| `id` | cuid |
| `storyIndexId` | FK → `StoryIndex.id` (unique — one active review record per story) |
| `status` | `pending` \| `running` \| `published` \| `failed` |
| `promptUsed` | Snapshot of prompt for this run |
| `title` | Telegra.ph page title |
| `telegraphPath` / `telegraphUrl` | Published review link |
| `createdBy` | Admin email |
| `error` | Failure message |
| `pid` | Agent pid (optional) |
| `publishedAt` | When Telegra.ph publish succeeded |
| `createdAt` / `updatedAt` | Audit |

Optional later: `reviewJobId` if we unify with `GenerationJob`; v1 uses standalone `StoryReview` + existing `spawnAgent(reviewId)`.

## API / routes

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /admin/reviews/start?storyId=` | Admin | Start UI (prompt editor) |
| `POST /api/admin/reviews` | Admin | `{ storyId, prompt }` → create run + spawn agent |
| `GET /api/admin/reviews/[storyId]` | Admin | Status + log tail |
| `POST /api/internal/reviews/publish` | Internal key | MCP publish endpoint |
| `POST /api/internal/reviews/agent-exited` | Internal key | Mark failed/complete if agent exits without publish |

Admin prompt PATCH: extend `PATCH /api/admin/prompt` with `reviewTemplate`.

## MCP

New tool on existing mcp-server:

- **`publish_story_review`** — `{ reviewId, title, html }` → internal publish API → Telegra.ph URL

## Board rendering

New server helper `enrichBoardHtmlWithReviewLinks(html, reviewsByStoryId, { isAdmin })`:

- Parse story id from each `<p>… · c{id}</p>` (existing suffix pattern).
- If `published` → append `<a class="story-review-link">Review →</a>` before `</p>` (or after id suffix).
- If `isAdmin` && no published && not running → inject admin link to `/admin/reviews/start?storyId=`.
- If `isAdmin` && running → “In progress…”

Sanitizer allowlist: add `story-review-link` class if needed (links only).

## Agent prompt (sketch)

```
MODE: story_review
reviewId: …
storyId: …
title: …
sourceUrl: …
topic: …

{{ADMIN_PROMPT_SNAPSHOT}}

Write a review article. Publish via publish_story_review MCP only.
Do not finish until publish returns a Telegra.ph URL.
```

## Admin UI

1. **Prompt & period** tab: new textarea **Review prompt template** + placeholders help.
2. **Reviews** sub-section or entries in System/Jobs: list recent review runs (optional v1: only per-story start page + logs under review id).

## Out of scope (v1)

- Public portal-hosted review pages (user chose Telegra.ph only).
- Reviewing stories without a `StoryIndex` row (legacy HTML only).
- Multiple published reviews per story (history UI); latest replaces link.
- Auto-review on publish.

## Risks

- **Mutex**: review blocks digest generation and vice versa — acceptable (same as today).
- **Stale board HTML**: review links injected at render time from DB, not baked into `TopicPage.htmlContent` — no republish needed.
- **Stories without id suffix**: old pages before id stamping won't get links until republished.

## Implementation order

1. Schema + seed default `reviewTemplate`
2. Internal publish API + MCP tool
3. Admin prompt field + start review page/API + agent spawn
4. Board HTML enrichment (admin + public links)
5. Admin “Review” link beside story id on home board
6. Tests for id parsing + enrichment

## Open questions

- None blocking — Telegra.ph host and admin link beside story id confirmed.
