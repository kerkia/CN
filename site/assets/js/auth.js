// Login: "first name last name" + licence number.
//
// Two layers. Once hosted on Cloudflare Pages, the check runs on the server
// (functions/api/login.js): it sets a signed, HttpOnly session cookie, and the
// middleware refuses every data file without it, so the data really is private.
// Served locally (python http.server, no functions), the same rule is checked
// here in the browser against runners.json — convenient for development, but it
// only hides pages. The session kept here is just who the visitor is, for the UI.

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

const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.hostname.endsWith(".localhost");

/**
 * Try to log in. Resolves to the session, or rejects with a French message.
 * `wait` enforces a growing pause after failures, so guessing is slow.
 */
let failures = 0;
export async function login(name, licence) {
  const lic = cleanLicence(licence);
  if (!nameKey(name) || !lic) throw new Error("Saisissez votre prénom, votre nom et votre numéro de licence.");
  if (failures) await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** failures)));
  let who = null;
  if (!LOCAL) {
    const r = await fetch("api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, licence: lic }), credentials: "same-origin",
    });
    if (r.status === 429) throw new Error("Trop de tentatives : réessayez dans quelques minutes.");
    if (r.ok) who = await r.json();                   // { lic, nom }
  } else {
    await data.bootPrivate();                         // local development: the list is readable
    const r = data.runner(lic);
    if (r && nameKey(r.nom) === nameKey(name)) who = { lic, nom: r.nom };
  }
  if (!who) {
    failures++;
    throw new Error("Nom ou numéro de licence incorrect.");
  }
  failures = 0;
  const s = { lic: String(who.lic), nom: who.nom, until: Date.now() + DAYS * 86400e3 };
  keep(s);
  return s;
}

export async function logout() {
  forget();
  if (!LOCAL) { try { await fetch("api/logout", { method: "POST", credentials: "same-origin" }); } catch (e) {} }
}
