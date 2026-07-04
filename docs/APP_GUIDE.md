# ReadyRoute V2 — App Guide

What the app does, how the daily workflow fits together, and where things live.
For local dev setup and tech stack, see [README.md](../README.md). For
agent-specific gotchas and file conventions, see [CLAUDE.md](../CLAUDE.md).

---

## What it is

A warehouse loading-dock management system for a fleet of trucks that run a
daily **load → route → unload** cycle. Each truck belongs to a route (or is a
spare on call), and the app tracks its status through the shift, coordinates
who's covering for out-of-service trucks, and gives supervisors a live view of
the whole operation.

---

## Core concepts

### Load day vs. unload day
The app runs one shift covering two ship days at once:

- **Unload day** — today's ship day. Trucks that ran routes are coming back
  dirty and need to be unloaded.
- **Load day** — tomorrow's ship day. Trucks get loaded tonight for tomorrow's
  run.

Day numbers are Mon=1 … Fri=5 (`workdayNumbers()` in `frontend/src/components/Clock.tsx`).
Weekends freeze the "current" run date to Friday.

### Truck types
| Type | Description |
|---|---|
| Uniform | Standard daily-load route truck |
| Dust | Dust-run route truck |
| Spare | On-call, no fixed route; covers for OOS/swapped trucks |

### Truck lifecycle (status)
```
dirty → in_progress → unloaded → loaded
dirty → unfinished  → unloaded → loaded
dirty → shop
dirty / loaded → off / oos
```
- **dirty** — came back from its route, needs unloading.
- **unfinished** — manual hand-off when a truck couldn't be fully unloaded;
  doesn't return to the Dirty queue, shows as its own sub-section instead.
- **off** — auto-applied when a non-Spare truck is scheduled off for the load
  day and hasn't entered an active workflow yet (still dirty/unloaded).
- **oos** — flagged out of service at the truck level (`is_oos`), independent
  of its physical dirty/unloaded status.

### Holiday mode
Load and Unload can each independently run in "holiday" mode, meaning two ship
days' worth of routes run in one shift (extra routes on top of the normal
day). Set per-day in the Setup Day wizard step 1; the choice **persists day to
day** once set, until explicitly changed again.

---

## Coverage: routes, spares, and OOS

This is the most involved part of the app — a route can be covered two ways:

1. **Route swap** — one route truck loads another route truck's load (both
   trucks still run; `route_swaps` table).
2. **Spare assignment** — a spare truck covers an OOS route truck's route
   instead of the OOS truck running (`spare_assignments` table, tracked with
   a `returned` flag so it can be explicitly "given back").

Both are set from the **Route Swaps modal** (fleet nav) or **Setup Day step
3**, and both show up identically on the board as "Covers #N" / "Cov. #N"
badges.

### is_oos is authoritative — but only once covered
A route truck flagged `is_oos` is only pulled out of the normal Dirty
workflow **once a covering truck is actually assigned**. An OOS truck with no
coverage yet is still physically sitting there — if it's dirty, someone still
has to deal with it, so it stays in Dirty until it's covered or unloaded. This
rule is applied consistently in the Board's filters, the sidebar's Live
Status counts, and the Day Overview — all three share the same logic
(`buildRouteStatusCounts` / `coveringTruckByRoute` in
`frontend/src/utils/truckStatus.ts`).

### Historical coverage fallback (read-only)
Coverage records aren't automatically carried forward day to day (by design —
a supervisor re-confirms coverage each shift). But a truck's dirty status
often traces back to an assignment that was never explicitly "returned." To
avoid a stale display where an OOS truck flashes as freshly dirty before
that's re-confirmed, `buildHistoricalCoverageFallback` looks for:

1. An **open** (`returned=false`) spare assignment for the route, regardless
   of what day it was created — this is the authoritative "still active"
   signal.
2. Failing that, the most recent `route_swap_log` entry for the route (route
   swaps are hard-deleted when cleared, so the log is the only trace left).

This is purely a display fallback — it never writes a new assignment. It's
shared by the Board, the sidebar, and the Day Overview so all three always
agree on what's covered.

### Unload uses *yesterday's* coverage
The trucks being unloaded today were loaded (and covered) on the **previous**
run day. The Day Overview's Unload section shows the previous operating day's
coverage (stepping back over weekends), not today's live coverage — so the
crew knows which spare to actually unload.

---

## Daily workflow

### Setup Day wizard (5 steps)
Opened from the sidebar button; auto-detects if it's already been run today.

1. **Run Mode** — Normal vs. Holiday, independently for Load and Unload.
2. **Dust Garments** — mark which Dust trucks have garments assigned.
3. **Route Swaps** — set/review active coverages; shows a "Needs Assignment"
   list of uncovered OOS routes.
4. **Trucks Not Here** — mark absent returning/spare trucks; they get
   `needs_checked` + a non-dirty status (spare → `spare`, route → `unloaded`)
   instead of defaulting into the dirty pile.
5. **Daily Notes** — free-text shift handoff notes.

### Day Overview (`/`)
Two collapsible sections, Unload and Load, each showing every active
truck/route as a card with day-schedule chips, coverage badges, and notes.
Dirty trucks sort to the top. Shift Notes (toggleable in Operations settings)
sit above both.

### Unload page
Dirty → single-click **Mark Unloaded** (no timed in-progress step for
unload). Sections: Dirty (route trucks / coverage spares / priority holds
split out), Unfinished, Needs Checked, Unloaded Today (sortable by Number or
Unload Order). "Unloaded Today" includes anything that's progressed to
`unloaded`/`in_progress`/`loaded` — it's a running tally of everyone unloaded
this shift, not just what's still `unloaded` right now.

### Load page
Unloaded → **Start Loading** (stamps `load_start_time`) → **Finish Loading**
(stamps `load_finish_time`, computes duration) → `loaded`. "Loaded Today" is
sortable by Number or Load Order (actual finish time, with a fallback to
`updated_at` for trucks that skipped the timed workflow).

### Fleet board (`/fleet`)
`Board.tsx` rendered with `fleetMode` — the full fleet at a glance, filterable
by status, with multi-select batch actions.

### Batches
Groups of trucks assigned a batch number + wearer count during unload.
Wearer cap comes from the `wearer_cap` Operations setting (falls back to
1800 if unset); "No wearer cap" setting removes the limit entirely.

---

## Operations settings (feature toggles)

Under Management → Operations (Workflows panel), all stored as `AppSetting`
key/value rows:

| Setting | Effect |
|---|---|
| `batching_disabled` | Hides the Batches workflow entirely |
| `batch_no_cap` / `wearer_cap` | Batch wearer capacity limit |
| `outside_timer_enabled` / `_minutes` | "Outside" countdown → auto-unload |
| `paper_bay_enabled` / `_minutes` | "Paper Bay" countdown → auto-load |
| `arrived_tracking_enabled` | Dev-only "Arrived" quick action |
| `note_cards_enabled` | Floating Note Cards drawer |
| `calendar_fab_enabled` / `calculator_fab_enabled` | Floating action buttons |
| `force_unloaded_on_new_day` | Force-unload every truck at day rollover |
| `shift_notes_enabled` | Show/hide the Shift Notes panel on Day Overview |
| `recurring_route_swaps` | Rules auto-applying coverage on given weekdays |
| `holiday_load_<date>` / `holiday_unload_<date>` / `holiday_mode_<date>` | Per-day holiday flags (persist forward until changed) |
| `daily_notes_<date>` | Shift handoff notes text |

---

## Local development

```powershell
.\run.ps1              # starts backend (uvicorn :8000) + frontend (vite :5180)
.\run.ps1 -Restart
.\run.ps1 -Stop
.\run.ps1 -NoBrowser
.\run.ps1 -NoMenu       # skip the interactive console (scripted/CI use)
```

After normal startup, `run.ps1` drops into an **interactive console menu**
(arrow keys / W-S / J-K to move, Enter to select, or press a number 1-9 to
jump straight to an item, Q/Esc to back out):

- Restart/Stop Frontend (Vite) or Backend (uvicorn) independently
- Restart All
- Open the app in a browser
- Tail either log
- Stop everything and exit, or leave services running and close the menu

It auto-skips (falls back to the old print-and-exit behavior) when
input/output is redirected or the host has no real console.

### Syncing local dev data from production
Management → Development → **Production Mirror Sync** → "Sync from live
production" (loopback-only). Mirrors the full production export into the
local DB — all core tables including `app_settings`, `route_swap_log`,
`spare_assignments`/`route_swaps` (full history, not just the latest day),
and `truck_notes`. Safe to re-run; it replaces local data with production's.

---

## Production deployment

Two deploy paths exist:

1. **GitHub Actions → GHCR → Portainer** — the CI workflow builds and pushes
   `build.<run_number>` images to GHCR; Portainer's stack (`rdyroute2`) pulls
   and redeploys via `docker_resolve.py portainer_redeploy` (called from
   `/updates/push` at the end of CI).
2. **Fast local build on the NAS** (`deploy-local.sh`) — builds images
   directly on the Docker host (TrueNAS), skipping GitHub Actions and the
   registry round-trip entirely. Much faster for iteration:
   ```bash
   git pull && ./deploy-local.sh          # build + recreate
   ./deploy-local.sh --build-only         # just rebuild the images
   ```
   Uses `docker-compose.prod.yml` + `docker-compose.localbuild.yml`
   (`pull_policy: never` so it can't accidentally fetch from GHCR).

A Docker-native watchdog container (`readyroutev2-watchdog`, inlined in
`docker-compose.prod.yml`'s `command:`) health-checks backend/frontend and
restarts either if it fails repeatedly. Windows-host-level equivalents
(`watchdog.ps1`, `keep-awake.ps1` + their install/uninstall task scripts) are
documented in the README's "Host reliability" section.

---

## Project structure

```
main.py                 FastAPI app entry point
models.py                SQLAlchemy ORM models
schemas.py                Pydantic request/response schemas
database.py               Engine, session factory, settings
activity_log.py           Structured audit-trail event logging
backups.py                Scheduled SQLite/Postgres backup loop
docker_resolve.py         Docker socket + Portainer API helper (redeploys, etc.)
routers/                  FastAPI routers, one per domain (trucks, spares,
                          route_swaps, batches, exports, settings, ...)
alembic/                  DB migrations (auto-runs on backend startup)
frontend/src/
  api/
    client.ts              Axios instance + todayIso()
    hooks.ts                All React Query hooks
  pages/                   Page components (Board, RunDay, Load, Unload, ...)
    runday/                 Day Overview sub-components (wizard, TruckCard)
    board/                  Fleet board sub-components
  components/               Shared components (Layout, Clock, modals, ...)
  utils/truckStatus.ts       Shared status/coverage logic (the single source
                             of truth used by Board, sidebar, and Day Overview)
  types.ts                   Shared TypeScript types
```

---

## Further reading

- [README.md](../README.md) — tech stack, local setup, Docker, versioning
- [CLAUDE.md](../CLAUDE.md) — gotchas and conventions for AI-assisted changes
- [CHANGELOG.md](../CHANGELOG.md) — dated history of shipped changes
