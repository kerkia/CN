// POST /api/admin/user { id, action: "disable" | "enable" | "delete" }
// A disabled account is refused at its next hourly check at the latest (see _middleware.js).
import { json, readBody, withUser } from "../../_lib/api.js";

export const onRequestPost = withUser(async ({ request, env }, admin) => {
  const b = await readBody(request);
  const id = Number(b?.id);
  if (!Number.isInteger(id) || !["disable", "enable", "delete"].includes(b?.action)) return json({ error: "bad request" }, 400);
  if (id === admin.id && b.action !== "enable") return json({ error: "self" }, 400);        // never lock oneself out
  const target = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?").bind(id).first();
  if (!target) return json({ error: "not found" }, 404);
  if (b.action === "delete") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM notified WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM tokens WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM mail_queue WHERE to_email = ?").bind(target.email),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
    ]);
  } else {
    await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind(b.action === "disable" ? "disabled" : "active", id).run();
  }
  return json({ ok: true });
}, { admin: true });
