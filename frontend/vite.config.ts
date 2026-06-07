import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

function getGitCommit(): string {
  // Prefer env var injected by Docker build arg, fall back to live git
  if (process.env.VITE_GIT_COMMIT) return process.env.VITE_GIT_COMMIT;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as { version: string };
const appVersion = process.env.VITE_APP_VERSION || pkg.version;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "pwa-64x64.png", "pwa-192x192.png", "pwa-512x512.png", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "ReadyRoute V2",
        short_name: "ReadyRoute",
        description: "Warehouse load management system",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/board",
        icons: [
          { src: "pwa-64x64.png",            sizes: "64x64",   type: "image/png" },
          { src: "pwa-192x192.png",           sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png",           sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "apple-touch-icon-180x180.png", sizes: "180x180", type: "image/png" },
        ],
      },
      workbox: {
        // skipWaiting + clientsClaim make the new SW activate immediately.
        // The app (main.tsx) listens for the resulting 'controllerchange' event
        // and calls location.reload() so the new HTML + new JS chunks load
        // together — this is what prevents blank pages after a deploy.
        skipWaiting: true,
        clientsClaim: true,
        // Cache the app shell and all static assets
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Don't cache API or WebSocket traffic — handled at the app layer
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        // Do NOT cache API responses in the service worker.
        // React Query + the offline queue already handle stale-while-revalidate
        // and optimistic updates. Caching API responses in the SW creates a
        // second layer of staleness that races with React Query and can silently
        // serve stale board state for up to maxAgeSeconds after a network failure.
        runtimeCaching: [],
      },
      devOptions: {
        // Keep disabled in dev — the module-type service worker interferes with
        // Vite's HMR module graph and causes blank pages (especially on mobile).
        // Test PWA behaviour against the production build instead.
        enabled: false,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(process.env.VITE_BUILD_DATE ?? new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(getGitCommit()),
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 5180,
    strictPort: true,
    hmr: {
      host: "localhost",
      port: 5180,
      protocol: "ws",
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
      },
    },
  },
});
