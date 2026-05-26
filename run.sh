#!/usr/bin/env bash
# ReadyRoute V2 launcher — Linux/macOS counterpart to run.ps1.
# Designed to be the default container entrypoint: self-heals the Python
# venv + npm deps, starts uvicorn (FastAPI) and vite (React), tracks PIDs
# and logs under .data/, and supports stop/restart/foreground modes.

set -u
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Config (env overrides supported)
# ---------------------------------------------------------------------------
VENV_DIR="${VENV_DIR:-.venv}"
LOG_DIR="${LOG_DIR:-.data}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_DIR="${FRONTEND_DIR:-$SCRIPT_DIR/frontend}"
RELOAD="${RELOAD:-1}"                  # uvicorn --reload toggle (1/0)
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"    # set 1 to skip vite startup
SKIP_PIP="${SKIP_PIP:-0}"              # set 1 to skip pip install step
SKIP_NPM="${SKIP_NPM:-0}"              # set 1 to skip npm install step
FOREGROUND="${FOREGROUND:-0}"          # set 1 (or pass --foreground) to exec uvicorn in fg

BACKEND_LOG="$LOG_DIR/backend.log"
BACKEND_PID="$LOG_DIR/backend.pid"
FRONTEND_LOG="$LOG_DIR/frontend.log"
FRONTEND_PID="$LOG_DIR/frontend.pid"

MODE="start"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info() { printf '[INFO] %s\n'  "$*"; }
warn() { printf '[WARN] %s\n'  "$*" >&2; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then "$@"
  elif have_cmd sudo;       then sudo "$@"
  else return 1
  fi
}

resolve_python_bin() {
  local c
  for c in python3 python; do
    if have_cmd "$c" && "$c" -c "import sys; raise SystemExit(0 if sys.version_info>=(3,10) else 1)" >/dev/null 2>&1; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}

auto_install_python_stack() {
  info "Python 3.10+ not found. Attempting self-heal install..."
  if   have_cmd apt-get; then run_privileged apt-get update && run_privileged apt-get install -y python3 python3-venv python3-pip
  elif have_cmd dnf;     then run_privileged dnf install -y python3 python3-pip python3-virtualenv
  elif have_cmd yum;     then run_privileged yum install -y python3 python3-pip
  elif have_cmd apk;     then run_privileged apk add --no-cache python3 py3-pip py3-virtualenv
  elif have_cmd zypper;  then run_privileged zypper --non-interactive install python3 python3-pip python3-virtualenv
  else return 1
  fi
}

auto_install_node_stack() {
  info "Node.js not found. Attempting self-heal install..."
  if   have_cmd apt-get; then run_privileged apt-get update && run_privileged apt-get install -y nodejs npm
  elif have_cmd dnf;     then run_privileged dnf install -y nodejs npm
  elif have_cmd yum;     then run_privileged yum install -y nodejs npm
  elif have_cmd apk;     then run_privileged apk add --no-cache nodejs npm
  elif have_cmd zypper;  then run_privileged zypper --non-interactive install nodejs npm
  else return 1
  fi
}

pid_running() {
  local pid="$1" match="${2:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  if [ -n "$match" ] && have_cmd ps; then
    ps -p "$pid" -o args= 2>/dev/null | grep -q "$match"
    return $?
  fi
  return 0
}

stop_tracked() {
  local label="$1" pid_file="$2"
  if [ -f "$pid_file" ]; then
    local pid; pid="$(cat "$pid_file" 2>/dev/null || true)"
    if pid_running "$pid"; then
      info "Stopping $label (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      # Give it a moment, then force
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" >/dev/null 2>&1 || break
        sleep 0.5
      done
      kill -0 "$pid" >/dev/null 2>&1 && kill -9 "$pid" 2>/dev/null || true
    else
      info "$label not running."
    fi
    rm -f "$pid_file"
  else
    info "$label not running."
  fi
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    stop|--stop)             MODE="stop" ;;
    restart|--restart)       MODE="restart" ;;
    status|--status)         MODE="status" ;;
    foreground|--foreground|-f) FOREGROUND=1 ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [start|stop|restart|status] [--foreground]

Environment overrides:
  BACKEND_HOST   (default $BACKEND_HOST)
  BACKEND_PORT   (default $BACKEND_PORT)
  FRONTEND_HOST  (default $FRONTEND_HOST)
  FRONTEND_PORT  (default $FRONTEND_PORT)
  VENV_DIR       (default $VENV_DIR)
  LOG_DIR        (default $LOG_DIR)
  RELOAD         1/0 — uvicorn --reload (default 1)
  SKIP_FRONTEND  1/0 — skip vite (default 0)
  SKIP_PIP       1/0 — skip pip install (default 0)
  SKIP_NPM       1/0 — skip npm install (default 0)
  FOREGROUND     1/0 — exec uvicorn in foreground (good for Docker)
EOF
      exit 0
      ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Status / stop modes
# ---------------------------------------------------------------------------
if [ "$MODE" = "status" ]; then
  for pair in "Backend:$BACKEND_PID" "Frontend:$FRONTEND_PID"; do
    label="${pair%%:*}"; pf="${pair##*:}"
    if [ -f "$pf" ] && pid_running "$(cat "$pf")"; then
      info "$label running (PID $(cat "$pf"))"
    else
      info "$label not running"
    fi
  done
  exit 0
fi

if [ "$MODE" = "stop" ] || [ "$MODE" = "restart" ]; then
  stop_tracked "Backend (uvicorn)" "$BACKEND_PID"
  stop_tracked "Frontend (vite)"   "$FRONTEND_PID"
  [ "$MODE" = "stop" ] && exit 0
fi

# ---------------------------------------------------------------------------
# Python venv + deps
# ---------------------------------------------------------------------------
if ! PYTHON_BIN="$(resolve_python_bin)"; then
  if ! auto_install_python_stack; then
    err "Python 3.10+ not available and auto-install failed. Install Python manually and retry."
    exit 1
  fi
  PYTHON_BIN="$(resolve_python_bin)" || { err "Python still unavailable after install."; exit 1; }
fi
info "Using $("$PYTHON_BIN" --version 2>&1)"

if [ ! -d "$VENV_DIR" ] || [ ! -x "$VENV_DIR/bin/python" ]; then
  info "Creating virtual environment in '$VENV_DIR'..."
  "$PYTHON_BIN" -m venv "$VENV_DIR" || {
    warn "venv creation failed; trying to install venv tooling..."
    if have_cmd apt-get; then run_privileged apt-get update && run_privileged apt-get install -y python3-venv || true; fi
    "$PYTHON_BIN" -m venv --clear "$VENV_DIR"
  }
fi

VENV_PY="$VENV_DIR/bin/python"
[ -x "$VENV_PY" ] || { err "venv python missing at '$VENV_PY'"; exit 1; }

if [ "$SKIP_PIP" != "1" ]; then
  info "Upgrading pip tooling..."
  "$VENV_PY" -m ensurepip --upgrade >/dev/null 2>&1 || true
  "$VENV_PY" -m pip install --upgrade pip setuptools wheel >/dev/null

  if [ -f requirements.txt ]; then
    info "Installing Python requirements..."
    "$VENV_PY" -m pip install --upgrade -r requirements.txt
  else
    warn "requirements.txt not found; installing fastapi/uvicorn only."
    "$VENV_PY" -m pip install --upgrade fastapi 'uvicorn[standard]'
  fi
fi

# ---------------------------------------------------------------------------
# Frontend deps (npm install) — only when not skipped
# ---------------------------------------------------------------------------
if [ "$SKIP_FRONTEND" != "1" ] && [ -d "$FRONTEND_DIR" ]; then
  if ! have_cmd npm; then
    auto_install_node_stack || warn "npm install failed; frontend startup will be skipped."
  fi
  if have_cmd npm && [ "$SKIP_NPM" != "1" ] && [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "Installing frontend npm dependencies..."
    ( cd "$FRONTEND_DIR" && npm install )
  fi
fi

# ---------------------------------------------------------------------------
# Backend (uvicorn)
# ---------------------------------------------------------------------------
RELOAD_FLAG=()
[ "$RELOAD" = "1" ] && RELOAD_FLAG+=(--reload)

# Foreground mode: replace shell with uvicorn — ideal as container CMD.
if [ "$FOREGROUND" = "1" ]; then
  # In foreground mode also start the frontend in background if requested.
  if [ "$SKIP_FRONTEND" != "1" ] && [ -d "$FRONTEND_DIR" ] && have_cmd npm; then
    if [ -f "$FRONTEND_PID" ] && pid_running "$(cat "$FRONTEND_PID")"; then
      info "Frontend already running (PID $(cat "$FRONTEND_PID"))."
    else
      info "Starting Vite dev server on http://${FRONTEND_HOST}:${FRONTEND_PORT}..."
      ( cd "$FRONTEND_DIR" && nohup npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" \
          >> "$SCRIPT_DIR/$FRONTEND_LOG" 2>&1 & echo $! > "$SCRIPT_DIR/$FRONTEND_PID" )
    fi
  fi
  info "Starting FastAPI backend (foreground) on http://${BACKEND_HOST}:${BACKEND_PORT}..."
  exec "$VENV_PY" -m uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" "${RELOAD_FLAG[@]}"
fi

# Background backend
if [ -f "$BACKEND_PID" ] && pid_running "$(cat "$BACKEND_PID")"; then
  info "Backend already running (PID $(cat "$BACKEND_PID")) — http://${BACKEND_HOST}:${BACKEND_PORT}"
else
  rm -f "$BACKEND_PID"
  info "Starting FastAPI backend on http://${BACKEND_HOST}:${BACKEND_PORT}..."
  nohup "$VENV_PY" -m uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT" "${RELOAD_FLAG[@]}" \
    >> "$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID"
  sleep 2
  if ! pid_running "$(cat "$BACKEND_PID")"; then
    err "Backend failed to start. Recent log:"
    tail -n 40 "$BACKEND_LOG" || true
    exit 1
  fi
  info "Backend started (PID $(cat "$BACKEND_PID")). Log: $BACKEND_LOG"
fi

# ---------------------------------------------------------------------------
# Frontend (vite)
# ---------------------------------------------------------------------------
if [ "$SKIP_FRONTEND" = "1" ]; then
  info "SKIP_FRONTEND=1 — frontend startup skipped."
elif [ ! -d "$FRONTEND_DIR" ]; then
  warn "frontend/ not found — skipping frontend startup."
elif ! have_cmd npm; then
  warn "npm not available — skipping frontend startup."
else
  if [ -f "$FRONTEND_PID" ] && pid_running "$(cat "$FRONTEND_PID")"; then
    info "Frontend already running (PID $(cat "$FRONTEND_PID")) — http://${FRONTEND_HOST}:${FRONTEND_PORT}"
  else
    rm -f "$FRONTEND_PID"
    info "Starting Vite dev server on http://${FRONTEND_HOST}:${FRONTEND_PORT}..."
    ( cd "$FRONTEND_DIR" && nohup npm run dev -- --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" \
        >> "$SCRIPT_DIR/$FRONTEND_LOG" 2>&1 & echo $! > "$SCRIPT_DIR/$FRONTEND_PID" )
    sleep 2
    if ! pid_running "$(cat "$FRONTEND_PID")"; then
      warn "Frontend failed to start. Recent log:"
      tail -n 40 "$FRONTEND_LOG" || true
    else
      info "Frontend started (PID $(cat "$FRONTEND_PID")). Log: $FRONTEND_LOG"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
info "ReadyRoute V2 is up:"
info "  Frontend : http://${FRONTEND_HOST}:${FRONTEND_PORT}"
info "  Backend  : http://${BACKEND_HOST}:${BACKEND_PORT}   (docs: /docs)"
info "Logs in    : $LOG_DIR/"
info "Stop with  : ./run.sh stop"
