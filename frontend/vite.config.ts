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
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET || apiProxyTarget.replace(/^http/i, "ws");

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
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
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: wsProxyTarget,
        ws: true,
      },
    },
  },
});
