// Recomputes a runner's CN at any date and explains it race by race.
//
// Mirrors ffco_scraper/cn.py exactly — same rounding (half away from zero,
// not banker's), same trim counts, same stable tie order — so the breakdown a
// visitor sees reproduces the published month-end snapshots to the point.

import { R } from "./data.js";

export const dround = (x) => (x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5));

const WINDOW_DAYS = 365;
function windowStart(iso) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
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

/** Best `topN` races taken from the best `frac` of the window, group-weighted. */
export function topWeighted(values, weights, { topN = 6, frac = 0.6, minScores = 3 } = {}) {
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
    roles[idx] = "kept"; sw += u; sx += values[idx] * u;
  });
  return { cn: sw > 0 ? dround(sx / sw) : null, roles, used, nKept };
}

/**
 * Explain the CN of `races` (one runner) at date `iso`, discipline `terrain`.
 * Returns { cn, rows: [{race, value, weight, role, used}], ... } per method.
 */
export function explain(method, races, iso, terrain, meta) {
  const from = windowStart(iso);
  const inWin = (r) => r[R.date] >= from && r[R.date] <= iso;
  const splitYear = meta.split_year;

  if (method === "fair" || method === "top6w") {
    const p = meta.methods[method].params;
    // Each race has ONE score, fixed when it was computed (raw x the recalage factor of the race's month,
    // the value the Courses page shows), the same in both methods; the CN is the weighted mean of the best
    // 60 % of them - all of them for Fair, only those filling the weight places for Top. No factor here.
    const [score, counts] = method === "fair" ? [R.fScore, R.fCounts] : [R.t6Score, R.t6Counts];
    const rows = races
      .filter((r) => r[R.terrain] === terrain && inWin(r) && r[counts] && r[score] != null)
      .map((r) => ({ race: r, value: r[score], weight: r[R.t6Weight] || 1 }));
    const res = topWeighted(rows.map((x) => x.value), rows.map((x) => x.weight), {
      topN: p.top_n ?? Infinity, frac: p.eligible_fraction, minScores: p.min_scores,
    });
    rows.forEach((x, i) => { x.role = res.roles[i]; x.used = res.used[i]; });
    return { method, cn: res.cn, rows, nKept: res.nKept, from, iso };
  }

  // official: published values, plus an indicative reconstruction
  const pooled = Number(iso.slice(0, 4)) < splitYear;
  const rows = races
    .filter((r) => (pooled || r[R.terrain] === terrain) && inWin(r) && r[R.offScore] != null)
    .map((r) => ({ race: r, value: r[R.offScore], weight: 1 }));
  const res = trimmed(rows.map((x) => x.value), 2);
  rows.forEach((x, i) => { x.role = res.roles[i]; });
  let published = null;
  for (const r of races) {
    if ((pooled || r[R.terrain] === terrain) && r[R.date] <= iso && r[R.offCnAfter]) {
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

/** Races that count towards a method's series (official was pooled before the split). */
const inSeries = (r, method, terrain, meta) =>
  r[R.terrain] === terrain || (method === "official" && Number(r[R.date].slice(0, 4)) < meta.split_year);

/**
 * A runner's CN history as a list of events, like the federation's "historique"
 * page: every race entering the 12-month window and every race leaving it, with the
 * CN after and the change. (A recalage only sets the scores of the races to come, so
 * it never moves a CN by itself.)
 * Returns [{ date, kind: "in"|"out", races: [race rows], cn, delta }], oldest first.
 */
export function cnHistory(method, races, terrain, meta, until) {
  const mine = races.filter((r) => inSeries(r, method, terrain, meta));
  const events = new Map();                       // date -> { in: [], out: [], recal }
  const at = (d) => { if (!events.has(d)) events.set(d, { in: [], out: [], recal: false }); return events.get(d); };
  for (const r of mine) {
    at(r[R.date]).in.push(r);
    const out = addDaysIso(r[R.date], WINDOW_DAYS + 1);
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
  const mine = races.filter((r) => inSeries(r, method, terrain, meta));
  if (!mine.length) return [];
  const first = mine[0][R.date], last = addDaysIso(mine[mine.length - 1][R.date], WINDOW_DAYS);
  const pts = [];
  for (const m of meta.months) {
    if (m < first || m > last) continue;
    const cn = explain(method, races, m, terrain, meta).cn;
    if (cn) pts.push([m, cn]);
  }
  return pts;
}
