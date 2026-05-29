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
        // Default status colors. Dynamic overrides are injected at runtime
        // by StatusColorApplier in App.tsx via the status_badge_colors setting.
        status: {
          dirty:      "#dc2626",
          unfinished: "#ea580c",
          shop:       "#7400ff",
          inprogress: "#f59e0b",
          unloaded:   "#16a34a",
          loaded:     "#2563eb",
          off:        "#6b7280",
          oos:        "#475569",
          spare:      "#0e7490",
        },
      },
    },
  },
  plugins: [],
};
