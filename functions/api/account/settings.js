// POST /api/account/settings { notify?: bool, agendaAlert?: bool, deadlineAlert?: bool, agendaRegions?: [region names] }
// Only the fields sent are changed. The agenda alerts need the right the administrator grants.
import { alertsAllowed, json, publicUser, readBody, withUser } from "../../_lib/api.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  if (!b) return json({ error: "bad request" }, 400);
  const sets = [], vals = [];
  for (const [field, column] of [["notify", "notify"], ["agendaAlert", "agenda_alert"], ["deadlineAlert", "deadline_alert"]]) {
    if (field in b) {
      if (typeof b[field] !== "boolean") return json({ error: "bad request" }, 400);
      if (field !== "notify" && b[field] && !alertsAllowed(env, user)) return json({ error: "not allowed" }, 403);
      sets.push(`${column} = ?`); vals.push(b[field] ? 1 : 0);
    }
  }
  if ("agendaRegions" in b) {
    const r = b.agendaRegions;
    if (!Array.isArray(r) || r.length > 30 || r.some((x) => typeof x !== "string" || x.length > 60)) return json({ error: "bad request" }, 400);
    sets.push("agenda_regions = ?"); vals.push(JSON.stringify([...new Set(r)]));
  }
  if (!sets.length) return json({ error: "bad request" }, 400);
  await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, user.id).run();
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return json(publicUser(env, fresh));
});
