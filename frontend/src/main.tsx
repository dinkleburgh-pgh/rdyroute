import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

console.info(
  `%cReadyRoute V2%c v${__APP_VERSION__}  ${__GIT_COMMIT__}  built ${new Date(__BUILD_DATE__).toLocaleString()}`,
  "font-weight:bold;color:#38bdf8",
  "color:#94a3b8",
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
