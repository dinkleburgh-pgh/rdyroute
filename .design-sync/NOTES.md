# ReadyRoute design-sync notes

**This is a hand-assembled, OFF-SCRIPT sync — do NOT run `package-build.mjs` / the converter.**
ReadyRoute (`frontend/`) is a private Vite *app*, not a component library: no `module`/`main`/`exports` entry, no component barrel, and its components are coupled to react-query / router / auth / API, so they can't render standalone. The synced design system is therefore **tokens + fonts only** — no importable React components.

## What ships
- `styles.css` — entry: `@import`s IBM Plex (Google Fonts, remote), `tokens/tokens.css`, and `_ds_bundle.css`; sets the dark `<body>` canvas.
- `tokens/tokens.css` — hand-authored `:root --rr-*` semantic tokens (the full, canonical palette; utility classes are only partially compiled — see below).
- `_ds_bundle.css` — **hand-authored** slim component + utility CSS (≈4.5 KB): the real `.badge`/`.card`/`.btn-*`/`.input`/`.label` classes (expanded from `src/index.css` `@apply`) + `.bg-st-*`/`.text-st-*` (all 9 statuses) + surface/ink/radii/shadow/font utilities, all mapped to `--rr-*`. **NOT** the app's compiled Tailwind — see the Tailwind-internals note below.
- `_ds_bundle.js` — empty IIFE (`window.ReadyRoute = {}`); no exports by design.
- `components/Foundations/{Colors,Typography,Elements}/*.html` — hand-authored `@dsCard` preview cards.
- `README.md` = `.design-sync/conventions.md`.

## Durable sources (committed)
The `ds-bundle/` output is gitignored/regenerated. **ALL** hand-authored inputs live under **`.design-sync/bundle/`** (styles.css, tokens/, `_ds_bundle.css`, `_ds_bundle.js`, the cards) + `.design-sync/conventions.md`. **There is no build step** — the whole system is hand-authored.

## Re-sync recipe (no converter, no build)
```sh
rm -rf ds-bundle && mkdir -p ds-bundle/fonts
cp -r .design-sync/bundle/* ds-bundle/
cp .design-sync/conventions.md ds-bundle/README.md
printf '{"by":"design-sync-cli"}' > ds-bundle/_ds_needs_recompile
# then finalize_plan(localDir=<abs ds-bundle>) + write_files per /design-sync §5
```

## Verification (how it was gated, since package-validate expects converter output)
Served `ds-bundle/` over HTTP and checked **computed styles** in-browser: body canvas `#07090d`, IBM Plex applied, `.badge` pill 999px, all 9 status badges show the right `--rr-st-*` color, `.card` = `#161d2b` + shadow, `.btn-primary` = `#2563eb`, `.input` border = slate-700. CSS `@import` closure verified (fonts + tokens + `_ds_bundle.css` all resolve). Fonts are remote (`[FONT_REMOTE]`-equivalent) — nothing self-hosted.

## Tailwind internals — the reason we DON'T ship the compiled CSS
The first sync shipped ReadyRoute's real compiled Tailwind (`frontend/dist/assets/main-*.css`) as `_ds_bundle.css`. It carried **65 distinct `--tw-*` internal custom properties (~215 declarations across selectors)** plus Preflight, which polluted the Claude Design **token pane** (the extractor scans `styles.css`'s `@import` closure and lists every custom property). Fix (2026-07): replaced it with the slim hand-authored component sheet so the closure defines **only** the 26 `--rr-*` tokens. Verified: `grep '\-\-' ` across `styles.css` + `tokens.css` + `_ds_bundle.css` yields only `--rr-*`. **Do not regenerate `_ds_bundle.css` from the app build** — that reintroduces the `--tw-*` noise. `@kind other` annotation was considered but the app-side format is undocumented; filtering (slim sheet) is deterministic.

## Known gotchas
- Color vocabulary = the `var(--rr-*)` tokens (canonical). The hand-authored `_ds_bundle.css` provides matching `.bg-st-*`/`.text-st-*` for all nine statuses (new values, `st-dirty #ef4444`). The app's own compiled CSS only emitted the `bg-st-*` classes it happened to use and kept a legacy `bg-status-*` (#dc2626) family — neither is shipped here.
- No `_ds_sync.json` anchor is shipped (hand-authored; no converter hash recipe). Correct + safe: the next sync just re-verifies everything.

## Re-sync risks
- **Token / class drift:** the whole DS is hand-authored. If `tailwind.config.js` (colors/fonts/shadows) or `src/index.css` (`.badge`/`.card`/`.btn-*`/`.input`/`.label` `@apply` rules) change, update `tokens/tokens.css`, `_ds_bundle.css`, and the README token table to match — they are NOT auto-derived from the app.
- **Never "regenerate from the build":** shipping `frontend/dist` CSS reintroduces the `--tw-*` token-pane pollution (see above). The slim `_ds_bundle.css` is the durable source of truth.
- Fonts depend on Google Fonts being reachable at render time (no self-hosted fallback).
