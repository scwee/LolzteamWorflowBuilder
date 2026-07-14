#!/usr/bin/env bash
# =============================================================================
#  Lolzteam Workflow Builder — one-shot installer
#  Запуск:  sudo bash install.sh
#  Результат: сайт поднят в /opt/lzt-builder
# =============================================================================
set -euo pipefail

# >>> Укажите URL репозитория перед запуском <<<
REPO_URL="https://github.com/scwee/LolzteamWorflowBuilder.git"

INSTALL_DIR="/opt/lzt-builder"
BRANCH="main"
COMPOSE="docker compose"

# ── colors ──────────────────────────────────────────────────────────────────
R=$'\033[0m'
B=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GRN=$'\033[32m'
YEL=$'\033[33m'
CYN=$'\033[36m'
WHT=$'\033[97m'
G=$'\033[38;5;46m'     # bright green (brand)
GD=$'\033[38;5;34m'    # deep green
GY=$'\033[38;5;244m'   # gray

die()  { echo -e "${RED}✖${R} $*" >&2; exit 1; }
ok()   { echo -e "${GRN}✔${R} $*"; }
info() { echo -e "${CYN}›${R} $*"; }
warn() { echo -e "${YEL}!${R} $*"; }
step() { echo -e "\n${B}${G}[$1]${R} ${B}$2${R}"; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Запустите от root:  sudo bash install.sh"
  fi
}

banner() {
  clear 2>/dev/null || true
  # ASCII Lolzteam eye (. - = | _ # @) + brand text
  local EY=$'\033[38;5;46m'
  local rows=(
    "                                          ---------"
    "                                          |=======|"
    "                                 ---------===@#@===---"
    "                                 |===========#@#=====|"
    "                        ---------===#@#======@#@#@#==|"
    "                        |===========@#@======#@#@#@==|"
    "                        |==@#@======#@#@#@#@#@#@#@#===---"
    "                        |==#@#======@#@#@#@#@#@#@#@=====|"
    "               ---------===@#@===@#@#@#@#@#@#@#@#@#@#@==|"
    "               |===========#@#===#@#@#@#@#@#@#@#@#@#@#==|"
    "      ---------===#@#===#@#@#@#@#@#@#@#@#@#@#@#@#@#@#@==|"
    "      |===========@#@===@#@#@#@#@#@#@#@#@#@#@#@#@#@#@#==|"
    "   ---===@#@===@#@#@#===#@#@#@#@#@#@#@#@#@#@#@#@#@#=====|"
    "   |=====#@#===#@#@#@===@#@#@#@#@#@#@#@#@#@#@#@#@#@===___"
    "   |==#@#@#@===@#@#@#@#@#@#@#@#@#@#@#@#@#@#@#========|"
    "   |==@#@#@#===#@#@#@#@#@#@#@#@#@#@#@#@#@#@#@___=====|"
    "   |==#@#@#@#@#@#@#@#@#@#@#@#@#@#@#@#@#=====|   |====|"
    "   |==@#@#@#@#@#@#@#@#@#@#@#@#@#@#@#@#@=====|   |====|"
    "---===#@#@#@#@#@#@#@#@#@#@#@#@. . . . . . #@#@#@#@#===---"
    "|=====@#@#@#@#@#@#@#@#@#@#@#@# . . . . . .@#@#@#@#@=====|"
    "|==@#@#@#@#@#@#@#@#@#@#@. . . . .@#@. . . #@#@#@#@#@#@===---"
    "|==#@#@#@#@#@#@#@#@#@#@# . . . . #@# . . .@#@#@#@#@#@#=====|"
    "|==@#@#@#@#@#@#@#@. . . . . . #@#@#@. . . #@#@#@#@#@#@#@#==|"
    "|==#@#@#@#@#@#@#@# . . . . . .@#@#@# . . .@#@#@#@#@#@#@#@==|"
    "|==@#@#@#@#@======. .@#@. . . #@#@#@. . . #@#@#@#@#@#@=====|"
    "|==#@#@#@#@#===___ . #@# . . .@#@#@# . . .@#@#@#@#@#@#===___"
    "|==@#@========|   #@#@#@. . . . . . . .@#@#@#@#@#@#=====|"
    "|==#@#===______   @#@#@# . . . . . . . #@#@#@#@#@#@===___"
    "|=======|      ---#@#@#@#@#@#@#@#@#@#@#@#@#@#========|"
    "_________      |==@#@#@#@#@#@#@#@#@#@#@#@#@#@===______"
    "               |=======|   @#@#@#@#@#@#========|"
    "               _________   #@#@#@#@#@#@===______"
    "                        ---==============|"
    "                        __________________"
  )
  local row ch i=0
  local mid=17
  printf '\n'
  for row in "${rows[@]}"; do
    printf '  '
    while IFS= read -r -n1 ch; do
      [[ -z "$ch" ]] && continue
      case "$ch" in
        ' ') printf ' ' ;;
        *) printf '%s%s%s' "$EY" "$ch" "$R" ;;
      esac
    done <<<"$row"
    if [[ $i -eq $mid ]]; then printf '    %s%sLolzteam%s' "$WHT" "$B" "$R"; fi
    if [[ $i -eq $((mid+1)) ]]; then printf '    %sWorkflow Builder%s' "$DIM" "$R"; fi
    printf '\n'
    i=$((i+1))
  done
  printf '\n'
}







ask() {
  # ask "prompt" "default" → sets REPLY
  local prompt="$1" def="${2:-}" out
  if [[ -n "$def" ]]; then
    read -r -p "$(echo -e "${CYN}?${R} ${prompt} ${DIM}[${def}]${R}: ")" out || true
    REPLY="${out:-$def}"
  else
    while true; do
      read -r -p "$(echo -e "${CYN}?${R} ${prompt}: ")" out || true
      [[ -n "${out}" ]] && { REPLY="$out"; break; }
      warn "Значение обязательно"
    done
  fi
}

rand_hex() {
  local n="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$n"
  else
    head -c "$n" /dev/urandom | xxd -p | tr -d '\n' | head -c "$((n * 2))"
  fi
}

fernet_key() {
  # Fernet = urlsafe base64(32 random bytes). cryptography optional.
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
try:
    from cryptography.fernet import Fernet
    print(Fernet.generate_key().decode())
except Exception:
    import base64, os
    print(base64.urlsafe_b64encode(os.urandom(32)).decode())
PY
    return
  fi
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
}

detect_public_ip() {
  local ip
  ip="$(curl -4 -fsS --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  [[ -z "$ip" ]] && ip="$(curl -4 -fsS --max-time 4 https://api.ipify.org 2>/dev/null || true)"
  [[ -z "$ip" ]] && ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "${ip:-127.0.0.1}"
}

install_system_deps() {
  step "1/7" "Системные пакеты (git, curl, openssl…)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl ca-certificates openssl xxd python3 >/dev/null
  ok "базовые пакеты"
}

install_docker() {
  step "2/7" "Docker"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker уже установлен: $(docker --version | head -1)"
    return
  fi
  info "ставим Docker Engine + Compose plugin…"
  apt-get install -y -qq docker.io docker-compose-plugin >/dev/null || {
    # fallback: official get.docker.com
    curl -fsSL https://get.docker.com | sh
    apt-get install -y -qq docker-compose-plugin >/dev/null || true
  }
  systemctl enable --now docker
  docker compose version >/dev/null 2>&1 || die "docker compose недоступен после установки"
  ok "Docker готов"
}

clone_repo() {
  step "3/7" "Клон репозитория → ${INSTALL_DIR}"
  [[ "$REPO_URL" == *"YOUR_ORG"* || "$REPO_URL" == *"YOUR_REPO"* ]] && \
    die "Сначала задайте REPO_URL в начале install.sh"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    warn "каталог уже есть — обновляю ${BRANCH}"
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  ok "код в ${INSTALL_DIR}"
}

ask_config() {
  step "4/7" "Параметры установки"
  local public_ip
  public_ip="$(detect_public_ip)"

  echo -e "${DIM}Режимы доступа:${R}"
  echo -e "  ${B}1${R} — домен + HTTPS (Let's Encrypt)"
  echo -e "  ${B}2${R} — домен по HTTP (SSL потом)"
  echo -e "  ${B}3${R} — только IP + порт (без домена)"
  ask "Выберите режим" "3"
  MODE="$REPLY"

  DOMAIN=""
  HTTP_PORT=80
  HTTPS_PORT=443
  USE_SSL=0
  BASE_URL=""

  case "$MODE" in
    1)
      ask "Домен (A-запись уже на этот VPS)" ""
      DOMAIN="$REPLY"
      ask "Email для Let's Encrypt" "admin@${DOMAIN}"
      LE_EMAIL="$REPLY"
      USE_SSL=1
      BASE_URL="https://${DOMAIN}"
      ;;
    2)
      ask "Домен" ""
      DOMAIN="$REPLY"
      BASE_URL="http://${DOMAIN}"
      ;;
    3)
      ask "HTTP-порт" "3001"
      HTTP_PORT="$REPLY"
      HTTPS_PORT="$((HTTP_PORT + 343))"
      BASE_URL="http://${public_ip}:${HTTP_PORT}"
      ;;
    *) die "Неизвестный режим: $MODE" ;;
  esac

  SECRETS_KEY="$(fernet_key)"
  POSTGRES_PASSWORD="$(rand_hex 24)"

  ok "секреты сгенерированы"
}

write_env() {
  step "5/7" "Пишем .env и nginx"
  cd "$INSTALL_DIR"

  cat > .env <<EOF
ENVIRONMENT=production
POSTGRES_USER=lztbuilder
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=lztbuilder

SECRETS_ENCRYPTION_KEY=${SECRETS_KEY}

CORS_ORIGINS=${BASE_URL}
WEBHOOK_BASE_URL=${BASE_URL}
NEXT_PUBLIC_API_URL=

HTTP_PORT=${HTTP_PORT}
HTTPS_PORT=${HTTPS_PORT}

MAX_ACTIVE_FLOWS_PER_USER=50
MAX_RUNS_PER_HOUR=120
MAX_CONCURRENT_RUNS_PER_USER=3
MAX_FLOW_FILE_BYTES=5000000
EOF
  chmod 600 .env
  ok ".env (chmod 600)"

  if [[ "$USE_SSL" -eq 1 ]]; then
    # сначала HTTP, чтобы приложение поднялось; SSL — после certbot
    cp deploy/nginx.http.conf deploy/nginx.conf
  elif [[ -n "$DOMAIN" ]]; then
    cp deploy/nginx.http.conf deploy/nginx.conf
    # server_name _ уже принимает любой хост — ок
  else
    cp deploy/nginx.http.conf deploy/nginx.conf
  fi
  ok "nginx.conf"
}

build_and_up() {
  step "6/7" "Сборка и запуск контейнеров (это займёт несколько минут)"
  cd "$INSTALL_DIR"
  $COMPOSE build
  $COMPOSE up -d
  info "ждём health API…"
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null 2>&1; then
      ok "API healthy"
      return
    fi
    sleep 3
  done
  warn "health ещё не ответил — смотрите: docker compose -C ${INSTALL_DIR} logs api --tail=80"
}

setup_ssl() {
  [[ "$USE_SSL" -eq 1 ]] || return 0
  step "7/7" "Let's Encrypt → ${DOMAIN}"

  if ! command -v certbot >/dev/null 2>&1; then
    apt-get install -y -qq certbot >/dev/null
  fi

  cd "$INSTALL_DIR"
  $COMPOSE stop nginx
  certbot certonly --standalone \
    --non-interactive --agree-tos \
    -m "${LE_EMAIL}" \
    -d "${DOMAIN}" || {
      warn "certbot не удалось — оставляем HTTP. Повторите SSL позже."
      $COMPOSE up -d nginx
      return 0
    }

  cp deploy/nginx.conf deploy/nginx.conf.bak 2>/dev/null || true
  # берём HTTPS-шаблон из репо (если уже перезаписан http — восстановим из git)
  if git show HEAD:deploy/nginx.conf >/dev/null 2>&1; then
    git show HEAD:deploy/nginx.conf > deploy/nginx.conf
  fi
  sed -i "s/YOUR_DOMAIN/${DOMAIN}/g" deploy/nginx.conf
  $COMPOSE up -d nginx
  ok "HTTPS включён"
}

summary() {
  echo
  echo -e "${G}╔══════════════════════════════════════════════════════════╗${R}"
  echo -e "${G}║${R}  ${B}${WHT}Lolzteam Workflow Builder — готово${R}                     ${G}║${R}"
  echo -e "${G}╚══════════════════════════════════════════════════════════╝${R}"
  echo
  echo -e "  ${DIM}URL${R}           ${B}${BASE_URL}${R}"
  echo -e "  ${DIM}Каталог${R}       ${INSTALL_DIR}"
  echo
  echo -e "  ${DIM}Дальше:${R} откройте UI → Учётные данные → добавьте LZT-токен → создайте сценарий"
  echo
  echo -e "  ${YEL}${B}Секреты (сохраните):${R}"
  echo -e "  ${DIM}SECRETS_ENCRYPTION_KEY${R}    ${SECRETS_KEY}"
  echo -e "  ${DIM}POSTGRES_PASSWORD${R}         ${POSTGRES_PASSWORD}"
  echo
  echo -e "  ${DIM}Логи:${R}    cd ${INSTALL_DIR} && docker compose logs -f"
  echo -e "  ${DIM}Обновление:${R}  sudo bash ${INSTALL_DIR}/update.sh"
  echo
  if [[ "$MODE" == "3" ]]; then
    warn "Откройте порт ${HTTP_PORT} в firewall:  ufw allow ${HTTP_PORT}/tcp"
  fi
  if [[ "$USE_SSL" -eq 0 && -n "$DOMAIN" ]]; then
    info "SSL позже: остановите nginx → certbot → верните HTTPS nginx.conf"
  fi
  echo
}

main() {
  need_root
  banner
  [[ -n "${REPO_URL}" ]] || die "REPO_URL пуст"

  install_system_deps
  install_docker
  clone_repo
  ask_config
  write_env
  build_and_up
  setup_ssl
  summary
}

main "$@"
