# Topic board home + per-topic publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-topic Telegra.ph pages with a home topic board + recent-digests sidebar, storing only search/nav metadata in SQLite.

**Architecture:** Replace Option C (`topic_draft` → `merge_publish`) with N `topic_publish` steps. Each successful publish writes `TopicPage` + `StoryIndex` and updates the Telegraph index. Home main area shows latest-in-window page per enabled topic (`boardStaleDays`); sidebar lists recent `TopicPage`s. Article HTML stays on Telegra.ph only.

**Tech Stack:** Next.js (apps/web), Prisma/SQLite, existing Telegraph + MCP + Cursor agent spawn, node:test for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-29-topic-board-home-design.md`

## Global Constraints

- Do not store Telegra.ph HTML bodies in the VPS DB.
- One Telegra.ph page per topic publish (no merge page).
- Keep `TopicPage` / `StoryIndex` history (no GC); board filters by stale window only.
- Phase 2 keyword extraction table is out of scope.
- V1 board/sidebar link out to Telegra.ph (no iframe reader).
- Prefer small focused libs; follow existing admin UI style (inline styles in `admin-ui.tsx`, CSS classes on home).
- Frequent commits after each task.

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/prisma/schema.prisma` | `TopicPage`, `StoryIndex`, `boardStaleDays`, `topic_publish` kind |
| `apps/web/src/lib/topic-board.ts` | Board + sidebar queries |
| `apps/web/src/lib/topic-board.test.ts` | Stale-window selection tests |
| `apps/web/src/lib/telegraph.ts` | Publish → `TopicPage`/`StoryIndex` (keep index update) |
| `apps/web/src/lib/generation-pipeline.ts` | Steps = topic_publish only; startStep builds publish prompt |
| `apps/web/src/lib/prompt.ts` | Topic publish prompt (no save_topic_draft / merge) |
| `apps/web/src/lib/dedup.ts` | Dedup reads `StoryIndex` (fallback `PublishedStory` during transition) |
| `apps/web/src/app/page.tsx` | Split layout: sidebar + board |
| `apps/web/src/app/globals.css` | Board/sidebar layout |
| `apps/web/src/app/admin/admin-ui.tsx` + prompt API | `boardStaleDays` field |
| `apps/mcp-server/src/index.ts` | Drop or noop `save_topic_draft`; publish remains |
| `apps/web/prisma/seed.ts` | Default `boardStaleDays: 1` |
| `apps/web/scripts/backfill-topic-pages.ts` (or one-shot in seed/migrate note) | Legacy `PublishedPage` → `TopicPage` |

---

### Task 1: Schema — TopicPage, StoryIndex, boardStaleDays, topic_publish

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Modify: `apps/web/prisma/seed.ts`
- Test: `npx prisma validate` + `db:push` locally

**Interfaces:**
- Produces: Prisma models `TopicPage`, `StoryIndex`; `PromptConfig.boardStaleDays`; enum value `GenerationStepKind.topic_publish`
- Consumes: existing `Topic`, `GenerationJob`, `TelegraphIndexPage`, `TriggerType`

- [ ] **Step 1: Extend schema**

Add to `PromptConfig`:
```prisma
boardStaleDays Int @default(1)
```

Add enum value (keep old values temporarily so existing rows don't break SQLite enums awkwardly — Prisma SQLite stores enums as strings):
```prisma
enum GenerationStepKind {
  topic_draft
  merge_publish
  topic_publish
}
```

Add models (note: **`jobId` is NOT unique** — many topic pages per job):
```prisma
model TopicPage {
  id            String      @id @default(cuid())
  topicId       String?
  topicName     String
  title         String
  telegraphPath String
  telegraphUrl  String
  indexPageId   String?
  triggerType   TriggerType
  triggeredBy   String
  jobId         String?
  stepId        String?     @unique
  publishedAt   DateTime    @default(now())

  topic     Topic?              @relation(fields: [topicId], references: [id], onDelete: SetNull)
  indexPage TelegraphIndexPage? @relation(fields: [indexPageId], references: [id], onDelete: SetNull)
  job       GenerationJob?      @relation(fields: [jobId], references: [id], onDelete: SetNull)
  stories   StoryIndex[]

  @@index([topicId, publishedAt])
  @@index([publishedAt])
}

model StoryIndex {
  id           String   @id @default(cuid())
  topicPageId  String
  canonicalUrl String?  @unique
  title        String
  titleKey     String?
  firstSeenAt  DateTime @default(now())

  topicPage TopicPage @relation(fields: [topicPageId], references: [id], onDelete: Cascade)

  @@index([titleKey])
  @@index([firstSeenAt])
}
```

Wire relations on `Topic`, `GenerationJob`, `TelegraphIndexPage` (`topicPages TopicPage[]`). Keep `PublishedPage` / `PublishedStory` models for backfill/read fallback until Task 8.

- [ ] **Step 2: Update seed**

In `seed.ts` upsert `PromptConfig` with `boardStaleDays: 1` (alongside existing `periodHours`).

- [ ] **Step 3: Push schema**

Run: `cd apps/web && npx prisma db push && npx prisma generate`  
Expected: success

- [ ] **Step 4: Commit**

```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/seed.ts
git commit -m "Add TopicPage, StoryIndex, and boardStaleDays schema."
```

---

### Task 2: Board query helper + tests

**Files:**
- Create: `apps/web/src/lib/topic-board.ts`
- Create: `apps/web/src/lib/topic-board.test.ts`

**Interfaces:**
- Consumes: `TopicPage`, `StoryIndex`, `PromptConfig.boardStaleDays`, enabled `Topic`s
- Produces:
  - `getBoardStaleDays(prisma): Promise<number>`
  - `selectBoardPages(pages, topics, staleDays, now): BoardCard[]` (pure, for tests)
  - `loadTopicBoard(prisma, now?): Promise<{ board: BoardCard[]; sidebar: SidebarItem[]; indexUrl: string }>`

```ts
export type BoardCard = {
  topicId: string;
  topicName: string;
  pageId: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  storyTitles: string[];
};

export type SidebarItem = {
  id: string;
  topicName: string;
  title: string;
  telegraphUrl: string;
  publishedAt: Date;
  storyTitles: string[];
};
```

**Board rule:** For each enabled topic (order by `sortOrder`, `name`), take newest `TopicPage` with matching `topicId` (or exact `topicName` if `topicId` null) where `publishedAt >= now - boardStaleDays`. Skip topic if none.

**Sidebar:** last 24 `TopicPage`s by `publishedAt` desc, include stories (take 6 titles).

- [ ] **Step 1: Write failing tests** in `topic-board.test.ts` using `node:test` + `assert`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectBoardPages } from "./topic-board";

describe("selectBoardPages", () => {
  const topics = [
    { id: "t1", name: "AI", sortOrder: 0 },
    { id: "t2", name: "Ops", sortOrder: 1 },
  ];
  const now = new Date("2026-07-29T12:00:00Z");

  it("keeps latest in-window page per topic", () => {
    const board = selectBoardPages(
      [
        { id: "p1", topicId: "t1", topicName: "AI", title: "A1", telegraphUrl: "u1", publishedAt: new Date("2026-07-29T10:00:00Z"), storyTitles: ["s"] },
        { id: "p0", topicId: "t1", topicName: "AI", title: "A0", telegraphUrl: "u0", publishedAt: new Date("2026-07-28T10:00:00Z"), storyTitles: [] },
        { id: "p2", topicId: "t2", topicName: "Ops", title: "O", telegraphUrl: "u2", publishedAt: new Date("2026-07-29T09:00:00Z"), storyTitles: [] },
      ],
      topics,
      1,
      now,
    );
    assert.equal(board.length, 2);
    assert.equal(board[0]?.pageId, "p1");
    assert.equal(board[1]?.pageId, "p2");
  });

  it("drops topics whose latest page is outside stale window", () => {
    const board = selectBoardPages(
      [{ id: "p0", topicId: "t1", topicName: "AI", title: "Old", telegraphUrl: "u", publishedAt: new Date("2026-07-27T12:00:00Z"), storyTitles: [] }],
      topics,
      1,
      now,
    );
    assert.equal(board.length, 0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd apps/web && npm test -- --test-name-pattern=selectBoardPages`  
(or `node --import tsx --test src/lib/topic-board.test.ts`)

- [ ] **Step 3: Implement `topic-board.ts`** (pure `selectBoardPages` + DB loaders)

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/topic-board.ts apps/web/src/lib/topic-board.test.ts
git commit -m "Add topic board selection helper and tests."
```

---

### Task 3: Publish path writes TopicPage + StoryIndex

**Files:**
- Modify: `apps/web/src/lib/telegraph.ts` (`publishDigest` / types)
- Modify: `apps/web/src/app/api/internal/publish/route.ts` (pass `topicId` / `topicName` / `stepId`)
- Modify: `apps/web/src/lib/dedup.ts` to query `StoryIndex` (union with `PublishedStory` until backfill done)
- Modify: MCP tool schema if needed for optional `topic` field (already may exist)

**Interfaces:**
- Change `PublishDigestInput` to include:
  ```ts
  topicId?: string | null;
  topicName: string;
  stepId?: string | null;
  ```
- `publishDigest` creates `TopicPage` + `StoryIndex` instead of `PublishedPage` + `PublishedStory`.
- Index updater: accept `TopicPage`-shaped link payload (title, url, path, createdAt/publishedAt, storyTitles). Keep `TelegraphIndexPage.publishedPages` optional — prefer linking `TopicPage.indexPageId` only; do not require `PublishedPage` for new publishes.
- Soft-fail / idempotency in `publish-validation.ts`: key off `stepId` / job+topic instead of unique `jobId` page.

**Important:** Remove assumption `PublishedPage.jobId` is unique for new flow. Soft-fail empty/all-known unchanged.

- [ ] **Step 1: Update `publishDigest` to write TopicPage/StoryIndex and set `indexPageId` on TopicPage**

- [ ] **Step 2: Update internal publish route to require topicName (from step or body) and pass stepId**

- [ ] **Step 3: Point dedup lookback at StoryIndex (and PublishedStory fallback)**

- [ ] **Step 4: Run existing telegraph/dedup tests; fix assertions**

Run: `cd apps/web && npm test`

- [ ] **Step 5: Commit**

```bash
git commit -m "Publish each topic page into TopicPage and StoryIndex."
```

---

### Task 4: Pipeline — topic_publish only + prompts

**Files:**
- Modify: `apps/web/src/lib/generation-pipeline.ts`
- Modify: `apps/web/src/lib/prompt.ts`
- Modify: `apps/web/src/lib/prompt-dedup.test.ts`
- Modify: `apps/mcp-server/src/index.ts` (remove or deprecate `save_topic_draft`)
- Delete or stop calling: `saveTopicDraft` advancement path for merge; `buildMergePublishPrompt` unused

**Interfaces:**
- `createPipelineSteps`: only `topic_publish` rows (no merge).
- `startStep`: for `topic_publish`, use `buildTopicPublishPrompt(jobId, topic, …)` which:
  - Uses template + single topic keywords
  - Footer: call `publish_digest_page` with this topic’s HTML/stories; include topic name; forbid other topics
- On publish success: mark current `topic_publish` step completed (via existing publish handler), then `startFirstPendingStep` / next step (same as today’s draft advancement — move that into publish completion instead of `saveTopicDraft`).
- Soft-fail publish: still mark step completed and advance (board keeps old page).

- [ ] **Step 1: Rewrite failing prompt tests** for publish-at-end (no `save_topic_draft`)

- [ ] **Step 2: Implement `buildTopicPublishPrompt` / `appendTopicPublishMetadata`**

- [ ] **Step 3: Rewrite `createPipelineSteps` + `startStep`; wire publish route to complete step + start next**

- [ ] **Step 4: MCP — keep `publish_digest_page`; remove `save_topic_draft` tool (or make it return error pointing to publish)**

- [ ] **Step 5: Run tests + commit**

```bash
git commit -m "Replace merge pipeline with per-topic publish steps."
```

---

### Task 5: Home UI — board + sidebar

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: `loadTopicBoard()`
- Layout: `.home-layout` grid — `.home-sidebar` (recent list) + `.home-board` (topic cards). Header + short hero stay full width. Index link can sit under sidebar title or board footer.

**Copy:**
- Sidebar heading: `Recent digests` (same chips/time as today via `digestListTags` / `formatDigestWhen`, prefer `topicName` as label).
- Board heading: `Current topics` — one card per board entry with topic name, time, tags, Telegra.ph link.

**CSS:** Widen `.shell` for this page (e.g. `min(72rem, …)` via `.shell.shell-home`). Desktop: `grid-template-columns: minmax(14rem, 20rem) 1fr`. Mobile: stack board then sidebar.

- [ ] **Step 1: Implement page data load via `loadTopicBoard`**

- [ ] **Step 2: Markup + CSS**

- [ ] **Step 3: Manual sanity check in `npm run dev` (empty board, sample cards)**

- [ ] **Step 4: Commit**

```bash
git commit -m "Redesign home with topic board and digests sidebar."
```

---

### Task 6: Admin — boardStaleDays

**Files:**
- Modify: `apps/web/src/app/api/admin/prompt/route.ts`
- Modify: `apps/web/src/app/admin/page.tsx` (load field)
- Modify: `apps/web/src/app/admin/admin-ui.tsx` (Prompt section input)
- Modify: jobs step labels for `topic_publish`

**Interfaces:**
- PATCH accepts `boardStaleDays` integer 1–14 (inclusive).
- UI: number input “Board stale days” next to period hours.

- [ ] **Step 1: API validation + admin form field**

- [ ] **Step 2: Jobs UI label `topic_publish` → `publish: {topicName}`**

- [ ] **Step 3: Commit**

```bash
git commit -m "Add admin control for board stale days."
```

---

### Task 7: Backfill legacy PublishedPage → TopicPage

**Files:**
- Create: `apps/web/scripts/backfill-topic-pages.ts` (run with `tsx`)
- Optional: call from install docs / one-time `npm run backfill:topic-pages`

**Logic:**
- For each `PublishedPage` lacking a `TopicPage` with same `telegraphUrl`:
  - Parse topic tokens from title via existing `topicsFromDigestTitle`; if exactly one match to a `Topic.name`, set `topicId`/`topicName`; else `topicName: "Legacy"` / `topicId: null`.
  - Copy stories → `StoryIndex` (skip `canonicalUrl` conflicts — leave existing StoryIndex row).
- Idempotent on `telegraphUrl`.

- [ ] **Step 1: Write script + npm script**

- [ ] **Step 2: Run against local DB; verify counts**

- [ ] **Step 3: Commit**

```bash
git commit -m "Add backfill from PublishedPage to TopicPage."
```

---

### Task 8: Cleanup + docs

**Files:**
- Update: `README.md` (home board + per-topic publish)
- Update seed default prompt template if it still describes merge
- Leave `PublishedPage` models in schema until a later drop (document as legacy), OR remove if nothing references them after Task 3–7
- Grep for `merge_publish`, `save_topic_draft`, `buildMergePublishPrompt` — remove dead code
- Update `install.sh` only if seed/schema push needs a note (usually automatic on update)

- [ ] **Step 1: Dead code + README**

- [ ] **Step 2: Full test suite**

Run: `cd apps/web && npm test`

- [ ] **Step 3: Commit + push**

```bash
git commit -m "Remove merge-pipeline leftovers and document topic board."
git push origin main
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Per-topic Telegra.ph pages | 3, 4 |
| No merge step | 4, 8 |
| TopicPage + StoryIndex | 1, 3 |
| Board stale window | 2, 5, 6 |
| Sidebar = recent digests info | 5 |
| Keep history / no GC | 1–3 (no delete jobs) |
| Admin stale days | 6 |
| Telegraph index still updated | 3 |
| Migration of old pages | 7 |
| Phase 2 keywords deferred | — (non-goal) |

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-29-topic-board-home.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, `executing-plans`, checkpoints between tasks  

Which approach?
