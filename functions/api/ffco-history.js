// GET /api/ffco-history?lic=31905&spe=For -> the runner's CN history as the FFCO site publishes it
// (cn.ffcorientation.fr/historique/<licence>/?specialite=<For|Spr>): one row per entry or exit of a race
// in the calculation base, with the CN and its variation afterwards.
//   { rows: [{ date: "2026-08-23", races: [{ id, text, struck }], cn: 6836, delta: 94 }] }
// For the logged-in users of the site only; the FFCO page is cached for an hour and a user is limited to
// 60 requests an hour, so the federation's server is hardly touched.

import { allow, json, withUser } from "../_lib/api.js";

const SPECIALITES = ["For", "Spr", "Ped", "VTT", "Ski"];
const UA = "ocn-history/1.0 (+https://ocn.kerkia.com; per-user view of the public FFCO history page)";

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };
const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, " ").trim();
const num = (s) => { const n = parseInt(String(s).replace(/[^\d+-]/g, ""), 10); return Number.isFinite(n) ? n : null; };

export function parseHistory(html) {
  const rows = [];
  const body = html.slice(Math.max(0, html.indexOf("<tbody")));
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tr = m[1];
    const d = /<td>\s*(\d\d)\/(\d\d)\/(\d{4})\s*<\/td>/.exec(tr);
    if (!d) continue;
    const races = [...tr.matchAll(/<a href="\/circuit\/(\d+)\/"([^>]*)>([\s\S]*?)<\/a>/g)]
      .map((a) => ({ id: a[1], struck: /line-through/.test(a[2]), text: clean(a[3]) }));
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => clean(x[1]));    // date, CN, variation
    rows.push({ date: `${d[3]}-${d[2]}-${d[1]}`, races, cn: num(cells[1]), delta: cells[2] ? num(cells[2]) : null });
  }
  return rows;
}

export const onRequestGet = withUser(async ({ request, env }, user) => {
  const url = new URL(request.url);
  const lic = (url.searchParams.get("lic") || "").replace(/\D/g, "");
  const spe = url.searchParams.get("spe") || "For";
  if (!lic || lic.length > 8 || !SPECIALITES.includes(spe)) return json({ error: "bad request" }, 400);
  if (!(await allow(env, `ffh:${user.id}`, 60, 3600))) return json({ error: "rate" }, 429);
  let res;
  try {
    res = await fetch(`https://cn.ffcorientation.fr/historique/${lic}/?specialite=${spe}`, {
      headers: { "User-Agent": UA }, cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch (e) { return json({ error: "unavailable" }, 502); }
  if (!res.ok) return json({ error: "unavailable" }, 502);
  const html = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  if (html.includes("réservée aux licenciés")) return json({ error: "unavailable" }, 502);     // the site's login teaser
  return json({ rows: parseHistory(html) }, 200, { "Cache-Control": "private, max-age=1800" });
});
