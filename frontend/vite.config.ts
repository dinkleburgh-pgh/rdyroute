import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8")) as { version: string };

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
        // Cache the app shell and all static assets
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Don't cache API or WebSocket traffic — handled at the app layer
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        runtimeCaching: [
          {
            // Network-first for the board API so fresh data is preferred when online
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
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
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
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
