importScripts("/sw-assets.js");

const CACHE_NAME = `duobalance-shell-${self.__DUOBALANCE_PRECACHE_VERSION__}`;
const SHELL = self.__DUOBALANCE_PRECACHE__;

self.addEventListener("install", (event) => {
  // cache.addAll() rejects the whole install if a single asset 404s or
  // errors. Cache each asset independently so one bad entry in SHELL
  // doesn't leave the service worker permanently uninstalled.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        SHELL.map((url) =>
          cache.add(url).catch((err) => console.error(`sw: failed to precache ${url}`, err)),
        ),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || "DuoBalance", {
      body: payload.body || "You have a bill reminder.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/bills" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/v1/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const documentPaths = [
          url.pathname,
          url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, ""),
          url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`,
        ];
        let cachedDocument;
        for (const path of documentPaths) {
          cachedDocument = await caches.match(new URL(path, self.location.origin).href);
          if (cachedDocument) break;
        }
        return cachedDocument || caches.match("/offline.html");
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cachedAsset) => cachedAsset || fetch(request)),
    );
  }
});
