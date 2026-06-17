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
        "st-dirty":       "#ef4444",
        "st-unfinished":  "#d946ef",
        "st-shop":        "#8b5cf6",
        "st-inprogress":  "#f59e0b",
        "st-unloaded":    "#22c55e",
        "st-loaded":      "#3b82f6",
        "st-off":         "#64748b",
        "st-oos":         "#6b7a90",
        "st-spare":       "#06b6d4",
        // Legacy status colors — keep for backward compat
        status: {
          dirty:      "#dc2626",
          unfinished: "#c026d3",
          shop:       "#7400ff",
          inprogress: "#f59e0b",
          unloaded:   "#16a34a",
          loaded:     "#2563eb",
          off:        "#6b7280",
          oos:        "#475569",
          spare:      "#0e7490",
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
  plugins: [require("@tailwindcss/container-queries")],
};
