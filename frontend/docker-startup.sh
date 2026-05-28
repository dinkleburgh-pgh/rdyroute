#!/bin/sh
# ReadyRoute V2 — frontend container startup script.
# Resolves host address, waits for the backend, then launches nginx.

# ---------------------------------------------------------------------------
# ANSI colour helpers (printf-safe; works in busybox sh)
# ---------------------------------------------------------------------------
C_RESET=$(printf '\033[0m')
C_BOLD=$(printf '\033[1m')
C_DIM=$(printf '\033[2m')
C_CYAN=$(printf '\033[36m')
C_GREEN=$(printf '\033[32m')
C_YELLOW=$(printf '\033[33m')
C_RED=$(printf '\033[31m')
C_BLUE=$(printf '\033[34m')

ok()   { printf "  ${C_GREEN}✓${C_RESET}  %s\n" "$*"; }
warn() { printf "  ${C_YELLOW}⚠${C_RESET}  %s\n" "$*"; }
info() { printf "  ${C_BLUE}→${C_RESET}  %s\n" "$*"; }
err()  { printf "  ${C_RED}✗${C_RESET}  %s\n" "$*"; }
step() { printf "\n  ${C_BOLD}${C_CYAN}[ %s ]${C_RESET}  %s\n" "$1" "$2"; }
div()  { printf "  ${C_DIM}─────────────────────────────────────────────${C_RESET}\n"; }

BACKEND_URL="${BACKEND_HEALTH_URL:-http://backend:8000/health}"
MAX_WAIT="${BACKEND_WAIT_SECONDS:-90}"
HOST_PORT="${HOST_PORT:-5180}"

# ---------------------------------------------------------------------------
# Read build metadata (written by Dockerfile at image build time)
# ---------------------------------------------------------------------------
BUILD_INFO_FILE="/usr/share/nginx/html/build-info.json"
BUILD_VERSION=""; BUILD_COMMIT=""; BUILD_DATE_RAW=""
if [ -f "$BUILD_INFO_FILE" ]; then
  BUILD_VERSION=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$BUILD_INFO_FILE")
  BUILD_COMMIT=$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' "$BUILD_INFO_FILE")
  BUILD_DATE_RAW=$(sed -n 's/.*"date":"\([^"]*\)".*/\1/p' "$BUILD_INFO_FILE")
fi
BUILD_LABEL="v${BUILD_VERSION:-?}  ${BUILD_COMMIT:-unknown}  ${BUILD_DATE_RAW:-}"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
printf "\n"
printf "  ${C_CYAN}${C_BOLD}╔═══════════════════════════════════════════════╗${C_RESET}\n"
printf "  ${C_CYAN}${C_BOLD}║       ReadyRoute V2  —  Starting up  …       ║${C_RESET}\n"
printf "  ${C_CYAN}${C_BOLD}╚═══════════════════════════════════════════════╝${C_RESET}\n"

# ---------------------------------------------------------------------------
# Step 1 — Resolve host address
# ---------------------------------------------------------------------------
step "1/3" "Resolving host address"
div

CONTAINER_IP=$(hostname -i 2>/dev/null | awk '{print $1}')
info "Container IP  : ${CONTAINER_IP}"

DETECTED_IP=""

# Method 1: host.docker.internal — set by Docker Desktop (Windows / macOS)
DETECTED_IP=$(nslookup host.docker.internal 2>/dev/null \
  | awk '/^Address:/ && !/#53/ && !/:53$/ { ip=$2; } END { print ip }' \
  | cut -d: -f1)

if [ -n "$DETECTED_IP" ]; then
  ok "Host IP (via host.docker.internal) : ${DETECTED_IP}"
else
  # Method 2: default-route gateway (Linux Docker bridge)
  DETECTED_IP=$(ip route show default 2>/dev/null \
    | awk '/default via/ { print $3; exit }')
  if [ -n "$DETECTED_IP" ]; then
    ok "Host IP (via gateway)  : ${DETECTED_IP}"
  fi
fi

# Method 3: explicit override wins above all
if [ -n "$HOST_IP" ]; then
  DETECTED_IP="$HOST_IP"
  ok "Host IP (HOST_IP env)  : ${DETECTED_IP}"
fi

if [ -z "$DETECTED_IP" ]; then
  warn "Could not auto-detect host IP — set HOST_IP in your .env to fix this"
  DETECTED_IP="<host-ip>"
fi

# ---------------------------------------------------------------------------
# Step 2 — Wait for backend
# ---------------------------------------------------------------------------
step "2/3" "Connecting to backend"
div
info "Health endpoint : ${BACKEND_URL}"
printf "  ${C_DIM}Polling"

elapsed=0
while true; do
  if wget -qO- "$BACKEND_URL" > /dev/null 2>&1; then
    printf "${C_RESET}\n"
    ok "Backend is healthy  (${elapsed}s)"
    break
  fi
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    printf "${C_RESET}\n"
    warn "No response after ${MAX_WAIT}s — starting nginx anyway"
    break
  fi
  printf "${C_DIM}.${C_RESET}"
  sleep 3
  elapsed=$((elapsed + 3))
done

# ---------------------------------------------------------------------------
# Step 3 — Start nginx
# ---------------------------------------------------------------------------
step "3/3" "Starting nginx"
div
ok "Static assets   : /usr/share/nginx/html"
ok "API proxy       : /api  →  http://backend:8000"
ok "WebSocket proxy : /ws   →  ws://backend:8000/ws"

# ---------------------------------------------------------------------------
# Ready banner
# ---------------------------------------------------------------------------
if [ -n "$PUBLIC_URL" ]; then
  DISPLAY_URL="$PUBLIC_URL"
else
  DISPLAY_URL="http://${DETECTED_IP}:${HOST_PORT}"
fi

printf "\n"
printf "  ${C_GREEN}${C_BOLD}╔═══════════════════════════════════════════════╗${C_RESET}\n"
printf "  ${C_GREEN}${C_BOLD}║        ReadyRoute V2  —  Ready  ✓            ║${C_RESET}\n"
printf "  ${C_GREEN}${C_BOLD}╠═══════════════════════════════════════════════╣${C_RESET}\n"
printf "  ${C_GREEN}${C_BOLD}║${C_RESET}  ${C_BOLD}%-44s${C_GREEN}${C_BOLD}║${C_RESET}\n" "Access URL   :  ${DISPLAY_URL}"
printf "  ${C_GREEN}${C_BOLD}║${C_RESET}  ${C_DIM}%-44s${C_GREEN}${C_BOLD}║${C_RESET}\n" "Container    :  http://${CONTAINER_IP}:80"
printf "  ${C_GREEN}${C_BOLD}║${C_RESET}  ${C_DIM}%-44s${C_GREEN}${C_BOLD}║${C_RESET}\n" "Build        :  ${BUILD_LABEL}"
printf "  ${C_GREEN}${C_BOLD}╚═══════════════════════════════════════════════╝${C_RESET}\n"
printf "\n"

exec nginx -g "daemon off;"
