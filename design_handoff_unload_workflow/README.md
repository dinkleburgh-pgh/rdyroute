# Handoff: Unload Workflow Redesign

## Overview
A redesign of ReadyRoute's **Unload page** (`frontend/src/pages/Unload.tsx`). Same workflow semantics as the current page — dirty → unloaded, single click, no timed step — with a restructured section order, card layout, and an "Unloaded Today" tally grid.

## About the Design Files
The files in this bundle are **design references created in HTML** (a Design Component prototype), not production code. The task is to **recreate this design inside the existing ReadyRoute frontend** (React + TypeScript + Tailwind, Vite) using its established patterns: `PageHeader`, `WorkflowCard`/`AnimateCard`, React Query hooks (`useBoard`, `useUpsertTruckState`), and `utils/truckStatus.ts` for section membership. Do not ship the HTML directly.

## Fidelity
**High-fidelity.** Colors, spacing, and typography are final and expressed as the design system's CSS custom properties (see `tokens.css`, which mirrors the repo's compiled Tailwind theme). Map each `--rr-*` token to its Tailwind equivalent in the codebase rather than hardcoding hex values.

## Screen: Unload
- **Purpose**: crew marks returning dirty trucks unloaded, one click per truck, with undo.
- **Container**: single centered column, `max-width: 560px`, page padding `24px 16px`, vertical gap `16px` between sections, app background `--rr-app`.

### Header
- Eyebrow: `ReadyRoute · Unload` — 11px, uppercase, letter-spacing 0.14em, `--rr-ink-muted`.
- Title: `Unload — <day>'s ship` — 22px / 800 / -0.01em.
- Right: count badge `N to go` — `.badge` on `--rr-st-dirty`, white text. N = all not-yet-unloaded trucks across every section.

### Section order (IMPORTANT — this is the redesign's key change)
1. **Requested — priority hold** (label in `--rr-st-inprogress`, card `border-left: 3px solid var(--rr-st-inprogress)`)
2. **Unfinished** (label in `--rr-st-unfinished`, card border-left `--rr-st-unfinished`, action button is ghost style, label "Finish unload")
3. **Dirty — coverage** (coverage spares/route-swap trucks; card border-left `--rr-st-spare`; each card shows a `Cov. #N` badge on `--rr-st-spare` with dark ink `#04222b`)
4. **Dirty — route trucks** (plain cards, no accent border)
5. **Unloaded today** (always last)

Current production order is Dirty → Unfinished → Needs Checked → Unloaded; this design promotes Requested and Unfinished above all Dirty sections. Preserve the existing membership logic from `Unload.tsx` (`dirtyRoute` / `dirtyCoverages` / `requested` / `unfinished` / `unloaded` memos) — only the render order and styling change.

### Truck card (all dirty-family sections)
- `.card` surface (`--rr-surface`, 1px `--rr-hairline` border, radius ~12px, `--rr-shadow-card`), padding `12px 16px`, horizontal flex, gap 12px.
- Truck number: mono (`--rr-font-mono`), 22px / 800.
- Detail line: 12px, `--rr-ink-muted`, flex: 1 (e.g. "Route 4 — back 05:58").
- Action: primary button "Mark Unloaded".
- **Post-click state (undo affordance)**: the card stays in place; button is replaced by a `Unloaded` badge (`--rr-st-unloaded` bg, `#052e16` ink) plus a ghost "Undo" button. This mirrors the existing `recentlyUnloaded` session-set behavior — keep it.

### Unloaded today
- Header row: label `Unloaded today · N`, then two pill sort toggles right-aligned: `Number` and `Unload order` — 11px/700, pill radius, active pill gets `--rr-accent` border, inactive `--rr-hairline`.
- Grid: `repeat(4, 1fr)`, gap 8px. Each cell: 1px border `rgba(34,197,94,0.35)`, background `rgba(34,197,94,0.06)`, radius 10px, centered; mono truck number 17px/800 with time (or order proxy) below at 10px `--rr-ink-muted`.
- Sort semantics as today: "Number" = truck number asc; "Unload order" = session order / `updated_at` fallback.

## Interactions & Behavior
- Mark Unloaded: optimistic, instant; card flips to Unloaded+Undo in place and the truck simultaneously appears in the tally grid. No animation required beyond the existing AnimateCard entrance.
- Undo: reverts status to dirty, removes from tally.
- Sections with zero trucks render nothing (no empty headers).
- At high volume (30–40 dirty trucks) the design intentionally stays a single column — verified acceptable; do not add columns.

## State Management
Reuse the page's existing state: React Query board data, `recentlyUnloaded: Set<number>`, `unloadedSort: "number" | "order"`, `useUpsertTruckState` mutation. No new server state is needed.

## Design Tokens (see tokens.css for values)
- Surfaces: `--rr-app`, `--rr-surface`, `--rr-surface-2`, `--rr-track`, `--rr-hairline`
- Ink: `--rr-ink`, `--rr-ink-soft`, `--rr-ink-muted`, `--rr-ink-faint`
- Status: `--rr-st-dirty`, `--rr-st-inprogress`, `--rr-st-unloaded`, `--rr-st-spare`, `--rr-st-unfinished`
- Accent: `--rr-accent`; pill radius: `--rr-radius-pill`; fonts: `--rr-font-sans` (IBM Plex Sans), `--rr-font-mono` (IBM Plex Mono)
- Green tally cells use literal `rgba(34,197,94,…)` — the unloaded green at low alpha.

## Assets
None — text and CSS only.

## Files
- `UnloadWorkflow.dc.html` — the design reference (template markup + a `Component` logic class holding demo state; read the markup for layout, the class for behavior).
- `tokens.css` — semantic token definitions.
- `support.js`, `ds-base.js` — prototype runtime only; ignore for implementation.
