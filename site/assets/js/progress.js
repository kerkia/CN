// Age-category progression: where a CN sits among everyone of the same age
// category, using the season-end category distributions (agecurve.json).

import { R } from "./data.js";
import { monthlyCn } from "./cn.js";

/** Snapshot key of a method/discipline in a season (official was pooled before the split). */
export const curveKey = (m, terrain, season, split) =>
  m === "official" && (season === "all" || Number(season) < split) ? "official_Ped" : `${m}_${terrain}`;

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

/** Category of the runner at a date: the one of their latest race on or before it. */
export function catAt(races, iso) {
  let cat = null;
  for (const r of races) { if (r[R.date] > iso) break; if (r[R.cat]) cat = r[R.cat]; }
  return cat;
}

/**
 * Month by month: CN, category, that season's distribution of the category and
 * the runner's percentile in it. [{ iso, cn, cat, curve, pct }]
 */
export function monthlyProgress(method, races, terrain, meta, ac) {
  return monthlyCn(method, races, terrain, meta).map(([iso, cn]) => {
    const y = iso.slice(0, 4);
    const cat = catAt(races, iso);
    const curve = cat ? ac.data[curveKey(method, terrain, y, meta.split_year)]?.[y]?.[cat] : null;
    return { iso, cn, cat, curve, pct: curve ? percentileOf(cn, ac.q, curve.slice(1)) : null };
  });
}

/** Season-end points (for the curve by category). */
export const seasonEnds = (monthly, ac) =>
  monthly.filter((p) => ac.months[p.iso.slice(0, 4)] === p.iso);
