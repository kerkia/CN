// POST /api/admin/prefs { signupAlert } — the administrator's own preferences: an e-mail at each new account.
import { json, readBody, withUser } from "../../_lib/api.js";

export const onRequestPost = withUser(async ({ request, env }, admin) => {
  const b = await readBody(request);
  if (typeof b?.signupAlert !== "boolean") return json({ error: "bad request" }, 400);
  await env.DB.prepare("UPDATE users SET signup_alert = ? WHERE id = ?").bind(b.signupAlert ? 1 : 0, admin.id).run();
  return json({ ok: true });
}, { admin: true });
