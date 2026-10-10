// Age-category progression: where a CN sits among everyone of the same age
// category, using the season-end category distributions (agecurve.json).

import { R, FOOT } from "./data.js";
import { monthlyCn } from "./cn.js";

/** Snapshot key of a method/discipline in a season (official was pooled before the split). */
export const curveKey = (m, terrain, season, split) =>
  m === "official" && FOOT.includes(terrain) && (season === "all" || Number(season) < split) ? "official_Ped" : `${m}_${terrain}`;

/** Percentile (0–100) of `v` within a distribution given by quantiles q[] at levels qs[]. */
export function percentileOf(v, qs, q) {
  if (v <= q[0]) return 0;
  if (v >= q[q.length - 1]) return 100;
  for (let i = 1; i < q.length; i++) {
    if (v <= q[i]) {
      const span = q[i] - q[i - 1];
      return qs[i - 1] + (span ? (qs[i] - qs[i - 1]) * (v - q[i - 1]) / span : 0);
    }
  }
  return 100;
}

const CAT = /^([HD])(\d+)/;

/** The birth year a runner's junior races give: a junior category of age a in season y (H14: 13 or 14 that year)
 *  means born in y − a or later, and one may run in an older category, never a younger one — so the latest such
 *  year is the birth year (exact once they have raced in their own category). null without junior races. */
export function birthYear(races) {
  let b = null;
  for (const r of races) {
    const m = CAT.exec(r[R.cat] || "");
    if (m && Number(m[2]) <= 20) b = Math.max(b ?? -Infinity, Number(r[R.date].slice(0, 4)) - Number(m[2]));
  }
  return b;
}

/** Category of the runner at a date: their age category while a junior (from the birth year: a category run up,
 *  or last season's, does not carry into a new season), else the one of their latest race on or before it. */
export function catAt(races, iso, born = birthYear(races)) {
  let cat = null;
  for (const r of races) { if (r[R.date] > iso) break; if (r[R.cat]) cat = r[R.cat]; }
  const m = CAT.exec(cat || "");
  if (!m || born == null) return cat;
  const age = Number(iso.slice(0, 4)) - born;
  if (age <= 20) return `${m[1]}${age <= 10 ? 10 : age + (age % 2)}`;
  return Number(m[2]) <= 20 ? `${m[1]}21` : cat;
}

/**
 * Month by month: CN, category, that season's distribution of the category and
 * the runner's percentile in it. [{ iso, cn, cat, curve, pct }]
 */
export function monthlyProgress(method, races, terrain, meta, ac) {
  const born = birthYear(races);
  return monthlyCn(method, races, terrain, meta).map(([iso, cn]) => {
    const y = iso.slice(0, 4);
    const cat = catAt(races, iso, born);
    const curve = cat ? ac.data[curveKey(method, terrain, y, meta.split_year)]?.[y]?.[cat] : null;
    return { iso, cn, cat, curve, pct: curve ? percentileOf(cn, ac.q, curve.slice(1)) : null };
  });
}

/** Season-end points (for the curve by category). */
export const seasonEnds = (monthly, ac) =>
  monthly.filter((p) => ac.months[p.iso.slice(0, 4)] === p.iso);
