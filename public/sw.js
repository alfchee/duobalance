const CACHE_NAME = "duobalance-shell-v1";
const SHELL = ["/", "/balances", "/offline.html", "/manifest.webmanifest", "/icons/192.svg", "/icons/512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.hostname.includes("supabase") || url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/v1/")) return;
  if (request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((response) => response || caches.match("/offline.html"))),
  );
});
