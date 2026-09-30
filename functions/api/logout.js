// POST /api/logout — drops the session cookie.
import { COOKIE } from "../_middleware.js";

export async function onRequestPost() {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, "Cache-Control": "no-store" },
  });
}
