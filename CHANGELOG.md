# Changelog

All notable changes to ReadyRoute V2 are documented here.  
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
