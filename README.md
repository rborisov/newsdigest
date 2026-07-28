# News Digest Portal

Monorepo for the News Digest portal (Option A: Cursor CLI + stdio MCP on VPS → Telegra.ph).

## Structure

```
apps/
  web/          Next.js portal (App Router, TypeScript)
  worker/       Schedule poller → internal trigger API
  mcp-server/   stdio MCP for Cursor CLI publish tool
```

## Prerequisites

- Node.js 22+
- npm (workspaces)
- Docker & Docker Compose (for deployment)

## Setup

```bash
cp .env.example .env
# Edit .env with OAuth credentials, API keys, allowlist

npm install
```

## Development

```bash
npm run dev:web      # Next.js on http://localhost:3000
npm run dev:worker   # Worker stub (scheduler in Task 9)
npm run build        # Build web app
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Services:

- **web** — portal on `:3000`, SQLite on `digest-data` volume
- **worker** — cron scheduler (stub until Task 9)

## Status

Task 1 scaffold only. Auth, Prisma, admin UI, MCP, and Telegra.ph integration follow in later tasks.
