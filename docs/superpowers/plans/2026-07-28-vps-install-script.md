# VPS install.sh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a root-runnable `install.sh` that first-installs and later updates the News Digest portal on Ubuntu with Docker, nginx, Let's Encrypt, and host Cursor CLI.

**Architecture:** Single bash script at repo root. Detects `/opt/newsdigest/.installed` for update vs first-install. Writes `.env`, `docker-compose.override.yml`, nginx site, and `/root/.cursor/mcp.json`. Host `agent` is mounted into the `web` container (TN-0005 Host CLI).

**Tech Stack:** bash, apt (Ubuntu 22.04/24.04), Docker Compose v2, nginx, certbot, Cursor CLI installer, git

## Global Constraints

- Install root: `/opt/newsdigest`
- Must run as root (`EUID=0`)
- Ubuntu 22.04/24.04 only (v1); hard-fail otherwise
- Repo URL: `https://github.com/rborisov/newsdigest.git`
- Host Cursor CLI (not baked into Docker image)
- Updates: prompt `Reconfigure domain/secrets/OAuth/Cursor key? [y/N]` (default N)
- `git pull --ff-only` on update (fail loudly; never force-reset)
- Do not destroy Docker volume `digest-data`
- Spec: `docs/superpowers/specs/2026-07-28-vps-install-script-design.md`

## File map

| File | Responsibility |
|------|----------------|
| `install.sh` | Entire installer/updater (create) |
| `docker-compose.override.example.yml` | Documented override template (create; script also writes live override) |
| `README.md` | Add VPS curl one-liner section (modify) |
| `/opt/newsdigest/.env` | Runtime secrets (written on target host only) |
| `/opt/newsdigest/docker-compose.override.yml` | Live Host CLI mounts (written on target host) |
| `/opt/newsdigest/.installed` | Marker file (written on target host) |
| `/etc/nginx/sites-available/newsdigest` | Reverse proxy (written on target host) |
| `/root/.cursor/mcp.json` | MCP for host agent (written on target host) |

---

### Task 1: install.sh core — detect mode, packages, clone/pull, prompts, .env

**Files:**
- Create: `install.sh`
- Create: `docker-compose.override.example.yml` (stub header only OK; filled in Task 2)

**Interfaces:**
- Produces: `require_root`, `require_ubuntu`, `is_installed`, `install_packages`, `ensure_repo`, `prompt_config`, `write_env`, `INSTALL_ROOT=/opt/newsdigest`, `REPO_URL`, globals `DOMAIN`, `LE_EMAIL`, `ALLOWED_EMAILS`, OAuth vars, `CURSOR_API_KEY`, `TELEGRAPH_ACCESS_TOKEN`, `NEXTAUTH_SECRET`, `INTERNAL_API_KEY`, `RECONFIGURE`

- [ ] **Step 1: Create `install.sh` skeleton with helpers**

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT=/opt/newsdigest
REPO_URL=https://github.com/rborisov/newsdigest.git
MARKER="${INSTALL_ROOT}/.installed"
COMPOSE_OVERRIDE="${INSTALL_ROOT}/docker-compose.override.yml"
NGINX_SITE=/etc/nginx/sites-available/newsdigest
MCP_JSON=/root/.cursor/mcp.json

log()  { printf '==> %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "Run as root (sudo -i, then re-run)."
}

require_ubuntu() {
  [[ -f /etc/os-release ]] || die "Cannot detect OS."
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ "${ID:-}" == "ubuntu" ]] || die "Ubuntu 22.04/24.04 required (got ID=${ID:-unknown})."
  case "${VERSION_ID:-}" in
    22.04|24.04) ;;
    *) die "Ubuntu 22.04/24.04 required (got ${VERSION_ID:-unknown})." ;;
  esac
}

is_installed() {
  [[ -f "${MARKER}" && -f "${INSTALL_ROOT}/docker-compose.yml" ]]
}

prompt() {
  # usage: prompt VAR "Question" ["default"]
  local __var="$1" __q="$2" __d="${3:-}" __ans
  if [[ -n "${__d}" ]]; then
    read -r -p "${__q} [${__d}]: " __ans || true
    __ans="${__ans:-${__d}}"
  else
    read -r -p "${__q}: " __ans || true
  fi
  printf -v "${__var}" '%s' "${__ans}"
}

prompt_secret() {
  local __var="$1" __q="$2" __d="${3:-}" __ans
  if [[ -n "${__d}" ]]; then
    read -r -s -p "${__q} [keep existing if blank]: " __ans || true
    echo
    __ans="${__ans:-${__d}}"
  else
    read -r -s -p "${__q}: " __ans || true
    echo
  fi
  printf -v "${__var}" '%s' "${__ans}"
}

gen_secret() {
  openssl rand -hex 32
}
```

- [ ] **Step 2: Implement `install_packages`**

Install via apt if missing: `ca-certificates`, `curl`, `git`, `nginx`, `certbot`, `python3-certbot-nginx`. Install Docker Engine + Compose plugin using Docker’s official Ubuntu apt repo (not obsolete `docker.io` alone if Compose plugin missing). Enable/start `docker` and `nginx`. Verify `docker compose version` works.

- [ ] **Step 3: Implement `ensure_repo`**

```bash
ensure_repo() {
  if [[ ! -d "${INSTALL_ROOT}/.git" ]]; then
    mkdir -p "$(dirname "${INSTALL_ROOT}")"
    if [[ -d "${INSTALL_ROOT}" ]] && [[ -n "$(ls -A "${INSTALL_ROOT}" 2>/dev/null || true)" ]]; then
      die "${INSTALL_ROOT} exists but is not a git checkout. Move it aside and re-run."
    fi
    git clone "${REPO_URL}" "${INSTALL_ROOT}"
  else
    git -C "${INSTALL_ROOT}" pull --ff-only
  fi
}
```

- [ ] **Step 4: Implement `load_env_defaults` + `prompt_config` + `write_env`**

On reconfigure or first install, prompt for:

- `DOMAIN`
- `LE_EMAIL`
- `ALLOWED_EMAILS`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (optional)
- `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` (optional)
- Require at least one full OAuth pair
- `CURSOR_API_KEY` (required, non-empty)
- `TELEGRAPH_ACCESS_TOKEN` (optional)

Auto-set:

- `NEXTAUTH_URL=https://${DOMAIN}`
- `NEXTAUTH_SECRET` / `INTERNAL_API_KEY` — generate with `openssl rand -hex 32` if empty; on reconfigure keep existing unless user enters new values

`write_env` writes `${INSTALL_ROOT}/.env` from a heredoc. Keep `DATABASE_URL=file:./dev.db` in file (Compose overrides for containers).

When update + reconfigure=N: skip prompts; do not rewrite `.env`.

- [ ] **Step 5: Wire `main` first half**

```bash
main() {
  require_root
  require_ubuntu
  install_packages

  local mode=install
  if is_installed; then
    mode=update
    log "Existing install detected at ${INSTALL_ROOT}"
    prompt RECONFIGURE_ANS "Reconfigure domain/secrets/OAuth/Cursor key? [y/N]" "N"
    case "${RECONFIGURE_ANS}" in
      y|Y|yes|YES) RECONFIGURE=1 ;;
      *) RECONFIGURE=0 ;;
    esac
  else
    RECONFIGURE=1
  fi

  ensure_repo

  if [[ "${RECONFIGURE}" -eq 1 ]]; then
    load_env_defaults   # read existing .env into defaults if present
    prompt_config
    write_env
  fi

  # Task 2 continues: CLI, MCP, override, compose, nginx, certbot, marker
}

main "$@"
```

- [ ] **Step 6: Syntax-check**

Run: `bash -n install.sh`  
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add install.sh docker-compose.override.example.yml
git commit -m "Add install.sh core: packages, clone/pull, and env prompts."
```

---

### Task 2: Cursor CLI, MCP, Compose override, nginx, certbot, update finish, README

**Files:**
- Modify: `install.sh`
- Modify: `docker-compose.override.example.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 helpers + env globals + `RECONFIGURE` / `mode`
- Produces: `install_cursor_cli`, `write_mcp_json`, `write_compose_override`, `compose_up`, `configure_nginx`, `obtain_certificate`, `finish_marker`, complete `main`

- [ ] **Step 1: Implement `install_cursor_cli`**

```bash
install_cursor_cli() {
  log "Installing/updating Cursor CLI"
  curl -fsS https://cursor.com/install | bash
  # Official installer puts agent under ~/.local/bin for the current user (root → /root/.local/bin)
  local agent_src=""
  if [[ -x /root/.local/bin/agent ]]; then
    agent_src=/root/.local/bin/agent
  elif command -v agent >/dev/null 2>&1; then
    agent_src="$(command -v agent)"
  else
    die "Cursor CLI installed but 'agent' not found on PATH."
  fi
  ln -sfn "${agent_src}" /usr/local/bin/agent
  # Prefer update when available
  if /usr/local/bin/agent update >/dev/null 2>&1; then
    log "Cursor CLI updated"
  fi
  /usr/local/bin/agent --version || die "agent --version failed"
}
```

Note: official installer is per-user under `$HOME`. Running as root is intentional per spec (`/root/.cursor/mcp.json`).

- [ ] **Step 2: Implement `write_mcp_json`**

Write `/root/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "news-digest": {
      "command": "npx",
      "args": ["tsx", "/opt/newsdigest/apps/mcp-server/src/index.ts"],
      "env": {
        "PORTAL_URL": "http://127.0.0.1:3000",
        "INTERNAL_API_KEY": "<from .env>"
      }
    }
  }
}
```

Read `INTERNAL_API_KEY` from `${INSTALL_ROOT}/.env` when not reconfiguring. Ensure `npx`/`tsx` work: either install Node 22 on host for MCP spawned by host agent, **or** document that agent needs node — **required:** install Node 22 via NodeSource or Ubuntu node if missing so `npx tsx` works for MCP.

Add to `install_packages` (or this function): ensure Node.js 22+ is on the host for MCP stdio.

- [ ] **Step 3: Implement `write_compose_override`**

Write `${INSTALL_ROOT}/docker-compose.override.yml`:

```yaml
# managed-by: newsdigest-install
services:
  web:
    volumes:
      - /usr/local/bin/agent:/usr/local/bin/agent:ro
      - /root/.local/share/cursor-agent:/root/.local/share/cursor-agent:ro
      - /root/.cursor:/root/.cursor:ro
      - ./apps/mcp-server:/app/mcp-server:ro
    environment:
      CURSOR_CLI_PATH: /usr/local/bin/agent
```

Also write the same content (minus secrets) to `docker-compose.override.example.yml` in the repo for documentation.

Important: the Next.js container runs as user `nextjs` (uid 1001). Host CLI mount as root-owned binary is usually world-executable; MCP config under `/root/.cursor` may be unreadable by `nextjs`. **Resolve in implementation:** either

1. Run agent via a wrapper and place MCP config at `/opt/newsdigest/mcp.json` mounted to a path readable by `nextjs` (e.g. `/app/mcp.json`), and set whatever env Cursor CLI uses for MCP config path if documented; **or**
2. Keep MCP on host and have `spawnAgent` use host networking / docker.sock — out of scope.

**Preferred resolution (lock in):** write MCP config to `/opt/newsdigest/mcp.json` (mode `0644`), mount it read-only into the container at `/home/nextjs/.cursor/mcp.json` (create parent in override or entrypoint). Also mount cursor-agent share to a path the binary resolves (follow where `/usr/local/bin/agent` symlink points — may need mounting `/root/.local` → readable path). If the agent binary hard-codes `$HOME/.local/share/cursor-agent`, set container `HOME=/home/nextjs` and mount agent files there:

```yaml
services:
  web:
    environment:
      CURSOR_CLI_PATH: /usr/local/bin/agent
      HOME: /home/nextjs
      CURSOR_API_KEY: ${CURSOR_API_KEY}
    volumes:
      - /usr/local/bin/agent:/usr/local/bin/agent:ro
      - /root/.local/share/cursor-agent:/home/nextjs/.local/share/cursor-agent:ro
      - /opt/newsdigest/mcp.json:/home/nextjs/.cursor/mcp.json:ro
      - ./apps/mcp-server:/opt/newsdigest/apps/mcp-server:ro
```

And point MCP args at `/opt/newsdigest/apps/mcp-server/src/index.ts` **inside the container** (same mount). Host-side `/opt/newsdigest/mcp.json` uses container paths for the tool args so the agent inside `web` can exec them — **MCP runs inside the container with the agent.** Therefore host Node is **not** required if `npx`/`tsx` exist in the image.

**Lock-in:** MCP executes inside `web` with the spawned agent. Ensure `tsx` is available in the runner image (already has global `tsx`). MCP command should be:

```json
"command": "npx",
"args": ["tsx", "/opt/newsdigest/apps/mcp-server/src/index.ts"],
```

with that path mounted. Prefer `"command": "tsx"` if on PATH in image (`tsx` is installed globally in Dockerfile). Use:

```json
"command": "tsx",
"args": ["/opt/newsdigest/apps/mcp-server/src/index.ts"],
"env": {
  "PORTAL_URL": "http://127.0.0.1:3000",
  "INTERNAL_API_KEY": "..."
}
```

Do **not** require host Node.js for v1.

- [ ] **Step 4: Implement `compose_up`**

```bash
compose_up() {
  log "Building and starting Docker Compose stack"
  cd "${INSTALL_ROOT}"
  docker compose up -d --build
}
```

- [ ] **Step 5: Implement `configure_nginx` + `obtain_certificate`**

nginx site (mark with `# managed-by: newsdigest-install`):

```nginx
# managed-by: newsdigest-install
server {
  listen 80;
  listen [::]:80;
  server_name DOMAIN_PLACEHOLDER;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Enable site, `nginx -t`, reload. On first install or domain change during reconfigure:

```bash
certbot --nginx -d "${DOMAIN}" --email "${LE_EMAIL}" --agree-tos --non-interactive --redirect
```

On update without domain change: skip certbot.

Track previous domain in `${INSTALL_ROOT}/.install-domain` to detect domain changes.

- [ ] **Step 6: Complete `main`, write marker, print summary**

```bash
  install_cursor_cli
  # load INTERNAL_API_KEY from .env if needed
  write_mcp_json
  write_compose_override
  compose_up
  if [[ "${RECONFIGURE}" -eq 1 ]] || [[ ! -f "${NGINX_SITE}" ]]; then
    configure_nginx
  fi
  if [[ "${RECONFIGURE}" -eq 1 ]] || [[ ! -f "${INSTALL_ROOT}/.install-domain" ]] || \
     [[ "$(cat "${INSTALL_ROOT}/.install-domain")" != "${DOMAIN}" ]]; then
    # DOMAIN must be known: on non-reconfigure update, read from .install-domain / .env
    obtain_certificate
    printf '%s\n' "${DOMAIN}" > "${INSTALL_ROOT}/.install-domain"
  fi
  touch "${MARKER}"
  log "Done. Portal: https://${DOMAIN}"
  log "Re-run this script anytime to update."
```

On update with `RECONFIGURE=0`, read `DOMAIN` from `.install-domain` or parse `NEXTAUTH_URL` from `.env` for summary only; skip certbot/nginx rewrite.

- [ ] **Step 7: README section**

Add near top or after Docker section:

```markdown
## VPS install (Ubuntu)

As root:

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/rborisov/newsdigest/main/install.sh | bash
\`\`\`

Installs Docker, nginx, Let's Encrypt, Cursor CLI (host), clones to \`/opt/newsdigest\`, and starts Compose.
Re-run the same command (or \`/opt/newsdigest/install.sh\`) to update; you will be asked whether to reconfigure secrets (default no).
```

- [ ] **Step 8: Verify locally**

Run:

```bash
bash -n install.sh
command -v shellcheck >/dev/null && shellcheck -x install.sh || true
```

Expected: `bash -n` OK; shellcheck clean or only minor warnings fixed.

- [ ] **Step 9: Commit**

```bash
git add install.sh docker-compose.override.example.yml README.md
git commit -m "Complete VPS install.sh with nginx, certs, and host Cursor CLI."
```

- [ ] **Step 10: Push** (only if user asked or finishing; default push with install feature)

```bash
git push origin main
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| curl\|bash entry, root, Ubuntu, `/opt/newsdigest` | 1 |
| Docker, nginx, certbot packages | 1 |
| Clone + interactive prompts + `.env` | 1 |
| Update reconfigure prompt default N | 1 |
| `git pull --ff-only` | 1 |
| Host Cursor CLI + symlink | 2 |
| MCP config + compose override mounts | 2 |
| `docker compose up -d --build` | 2 |
| nginx + certbot HTTPS | 2 |
| `.installed` marker + domain tracking | 2 |
| README VPS section | 2 |
| No volume wipe | 2 (never remove volume) |

## Self-review notes

- MCP runs **inside** `web` with the agent (container paths); host Node not required — corrected vs early draft that assumed host `npx`.
- Agent share mount uses `/home/nextjs/...` because image `USER nextjs`.
- Placeholder scan: none intentionally left; implementers must substitute DOMAIN in nginx via `sed` or envsubst, not leave `DOMAIN_PLACEHOLDER` in the live file.
