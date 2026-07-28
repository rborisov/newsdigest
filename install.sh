#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT=/opt/newsdigest
REPO_URL=https://github.com/rborisov/newsdigest.git
MARKER="${INSTALL_ROOT}/.installed"
COMPOSE_OVERRIDE="${INSTALL_ROOT}/docker-compose.override.yml"
NGINX_SITE=/etc/nginx/sites-available/newsdigest
MCP_JSON="${INSTALL_ROOT}/mcp.json"
INSTALL_DOMAIN_FILE="${INSTALL_ROOT}/.install-domain"

DOMAIN=""
LE_EMAIL=""
ALLOWED_EMAILS=""
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
YANDEX_CLIENT_ID=""
YANDEX_CLIENT_SECRET=""
CURSOR_API_KEY=""
TELEGRAPH_ACCESS_TOKEN=""
NEXTAUTH_URL=""
NEXTAUTH_SECRET=""
INTERNAL_API_KEY=""
RECONFIGURE=0

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
  # Read from TTY so curl|bash still works (stdin is the script pipe).
  local __var="$1" __q="$2" __d="${3:-}" __ans
  if [[ -n "${__d}" ]]; then
    read -r -p "${__q} [${__d}]: " __ans </dev/tty || true
    __ans="${__ans:-${__d}}"
  else
    read -r -p "${__q}: " __ans </dev/tty || true
  fi
  printf -v "${__var}" '%s' "${__ans}"
}

prompt_secret() {
  local __var="$1" __q="$2" __d="${3:-}" __ans
  if [[ -n "${__d}" ]]; then
    read -r -s -p "${__q} [keep existing if blank]: " __ans </dev/tty || true
    echo
    __ans="${__ans:-${__d}}"
  else
    read -r -s -p "${__q}: " __ans </dev/tty || true
    echo
  fi
  printf -v "${__var}" '%s' "${__ans}"
}

gen_secret() {
  openssl rand -hex 32
}

pkg_installed() {
  dpkg -s "$1" >/dev/null 2>&1
}

ensure_apt_packages() {
  local pkgs=("$@")
  local missing=()
  local p
  for p in "${pkgs[@]}"; do
    if ! pkg_installed "${p}"; then
      missing+=("${p}")
    fi
  done
  if [[ "${#missing[@]}" -eq 0 ]]; then
    return 0
  fi
  log "Installing apt packages: ${missing[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
}

setup_docker_apt_repo() {
  # shellcheck source=/dev/null
  . /etc/os-release
  local arch
  arch="$(dpkg --print-architecture)"
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable
EOF
  apt-get update -qq
}

install_packages() {
  log "Ensuring system packages"
  ensure_apt_packages ca-certificates curl git openssl nginx certbot python3-certbot-nginx

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker Engine + Compose plugin already available"
  else
    log "Installing Docker Engine + Compose plugin (official apt repo)"
    # Remove distro/conflicting packages so docker-ce can install cleanly.
    DEBIAN_FRONTEND=noninteractive apt-get remove -y \
      docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc \
      >/dev/null 2>&1 || true
    setup_docker_apt_repo
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  ensure_docker_running
  systemctl enable --now nginx
  systemctl is-active --quiet nginx || die "nginx.service failed to start. Check: journalctl -xeu nginx.service"

  need_cmd docker
  docker compose version >/dev/null 2>&1 || die "docker compose version failed"
  log "docker compose: $(docker compose version)"
}

# Official docker-ce uses socket activation. Starting docker.service alone after a
# reinstall often fails with: "no sockets found via socket activation".
ensure_docker_running() {
  systemctl daemon-reload || true
  systemctl reset-failed docker.service docker.socket 2>/dev/null || true
  systemctl enable docker.socket docker.service >/dev/null 2>&1 || true
  systemctl stop docker.service 2>/dev/null || true
  systemctl start docker.socket || die "docker.socket failed to start. Check: journalctl -xeu docker.socket"
  systemctl start docker.service || die "docker.service failed to start. Check: journalctl -xeu docker.service"
  systemctl is-active --quiet docker || die "docker.service is not active after start."
}

ensure_repo() {
  if [[ ! -d "${INSTALL_ROOT}/.git" ]]; then
    mkdir -p "$(dirname "${INSTALL_ROOT}")"
    if [[ -d "${INSTALL_ROOT}" ]] && [[ -n "$(ls -A "${INSTALL_ROOT}" 2>/dev/null || true)" ]]; then
      die "${INSTALL_ROOT} exists but is not a git checkout. Move it aside and re-run."
    fi
    log "Cloning ${REPO_URL} → ${INSTALL_ROOT}"
    git clone "${REPO_URL}" "${INSTALL_ROOT}"
  else
    log "Updating repo at ${INSTALL_ROOT} (git pull --ff-only)"
    git -C "${INSTALL_ROOT}" pull --ff-only
  fi
}

# Parse KEY=VAL lines from .env into installer defaults. Do not source the file.
load_env_defaults() {
  local env_file="${INSTALL_ROOT}/.env"
  [[ -f "${env_file}" ]] || return 0

  local line key val
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ "${val}" =~ ^\"(.*)\"$ ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "${val}" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    case "${key}" in
      DOMAIN) DOMAIN="${val}" ;;
      LE_EMAIL) LE_EMAIL="${val}" ;;
      ALLOWED_EMAILS) ALLOWED_EMAILS="${val}" ;;
      GOOGLE_CLIENT_ID) GOOGLE_CLIENT_ID="${val}" ;;
      GOOGLE_CLIENT_SECRET) GOOGLE_CLIENT_SECRET="${val}" ;;
      YANDEX_CLIENT_ID) YANDEX_CLIENT_ID="${val}" ;;
      YANDEX_CLIENT_SECRET) YANDEX_CLIENT_SECRET="${val}" ;;
      CURSOR_API_KEY) CURSOR_API_KEY="${val}" ;;
      TELEGRAPH_ACCESS_TOKEN) TELEGRAPH_ACCESS_TOKEN="${val}" ;;
      NEXTAUTH_SECRET) NEXTAUTH_SECRET="${val}" ;;
      INTERNAL_API_KEY) INTERNAL_API_KEY="${val}" ;;
      NEXTAUTH_URL)
        NEXTAUTH_URL="${val}"
        if [[ -z "${DOMAIN}" ]]; then
          val="${val#https://}"
          val="${val#http://}"
          val="${val%%/*}"
          DOMAIN="${val}"
        fi
        ;;
    esac
  done < "${env_file}"
}

prompt_config() {
  prompt DOMAIN "Domain (FQDN)" "${DOMAIN}"
  [[ -n "${DOMAIN}" ]] || die "DOMAIN is required."

  prompt LE_EMAIL "Let's Encrypt email" "${LE_EMAIL}"
  [[ -n "${LE_EMAIL}" ]] || die "LE_EMAIL is required."

  prompt ALLOWED_EMAILS "Allowed admin emails (comma-separated)" "${ALLOWED_EMAILS}"
  [[ -n "${ALLOWED_EMAILS}" ]] || die "ALLOWED_EMAILS is required."

  prompt GOOGLE_CLIENT_ID "Google OAuth client ID (optional)" "${GOOGLE_CLIENT_ID}"
  prompt_secret GOOGLE_CLIENT_SECRET "Google OAuth client secret (optional)" "${GOOGLE_CLIENT_SECRET}"

  prompt YANDEX_CLIENT_ID "Yandex OAuth client ID (optional)" "${YANDEX_CLIENT_ID}"
  prompt_secret YANDEX_CLIENT_SECRET "Yandex OAuth client secret (optional)" "${YANDEX_CLIENT_SECRET}"

  local google_ok=0 yandex_ok=0
  if [[ -n "${GOOGLE_CLIENT_ID}" && -n "${GOOGLE_CLIENT_SECRET}" ]]; then
    google_ok=1
  fi
  if [[ -n "${YANDEX_CLIENT_ID}" && -n "${YANDEX_CLIENT_SECRET}" ]]; then
    yandex_ok=1
  fi
  if [[ "${google_ok}" -eq 0 && "${yandex_ok}" -eq 0 ]]; then
    die "Configure at least one full OAuth provider (Google or Yandex client id + secret)."
  fi

  prompt_secret CURSOR_API_KEY "Cursor API key" "${CURSOR_API_KEY}"
  [[ -n "${CURSOR_API_KEY}" ]] || die "CURSOR_API_KEY is required."

  prompt_secret TELEGRAPH_ACCESS_TOKEN "Telegra.ph access token (optional)" "${TELEGRAPH_ACCESS_TOKEN}"

  if [[ -z "${NEXTAUTH_SECRET}" ]]; then
    NEXTAUTH_SECRET="$(gen_secret)"
    log "Generated NEXTAUTH_SECRET"
  fi
  if [[ -z "${INTERNAL_API_KEY}" ]]; then
    INTERNAL_API_KEY="$(gen_secret)"
    log "Generated INTERNAL_API_KEY"
  fi

  NEXTAUTH_URL="https://${DOMAIN}"
}

write_env() {
  local env_file="${INSTALL_ROOT}/.env"
  log "Writing ${env_file}"
  cat > "${env_file}" <<EOF
# managed-by: newsdigest-install
DOMAIN=${DOMAIN}
LE_EMAIL=${LE_EMAIL}

# Auth.js / NextAuth
NEXTAUTH_URL=${NEXTAUTH_URL}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}

# Google OAuth
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}

# Yandex OAuth
YANDEX_CLIENT_ID=${YANDEX_CLIENT_ID}
YANDEX_CLIENT_SECRET=${YANDEX_CLIENT_SECRET}

# Comma-separated allowlist; seeded as admins
ALLOWED_EMAILS=${ALLOWED_EMAILS}

# Internal API key (worker + MCP → portal)
INTERNAL_API_KEY=${INTERNAL_API_KEY}

# Cursor CLI
CURSOR_API_KEY=${CURSOR_API_KEY}

# Telegra.ph (may also be stored in DB via admin)
TELEGRAPH_ACCESS_TOKEN=${TELEGRAPH_ACCESS_TOKEN}

# SQLite (Prisma) — Compose overrides for containers
DATABASE_URL=file:./dev.db
EOF
  chmod 600 "${env_file}"
}

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
  log "Verify agent works inside web on first VPS soak (docker compose exec web agent --version); Alpine/glibc ABI is unconfirmed."
}

write_mcp_json() {
  log "Writing MCP config ${MCP_JSON}"
  if [[ -z "${INTERNAL_API_KEY}" ]]; then
    load_env_defaults
  fi
  [[ -n "${INTERNAL_API_KEY}" ]] || die "INTERNAL_API_KEY is required for MCP config."

  local key_json
  key_json="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${INTERNAL_API_KEY}")"

  # MCP is baked into the web image at /app/mcp-server (see apps/web/Dockerfile).
  cat > "${MCP_JSON}" <<EOF
{
  "mcpServers": {
    "news-digest": {
      "command": "tsx",
      "args": ["/app/mcp-server/src/index.ts"],
      "env": {
        "PORTAL_URL": "http://127.0.0.1:3000",
        "INTERNAL_API_KEY": ${key_json}
      }
    }
  }
}
EOF
  chmod 0644 "${MCP_JSON}"
}

write_compose_override() {
  log "Writing ${COMPOSE_OVERRIDE}"
  # ${CURSOR_API_KEY} is left for Compose to interpolate from .env (quoted heredoc).
  # MCP lives inside the web image — do not bind-mount apps/mcp-server.
  cat > "${COMPOSE_OVERRIDE}" <<'EOF'
# managed-by: newsdigest-install
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
EOF
}

compose_up() {
  log "Building and starting Docker Compose stack"
  cd "${INSTALL_ROOT}" || die "Cannot cd to ${INSTALL_ROOT}"
  # Never remove digest-data or other volumes.
  # Small VPS: BuildKit + compose bake otherwise run web/worker/mcp npm in parallel and thrash RAM.
  export BUILDKIT_MAX_PARALLELISM=1
  export COMPOSE_PARALLEL_LIMIT=1
  log "Building web image (sequential; npm/next can take several minutes on 1–2 GB VPS)…"
  docker compose build web
  log "Building worker image…"
  docker compose build worker
  docker compose up -d
}

configure_nginx() {
  [[ -n "${DOMAIN}" ]] || die "DOMAIN is required for nginx."
  log "Configuring nginx site for ${DOMAIN}"
  cat > "${NGINX_SITE}" <<EOF
# managed-by: newsdigest-install
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF
  ln -sfn "${NGINX_SITE}" /etc/nginx/sites-enabled/newsdigest
  nginx -t || die "nginx -t failed"
  systemctl reload nginx
}

obtain_certificate() {
  [[ -n "${DOMAIN}" ]] || die "DOMAIN is required for certbot."
  if [[ -z "${LE_EMAIL}" ]]; then
    load_env_defaults
  fi
  [[ -n "${LE_EMAIL}" ]] || die "LE_EMAIL is required for certbot."
  log "Obtaining Let's Encrypt certificate for ${DOMAIN}"
  certbot --nginx -d "${DOMAIN}" --email "${LE_EMAIL}" --agree-tos --non-interactive --redirect
}

resolve_domain_for_update() {
  # On non-reconfigure update: prefer tracked domain, then .env / NEXTAUTH_URL.
  if [[ -f "${INSTALL_DOMAIN_FILE}" ]]; then
    DOMAIN="$(tr -d '[:space:]' < "${INSTALL_DOMAIN_FILE}")"
  fi
  if [[ -z "${DOMAIN}" ]]; then
    load_env_defaults
  fi
  [[ -n "${DOMAIN}" ]] || die "DOMAIN unknown; re-run with reconfigure or set NEXTAUTH_URL in .env."
}

finish_marker() {
  touch "${MARKER}"
  log "Done. Portal: https://${DOMAIN}"
  log "Re-run this script anytime to update."
}

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
    load_env_defaults
    prompt_config
    write_env
  else
    load_env_defaults
    resolve_domain_for_update
  fi

  install_cursor_cli
  write_mcp_json
  write_compose_override
  compose_up

  # Rewrite nginx / run certbot when site missing or domain changed.
  # Secret-only reconfigure (same domain, site present) must not clobber Let's Encrypt SSL.
  # Missing site alone still needs certbot even if .install-domain already matches DOMAIN.
  local prev_domain=""
  if [[ -f "${INSTALL_DOMAIN_FILE}" ]]; then
    prev_domain="$(tr -d '[:space:]' < "${INSTALL_DOMAIN_FILE}" || true)"
  fi

  local site_missing=0
  [[ -f "${NGINX_SITE}" ]] || site_missing=1
  local domain_changed=0
  if [[ -z "${prev_domain}" ]] || [[ "${prev_domain}" != "${DOMAIN}" ]]; then
    domain_changed=1
  fi

  if [[ "${site_missing}" -eq 1 ]] || [[ "${domain_changed}" -eq 1 ]]; then
    configure_nginx
  fi
  if [[ "${site_missing}" -eq 1 ]] || [[ "${domain_changed}" -eq 1 ]]; then
    obtain_certificate
    printf '%s\n' "${DOMAIN}" > "${INSTALL_DOMAIN_FILE}"
  fi

  finish_marker
  log "Install finished (mode=${mode})."
}

main "$@"
