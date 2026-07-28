#!/usr/bin/env bash
# VPS installer — host Node.js + systemd (no Docker). Suitable for 1 GB RAM with swap.
set -euo pipefail

INSTALL_ROOT=/opt/newsdigest
REPO_URL=https://github.com/rborisov/newsdigest.git
MARKER="${INSTALL_ROOT}/.installed"
DATA_DIR="${INSTALL_ROOT}/data"
NGINX_SITE=/etc/nginx/sites-available/newsdigest
MCP_JSON="${INSTALL_ROOT}/mcp.json"
MCP_HOME_JSON=/root/.cursor/mcp.json
INSTALL_DOMAIN_FILE="${INSTALL_ROOT}/.install-domain"
WEB_UNIT=/etc/systemd/system/newsdigest-web.service
WORKER_UNIT=/etc/systemd/system/newsdigest-worker.service
SWAPFILE=/swapfile
SWAP_SIZE_GB=2

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
  [[ -f "${MARKER}" && -f "${INSTALL_ROOT}/package.json" && -f "${WEB_UNIT}" ]]
}

prompt() {
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

ensure_apt_packages() {
  local pkgs=("$@") missing=()
  local p
  for p in "${pkgs[@]}"; do
    if ! dpkg -s "${p}" >/dev/null 2>&1; then
      missing+=("${p}")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    log "Installing apt packages: ${missing[*]}"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
  fi
}

# 1 GB boxes need swap for `next build`; runtime fits in ~512–800 MB.
ensure_swap() {
  local mem_kb swap_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  swap_kb="$(awk '/SwapTotal:/ {print $2}' /proc/meminfo)"
  if [[ "${mem_kb}" -ge 1800000 ]]; then
    log "RAM ≥ ~1.8 GiB — swap not required for build"
    return 0
  fi
  if [[ "${swap_kb}" -ge 1000000 ]]; then
    log "Swap already present ($(awk '/SwapTotal:/ {printf "%.1f GiB", $2/1024/1024}' /proc/meminfo))"
    return 0
  fi
  log "Low RAM (${mem_kb} kB) — creating ${SWAP_SIZE_GB}G swap at ${SWAPFILE}"
  if [[ ! -f "${SWAPFILE}" ]]; then
    fallocate -l "${SWAP_SIZE_GB}G" "${SWAPFILE}" 2>/dev/null \
      || dd if=/dev/zero of="${SWAPFILE}" bs=1M count=$((SWAP_SIZE_GB * 1024)) status=none
    chmod 600 "${SWAPFILE}"
    mkswap "${SWAPFILE}" >/dev/null
  fi
  swapon "${SWAPFILE}" 2>/dev/null || true
  if ! grep -q "${SWAPFILE}" /etc/fstab 2>/dev/null; then
    echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
  fi
  swapon --show || true
}

install_node22() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
    if [[ "${major}" -ge 22 ]]; then
      log "Node.js $(node -v) already installed"
      return 0
    fi
    log "Node $(node -v) is too old; installing Node.js 22"
  else
    log "Installing Node.js 22"
  fi
  ensure_apt_packages ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  need_cmd node
  need_cmd npm
  log "Node.js $(node -v) / npm $(npm -v)"
}

install_packages() {
  log "Ensuring system packages (no Docker)"
  ensure_apt_packages ca-certificates curl git openssl nginx certbot python3-certbot-nginx build-essential python3
  ensure_swap
  install_node22
  systemctl enable --now nginx
  systemctl is-active --quiet nginx || die "nginx.service failed to start"
}

ensure_repo() {
  if [[ ! -d "${INSTALL_ROOT}/.git" ]]; then
    mkdir -p "$(dirname "${INSTALL_ROOT}")"
    if [[ -d "${INSTALL_ROOT}" ]] && [[ -n "$(ls -A "${INSTALL_ROOT}" 2>/dev/null || true)" ]]; then
      # Previous Docker install left a checkout — reuse if it is this repo.
      if [[ -f "${INSTALL_ROOT}/package.json" ]]; then
        log "${INSTALL_ROOT} exists; using existing tree (will git pull if .git present)"
        if [[ ! -d "${INSTALL_ROOT}/.git" ]]; then
          die "${INSTALL_ROOT} exists without .git. Move it aside and re-run."
        fi
      else
        die "${INSTALL_ROOT} exists but is not a newsdigest checkout. Move it aside and re-run."
      fi
    else
      log "Cloning ${REPO_URL} → ${INSTALL_ROOT}"
      git clone "${REPO_URL}" "${INSTALL_ROOT}"
    fi
  else
    log "Updating repo at ${INSTALL_ROOT} (git pull --ff-only)"
    git -C "${INSTALL_ROOT}" pull --ff-only
  fi
}

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
  mkdir -p "${DATA_DIR}"
  cat > "${env_file}" <<EOF
# managed-by: newsdigest-install (host / systemd — no Docker)
DOMAIN=${DOMAIN}
LE_EMAIL=${LE_EMAIL}

NEXTAUTH_URL=${NEXTAUTH_URL}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}

GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}

YANDEX_CLIENT_ID=${YANDEX_CLIENT_ID}
YANDEX_CLIENT_SECRET=${YANDEX_CLIENT_SECRET}

ALLOWED_EMAILS=${ALLOWED_EMAILS}

INTERNAL_API_KEY=${INTERNAL_API_KEY}

CURSOR_API_KEY=${CURSOR_API_KEY}
CURSOR_CLI_PATH=/usr/local/bin/agent

TELEGRAPH_ACCESS_TOKEN=${TELEGRAPH_ACCESS_TOKEN}

# Absolute SQLite path (host)
DATABASE_URL=file:${DATA_DIR}/digest.db

# Worker → portal
PORTAL_URL=http://127.0.0.1:3000
EOF
  chmod 600 "${env_file}"
}

install_cursor_cli() {
  log "Installing/updating Cursor CLI"
  curl -fsS https://cursor.com/install | bash
  local agent_src=""
  if [[ -x /root/.local/bin/agent ]]; then
    agent_src=/root/.local/bin/agent
  elif command -v agent >/dev/null 2>&1; then
    agent_src="$(command -v agent)"
  else
    die "Cursor CLI installed but 'agent' not found on PATH."
  fi
  ln -sfn "${agent_src}" /usr/local/bin/agent
  if /usr/local/bin/agent update >/dev/null 2>&1; then
    log "Cursor CLI updated"
  fi
  /usr/local/bin/agent --version || die "agent --version failed"
}

write_mcp_json() {
  log "Writing MCP config ${MCP_JSON} and ${MCP_HOME_JSON}"
  if [[ -z "${INTERNAL_API_KEY}" ]]; then
    load_env_defaults
  fi
  [[ -n "${INTERNAL_API_KEY}" ]] || die "INTERNAL_API_KEY is required for MCP config."

  local key_json tsx_bin
  key_json="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${INTERNAL_API_KEY}")"
  tsx_bin="${INSTALL_ROOT}/node_modules/.bin/tsx"
  [[ -x "${tsx_bin}" ]] || tsx_bin="npx"

  mkdir -p /root/.cursor
  cat > "${MCP_JSON}" <<EOF
{
  "mcpServers": {
    "news-digest": {
      "command": "${tsx_bin}",
      "args": ["${INSTALL_ROOT}/apps/mcp-server/src/index.ts"],
      "env": {
        "PORTAL_URL": "http://127.0.0.1:3000",
        "INTERNAL_API_KEY": ${key_json}
      }
    }
  }
}
EOF
  chmod 0644 "${MCP_JSON}"
  cp -f "${MCP_JSON}" "${MCP_HOME_JSON}"
  chmod 0644 "${MCP_HOME_JSON}"
}

write_systemd_units() {
  log "Writing systemd units"
  local standalone_dir="${INSTALL_ROOT}/apps/web/.next/standalone"
  cat > "${WEB_UNIT}" <<EOF
# managed-by: newsdigest-install
[Unit]
Description=News Digest portal (Next.js standalone)
After=network.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${standalone_dir}
EnvironmentFile=${INSTALL_ROOT}/.env
Environment=NODE_ENV=production
Environment=HOME=/root
Environment=HOSTNAME=0.0.0.0
Environment=PORT=3000
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node apps/web/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_OPTIONS=--max-old-space-size=512

[Install]
WantedBy=multi-user.target
EOF

  cat > "${WORKER_UNIT}" <<EOF
# managed-by: newsdigest-install
[Unit]
Description=News Digest scheduler worker
After=network.target newsdigest-web.service
Wants=newsdigest-web.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_ROOT}
EnvironmentFile=${INSTALL_ROOT}/.env
Environment=NODE_ENV=production
Environment=HOME=/root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/npm run start --workspace=worker
Restart=on-failure
RestartSec=5
Environment=NODE_OPTIONS=--max-old-space-size=256

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
}

prepare_standalone() {
  local web="${INSTALL_ROOT}/apps/web"
  local standalone="${web}/.next/standalone"
  [[ -f "${standalone}/apps/web/server.js" ]] || die "standalone server missing at ${standalone}/apps/web/server.js — build failed?"

  log "Preparing Next.js standalone static assets"
  mkdir -p "${standalone}/apps/web/.next"
  rm -rf "${standalone}/apps/web/.next/static"
  cp -a "${web}/.next/static" "${standalone}/apps/web/.next/static"
  rm -rf "${standalone}/apps/web/public"
  cp -a "${web}/public" "${standalone}/apps/web/public"
}

install_app() {
  log "Installing npm dependencies (can take several minutes on 1 GB + swap)…"
  cd "${INSTALL_ROOT}" || die "Cannot cd to ${INSTALL_ROOT}"
  mkdir -p "${DATA_DIR}"

  # Limit Node heap during install/build on small VPS
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"

  npm ci --no-audit --no-fund

  log "Generating Prisma client…"
  npx prisma generate --schema=apps/web/prisma/schema.prisma

  log "Building Next.js (slow on 1 GB — leave it running)…"
  npm run build --workspace=web
  prepare_standalone

  log "Applying database schema + seed…"
  npm run db:push --workspace=web
  npm run db:seed --workspace=web
}

start_services() {
  log "Starting systemd services"
  systemctl enable newsdigest-web newsdigest-worker
  systemctl restart newsdigest-web
  # Give web a moment before worker hits it
  sleep 3
  systemctl restart newsdigest-worker
  systemctl is-active --quiet newsdigest-web || die "newsdigest-web failed. Check: journalctl -u newsdigest-web -n 50 --no-pager"
  systemctl is-active --quiet newsdigest-worker || die "newsdigest-worker failed. Check: journalctl -u newsdigest-worker -n 50 --no-pager"
  log "Services active: newsdigest-web, newsdigest-worker"
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
  # Disable default site if it steals :80
  rm -f /etc/nginx/sites-enabled/default
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
  if [[ -f "${INSTALL_DOMAIN_FILE}" ]]; then
    DOMAIN="$(tr -d '[:space:]' < "${INSTALL_DOMAIN_FILE}")"
  fi
  if [[ -z "${DOMAIN}" ]]; then
    load_env_defaults
  fi
  [[ -n "${DOMAIN}" ]] || die "DOMAIN unknown; re-run with reconfigure or set NEXTAUTH_URL in .env."
}

stop_docker_stack_if_present() {
  # Migrating from earlier Docker-based installs
  if [[ -f "${INSTALL_ROOT}/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
    if docker compose -f "${INSTALL_ROOT}/docker-compose.yml" ps -q 2>/dev/null | grep -q .; then
      log "Stopping previous Docker Compose stack (host install replaces it)…"
      docker compose -f "${INSTALL_ROOT}/docker-compose.yml" down || true
    fi
  fi
}

finish_marker() {
  touch "${MARKER}"
  log "Done. Portal: https://${DOMAIN}"
  log "Logs: journalctl -u newsdigest-web -f"
  log "Re-run this script anytime to update."
}

main() {
  require_root
  require_ubuntu
  install_packages

  local mode=install
  if is_installed; then
    mode=update
    log "Existing host install detected at ${INSTALL_ROOT}"
    prompt RECONFIGURE_ANS "Reconfigure domain/secrets/OAuth/Cursor key? [y/N]" "N"
    case "${RECONFIGURE_ANS}" in
      y|Y|yes|YES) RECONFIGURE=1 ;;
      *) RECONFIGURE=0 ;;
    esac
  else
    RECONFIGURE=1
  fi

  ensure_repo
  stop_docker_stack_if_present

  if [[ "${RECONFIGURE}" -eq 1 ]]; then
    load_env_defaults
    prompt_config
    write_env
  else
    load_env_defaults
    resolve_domain_for_update
  fi

  install_cursor_cli
  install_app
  write_mcp_json
  write_systemd_units
  start_services

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
  log "Install finished (mode=${mode}, host/systemd)."
}

main "$@"
