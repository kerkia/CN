// GET /api/account/me -> the logged-in user (also tells the browser the server still accepts the session).
import { json, publicUser, withUser } from "../../_lib/api.js";
import { memberships } from "../../_lib/countries.js";

export const onRequestGet = withUser(async ({ env }, user) => json(publicUser(env, user, await memberships(env, user.id))));
