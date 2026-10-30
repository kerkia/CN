// /api/tracking — the live GPS tracking of a competition run by another service (owner, 2026-10-24, after the live tracking
// study: private artifact https://claude.ai/artifact/Y2kZZiMHpZsiPBczSaTVcb). Ozimut tracks nobody itself: an organiser gives
// the link to the page of the service they use (Loggator, GPSSeuranta, TracTrac, Livelox, Routechoices…), and Agenda,
// Résultats and En direct show it as a button. No third party's data passes through Ozimut, only the link.
//   GET                    every link of a competition from TRACK_PAST days ago on: { links: [{ race, url, name, date, mine }] };
//                          a visitor without an account too (owner, 2026-10-30: the links are public, `mine` false)
//   POST { race, url }     sets the competition's link (its organisers only, as a deposit: _lib/club.js `organises`)
//   DELETE { race }        removes it (its organisers)
// `race` is a competition's key: the agenda's « a<id> », a declared « d<id> », or a race of « Résultats ». Kept in R2
// (cn-state, tracking/<race>.json, the link in the object's custom metadata so that the list is one R2 list).
import { allow, currentUser, isAdmin, json, nowIso, readBody, withUser } from "../_lib/api.js";
import { findRace, organises } from "../_lib/club.js";

const PREFIX = "tracking/";
const RACE = /^[a-z][a-z0-9-]{1,40}$/;
const TRACK_PAST = 30;                         // days: a link stays listed this long after its competition (the replays stay online)
const MAX_URL = 500;

/** A tracking page's address: an https link, no spaces, no credentials; else null. */
function cleanUrl(s) {
  const v = String(s || "").trim();
  if (v.length > MAX_URL || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.href : null;
  } catch (e) { return null; }
}

async function listAll(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: PREFIX, cursor, include: ["customMetadata"] });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const user = env.DB ? await currentUser(request, env) : null;
  {
    const since = new Date(Date.now() - TRACK_PAST * 86400e3).toISOString().slice(0, 10);
    const links = [];
    for (const o of await listAll(env)) {
      const m = o.customMetadata || {};
      if (!m.race || !m.url || (m.date || "") < since) continue;
      let name = "";
      try { name = decodeURIComponent(m.name || ""); } catch (e) { /* none */ }
      links.push({ race: m.race, url: m.url, name, date: m.date || "", mine: !!user && Number(m.by) === user.id });
    }
    // the pages read it once a visit, again after 5 minutes at most (each read counts on the Functions' daily quota)
    return json({ links }, 200, { "Cache-Control": "private, max-age=300" });
  }
}

export const onRequest = withUser(async ({ request, env }, user) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  const b = await readBody(request);
  const key = String(b?.race || "");
  if (!RACE.test(key)) return json({ error: "bad competition" }, 400);
  const race = await findRace(env, request, key);
  if (!race) return json({ error: "unknown competition" }, 404);
  if (!(await organises(env, request, user, race))) return json({ error: "not organiser" }, 403);
  if (request.method === "POST") {
    const url = cleanUrl(b.url);
    if (!url) return json({ error: "bad url" }, 400);
    if (!isAdmin(env, user) && !(await allow(env, `tracking:${user.id}`, 30, 86400))) return json({ error: "too many" }, 429);
    const name = String(race.name || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 120);
    const date = String(race.date_iso || "");
    await env.BUCKET.put(`${PREFIX}${key}.json`, JSON.stringify({ race: key, url, name, date, org: race.org || "", by: user.id, updated: nowIso() }), {
      httpMetadata: { contentType: "application/json" },
      // (custom metadata travels as HTTP headers: the name percent-encoded)
      customMetadata: { race: key, url, date, name: encodeURIComponent(name), by: String(user.id) },
    });
    return json({ ok: true, link: { race: key, url, name, date, mine: true } });
  }
  if (request.method === "DELETE") {
    await env.BUCKET.delete(`${PREFIX}${key}.json`);
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
});
