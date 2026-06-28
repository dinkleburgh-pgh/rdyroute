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
