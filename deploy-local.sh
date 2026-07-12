#!/usr/bin/env bash
# Fast on-box build + deploy for the rdyroute2 stack.
#
# Builds the images locally on the Docker host (TrueNAS) and recreates the stack
# in place — no GitHub Actions, no GHCR push/pull. Much faster for iteration.
#
# Workflow:
#   1. git push your changes from your dev machine
#   2. on the NAS:  ./deploy-local.sh        (or: ./deploy-local.sh --build-only)
#
# Requires a production.env in this directory (same vars as the Portainer stack,
# DATABASE_URL pointing at 192.168.1.132:5432). The running user must be in the
# docker group (no sudo needed).
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="rdyroute2"
COMPOSE=(docker compose -p "$PROJECT" --env-file production.env \
  -f docker-compose.prod.yml -f docker-compose.localbuild.yml)

BUILD_ONLY=0
[ "${1:-}" = "--build-only" ] && BUILD_ONLY=1

echo "[local-deploy] updating source…"
git pull --ff-only

SHA="$(git rev-parse --short HEAD)"
export GIT_SHA="$SHA"
export APP_VERSION="local.${SHA}"

echo "[local-deploy] building images locally (no GHCR) → ${APP_VERSION}…"
"${COMPOSE[@]}" build

if [ "$BUILD_ONLY" = "1" ]; then
  echo "[local-deploy] build-only: skipping recreate."
  exit 0
fi

echo "[local-deploy] recreating stack…"
"${COMPOSE[@]}" up -d --remove-orphans

echo "[local-deploy] done → ${APP_VERSION}"
docker ps --filter name=readyroutev2 --format '{{.Names}}\t{{.Status}}'

# ---------------------------------------------------------------------------
# Chain the off-site standby. Now that prod is up, tell the Oracle box to pull
# the same commit and rebuild its images so a failover serves current code. The
# key's forced command runs update.sh on the standby (build only — it never
# recreates a live failover's containers). Non-fatal: a standby hiccup must not
# fail an otherwise-good prod deploy. Skip with SKIP_STANDBY=1 for fast local
# iteration.
# ---------------------------------------------------------------------------
STANDBY_HOST="${STANDBY_HOST:-ubuntu@157.151.152.151}"
STANDBY_KEY="${STANDBY_KEY:-$HOME/.ssh/rdyroute_update}"
if [ -n "${SKIP_STANDBY:-}" ]; then
  echo "[local-deploy] SKIP_STANDBY set — leaving standby untouched"
elif [ ! -f "$STANDBY_KEY" ]; then
  echo "[local-deploy] WARNING: $STANDBY_KEY missing — standby NOT updated" >&2
else
  echo "[local-deploy] chaining standby update (${STANDBY_HOST})…"
  if timeout 600 ssh -i "$STANDBY_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$STANDBY_HOST" true; then
    echo "[local-deploy] standby update OK → in sync with ${APP_VERSION}"
  else
    echo "[local-deploy] WARNING: standby update FAILED (prod is deployed & fine)." >&2
    echo "[local-deploy]          retry: ssh -i $STANDBY_KEY $STANDBY_HOST true" >&2
  fi
fi

# ---------------------------------------------------------------------------
# Bust the PWA service worker at Cloudflare's edge so clients pick up this build
# immediately. The origin serves sw.js no-cache, but a copy already sitting at
# the edge would linger until its TTL — that's what makes deploys look "stuck"
# on an old version. Reads CF token+zone from the failover env already on the
# NAS (the token needs the "Cache Purge" permission). Non-fatal: a failed purge
# never fails the deploy; clients just lag until the edge TTL expires.
# Skip with SKIP_PURGE=1.
# ---------------------------------------------------------------------------
CF_ENV="${CF_ENV:-/mnt/coxmain/home/claude/rdyroute-failback.env}"
if [ -n "${SKIP_PURGE:-}" ]; then
  echo "[local-deploy] SKIP_PURGE set — leaving Cloudflare cache alone"
elif [ ! -f "$CF_ENV" ]; then
  echo "[local-deploy] no CF env ($CF_ENV) — skipping edge purge"
else
  CF_TOKEN=$(grep -E '^CF_API_TOKEN=' "$CF_ENV" | head -1 | cut -d= -f2-)
  CF_ZONE=$(grep -E '^CF_ZONE_ID=' "$CF_ENV" | head -1 | cut -d= -f2-)
  if [ -z "$CF_TOKEN" ] || [ -z "$CF_ZONE" ]; then
    echo "[local-deploy] CF token/zone not in $CF_ENV — skipping edge purge"
  else
    echo "[local-deploy] purging Cloudflare edge cache for the PWA worker…"
    resp=$(curl -s -m 15 -X POST \
      "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache" \
      -H "Authorization: Bearer ${CF_TOKEN}" -H "Content-Type: application/json" \
      -d '{"files":["https://rdyroute.app/sw.js","https://rdyroute.app/registerSW.js","https://rdyroute.app/index.html"]}')
    if printf '%s' "$resp" | grep -q '"success":true'; then
      echo "[local-deploy] Cloudflare purge OK (sw.js, registerSW.js, index.html)"
    else
      echo "[local-deploy] WARNING: Cloudflare purge failed — clients lag until edge TTL." >&2
      echo "[local-deploy]          token likely missing Zone:Cache Purge. Resp: $resp" >&2
    fi
  fi
fi
