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

### Settings page panel pattern
Each panel in `Settings.tsx` is a standalone function component.  
Use `FieldRow` helper for labeled rows, `SaveButton` for save/revert.  
Add new categories to the `Category` union type, the `CATEGORIES` array (with `adminOnly` if fleet/atl only), and the render switch.

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

