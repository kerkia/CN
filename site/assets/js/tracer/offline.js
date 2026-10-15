// Working without the network (owner, 2026-10-15: the field, the arena): an event kept on this device opens and is edited
// offline; its saves wait in IndexedDB (idb.js « pending ») and go to the server when the network returns, with the usual
// version check (a conflict asks which version to keep). Kept per event, on the user's choice (Fichier › Travailler hors
// ligne): the event and its map are stored as the server gives them to the team, encrypted again with the event's key when
// the team encrypted it; the site's page, code, libraries and fonts are kept by a service worker (/sw.js, network first: online
// nothing changes). The copies are dropped when the user stops working offline, and at logout unless changes still wait.

import * as IDB from "./idb.js";
import * as S from "./store.js";
import { FONT_CSS } from "./fonts.js";

const CACHE = "ocn-offline-v1";
const enc = new TextEncoder(), dec = new TextDecoder();
const FLAG = (id) => `ocn.tr.offline.${id}`;
export const isKept = (id) => { try { return localStorage.getItem(FLAG(id)) === "1"; } catch (e) { return false; } };
const TRACER = ["actions", "calage", "descr", "dialogs", "draw", "editor", "exports", "extras", "fonts", "geo", "gif", "idb", "layout", "mapsrc", "model", "offline",
  "panes", "pdf", "ppen", "race", "relay", "reports", "store", "symbols", "team", "textify", "tiff"].map((m) => `/assets/js/tracer/${m}.js`);
const CDN = "https://cdn.jsdelivr.net/npm";
const LIBS = [`${CDN}/pdf-lib@1.17.1/dist/pdf-lib.min.js`, `${CDN}/fflate@0.8.2/umd/index.js`, `${CDN}/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js`,
  `${CDN}/pdfjs-dist@4.10.38/build/pdf.min.mjs`, `${CDN}/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs`,
  `${CDN}/@fontsource/roboto@5.0.8/files/roboto-latin-400-normal.woff`, `${CDN}/@fontsource/roboto@5.0.8/files/roboto-latin-700-normal.woff`,
  `${CDN}/@fontsource/roboto-condensed@5.0.8/files/roboto-condensed-latin-400-normal.woff`, `${CDN}/@fontsource/roboto-condensed@5.0.8/files/roboto-condensed-latin-700-normal.woff`,
  ...FONT_CSS];
const PAGES = ["/", "/assets/js/pages/tracer.js", "/assets/tracer/symbols.json", "/assets/tracer/symbol-texts.json", "/data/agenda.json", "/data/prov/index.json"];

/** The service worker and the page's files, for opening the Tracer without the network. */
async function prepareSite() {
  if (!("serviceWorker" in navigator) || !window.caches) throw new Error("Ce navigateur ne permet pas le travail hors ligne.");
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  // what this visit loaded (the site's own modules, the data it opened with), the Tracer's modules and libraries
  const loaded = performance.getEntriesByType("resource").map((e) => e.name)
    .filter((u) => { try { const x = new URL(u); return (x.origin === location.origin && (x.pathname.startsWith("/assets/") || /^\/data\/(meta|runners|competitions)\.json$/.test(x.pathname))) || x.hostname === "cdn.jsdelivr.net"; } catch (e) { return false; } })
    .filter((u) => !u.includes("/assets/build.txt"));
  const urls = [...new Set([...PAGES.map((p) => location.origin + p), ...TRACER.map((p) => location.origin + p), ...LIBS, ...loaded])];
  const c = await caches.open(CACHE);
  let ok = 0;
  await Promise.all(urls.map(async (u) => {
    try { const r = await fetch(u, { credentials: "same-origin", mode: u.startsWith(location.origin) ? "same-origin" : "cors" }); if (r.ok) { await c.put(u, r); ok++; } } catch (e) { /* kept when next used */ }
  }));
  return { ok, total: urls.length };
}

/** Keep (or refresh) the event's copy: its card, the team's role, the event and its map, encrypted with the event's key. */
export async function keepEvent(E) {
  const seal = async (bytes) => (E.key ? S.encryptBytes(E.key, bytes) : bytes);
  const evBytes = await seal(enc.encode(JSON.stringify(E.ev)));
  await IDB.put("events", E.meta.id, { meta: E.meta, role: E.role, you: E.you, version: E.version, ev: evBytes, at: Date.now() });
  if (!(await IDB.get("maps", E.meta.id))) {
    const m = await S.loadMap(E.meta.id, E.key);
    if (m) await IDB.put("maps", E.meta.id, { bytes: await seal(m.bytes), type: m.type });
  }
}
/** The copy kept on this device: { meta, role, you, version, ev, map: { bytes, type } } (decrypted with the key), or null. */
export async function localEvent(id, key) {
  const rec = await IDB.get("events", id);
  if (!rec) return null;
  const open = async (bytes) => (S.isEncrypted(bytes) ? (key ? S.decryptBytes(key, bytes) : null) : bytes);
  const evBytes = await open(rec.ev);
  if (!evBytes) return { ...rec, locked: true };
  const pend = await IDB.get("pending", id);
  const map = await IDB.get("maps", id);
  const pendBytes = pend ? await open(pend.ev) : null;
  const ev = JSON.parse(dec.decode(pendBytes || evBytes));
  return { ...rec, ev, map: map ? { bytes: await open(map.bytes), type: map.type } : null, pending: !!pend, baseVersion: pend?.baseVersion ?? rec.version };
}
/** Events kept on this device (cards only). */
export async function keptEvents() {
  const ids = await IDB.keys("events");
  const out = [];
  for (const id of ids) { const r = await IDB.get("events", id); if (r) out.push({ ...r.meta, pending: !!(await IDB.get("pending", id)) }); }
  return out;
}
/** A save that could not reach the server: kept here until it can. */
export async function savePending(E, ev, baseVersion) {
  const bytes = enc.encode(JSON.stringify(ev));
  await IDB.put("pending", E.meta.id, { ev: E.key ? await S.encryptBytes(E.key, bytes) : bytes, baseVersion, at: Date.now() });
}
export async function pendingOf(id, key) {
  const p = await IDB.get("pending", id);
  if (!p) return null;
  const bytes = S.isEncrypted(p.ev) ? (key ? await S.decryptBytes(key, p.ev) : null) : p.ev;
  return bytes ? { ev: JSON.parse(dec.decode(bytes)), baseVersion: p.baseVersion, at: p.at } : null;
}
export const clearPending = (id) => IDB.del("pending", id);

/** Fichier › Travailler hors ligne. */
export async function offlineDialog(E) {
  const { modal } = await import("./dialogs.js");
  const kept = isKept(E.meta.id);
  const v = await modal(E, { title: "Travailler hors ligne", ok: kept ? "Ne plus garder" : "Garder sur cet appareil", body: kept
    ? `<p>Cet événement est gardé sur cet appareil : il s'ouvre sans réseau (le tracé et sa carte), et ce que vous y changez part au serveur dès que le réseau revient.</p>
      <p class="tr-hint">Ne plus le garder efface la copie de cet appareil (pas l'événement).</p>`
    : `<p>Gardez cet événement sur cet appareil pour l'ouvrir sans réseau, sur le terrain ou à l'aréna : la page de tracé, la carte et les circuits restent dans le navigateur ;
      vos modifications y attendent le réseau et partent ensuite au serveur (si quelqu'un a modifié l'événement entre-temps, vous choisirez la version à garder).</p>
      <p class="tr-hint">Ouvrez ensuite la page « Tracer » une fois sans réseau pour vérifier. La copie est effacée quand vous ne la gardez plus, et à la déconnexion sauf s'il reste des modifications à envoyer.${E.key ? " L'événement reste chiffré sur l'appareil." : ""}</p>` });
  if (!v) return;
  if (kept) {
    try { localStorage.removeItem(FLAG(E.meta.id)); } catch (e) { /* not kept */ }
    await IDB.del("events", E.meta.id); await IDB.del("maps", E.meta.id);
    await dropSiteIfUnused();
    E.toast("Copie hors ligne effacée de cet appareil.");
    return;
  }
  E.status("Préparation hors ligne…", "busy");
  try {
    const site = await prepareSite();
    await keepEvent(E);
    try { localStorage.setItem(FLAG(E.meta.id), "1"); } catch (e) { /* the copy stays, the flag not */ }
    E.status("Prêt", "ok");
    E.toast(`Événement gardé sur cet appareil (${site.ok} fichiers du site gardés). Il s'ouvre maintenant sans réseau.`, 7000);
  } catch (err) {
    E.status("Prêt", "ok");
    E.toast(`Travail hors ligne impossible : ${err.message}`, 7000);
  }
}
/** No event kept any more: the service worker and its copy of the site go too. */
async function dropSiteIfUnused() {
  if ((await IDB.keys("events")).length) return;
  try { if (window.caches) await caches.delete(CACHE); } catch (e) { /* none */ }
  try { const r = await navigator.serviceWorker?.getRegistration("/"); if (r) await r.unregister(); } catch (e) { /* none */ }
}
/** At logout: the copies go, except those whose changes still wait for the network. */
export async function dropCopies() {
  try {
    for (const id of await IDB.keys("events")) {
      if (await IDB.get("pending", id)) continue;
      await IDB.del("events", id); await IDB.del("maps", id);
      try { localStorage.removeItem(FLAG(id)); } catch (e) { /* none */ }
    }
    await dropSiteIfUnused();
  } catch (e) { /* nothing kept */ }
}
