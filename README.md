# ReadyRoute V2

Warehouse loading-dock management system. Tracks a fleet of trucks through their daily load/unload cycle, provides real-time status for supervisors and loaders, and records pace metrics over time.

For a full walkthrough of how the app actually works — daily workflow, the coverage/OOS system, Operations settings, deployment — see **[docs/APP_GUIDE.md](docs/APP_GUIDE.md)**.

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 |
| Auth | JWT (python-jose) + bcrypt |
| DB (dev) | SQLite |
| DB (prod) | PostgreSQL via psycopg3 |
| Frontend | React 18 + TypeScript + Vite 5 + TailwindCSS |
| State | TanStack React Query v5 |

---

## Local development

### Prerequisites
- Python 3.11+
- Node.js 18+

### Setup

```powershell
# 1. Clone and create venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 2. Create .env (or let run.ps1 generate one)
# DATABASE_URL=sqlite:///./truckv2_dev.db

# 3. Start backend  (port 8000)
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 4. Start frontend  (port 5180)
cd frontend
npm install
npm run dev
```

Or use the convenience script:
```powershell
.\run.ps1
```

Useful variants:
```powershell
.\run.ps1 -Restart
.\run.ps1 -Stop
.\run.ps1 -NoBrowser
```

`run.ps1` now verifies that both backend and frontend actually answer on `127.0.0.1:8000` and `127.0.0.1:5180`, retries Vite once if it does not come up cleanly, and prefers `npm.cmd` on Windows to avoid PowerShell command-resolution issues.

The API is proxied through Vite: `localhost:5180/api` → `127.0.0.1:8000`.  
Interactive API docs: `http://127.0.0.1:8000/docs`

---

## Architecture overview

### Role hierarchy
`admin > fleet > supervisor > lead > atl > loader > unloader > guest`

Fleet and Supervisor roles have full admin access to Settings and Fleet Management.

### Truck lifecycle
Trucks progress through statuses each day:
```
dirty → in_progress → unloaded → loaded
dirty → unfinished → unloaded → loaded
dirty → shop
dirty / loaded → off / oos
```

`unfinished` is a manual hand-off state from the Unload page — used when a truck couldn't be fully unloaded but should not return to the Dirty queue. It surfaces as a sub-section on the Dirty board and on the Unload page until cleared.

### Timer workflows (optional)
Two timed countdowns can be enabled in Settings → Workflows:

| Timer | Duration | Auto-transition | Visual |
|---|---|---|---|
| Outside | 20 min | `dirty/loaded` → `unloaded` | Orange widget |
| Paper Bay | 25 min | any status → `loaded` | Violet widget; cancels Outside timer for same truck |

Timers persist in `localStorage` across page reloads.

Spare trucks are managed separately and never enter the off-day pooling logic.

### Truck types
| Type | Description |
|---|---|
| Uniform | Standard daily-load truck |
| Dust | Dust-run truck |
| Spare | On-call spare, bypasses off-day scheduling |

### Day numbering
Mon=1 … Fri=5. The app distinguishes the **load day** (tomorrow's ship day — what we're loading tonight) from the **unloads day** (today's ship day — what we unloaded this morning).

### Auto-OFF pooling
Non-Spare trucks that have today's load day in `scheduled_off_days` and a raw status of `dirty` or `unloaded` are surfaced as **Off** automatically — no manual status change required.

---

## Project structure

```
main.py            FastAPI app entry point
models.py          SQLAlchemy ORM models
schemas.py         Pydantic request/response schemas
database.py        Engine, session factory, settings
seed.py            Startup seed (default admin account, V1 import)
routers/           FastAPI routers (one per domain)
frontend/
  src/
    api/
      client.ts    Axios instance + todayIso()
      hooks.ts     All React Query hooks
    pages/         Page components (Board, Settings, RunDay, …)
    components/    Shared components (Layout, Clock, …)
    types.ts       Shared TypeScript types
```

---

## Key gotchas

- **SQLite enum storage**: SQLAlchemy stores enum *names* (`uniform`, `dust`, `spare`), not display values (`Uniform`, `Dust`, `Spare`). Raw SQL inserts/updates must use lowercase names.
- **Local date**: `todayIso()` uses wall-clock local time. Never use `new Date().toISOString().slice(0,10)` — that returns UTC and breaks shifts after midnight UTC.
- **Fleet page**: `/fleet` renders `<Board fleetMode />`. `Fleet.tsx` is not the fleet route.
- **WatchFiles**: Creating `.py` files in the project root triggers a uvicorn reload. Write temp scripts outside the root or chain creation + deletion in one command.
- **Backup DB**: Set `BACKUP_DATABASE_URL` in `.env` / `.env.production` to a comma-separated list of fallback/replica PostgreSQL URLs. The Connections panel in Settings → Advanced shows live latency and pool stats for each URL.
- **Vite artifacts**: `frontend/vite.err` is a local crash artifact and is ignored. Do not commit it.

---

## Versioning

Builds are labelled `build.<N>` where `N` is the GitHub Actions run number.  
The product name already contains "V2" so no major-version prefix is needed.

- **Sidebar**: shows `build.<N>` in production, `dev` during local development.
- **Docker images**: tagged `latest`, `<git-sha>`, and `build.<N>`.
- **Backend API**: `/health` returns `{ "status": "ok", "version": "build.<N>" }`.
- **CI**: `.github/workflows/docker-publish.yml` sets `APP_VERSION` build-arg which the Dockerfiles consume.

---

## Docker

```bash
docker compose up --build          # backend + frontend (SQLite)
docker compose --profile postgres up --build  # add local postgres
```

## Production deploy

Use the pull-based stack in [docker-compose.prod.yml](docker-compose.prod.yml) once you have pushed new backend/frontend images to your registry.

```powershell
# edit .env.production first if you push to a different registry path
.\deploy.ps1
```

The backend data lives in the named `backend_data` volume, so image repulls do not wipe the database file. If you change the image tag in `.env.production`, run the deploy script again to pull and restart with the new build.

If you deploy the compose file in a stack manager that does not read `.env.production` from disk, paste the same variables into the stack environment settings. The compose file no longer depends on `env_file` at runtime.

---

## Host reliability (Windows / Docker)

When running with Docker, the stack now includes a watchdog container that starts automatically with the app and restarts unhealthy frontend/backend containers.

### Docker-native watchdog (auto-start)

- Included in both [docker-compose.yml](docker-compose.yml) and [docker-compose.prod.yml](docker-compose.prod.yml).
- No extra startup command is required once the stack is deployed.
- Tunable with:
  - `WATCHDOG_INTERVAL_SECONDS` (default `20`)
  - `WATCHDOG_FAILURE_THRESHOLD` (default `3`)

### Host keep-awake note

Containers cannot reliably control host OS sleep policy. If the machine itself sleeps, all containers pause.
For unattended Windows hosts, set OS power sleep to `Never` (or use the keep-awake host script below).

Two host-level helpers are also included for Windows hosts:

### 1) Keep the host awake

`keep-awake.ps1` prevents system sleep without permanently changing your power plan.

```powershell
# Run manually
.\keep-awake.ps1 -KeepDisplayOn

# Install startup entry (runs at sign-in)
.\install-keep-awake-task.ps1

# Remove startup entry
.\uninstall-keep-awake-task.ps1
```

### 2) Service watchdog daemon (host-level)

`watchdog.ps1` continuously checks frontend/backend health and restarts failed services.

Install startup daemon:

```powershell
# Auto-detect environment on each loop (recommended)
.\install-watchdog-task.ps1 -Mode auto

# Force a specific environment mode
.\install-watchdog-task.ps1 -Mode local
.\install-watchdog-task.ps1 -Mode dev
.\install-watchdog-task.ps1 -Mode prod
```

Remove daemon:

```powershell
.\uninstall-watchdog-task.ps1
```

Mode behavior:

- `local`: monitors local app endpoints and restarts via `run.ps1 -Restart`.
- `dev`: monitors Docker services from `docker-compose.yml` and restarts failed `backend`/`frontend` services.
- `prod`: monitors Docker services from `docker-compose.prod.yml` and restarts failed `backend`/`frontend` services.
- `auto`: chooses `prod`, `dev`, or `local` based on which stack is currently running.
