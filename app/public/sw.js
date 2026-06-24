const CACHE = "ukr-proverbs-v23";
const SHELL = ["/", "/styles.css", "/fonts/spectral.css", "/fonts/spectral-400-normal-cyrillic.woff2", "/fonts/spectral-500-normal-cyrillic.woff2", "/app.js", "/chrome.js", "/manifest.webmanifest", "/data/landing.json", "/data/meta.json", "/data/proverbs.json"];

// Network-first for the app shell that changes on deploy (HTML pages, app.js, styles, i18n
// catalogs) so a new deploy shows immediately when online; cache-first for big/stable assets
// (data JSON, fonts, cards, icons), with a cache fallback everywhere when offline.
function isShell(p) {
  return p === "/" || p.endsWith(".html") || /^\/[a-z]{2}(\/|$)/.test(p) ||
    p.startsWith("/blog") || p === "/app.js" || p === "/chrome.js" ||
    p === "/styles.css" || p.startsWith("/i18n/");
}


self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // network for API
  const cacheAnd = (resp) => { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return resp; };
  if (isShell(url.pathname)) {
    // network-first: latest when online, cache (then "/") when offline
    e.respondWith(fetch(e.request).then(cacheAnd).catch(() => caches.match(e.request).then((r) => r || caches.match("/"))));
  } else {
    // cache-first for stable/large assets
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then(cacheAnd).catch(() => caches.match("/"))));
  }
});
