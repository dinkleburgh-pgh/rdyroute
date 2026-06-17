# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ReadyRoute V2 is a warehouse loading-dock management system. It tracks a fleet of trucks through their daily load/unload cycle, provides real-time status for supervisors and loaders, and records pace metrics over time.

---

## Running locally

```powershell
# Convenience script (starts both services, opens browser)
.\run.ps1
.\run.ps1 -Restart   # stop + restart
.\run.ps1 -Stop
.\run.ps1 -NoBrowser

# Manual — backend (port 8000)
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Manual — frontend (port 5180, separate terminal)
cd frontend
npm run dev
```

Vite proxies `/api` → `127.0.0.1:8000`. Interactive API docs: `http://127.0.0.1:8000/docs`.

No automated test suite exists — testing is manual/integration via the browser.

---

## Database migrations (Alembic)

`alembic upgrade head` runs automatically on backend startup. For schema changes:

```powershell
# After editing models.py:
$env:DATABASE_URL="sqlite:///./truckv2_dev.db"; alembic revision --autogenerate -m "describe_change"
# Review the generated file in alembic/versions/, then restart the backend (or run upgrade head manually)
alembic upgrade head
```

- `render_as_batch=True` is already set in `alembic/env.py` — required for SQLite ALTER TABLE.
- Never hand-edit a migration file that has already been applied.
- Never write inline `ALTER TABLE` in `main.py`.

---

## Critical gotchas

**SQLite enum storage** — SQLAlchemy's `SAEnum` stores enum *names* (Python identifiers), not display values. Example: `TruckType.uniform` is stored as `"uniform"`, not `"Uniform"`. Raw SQL patches must use lowercase names (`uniform`, `dust`, `spare`). The ORM and API handle mapping automatically.

**Local date** — `todayIso()` in `frontend/src/api/client.ts` builds a YYYY-MM-DD string from wall-clock local time. Never substitute `new Date().toISOString().slice(0,10)` — that returns UTC and breaks US evening shifts.

**Fleet page routing** — `/fleet` renders `<Board fleetMode />` (Board.tsx with the `fleetMode` prop). `Fleet.tsx` is not the fleet route; do not add fleet logic there.

**WatchFiles** — Creating a `.py` file in the project root triggers a uvicorn reload on every create/delete cycle. Write temp scripts outside the root, or chain creation + deletion in a single command.

**Direct DB edits** — Use a script file outside the project root, or the `_fix.py` + immediate `Remove-Item` pattern in one chained command. Always use lowercase enum names.

**CI deploy webhook** — `/updates/push` is called at the *end* of the CI workflow (after images land in GHCR). This prevents Portainer redeploying before the new image exists.

**Portainer redeploy** — `docker_resolve.py portainer_redeploy` GETs the current stack's live `Env` array and PUTs it back. Never send `"env": []` — it wipes all stack environment variables. The correct `update_deploy_command` AppSetting is `python3 /app/docker_resolve.py portainer_redeploy`.

---

## Architecture patterns

### Role hierarchy
`admin > fleet > supervisor > lead > atl > loader > unloader > guest`

Fleet/Supervisor are treated as admin for most gating checks (`isAdmin` in `Settings.tsx`).

### Truck lifecycle
```
dirty → in_progress → unloaded → loaded
dirty → unfinished  → unloaded → loaded
dirty → shop
dirty / loaded → off / oos
```

`unfinished` is a manual hand-off from the Unload page. It is **not** auto-off-eligible and is **not** in `_PERSISTENT_STATUSES` (does not carry forward to the next day).

Display order everywhere: **Dirty → Unfinished → Unloaded → In Progress → Loaded → Spare → Off → OOS**

`unfinished` is omitted from the sidebar `STATUS_ORDER` stack — it surfaces as a sub-section on the non-fleet dirty board and as its own chip in the fleet rail.

### effectiveStatus (auto-off pooling)
A truck is treated as **off** when ALL of:
1. `truck_type !== "Spare"` (spares are never auto-off)
2. `scheduled_off_days.includes(loadDayNum)`
3. raw status is `"dirty"` or `"unloaded"`

Applied in: `Board.tsx` (`effectiveStatus`), `Layout.tsx` (sidebar counts), `RunDay.tsx`.

### Day numbering
Mon=1 … Fri=5. `shipDayNumber()` = today's ship day. `workdayNumbers()` returns:
- `loadDay` = tomorrow's ship day (what we're currently loading for)
- `unloadsDay` = today's ship day

### Board API endpoint
`GET /trucks/board?run_date=YYYY-MM-DD` — returns all active trucks + state for the run date. Frontend React Query key: `["board", runDate]`. Refetch interval: 5 seconds.

### Tracked items (audit / shorts)
Stored in the `tracked_items_map` `app_settings` row as `{ label: { qty_default, category } }`. Top-level categories: `3x10`, `3x5`, `4x6`, `Paper`, `Bulk`. `Bulk` nests via `>` separator (e.g. `Bulk > Aprons`). `HierarchyPicker` parses with `topCatOf` / `subCatOf` (split on first `>`).

### Load page — Total Left counting
`sparesLeftTrucks` skips spares whose covered route is scheduled off on `loadDay` (prevents phantom +1 in the stat card).

### Audit page — TruckPicker
All trucks in a single flat grid (no Needs Audit / Audited section split). Audited trucks turn emerald green and show item count.

---

## File conventions

| What | Where |
|---|---|
| React Query hooks | `frontend/src/api/hooks.ts` |
| Axios client + `todayIso` | `frontend/src/api/client.ts` |
| Shared TypeScript types | `frontend/src/types.ts` |
| FastAPI routers | `routers/` (one per domain) |
| SQLAlchemy models | `models.py` |
| Pydantic schemas | `schemas.py` |
| DB session / settings | `database.py` |
| Truck status helpers | `frontend/src/utils/truckStatus.ts` |
| App shell + nav | `frontend/src/components/Layout.tsx` |
| Note cards drawer | `frontend/src/components/NoteCardsDrawer.tsx` |
| Route swap modal | `frontend/src/components/RouteSwapModal.tsx` |
| Docker socket / Portainer | `docker_resolve.py` |
| DB migrations | `alembic/versions/` |
| MCP knowledge server | `.mcp/readyroute_server.py` |

---

## Component patterns

### Settings page panels
Each panel in `Settings.tsx` is a standalone function component. Use `FieldRow` for labeled rows, `SaveButton` for save/revert. To add a new category: add to the `Category` union type, the `CARD_GROUPS` array (with `adminOnly` if needed), and the `renderPanel` switch.

### React Router
Uses `createBrowserRouter` + `RouterProvider` (data router API). `useBlocker` requires this — do not revert to `BrowserRouter`. Only one `useBlocker` per component is allowed; merge multiple guards using a `blockedReason` discriminant.

### NoteCardsDrawer
Floating bottom-right FAB shown on all routes when `note_cards_enabled` AppSetting is true. Two tabs: **Truck Notes** (active truck notes) and **My Notes** (per-user textarea, auto-saves to `personal_note_{username}` AppSetting with 800 ms debounce).

### Route swap suggestions
`RouteSwapModal` fetches `useRouteSwapLog(60)` to derive the last 2 distinct `load_on_truck` values per `route_truck`. Displayed as a "★ Recently used" optgroup at the top of every Load On dropdown.

---

## UI verification

After any frontend change affecting layout or visual state, verify in the browser at `http://localhost:5180`. After every code edit, check for TypeScript type errors and Python syntax issues before reporting completion.
