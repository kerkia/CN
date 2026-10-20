// The installable app (owner, 2026-10-20): the service worker /sw.js (the offline page, files shared to Ozimut, the Tracer's work
// without the network), the manifest in the site's language (manifest.webmanifest, manifest.en.webmanifest: same `id`),
// « Installer l'application » (the browser's own prompt where it offers one — Chrome, Edge, Android —, else how to: an iPhone's
// « Partager › Sur l'écran d'accueil »), and the files the app is given: a trace opened with Ozimut (the manifest's
// file_handlers: launchQueue) or shared to it (share_target: sw.js keeps them) wait in IndexedDB `ocn-inbox` until « Analyse
// solo » takes them (`takeInbox`) — after a login if need be. Nothing is sent anywhere.

import { lang } from "./i18n.js";

let prompt = null;                               // the browser's install prompt, kept for a click
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); prompt = e; changed(); });
window.addEventListener("appinstalled", () => { prompt = null; changed(); });
const changed = () => window.dispatchEvent(new Event("ocn:install"));

export const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** "installed" (opened as the app), "ready" (the browser offers it: `install`), "ios" (Safari's Share menu), else "other". */
export function installState() {
  if (standalone()) return "installed";
  if (prompt) return "ready";
  if (isIos()) return "ios";
  return "other";
}
/** The browser's prompt. -> true when accepted. */
export async function install() {
  if (!prompt) return false;
  const p = prompt;
  prompt = null;
  await p.prompt();
  const { outcome } = await p.userChoice.catch(() => ({ outcome: "dismissed" }));
  changed();
  return outcome === "accepted";
}

// ---- the files given to the app
const DB = "ocn-inbox";
function db() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore("files");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function inbox(mode, value) {
  const d = await db();
  try {
    return await new Promise((res, rej) => {
      const tx = d.transaction("files", "readwrite"), st = tx.objectStore("files");
      let out = null;
      if (mode === "put") st.put(value, "inbox");
      else { const g = st.get("inbox"); g.onsuccess = () => { out = g.result || null; if (out) st.delete("inbox"); }; }
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
    });
  } finally { d.close(); }
}
/** The files waiting for « Analyse solo » (then gone), or []. A day old, they are dropped. */
export async function takeInbox() {
  try {
    const rec = await inbox("take");
    return rec && Date.now() - rec.at < 864e5 ? rec.files || [] : [];
  } catch (e) { return []; }
}

/** At start: the worker, the manifest's language, files opened with the app. */
export function boot() {
  const link = document.querySelector('link[rel="manifest"]');
  if (link) link.href = lang() === "en" ? "manifest.en.webmanifest" : "manifest.webmanifest";
  if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  // the address the share or the file handler opened: its mark goes, the page stays
  const q = new URLSearchParams(location.search);
  if (q.has("recu")) history.replaceState(history.state, "", location.pathname + location.hash);
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const files = [];
      for (const h of params.files) { try { files.push(await h.getFile()); } catch (e) { /* unreadable: left out */ } }
      if (!files.length) return;
      try { await inbox("put", { at: Date.now(), via: "open", files }); } catch (e) { return; }
      received();
    });
  }
}
/** Files are waiting: « Analyse solo » takes them, open or opened now. */
function received() {
  if (/^#\/analyse(-solo|-perso)?(?:[?/]|$)/.test(location.hash)) window.dispatchEvent(new Event("ocn:inbox"));
  else location.hash = "#/analyse-solo";
}
