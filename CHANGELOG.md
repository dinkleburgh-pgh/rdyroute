# Changelog

All notable changes to ReadyRoute V2 are documented here.  
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Versioning**: builds are numbered `build.<N>` where N is the CI run number.  
> The major version is implicit in the product name (ReadyRoute **V2**).

---

## [Unreleased] — 2026-06-27

### Added
- **Offline-first** — the app now works without a connection after one online load. Reads: the React Query cache is persisted to IndexedDB (`api/queryPersist.ts`), hydrated before first render (`main.tsx`), and served offline (`networkMode: "offlineFirst"`, 24h `gcTime`) so every page renders last-known data. Writes: a single axios interceptor (`api/client.ts`) queues any mutation that fails with a network error and resolves it as success; `useOfflineSync` replays the whole queue in order on reconnect (last-write-wins, discards 4xx). Generalizes the previous shortage-only queue to all mutations; auth/update/export endpoints are excluded. Repeated `PUT`/`PATCH` to the same endpoint coalesce so replay skips stale intermediate states, and rejected (4xx) replays raise a "couldn't be synced" toast. Pairs with the existing service worker (app shell) and offline indicator. (Tablets must load once online to warm the cache.)
- **Recurring route-swap rules** — define coverage that repeats on chosen load days (e.g. "route 4 loads on 70 every Fri") in the Route Swap tool. Stored in the `recurring_route_swaps` app setting and **auto-applied** when each matching day's board is initialized (`apply_recurring_swaps` in `routers/spares.py`, called from `_ensure_day_initialized`). Creates the same `SpareAssignment` coverage as a manual swap, so it flows through Load, next-day Unload, and all coverage displays. Idempotent — never clobbers a manual swap.
- **Load "Coverage today" notice** — a collapsible banner at the top of the Load page listing each active coverage as `route → loads on → truck`, with a `recurring` tag on auto-applied ones, so loaders know which route's freight goes on which truck.
- **Verify Short Sheet — holiday mode** — a Holiday toggle adds a second-day selector and expands the sheet to the full 38 routes: main-day routes plus the routes off the main day (which run the second day). Each card shows a day tag.

### Changed
- **Wearers cap** — the per-batch wearer cap default is raised 400 → 1800 and is now configurable via a new "Wearers cap" number setting in Management → Operations (`wearer_cap`). Backend enforcement and the batch UI both read it. The "No wearer cap" toggle now also bypasses the cap server-side (it was previously frontend-only).
- **Coverage card — paired headline** — a covering truck's card now leads with `route → truck` (e.g. `4 → 17`, route number first) instead of the tiny `→ Cov.` pill, so the coverage is legible. The covered route's card keeps a compact `← Cov. #X` badge.
- **Mobile bottom nav** — bottom bar is now Fleet Sch. · Audit · Communications · Short Sheet; Management moved into the "More" menu.
- **Run Day holiday load label** — now reads `Day N + N+1` (load gets ahead on the next ship day) to match the sidebar/board; unload keeps `Day N-1 + N` (catching up on the previous day).
- **Snappier card animations** — `AnimateCard` entrance shortened (0.35s→0.14s, smaller rise) and the stagger delay hard-capped, so boards load and re-render far faster; honors OS reduce-motion.
- **Setup wizard counts** — load/unload route counts now include OOS routes (a covered OOS route still runs), fixing e.g. 27 → 28 for Friday.
- **Route Swap tool** — Route/Load-On dropdowns align evenly on mobile (hint text drops on small screens).

### Fixed
- **Inline shortage item buttons animation-looping** on the in-progress page — `ItemGrid` was defined inside `HierarchyPicker`, so it got a new component identity every render and remounted the buttons (replaying their entrance fade endlessly on each board refetch/WS tick). Hoisted it to module level.
- **Unload progress could exceed total** (e.g. 29/28) — numerator now counts "done" from the same context as the denominator, so a spare covering an off-day route can't push it over.
- **Dirty-page card badges overflowing** — coverage badges compacted and the card columns constrained so chips stay inside the card.
- **Duplicate "Arrived" marker on the fleet board** (desktop) — the top badge is now hidden where the bottom action row already shows it; same guard applied to the Outside / Paper Bay markers.

---

## [Unreleased] — 2026-06-26

### Added
- **Production Mirror Sync — authentication** — the dev "Sync from live production" tool now logs into production with configured admin credentials (`PRODUCTION_SYNC_USERNAME` / `PRODUCTION_SYNC_PASSWORD`), minting a fresh JWT per run and sending it as a Bearer token to the admin-protected export endpoints. Fixes the `401 Unauthorized` on `backup.zip`.
- **Production Mirror Sync — private LAN access** — the loopback hard-block now also accepts RFC1918 private addresses (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) on both the frontend gate and the backend, so the dev tool can be reached from another device on the LAN. Public hostnames (e.g. `rdyroute.app`) remain blocked.
- **"Covered by" badge** — a covered route truck's card now shows an amber `← Covered by #X` badge (reverse of the covering truck's `→ Cov. #X`), so swapped/covered cards are no longer blank.

### Changed
- **Unload / Load denominator = fleet schedule running count** — progress denominators now equal the concrete number of routes scheduled to run that day (non-spare trucks not scheduled off). Route swaps no longer add or remove from the count — a scheduled route always runs (covered when needed). Only a Spare physically taking over a route removes it. Applied consistently across the sidebar, Load page, RunDay, and LiveInProgress.
- **Sidebar Spare count** — now counts every available (non-OOS) spare, including idle spares sitting unloaded, instead of only spares actively covering an OOS route.
- **Fleet board number colour** — the big truck number is greyed out for trucks off the **load** day (done for tomorrow); **U Off** trucks (off only the unload day) keep their real workflow-status colour.
- **OOS → unloaded** — marking a truck OOS now moves its daily status straight to `unloaded` so its route counts as done on the unload board (the `is_oos` flag is kept; the board still shows it as OOS). Dev stand-in for a future "notice to unload it" flow.

### Fixed
- **Route-swap denominator undercount** — swapping a route between two scheduled trucks no longer drops either route from the unload/load totals (was subtracting covered routes, e.g. showing 29 instead of 33).

---

## [Unreleased] — 2026-06-25

### Added
- **ToolFab** — single draggable wrench FAB replaces individual FAB buttons. Clicking opens a speed-dial wheel with enabled tools (Calculator, Notes, Fleet Schedule) arranged in a rotational arc. Position saved per-user.
- **Calculator FAB** — full-featured workflow calculator with 50%/80% buttons, pack↔piece conversion for 5 hardcoded items, calculation tape/memory, "Use" button to copy result. Full-screen on mobile.
- **Calendar FAB** — opens Fleet Schedule in a floating drawer. Compact mode shows only Route + Load + Unload day columns on mobile; clickable bouncing arrow expands to all 5 days.
- **NoteCardsDrawer "Reminders" tab** — shows yesterday's unreturned spares, today's active spares, route swaps, and routes off today.
- **Personal notes with sections** — My Notes tab now supports add/remove titled sections with auto-resizing textareas, stored as JSON.
- **Items management** — Items is now its own management card with a "Configure Items" tab. Pack unit labels and per-unit piece counts are editable. Five default items (Terrys/Grids, White Micros, Red Shops, Black Aprons, White Aprons) with bag sizes ship as defaults.
- **Trends expansion** — new ShortageKpiSection, QualityRateCard, trend direction badges on all chart cards, enhanced TrendDetail pages with summary KPIs, new backend shortage summary and quality rate endpoints.
- **Operations settings** — Calculator FAB toggle, Calendar FAB toggle, "Assume all trucks unloaded by next start day" setting all in Settings → Workflows.
- **Notices moved to Communications card** in Settings — frees up space for the standalone Items card.
- **Draggable FABs** — pointer-event-based drag wrapper saves position per user to localStorage. FABs stay above overlays (z-[70]).
- **Persistent collapse state** — Board collapsible sections (unloaded/dirty/oos/spare views) persist their open/closed state in localStorage.

### Changed
- **Login page** — removed "Continue as Guest" button; guest sessions are ephemeral (never persisted to localStorage). Sidebar shows "Login" for guest users instead of "Logout".
- **Items panel redesign** — compact pill layout with Bag/Case toggle per item. Click label to edit name/bag amount. Trash2 icon for delete (hover only).
- **Board "Needs Checked"** — trucks with `needs_checked=true` now only appear in the "Needs Checked" section, excluded from Dirty/Unfinished/Coverage sections (fixes double-counting).
- **Effective status** — permanently OOS trucks with raw "dirty" status and no coverage truck now fall through to their raw status instead of "oos", so they appear in the dirty workflow.
- **System events** — Setup Day and setup truck events are attributed to "System" actor instead of the admin user who triggered them.

### Fixed
- **Dirty count discrepancy** — sidebar and Board dirty counts now match (was off by 3 for permanently OOS trucks with raw dirty status). Removed the frontend "off yesterday → unloaded" rule (backend auto-seed already handles this correctly with proper `used_yesterday` data). Removed `coveredRouteNumbers` skip so covered route trucks count with their own status.
- **Trend polarity** — trend status labels now correctly reflect that fewer removals = improvement. Down trend = "Improving", up trend = "Critical".
- **Calculator "C" button** — clears display + tape history.
- **Notes drawer height** — fixed height prevents header jumping when switching tabs.
- **FAB z-index** — FABs raised to z-[70] so clicking an open FAB closes its panel.
- **Fleet Schedule vertical scroll** — fixed overflow-hidden preventing scroll.
- **Weekend freeze** (from previous session) — workdayNumbers Sat/Sun freeze to Friday.

### Removed
- **Off-yesterday→unloaded rule** — frontend `effectiveStatus` no longer overrides "dirty" to "unloaded" for trucks that were off the previous workday. The backend auto-seed in `_ensure_day_initialized` already handles this with correct `used_yesterday` context.
- **`coveredRouteNumbers` skip** — `buildRouteStatusCounts` no longer excludes covered route trucks; they count with their own status.
- **Guest login option** — removed "Continue as Guest" from login page (hidden behind setting re-add).

---

## [Unreleased] — 2026-06-16

### Changed
- **Load / unload counting unified** — sidebar progress, Load page progress, Day Overview progress, and "left" cards now use one coverage-aware route-slot model. Covered routes count once, the covering truck owns the slot, and covered OOS routes no longer inflate totals or leak into the wrong left-card bucket.
- **README local-dev notes updated** — documented `run.ps1 -Restart`, `-Stop`, and `-NoBrowser`, plus the Windows-specific frontend startup behavior.

### Fixed
- **`run.ps1` frontend restart reliability** — frontend startup now prefers `npm.cmd`, waits for an actual HTTP response on `127.0.0.1:5180`, retries Vite once if it does not come up cleanly, and no longer aborts on raced `taskkill` cleanup for dead listener PIDs.
- **Stray Vite crash artifact** — `frontend/vite.err` is now ignored and removed from the tracked tree.

---

## [build.138] — 2026-06-08

### Added
- **Paper Bay timer** — new 25-minute countdown on the fleet board that auto-transitions a truck to "loaded" when it expires. Toggle in Settings → Workflows. Displays as a violet countdown widget. Cancels any active Outside timer for the same truck on start and expiry. Persisted in localStorage (`rr_paper_bay_timers`).
- **`paper_bay_enabled` setting** — registered as a known key in `settings.py`; readable by all authenticated users; toggle in WorkflowsPanel.

### Changed
- **Outside timer label** — fleet dropdown now reads "⏱ Outside (20 min)" to match the actual 20-minute countdown (was incorrectly labeled as 15 min).
- **useOutsideTimer.ts refactored** — extracted generic `useTimedStatusTransition` hook shared by Outside and Paper Bay timers; localStorage helpers unified; doc comments updated.
- **WorkflowsPanel** — removed "Dev feature:" prefix from Outside timer and Note Cards hints; added Paper Bay timer toggle.

---

## [Unreleased] — 2026-06-07

### Security / Infrastructure
- **JWT stored in httpOnly cookie** (`readyroutev2_jwt`) — removed JWT from localStorage; login/logout/refresh all set/clear the cookie; `get_current_user` accepts Bearer token (legacy) or cookie; `client.ts` falls back to localStorage only if still present.
- **DB-backed login rate limiter** — `LoginAttempt` table (ip, timestamp) replaces in-memory dict; survives restarts; hourly prune via lifespan cleanup task.
- **Settings endpoints require auth** — all 4 CRUD routes now require a valid session; non-admins see only their own `personal_note_` key + a whitelist of readable settings; writes require admin except own personal note.
- **SECRET_KEY hard-fail on startup** — Postgres deployment raises `RuntimeError` if `SECRET_KEY` is the default dev value; SQLite warns instead.
- **Non-root Docker user** — `appuser` added in Dockerfile with configurable `DOCKER_GID`; container no longer runs as root.
- **Resource limits** — `deploy.resources.limits` added to backend (1 CPU / 512 MB) and frontend (0.5 CPU / 128 MB) in `docker-compose.prod.yml`; all overridable via env vars.
- **CORS credentials guard** — `allow_credentials=False` when `allow_origins=["*"]`; startup warning emitted.

### Added
- **Alembic migrations** — inline `ALTER TABLE` in lifespan replaced by `alembic upgrade head`; `alembic/` initialized with `render_as_batch=True` for SQLite; initial schema migration generated and stamped.
- **ErrorBoundary** — glassmorphism error page with ambient glow, emoji icon (🗺️/🔒/💥), HTTP status chip, Go Back + Home buttons; added as `errorElement` on all three route groups.
- **PWA blank-page fix** — `controllerchange` event listener in `main.tsx` triggers `window.location.reload()` when a new service worker takes over; spinner shown in `ProtectedRoute` while auth state loads.
- **Supervisor OOS Route Cards** — `/supervisor` page shows a card per OOS truck: covered trucks display covering truck # / status badge / Remove button; uncovered trucks show a grouped dropdown (Last Used ★, Spare Trucks, Off Today, Other) + Assign button.
- **Board OOS inline assignment** — Board `?status=oos` view replaces the separate RouteCardPanel with per-card inline assignment: tap a card to expand a grouped truck picker + Assign; covered cards show covering truck # / Remove inline.

### Changed
- **Auth flow** — `AuthContext` no longer reads localStorage token on boot; uses `/auth/me` cookie check; `loading` state gates `ProtectedRoute` rendering; `setSession` takes `StoredUser` only.

---

## [Unreleased] — 2026-06-02

### Added
- **Settings → Advanced → Connections tab** — live health panel showing Main Backend (status, version, uptime, Python, API round-trip) + Primary Database (type, query latency, URL, pool stats) + one card per configured backup DB.
- **`GET /health/detail`** — detailed backend health endpoint; probes primary DB via existing engine and each `BACKUP_DATABASE_URL` entry via a disposable engine; masks credentials in displayed URLs.
- **`BACKUP_DATABASE_URL` env var** — comma-separated list of backup/replica DB URLs; populated in `.env.production` with the UltraSeedbox PostgreSQL connection.
- **Production DB config corrected** — `DATABASE_URL` → TrueNAS local Docker PostgreSQL (`ix-postgres-postgres-1`); `BACKUP_DATABASE_URL` → UltraSeedbox (`blaze-direct.usbx.me:36409`).
- **Driver notes** — QR-token CRUD page (`/driver/:token`): drivers can add Always / Workday / Set Until… notes for their own route; multi-day workday selection fires one POST per day; delete restricted to driver-authored notes only.
- **`GET /notes/driver/{token}/info`** — returns `{ truck_number }` so the driver page always shows the correct route number even with no notes.
- **NoteCardsDrawer filter** — Show All / Today Only pill toggle; "Today Only" hides notes not relevant to the current load day.
- **LAN QR testing** — Vite `--host` flag exposes frontend on LAN; `VITE_PUBLIC_URL` env var bakes the LAN IP into QR codes; `publicBase()` helper used throughout.

### Changed
- **Build versioning** — scheme changed from semver (`0.1.<N>`) to `build.<N>`; major version is implicit in the product name. Backend reads `APP_VERSION` env var (injected by CI); sidebar shows `build <N>` in production and `dev` locally.
- **Note type labels** — "Constant" → "Always", "One-off" → "Set Until…" across Notes.tsx and DriverNotes.tsx.

---

## [Unreleased] — 2026-05-29

### Added
- **`unfinished` truck status** — full stack support (Python `TruckStatus` enum, Tailwind `bg/text-status-unfinished` orange `#ea580c`, frontend `TruckStatus` union, status maps, sort orders in `Board.tsx` / `RunDay.tsx` / `Layout.tsx`).
- **Unload workflow** — `Mark Unfinished` button on dirty cards moves a truck to the new Unfinished section, which exposes `Mark Unloaded` and `Back to Dirty` actions.
- **Dirty board sub-section** — non-fleet `filter=dirty` board now renders an "Unfinished" sub-section beneath the dirty trucks with a large centered orange header and live count.
- **Fleet rail filter** — `Unfinished` chip added to the fleet rail filter list (`FLEET_RAIL_STATUSES`).
- **Display role override** — `nate` is shown with a purple `Lead` badge in the Layout sidebar and Communications avatar (admin permissions unchanged).
- **Fleet card route info** — every fleet card now shows the covered/swapped route number (e.g. `rt #42 (cov)` / `rt #42 (swap)`) so coverage is visible at a glance.
- **OOS-covering spare lifecycle** — spares covering an OOS route are bucketed in the fleet filter under their actual lifecycle status (dirty/unloaded/loaded/in_progress) instead of always counting as "spare".

### Changed
- **`unfinished` removed from sidebar live-status stack** — keeps the Unfinished count out of the always-visible sidebar; the count surfaces in the dirty page sub-section instead.
- **Status display order** — Dirty → Unfinished → Unloaded → In Progress → Loaded → Spare → Off → OOS everywhere (sidebar, fleet rail, sort orders).
- **Unload page button colors** — Batch buttons are blue (`btn-primary`), Mark Unloaded buttons are emerald green, Mark Unfinished stays orange.
- **`RouteSwapModal`** — two-way swap removed; readout enlarged (route number in red, load-on in blue, arrow between).
- **Communications** — Team-only channel; `RoleBadge` accepts a `username` for per-user overrides.
- **Tracked items hierarchy** — `Aprons`, `Dust Mops`, `Towels` migrated under `Bulk` (`Bulk > Aprons`, `Bulk > Dust Mops`, `Bulk > Towels`). Top-level audit/shorting categories are now `3x10`, `3x5`, `4x6`, `Paper`, `Bulk`.

### Fixed
- Dirty board no longer renders a duplicate "Dirty" header — the page heading covers the first group; only the Unfinished sub-section header is rendered inline.
- `unfinished` is correctly excluded from `_PERSISTENT_STATUSES` and auto-off pooling (only `dirty`/`unloaded` trip the scheduled-off override).

### Internals
- `Board.tsx` non-fleet `filter=dirty` view filters include unfinished trucks; an IIFE injects a sentinel header row above the unfinished cards so they render as a labeled sub-section within the same grid.
- Dev DB migration script (one-off PowerShell + Python) rewrote 21 entries in the `tracked_items_map` `app_settings` row to use `Bulk > …` categories.

---

## [Unreleased] — 2026-05-25

### Added
- **Fleet Management panel** in Settings (fleet/ATL only)
  - Truck number dropdown loads selected truck's settings
  - Inline type selector (Uniform / Dust / Spare)
  - Active toggle
  - Remove truck with confirm step
  - Add truck form with number + type
- **Auto-OFF pooling**: non-Spare trucks scheduled off on the current load day with status `dirty` or `unloaded` are automatically surfaced in the Off filter — no manual status change needed
- **In Progress sidebar**: shows active truck number in yellow (`#N`) with pulse dot when a load is running; shows "None" otherwise
- **OFF filter page**: 5-column grid with large cards and oversized truck numbers for at-a-glance scanning

### Changed
- Truck type label removed from fleet board cards — type is now managed in Settings › Fleet Management
- Fleet status dropdown excludes `off` and `in_progress` options (those states are set via other flows)
- Off-day section in FleetTruckEditor hidden for Spare trucks
- Load day computation uses `workdayNumbers().loadDay` (next ship day) instead of today's ship day

### Fixed
- `todayIso()` now uses local wall-clock date instead of UTC (prevented midnight-UTC date flip breaking US evening shifts)
- Spares excluded from auto-OFF pooling (`truck_type !== "Spare"` guard added in all three effectiveStatus locations: `Board.tsx`, `Layout.tsx`, `RunDay.tsx`)
- JSX parse error in `FleetTruckEditor` — missing closing `}` after conditional `<div>` block
- Fleet board cards restored dropdown for all trucks after accidental removal
- SQLite `truck_type` values normalized to lowercase enum names (`uniform`, `dust`, `spare`) — titlecase values (`Uniform`, `Dust`, `Spare`) caused SQLAlchemy `LookupError` on load

### Internals
- `workdayNumbers()` imported and called before sidebar count memos in `Layout.tsx` and `RunDay.tsx`
- `flag_modified(truck, "scheduled_off_days")` added to fleet PATCH route so JSON column mutations are detected by SQLAlchemy
