# Changelog

All notable changes to ReadyRoute V2 are documented here.  
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
