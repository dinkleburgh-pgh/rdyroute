# Changelog

All notable changes to ReadyRoute V2 are documented here.  
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

> **Versioning**: builds are numbered `build.<N>` where N is the CI run number.  
> The major version is implicit in the product name (ReadyRoute **V2**).

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
