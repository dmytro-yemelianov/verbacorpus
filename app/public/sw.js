const CACHE = "ukr-proverbs-v36";
const SHELL = ["/", ...(self.location?.hostname === "pro.verbacorpus.org" ? [] : ["/pro/"]), "/site-shell.css", "/site-shell.js", "/styles.css", "/embroidery.css", "/fonts/spectral.css", "/fonts/spectral-400-normal-cyrillic.woff2", "/fonts/spectral-500-normal-cyrillic.woff2", "/app.js", "/chrome.js", "/manifest.webmanifest", "/data/landing.json", "/data/meta.json", "/data/proverbs.json"];

// Network-first for the app shell that changes on deploy (HTML pages, app.js, styles, i18n
// catalogs) so a new deploy shows immediately when online; cache-first for big/stable assets
// (data JSON, fonts, cards, icons), with a cache fallback everywhere when offline.
function isShell(p) {
  return p === "/" || /^\/(pro|contra|re|para|non)(\/|$)/.test(p) || p === "/corpora" || p === "/data/corpora.json" || p.endsWith(".html") || /^\/[a-z]{2}(\/|$)/.test(p) || p.startsWith("/bez-tabu/") || p === "/corpora.css" ||
    p.startsWith("/blog") || p === "/app.js" || p === "/chrome.js" ||
    p === "/site-shell.css" || p === "/site-shell.js" || p === "/styles.css" || p === "/embroidery.css" || p.startsWith("/i18n/");
}


self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // UPA has its own assets and POST APIs; a failed request must not become the
  // proverb application's cached homepage or enter its data cache.
  if (url.pathname === "/upa" || url.pathname.startsWith("/upa/") || url.pathname === "/non/upa" || url.pathname.startsWith("/non/upa/")) return;
  if (url.pathname.startsWith("/api/")) return; // network for API
  const cacheAnd = (resp) => { const copy = resp.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return resp; };
  if (isShell(url.pathname)) {
    // network-first: latest when online, cache (then "/") when offline
    const proPage = /^\/(?:[a-z]{2}\/)?pro\/?$/.test(url.pathname) || (url.pathname === "/" && ["q", "cat", "src", "sem"].some(k => url.searchParams.has(k)));
    e.respondWith(fetch(e.request).then(cacheAnd).catch(() => caches.match(e.request).then((r) => r || caches.match(proPage && self.location.hostname !== "pro.verbacorpus.org" ? "/pro/" : "/"))));
  } else {
    // cache-first for stable/large assets
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then(cacheAnd).catch(() => caches.match("/"))));
  }
});
