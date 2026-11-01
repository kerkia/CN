// The guest pass (owner, 2026-11-01): a visit without an account reads the public data only with a pass the server gives
// after Cloudflare Turnstile (functions/api/guest.js; the gate asks for it, _middleware.js `guestPass`). Taken when one enters
// without an account, again before it runs out (the time it ends kept in localStorage `ocn.guest.exp`; the cookie itself
// is the server's, HttpOnly), and at once when the server refuses one. Turnstile's widget stays invisible unless Cloudflare
// wants a click: it then shows over the page's bottom with a line saying why. Without Turnstile's keys the server gives the
// pass unasked.
import * as auth from "./auth.js";
import { t, lang } from "./i18n.js";
import { loadTurnstile } from "./turnstile.js";

const EXP = "ocn.guest.exp";
const AHEAD = 30 * 60e3;                     // renewed half an hour before it runs out
const expOf = () => { try { return Number(localStorage.getItem(EXP)) || 0; } catch (e) { return 0; } };
let pending = null, timer = 0, keyP = null;

/** The pass held is good for a while yet. */
export const passValid = () => expOf() - Date.now() > AHEAD;
/** Forget the pass (leaving the visit, signing in). */
export function forgetPass() {
  clearTimeout(timer);
  try { localStorage.removeItem(EXP); } catch (e) { /* nothing kept */ }
}
/** A good pass for this visit without an account: the one held, else a new one (`force`: a new one anyway). */
export function ensurePass({ force = false } = {}) {
  if (!force && passValid()) { schedule(); return Promise.resolve(true); }
  return pending || (pending = obtain().finally(() => { pending = null; }));
}

const siteKey = () => keyP || (keyP = fetch("api/account/status").then((r) => r.json()).then((st) => st.turnstile || null)
  .catch(() => { keyP = null; return null; }));

async function obtain() {
  const key = await siteKey();
  const token = key ? await challenge(key) : "";
  const r = await fetch("api/guest", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstile: token }) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.exp) throw new Error(d?.error || `guest ${r.status}`);
  try { localStorage.setItem(EXP, String(d.exp)); } catch (e) { /* kept for the page only */ }
  schedule();
  return true;
}

/** Turnstile's token, its widget out of sight unless Cloudflare asks for a click. */
async function challenge(key) {
  const ts = await loadTurnstile();
  const box = document.createElement("div");
  box.className = "guest-check";
  box.innerHTML = `<p></p><div></div>`;
  box.querySelector("p").textContent = t("guest.check");
  document.body.append(box);
  try {
    return await new Promise((ok, ko) => {
      ts.render(box.querySelector("div"), { sitekey: key, action: "guest", language: lang(), appearance: "interaction-only",
        "before-interactive-callback": () => { box.classList.add("ask"); },
        callback: ok, "error-callback": () => ko(new Error("turnstile")), "timeout-callback": () => ko(new Error("turnstile")) });
    });
  } finally { box.remove(); }
}

function schedule() {
  clearTimeout(timer);
  const ms = expOf() - Date.now() - AHEAD;
  if (ms > 0) timer = setTimeout(() => { if (auth.guest()) ensurePass({ force: true }).catch(() => {}); }, Math.min(ms, 2 ** 31 - 1));
}
