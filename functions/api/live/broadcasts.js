// /api/live/broadcasts — the races an organiser feeds live from their timing software (« Organisation › Direct »,
// pages/orgdirect.js; every account since 2026-10-15, owner). GET lists them (each with `mine`: the account opened it;
// the opener's account number to administrators only; its MeOS password, `mop`, to the opener and administrators);
// POST { name, date, organizer, key } opens one and answers its number (from 900 000 000, apart from liveresultat's), at
// most PER_DAY a day per account, with a MeOS password for MeOS's online results (api/live/mop.js, 2026-10-22); POST
// { op: "mopkey", id } gives one's broadcast a new MeOS password (the former one stops working). The register is kept
// by the live relay's directory (live/, Worker « ocn-live », Durable Object « Directory », bound here as LIVE_DIR),
// reached at an internal path.
//
// A broadcast tied to a competition (2026-10-23: `race`, its key — the agenda's « a<id> », a declared « d<id> », a race of
// « Résultats »; only its organisers, as for a deposit: _lib/club.js `organises`) is saved by the race's object to R2 every
// couple of minutes while it changes, and « Résultats » publishes it (ffco_scraper/prov/sources/broadcast.py): its
// results, split times and start list stay after the race. POST { op: "link", id, race } ties one's broadcast to another
// competition (race null: none); POST { op: "publish", id } saves it now and starts a results run (« Publier maintenant »).
import { isAdmin, json, readBody, withUser } from "../../_lib/api.js";
import { broadcasts, liveDir, newMopKey } from "../../_lib/live.js";
import { findRace, organises } from "../../_lib/club.js";
import { startRun } from "../upload.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PER_DAY = 10;
const RACE = /^[a-z][a-z0-9-]{1,40}$/;

const dirPost = (env, body) => liveDir(env).fetch("https://ocn-live/broadcasts", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** The race's object saves the broadcast now (`race` given: tied to it first, "" for none); { ok, saved }. */
async function snapshot(env, id, race) {
  const q = new URLSearchParams({ comp: String(id) });
  if (race !== undefined) q.set("race", race || "");
  const r = await env.LIVE_RACE.get(env.LIVE_RACE.idFromName(String(id))).fetch(`https://ocn-live/snapshot?${q}`, { method: "POST" });
  return r.json().catch(() => ({ ok: false }));
}
/** The competition named, if the account is one of its organisers: { race } or { error, status }. */
async function raceFor(env, request, user, key) {
  if (!RACE.test(String(key || ""))) return { error: "bad competition", status: 400 };
  const race = await findRace(env, request, key);
  if (!race) return { error: "unknown competition", status: 404 };
  if (!(await organises(env, request, user, race))) return { error: "not organiser", status: 403 };
  return { race };
}

export const onRequestGet = withUser(async ({ env }, user) => {
  if (!env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const admin = isAdmin(env, user);
  return json({ broadcasts: (await broadcasts(env)).map(({ by, key, mop, ...b }) => ({ ...b, mine: by === user.id,
    ...(admin ? { by } : {}), ...(by === user.id || admin ? { mop: mop || null } : {}) })) });
});

export const onRequestPost = withUser(async ({ request, env }, user) => {
  if (!env.LIVE_DIR) return json({ error: "live server not bound" }, 500);
  const b = await readBody(request);
  if (b?.op === "mopkey" || b?.op === "link" || b?.op === "publish") {
    const x = (await broadcasts(env)).find((y) => y.id === Number(b.id));
    if (!x) return json({ error: "unknown broadcast" }, 404);
    if (x.by !== user.id && !isAdmin(env, user)) return json({ error: "not your broadcast" }, 403);
    if (b.op === "mopkey") {
      const mop = newMopKey();
      await dirPost(env, { op: "mop", id: x.id, mop });
      return json({ ok: true, mop });
    }
    if (b.op === "link") {
      let race = null;
      if (b.race) {
        const f = await raceFor(env, request, user, b.race);
        if (f.error) return json({ error: f.error }, f.status);
        race = f.race;
      }
      await dirPost(env, { op: "link", id: x.id, race: race?.key || null,
        ...(race ? { name: race.name, date: race.date_iso, organizer: race.org || x.organizer } : {}) });
      const s = await snapshot(env, x.id, race?.key || "");
      const run = s.saved ? await startRun(env) : false;
      return json({ ok: true, race: race?.key || null, saved: !!s.saved, run });
    }
    // « Publier maintenant »: saved at once, and a results run started (else the next scheduled one reads it)
    if (!x.race) return json({ error: "no competition" }, 400);
    const s = await snapshot(env, x.id);
    if (!s.ok) return json({ error: s.error || "not saved" }, 502);
    return json({ ok: true, saved: !!s.saved, run: s.saved ? await startRun(env) : false });
  }
  let race = null;
  if (b?.race) {
    const f = await raceFor(env, request, user, b.race);
    if (f.error) return json({ error: f.error }, f.status);
    race = f.race;
  }
  const name = String(b?.name || race?.name || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const date = String(race?.date_iso || b?.date || "");
  if (!name || !DAY.test(date)) return json({ error: "name and date required" }, 400);
  const since = Date.now() - 86400e3;
  if (!isAdmin(env, user) && (await broadcasts(env)).filter((x) => x.by === user.id && x.created > since).length >= PER_DAY) {
    return json({ error: "too many broadcasts today" }, 429);
  }
  const r = await liveDir(env).fetch("https://ocn-live/broadcasts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "new", name, date, organizer: String(b.organizer || race?.org || "").trim().slice(0, 160),
      key: b.key ? String(b.key).slice(0, 40) : null, mop: newMopKey(), by: user.id, race: race?.key || null }),
  });
  return json(await r.json());
});
