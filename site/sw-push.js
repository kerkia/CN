// O'CN's push notifications (2026-10-18; assets/js/push.js registers it, functions/_lib/push.js sends): shows what the server
// pushed — { title, body, url, tag } — and opens its page when tapped. Registered on its own scope (/push/, which no page
// lives under) so that it never sees the site's requests and stays apart from the Tracer's offline worker (/sw.js, scope /).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "O'CN", {
    body: m.body || "", tag: m.tag || undefined, renotify: !!m.tag, data: { url: m.url || "/" },
    icon: "/assets/icon-192.png", badge: "/assets/badge-96.png", lang: m.lang || undefined,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    // a tab of the site already open: brought forward on the page; else a new one
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
    if (tab) {
      await tab.focus();
      if ("navigate" in tab) { try { await tab.navigate(url); return; } catch (err) { /* uncontrolled: below */ } }
      tab.postMessage({ type: "ocn-open", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// the browser renewed the subscription (rare): the page re-registers it at its next visit (push.js `sync`)
self.addEventListener("pushsubscriptionchange", () => {});
