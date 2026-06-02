#!/usr/bin/env bash
# Production deploy script (Linux/macOS).
# Pulls the latest images from GHCR and restarts the stack.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_ARGS=(--env-file .env.production -f docker-compose.prod.yml)

echo "[deploy] Pulling latest images…"
docker compose "${COMPOSE_ARGS[@]}" pull

echo "[deploy] Restarting stack…"
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans

echo "[deploy] Done."
