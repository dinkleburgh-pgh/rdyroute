import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

console.info(
  `%cReadyRoute V2%c v${__APP_VERSION__}  ${__GIT_COMMIT__}  built ${new Date(__BUILD_DATE__).toLocaleString()}`,
  "font-weight:bold;color:#38bdf8",
  "color:#94a3b8",
);

// When a new service worker takes over (skipWaiting + clientsClaim), the
// current page still holds references to old JS chunk hashes that no longer
// exist in the new precache → 404s → blank page.
// Reloading on controllerchange ensures the fresh HTML + fresh chunks load
// together, eliminating the blank-page-on-deploy problem.
if ("serviceWorker" in navigator) {
  let _reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_reloading) return;
    _reloading = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
