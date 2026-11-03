// GET /api/sheet?url=<a Google Sheets address> — the sheet as CSV, for « Organisation › Horaires » (2026-10-18): the browser
// cannot read Google's export itself (it does not allow other sites to), so the Function fetches it. Only
// docs.google.com/spreadsheets addresses, the tab named in the address (gid) or the first; the sheet must be shared to
// anyone with the link (else Google answers its sign-in page: « not shared »). Logged-in accounts, 60 a day.
// &all=1 (2026-11-03: the organisers' files have a tab per group of circuits — Balise 77's three — and the address names
// one): every tab with something in it, from the sheet's public view's list of tabs -> { tabs: [{ name, csv }] }, MAX_TABS.
import { allow, json, withUser } from "../_lib/api.js";

const MAX = 5 * 1024 * 1024;
const MAX_TABS = 20;
const csvOf = (id, gid) => fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid ? `&gid=${gid}` : ""}`, { redirect: "follow" });
/** The sheet's tabs [{ name, gid }], read from its public view (Google writes them as `{name: "…", …, gid: "…"`); [] if none. */
async function tabsOf(id) {
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, { redirect: "follow" });
    if (!r.ok) return [];
    const page = await r.text();
    const out = [];
    for (const m of page.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
      let name = m[1];
      try { name = JSON.parse(`"${name.replace(/\\x([0-9a-f]{2})/gi, "\\u00$1")}"`); } catch (e) { /* as written */ }
      if (!out.some((x) => x.gid === m[2])) out.push({ name, gid: m[2] });
    }
    return out.slice(0, MAX_TABS);
  } catch (e) { return []; }
}

export const onRequestGet = withUser(async ({ request, env }, user) => {
  const url = new URL(request.url).searchParams.get("url") || "";
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,100})/.exec(url);
  if (!m) return json({ error: "address" }, 400);
  if (!(await allow(env, `sheet:${user.id}`, 60, 86400))) return json({ error: "too many" }, 429);
  const gid = /[#&?]gid=(\d+)/.exec(url);
  if (new URL(request.url).searchParams.get("all") === "1") {
    const tabs = await tabsOf(m[1]);
    if (tabs.length) {
      const out = [];
      let size = 0;
      for (const tab of tabs) {
        const r = await csvOf(m[1], tab.gid).catch(() => null);
        if (!r?.ok || !(r.headers.get("content-type") || "").includes("text/csv")) continue;
        const csv = await r.text();
        size += csv.length;
        if (size > MAX) return json({ error: "too big" }, 413);
        if (csv.replace(/[,\s]/g, "")) out.push({ name: tab.name, csv });
      }
      if (out.length) return json({ tabs: out }, 200, { "Cache-Control": "no-store" });
    }
    // no list of tabs (not shared to anyone, Google changed its page): the tab the address names, alone
  }
  let res;
  try {
    res = await csvOf(m[1], gid?.[1]);
  } catch (e) {
    return json({ error: "unreachable" }, 502);
  }
  if (res.status === 404) return json({ error: "not found" }, 400);
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/csv")) return json({ error: "not shared" }, 400);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX) return json({ error: "too big" }, 413);
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
});
