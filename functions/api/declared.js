// /api/declared — the competitions organisers declare where the site reads no calendar (owner, 2026-10-20: every orienteer,
// whatever their country; France's competitions come from FFCO's calendar). An account declares one in a country it has
// joined (an accepted membership, France apart), then deposits its start list and results under « Organisation »
// (functions/api/upload.js, race key « d<id> »), as France's organisers do. Kept in R2: declared/<id>.json (_lib/club.js),
// read by the provisional-results run, which publishes it under its country (ffco_scraper/prov/sources/declared.py).
//   GET                         the account's own (an administrator's: every one), and the countries it may declare in
//   POST { country, club, name, date, place, terrain, epreuve, site }   a new one
//   PUT  { id, …the same fields }                                        changed (its organiser, or an administrator)
//   DELETE { id }                                                        taken off: status "removed", its documents go
// A change starts a provisional-results run (upload.startRun) so that the site shows it within minutes.

import { allow, isAdmin, json, nowIso, parisToday, readBody, withUser } from "../_lib/api.js";
import { DECLARED, loadDeclared } from "../_lib/club.js";
import { memberships, validCountry } from "../_lib/countries.js";
import { randomBytes } from "../_lib/crypto.js";
import { startRun } from "./upload.js";

const TERRAINS = ["Forêt", "Sprint", "VTT", "Ski"];
const FORMATS = ["Sprint", "MD", "LD", "Nuit", "Autre"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAST_DAYS = 60, AHEAD_DAYS = 400;
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const newId = () => Array.from(randomBytes(10), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** The countries the account may declare in: its accepted memberships but France (every member country for an administrator). */
async function countriesFor(env, user) {
  const rows = await memberships(env, user.id);
  return rows.filter((r) => r.status === "ok" && r.country !== "FR").map((r) => ({ cc: r.country, club: r.club || "" }));
}

/** The fields of a declaration, checked; { error } when one is wrong. `before`: the competition being changed. */
function fields(b, allowed, admin, before = null) {
  const country = String(b.country || "").toUpperCase();
  if (country === "FR" || !validCountry(country) || (!admin && !allowed.some((c) => c.cc === country))) return { error: "country" };
  const name = clean(b.name, 120), place = clean(b.place, 80), club = clean(b.club, 80), date = String(b.date || "");
  if (name.length < 3) return { error: "name" };
  const today = parisToday();
  // a date in the window, or the one it had (a past competition keeps its day)
  if (!DAY.test(date) || ((date < addDays(today, -PAST_DAYS) || date > addDays(today, AHEAD_DAYS)) && date !== before?.date)) return { error: "date" };
  const site = clean(b.site, 300);
  if (site && !/^https?:\/\/[^\s]+$/i.test(site)) return { error: "site" };
  return { country, name, place, club, date, site,
    terrain: TERRAINS.includes(b.terrain) ? b.terrain : "", epreuve: FORMATS.includes(b.epreuve) ? b.epreuve : "" };
}

async function save(env, d) {
  await env.BUCKET.put(`${DECLARED}${d.id}.json`, JSON.stringify(d), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { id: d.id, owner: String(d.owner), country: d.country, date: d.date, status: d.status },
  });
}
async function listAll(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: DECLARED, cursor, include: ["customMetadata"] });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}
const view = (d, user) => ({ id: d.id, key: d.key, country: d.country, club: d.club, name: d.name, date: d.date, place: d.place,
  terrain: d.terrain, epreuve: d.epreuve, site: d.site, ownerName: d.ownerName, mine: d.owner === user.id, created: d.created, updated: d.updated });

export const onRequest = withUser(async ({ request, env }, user) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const admin = isAdmin(env, user);
  const allowed = await countriesFor(env, user);
  if (request.method === "GET") {
    const out = [];
    for (const o of await listAll(env)) {
      const m = o.customMetadata || {};
      if (m.status !== "active" || (!admin && Number(m.owner) !== user.id)) continue;
      const d = await loadDeclared(env, m.id);
      if (d) out.push(view(d, user));
    }
    out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    return json({ competitions: out, countries: allowed, admin });
  }
  const b = await readBody(request);
  if (!b) return json({ error: "bad request" }, 400);
  if (request.method === "POST") {
    if (!admin && !allowed.length) return json({ error: "country" }, 403);
    if (!(await allow(env, `declare:${user.id}`, 20, 86400))) return json({ error: "too many" }, 429);
    const f = fields(b, allowed, admin);
    if (f.error) return json(f, 400);
    const id = newId(), now = nowIso();
    const d = { id, key: `d${id}`, ...f, owner: user.id, ownerName: user.display_name || "", status: "active", created: now, updated: now };
    await save(env, d);
    return json({ ok: true, competition: view(d, user), soon: await startRun(env) });
  }
  // a change or a removal: the competition's organiser, or an administrator
  const d = await loadDeclared(env, String(b.id || ""));
  if (!d || d.status !== "active") return json({ error: "not found" }, 404);
  if (d.owner !== user.id && !admin) return json({ error: "not organiser" }, 403);
  if (request.method === "PUT") {
    if (!(await allow(env, `declare-edit:${user.id}`, 100, 86400))) return json({ error: "too many" }, 429);
    const f = fields(b, allowed.concat([{ cc: d.country }]), admin, d);     // its own country stays allowed
    if (f.error) return json(f, 400);
    const next = { ...d, ...f, updated: nowIso() };
    await save(env, next);
    return json({ ok: true, competition: view(next, user), soon: await startRun(env) });
  }
  if (request.method === "DELETE") {
    await save(env, { ...d, status: "removed", updated: nowIso() });
    return json({ ok: true, soon: await startRun(env) });
  }
  return json({ error: "method" }, 405);
});
