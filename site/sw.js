// Ozimut's service worker (scope /), registered on every visit by app.js since 2026-10-20 (the installable app, owner). It does
// three things, and nothing else:
// - a page asked for without the network gets offline.html (kept at install) instead of the browser's error;
// - « Partager › Ozimut » (the manifest's share_target, a phone's GPS trace or map photo) posts to /partage: the files go
//   to IndexedDB `ocn-inbox` and the app opens « Analyse solo » on them (inbox.js) — nothing leaves the device;
// - the Tracer's work without the network (assets/js/tracer/offline.js; owner, 2026-10-15: field work), only while a Tracer
//   event is kept on this device, i.e. while the cache CACHE exists: network first, always — online, every request goes to the
//   network exactly as without it, so nothing stale is ever shown; only when the network fails does it answer from its copy:
//   the site's page and code, the Tracer's libraries and fonts (/assets/vendor), and the few data files the pages open with.
//   The API is never kept (the Tracer keeps its events itself, in IndexedDB), nor the runners' and races' files.
// Push notifications are another worker, /sw-push.js, on its own scope.

const CACHE = "ocn-offline-v1";                 // the Tracer's copy (offline.js makes and drops it)
const SHELL = "ocn-shell-v2";                   // the offline page
const OFFLINE = "/offline";                     // Pages serves offline.html there (its .html address redirects)
// (France's files in /data/fr/ since 2026-10-22; the countries' index and the provisional results at the root)
const DATA = ["/data/meta.json", "/data/fr/meta.json", "/data/fr/runners.json", "/data/fr/competitions.json", "/data/fr/agenda.json",
  "/data/prov/index.json"];

self.addEventListener("install", (e) => e.waitUntil((async () => {
  const c = await caches.open(SHELL);
  await c.add(OFFLINE).catch(() => {});
  await self.skipWaiting();
})()));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("ocn-shell-") && k !== SHELL) await caches.delete(k);
  if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
  await self.clients.claim();
})()));

// whether the Tracer's copy exists: null until known (read at start, then told by offline.js at each change)
let tracerOn = null;
caches.has(CACHE).then((v) => { tracerOn = v; }).catch(() => { tracerOn = false; });
self.addEventListener("message", (e) => { if (e.data?.type === "ocn-offline") tracerOn = !!e.data.on; });

function kept(url) {
  const u = new URL(url);
  if (u.origin === self.location.origin) {
    if (u.pathname === "/assets/build.txt") return false;          // the new-version check must reach the network or fail
    return u.pathname === "/" || u.pathname === "/index.html" || u.pathname.startsWith("/assets/") || u.pathname === "/favicon.svg" || DATA.includes(u.pathname);
  }
  return false;
}

/** The Tracer's network first: the answer copied when the copy exists; from the copy when the network fails. */
async function tracerFetch(req, preload) {
  const on = tracerOn ?? (tracerOn = await caches.has(CACHE));
  try {
    const res = (await preload) || (await fetch(req));
    if (on && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
    return res;
  } catch (err) {
    if (on) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate", cacheName: CACHE });
      if (hit) return hit;
      if (req.mode === "navigate") { const page = (await caches.match("/", { cacheName: CACHE })) || (await caches.match("/index.html", { cacheName: CACHE })); if (page) return page; }
    }
    if (req.mode === "navigate") { const page = await caches.match(OFFLINE, { cacheName: SHELL }); if (page) return page; }
    throw err;
  }
}

/** A share: its files kept for the app, which opens « Analyse solo » on them. */
async function share(req) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter((f) => f && typeof f === "object" && f.size);
    if (files.length) await inboxPut(files);
  } catch (e) { /* nothing kept: the page opens empty */ }
  return Response.redirect("/?recu=partage#/analyse-solo", 303);
}
function inboxPut(files) {
  return new Promise((res, rej) => {
    const q = indexedDB.open("ocn-inbox", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("files");
    q.onerror = () => rej(q.error);
    q.onsuccess = () => {
      const tx = q.result.transaction("files", "readwrite");
      tx.objectStore("files").put({ at: Date.now(), via: "share", files }, "inbox");
      tx.oncomplete = () => { q.result.close(); res(); };
      tx.onerror = () => rej(tx.error);
    };
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === "/partage") { e.respondWith(share(req)); return; }
  if (req.method !== "GET") return;
  if (req.mode === "navigate") { e.respondWith(tracerFetch(req, e.preloadResponse)); return; }
  if (!kept(req.url) || tracerOn === false) return;                // nothing kept: the browser alone, as without a worker
  e.respondWith(tracerFetch(req));
});
