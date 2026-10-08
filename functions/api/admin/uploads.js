// GET  /api/admin/uploads           — the results files uploaded on « Récemment », newest first (the last 300)
// POST /api/admin/uploads { id }    — removes one: the file leaves R2, its meta.json says "removed", and the next
//                                     provisional-results run takes its documents (and a race it added) off the site.

import { json, readBody, withUser } from "../../_lib/api.js";
import { startRun } from "../upload.js";

export const onRequestGet = withUser(async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.race_key, p.race, p.filename, p.size, p.status, p.created_at, u.email, u.first_name, u.last_name, u.licence
     FROM uploads p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 300`).all();
  return json({ uploads: results });
}, { admin: true });

export const onRequestPost = withUser(async ({ request, env }) => {
  const b = await readBody(request);
  const id = Number(b?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "bad request" }, 400);
  const up = await env.DB.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first();
  if (!up) return json({ error: "not found" }, 404);
  if (up.status !== "removed") {
    const metaKey = `uploads/${id}/meta.json`;
    const obj = env.BUCKET ? await env.BUCKET.get(metaKey) : null;
    const meta = obj ? await obj.json() : { id, race: up.race_key, new_race: up.race_key ? null : JSON.parse(up.race || "null") };
    if (env.BUCKET) {
      if (up.r2_key) await env.BUCKET.delete(up.r2_key);
      await env.BUCKET.put(metaKey, JSON.stringify({ ...meta, status: "removed", size: 0 }),
        { httpMetadata: { contentType: "application/json" } });
    }
    await env.DB.prepare("UPDATE uploads SET status = 'removed' WHERE id = ?").bind(id).run();
    await startRun(env);
  }
  return json({ ok: true });
}, { admin: true });
