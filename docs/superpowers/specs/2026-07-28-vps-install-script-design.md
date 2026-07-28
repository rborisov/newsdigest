# VPS install.sh — Design

**Date:** 2026-07-28  
**Repo:** `rborisov/newsdigest`  
**Status:** Approved in conversation; awaiting written-spec confirmation

## Goal

One root-runnable script that a VPS operator can download from GitHub and use for:

1. **First install** — Docker, nginx, Let's Encrypt, Cursor CLI (host), portal Compose stack, interactive config  
2. **Updates** — pull latest code, optional reconfigure, rebuild/restart

## Entry point

```bash
curl -fsSL https://raw.githubusercontent.com/rborisov/newsdigest/main/install.sh | bash
```

- Must run as **root** (`EUID=0`); exit with a clear error otherwise  
- Idempotent: detect existing install vs fresh  
- Target OS (v1): **Ubuntu 22.04 / 24.04** (apt)  
- Install root: **`/opt/newsdigest`**

## Architecture choice

**Single `install.sh` in repo root** (Approach 1). After first clone, updates re-run the same script from `/opt/newsdigest/install.sh` (or re-curl from `main`).

Cursor CLI stays on the **host** (not baked into the Next.js image). The script installs `agent`, symlinks it to `/usr/local/bin/agent`, and mounts it into the `web` service via `docker-compose.override.yml`, matching TN-0005 Host CLI.

## Detection: first install vs update

Treat as **already installed** when `/opt/newsdigest/.installed` exists **and** `/opt/newsdigest/docker-compose.yml` exists.

| Mode | Behavior |
|------|----------|
| First | Full package install + clone + prompts + compose up + nginx + certbot |
| Update | Ask reconfigure (default **N**); `git pull --ff-only`; refresh CLI/MCP/override as needed; `docker compose up -d --build`; reload nginx only if config changed |

## First-install flow

1. **Packages** (skip if already present): Docker Engine + Compose plugin, nginx, certbot + `python3-certbot-nginx`, curl, git, ca-certificates  
2. **Clone** `https://github.com/rborisov/newsdigest.git` → `/opt/newsdigest` (if directory empty/missing)  
3. **Interactive prompts** (required unless noted):
   - Domain (e.g. `news.example.com`)
   - Let's Encrypt email
   - Admin allowlist email(s) → `ALLOWED_EMAILS` (comma-separated OK)
   - Google OAuth client id / secret (optional; blank allowed)
   - Yandex OAuth client id / secret (optional; blank allowed)
   - At least one OAuth provider pair must be non-empty
   - `CURSOR_API_KEY` (required for generation)
   - Telegra.ph access token (optional)
4. **Auto-generate** `NEXTAUTH_SECRET` and `INTERNAL_API_KEY` (openssl rand) if not provided  
5. Write **`/opt/newsdigest/.env`** with `NEXTAUTH_URL=https://$DOMAIN` (Compose still overrides `DATABASE_URL` to the volume path)  
6. **Cursor CLI:** `curl https://cursor.com/install -fsS | bash`; ensure `agent` on PATH via `/usr/local/bin/agent` symlink  
7. Write **MCP config** for the host agent (e.g. `/root/.cursor/mcp.json`) pointing at `/opt/newsdigest/apps/mcp-server` with:
   - `PORTAL_URL=http://127.0.0.1:3000`
   - `INTERNAL_API_KEY` matching `.env`
8. Write **`docker-compose.override.yml`** mounting host `agent` + MCP path into `web`, set `CURSOR_CLI_PATH=/usr/local/bin/agent`  
9. `docker compose up -d --build` from `/opt/newsdigest`  
10. **nginx** site: reverse proxy `https://$DOMAIN` → `http://127.0.0.1:3000` (HTTP→HTTPS via certbot)  
11. **certbot** `--nginx -d $DOMAIN --email $LE_EMAIL --agree-tos --non-interactive`  
12. Touch `/opt/newsdigest/.installed`  
13. Print summary: URL, useful commands (`docker compose logs -f`, re-run install for updates)

## Update flow

1. Require existing `/opt/newsdigest` install marker  
2. Prompt: `Reconfigure domain/secrets/OAuth/Cursor key? [y/N]`  
   - **N:** leave `.env`, nginx site, and certs unchanged  
   - **Y:** re-prompt with current values as defaults where readable from `.env` / nginx  
3. `cd /opt/newsdigest && git pull --ff-only` (fail loudly on non-ff; do not force-reset)  
4. Refresh Cursor CLI (`agent update` when available; else re-run official installer)  
5. Refresh MCP config + `docker-compose.override.yml` if paths/keys changed  
6. `docker compose up -d --build`  
7. If domain/nginx changed during reconfigure: rewrite site + `nginx -t && systemctl reload nginx`; re-run certbot only when domain changed  
8. Do **not** force certificate renewal on every update (rely on certbot timer)

## Files the script owns / may rewrite

| Path | Role |
|------|------|
| `/opt/newsdigest/.env` | Portal secrets (create on first install; rewrite only on reconfigure) |
| `/opt/newsdigest/docker-compose.override.yml` | Host CLI + MCP mounts for `web` |
| `/opt/newsdigest/.installed` | Install marker |
| `/etc/nginx/sites-available/newsdigest` (+ `sites-enabled` link) | Reverse proxy |
| `/root/.cursor/mcp.json` | MCP stdio for host `agent` |

Do **not** commit `.env` or override secrets. Prefer not to overwrite user-edited nginx if a marker comment/`# managed-by: newsdigest-install` is missing — on first write always create; on update rewrite when reconfigure or domain change.

## Error handling

- Exit non-zero on: not root, unsupported OS (warn + continue only if `--force` later; v1 hard-fail on non-Ubuntu), `git pull` conflict, `docker compose` failure, `nginx -t` failure, certbot failure  
- Preserve existing `.env` on failed update mid-flight when possible  
- Do not pipe destructive `rm -rf` of `/opt/newsdigest` data volume

## Out of scope (v1)

- Non-Ubuntu distros  
- ufw/firewalld automation  
- In-container Cursor CLI image bake  
- Caddy (nginx + certbot only)  
- Automated off-box backups (document volume backup only in README blurb)  
- Multi-domain / www alias (single FQDN)

## README touch

Add a short “VPS install” section with the curl one-liner and note that re-running the script updates the stack.

## Success criteria

- Fresh Ubuntu VPS: one root command + interactive answers → HTTPS portal answering on the domain  
- Second run without reconfigure: pulls code, rebuilds, keeps `.env` and certs  
- Generate path: host `agent` reachable inside `web` via override mount; MCP can reach portal on `127.0.0.1:3000`
