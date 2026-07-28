# News Digest Portal

Monorepo for the News Digest portal (Option A: Cursor CLI + stdio MCP on VPS → Telegra.ph).

## VPS install (Ubuntu) — host Node + systemd (no Docker)

Designed for **small VPS (1 GB RAM)** with automatic swap during build.

### Requirements

| Resource | Minimum | Notes |
|----------|---------|--------|
| RAM | **1 GB** | Installer adds **2 GB swap** if RAM &lt; ~1.8 GB |
| CPU | 1 vCPU | Build is slow; leave it running |
| Disk | 8 GB free | App + `node_modules` + swap |
| OS | Ubuntu 22.04 or 24.04 | |
| Network | 80/443 + DNS A record | |

Runtime is typically a few hundred MB; the heavy step is `next build` (uses swap on 1 GB).

As root:

```bash
curl -fsSL https://raw.githubusercontent.com/rborisov/newsdigest/main/install.sh | bash
```

Installs Node 22, nginx, certbot, Cursor CLI; clones to `/opt/newsdigest`; builds the app; runs **systemd** units `newsdigest-web` and `newsdigest-worker`.

Re-run the same command to update (optional reconfigure, default no).

```bash
journalctl -u newsdigest-web -f
systemctl status newsdigest-web newsdigest-worker
```

Docker Compose remains in the repo for local/dev or larger hosts; the VPS curl installer does **not** use Docker.

## Structure

```
apps/
  web/          Next.js portal (App Router, TypeScript)
  worker/       Schedule poller → internal trigger API
  mcp-server/   stdio MCP for Cursor CLI publish tool
```

## Prerequisites

- Node.js 22+ and npm (local development)
- Docker & Docker Compose (recommended for deployment)
- [Cursor CLI](https://cursor.com/docs/cli) (`agent` on `PATH`) for digest generation
- Google and/or Yandex OAuth apps (for sign-in)
- Telegra.ph access token (optional at boot; can be set in admin UI)

## Environment

Copy the example env file and edit values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|----------|---------|
| `NEXTAUTH_URL` | Public portal URL (`http://localhost:3000` locally; `https://your-domain.com` on VPS) |
| `NEXTAUTH_SECRET` | Session signing secret (random string) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` | Yandex OAuth |
| `ALLOWED_EMAILS` | Comma-separated sign-in allowlist; seeded as admins |
| `INTERNAL_API_KEY` | Shared secret for worker + MCP → portal internal APIs |
| `CURSOR_API_KEY` | Cursor CLI API key for **Generate now** / scheduled runs |
| `CURSOR_CLI_PATH` | Optional path to CLI binary (default: `agent`) |
| `TELEGRAPH_ACCESS_TOKEN` | Telegra.ph token (optional if set later in admin) |
| `DATABASE_URL` | SQLite path for local dev (`file:./dev.db`); overridden in Compose |

Docker Compose sets `DATABASE_URL=file:/app/data/digest.db` on both `web` and `worker` and mounts a shared `digest-data` volume.

## OAuth setup

Create OAuth clients for each provider you enable.

**Google**

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized redirect URI: `{NEXTAUTH_URL}/api/auth/callback/google`
3. Copy client ID and secret into `.env`.

**Yandex**

1. [Yandex OAuth](https://oauth.yandex.com/) → register an app.
2. Redirect URI: `{NEXTAUTH_URL}/api/auth/callback/yandex`
3. Copy client ID and secret into `.env`.

Set `NEXTAUTH_URL` to the exact public URL users hit (HTTPS on VPS). Add every allowlisted email to `ALLOWED_EMAILS`.

## Docker (production path)

From the repo root:

```bash
cp .env.example .env
# Edit .env (OAuth, secrets, allowlist, CURSOR_API_KEY)
docker compose up --build
```

Services:

| Service | Role |
|---------|------|
| **web** | Next.js portal on `:3000`; runs `next start` (not dev); applies Prisma schema + seed on boot |
| **worker** | Reloads enabled schedules every 60s; POSTs to portal internal trigger API |

On first start the web container runs `prisma db push` and seeds admins from `ALLOWED_EMAILS` into the shared SQLite volume.

Open `http://localhost:3000` (or your public URL behind a reverse proxy).

### Reverse proxy (VPS)

Example Caddy block:

```
your-domain.com {
  reverse_proxy localhost:3000
}
```

Set `NEXTAUTH_URL=https://your-domain.com` and restart Compose.

## Database (local development)

```bash
npm install
npm run db:push --workspace=web   # prisma db push
npm run db:seed --workspace=web   # seed admins + defaults
```

In Docker, schema push and seed run automatically via `apps/web/docker-entrypoint.sh`.

## Development (without Docker)

```bash
cp .env.example .env
npm install
npm run db:push --workspace=web
npm run db:seed --workspace=web
npm run dev:web      # http://localhost:3000
npm run dev:worker   # scheduler (separate terminal)
```

## MCP server (Cursor CLI)

The `apps/mcp-server` package exposes stdio tool `publish_digest_page`, which POSTs to the portal internal publish API. `INTERNAL_API_KEY` must match the repo root `.env`.

Configure on the machine where the **Cursor CLI runs** (typically the host during local dev):

```json
{
  "mcpServers": {
    "news-digest": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/newsdigest/apps/mcp-server/src/index.ts"],
      "env": {
        "PORTAL_URL": "http://localhost:3000",
        "INTERNAL_API_KEY": "change-me"
      }
    }
  }
}
```

On a VPS Docker install, the **web image bakes in** `apps/mcp-server` at `/app/mcp-server` (deps included). `install.sh` writes `mcp.json` pointing at that path inside the container — no host Node and no extra `node:bookworm` pull.

For local/host MCP, see `apps/mcp-server/.env.example`.

## Cursor CLI placement (TN-0005)

The portal spawns the CLI when an admin clicks **Generate now** or when the worker triggers a schedule. The CLI must be available **where the portal process runs**, and MCP config must reference `apps/mcp-server` with the same `INTERNAL_API_KEY`.

Headless spawn uses `-p --force --sandbox disabled --trust --approve-mcps` so fetch/shell/MCP are not silently rejected. `install.sh` also writes `/root/.cursor/cli-config.json` (allow Shell/WebFetch/Mcp) and `sandbox.json` (allow localhost for portal MCP). Without those, job logs show “environment blocked” and no `digestUrl`.

| Mode | When to use | Setup |
|------|-------------|--------|
| **Host CLI + Docker portal (VPS)** | Recommended small-VPS path | Install `agent` on the host; `install.sh` mounts it into `web` and mounts `mcp.json` → `/home/nextjs/.cursor/mcp.json`. MCP code/deps live **inside** the web image (`/app/mcp-server`). |
| **Local host CLI** | Dev without Docker for generation | Point MCP at the repo `apps/mcp-server` checkout with local `npm install`. |

Requirements:

- `CURSOR_API_KEY` in `.env`
- MCP entrypoint: `/app/mcp-server/src/index.ts` in Docker, or local repo path for host-only
- `INTERNAL_API_KEY` matches across portal, worker, and MCP

## Smoke test (zero → running portal)

1. Clone the repo and `cd` into it.
2. `cp .env.example .env` — set `ALLOWED_EMAILS` to your email, pick strong secrets, add `CURSOR_API_KEY` if testing generation.
3. `docker compose up --build` — wait for `[web] starting Next.js...` and `[scheduler] worker starting`.
4. Open `http://localhost:3000` — home page loads.
5. Sign in with Google or Yandex using an allowlisted email.
6. Admin → verify Telegra.ph token (env or UI), add a topic, optionally add a schedule.
7. **Generate now** — confirm a job starts (requires CLI + MCP configured on the host or in-container).
8. After a successful run, Telegra.ph shows the digest and the portal index updates.

Backup the `digest-data` Docker volume regularly on VPS deployments.

## Status

Portal, internal publish/generate APIs, MCP stdio server, scheduler worker, and production Docker images are implemented.
