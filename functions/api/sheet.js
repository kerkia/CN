// GET /api/sheet?url=<a Google Sheets address> — the sheet as CSV, for « Organisation › Horaires » (2026-10-18): the browser
// cannot read Google's export itself (it does not allow other sites to), so the Function fetches it. Only
// docs.google.com/spreadsheets addresses, the tab named in the address (gid) or the first; the sheet must be shared to
// anyone with the link (else Google answers its sign-in page: « not shared »). Logged-in accounts, 60 a day.
import { allow, json, withUser } from "../_lib/api.js";

const MAX = 5 * 1024 * 1024;

export const onRequestGet = withUser(async ({ request, env }, user) => {
  const url = new URL(request.url).searchParams.get("url") || "";
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,100})/.exec(url);
  if (!m) return json({ error: "address" }, 400);
  if (!(await allow(env, `sheet:${user.id}`, 60, 86400))) return json({ error: "too many" }, 429);
  const gid = /[#&?]gid=(\d+)/.exec(url);
  let res;
  try {
    res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid[1]}` : ""}`, { redirect: "follow" });
  } catch (e) {
    return json({ error: "unreachable" }, 502);
  }
  if (res.status === 404) return json({ error: "not found" }, 400);
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/csv")) return json({ error: "not shared" }, 400);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX) return json({ error: "too big" }, 413);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
});
