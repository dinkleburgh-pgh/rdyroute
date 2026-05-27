#!/bin/sh
# ReadyRoute V2 — frontend startup script.
# Waits for the backend health endpoint, then prints connection info and starts nginx.

BACKEND_URL="${BACKEND_HEALTH_URL:-http://backend:8000/health}"
MAX_WAIT="${BACKEND_WAIT_SECONDS:-90}"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║        ReadyRoute V2  —  Starting up         ║"
echo "╚══════════════════════════════════════════════╝"
printf "  Backend health : %s\n" "$BACKEND_URL"
echo "  Waiting for backend..."

elapsed=0
while true; do
  if wget -qO- "$BACKEND_URL" > /dev/null 2>&1; then
    echo "  Backend         : OK  ✓"
    break
  fi
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "  Backend         : did not respond within ${MAX_WAIT}s — starting anyway"
    break
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done

CONTAINER_IP=$(hostname -i 2>/dev/null | awk '{print $1}')

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║           ReadyRoute V2  —  Ready            ║"
echo "╠══════════════════════════════════════════════╣"
printf "║  Container IP  :  %-27s║\n" "http://${CONTAINER_IP}:80"
if [ -n "$PUBLIC_URL" ]; then
  printf "║  Public URL    :  %-27s║\n" "$PUBLIC_URL"
else
  echo "║  Public URL    :  http://<host-ip>:<port>     ║"
  echo "║  (set PUBLIC_URL env var to customise)        ║"
fi
echo "╚══════════════════════════════════════════════╝"
echo ""

exec nginx -g "daemon off;"
