#!/bin/sh
set -eu

BACKEND_URL="${WATCHDOG_BACKEND_URL:-http://backend:8000/health}"
FRONTEND_URL="${WATCHDOG_FRONTEND_URL:-http://frontend}"
BACKEND_CONTAINER="${WATCHDOG_BACKEND_CONTAINER:-readyroutev2-backend}"
FRONTEND_CONTAINER="${WATCHDOG_FRONTEND_CONTAINER:-readyroutev2-frontend}"
INTERVAL_SECONDS="${WATCHDOG_INTERVAL_SECONDS:-20}"
FAILURE_THRESHOLD="${WATCHDOG_FAILURE_THRESHOLD:-3}"

backend_failures=0
frontend_failures=0

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

http_ok() {
  url="$1"
  if wget -q -T 8 -O /dev/null "$url"; then
    return 0
  fi
  return 1
}

restart_container() {
  container_name="$1"
  log "Restarting container: ${container_name}"
  # Docker API over the mounted Docker socket.
  wget -q -O /dev/null --post-data '' \
    --header 'Content-Type: application/json' \
    --unix-socket /var/run/docker.sock \
    "http://localhost/containers/${container_name}/restart"
}

log "Docker watchdog started. Backend=${BACKEND_URL} Frontend=${FRONTEND_URL}"

while true; do
  if http_ok "$BACKEND_URL"; then
    backend_failures=0
  else
    backend_failures=$((backend_failures + 1))
    log "Backend health check failed (${backend_failures}/${FAILURE_THRESHOLD})"
  fi

  if http_ok "$FRONTEND_URL"; then
    frontend_failures=0
  else
    frontend_failures=$((frontend_failures + 1))
    log "Frontend health check failed (${frontend_failures}/${FAILURE_THRESHOLD})"
  fi

  if [ "$backend_failures" -ge "$FAILURE_THRESHOLD" ]; then
    restart_container "$BACKEND_CONTAINER"
    backend_failures=0
  fi

  if [ "$frontend_failures" -ge "$FAILURE_THRESHOLD" ]; then
    restart_container "$FRONTEND_CONTAINER"
    frontend_failures=0
  fi

  sleep "$INTERVAL_SECONDS"
done
