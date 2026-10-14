// GET /api/account/relay?club=7707 — the runners this account added to a club for the relay simulator, and the club's
// runners it marked unavailable: { runners, out }
// PUT /api/account/relay { club, runners: [{ id, name, sex: "H"|"D", age, cn: { For?, Spr?, VTT?, Ski? } }], out: [lic…] }
// — replaces them. Added runners: people who race only relays, or abroad, with no CN of their own, an expected CN per
// discipline. Unavailable (2026-10-14): licences (or an added runner's "x:<id>") kept out of the teams. Only the account
// sees them (D1 relay_runners, migration 0008: the `runners` column holds the list, or since 2026-10-14 the object
// { runners, out }); deleted with the account.
import { json, readBody, withUser } from "../../_lib/api.js";

const CLUB = /^[0-9A-Za-z]{1,8}$/;
const TERRAINS = ["For", "Spr", "VTT", "Ski"];

function clean(list) {
  if (!Array.isArray(list) || list.length > 40) return null;
  const out = [];
  for (const r of list) {
    const name = typeof r?.name === "string" ? r.name.trim().replace(/\s+/g, " ") : "";
    const age = Number(r?.age);
    if (!name || name.length > 60 || !["H", "D"].includes(r?.sex) || !Number.isInteger(age) || age < 6 || age > 99) return null;
    const cn = {};
    for (const t of TERRAINS) {
      const v = r?.cn?.[t];
      if (v == null || v === "") continue;
      if (!Number.isInteger(v) || v < 1 || v > 20000) return null;
      cn[t] = v;
    }
    const id = String(r?.id || "").slice(0, 20) || Math.random().toString(36).slice(2, 10);
    out.push({ id, name, sex: r.sex, age, cn });
  }
  return out;
}
const LIC = /^(x:)?[0-9A-Za-z_-]{1,20}$/;
function cleanOut(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 400) return null;
  const out = [...new Set(list.map(String))];
  return out.every((s) => LIC.test(s)) ? out : null;
}
/** The stored JSON: a list (the added runners, before 2026-10-14) or { runners, out }. */
const unpack = (text) => { const v = JSON.parse(text); return Array.isArray(v) ? { runners: v, out: [] } : { runners: v.runners || [], out: v.out || [] }; };

export const onRequestGet = withUser(async ({ request, env }, user) => {
  const club = new URL(request.url).searchParams.get("club") || "";
  if (!CLUB.test(club)) return json({ error: "bad request" }, 400);
  try {
    const row = await env.DB.prepare("SELECT runners FROM relay_runners WHERE user_id = ? AND club = ?").bind(user.id, club).first();
    return json(row ? unpack(row.runners) : { runners: [], out: [] });
  } catch (e) {
    return json({ error: "unavailable" }, 503);              // the table is not there yet (migration 0008)
  }
});

export const onRequestPut = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  const club = String(b?.club || ""), runners = clean(b?.runners), out = cleanOut(b?.out);
  if (!CLUB.test(club) || !runners || !out) return json({ error: "bad request" }, 400);
  try {
    if (!runners.length && !out.length) await env.DB.prepare("DELETE FROM relay_runners WHERE user_id = ? AND club = ?").bind(user.id, club).run();
    else await env.DB.prepare(`INSERT INTO relay_runners (user_id, club, runners, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, club) DO UPDATE SET runners = excluded.runners, updated_at = excluded.updated_at`)
      .bind(user.id, club, JSON.stringify({ runners, out }), new Date().toISOString()).run();
    return json({ runners, out });
  } catch (e) {
    return json({ error: "unavailable" }, 503);
  }
});
