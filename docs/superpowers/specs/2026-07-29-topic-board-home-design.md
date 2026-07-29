# Topic board home + per-topic publish

Date: 2026-07-29  
Status: approved in chat (pending file review)

## Goal

Redesign digest UX and pipeline so that:

1. The home page shows a **live topic board** in the main area and a **recent digests sidebar**.
2. Each topic is published as its **own Telegra.ph page** (no merge into one digest page).
3. The board updates **as each topic finishes**; topics without a fresh page keep their previous page on the board until a configurable **stale window** expires (default 1 day).
4. The VPS DB stores **search/navigation metadata** (topic names, keywords, story titles/URLs, Telegra.ph links) — not article HTML. Full content lives on Telegra.ph.

Phase 2 (explicitly out of scope): auto-extracted keywords table / search UI.

## Current state (baseline)

- Option C pipeline: `topic_draft` steps → one `merge_publish` → one Telegra.ph digest + `PublishedPage`.
- Home page: single-column “Recent digests” list (last 8 `PublishedPage`s) linking out to Telegra.ph.
- Dedup via `PublishedStory`; shared Telegraph index page chain for archive.

## Approach

**Per-topic publish steps (Approach 1):** one `GenerationJob` with N steps (one per enabled topic). Each step researches and publishes that topic immediately, then the next step starts. No merge step.

---

## Data model

### Keep

- `Topic` — admin config: `name`, `keywords`, `enabled`, `sortOrder`.
- `PromptConfig` — template + `periodHours`; add **`boardStaleDays`** (Int, default `1`, allowed range e.g. 1–14).
- Existing job/step machinery (`GenerationJob`, `GenerationStep`) with kind changes below.
- Telegraph meta + index page chain (archive on Telegra.ph).

### Add

**`TopicPage`** — one row per successful topic publish:

| Field | Purpose |
|-------|---------|
| `id` | cuid |
| `topicId` | FK to `Topic` (nullable for legacy/unmapped) |
| `topicName` | snapshot at publish time |
| `title` | Telegra.ph page title |
| `telegraphPath` / `telegraphUrl` | link out |
| `publishedAt` | board + sidebar ordering |
| `jobId` / `stepId` | optional traceability |
| `triggerType` / `triggeredBy` | same semantics as today |

**`StoryIndex`** — lean search + dedup:

| Field | Purpose |
|-------|---------|
| `id` | cuid |
| `topicPageId` | FK |
| `title` | story headline |
| `canonicalUrl` | unique when present (dedup) |
| `titleKey` | normalized title fallback |
| `firstSeenAt` | timestamp |

### Stop using for new publishes

- Merged multi-topic `PublishedPage` as the primary home entity.
- `GenerationStepKind.merge_publish` and draft-only `save_topic_draft` → merge flow.

Migration: map existing `PublishedPage` / `PublishedStory` into `TopicPage` / `StoryIndex` where possible (see Migration). Implementation may keep old tables read-only until cutover, then drop or leave unused.

### Phase 2 hook (not built now)

- Future `TopicKeyword` (`topicId`, `term`, `source`, counts) can attach without changing publish. V1 search inputs = `Topic.keywords` + `StoryIndex.title`.

---

## Pipeline

1. Trigger (manual / schedule) creates `GenerationJob` if none running.
2. `createPipelineSteps`: one step per enabled topic, kind **`topic_publish`** (replace `topic_draft` + `merge_publish`).
3. For each step, spawn agent with single-topic prompt; footer requires **`publish_digest_page`** (or renamed `publish_topic_page`) for this topic only — forbid multi-topic merge HTML.
4. On successful publish:
   - Create Telegra.ph page.
   - Insert `TopicPage` + `StoryIndex` rows.
   - Link into Telegraph index (prepend).
   - Mark step completed; start next pending step.
5. Soft-fail (empty / all-known stories): complete step **without** new `TopicPage`; board keeps previous page for that topic until stale.
6. Hard fail: mark step/job failed per existing cancel/reconcile rules.

Agent spawn count ≈ number of enabled topics (same order of magnitude as today’s drafts, minus merge).

---

## Home UI

### Layout

- **Main area — topic board:** one card/block per **enabled** topic that has a `TopicPage` with `publishedAt >= now - boardStaleDays`. Show topic name, published time, short tags from `StoryIndex` titles, link to Telegra.ph.
- **Sidebar — recent digests:** same information density as today’s home list (time, tags/chips, external link), sourced from recent `TopicPage`s (e.g. last 20–30), not only board-eligible rows.

### Behavior

- Initial load: board + sidebar from DB.
- As Generate completes topics: new/updated board slot for that topic; new sidebar row.
- Click sidebar (and board CTA): open Telegra.ph URL (v1). No HTML scrape into the portal.
- Topics with no page inside the stale window: omitted from board; may still appear in sidebar history if rows exist.

### Responsive

- Desktop: sidebar + main.
- Narrow viewports: board first; sidebar stacked below or collapsible — implementation detail in plan.

---

## Admin

- **Board stale days** editable next to prompt period (Prompt & topics tab).
- Topics CRUD unchanged.
- Jobs list shows per-topic publish steps (no merge step).

---

## MCP

- Prefer one publish tool used per topic step (`publish_digest_page` with topic-scoped HTML, or rename to `publish_topic_page`).
- Remove or stop documenting `save_topic_draft` + merge instructions from prompts.
- Internal publish API writes `TopicPage` / `StoryIndex` instead of merged `PublishedPage`.

---

## Migration

1. Add new tables + `boardStaleDays`.
2. Backfill: each `PublishedPage` → `TopicPage` with `topicName` inferred from title topic tokens when possible; else `topicId` null / label “Legacy”.
3. `PublishedStory` → `StoryIndex` linked to the new page row.
4. Switch home + publish path to new models.
5. Old tables: leave until verified, then remove in a follow-up commit if unused.

---

## Non-goals (this change)

- Full-text search UI.
- Auto-extracted keyword graph.
- Storing Telegra.ph HTML on the VPS.
- Deleting old `TopicPage` rows (history kept for sidebar + future search).
- Embedding Telegra.ph iframe as primary reader (links out in v1).

---

## Success criteria

- Generate with N topics produces up to N Telegra.ph pages and N `TopicPage` rows (minus soft-fails).
- Home main area shows only in-window latest-per-topic; sidebar lists recent pages with chips/times.
- Changing `boardStaleDays` changes board membership without deleting DB rows.
- No merge step in new jobs; admin jobs UI reflects that.
- Existing Telegraph index continues to accumulate links.

## Open implementation notes (for plan, not blockers)

- Exact Prisma migration from `PublishedPage` → `TopicPage` (rename vs parallel tables).
- Whether step kind enum value is `topic_publish` or reuse `topic_draft` with publish-at-end semantics — prefer new kind for clarity.
- Sidebar page size default (20 vs 30).
