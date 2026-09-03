/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      animation: {
        'slide-down': 'slideDown 0.25s ease-out',
      },
      keyframes: {
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      colors: {
        app:        "#07090d",
        surface:    "#161d2b",
        "surface-2":"#141a27",
        "surface-3":"#111722",
        track:      "#1c2434",
        ink:        "#f2f6fb",
        "ink-soft": "#cdd6e2",
        "ink-muted":"#8a96a8",
        "ink-faint":"#7a8698",
        accent:     "#3b82f6",
        // A real COLOUR (not just borderColor) so bg-hairline / ring-hairline
        // exist — they were silently dead classes on eight divider rules.
        hairline:   "rgba(255,255,255,0.06)",
        "st-dirty":       "#ef4444",
        "st-unfinished":  "#d946ef",
        "st-shop":        "#8b5cf6",
        "st-inprogress":  "#f59e0b",
        "st-unloaded":    "#22c55e",
        "st-loaded":      "#3b82f6",
        "st-off":         "#64748b",
        "st-oos":         "#6b7a90",
        "st-spare":       "#06b6d4",
        // Same hexes as st-* above — bg-status-dirty and text-st-dirty MUST
        // agree: the board showed two different reds for "Dirty" on one card.
        // (Two class spellings survive for now; one palette feeds both.)
        status: {
          dirty:      "#ef4444",
          unfinished: "#d946ef",
          shop:       "#8b5cf6",
          inprogress: "#f59e0b",
          unloaded:   "#22c55e",
          loaded:     "#3b82f6",
          off:        "#64748b",
          oos:        "#6b7a90",
          spare:      "#06b6d4",
        },
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      borderColor: {
        hairline: "rgba(255,255,255,0.06)",
      },
      boxShadow: {
        "inset-top": "inset 0 1px 0 rgba(255,255,255,0.04)",
        card: "0 6px 18px -12px rgba(0,0,0,0.7)",
        hero: "0 12px 34px -18px rgba(245,158,11,0.5)",
      },
      borderRadius: {
        pill: "999px",
      },
    },
  },
  plugins: [],
};
