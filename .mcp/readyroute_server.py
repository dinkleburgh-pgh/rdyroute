"""
ReadyRoute V2 — MCP Knowledge Server

Exposes domain logic, conventions, and architectural rules for the ReadyRoute V2
codebase as MCP tools so AI assistants have accurate context when working in this
workspace.

Run via:  python .mcp/readyroute_server.py
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("readyroute")

# ---------------------------------------------------------------------------
# App overview
# ---------------------------------------------------------------------------

@mcp.tool()
def get_app_overview() -> str:
    """Get the ReadyRoute V2 tech stack, dev ports, and high-level architecture."""
    return """
# ReadyRoute V2 — App Overview

## Stack
| Layer     | Tech                                              |
|-----------|---------------------------------------------------|
| Backend   | FastAPI + SQLAlchemy 2 + Pydantic v2              |
| Auth      | JWT (python-jose) + bcrypt                        |
| DB (dev)  | SQLite (truckv2_dev.db via .env)                  |
| DB (prod) | PostgreSQL via psycopg3                           |
| Frontend  | React 18 + TypeScript + Vite 5 + TailwindCSS      |
| State     | TanStack React Query v5 (5s board refetch)        |

## Dev Servers
- Backend:  uvicorn 127.0.0.1:8000  (python -m uvicorn main:app --reload)
- Frontend: Vite localhost:5180     (cd frontend && npm run dev)

## Production
- TrueNAS + Docker + Portainer CE at https://192.168.1.132:31015
- Stack name: readyroute, stack id: 38, endpoint id: 3
- Images: ghcr.io/dinkleburgh-pgh/rdyroute-backend / rdyroute-frontend
- Deploy command: python3 /app/docker_resolve.py portainer_redeploy

## React Router
- v6.27 using createBrowserRouter (NOT BrowserRouter)
- useBlocker requires the data router — do not revert to BrowserRouter

## Key Quirk: SQLite Enum Storage
SQLAlchemy SAEnum stores enum *names* (lowercase Python identifiers) in SQLite,
NOT the display values. e.g. truck_type "uniform" in DB → "Uniform" in API.
Never write titlecase values via raw SQL.
"""


# ---------------------------------------------------------------------------
# Role hierarchy
# ---------------------------------------------------------------------------

@mcp.tool()
def get_role_hierarchy() -> str:
    """Get the user role hierarchy and admin gating rules."""
    return """
# Role Hierarchy

admin > fleet > supervisor > lead > atl > loader > unloader > guest

## Admin gating
- Fleet and Supervisor are treated as "admin" for most UI checks (isAdmin in Settings.tsx).
- require_admin() FastAPI dependency: accepts fleet, supervisor, admin roles.

## Key role capabilities
- admin / fleet / supervisor: Management page, fleet edits, update triggers
- lead / atl: Load, Unload, Audit, Shorts, Board
- loader: Load page only
- unloader: Unload page only
- guest: Board (read-only)
"""


# ---------------------------------------------------------------------------
# Truck statuses
# ---------------------------------------------------------------------------

@mcp.tool()
def get_truck_statuses() -> str:
    """Get all valid TruckStatus values, their meanings, display order, and persistence rules."""
    return """
# Truck Statuses

## All values
dirty | unfinished | shop | in_progress | unloaded | loaded | off | oos | spare

## Display order (everywhere in the app)
Dirty → Unfinished → Unloaded → In Progress → Loaded → Spare → Off → OOS

## Persistence (_PERSISTENT_STATUSES)
Carried forward to next day: dirty, shop, oos, off, spare
NOT persistent: unfinished, in_progress, unloaded, loaded

## Special notes
- unfinished: NOT in sidebar STATUS_ORDER stack; surfaces as sub-section on
  non-fleet Board and as its own chip in fleet rail (FLEET_RAIL_STATUSES).
- unfinished is NOT auto-off eligible.
- spare: never auto-off.
- off: can be auto-derived (effectiveStatus) even if raw status is dirty/unloaded.

## effectiveStatus (auto-off pooling)
A truck is treated as OFF when ALL of:
  1. truck_type !== "Spare"
  2. scheduled_off_days.includes(loadDayNum)
  3. raw status is "dirty" OR "unloaded"
Applied in: Board.tsx (effectiveStatus), Layout.tsx (sidebar counts), RunDay.tsx.
"""


# ---------------------------------------------------------------------------
# Day numbering
# ---------------------------------------------------------------------------

@mcp.tool()
def get_day_numbering() -> str:
    """Get the ship-day numbering system, loadDay vs unloadsDay, and date helpers."""
    return """
# Day Numbering

## shipDayNumber()
Mon=1, Tue=2, Wed=3, Thu=4, Fri=5

## workdayNumbers() returns { loadDay, unloadsDay }
- loadDay    = TOMORROW's ship day (what we are currently loading FOR)
- unloadsDay = TODAY's ship day    (what we are currently unloading)

## Local date — CRITICAL
todayIso() in frontend/src/api/client.ts uses LOCAL wall-clock date:
  const d = new Date();
  return `${d.getFullYear()}-${...month...}-${...date...}`;

NEVER use new Date().toISOString().slice(0,10) — that returns UTC and breaks
US evening shifts.

## scheduled_off_days
Array of shipDayNumbers (1–5) on which a truck does NOT run.
Must be checked against loadDay (not unloadsDay) when determining if a truck
needs to be loaded.
"""


# ---------------------------------------------------------------------------
# File conventions
# ---------------------------------------------------------------------------

@mcp.tool()
def get_file_conventions() -> str:
    """Get the file/folder conventions for where each type of code lives."""
    return """
# File Conventions

| What                        | Where                              |
|-----------------------------|------------------------------------|
| API hooks (React Query)     | frontend/src/api/hooks.ts          |
| Axios client + todayIso     | frontend/src/api/client.ts         |
| Shared TypeScript types     | frontend/src/types.ts              |
| FastAPI routers             | routers/                           |
| SQLAlchemy models           | models.py                          |
| Pydantic schemas            | schemas.py                         |
| DB session / AppSettings    | database.py                        |
| Docker socket / Portainer   | docker_resolve.py                  |
| Backend entrypoint          | docker-entrypoint.sh               |
| Prod compose file           | docker-compose.prod.yml            |
| CI workflow                 | .github/workflows/docker-publish.yml |
| Truck status helpers        | frontend/src/utils/truckStatus.ts  |
| App shell / nav             | frontend/src/components/Layout.tsx |
| Note cards drawer           | frontend/src/components/NoteCardsDrawer.tsx |
| Route swap modal            | frontend/src/components/RouteSwapModal.tsx  |

## Settings page pattern
- Each panel = standalone function component
- FieldRow helper for labeled rows, SaveButton for save/revert
- Categories defined in CARD_GROUPS array with adminOnly flag
- /management route renders Settings.tsx (NOT Fleet.tsx for fleet route)

## Fleet page routing
/fleet renders <Board fleetMode /> (Board.tsx with fleetMode prop)
Fleet.tsx is NOT used for the fleet route.
"""


# ---------------------------------------------------------------------------
# Board / API patterns
# ---------------------------------------------------------------------------

@mcp.tool()
def get_board_api_patterns() -> str:
    """Get the Board API endpoint, React Query key, and key board data patterns."""
    return """
# Board API & Data Patterns

## Board endpoint
GET /trucks/board?run_date=YYYY-MM-DD
Returns all active trucks + their state for the run date.
Frontend React Query key: ["board", runDate]
Refetch interval: 5 seconds

## AppSetting pattern
Key/value store in app_settings table.
- Per-date settings: key = "some_key_YYYY-MM-DD"
- Per-user settings: key = "personal_note_{username}"
- Tracked items:     key = "tracked_items_map"
  value = { label: { qty_default: number, category?: string } }
- Bulk categories use ">" separator: "Bulk > Aprons", "Bulk > Dust Mops"

## useUpsertSetting / useSettings hooks
Located in frontend/src/api/hooks.ts
Used for all AppSetting reads and writes from the frontend.

## Tracked items top-level categories
3x10, 3x5, 4x6, Paper, Bulk
Bulk nests via ">": "Bulk > Aprons", "Bulk > Dust Mops", "Bulk > Towels"
Parsed in Audit.tsx with topCatOf() / subCatOf() (split on first ">").
"""


# ---------------------------------------------------------------------------
# Route swap logic
# ---------------------------------------------------------------------------

@mcp.tool()
def get_route_swap_logic() -> str:
    """Get route swap concepts, covering spare logic, and the swap log history feature."""
    return """
# Route Swap Logic

## Core concept
When a route truck is OOS, another truck (spare or active) "loads on" its route.
Stored in route_swaps table: { route_truck, load_on_truck, run_date, two_way }

## Covering spare
- A spare assigned to cover a route has route_swap_route OR state.oos_spare_route set.
- coveringSpareByRoute Map: route_truck_number → spare TruckWithState
- A covering spare stands in for its OOS route truck everywhere:
    Load page, Board counts, sidebar counts, effectiveStatus

## Off-day route filtering
When loading for a day, OOS trucks whose route is scheduled off (scheduled_off_days
includes loadDay) must be excluded from "Needs Assignment" and route dropdowns.
Applied in RouteSwapModal.tsx.

## Load-on suggestions (★ Recently used)
RouteSwapModal fetches useRouteSwapLog(60) — last 60 days of swap history.
Per route_truck: derives last 2 distinct load_on_truck values.
Shown as "★ Recently used for this route" optgroup at top of Load On dropdown.

## Already-covering flag (⚠)
If a truck is already load_on in an existing swap for today (swapLoadOnSet),
it is labeled "⚠ already covering a route" in Load On dropdowns.
"""


# ---------------------------------------------------------------------------
# Load / unload counting
# ---------------------------------------------------------------------------

@mcp.tool()
def get_load_unload_counting() -> str:
    """Get how load/unload progress and 'Total Left' are calculated."""
    return """
# Load / Unload Counting

## loadTrucks (Load.tsx)
board.filter(t =>
  (t.truck_type !== "Spare" || t.route_swap_route != null || t.state?.oos_spare_route != null)
  && (holidayLoad || !t.scheduled_off_days.includes(loadDay))
)

## loadRouteTrucks = loadTrucks.filter(t => t.truck_type !== "Spare")
## loadDone = loadRouteTrucks where effectiveStatus === "loaded"
         OR where loadedSpareRoutes.has(truck_number)
         (i.e., a covering spare loaded that route)

## dustsLeftTrucks / uniformsLeftTrucks
- Exclude loaded, off trucks
- OOS trucks: only include if NO covering spare exists AND route not off on loadDay

## sparesLeftTrucks
- Spare trucks with route_swap_route or oos_spare_route assigned
- Skip if covered route is scheduled off on loadDay (prevents phantom +1)
- Skip if effectiveStatus === "loaded"

## totalLeft = dustsLeft + uniformsLeft + sparesLeft

## Nav badge in Layout.tsx sidebar
trucksNotYetLoaded = totalScheduledLoad - loadedScheduled
Shown as amber badge on Load nav link.
"""


# ---------------------------------------------------------------------------
# NoteCardsDrawer
# ---------------------------------------------------------------------------

@mcp.tool()
def get_note_cards_drawer() -> str:
    """Get the NoteCardsDrawer component structure, tabs, and visibility rules."""
    return """
# NoteCardsDrawer

## Location
frontend/src/components/NoteCardsDrawer.tsx
Floating bottom-right FAB + expandable panel.

## Visibility
Shown on ALL routes when note_cards_enabled AppSetting is true.
(Previously restricted to /, /fleet, /load — restriction removed.)

## Tabs
1. "Truck Notes" — shows active truck notes with All/Today filter
   (notes from Notes.tsx data)
2. "My Notes"    — personal textarea per logged-in user
   Auto-saves to AppSetting key: personal_note_{username}
   Debounce: 800ms

## note_cards_enabled
AppSetting key. Set in Management → App Settings → General.
"""


# ---------------------------------------------------------------------------
# CI / Deploy pipeline
# ---------------------------------------------------------------------------

@mcp.tool()
def get_deploy_pipeline() -> str:
    """Get the CI/CD pipeline, image build flow, and Portainer redeploy mechanism."""
    return """
# CI / Deploy Pipeline

## GitHub Actions (.github/workflows/docker-publish.yml)
Triggers on push to main.
Steps:
  1. Build & push backend image  → ghcr.io/dinkleburgh-pgh/rdyroute-backend:latest
  2. Build & push frontend image → ghcr.io/dinkleburgh-pgh/rdyroute-frontend:latest
  3. Notify production (POST /api/updates/push) AFTER images are in GHCR
     Uses repo secrets: PROD_UPDATE_URL, PROD_UPDATE_SECRET (optional)

## Why the order matters
The webhook must fire AFTER images are pushed, not on raw git push.
Otherwise Portainer redeploys before new images exist (race condition).

## Backend update system (routers/updates.py)
POST /updates/push  — called by CI after build; triggers deploy command in background
POST /updates/trigger — manual trigger from Management UI
GET  /updates/check   — compares running GIT_SHA against latest GitHub commit

## Deploy command (stored in AppSetting "update_deploy_command")
Default: python3 /app/docker_resolve.py portainer_redeploy
(NOT bash ./deploy.sh — that requires docker CLI which isn't in the container)

## docker_resolve.py portainer_redeploy
1. GETs current stack from Portainer API to fetch live Env array
2. PUTs to /api/stacks/{id}/git/redeploy with pullImage=true + preserved Env
   (sending env:[] would wipe all stack env vars)
"""


# ---------------------------------------------------------------------------
# Common pitfalls
# ---------------------------------------------------------------------------

@mcp.tool()
def get_common_pitfalls() -> str:
    """Get a list of common mistakes and gotchas when working in this codebase."""
    return """
# Common Pitfalls

## SQLite enums
ALWAYS use lowercase names in raw SQL: "uniform", "dust", "spare"
NOT "Uniform", "Dust", "Spare" — those are display values, not DB values.

## UTC vs local date
NEVER: new Date().toISOString().slice(0,10)  ← returns UTC, breaks evening shifts
ALWAYS: todayIso() from frontend/src/api/client.ts  ← uses local wall-clock date

## useBlocker requires data router
useBlocker (React Router v6) only works with createBrowserRouter.
App.tsx was migrated — do NOT revert to BrowserRouter/Routes.

## Two useBlocker calls in same component
React Router doesn't support multiple useBlocker calls in one component.
Merge into one with a discriminant (blockedReason pattern in Load.tsx).

## Portainer redeploy wipes env vars
Portainer's PUT /stacks/{id}/git/redeploy replaces env with whatever you send.
Always GET the current stack env first and pass it back. See docker_resolve.py.

## Creating temp .py files in project root
WatchFiles triggers a backend reload on every create/delete cycle.
Use a script outside the project root, or use the _fix.py + Remove-Item pattern.

## Fleet.tsx vs Board fleetMode
/fleet route renders <Board fleetMode /> — NOT Fleet.tsx.
Do NOT add fleet logic to Fleet.tsx.

## Portainer redeploy timing
Portainer redeploys triggered by a raw git push webhook fire before images are built.
The fix is to fire the /updates/push webhook from the END of the CI workflow.

## AppSetting env wipe
update_deploy_command is stored in the DB as an AppSetting.
Changing DEFAULT_COMMAND in code does NOT update an already-set DB value.
Must update via Management → Advanced → Update UI.
"""


# ---------------------------------------------------------------------------
# Audit page
# ---------------------------------------------------------------------------

@mcp.tool()
def get_audit_page_logic() -> str:
    """Get how the Audit page works: truck picker, item hierarchy, and managed items."""
    return """
# Audit Page (frontend/src/pages/Audit.tsx)

## Phase 1 — TruckPicker
All non-spare trucks shown in a single flat grid sorted by truck_number.
- Un-audited: slate bg, shows truck_type label
- Audited: emerald green bg + ring, shows "N items" count
Stats bar at top: "X / Y audited" + total items logged.

## Phase 2 — ItemLogger
Hierarchical picker: Category → (Subcategory) → Item → Qty confirm.
Top categories: 3x10, 3x5, 4x6, Paper, Bulk
Bulk subcategories: Aprons, Dust Mops, Towels
Color palette: TOP_PALETTE / SUB_PALETTE / MAT_COLOR_PALETTE constants.

## Tracked items catalog
Stored in AppSetting "tracked_items_map" — managed in Management → Notices & Items → Tracked Items.
Falls back to DEFAULT_TRACKED_ITEMS constant if none configured.

## Modifier bar
- "warn on next load" toggle — sets warn_on_next_load on the audit entry
- "+ note / route" — reveals note input + route override input
- "photos" — reveals PhotosPanel for the selected truck

## Photos
Stored in audit_photos/{run_date}/ directory.
API: POST /audit/photos, GET /audit/photos?run_date=...
Requires admin or atl+ role to delete.
"""


# ---------------------------------------------------------------------------
# Recent session changes (for AI context)
# ---------------------------------------------------------------------------

@mcp.tool()
def get_recent_changes() -> str:
    """Get a summary of recent code changes made in the current development session."""
    return """
# Recent Changes (session: 2026-06-05)

## Audit page — merged truck grid (Audit.tsx)
Removed separate "Needs Audit" / "Audited" sections.
All trucks now in one flat grid — audited trucks turn green with item count.

## NoteCardsDrawer — My Notes tab (NoteCardsDrawer.tsx)
Added second tab "My Notes" with per-user textarea.
Auto-saves to AppSetting personal_note_{username} with 800ms debounce.
FAB now shows on ALL routes (ALLOWED_ROUTES restriction removed).

## RouteSwapModal — load-on suggestions + ⚠ flag (RouteSwapModal.tsx)
Fetches useRouteSwapLog(60) to derive last 2 distinct load-on trucks per route.
"★ Recently used for this route" optgroup appears at top of every Load On dropdown.
Trucks already covering a route today labeled with "⚠ already covering a route".
LoadOnOptions component shared by OOS prefill rows and manual Add Swap form.

## Load.tsx — Total Left phantom fix
sparesLeftTrucks now skips spares covering a route that is scheduled off on loadDay.
Prevents phantom +1 in "Total Left" stat card.

## CI pipeline — race condition fix (.github/workflows/docker-publish.yml)
Added "Notify production to redeploy" step at END of workflow (after images pushed).
Fires POST /api/updates/push to prod. Requires PROD_UPDATE_URL repo secret.
Previously the GitHub webhook fired on raw push before images were built.

## Deploy command fix (routers/updates.py)
DEFAULT_COMMAND changed from "bash ./deploy.sh" to
"python3 /app/docker_resolve.py portainer_redeploy".
(deploy.sh requires docker CLI which isn't available inside the container)
"""


if __name__ == "__main__":
    mcp.run(transport="stdio")
