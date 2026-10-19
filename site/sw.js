// Ozimut's service worker, registered only when a Tracer user keeps an event for working without the network
// (assets/js/tracer/offline.js; owner, 2026-10-15: field work). Network first, always: online, every request goes to the
// network exactly as without it, so nothing stale is ever shown; only when the network fails does it answer from its copy —
// the site's page and code, the Tracer's libraries and fonts (/assets/vendor), and the few data files the pages open with. The API
// is never kept (the Tracer keeps its events itself, in IndexedDB), nor the runners' and races' files.

const CACHE = "ocn-offline-v1";
const DATA = ["/data/meta.json", "/data/runners.json", "/data/competitions.json", "/data/agenda.json", "/data/prov/index.json"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

function kept(url) {
  const u = new URL(url);
  if (u.origin === self.location.origin) {
    if (u.pathname === "/assets/build.txt") return false;          // the new-version check must reach the network or fail
    return u.pathname === "/" || u.pathname === "/index.html" || u.pathname.startsWith("/assets/") || u.pathname === "/favicon.svg" || DATA.includes(u.pathname);
  }
  return false;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !kept(req.url)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (hit) return hit;
      if (req.mode === "navigate") { const page = (await caches.match("/")) || (await caches.match("/index.html")); if (page) return page; }
      throw err;
    }
  })());
});
