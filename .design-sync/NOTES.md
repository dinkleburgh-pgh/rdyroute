# ReadyRoute design-sync notes

**This is a hand-assembled, OFF-SCRIPT sync — do NOT run `package-build.mjs` / the converter.**
ReadyRoute (`frontend/`) is a private Vite *app*, not a component library: no `module`/`main`/`exports` entry, no component barrel, and its components are coupled to react-query / router / auth / API, so they can't render standalone. The synced design system is therefore **tokens + fonts only** — no importable React components.

## What ships
- `styles.css` — entry: `@import`s IBM Plex (Google Fonts, remote), `tokens/tokens.css`, and `_ds_bundle.css`; sets the dark `<body>` canvas.
- `tokens/tokens.css` — hand-authored `:root --rr-*` semantic tokens (the full, canonical palette; utility classes are only partially compiled — see below).
- `_ds_bundle.css` — **ReadyRoute's real compiled Tailwind**, copied verbatim from `frontend/dist/assets/main-*.css` (a `frontend` build). Carries the real `.badge`/`.card`/`.btn-*`/`.input`/`.label` component classes + whatever utilities the app used.
- `_ds_bundle.js` — empty IIFE (`window.ReadyRoute = {}`); no exports by design.
- `components/Foundations/{Colors,Typography,Elements}/*.html` — hand-authored `@dsCard` preview cards.
- `README.md` = `.design-sync/conventions.md`.

## Durable sources (committed)
The `ds-bundle/` output is gitignored/regenerated. The hand-authored inputs live under **`.design-sync/bundle/`** (styles.css, tokens/, _ds_bundle.js, the cards) + `.design-sync/conventions.md`. Only `_ds_bundle.css` is regenerated from the frontend build.

## Re-sync recipe (no converter)
```sh
rm -rf ds-bundle && mkdir -p ds-bundle/fonts
cp -r .design-sync/bundle/* ds-bundle/
cp .design-sync/conventions.md ds-bundle/README.md
printf '{"by":"design-sync-cli"}' > ds-bundle/_ds_needs_recompile
(cd frontend && npm run build)
cp frontend/dist/assets/main-*.css ds-bundle/_ds_bundle.css   # exactly one main-*.css
# then finalize_plan(localDir=<abs ds-bundle>) + write_files per /design-sync §5
```

## Verification (how it was gated, since package-validate expects converter output)
Served `ds-bundle/` over HTTP and checked **computed styles** in-browser: body canvas `#07090d`, IBM Plex applied, `.badge` pill 999px, all 9 status badges show the right `--rr-st-*` color, `.card` = `#161d2b` + shadow, `.btn-primary` = `#2563eb`, `.input` border = slate-700. CSS `@import` closure verified (fonts + tokens + `_ds_bundle.css` all resolve). Fonts are remote (`[FONT_REMOTE]`-equivalent) — nothing self-hosted.

## Known gotchas
- Tailwind only compiles classes the app actually *uses*, so the `bg-st-*` utility family is **partial** (dirty/inprogress/loaded/shop/unloaded present; off/oos/spare/unfinished absent). The legacy `bg-status-*`/`text-status-*` family IS complete but uses the older values (`status.dirty #dc2626` ≠ `st-dirty #ef4444`). **Canonical color vocabulary = the `var(--rr-*)` tokens** (all defined, correct new values) — cards + conventions lead with those, not the utility classes.
- No `_ds_sync.json` anchor is shipped (hand-authored; no converter hash recipe). Correct + safe: the next sync just re-verifies everything.

## Re-sync risks
- **Token drift:** if `tailwind.config.js` colors/fonts/shadows change, `tokens/tokens.css` (hand-authored) and the README token table must be updated to match — they are NOT auto-derived from the config.
- **`_ds_bundle.css` is a full app rebuild's output** (~100 KB, includes Tailwind Preflight + every utility the app used). It changes whenever the app's class usage changes; that's fine, but it's not "just tokens."
- Fonts depend on Google Fonts being reachable at render time (no self-hosted fallback).
