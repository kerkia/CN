// POST /api/account/delete { password } — erases the account and everything tied to it (GDPR).
import { allow, clearCookie, json, readBody, withUser } from "../../_lib/api.js";
import { checkPassword } from "../../_lib/crypto.js";
import { handOver, soloHandOver, forgetUser, tracerInfo } from "../../_lib/maplib.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  if (!(await allow(env, `pwchange:${user.id}`, 8, 600))) return json({ error: "rate" }, 429);
  if (!(await checkPassword(String(b?.password || ""), user, env))) return json({ error: "invalid" }, 401);
  // the account's traces on shared analyses (R2: analyses/<id>/trace-<n>-<uid>.json), an administrator's test traces too
  // (uid 1e9 + account × 1000 + k: api/analyses)
  if (env.BUCKET) {
    try {
      const keys = [];
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: "analyses/", cursor, limit: 1000 });
        for (const o of r.objects) {
          // its traces, and the record of its visits and solo replays (counted for the organisers: api/analyses)
          const m = /\/(?:trace|solo)-\d+-(\d+)\.json$/.exec(o.key) || /\/view-(\d+)\.json$/.exec(o.key), uid = m ? Number(m[1]) : null;
          if (uid === user.id || (uid > 1e9 && Math.floor((uid - 1e9) / 1000) === user.id)) keys.push(o.key);
        }
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
      // the analyses the account organised stay (their maps are kept, the other runners' traces too), without its
      // name: the administrators manage them from then on
      cursor = undefined;
      do {
        const r = await env.BUCKET.list({ prefix: "analyses-meta/", cursor, limit: 1000, include: ["customMetadata"] });
        for (const o of r.objects) {
          if (Number(o.customMetadata?.owner) !== user.id) continue;
          const obj = await env.BUCKET.get(o.key);
          const meta = obj ? await obj.json() : null;
          if (!meta) continue;
          meta.owner = 0; meta.ownerName = "";
          const custom = { ...(o.customMetadata || {}), owner: "0", ownerName: "" };
          await env.BUCKET.put(o.key, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" }, customMetadata: custom });
        }
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
    } catch (e) { /* the account goes all the same */ }
    // the Tracer's events the account created: to the first setter (else controller) of the team who has an account; with
    // nobody to take one over, it goes with its map, versions, comments and field states (its courses were the team's secret)
    try {
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: "tracer-meta/", cursor, limit: 1000, include: ["customMetadata"] });
        for (const o of r.objects) {
          if (Number(o.customMetadata?.owner) !== user.id) continue;
          const obj = await env.BUCKET.get(o.key);
          const meta = obj ? await obj.json().catch(() => null) : null;
          if (!meta) continue;
          let heir = null;
          for (const role of ["setter", "controller"]) for (const m of meta.team || []) {
            if (heir || m.role !== role || Number(m.uid) === user.id || (m.lic && String(m.lic) === String(user.licence))) continue;
            // a member added by account (uid), else by licence
            const u = m.uid
              ? await env.DB.prepare("SELECT id, display_name, licence FROM users WHERE id = ? AND status = 'active'").bind(Number(m.uid)).first()
              : m.lic ? await env.DB.prepare("SELECT id, display_name, licence FROM users WHERE licence = ? AND id != ? AND status = 'active' LIMIT 1").bind(String(m.lic), user.id).first() : null;
            if (u) heir = { u, m };
          }
          if (heir) {
            Object.assign(meta, { owner: heir.u.id, ownerName: heir.u.display_name || heir.m.name || "", ownerLic: String(heir.u.licence || heir.m.lic || "") });
            meta.team = meta.team.filter((x) => x !== heir.m);
            await env.BUCKET.put(o.key, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" },
              customMetadata: { ...(o.customMetadata || {}), owner: String(meta.owner), ownerName: meta.ownerName,
                team: meta.team.filter((x) => x.lic).map((x) => x.lic).join(","), uids: meta.team.filter((x) => x.uid).map((x) => x.uid).join(",") } });
          } else {
            // its map stays, handed over to the administrators' collection (_lib/maplib.js) — not an encrypted event's, nor one
            // marked private; the courses, versions, comments and field states go
            const mapKey = `tracer/${meta.id}/map`, give = !meta.encrypted && !meta.mapPrivate && (await env.BUCKET.head(mapKey));
            if (give) {
              const info = await tracerInfo(env, { id: meta.id, title: meta.title, date: meta.date, orgClub: meta.orgClub });
              delete info.uid; delete info.user;
              await handOver(env, user.id, [{ keys: [mapKey], meta: info }]);
            }
            const keys = [o.key];
            let c2;
            do {
              const l = await env.BUCKET.list({ prefix: `tracer/${meta.id}/`, cursor: c2, limit: 1000 });
              keys.push(...l.objects.map((x) => x.key).filter((k) => !(give && k === mapKey)));
              c2 = l.truncated ? l.cursor : undefined;
            } while (c2);
            for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
          }
        }
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
    } catch (e) { /* the account goes all the same */ }
  }
  // « Mes cartes » (migration 0019): the account's runs and links go; its maps are handed over to the administrators' collection
  // (owner, 2026-11-06: kept, without the account's name; _lib/maplib.js), their files left in place until copied
  try {
    if (env.BUCKET) {
      const keep = new Set(), list = [];
      try {
        const { results } = await env.DB.prepare("SELECT * FROM mymaps WHERE user_id = ?").bind(user.id).all();
        for (const m of results) {
          if (m.private) continue;                       // « Carte privée »: it goes with the account
          const ks = [`mymaps-o/${user.id}/${m.id}`, `mymaps/${user.id}/${m.id}/map`], th = `mymaps/${user.id}/${m.id}/thumb`, vw = `mymaps/${user.id}/${m.id}/view`;
          const pos = Number.isFinite(m.lat) && Number.isFinite(m.lon) && Math.abs(m.lat) + Math.abs(m.lon) > 0.1 ? `${m.lat.toFixed(5)},${m.lon.toFixed(5)}` : "";
          list.push({ keys: ks, thumb: m.thumb ? th : null, view: vw,
            meta: Object.fromEntries(Object.entries({ src: "mymaps", title: String(m.title || "").slice(0, 300), day: m.day || "", w: String(m.w), h: String(m.h), pos }).filter(([, v]) => v)) });
          for (const k of [...ks, th, vw]) keep.add(k);
        }
      } catch (e) { /* no tables yet */ }
      let cursor;
      for (const prefix of [`mymaps/${user.id}/`, `mymaps-o/${user.id}/`]) {        // (the originals apart since 2026-11-06)
        do {
          const r = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
          const gone = r.objects.map((o) => o.key).filter((k) => !keep.has(k));
          if (gone.length) await env.BUCKET.delete(gone);
          cursor = r.truncated ? r.cursor : undefined;
        } while (cursor);
      }
      await handOver(env, user.id, list);
    }
    await env.DB.batch([env.DB.prepare("DELETE FROM mymap_runs WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM mymap_links WHERE user_id = ?").bind(user.id), env.DB.prepare("DELETE FROM mymaps WHERE user_id = ?").bind(user.id)]);
  } catch (e) { /* no tables yet (migration 0019) */ }
  // its kept solo analyses go (the runs); their maps not marked private are handed over to the administrators' collection
  try {
    if (env.BUCKET) {
      const { list, keep } = await soloHandOver(env, user.id);
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: `solo/${user.id}/`, cursor, limit: 1000 });
        const gone = r.objects.map((o) => o.key).filter((k) => !keep.has(k));
        if (gone.length) await env.BUCKET.delete(gone);
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
      await handOver(env, user.id, list);
      // the collection's maps it sent lose its name and number
      await forgetUser(env, user.id);
    }
  } catch (e) { /* the account goes all the same */ }
  // « Nutrition »'s articles stay, under the name they were published with (migration 0017)
  try { await env.DB.prepare("UPDATE nut_posts SET author_id = NULL WHERE author_id = ?").bind(user.id).run(); } catch (e) {}
  try { await env.DB.prepare("DELETE FROM nut_likes WHERE user_id = ?").bind(user.id).run(); } catch (e) {}      // its likes go
  // the relay simulator's added runners (a table that may not exist yet: migration 0008)
  try { await env.DB.prepare("DELETE FROM relay_runners WHERE user_id = ?").bind(user.id).run(); } catch (e) {}
  // « Réservation des horaires » (migration 0023): its runners go, and its bookings of races still to come (their slots free
  // again); those of past races, now in the published start lists, keep the runners' names but no longer the account
  try {
    await env.DB.batch([env.DB.prepare("DELETE FROM booking_runners WHERE user_id = ?").bind(user.id),
      env.DB.prepare(`DELETE FROM bookings WHERE user_id = ? AND by_org = 0 AND race_key IN
        (SELECT race_key FROM booking_events WHERE race_date >= date('now'))`).bind(user.id),
      env.DB.prepare("UPDATE bookings SET user_id = 0 WHERE user_id = ?").bind(user.id)]);
  } catch (e) { /* before migration 0023 */ }
  try {                                       // the devices' push subscriptions and what was sent to them (migration 0010)
    await env.DB.batch([env.DB.prepare("DELETE FROM push_subs WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM push_sent WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM push_queue WHERE user_id = ?").bind(user.id)]);
  } catch (e) {}
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notified WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM user_countries WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM tokens WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
});
