// POST /api/account/settings { notify?: bool, agendaAlert?: bool, deadlineAlert?: bool, agendaRegions?: [region names],
//   lang?: "fr" | "en", startsAlert?: bool, pushStarts?: bool, pushResults?: bool, pushAgenda?: bool, pushDeadline?: bool,
//   orga?: bool, movedNoticeSeen?: true }  (orga: the Orga module, migration 0016; movedNoticeSeen: the window about the move
//   to ozimut.com, seen: assets/js/moved.js)
// Every alert by e-mail and/or push (2026-10-18): the push ones are open to every account.
// Only the fields sent are changed. Every alert's e-mail needs the right the administrator grants (users.alerts_allowed;
// the results' too since 2026-10-21); the notifications do not. The language is the one
// the account's e-mails are written in, and the one a login on another device takes.
import { alertsAllowed, json, publicUser, readBody, withUser } from "../../_lib/api.js";
import { memberships } from "../../_lib/countries.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  if (!b) return json({ error: "bad request" }, 400);
  const sets = [], vals = [];
  for (const [field, column] of [["notify", "notify"], ["agendaAlert", "agenda_alert"], ["deadlineAlert", "deadline_alert"],
    ["startsAlert", "starts_alert"], ["pushStarts", "push_starts"], ["pushResults", "push_results"], ["pushAgenda", "push_agenda"], ["pushDeadline", "push_deadline"], ["orga", "orga"]]) {
    if (field in b) {
      if (typeof b[field] !== "boolean") return json({ error: "bad request" }, 400);
      if (["notify", "agendaAlert", "deadlineAlert", "startsAlert"].includes(field) && b[field] && !alertsAllowed(env, user)) return json({ error: "not allowed" }, 403);
      sets.push(`${column} = ?`); vals.push(b[field] ? 1 : 0);
    }
  }
  if ("agendaRegions" in b) {
    const r = b.agendaRegions;
    if (!Array.isArray(r) || r.length > 30 || r.some((x) => typeof x !== "string" || x.length > 60)) return json({ error: "bad request" }, 400);
    sets.push("agenda_regions = ?"); vals.push(JSON.stringify([...new Set(r)]));
  }
  if ("lang" in b) {
    if (b.lang !== "fr" && b.lang !== "en") return json({ error: "bad request" }, 400);
    sets.push("lang = ?"); vals.push(b.lang);
  }
  if (b.movedNoticeSeen === true) sets.push("moved_notice = 1");
  if (!sets.length) return json({ error: "bad request" }, 400);
  await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, user.id).run();
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return json(publicUser(env, fresh, await memberships(env, fresh.id)));
});
