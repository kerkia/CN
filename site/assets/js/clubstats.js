// Club rankings. Two independent choices, as the visitor sees them:
//   base      — what is counted per runner: their CN, or their points in national races;
//   measure   — how the runners are combined: total, mean, top-5 mean or headcount;
// and two filters on the runners counted: sex, and age group. A third base,
// the competitions a club organised, has its own two measures: the count, and
// the count per 100 ranked runners of the club.

import { t } from "./i18n.js";
import { addDays } from "./util.js";
import * as data from "./data.js";
import { loadRanking } from "./pages/ranking.js";

export const BASES = ["cn", "pts"];
export const MEASURES = ["sum", "mean", "top5", "n"];
export const ORG_MEASURES = ["n", "per100"];
export const measuresOf = (base) => (base === "org" ? ORG_MEASURES : MEASURES);
export const defaultMeasure = (base) => measuresOf(base)[0];
export const SEXES = ["*", "H", "D"];
// J: up to 20 years (H/D 10–20) · A: 21 and over · E: 21 only (the elite category)
export const AGE_GROUPS = ["*", "J", "A", "E"];

export const baseLabel = (b) => t(`cb.base.${b}`);
export const measureLabel = (m, base) => t(base === "org" ? `cb.m.org.${m}` : `cb.m.${m}`);
export const sexLabel = (s) => t(`cb.sexe.${s}`);
export const ageLabel = (a) => t(`cb.age.${a}`);

/** Does a category (H21, D14…) belong to a sex/age selection? */
export function inGroup(cat, sexe, age) {
  const m = /^([HD])(\d+)$/.exec(cat || "");
  if (!m) return sexe === "*" && age === "*";
  const n = Number(m[2]);
  return (sexe === "*" || m[1] === sexe) &&
    (age === "*" || (age === "J" && n <= 20) || (age === "A" && n >= 21) || (age === "E" && n === 21));
}

/** The four measures from a list of per-runner values. */
export function measures(values) {
  const v = [...values].sort((a, b) => a - b);
  const sum = v.reduce((s, x) => s + x, 0);
  return {
    n: v.length, sum: Math.round(sum), mean: v.length ? Math.round(sum / v.length) : null,
    top5: v.length ? Math.round(v.slice(-5).reduce((s, x) => s + x, 0) / 5) : null, max: v[v.length - 1] ?? null,
  };
}
/** Same, from a stored [n, sum, top5 sum] summary. */
export const fromSummary = (s) => (s ? { n: s[0], sum: s[1], mean: s[0] ? Math.round(s[1] / s[0]) : null, top5: Math.round(s[2] / 5) } : null);

/** The club code of a competition's organiser ("6803 - CLUB ..."); committees,
 *  ligues and the federation ("63 - Puy-de-Dôme", "IF - ...", "FFCO - ...") have none. */
export const organiserClub = (organizer) => /^(\d{4}) - /.exec(organizer || "")?.[1] || null;

/**
 * Every club (and ligue) at a month-end, for one CN method and discipline, with
 * both runner bases computed over the runners of the selected sex/age group, and
 * the competitions organised in the discipline over the 12 months to that date.
 * group: { code, ligue, cn: measures & best, pts: measures & best,
 *          org: { n, per100, members }, members }.
 */
export async function clubTable(method, terrain, month, { sexe = "*", age = "*" } = {}) {
  const [{ rows }, elite] = await Promise.all([
    loadRanking([method], terrain, month),
    data.eliteWindow(month, terrain),
  ]);
  const clubs = new Map();
  const get = (code) => {
    if (!clubs.has(code)) clubs.set(code, { code, cnRows: [], ptsBy: new Map(), ligues: new Map(), ranked: 0, organised: 0 });
    return clubs.get(code);
  };
  for (const r of rows) {
    if (r.cn[method] == null || !r.clubCode) continue;
    const g = get(r.clubCode);
    if (r.ligue) g.ligues.set(r.ligue, (g.ligues.get(r.ligue) || 0) + 1);
    g.ranked++;
    if (inGroup(r.cat, sexe, age)) g.cnRows.push(r);
  }
  for (const e of elite.rows) {
    const code = e[data.E.club];
    if (!code || !inGroup(e[data.E.cat], sexe, age)) continue;
    const g = get(code);
    const lic = e[data.E.lic];
    g.ptsBy.set(lic, (g.ptsBy.get(lic) || 0) + e[data.E.pts]);
  }
  const from = addDays(month, -365);
  for (const c of data.comps().values()) {
    const code = c.terrain === terrain && c.date > from && c.date <= month ? organiserClub(c.organizer) : null;
    if (code) get(code).organised++;
  }
  const per100 = (n, members) => (n && members ? Math.round(1000 * n / members) / 10 : null);
  const out = [...clubs.values()].map((g) => {
    const best = g.cnRows.reduce((b, r) => (!b || r.cn[method] > b.cn[method] ? r : b), null);
    const topPts = [...g.ptsBy.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      code: g.code, ligue: mostCommon(g.ligues), members: g.cnRows,
      cn: { ...measures(g.cnRows.map((r) => r.cn[method])), best },
      pts: { ...measures([...g.ptsBy.values()]), best: topPts ? { lic: topPts[0], value: topPts[1] } : null },
      org: { n: g.organised, per100: per100(g.organised, g.ranked), members: g.ranked },
    };
  });
  // ligues: the same over all their clubs' runners
  const lig = new Map();
  for (const c of out) {
    if (!c.ligue) continue;
    if (!lig.has(c.ligue)) lig.set(c.ligue, { code: c.ligue, clubs: 0, cnV: [], ptsV: [], org: 0, ranked: 0 });
    const l = lig.get(c.ligue);
    l.clubs++;
    l.org += c.org.n;
    l.ranked += c.org.members;
    l.cnV.push(...c.members.map((r) => r.cn[method]));
    l.ptsV.push(...[...clubs.get(c.code).ptsBy.values()]);
  }
  const ligues = [...lig.values()].map((l) => ({ code: l.code, clubs: l.clubs, cn: measures(l.cnV), pts: measures(l.ptsV),
    org: { n: l.org, per100: per100(l.org, l.ranked), members: l.ranked } }));
  return { clubs: out, ligues, elite };
}

/** Rank groups on one base/measure; ties share a rank. Sets g.rank. */
export function rankOn(groups, base, measure) {
  const val = (g) => g[base]?.[measure] || 0;
  const sorted = groups.filter((g) => val(g) > 0).sort((a, b) => val(b) - val(a));
  let last = null, pos = 0;
  for (const g of groups) g.rank = null;
  sorted.forEach((g, i) => { if (val(g) !== last) { pos = i + 1; last = val(g); } g.rank = pos; });
  return sorted;
}

function mostCommon(counts) {
  let best = null, n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

export const clubName = (code) => data.meta().names.clubs[code] || code;
