// Accounts: e-mail + password (functions/api/account/*). The server sets a signed, HttpOnly
// session cookie and the middleware refuses every data file without it, so the data really
// is private. The session kept here in localStorage is just who the visitor is, for the UI.

import * as data from "./data.js";

const KEY = "cnx.session";
const DAYS = 30;

/** "Marie-Anne  DUPONT" and "dupont marie anne" give the same key. */
export function nameKey(name) {
  return (name || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter(Boolean).sort().join(" ");
}
/** The club number (4 digits) of the logged-in runner, from their latest race. */
export function myClub() {
  const s = session();
  const r = s && data.isPrivateLoaded() ? data.runner(s.lic) : null;
  return r ? data.clubParts(r.club).code : null;
}
export const cleanLicence = (lic) => String(lic || "").replace(/\s+/g, "").replace(/^0+(?=\d)/, "");

export function session() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && s.lic && s.until > Date.now()) return s;
  } catch (e) {}
  return null;
}
function keep(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
}
export function forget() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}

/** POST JSON to a server endpoint -> { ok, status, data }. status 0: the server has no such endpoint. */
export async function api(path, body) {
  try {
    const r = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}), credentials: "same-origin",
    });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: data ? r.status : 0, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

/** Log in with e-mail and password. Resolves to the session; rejects with { code, message }. */
export async function accountLogin(email, password) {
  const r = await api("api/account/login", { email, password });
  if (r.ok) {
    const u = r.data;
    const s = { ...fromUser(u), until: Date.now() + DAYS * 86400e3 };
    keep(s);
    return s;
  }
  const code = r.status === 0 ? "unavailable" : r.status === 429 ? "rate" : r.data?.error || "generic";
  const err = new Error(code);
  err.code = ["invalid", "rate", "unverified", "disabled", "unavailable"].includes(code) ? code : "generic";
  throw err;
}

/** What the browser keeps of the account (the rights decide what the pages show). */
const fromUser = (u) => ({ lic: String(u.lic), nom: u.nom, email: u.email, admin: !!u.admin, analyst: !!u.analyst,
  agendaAllowed: !!u.agendaAllowed });
/** Re-read the account from the server: rights granted or withdrawn by the administrator apply at once. */
export async function refresh() {
  const s = session();
  if (!s) return null;
  try {
    const r = await fetch("api/account/me", { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) return s;
    const n = { ...s, ...fromUser(await r.json()) };
    keep(n);
    return n;
  } catch (e) {
    return s;
  }
}
export async function logout() {
  forget();
  try { await fetch("api/logout", { method: "POST", credentials: "same-origin" }); } catch (e) {}
}
