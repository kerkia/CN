// An account's club and a race's organiser, for the organisers' pages (« Organisation »: the multi analyses of a
// competition, the results deposited for it). An organiser is a member of the race's organising club — the club of
// the account's latest race in the site's data — or an administrator (owner, 2026-10-15); a competition declared by its
// organiser (outside France: below) is managed by the account that declared it.

import { isAdmin } from "./api.js";

/** The club (4 digits) of the account's licence: that of its latest race in the site's data, or null. */
export async function clubOf(env, request, licence) {
  const lic = String(licence || "");
  if (!/^\d+$/.test(lic)) return null;
  try {
    const res = await env.ASSETS.fetch(new URL(`/data/fr/r/${Math.floor(Number(lic) / 10)}.json`, request.url));
    const rows = res.ok ? (await res.json())[lic] || [] : [];
    let best = null;
    for (const r of rows) if (r && typeof r[4] === "string" && (!best || r[4] > best[4])) best = r;
    const m = /^(\d{4})/.exec(best?.[9] || "");
    return m ? m[1] : null;
  } catch (e) { return null; }
}

/** The club number (4 digits) of a race's organiser ("0109 - O'BUGEY"), or null. */
export const orgCode = (org) => {
  const m = /^\s*(\d{3,4})\b/.exec(String(org || ""));
  return m ? m[1].padStart(4, "0") : null;
};

/** A race of « Résultats » (site/data/prov/index.json) by its key, or null. */
export async function raceOf(env, request, key) {
  try {
    const res = await env.ASSETS.fetch(new URL("/data/prov/index.json", request.url));
    return res.ok ? (await res.json()).races?.find((r) => r.key === key) || null : null;
  } catch (e) { return null; }
}

/** A competition of the agenda (site/data/fr/agenda.json) by its race key « a<id> », shaped as a race of the list; or null. */
export async function agendaRace(env, request, key) {
  const m = /^a(\d+)$/.exec(String(key || ""));
  if (!m) return null;
  try {
    const res = await env.ASSETS.fetch(new URL("/data/fr/agenda.json", request.url));
    const e = res.ok ? (await res.json()).events?.find((x) => x.kind === "c" && String(x.id) === m[1] && !x.cancelled) : null;
    return e ? { key: `a${e.id}`, name: e.name, date_iso: e.date, org: e.org, place: e.place } : null;
  } catch (e) { return null; }
}

// ---- competitions declared by their organisers (owner, 2026-10-20) ------------------------------------------------
// The countries whose calendar the site does not read: an organiser declares a competition (« Organisation »), then
// deposits its start list and results as France's organisers do. Kept in R2 (cn-state, declared/<id>.json, never deleted:
// status "removed"); the workflow copies the folder for the provisional results (ffco_scraper/prov/sources/declared.py),
// which publish it under its country, race key « d<id> ». Its organiser is the account that declared it (or an administrator).
export const DECLARED = "declared/";
/** A declared competition by its id, or null. */
export async function loadDeclared(env, id) {
  if (!env.BUCKET || !/^[a-z0-9]{6,20}$/.test(String(id || ""))) return null;
  const o = await env.BUCKET.get(`${DECLARED}${id}.json`);
  return o ? o.json().catch(() => null) : null;
}
/** A declared competition shaped as a race of the list (its key « d<id> »), or null; removed ones too with `removed`. */
export async function declaredRace(env, key, { removed = false } = {}) {
  const m = /^d([a-z0-9]{6,20})$/.exec(String(key || ""));
  const d = m ? await loadDeclared(env, m[1]) : null;
  if (!d || (d.status !== "active" && !removed)) return null;
  return { key: d.key, name: d.name, date_iso: d.date, place: d.place, org: d.club, country: d.country, owner: d.owner,
    terrain: d.terrain, epreuve: d.epreuve, site: d.site, declared: d };
}

/**
 * Any competition by its key: a declared one (« d<id> », from its declaration: who declared it is not published), else one
 * of « Résultats », else of the agenda (« a<id> »); or null.
 */
export async function findRace(env, request, key) {
  if (/^d/.test(String(key || ""))) return declaredRace(env, key);
  return (await raceOf(env, request, key)) || (await agendaRace(env, request, key));
}

/**
 * Is the account one of the race's organisers? An administrator; for a declared competition the account that declared it;
 * else a member of its organising club (the club of the account's latest race). `club` may give the account's club, known.
 */
export async function organises(env, request, user, race, club) {
  if (!race) return false;
  if (isAdmin(env, user)) return true;
  if (/^d/.test(race.key || "")) return Number(race.owner) === user.id;
  const code = orgCode(race.org);
  return !!code && (club !== undefined ? club : await clubOf(env, request, user.licence)) === code;
}
