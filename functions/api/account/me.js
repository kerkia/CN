// GET /api/account/me -> the logged-in user (also tells the browser the server still accepts the session).
import { json, publicUser, withUser } from "../../_lib/api.js";
import { memberships } from "../../_lib/countries.js";
import { autoShow } from "../../_lib/modules.js";

// the account's existing work shows its creators' modules, looked at once (_lib/modules.js autoShow)
export const onRequestGet = withUser(async ({ env }, user) => {
  const u = await autoShow(env, user);
  return json(publicUser(env, u, await memberships(env, u.id)));
});
