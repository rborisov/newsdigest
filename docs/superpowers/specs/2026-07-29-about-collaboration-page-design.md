# About / Collaboration page (editable, bilingual)

Date: 2026-07-29  
Status: approved in chat (pending file review)

## Goal

Add a public **About / Collaboration** article reachable from the site footer. Content describes the product, outlook, and collaboration paths. Editors change it in Admin; both **English** and **Russian** are first-class. No separate CTA field — contact details live inside the collaboration body.

## Current state (baseline)

- Public home (`/`) and admin UI; no site footer, no about page.
- Singleton config pattern already used: `PromptConfig`, `TelegraphMeta` (`id = "default"`).
- UI language of chrome is English; content language of digests is configurable.

## Approach

**Singleton `AboutPage` in SQLite + Admin form + `/about` routes** (same pattern as prompt settings).

Rejected: repo Markdown (not editable in Admin); unstructured HTML blob (easy to break layout); separate CTA/email columns (contact stays in collaboration text).

---

## Data model

### Add `AboutPage`

Singleton row `id = "default"`.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | String | `"default"` |
| `enabledEn` / `enabledRu` | Boolean | Publish that language (default `true`) |
| `footerLabelEn` / `footerLabelRu` | String | Footer link label |
| `pageTitleEn` / `pageTitleRu` | String | H1 |
| `leadEn` / `leadRu` | String | Short lead under H1 |
| `productEn` / `productRu` | String | “What it is” body (Markdown) |
| `outlookEn` / `outlookRu` | String | Outlook / roadmap body (Markdown) |
| `collaborationEn` / `collaborationRu` | String | Collaboration + contact (Markdown) |
| `updatedAt` | DateTime | Standard |

Empty string for a body field → that section is omitted on the public page (title/lead still optional; if `pageTitle` empty, fall back to footer label or “About”).

No HTML stored from Admin — **Markdown only** (paragraphs, lists, links). Render with the same conservative approach used elsewhere (sanitize after Markdown → HTML).

---

## Public UX

### Footer

- Shared `SiteFooter` on home and about pages (and other public shells that use `SiteHeader`).
- For each enabled language, one link:
  - EN → `/about/en` with `footerLabelEn`
  - RU → `/about/ru` with `footerLabelRu`
- If both languages disabled → no about links in footer.

### Routes

| Path | Behavior |
|------|----------|
| `/about` | Redirect to first available locale: EN if `enabledEn`, else RU if `enabledRu`, else 404 |
| `/about/en` | Render EN if `enabledEn`, else 404 |
| `/about/ru` | Render RU if `enabledRu`, else 404 |

On the page: language switcher links only to enabled locales. Section order: title → lead → Product → Outlook → Collaboration. Section headings are fixed chrome strings per locale (`Product` / `Продукт`, etc.) so editors only fill bodies.

### Visual

Match existing portal look (`shell`, `panel`, Syne/IBM Plex). Article is a single readable column — not a marketing landing overhaul.

---

## Admin

- New Admin section **About** (alongside Prompt / Telegraph).
- Tabs: **English** | **Русский**.
- Per tab: `enabled`, `footerLabel`, `pageTitle`, `lead`, three textareas (`product`, `outlook`, `collaboration`).
- Save via `PATCH /api/admin/about` (admin-only), load via `GET`.
- Validation: strings trimmed; booleans coerced; no requirement that bodies be non-empty (allows gradual fill). Footer label required when that language is enabled (fallback to “About” / “О продукте” if left blank on save).

---

## Seed / defaults

`prisma/seed.ts` upserts `AboutPage` with `update: {}` (do not overwrite editor changes on re-seed) and `create` with the default copy below.

### Default EN

- **footerLabel:** About / Collaboration  
- **pageTitle:** n. — a configurable news desk  
- **lead:** An editor-run news digest: topics and depth you choose, researched on a schedule, published for readers with a searchable history index.  
- **product:** Explain configurable topics, optional deep dives (fact-check, sources, context), editor-owned prompts, reader board + history index on VPS with full articles off-box (e.g. Telegra.ph), low ops on a small VPS.  
- **outlook:** Pluggable storage; pluggable AI worker (hosted agent, BYO API key, or self-hosted model); stronger search and exports (email / Telegram / RSS) as the desk matures.  
- **collaboration:** Paths — managed desk, self-hosted install + support, BYO agent key, white-label / private monitoring. Invite readers/partners to write with proposals (contact left for the operator to paste into this block).

### Default RU

Mirror the same structure and meaning; footer label **О продукте / Сотрудничество**; natural Russian, not a literal machine translation.

Exact seed strings live in `seed.ts` (and optionally duplicated in the implementation plan). Spec requires substance above; wording may be polished at implement time without another design pass.

---

## API

- `GET /api/admin/about` — admin session; returns singleton.  
- `PATCH /api/admin/about` — admin session; partial or full field update for EN/RU groups.  
- Public pages read via Prisma in RSC (no public write API).

---

## Out of scope

- Separate CTA / email / URL fields  
- WYSIWYG or raw HTML in Admin  
- Per-tenant about pages / SaaS multi-tenancy  
- Changing digest generation or Telegraph pipeline  
- Full i18n of the rest of the portal chrome  

---

## Acceptance

1. Footer shows enabled locale link(s); disabled locales absent.  
2. `/about` redirects correctly; disabled locale URLs 404.  
3. Admin can change any block and see it on the public page after save.  
4. Re-running seed does not wipe edited content.  
5. Empty body sections do not render empty headings.  
6. Markdown links/lists render; unsafe HTML from Markdown is sanitized.
)