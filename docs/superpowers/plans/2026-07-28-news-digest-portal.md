# News Digest Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Option A news digest portal at `/Volumes/docvol/newsdigest`: VPS Next.js app + worker + stdio MCP + Cursor CLI → Telegra.ph, per Obsidian design docs.

**Architecture:** Single monorepo. `web` (Next.js App Router) owns DB, OAuth, public home, admin, internal APIs, and spawns `agent -p`. `worker` polls schedules and hits internal trigger. `mcp-server` (stdio) exposes `publish_digest_page` to Cursor CLI. SQLite via Prisma on a Docker volume.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma + SQLite, Auth.js (NextAuth v5) Google+Yandex, node-cron worker, `@modelcontextprotocol/sdk` MCP, Docker Compose, Telegra.ph HTTP API.

**Design source (read-only):** `/Volumes/WORK/Obsidian/RUCOLA/projects/News/public/` — start at `RM-0001_Docs-Index.md`.

## Global Constraints

- No application source in the Obsidian vault
- Option A only: Cursor CLI + stdio MCP on VPS (no Cloud Agents API / HTTP MCP)
- Guest: read home only; Admin (`AllowedUser.isAdmin`): people, keys, prompt, period, topics, schedules, generate
- Telegra.ph index rotates near 64 KB soft limit (~55 KB); new index links to previous
- Story dedup via `PublishedStory` + `{{EXCLUDE_STORIES}}` in prompt
- Secrets only in `.env` / admin-stored tokens; never commit `.env`
- Commits: only when user asks

---

## File map (target)

```
/Volumes/docvol/newsdigest/
  package.json                 # workspace root scripts
  docker-compose.yml
  .env.example
  README.md
  apps/web/                    # Next.js portal
    prisma/schema.prisma
    src/app/...
    src/lib/{auth,db,telegraph,cursor,prompt,dedup}.ts
  apps/worker/                 # cron scheduler
    src/index.ts
  apps/mcp-server/             # stdio MCP
    src/index.ts
  docs/superpowers/plans/      # this plan
```

---

### Task 1: Scaffold monorepo + Docker skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml` or npm workspaces, `.gitignore`, `.env.example`, `docker-compose.yml`, `README.md`
- Create: `apps/web/` via `create-next-app` (TypeScript, App Router, ESLint, no Tailwind unless preferred — use minimal CSS)
- Create: `apps/worker/package.json`, `apps/mcp-server/package.json`

**Interfaces:**
- Produces: `docker compose up` builds `web` + `worker`; `web` listens `:3000`; shared env from `.env`

- [ ] **Step 1:** Init git repo in `/Volumes/docvol/newsdigest` (no remote required)
- [ ] **Step 2:** Create Next.js app in `apps/web` with TypeScript App Router
- [ ] **Step 3:** Add empty `apps/worker` and `apps/mcp-server` package.json with `"type": "module"`
- [ ] **Step 4:** Root workspace scripts: `dev:web`, `dev:worker`, `build`
- [ ] **Step 5:** Write `.env.example` with keys from TN-0005 (NEXTAUTH_*, GOOGLE_*, YANDEX_*, ALLOWED_EMAILS, INTERNAL_API_KEY, CURSOR_API_KEY, TELEGRAPH_ACCESS_TOKEN, DATABASE_URL)
- [ ] **Step 6:** Write `docker-compose.yml` with `web`, `worker`, volume `digest-data`
- [ ] **Step 7:** Verify `npm run dev:web` starts (or `pnpm`)

---

### Task 2: Prisma schema (DD-0003)

**Files:**
- Create: `apps/web/prisma/schema.prisma`
- Create: `apps/web/src/lib/db.ts`
- Create: `apps/web/prisma/seed.ts`

**Interfaces:**
- Produces: models `Topic`, `Schedule`, `PromptConfig`, `TelegraphMeta`, `TelegraphIndexPage`, `PublishedPage`, `PublishedStory`, `GenerationJob`, `AllowedUser` (+ Auth.js tables)
- Produces: `prisma db push` + seed creates default `PromptConfig`, empty `TelegraphMeta`, admins from `ALLOWED_EMAILS`

- [ ] **Step 1:** Write schema matching DD-0003 v4 (`AllowedUser.isAdmin`, `TelegraphIndexPage` chain, `PublishedStory`, `currentIndexPath/Url`)
- [ ] **Step 2:** Add Auth.js Prisma adapter models (`User`, `Account`, `Session`, `VerificationToken`)
- [ ] **Step 3:** Seed script: upsert AllowedUsers from env as `isAdmin: true`; default prompt with `{{TOPICS}}`, `{{PERIOD_HOURS}}`, `{{DATE}}`, `{{EXCLUDE_STORIES}}`
- [ ] **Step 4:** Run `npx prisma db push` and seed; verify SQLite file created

---

### Task 3: Auth.js Google + Yandex + admin gate (TN-0001)

**Files:**
- Create: `apps/web/src/lib/auth.ts`, `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/src/middleware.ts` or server helpers `requireAdmin()`
- Create: `apps/web/src/app/auth/signin/page.tsx`, `auth/error/page.tsx`

**Interfaces:**
- Produces: `auth()` session; `requireAdmin()` throws/redirects if missing session or `!isAdmin`
- Consumes: `AllowedUser` rows

- [ ] **Step 1:** Configure Auth.js with Google + Yandex providers; Prisma adapter
- [ ] **Step 2:** `signIn` callback: reject email not in `AllowedUser`
- [ ] **Step 3:** Session callback: attach `isAdmin` from `AllowedUser`
- [ ] **Step 4:** Protect `/admin` and `/api/admin/*`, `/api/generate` with `requireAdmin()`
- [ ] **Step 5:** Manual check: non-allowlisted OAuth → error; allowlisted admin → session

---

### Task 4: Public home (guest read)

**Files:**
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/layout.tsx` (simple layout)

**Interfaces:**
- Consumes: `TelegraphMeta.currentIndexUrl`, latest `PublishedPage` (limit 5)
- Produces: guest-readable home; link “Admin” only if admin session

- [ ] **Step 1:** Server component loads meta + pages from Prisma
- [ ] **Step 2:** Render current Telegra.ph index link + list of digest links
- [ ] **Step 3:** If admin session, show links to `/admin` and “Generate now”

---

### Task 5: Admin UI — people, prompt, period, topics, schedules, keys

**Files:**
- Create: `apps/web/src/app/admin/page.tsx` (+ small client forms or server actions)
- Create: `apps/web/src/app/api/admin/{users,topics,schedules,prompt,telegraph,settings}/route.ts`

**Interfaces:**
- Produces: CRUD for `AllowedUser` (block deleting last admin), `Topic`, `Schedule`, `PromptConfig.periodHours` + template, Telegra.ph token fields
- API keys: allow updating `TelegraphMeta.accessToken`; document `CURSOR_API_KEY` as env-only in v1 if safer (or store in settings table) — prefer env for Cursor key, DB for Telegraph token editable in admin

- [ ] **Step 1:** Admin page sections: People, Prompt & period, Topics, Schedules, Telegra.ph token
- [ ] **Step 2:** Server actions / API with `requireAdmin()`
- [ ] **Step 3:** Enforce last-admin protection

---

### Task 6: Telegra.ph client + index rotation (TN-0003)

**Files:**
- Create: `apps/web/src/lib/telegraph.ts` (`createPage`, `editPage`, `htmlToTelegraphNodes`, `estimateSize`, `updateIndexAfterPublish`)
- Test: `apps/web/src/lib/telegraph.test.ts` (size estimate + rotate decision)

**Interfaces:**
- Produces: `publishDigest({ title, html, stories })` → create digest page, upsert stories, update or rotate index, return URLs
- Soft limit constant: `INDEX_SOFT_LIMIT_BYTES = 55_000`

- [ ] **Step 1:** Implement HTML→nodes for allowed tags
- [ ] **Step 2:** Implement create/edit page HTTP calls
- [ ] **Step 3:** Implement rotate logic: if candidate body > soft limit → new index with “Older digests →” link; set `TelegraphMeta.current*`
- [ ] **Step 4:** Unit test rotate vs edit decision without live API

---

### Task 7: Internal publish + generate + prompt assembly + dedup (TN-0002)

**Files:**
- Create: `apps/web/src/lib/prompt.ts`, `apps/web/src/lib/dedup.ts`, `apps/web/src/lib/cursor.ts`
- Create: `apps/web/src/app/api/internal/trigger/route.ts`, `publish/route.ts`
- Create: `apps/web/src/app/api/generate/route.ts`

**Interfaces:**
- `buildPrompt(jobId)` → string with placeholders + exclude list (30 days, max 150)
- `spawnAgent(prompt)` → detached `agent -p --trust --approve-mcps`
- `POST /api/internal/*` requires header `x-internal-key === process.env.INTERNAL_API_KEY`
- Publish upserts `PublishedStory`; fails if all stories already known and body empty of new content

- [ ] **Step 1:** Implement `buildPrompt` + exclude list
- [ ] **Step 2:** Implement trigger → `GenerationJob` → spawn CLI
- [ ] **Step 3:** Implement publish endpoint calling telegraph helper
- [ ] **Step 4:** Wire `/api/generate` to same trigger path with admin auth

---

### Task 8: MCP stdio server (TN-0004)

**Files:**
- Create: `apps/mcp-server/src/index.ts`
- Create: `apps/mcp-server/.env.example` note for `PORTAL_URL`, `INTERNAL_API_KEY`

**Interfaces:**
- Tool `publish_digest_page({ title, htmlContent, stories? })` → POST `${PORTAL_URL}/api/internal/publish`

- [ ] **Step 1:** MCP server with one tool
- [ ] **Step 2:** Document `~/.cursor/mcp.json` snippet in README

---

### Task 9: Scheduler worker

**Files:**
- Create: `apps/worker/src/index.ts`

**Interfaces:**
- Every 60s reload enabled `Schedule` rows; maintain cron jobs; on fire POST trigger with `x-internal-key`

- [ ] **Step 1:** Implement reload loop + node-cron
- [ ] **Step 2:** Compose service uses same `.env` and `PORTAL_URL=http://web:3000`

---

### Task 10: Docker polish + README smoke path (TN-0005)

**Files:**
- Modify: `Dockerfile` for web (and optional CLI install note), `docker-compose.yml`, `README.md`

- [ ] **Step 1:** Multi-stage Docker build for web; worker image
- [ ] **Step 2:** README: env, compose up, prisma, OAuth setup, MCP path, generate smoke test
- [ ] **Step 3:** Document Cursor CLI: in-container vs host (TN-0005 §5)

---

## Spec coverage check

| Design doc | Tasks |
|------------|-------|
| DS-0001 / DD-0001 Option A | 1, 7, 8, 9 |
| DD-0002 components/routes | 3–5, 7–8 |
| DD-0003 data model | 2 |
| TN-0001 roles | 3, 4, 5 |
| TN-0002 flow + dedup | 7 |
| TN-0003 telegraph + rotation | 6–7 |
| TN-0004 CLI + MCP | 7–8 |
| TN-0005 deploy | 1, 10 |

---

## Execution

Plan saved to `docs/superpowers/plans/2026-07-28-news-digest-portal.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  

**2. Inline Execution** — implement tasks in this session with checkpoints  

Which approach?
