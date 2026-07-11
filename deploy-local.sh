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
