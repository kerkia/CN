// GET /api/account/status -> { registration: bool } so the login page knows whether to offer sign-up.
import { json } from "../../_lib/api.js";

export const onRequestGet = ({ env }) => json({ registration: env.REGISTRATION_OPEN === "1" && !!env.DB });
