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

## MCP server (Cursor CLI)

The `apps/mcp-server` package exposes a stdio MCP tool `publish_digest_page` that POSTs to the portal internal publish API. Configure it in `~/.cursor/mcp.json` (use absolute paths on your machine):

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

`INTERNAL_API_KEY` must match the value in the repo root `.env`. See `apps/mcp-server/.env.example` for variable names.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Services:

- **web** — portal on `:3000`, SQLite on `digest-data` volume
- **worker** — cron scheduler (stub until Task 9)

## Status

Portal, internal publish/generate APIs, and MCP stdio server are implemented. Scheduler worker and Docker polish follow in later tasks.
