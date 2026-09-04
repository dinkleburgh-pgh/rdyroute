import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { format } from "date-fns";
import { queryClient } from "./api/queryClient";
import { loadPersistedCache, startPersisting } from "./api/queryPersist";
import { emitToast } from "./utils/toastBridge";

console.info(
  `%cReadyRoute V2%c v${__APP_VERSION__}  ${__GIT_COMMIT__}  built ${format(new Date(__BUILD_DATE__), "PPpp")}`,
  "font-weight:bold;color:#38bdf8",
  "color:#94a3b8",
);

const DEV_SW_RESET_KEY = "readyroute:dev-sw-reset";
const isLocalDevOrigin = ["localhost", "127.0.0.1"].includes(window.location.hostname);

// When a new service worker takes over (skipWaiting + clientsClaim), the
// current page still holds references to old JS chunk hashes that no longer
// exist in the new precache → 404s → blank page.
// Reloading on controllerchange ensures the fresh HTML + fresh chunks load
// together, eliminating the blank-page-on-deploy problem.
if ("serviceWorker" in navigator && !isLocalDevOrigin) {
  let _reloading = false;
  const reloadNow = () => {
    if (_reloading) return;
    _reloading = true;
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The old instant reload dumped in-progress form input (wizard counts,
    // half-typed notes) whenever a deploy landed. Now: reload immediately only
    // when the tab is hidden (invisible, so free); otherwise offer a sticky
    // toast and finish the reload the next time the tab goes to background.
    if (document.visibilityState === "hidden") {
      reloadNow();
      return;
    }
    emitToast("Updated in the background — tap to reload when you're ready.", "info", {
      durationMs: 0,
      title: "New version ready",
      onClick: reloadNow,
    });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "hidden") reloadNow();
      },
      { once: true },
    );
  });

  // Proactively check for a new build so deploys reach already-open clients.
  // A foregrounded PWA otherwise never re-checks for a new service worker, so a
  // deploy wouldn't show until the user fully quits and relaunches. Ask the SW
  // to update when the app regains focus/visibility and every 60s; if a newer
  // SW is found it skipWaiting + clientsClaim → the controllerchange handler
  // above reloads to the fresh build.
  const checkForUpdate = () => {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("focus", checkForUpdate);
  setInterval(checkForUpdate, 60_000);
}

sessionStorage.removeItem(DEV_SW_RESET_KEY);

// Offline-first: hydrate the React Query cache from IndexedDB before the first
// render so pages show last-known data with no connection, then keep persisting.
async function boot() {
  // Best-effort with a hard deadline: a blocked IndexedDB (a stuck delete, a
  // browser profile in a bad state) used to hold this await forever and the
  // app booted to a permanently blank screen. Rendering with a cold cache
  // beats not rendering.
  await Promise.race([
    loadPersistedCache(queryClient).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  startPersisting(queryClient);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void boot();
