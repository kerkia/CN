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
  if (n < minScores) return { cn: null, roles: values.map(() => null) };
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]); // stable
  const pool = Math.max(1, dround(frac * n));
  const take = Math.min(pool, topN);
  const roles = new Array(n);
  let sw = 0, sx = 0;
  order.forEach((idx, rank) => {
    if (rank < take) { roles[idx] = "kept"; sw += weights[idx]; sx += values[idx] * weights[idx]; }
    else roles[idx] = rank >= pool ? "notTop60" : "notTop6";
  });
  return { cn: sw > 0 ? dround(sx / sw) : null, roles, nKept: take };
}

function factorAt(schedule, iso) {
  if (!schedule || !schedule.length) return 1;
  let f = schedule[0][1];
  for (const [d, v] of schedule) { if (d <= iso) f = v; else break; }
  return f;
}

/**
 * Explain the CN of `races` (one runner) at date `iso`, discipline `terrain`.
 * Returns { cn, rows: [{race, value, weight, role, rescaled}], ... } per method.
 */
export function explain(method, races, iso, terrain, meta) {
  const from = windowStart(iso);
  const inWin = (r) => r[R.date] >= from && r[R.date] <= iso;
  const splitYear = meta.split_year;

  if (method === "v2026") {
    const years = Object.keys(meta.rescale).map(Number).sort((a, b) => a - b);
    const rows = races
      .filter((r) => r[R.terrain] === terrain && inWin(r) && r[R.v26Counts] && r[R.v26Score] != null)
      .map((r) => {
        let s = r[R.v26Score];
        let rescaled = 1;
        for (const y of years) {
          const b = `${y}-01-01`;
          if (r[R.date] < b && b <= iso) {
            const f = meta.rescale[String(y)];
            s = dround(s * f);
            rescaled *= f;
          }
        }
        return { race: r, value: s, weight: 1, rescaled };
      });
    const res = trimmed(rows.map((x) => x.value), meta.methods.v2026.params.min_scores);
    rows.forEach((x, i) => { x.role = res.roles[i]; });
    return { method, cn: res.cn, rows, nKept: res.nKept, from, iso };
  }

  if (method === "top6w") {
    const p = meta.methods.top6w.params;
    // The CN is the weighted mean of the RAW scores times the month's recalage factor. `scaled` is each score
    // on the CN scale (raw x factor): the weighted mean of the kept ones is the CN. (The Courses page shows
    // `published`: raw x the factor of the month of the race, so the two differ a little when the factor moved.)
    const factor = factorAt(meta.normalisation[terrain], iso);
    const rows = races
      .filter((r) => r[R.terrain] === terrain && inWin(r) && r[R.t6Counts] && r[R.t6Raw] != null)
      .map((r) => ({ race: r, value: r[R.t6Raw], weight: r[R.t6Weight] || 1, scaled: dround(r[R.t6Raw] * factor), published: r[R.t6Score] }));
    const res = topWeighted(rows.map((x) => x.value), rows.map((x) => x.weight), {
      topN: p.top_n, frac: p.eligible_fraction, minScores: p.min_scores,
    });
    rows.forEach((x, i) => { x.role = res.roles[i]; });
    return {
      method, raw: res.cn, factor, cn: res.cn == null ? null : dround(res.cn * factor),
      rows, nKept: res.nKept, from, iso,
    };
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
 * page: every race entering the 12-month window, every race leaving it, and —
 * for the computed methods — every recalage, with the CN after and the change.
 * Returns [{ date, kind: "in"|"out"|"recal", races: [race rows], cn, delta }], oldest first.
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
  if (mine.length) {
    const first = mine[0][R.date];
    if (method === "v2026") {
      for (const y of Object.keys(meta.rescale)) { const d = `${y}-01-01`; if (d > first && d <= until) at(d).recal = true; }
    } else if (method === "top6w") {
      for (const [d] of meta.normalisation[terrain] || []) if (d > first && d <= until) at(d).recal = true;
    }
  }
  const out = [];
  let prev = null;
  for (const d of [...events.keys()].sort()) {
    const e = events.get(d);
    const cn = method === "official"
      ? (e.in.map((r) => r[R.offCnAfter]).filter(Boolean).pop() ?? prev)
      : explain(method, races, d, terrain, meta).cn;
    if (!e.in.length && cn === prev) continue;       // a race left or a recalage with no visible effect
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
