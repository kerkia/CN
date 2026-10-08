// POST /api/upload — an organiser's results file for a race of « Récemment », or for a race the site does not know
// yet. The file is the request's body, sent as is (no form to decode: the free plan's ~10 ms of CPU could not take
// 30 MB), and streamed to R2 untouched: cn-state, uploads/<id>/<name>, beside a meta.json the provisional-results
// run reads (ffco_scraper/prov/sources/upload.py). The race comes in the X-Upload header (URI-encoded JSON):
//   { race: "<key of site/data/prov/index.json>" }  or  { new_race: { name, date, place, org_code, terrain, epreuve, cn } }
// plus { filename, consent: true }. Every upload is published (owner's choice, 2026-10-08): the administrators get
// an e-mail, can remove it on the admin page, and D1 keeps who uploaded what. When the GH_DISPATCH_TOKEN secret is
// set, a provisional-results run starts at once (GitHub workflow_dispatch); otherwise the next hourly run reads it.
// Files older than 60 days are deleted from R2 after an upload (their results stay on the site).

import { adminEmails, allow, json, nowIso, withUser } from "../_lib/api.js";
import { sendOrQueue } from "../_lib/mail.js";
import { uploadMail } from "../_lib/templates.js";

export const MAX_BYTES = 30 * 1024 * 1024;
const EXT = /\.(xml|html?|pdf|zip|gz|csv|txt)$/i;
const KEEP_DAYS = 60;
const TERRAINS = ["Forêt", "Sprint", "VTT", "Ski"];
const FORMATS = ["Sprint", "MD", "LD", "Nuit", "Autre"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isoDay = (d) => d.toISOString().slice(0, 10);

export const onRequestPost = withUser(async ({ request, env, waitUntil }, user) => {
  if (!env.BUCKET) return json({ error: "storage not configured" }, 500);
  let meta;
  try { meta = JSON.parse(decodeURIComponent(request.headers.get("X-Upload") || "")); } catch (e) { meta = null; }
  if (!meta || typeof meta !== "object") return json({ error: "bad request" }, 400);
  if (meta.consent !== true) return json({ error: "consent" }, 400);
  const filename = clean(meta.filename, 120).replace(/[\\/]/g, "_");
  if (!EXT.test(filename)) return json({ error: "type" }, 415);
  const size = Number(request.headers.get("Content-Length") || 0);
  if (!size) return json({ error: "empty" }, 400);
  if (size > MAX_BYTES) return json({ error: "too big", max: MAX_BYTES }, 413);
  if (!(await allow(env, `upload:${user.id}`, 30, 86400))) return json({ error: "too many" }, 429);

  // the race: one of the list, or a new one (the last 30 days, as on the page)
  let raceKey = null, label, newRace = null;
  if (meta.race) {
    raceKey = clean(meta.race, 40);
    const res = await env.ASSETS.fetch(new URL("/data/prov/index.json", request.url));
    const race = res.ok ? (await res.json()).races?.find((r) => r.key === raceKey) : null;
    if (!race) return json({ error: "unknown race" }, 400);
    label = `${race.name} (${race.date_iso})`;
  } else {
    const r = meta.new_race || {};
    const today = new Date(), from = new Date(Date.now() - 30 * 86400e3);
    newRace = { name: clean(r.name, 120), date: String(r.date || ""), place: clean(r.place, 80),
      org_code: /^\d{2,4}$/.test(String(r.org_code || "")) ? String(r.org_code) : "",
      terrain: TERRAINS.includes(r.terrain) ? r.terrain : "", epreuve: FORMATS.includes(r.epreuve) ? r.epreuve : "",
      cn: r.cn === true };
    if (newRace.name.length < 3 || !DAY.test(newRace.date) || newRace.date > isoDay(today) || newRace.date < isoDay(from)) {
      return json({ error: "race" }, 400);
    }
    if (newRace.org_code) {                     // the club's name, from the site's own list
      const res = await env.ASSETS.fetch(new URL("/data/meta.json", request.url));
      const name = res.ok ? (await res.json()).names?.clubs?.[newRace.org_code] : null;
      newRace.org = name ? `${newRace.org_code} - ${name}` : newRace.org_code;
    }
    label = `${newRace.name} (${newRace.date}, course ajoutée)`;
  }

  const created = nowIso();
  const row = await env.DB.prepare(
    `INSERT INTO uploads (user_id, race_key, race, filename, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, '', ?) RETURNING id`)
    .bind(user.id, raceKey, newRace ? JSON.stringify(newRace) : label, filename, size, created).first();
  const id = row.id;
  const stored = filename.replace(/[^\w.\-]+/g, "_");
  const r2Key = `uploads/${id}/${stored}`;
  try {
    await env.BUCKET.put(r2Key, request.body, { httpMetadata: { contentType: request.headers.get("Content-Type") || "application/octet-stream" } });
  } catch (e) {
    await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(id).run();
    return json({ error: "storage" }, 502);
  }
  const m = { id, created, user: user.id, race: raceKey, new_race: newRace, filename, stored, size, status: "active" };
  await env.BUCKET.put(`uploads/${id}/meta.json`, JSON.stringify(m), { httpMetadata: { contentType: "application/json" } });
  await env.DB.prepare("UPDATE uploads SET r2_key = ? WHERE id = ?").bind(r2Key, id).run();

  const soon = await startRun(env);
  waitUntil(Promise.all([alertAdmins(env, user, { race: label, filename, size }), cleanUp(env)]).catch(() => {}));
  return json({ ok: true, id, soon });
});

/** A provisional-results run now (GitHub workflow_dispatch), at most once every 3 minutes; false without the token. */
export async function startRun(env) {
  if (!env.GH_DISPATCH_TOKEN) return false;
  if (!(await allow(env, "upload:dispatch", 1, 180))) return true;       // one is starting already
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO || "kerkia/CN"}/actions/workflows/update.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ocn-upload", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { mode: "prov" } }),
  });
  return r.status === 204;
}

async function alertAdmins(env, user, up) {
  const admins = adminEmails(env);
  if (!admins.length) return;
  for (const to of admins) await sendOrQueue(env, { to, ...uploadMail(env, user, up), kind: "alert", priority: 1 });
}

/** The files kept 60 days: older ones are deleted (their meta.json too; the results they gave stay). */
async function cleanUp(env) {
  const limit = Date.now() - KEEP_DAYS * 86400e3;
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: "uploads/", cursor, limit: 500 });
    const old = page.objects.filter((o) => o.uploaded.getTime() < limit).map((o) => o.key);
    if (old.length) await env.BUCKET.delete(old);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
