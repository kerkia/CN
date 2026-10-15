// An account's club and a race's organiser, for the organisers' pages (« Organisation »: the multi analyses of a
// competition, the results deposited for it). An organiser is a member of the race's organising club — the club of
// the account's latest race in the site's data — or an administrator (owner, 2026-10-15).

/** The club (4 digits) of the account's licence: that of its latest race in the site's data, or null. */
export async function clubOf(env, request, licence) {
  const lic = String(licence || "");
  if (!/^\d+$/.test(lic)) return null;
  try {
    const res = await env.ASSETS.fetch(new URL(`/data/r/${Math.floor(Number(lic) / 10)}.json`, request.url));
    const rows = res.ok ? (await res.json())[lic] || [] : [];
    let best = null;
    for (const r of rows) if (r && typeof r[4] === "string" && (!best || r[4] > best[4])) best = r;
    const m = /^(\d{4})/.exec(best?.[9] || "");
    return m ? m[1] : null;
  } catch (e) { return null; }
}

/** The club number (4 digits) of a race's organiser ("0109 - O'BUGEY"), or null. */
export const orgCode = (org) => {
  const m = /^\s*(\d{3,4})\b/.exec(String(org || ""));
  return m ? m[1].padStart(4, "0") : null;
};

/** A race of « Résultats » (site/data/prov/index.json) by its key, or null. */
export async function raceOf(env, request, key) {
  try {
    const res = await env.ASSETS.fetch(new URL("/data/prov/index.json", request.url));
    return res.ok ? (await res.json()).races?.find((r) => r.key === key) || null : null;
  } catch (e) { return null; }
}
