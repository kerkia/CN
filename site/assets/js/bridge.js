// The move to ozimut.com (owner, 2026-10-19). Everything a browser keeps belongs to one address, so the old one
// (ocn.kerkia.com, which keeps serving the site) sends each visitor on to the new one with what they would otherwise lose:
//   leave()   on the old address, before anything is drawn: reads the settings this browser keeps (an allowlist below), asks
//             the server for a one-time hand-off token when signed in (/api/account/handoff: signed, valid 60 s, once), and
//             opens https://ozimut.com/#oz=<payload> - the page asked for, the settings, the token. The part after « # » is never
//             sent to a server. It stays put while the Tracer still has work waiting for the network in this browser.
//   arrive()  on the new address: takes the payload out of the address at once, stores the settings it does not have yet,
//             exchanges the token for a session, and reloads on the page asked for, so the language and the theme apply.
// The old address keeps serving everything as before (its data and API are not redirected: a page held there by the Tracer's
// waiting work must still be able to send it); the server's side is functions/api/account/handoff.js.
// Local test: localStorage["ocn.bridgeTo"] = "http://127.0.0.1:8788" on http://localhost:8788 makes localhost the old address.

import { t, tn } from "./i18n.js";
import * as auth from "./auth.js";

const OLD = ["ocn.kerkia.com"];              // the old addresses (the server's own list: wrangler.toml OLD_HOSTS)
const NEW = "https://ozimut.com";
const MARK = "#oz=";
// what is carried over: preferences and the work kept in this browser, nothing that names a secret or a server
const KEEP = [/^cnx\.(theme|state)$/, /^ocn\.lang$/, /^ocn\.nav\./, /^ocn\.(vma|relay|games\.best|liveCountry|push\.later)$/,
  /^ocn\.(an|sh|tr)\.prefs$/, /^ocn\.an\.cal/, /^ocn\.tr\.beta$/, /^ocn\.beta\.(multi|direct)$/, /^ocn\.tr\.field\./];
// never, whatever KEEP says: another server for « En direct » (a crafted link could point it anywhere), an AI provider's key
const NEVER = [/^ocn\.liveBase$/, /^ocn\.ia\.byok$/, /^cnx\.session$/];
const MAX = 60000;                           // characters of payload: a phone browser's address bar takes far more, but stay sane
const allowed = (k) => KEEP.some((re) => re.test(k)) && !NEVER.some((re) => re.test(k));

function target() {
  try {
    const test = localStorage.getItem("ocn.bridgeTo");
    if (test && ["localhost", "127.0.0.1"].includes(location.hostname)) return test.replace(/\/+$/, "");
  } catch (e) { /* no storage: no test */ }
  return OLD.includes(location.hostname) ? NEW : null;
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function squeeze(text) {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream === "undefined") return "j" + b64(raw);
  const out = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
  return "z" + b64(new Uint8Array(out));
}
async function unsqueeze(s) {
  const bytes = unb64(s.slice(1));
  if (s[0] === "j") return new TextDecoder().decode(bytes);
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
  return new TextDecoder().decode(out);
}

/** The Tracer's saves and field photos still waiting for the network in this browser (they belong to this address). */
async function tracerWaiting() {
  try {
    if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === "ocn-tracer")) return 0;
    const IDB = await import("./tracer/idb.js");
    return (await IDB.keys("pending")).length + (await IDB.keys("photos")).length;
  } catch (e) {
    return 0;
  }
}

function say(html) {
  const main = document.getElementById("main");
  if (main) main.innerHTML = `<div class="card" style="max-width:560px;margin:48px auto;padding:22px 24px;line-height:1.55">${html}</div>`;
}
/** A line above the page, which the app then draws as usual. */
function banner(text) {
  const b = document.createElement("div");
  b.className = "bridge-note";
  b.setAttribute("role", "status");
  b.textContent = text;
  document.body.prepend(b);
}

/** On the old address: true when the visitor is being sent on (the app must not start). While the Tracer still has work
 *  waiting for the network here, the app starts as usual under a line that says why the move waits. */
export async function leave() {
  const to = target();
  if (!to) return false;
  const waiting = await tracerWaiting();
  if (waiting) {
    banner(tn("bridge.waiting", waiting));
    return false;
  }
  say(`<p>${t("bridge.moving")}</p>`);
  const s = {};
  try {
    const keys = Object.keys(localStorage).filter(allowed);
    // the calibrations last: they are the first left behind when the payload would grow too long
    keys.sort((a, b) => Number(a.startsWith("ocn.an.cal")) - Number(b.startsWith("ocn.an.cal")));
    for (const k of keys) s[k] = localStorage.getItem(k);
  } catch (e) { /* no storage: nothing to carry */ }
  let token = null;
  if (auth.session()) {
    const r = await auth.api("api/account/handoff", {});
    if (r.ok) token = r.data?.token || null;
  }
  const pack = async () => squeeze(JSON.stringify({ v: 1, r: location.hash || "", s, t: token }));
  let payload = await pack();
  const big = Object.keys(s).filter((k) => k.startsWith("ocn.an.cal")).reverse();
  while (payload.length > MAX && big.length) { delete s[big.shift()]; payload = await pack(); }
  location.replace(`${to}/${MARK}${payload}`);
  return true;
}

/** On the new address: true when a visitor just arrived through the bridge (the page reloads). */
export async function arrive() {
  if (!location.hash.startsWith(MARK)) return false;
  const payload = location.hash.slice(MARK.length);
  history.replaceState(null, "", location.pathname);              // the token leaves the address bar and the history at once
  let p = null;
  try { p = JSON.parse(await unsqueeze(payload)); } catch (e) { p = null; }
  const route = typeof p?.r === "string" && p.r.startsWith("#/") ? p.r : "#/";
  if (p?.v === 1) {
    for (const [k, v] of Object.entries(p.s || {})) {
      if (!allowed(k) || typeof v !== "string") continue;
      try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch (e) { break; }
    }
    if (typeof p.t === "string" && !auth.session()) await auth.handoffLogin(p.t);
  }
  location.replace(`${location.pathname}${route}`);
  location.reload();
  return true;
}
