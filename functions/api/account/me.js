// GET /api/account/me -> the logged-in user (also tells the browser the server still accepts the session).
import { json, publicUser, withUser } from "../../_lib/api.js";

export const onRequestGet = withUser(({ env }, user) => json(publicUser(env, user)));
