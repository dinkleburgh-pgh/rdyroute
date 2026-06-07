# ReadyRoute V2 — Copilot Instructions

Always-on context for AI coding assistants working in this repository.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 |
| Auth | JWT (python-jose) + bcrypt |
| DB (dev) | SQLite (`truckv2_dev.db` via `.env`) |
| DB (prod) | PostgreSQL via psycopg3 |
| Frontend | React 18 + TypeScript + Vite 5 + TailwindCSS |
| State | TanStack React Query v5 (5 s board refetch) |
| Dev server | uvicorn `127.0.0.1:8000` · Vite `localhost:5180` |

---

## Critical: SQLite enum storage

SQLAlchemy's `SAEnum` stores enum **names** (the Python identifier) in SQLite, **not** the display values.

```python
class TruckType(str, enum.Enum):
    uniform = "Uniform"   # stored as "uniform"
    dust    = "Dust"      # stored as "dust"
    spare   = "Spare"     # stored as "spare"
```

**Never** write titlecase values (`Uniform`, `Dust`, `Spare`) directly via raw SQL — use the lowercase names (`uniform`, `dust`, `spare`). The ORM and API handle the mapping automatically.

---

## Key architecture patterns

### Role hierarchy
`admin > fleet > supervisor > lead > atl > loader > unloader > guest`

Fleet/Supervisor = "admin" for most gating checks (`isAdmin` in Settings.tsx).

### Day numbering
Mon=1 … Fri=5.  
`shipDayNumber()` — today's ship day.  
`workdayNumbers()` → `{ loadDay, unloadsDay }` where:
- `loadDay` = **tomorrow's** ship day (what we're currently loading for)
- `unloadsDay` = today's ship day

### Local date (not UTC)
`todayIso()` in `frontend/src/api/client.ts` uses local wall-clock date:
```ts
const d = new Date();
return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
```
**Never** use `new Date().toISOString().slice(0,10)` — that returns UTC and breaks US evening shifts.

### effectiveStatus (auto-off pooling)
A truck is treated as **off** when ALL of:
1. `truck_type !== "Spare"` (spares are never auto-off)
2. `scheduled_off_days.includes(loadDayNum)` (scheduled for the load day)
3. raw status is `"dirty"` or `"unloaded"`

Applied in: `Board.tsx` (effectiveStatus), `Layout.tsx` (sidebar counts), `RunDay.tsx`.

`unfinished` is **not** auto-off-eligible and is **not** in `_PERSISTENT_STATUSES` (does not carry forward to the next day).

### TruckStatus values
`dirty | unfinished | shop | in_progress | unloaded | loaded | off | oos | spare`

Display order everywhere: **Dirty → Unfinished → Unloaded → In Progress → Loaded → Spare → Off → OOS**.

`unfinished` is intentionally **omitted** from the sidebar `STATUS_ORDER` stack — it surfaces as a sub-section on the non-fleet dirty board (`Board.tsx`) and as its own chip in the fleet rail (`FLEET_RAIL_STATUSES`).

### Tracked items (audit / shorts)
Stored in the `tracked_items_map` `app_settings` row as `{ label: { qty_default, category } }`.

Top-level categories: `3x10`, `3x5`, `4x6`, `Paper`, `Bulk`.  
`Bulk` nests via `>` separator: `Bulk > Aprons`, `Bulk > Dust Mops`, `Bulk > Towels`.

`HierarchyPicker` in `Audit.tsx` / `Shorts.tsx` parses categories with `topCatOf` / `subCatOf` (split on first `>`).

### Fleet page routing
`/fleet` renders `<Board fleetMode />` (Board.tsx with the fleetMode prop).  
`Fleet.tsx` is **not** used for the fleet route — do not add fleet logic there.

### Board API endpoint
`GET /trucks/board?run_date=YYYY-MM-DD` — returns all active trucks + their state for the run date. Frontend key: `["board", runDate]`.

---

## File conventions

| What | Where |
|---|---|
| API hooks (React Query) | `frontend/src/api/hooks.ts` |
| Axios client + todayIso | `frontend/src/api/client.ts` |
| Shared TypeScript types | `frontend/src/types.ts` |
| FastAPI routers | `routers/` |
| SQLAlchemy models | `models.py` |
| Pydantic schemas | `schemas.py` |
| DB session / settings | `database.py` |
| Docker socket / Portainer | `docker_resolve.py` |
| Truck status helpers | `frontend/src/utils/truckStatus.ts` |
| App shell / nav | `frontend/src/components/Layout.tsx` |
| Note cards drawer | `frontend/src/components/NoteCardsDrawer.tsx` |
| Route swap modal | `frontend/src/components/RouteSwapModal.tsx` |
| MCP knowledge server | `.mcp/readyroute_server.py` |
| DB migrations | `alembic/versions/` |

### Schema migrations (Alembic)
Inline `ALTER TABLE` in `main.py` lifespan has been replaced by Alembic.  
On startup, `lifespan` calls `alembic upgrade head` automatically.

**Workflow for new migrations:**
```powershell
# After changing models.py, generate a migration:
$env:DATABASE_URL="sqlite:///./truckv2_dev.db"; alembic revision --autogenerate -m "describe_change"
# Review the generated file in alembic/versions/, then it applies on next startup.
# To apply immediately in dev:
alembic upgrade head
```
- Always use `render_as_batch=True` (already set in env.py) — required for SQLite ALTER TABLE.
- Never hand-edit existing migration files after they've been applied.
- The `alembic_version` table tracks the current schema version.

### Settings page panel pattern
Each panel in `Settings.tsx` is a standalone function component.  
Use `FieldRow` helper for labeled rows, `SaveButton` for save/revert.  
Add new categories to the `Category` union type, the `CARD_GROUPS` array (with `adminOnly` if fleet/atl only), and the render switch in the `renderPanel` function.

### React Router
Uses `createBrowserRouter` + `RouterProvider` (NOT legacy `BrowserRouter`).  
`useBlocker` requires the data router — **do not revert** to `BrowserRouter`.  
Only one `useBlocker` per component is supported — merge into one with a `blockedReason` discriminant.

### NoteCardsDrawer
Floating bottom-right FAB. Shown on **all routes** when `note_cards_enabled` AppSetting is true.  
Two tabs: **Truck Notes** (active truck notes, All/Today filter) and **My Notes** (per-user textarea, auto-saves to `personal_note_{username}` AppSetting, 800 ms debounce).

### Route swap suggestions
`RouteSwapModal` fetches `useRouteSwapLog(60)` to derive the last 2 distinct `load_on_truck` values per `route_truck` from history.  
Shown as "★ Recently used for this route" optgroup at top of every Load On dropdown.  
Trucks already covering a route today are labeled `⚠ already covering a route`.

### Load page — Total Left counting
`sparesLeftTrucks` skips any spare whose covered route is scheduled off on `loadDay` (prevents phantom +1 in the Total Left stat card).

### Audit page — TruckPicker
All trucks in a **single flat grid** — no "Needs Audit" / "Audited" section split.  
Audited trucks turn emerald green and show item count; un-audited stay slate with truck type label.

---

## Running locally

```powershell
# Backend
.\.venv\Scripts\Activate.ps1
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm run dev
```

**Avoid creating temp `.py` files in the project root** — WatchFiles will trigger a backend reload for every create/delete cycle.

---

## Direct DB edits (dev only)

Use a script file outside the project root, or use the `_fix.py` + immediate `Remove-Item` pattern in a single command chain. Always write enum names in lowercase (`uniform`, `dust`, `spare`) when patching the SQLite DB directly.

---

## UI changes — live browser verification

After any frontend change that affects layout, components, or visual state, **verify the result in the browser** using the available browser tools:

1. **`screenshot_page`** — capture a visual snapshot to confirm the rendered output looks correct.
2. **`read_page`** — inspect the live DOM tree to confirm elements, refs, and interactive state are as expected (buttons present, correct labels, no missing sections).

**When to do this:**
- After adding or restructuring a component
- After changing conditional render logic (e.g. edit modes, modals, status-gated sections)
- When the user reports something looks wrong — check before and after the fix
- Whenever the change touches multiple components or pages at once

The dev server runs at `http://localhost:5180`. Navigate to the relevant route before capturing.

### Syntax / type error checks

After every code edit, run **`get_errors`** on the modified files before reporting completion. This catches TypeScript type errors, missing imports, and Python syntax issues immediately rather than leaving broken code silently in place.

---

## CI / Deploy pipeline

Images are built by GitHub Actions on push to `main` and pushed to GHCR.  
**The `/updates/push` webhook is called at the END of the CI workflow** (after images are in GHCR), not on raw git push — this prevents Portainer redeploying before new images exist.

Requires repo secrets: `PROD_UPDATE_URL`, `PROD_UPDATE_SECRET` (optional).

### Deploy command
Stored in AppSetting `update_deploy_command`.  
**Correct value:** `python3 /app/docker_resolve.py portainer_redeploy`  
**Wrong:** `bash ./deploy.sh` — requires `docker` CLI which is not in the container.

### Portainer redeploy
`docker_resolve.py portainer_redeploy`:
1. GETs current stack from Portainer API to fetch live `Env` array
2. PUTs to `/api/stacks/{id}/git/redeploy` with `pullImage=true` + preserved `Env`

**Never send `"env": []`** — that wipes all stack environment variables.

