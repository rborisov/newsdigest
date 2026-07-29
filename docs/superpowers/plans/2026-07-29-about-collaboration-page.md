# About / Collaboration page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editable bilingual About/Collaboration page linked from the site footer, managed in Admin.

**Architecture:** Singleton `AboutPage` in Prisma (like `PromptConfig`). Public `/about` + `/about/en|ru` render Markdown sections. Admin section with EN/RU tabs PATCHes the singleton. Shared `SiteFooter` shows enabled locale links.

**Tech Stack:** Next.js App Router (`apps/web`), Prisma/SQLite, existing admin fetch/requireAdmin patterns, `node:test` for lib tests. No new Markdown package — small local renderer + existing HTML allowlist sanitize.

**Spec:** `docs/superpowers/specs/2026-07-29-about-collaboration-page-design.md`

## Global Constraints

- Markdown only in Admin (no raw HTML fields).
- No separate CTA/email columns — contact lives in `collaboration*` bodies.
- Re-seed must not overwrite edited `AboutPage` (`update: {}`).
- Empty body fields omit their section (no empty headings).
- Footer links only for `enabledEn` / `enabledRu`.
- Prefer existing admin inline-style patterns and public CSS classes.
- Do not commit unless the user explicitly asks (skip plan commit steps during execution unless requested).

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/prisma/schema.prisma` | `AboutPage` model |
| `apps/web/prisma/seed.ts` | Default EN/RU copy upsert |
| `apps/web/src/lib/about-markdown.ts` | Markdown → HTML |
| `apps/web/src/lib/about-markdown.test.ts` | Renderer tests |
| `apps/web/src/lib/about-page.ts` | Locale helpers, section chrome labels, load helpers |
| `apps/web/src/lib/about-page.test.ts` | Redirect / enabled locale logic |
| `apps/web/src/app/api/admin/about/route.ts` | GET/PATCH admin API |
| `apps/web/src/app/about/page.tsx` | Redirect to first enabled locale |
| `apps/web/src/app/about/[locale]/page.tsx` | Public article |
| `apps/web/src/app/site-footer.tsx` | Footer links |
| `apps/web/src/app/page.tsx` | Include footer |
| `apps/web/src/app/globals.css` | Footer + about article styles |
| `apps/web/src/app/admin/page.tsx` | Load about into AdminClient |
| `apps/web/src/app/admin/admin-ui.tsx` | About section UI |

---

### Task 1: Schema + seed defaults

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Modify: `apps/web/prisma/seed.ts`

**Interfaces:**
- Produces: Prisma model `AboutPage` with fields listed below
- Consumes: existing Prisma client / seed upsert pattern

- [ ] **Step 1: Add model to schema**

Append:

```prisma
model AboutPage {
  id                 String   @id @default("default")
  enabledEn          Boolean  @default(true)
  enabledRu          Boolean  @default(true)
  footerLabelEn      String   @default("About / Collaboration")
  footerLabelRu      String   @default("О продукте / Сотрудничество")
  pageTitleEn        String   @default("")
  pageTitleRu        String   @default("")
  leadEn             String   @default("")
  leadRu             String   @default("")
  productEn          String   @default("")
  productRu          String   @default("")
  outlookEn          String   @default("")
  outlookRu          String   @default("")
  collaborationEn    String   @default("")
  collaborationRu    String   @default("")
  updatedAt          DateTime @updatedAt
}
```

- [ ] **Step 2: Seed upsert with default copy**

In `seed.ts`, after prompt/telegraph upserts, add `aboutPage.upsert` with `where: { id: "default" }`, `update: {}`, and `create` containing:

**EN defaults:**
- `footerLabelEn`: `About / Collaboration`
- `pageTitleEn`: `n. — a configurable news desk`
- `leadEn`: `An editor-run news digest: you choose the topics and how deep to go. An agent researches on a schedule; readers get a live board and a history index, with full articles hosted off the VPS.`
- `productEn`:

```md
**n.** is a self-hosted news desk for editors, not another infinite feed.

- Configure topics and keywords; set schedules or generate on demand.
- Optionally mark topics for deeper treatment — fact-checking, source links, and context — with prompts you own.
- Readers browse the current board and follow links to full digests; the VPS keeps an index so past topics and stories stay findable while article bodies live on inexpensive external storage (Telegra.ph by default).
- Runs on a small VPS alongside an AI worker you control.
```

- `outlookEn`:

```md
The desk is built to stay thin on the server and flexible at the edges:

- **Storage:** Telegra.ph as a simple default; other backends when branding or control matter.
- **AI worker:** hosted agent we operate, your own API key in Admin, or a model you (or we) run on your hardware — same editorial pipeline either way.
- **Next:** richer history search, exports (email, Telegram, RSS), and white-label desks for private monitoring.
```

- `collaborationEn`:

```md
Ways to work together:

1. **Managed desk** — we host and tune topics/prompts; you get a ready portal and cadence.
2. **Self-hosted** — install on your VPS; we help with setup and updates.
3. **BYO agent** — bring your own model/API key; pay for the desk software and editorial tooling, not our inference.
4. **Private / white-label** — brand monitoring or member digests under your domain.

If this fits a channel, newsroom, research team, or corporate monitoring need, reach out with your use case and preferred setup. (Add your contact details here.)
```

**RU defaults:** same structure/meaning:
- `footerLabelRu`: `О продукте / Сотрудничество`
- `pageTitleRu`: `n. — настраиваемый новостной desk`
- `leadRu`: `Редакционный новостной дайджест: темы и глубину разбора задаёте вы. Агент исследует по расписанию; читатели видят актуальную доску и индекс истории, а полные тексты хранятся вне VPS.`
- `productRu` / `outlookRu` / `collaborationRu`: natural Russian mirrors of the EN bullets (managed desk, self-hosted, BYO agent, white-label; storage + AI pluggability; contact placeholder in collaboration).

Set `enabledEn: true`, `enabledRu: true`.

- [ ] **Step 3: Push schema**

Run from `apps/web`:

```bash
npm run db:push
```

Expected: success; `AboutPage` present. Optionally `npm run db:seed` to insert defaults.

---

### Task 2: Markdown renderer + locale helpers

**Files:**
- Create: `apps/web/src/lib/about-markdown.ts`
- Create: `apps/web/src/lib/about-markdown.test.ts`
- Create: `apps/web/src/lib/about-page.ts`
- Create: `apps/web/src/lib/about-page.test.ts`

**Interfaces:**
- Produces:
  - `renderAboutMarkdown(md: string): string` — sanitized HTML
  - `type AboutLocale = "en" | "ru"`
  - `resolveAboutRedirectLocale(page: { enabledEn: boolean; enabledRu: boolean }): AboutLocale | null`
  - `isAboutLocaleEnabled(page, locale): boolean`
  - `pickAboutLocaleContent(page, locale): { footerLabel, pageTitle, lead, product, outlook, collaboration }`
  - `aboutSectionLabels(locale): { product, outlook, collaboration }`
- Consumes: `sanitizeDigestHtml` from `./sanitize-digest-html`

- [ ] **Step 1: Write failing tests for markdown**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderAboutMarkdown } from "./about-markdown";

describe("renderAboutMarkdown", () => {
  it("renders paragraphs and bold", () => {
    const html = renderAboutMarkdown("Hello **world**.\n\nSecond.");
    assert.match(html, /<p>/);
    assert.match(html, /<strong>world<\/strong>/);
  });

  it("renders unordered lists and links", () => {
    const html = renderAboutMarkdown("- one\n- [two](https://example.com)");
    assert.match(html, /<ul>/);
    assert.match(html, /<a href="https:\/\/example.com"/);
  });

  it("strips scripty HTML", () => {
    const html = renderAboutMarkdown('<script>alert(1)</script>\n\nSafe');
    assert.doesNotMatch(html, /<script>/i);
    assert.match(html, /Safe/);
  });

  it("returns empty for blank input", () => {
    assert.equal(renderAboutMarkdown("  "), "");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/web && node --import tsx --test src/lib/about-markdown.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `about-markdown.ts`**

Minimal Markdown:
1. Escape raw HTML in source by not parsing tags from input as HTML — convert MD to a small HTML string, then pass through `sanitizeDigestHtml`.
2. Support: paragraphs (blank-line separated), `**bold**`, `*italic*` or `_italic_`, `- ` / `* ` unordered lists, `[text](url)` links, optional ordered `1. ` lists.
3. Do not implement full CommonMark.

Sketch:

```ts
import { sanitizeDigestHtml } from "./sanitize-digest-html";

export function renderAboutMarkdown(md: string): string {
  const trimmed = md.trim();
  if (!trimmed) return "";
  const html = markdownToHtml(trimmed);
  return sanitizeDigestHtml(html);
}

function markdownToHtml(src: string): string {
  // split into blocks on /\n\s*\n/; if block lines all match /^[-*] / or /^\d+\. /, emit <ul>/<ol>;
  // else wrap <p> with inline ** * _ and [text](url) after escaping text segments.
  ...
}
```

- [ ] **Step 4: Re-run markdown tests — expect PASS**

- [ ] **Step 5: Write locale helper tests**

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveAboutRedirectLocale,
  isAboutLocaleEnabled,
  pickAboutLocaleContent,
  aboutSectionLabels,
} from "./about-page";

describe("about-page helpers", () => {
  it("prefers EN for redirect when both enabled", () => {
    assert.equal(resolveAboutRedirectLocale({ enabledEn: true, enabledRu: true }), "en");
  });

  it("falls back to RU", () => {
    assert.equal(resolveAboutRedirectLocale({ enabledEn: false, enabledRu: true }), "ru");
  });

  it("returns null when none enabled", () => {
    assert.equal(resolveAboutRedirectLocale({ enabledEn: false, enabledRu: false }), null);
  });

  it("picks EN fields", () => {
    const c = pickAboutLocaleContent(
      {
        footerLabelEn: "A", footerLabelRu: "Б",
        pageTitleEn: "T", pageTitleRu: "З",
        leadEn: "L", leadRu: "Л",
        productEn: "P", productRu: "П",
        outlookEn: "O", outlookRu: "О",
        collaborationEn: "C", collaborationRu: "С",
      },
      "en",
    );
    assert.equal(c.pageTitle, "T");
    assert.equal(c.collaboration, "C");
  });

  it("returns RU section labels", () => {
    assert.equal(aboutSectionLabels("ru").product, "Продукт");
  });
});
```

- [ ] **Step 6: Implement `about-page.ts` and pass tests**

```ts
export type AboutLocale = "en" | "ru";

export function resolveAboutRedirectLocale(page: {
  enabledEn: boolean;
  enabledRu: boolean;
}): AboutLocale | null {
  if (page.enabledEn) return "en";
  if (page.enabledRu) return "ru";
  return null;
}

export function isAboutLocaleEnabled(
  page: { enabledEn: boolean; enabledRu: boolean },
  locale: AboutLocale,
): boolean {
  return locale === "en" ? page.enabledEn : page.enabledRu;
}

export function pickAboutLocaleContent(page: { ... }, locale: AboutLocale) { ... }

export function aboutSectionLabels(locale: AboutLocale) {
  return locale === "ru"
    ? { product: "Продукт", outlook: "Перспективы", collaboration: "Сотрудничество" }
    : { product: "Product", outlook: "Outlook", collaboration: "Collaboration" };
}

export function parseAboutLocale(raw: string): AboutLocale | null {
  if (raw === "en" || raw === "ru") return raw;
  return null;
}
```

- [ ] **Step 7: Run both test files — expect PASS**

```bash
cd apps/web && node --import tsx --test src/lib/about-markdown.test.ts src/lib/about-page.test.ts
```

---

### Task 3: Admin API

**Files:**
- Create: `apps/web/src/app/api/admin/about/route.ts`

**Interfaces:**
- Produces: `GET` → `{ about: AboutPageJSON }`; `PATCH` body with any subset of about fields → updated `{ about }`
- Consumes: `requireAdminApi`, `prisma.aboutPage`

- [ ] **Step 1: Implement GET/PATCH**

Mirror `api/admin/prompt/route.ts`:

- `ABOUT_ID = "default"`
- GET: `findUnique`; 404 if missing
- PATCH: accept booleans `enabledEn`/`enabledRu` and string fields listed in schema; trim strings; if a language is enabled and its `footerLabel*` is empty after trim, set default `"About / Collaboration"` or `"О продукте / Сотрудничество"`
- Do not require body fields to be non-empty

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/require-admin";

const ABOUT_ID = "default";

export async function GET() {
  const result = await requireAdminApi();
  if (result.error) return result.error;
  const about = await prisma.aboutPage.findUnique({ where: { id: ABOUT_ID } });
  if (!about) return NextResponse.json({ error: "About page not found." }, { status: 404 });
  return NextResponse.json({ about });
}

export async function PATCH(request: Request) {
  // requireAdminApi; parse body; build data; update; return { about }
}
```

---

### Task 4: Public pages + footer

**Files:**
- Create: `apps/web/src/app/site-footer.tsx`
- Create: `apps/web/src/app/about/page.tsx`
- Create: `apps/web/src/app/about/[locale]/page.tsx`
- Modify: `apps/web/src/app/page.tsx` — render `<SiteFooter />` with enabled labels
- Modify: `apps/web/src/app/globals.css` — `.site-footer`, `.about-article`, `.about-lang-switch`

**Interfaces:**
- Consumes: `resolveAboutRedirectLocale`, `parseAboutLocale`, `isAboutLocaleEnabled`, `pickAboutLocaleContent`, `aboutSectionLabels`, `renderAboutMarkdown`
- Produces: public routes + footer component

- [ ] **Step 1: `SiteFooter`**

```tsx
import Link from "next/link";

export function SiteFooter({
  links,
}: {
  links: { href: string; label: string }[];
}) {
  if (links.length === 0) return null;
  return (
    <footer className="site-footer">
      <nav aria-label="Site">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="footer-link">
            {l.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
```

Helper in `about-page.ts` (optional):

```ts
export function aboutFooterLinks(page: {
  enabledEn: boolean; enabledRu: boolean;
  footerLabelEn: string; footerLabelRu: string;
}): { href: string; label: string }[] {
  const links = [];
  if (page.enabledEn) links.push({ href: "/about/en", label: page.footerLabelEn || "About / Collaboration" });
  if (page.enabledRu) links.push({ href: "/about/ru", label: page.footerLabelRu || "О продукте / Сотрудничество" });
  return links;
}
```

- [ ] **Step 2: `/about/page.tsx` redirect**

```tsx
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveAboutRedirectLocale } from "@/lib/about-page";

export default async function AboutIndexPage() {
  const about = await prisma.aboutPage.findUnique({ where: { id: "default" } });
  if (!about) notFound();
  const locale = resolveAboutRedirectLocale(about);
  if (!locale) notFound();
  redirect(`/about/${locale}`);
}
```

- [ ] **Step 3: `/about/[locale]/page.tsx`**

- Parse locale; `notFound()` if invalid or disabled
- Render `SiteHeader`, article with title/lead, sections with labels only when body non-empty after trim, `dangerouslySetInnerHTML` with `renderAboutMarkdown`
- Language switch: links to other enabled locales
- Include `SiteFooter`

- [ ] **Step 4: Wire footer on home**

Load `aboutPage` (or only footer fields) in `page.tsx` alongside board; pass `aboutFooterLinks(about)` (empty array if null).

- [ ] **Step 5: CSS**

Add compact footer (top border, muted links, spacing under shell) and about article typography consistent with `.hero` / `.panel`.

---

### Task 5: Admin UI section

**Files:**
- Modify: `apps/web/src/app/admin/page.tsx`
- Modify: `apps/web/src/app/admin/admin-ui.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/admin/about`, existing `adminFetch`
- Produces: `AboutSection` in AdminClient props

- [ ] **Step 1: Load about in `admin/page.tsx`**

Add `prisma.aboutPage.findUnique({ where: { id: "default" } })` to `Promise.all`. If missing, throw like prompt/telegraph (`Run db:seed`). Pass full about fields into `AdminClient` data as `about`.

- [ ] **Step 2: Add `AboutSection` component**

In `admin-ui.tsx`:
- Type `AboutPageRow` with all fields
- Local state + tab `en` | `ru`
- Per tab: checkbox Enabled, inputs for footerLabel/pageTitle, textareas for lead/product/outlook/collaboration
- Save button → `adminFetch("/api/admin/about", { method: "PATCH", body: JSON.stringify({ ...all fields from state }) })`
- Place section in the admin nav/sections list near Prompt / Telegraph (label **About**)

- [ ] **Step 3: Manual smoke**

1. `npm run db:push && npm run db:seed` (if needed)
2. Open Admin → About → edit RU collaboration → Save
3. Open `/about/ru` — see change
4. Disable EN → footer shows only RU; `/about` → `/about/ru`; `/about/en` → 404

---

### Task 6: Verification

**Files:** none new

- [ ] **Step 1: Unit tests**

```bash
cd apps/web && npm test
```

Expected: existing + new about tests PASS.

- [ ] **Step 2: Spec checklist**

Confirm against `docs/superpowers/specs/2026-07-29-about-collaboration-page-design.md` acceptance items 1–6.

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| `AboutPage` singleton fields | 1 |
| Seed EN/RU, `update: {}` | 1 |
| Markdown + sanitize | 2 |
| Locale redirect / enable logic | 2, 4 |
| Admin GET/PATCH | 3 |
| Footer links | 4 |
| `/about`, `/about/en|ru` | 4 |
| Admin About section | 5 |
| No separate CTA | 1–5 (no CTA fields) |
| Acceptance 1–6 | 6 |

No placeholders remaining; field names consistent (`enabledEn`, `collaborationEn`, etc.).
`)