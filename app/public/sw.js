const CACHE = "ukr-proverbs-v3";
const SHELL = ["/", "/styles.css", "/fonts/spectral.css", "/app.js", "/manifest.webmanifest", "/data/proverbs.json", "/data/meta.json"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // network for API
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
    const copy = resp.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return resp;
  }).catch(() => caches.match("/"))));
});
