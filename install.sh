#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT=/opt/newsdigest
REPO_URL=https://github.com/rborisov/newsdigest.git
MARKER="${INSTALL_ROOT}/.installed"
COMPOSE_OVERRIDE="${INSTALL_ROOT}/docker-compose.override.yml"
NGINX_SITE=/etc/nginx/sites-available/newsdigest
MCP_JSON=/root/.cursor/mcp.json

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

  systemctl enable --now docker
  systemctl enable --now nginx

  need_cmd docker
  docker compose version >/dev/null 2>&1 || die "docker compose version failed"
  log "docker compose: $(docker compose version)"
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
  fi

  # Task 2 continues: CLI, MCP, override, compose, nginx, certbot, marker
  log "Task 1 complete (mode=${mode}). Later steps are not yet wired (Task 2)."
}

main "$@"
