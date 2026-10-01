// POST /api/account/settings { notify: bool }
import { json, publicUser, readBody, withUser } from "../../_lib/api.js";

export const onRequestPost = withUser(async ({ request, env }, user) => {
  const b = await readBody(request);
  if (typeof b?.notify !== "boolean") return json({ error: "bad request" }, 400);
  await env.DB.prepare("UPDATE users SET notify = ? WHERE id = ?").bind(b.notify ? 1 : 0, user.id).run();
  return json(publicUser(env, { ...user, notify: b.notify ? 1 : 0 }));
});
