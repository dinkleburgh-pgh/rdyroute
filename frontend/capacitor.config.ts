import type { CapacitorConfig } from "@capacitor/cli";

// Set CAPACITOR_SERVER_URL to your hosted server before running `npx cap sync`.
// Example: $env:CAPACITOR_SERVER_URL = "https://rdyroute.example.com"
// When set, the WebView loads the live site (same-origin: no CORS or cookie issues).
// When unset, the WebView loads the bundled dist/ assets (useful for offline testing).
const serverUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.readyroutev2.app",
  appName: "ReadyRoute",
  webDir: "dist",
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: !serverUrl.startsWith("https://"),
        },
      }
    : {}),
  android: {
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: "automatic",
  },
};

export default config;
