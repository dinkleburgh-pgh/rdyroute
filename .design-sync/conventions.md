# ReadyRoute — design system (tokens + fonts)

ReadyRoute is a truck / linen dispatch app. This system ships its **design language**, not components: the dark surface + status-color palette, IBM Plex type, radii, shadows, and ReadyRoute's compiled utility + component classes. Style new UI with these — there are no importable React components in this system.

## Setup

Load `styles.css`. It pulls in IBM Plex (Google Fonts), the design tokens (`tokens/tokens.css`), and ReadyRoute's compiled Tailwind (`_ds_bundle.css`), and sets the app-shell defaults on `<body>`: the near-black canvas (`--rr-app`), primary ink (`--rr-ink`), and IBM Plex Sans. For any custom container, apply the same three:

```css
background: var(--rr-app);
color: var(--rr-ink);
font-family: var(--rr-font-sans);
```

The whole system is **dark** — there is no light theme.

## Styling idiom

Color, type, radii, and elevation are **CSS custom properties** — the canonical, complete vocabulary (defined in `tokens/tokens.css`). Prefer these when composing new UI.

| Token | Value | Use |
|---|---|---|
| `--rr-app` | `#07090d` | page canvas |
| `--rr-surface` | `#161d2b` | cards / panels |
| `--rr-surface-2` / `--rr-surface-3` | `#141a27` / `#111722` | nested / deepest surface |
| `--rr-track` | `#1c2434` | rails / input wells |
| `--rr-accent` | `#3b82f6` | accent |
| `--rr-ink` / `-soft` / `-muted` / `-faint` | `#f2f6fb` / `#cdd6e2` / `#8a96a8` / `#7a8698` | text ramp (primary → faint) |
| `--rr-st-dirty` | `#ef4444` | status: needs unload |
| `--rr-st-inprogress` | `#f59e0b` | status: in progress |
| `--rr-st-unloaded` | `#22c55e` | status: unloaded |
| `--rr-st-loaded` | `#3b82f6` | status: loaded |
| `--rr-st-unfinished` | `#d946ef` | status: unfinished |
| `--rr-st-shop` | `#8b5cf6` | status: in shop |
| `--rr-st-spare` | `#06b6d4` | status: spare |
| `--rr-st-off` | `#64748b` | status: off |
| `--rr-st-oos` | `#6b7a90` | status: out of service |
| `--rr-hairline` | `rgba(255,255,255,.06)` | 1px borders |
| `--rr-radius-pill` | `999px` | badges / chips |
| `--rr-shadow-card` / `-hero` / `-inset-top` | — | elevation |
| `--rr-font-sans` / `--rr-font-mono` | IBM Plex Sans / Mono | UI / numerics, codes, truck IDs |

ReadyRoute also ships **component classes** (in `_ds_bundle.css`) — use them directly:

- **`.badge`** — pill chip (`--rr-radius-pill`, 10px bold). Color it: `<span class="badge" style="background: var(--rr-st-loaded); color:#fff">Loaded</span>`.
- **`.card`** — surface panel: `--rr-surface`, hairline border, `--rr-shadow-card` + `--rr-shadow-inset-top`, padding.
- **`.btn-primary`** (blue), **`.btn-ghost`** (slate), **`.btn-danger`** (red).
- **`.input`**, **`.label`** (uppercase micro-label above a field).

`styles.css` also carries matching **utility classes** for the tokens: surfaces (`.bg-app`, `.bg-surface`, `.bg-surface-2` / `-3`, `.bg-track`, `.bg-accent`), ink (`.text-ink`, `.text-ink-soft` / `-muted` / `-faint`), the full status set (`.bg-st-*` and `.text-st-*` for all nine statuses), plus `.border-hairline`, `.rounded-pill`, `.shadow-card` / `-hero` / `-inset-top`, and `.font-sans` / `.font-mono`. For anything outside this set, use standard Tailwind (which Claude Design provides) alongside the `var(--rr-*)` tokens for color.

## Where the truth lives

- `styles.css` — the entry (imports fonts, tokens, and the compiled CSS). Every design consumes this file's `@import` closure.
- `tokens/tokens.css` — the full token reference.
- `_ds_bundle.css` — the component + utility classes (hand-authored, token-mapped; no Tailwind internals).
- Foundation cards (**Colors**, **Typography**, **Elements**) — the visual reference.

## Example

```jsx
<div style={{ background: "var(--rr-app)", color: "var(--rr-ink)",
              fontFamily: "var(--rr-font-sans)", minHeight: "100vh", padding: 24 }}>
  <div className="card" style={{ maxWidth: 320 }}>
    <div className="label">Truck</div>
    <div style={{ fontFamily: "var(--rr-font-mono)", fontSize: 30, fontWeight: 800 }}>#68</div>
    <div style={{ color: "var(--rr-ink-muted)", fontSize: 13, marginTop: 6 }}>
      Covered by <span style={{ color: "var(--rr-st-spare)", fontWeight: 700 }}>#1</span> · previous run day
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <span className="badge" style={{ background: "var(--rr-st-loaded)", color: "#fff" }}>Loaded</span>
      <button className="btn-primary">Assign coverage</button>
    </div>
  </div>
</div>
```
