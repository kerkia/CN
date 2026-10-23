// Recomputes a runner's CN at any date and explains it race by race.
//
// Mirrors ffco_scraper/cn.py exactly — same rounding (half away from zero,
// not banker's), same trim counts, same stable tie order — so the breakdown a
// visitor sees reproduces the published month-end snapshots to the point.

import { R, FOOT, inSeries, SCORE_COL, COUNTS_COL, WEIGHT_COL } from "./data.js";

export const dround = (x) => (x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5));

/** A method's params in a discipline: the general ones, with the discipline's own (window, best share). */
export function paramsFor(meta, method, terrain) {
  const p = meta.methods[method]?.params || {};
  return { ...p, ...(p.by_terrain?.[terrain] || {}) };
}
/** The window of a method in a discipline, in days (official: FFCO's 12 months). */
const windowDays = (method, terrain, meta) =>
  (method === "official" ? 365 : paramsFor(meta, method, terrain).window_days ?? 365);
function windowStart(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** A circuit's value from its ranked CN holders' [CN J-15, time in seconds], mirroring cn.circuit_value: the
 *  fastest ⌈sample_fraction × N⌉ (all of them at min_ranked), the arithmetic mean of CN × time (cv_power 1, FFCO's
 *  rule and every published method's; other powers for studies); null below min_ranked runners. Only the live page
 *  estimates one. */
export function circuitValue(pairs, { sample_fraction = 2 / 3, min_ranked = 4, cv_power = 1 } = {}) {
  const n = pairs.length;
  if (n < min_ranked) return null;
  const ordered = pairs.slice().sort((a, b) => a[1] - b[1]);
  const k = n === min_ranked ? n : Math.max(1, Math.ceil(sample_fraction * n - 1e-9));
  const sub = ordered.slice(0, k);
  if (cv_power === 0) return dround(Math.exp(sub.reduce((s, [c, t]) => s + Math.log(c * t), 0) / k));
  if (cv_power === 1) return dround(sub.reduce((s, [c, t]) => s + c * t, 0) / k);
  return dround((sub.reduce((s, [c, t]) => s + (c * t) ** cv_power, 0) / k) ** (1 / cv_power));
}

/** Federation trim: drop the best 10% and worst 40% (rounded), mean the rest. */
export function trimmed(values, minScores = 2) {
  const n = values.length;
  if (n < minScores) return { cn: null, roles: values.map(() => null) };
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]); // stable
  const nBest = dround(0.10 * n), nWorst = dround(0.40 * n);
  const roles = new Array(n);
  let kept = [];
  order.forEach((idx, rank) => {
    if (rank < nBest) roles[idx] = "best10";
    else if (rank >= n - nWorst) roles[idx] = "worst40";
    else { roles[idx] = "kept"; kept.push(values[idx]); }
  });
  if (!kept.length) {                       // degenerate trim: middle score
    const mid = order[Math.floor(n / 2)];
    roles[mid] = "kept";
    kept = [values[mid]];
  }
  return { cn: dround(kept.reduce((s, x) => s + x, 0) / kept.length), roles, nKept: kept.length };
}

/** A junior category (cn.is_junior): H or D followed by an age of 20 or less. */
export function isJunior(cat) {
  const m = /^[HD](\d+)/.exec(String(cat || "").trim().toUpperCase());
  return !!m && Number(m[1]) <= 20;
}
const FADE_FLOOR = 1e-3;                         // cn.JUNIOR_FADE_FLOOR
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

/** Best `topN` races taken from the best `frac` of the window, group-weighted; `power` 2 = quadratic mean, 3 = cubic.
 *  `fade` (cn.fade_factors): each race's factor in the mean - a junior's race fading with its age -, its places
 *  still taken by its weight. */
export function topWeighted(values, weights, { topN = 6, frac = 0.6, minScores = 2, power = 1, fade = null } = {}) {
  const n = values.length;
  if (n < minScores) return { cn: null, roles: values.map(() => null), used: values.map(() => 0), nKept: 0 };
  // topN is a number of slots: from the best score down, each race fills as many as its weight, the last
  // one only what is left (`used`), so a stronger event can never lower the CN
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]); // stable
  const pool = Math.max(1, dround(frac * n));
  const roles = new Array(n), used = new Array(n).fill(0);
  let slots = topN, sw = 0, sx = 0, nKept = 0;
  order.forEach((idx, rank) => {
    if (rank >= pool) { roles[idx] = "notTop60"; return; }
    if (slots <= 0) { roles[idx] = "notTop6"; return; }
    const u = Math.min(weights[idx], slots);
    slots -= u; used[idx] = u; nKept++;
    const uf = u * (fade ? fade[idx] : 1);
    roles[idx] = "kept"; sw += uf; sx += (power === 1 ? values[idx] : values[idx] ** power) * uf;
  });
  const mean = sw > 0 ? sx / sw : null;
  return { cn: mean == null ? null : dround(power === 1 ? mean : mean ** (1 / power)), roles, used, nKept };
}

/**
 * Explain the CN of `races` (one runner) at date `iso`, discipline `terrain`.
 * Returns { cn, rows: [{race, value, weight, role, used}], ... } per method.
 */
export function explain(method, races, iso, terrain, meta) {
  const from = windowStart(iso, windowDays(method, terrain, meta));
  const inWin = (r) => r[R.date] >= from && r[R.date] <= iso;

  if (method !== "official") {
    const p = paramsFor(meta, method, terrain);
    // Each race has ONE score, fixed when it was computed (raw x the recalage factor of the race's day,
    // the value the Courses page shows), the same in both methods; the CN is the weighted mean of the best
    // 60 % of them (70 % in VTT and ski) - all of them for Fair, only those filling the weight places for Top.
    const [score, counts, weight] = [SCORE_COL[method], COUNTS_COL[method], WEIGHT_COL[method]];
    // the juniors' races fade (params.junior_fade): weight x (1 - age / the window) in the mean, read on `iso`
    const span = (p.junior_fade || 0) * windowDays(method, terrain, meta);
    const rows = races
      .filter((r) => r[R.terrain] === terrain && inWin(r) && r[counts] && r[score] != null)
      .map((r) => ({ race: r, value: r[score], weight: r[weight] || 1,
        fade: span && isJunior(r[R.cat]) ? Math.max(FADE_FLOOR, 1 - daysBetween(r[R.date], iso) / span) : 1 }));
    const res = topWeighted(rows.map((x) => x.value), rows.map((x) => x.weight), {
      topN: p.top_n ?? Infinity, frac: p.eligible_fraction, minScores: p.min_scores, power: p.cn_power ?? 1,
      fade: span ? rows.map((x) => x.fade) : null,
    });
    rows.forEach((x, i) => { x.role = res.roles[i]; x.used = res.used[i]; });
    return { method, cn: res.cn, rows, nKept: res.nKept, from, iso };
  }

  // official: published values, plus an indicative reconstruction
  const pooled = FOOT.includes(terrain) && Number(iso.slice(0, 4)) < meta.split_year;   // forest + sprint as one
  const rows = races
    .filter((r) => (pooled ? FOOT.includes(r[R.terrain]) : r[R.terrain] === terrain) && inWin(r) && r[R.offScore] != null)
    .map((r) => ({ race: r, value: r[R.offScore], weight: 1 }));
  const res = trimmed(rows.map((x) => x.value), 2);
  rows.forEach((x, i) => { x.role = res.roles[i]; });
  let published = null;
  for (const r of races) {
    if ((pooled ? FOOT.includes(r[R.terrain]) : r[R.terrain] === terrain) && r[R.date] <= iso && r[R.offCnAfter]) {
      if (r[R.date] >= from) published = r[R.offCnAfter];
    }
  }
  return { method, cn: published, reconstructed: res.cn, rows, nKept: res.nKept, from, iso, pooled };
}

const addDaysIso = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};


/**
 * A runner's CN history as a list of events, like the federation's "historique"
 * page: every race entering the window (12 months; longer in VTT and ski) and every race leaving it, with the
 * CN after and the change. (A recalage only sets the scores of the races to come, so
 * it never moves a CN by itself.)
 * Returns [{ date, kind: "in"|"out", races: [race rows], cn, delta }], oldest first.
 */
export function cnHistory(method, races, terrain, meta, until) {
  const mine = races.filter((r) => inSeries(r, method, terrain));
  const win = windowDays(method, terrain, meta);
  const events = new Map();                       // date -> { in: [], out: [], recal }
  const at = (d) => { if (!events.has(d)) events.set(d, { in: [], out: [], recal: false }); return events.get(d); };
  for (const r of mine) {
    at(r[R.date]).in.push(r);
    const out = addDaysIso(r[R.date], win + 1);
    if (method !== "official" && out <= until) at(out).out.push(r);
  }
  const out = [];
  let prev = null;
  for (const d of [...events.keys()].sort()) {
    const e = events.get(d);
    const cn = method === "official"
      ? (e.in.map((r) => r[R.offCnAfter]).filter(Boolean).pop() ?? prev)
      : explain(method, races, d, terrain, meta).cn;
    if (!e.in.length && cn === prev) continue;       // a race left with no visible effect
    const kind = e.in.length ? "in" : e.out.length ? "out" : "recal";
    out.push({ date: d, kind, races: e.in.length ? e.in : e.out, also: e.in.length ? e.out : [], recal: e.recal,
      cn, delta: cn != null && prev != null ? cn - prev : null });
    prev = cn;
  }
  return out;
}

/** CN at every month-end the runner is ranked: [[monthIso, cn]]. */
export function monthlyCn(method, races, terrain, meta) {
  const mine = races.filter((r) => inSeries(r, method, terrain));
  if (!mine.length) return [];
  const first = mine[0][R.date], last = addDaysIso(mine[mine.length - 1][R.date], windowDays(method, terrain, meta));
  const pts = [];
  for (const m of meta.months) {
    if (m < first || m > last) continue;
    const cn = explain(method, races, m, terrain, meta).cn;
    if (cn) pts.push([m, cn]);
  }
  return pts;
}
