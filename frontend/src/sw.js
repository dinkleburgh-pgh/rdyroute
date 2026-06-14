import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const navigationRoute = new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api/, /^\/ws/],
});
registerRoute(navigationRoute);

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "ReadyRoute", body: event.data.text() };
  }
  const title = payload.title || "ReadyRoute";
  const options = {
    body: payload.body || "",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/fleet" },
    icon: "/pwa-192x192.png",
    badge: "/pwa-64x64.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/fleet", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (!("focus" in client)) continue;
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(targetUrl);
        }
        return;
      }
      await self.clients.openWindow(targetUrl);
    }),
  );
});
