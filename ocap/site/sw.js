// The app kept on the phone: its files served from the cache at once (and refreshed behind), so it opens instantly
// and without a network; data and live connections always go to the network.
const CACHE = "ocap-v2";
const SHELL = ["./", "index.html", "app.css", "icon.svg", "manifest.webmanifest",
  "js/app.js", "js/i18n.js", "js/settings.js", "js/util.js", "js/live.js", "js/prefs.js", "js/soon.js",
  "js/recent.js", "js/analysis.js", "icon-180.png", "icon-512.png"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys()
  .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")
    || url.pathname.startsWith("/data/")) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  }));
});
