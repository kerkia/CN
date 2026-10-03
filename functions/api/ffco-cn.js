// GET /api/ffco-cn?lic=31905&spe=For&d=2026-08-31 -> the runner's CN calculation at a date as the FFCO site
// publishes it (cn.ffcorientation.fr/cn/<licence>/?specialite=<For|Spr>&jour=&mois=&annee=): the races in the
// calculation base with the points FFCO counts for them at that date, the ones it keeps, and the CN.
//   { date: "2026-08-31", cn: 6836, note: "CN au 31/08/2026 : 6836 points", rows: [{ date, id, title, place, b1, cf, points, kept }] }
// (cn is null when FFCO gives no CN at that date; note then says why.) Before 2026 the forest and sprint
// CNs were one, published under specialite=Ped.
// The points are FFCO's: a race of a past season is re-evaluated for the new season under a new circuit id,
// shown only on this page, so they can differ from the race's own results page.
// For the logged-in users of the site only; each FFCO page is cached for an hour and a user is limited to
// 120 requests an hour.

import { allow, json, withUser } from "../_lib/api.js";

const SPECIALITES = ["For", "Spr", "Ped", "VTT", "Ski"];
const UA = "ocn-history/1.0 (+https://ocn.kerkia.com; per-user view of the public FFCO CN page)";

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };
const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, (m) => ENT[m]).replace(/\s+/g, " ").trim();
const num = (s) => { const n = parseInt(String(s).replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const isoOf = (d) => `${d[3]}-${d[2]}-${d[1]}`;

export function parseCn(html) {
  const head = /CN au (\d\d)\/(\d\d)\/(\d{4})(?:&nbsp;|\s)*:\s*<strong>\s*(-?\d+)\s*<\/strong>\s*points/.exec(html);
  const rows = [];
  const s = html.indexOf("<tbody"), e = html.indexOf("</tbody>", s);
  if (s >= 0) {
    for (const m of html.slice(s, e < 0 ? undefined : e).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((x) => x[1]);
      const d = /(\d\d)\/(\d\d)\/(\d{4})/.exec(cells[0] || "");
      const a = /\/circuit\/(\d+)\//.exec(cells[1] || "");
      if (!d || !a || cells.length < 6) continue;
      const pts = cells[5];
      rows.push({
        date: isoOf(d), id: a[1], title: clean(cells[1]), place: clean(cells[2]),
        b1: /icon-yes/.test(cells[3]), cf: /icon-yes/.test(cells[4]),
        points: num(clean(pts)), kept: /<strong>/.test(pts) && /color:\s*green/.test(pts),
      });
    }
  }
  // the summary above the table: "CN au … : N points", or "Pas de CN au … : pas assez de course entre … et …",
  // and any penalty; kept as text, minus the link and the "no penalty" line
  const p0 = html.indexOf('font-size: 150%'), p1 = html.indexOf("<form", p0);
  const note = p0 < 0 ? "" : clean(html.slice(html.indexOf(">", p0) + 1, p1 < 0 ? undefined : p1))
    .replace(/\(\s*voir l'historique\s*\)/, "").replace(/Pas de pénalités/, "").replace(/\s+/g, " ").trim();
  const none = /Pas de CN au (\d\d)\/(\d\d)\/(\d{4})/.exec(html);
  return { date: head ? isoOf(head) : none ? isoOf(none) : null, cn: head ? Number(head[4]) : null, note, rows };
}

export const onRequestGet = withUser(async ({ request, env }, user) => {
  const url = new URL(request.url);
  const lic = (url.searchParams.get("lic") || "").replace(/\D/g, "");
  const spe = url.searchParams.get("spe") || "For";
  const d = /^(\d{4})-(\d\d)-(\d\d)$/.exec(url.searchParams.get("d") || "");
  if (!lic || lic.length > 8 || !SPECIALITES.includes(spe)) return json({ error: "bad request" }, 400);
  if (!(await allow(env, `ffc:${user.id}`, 120, 3600))) return json({ error: "rate" }, 429);
  const at = d ? `&jour=${Number(d[3])}&mois=${Number(d[2])}&annee=${d[1]}` : "";
  let res;
  try {
    res = await fetch(`https://cn.ffcorientation.fr/cn/${lic}/?specialite=${spe}${at}`, {
      headers: { "User-Agent": UA }, cf: { cacheTtl: 3600, cacheEverything: true },
    });
  } catch (e) { return json({ error: "unavailable" }, 502); }
  if (!res.ok) return json({ error: "unavailable" }, 502);
  const html = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  if (html.includes("réservée aux licenciés")) return json({ error: "unavailable" }, 502);     // the site's login teaser
  const out = parseCn(html);
  if (!out.date && !out.rows.length) return json({ error: "unavailable" }, 502);
  return json(out, 200, { "Cache-Control": "private, max-age=1800" });
});
