# ReadyRoute V2

Warehouse loading-dock management system. Tracks a fleet of trucks through their daily load/unload cycle, provides real-time status for supervisors and loaders, and records pace metrics over time.

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
dirty → shop
dirty / loaded → off / oos
```

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

## Host reliability (Windows)

If this project runs on a Windows host (local or Docker), two optional background helpers are included:

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

### 2) Service watchdog daemon

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
