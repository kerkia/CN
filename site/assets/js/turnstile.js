// Cloudflare Turnstile (functions/_lib/turnstile.js): the one script the site loads from another host — it cannot be served
// by the site itself, it is Cloudflare's check —, only when the server has its keys: on the registration form (owner,
// 2026-10-20) and when a visit without an account takes its guest pass (guestpass.js; owner, 2026-11-01).
const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let load = null;
export const loadTurnstile = () => load || (load = new Promise((ok, ko) => {
  const s = document.createElement("script");
  s.src = TURNSTILE; s.async = true; s.onload = () => ok(window.turnstile); s.onerror = () => { load = null; ko(new Error("turnstile")); };
  document.head.append(s);
}));
