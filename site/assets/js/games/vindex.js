// « Indice Ozimut virtuel » (Coach › Virtually; owner, 2026-11-11): the Ozimut method's rules (cn.js) applied to the virtual
// runs. Pure: runs in, results out; pages/virtually.js draws them and its « Résultats » tab explains them.
//
// - A run counts when it is a competition's (owner, 2026-11-11: trainings are played as often as one likes, only competitions
//   make the index and the ranking), the runner's first on that course (its time includes « Ma position »'s penalties; `help`,
//   a run of before marked as helped, never counts)
//   (a competition is played once; the server refuses a second run). Trainings are scored all the same — on the indices the
//   competitions give —, their scores shown but never counted.
// - A circuit's value is the arithmetic mean of (index × time) over the fastest 90 % of its counted runners (the published
//   method's forest rule, `circuitValue`), from one runner on (a virtual circuit has few runners); a score = value ÷ time.
// - A runner's index: their best 60 % of scores over 12 months filling 6 places (`topWeighted`), 2 counted runs at least; before
//   that, their seed: their own Ozimut forest index when the site knows it at their first run, else SEED_DEFAULT (about the
//   middle of France's forest ranking).
// - The indices and the circuits' values depend on each other: computed together, twenty rounds from the seeds, the scale held
//   each round so that the mean of the indices of the runners with two runs stays the mean of their seeds.
import { circuitValue, topWeighted, dround } from "../cn.js";

export const SEED_DEFAULT = 3500;
export const SAMPLE = 0.9, MIN_RUNS = 2, WINDOW_DAYS = 365, ROUNDS = 20;

/** Every run's reason not to count, or "" when it counts: "training", "help", "again" (not the runner's first on the course). */
function reasons(runs) {
  const seen = new Set();
  const out = new Map();
  for (const r of [...runs].sort((a, b) => a.at.localeCompare(b.at))) {
    const key = `${r.race}|${r.event || ""}|${r.course}|${r.u}`;
    const again = seen.has(key); seen.add(key);
    out.set(r, r.kind !== "competition" ? "training" : r.help ? "help" : again ? "again" : "");
  }
  return out;
}

/**
 * runs: every run of every map [{ id, race, course, kind, event, u, name, t, sp, at, help, seed }].
 * Returns { runs (each with why, score, value), circuits: Map(key → { value, n }), runners: Map(u → { u, name, index, seed,
 * counted, scores, last, provisional }) }; a circuit's key `${race}|${event}|${course}|${kind}`.
 */
export function compute(runs, today = new Date().toISOString().slice(0, 10)) {
  const why = reasons(runs);
  const from = new Date(Date.parse(today + "T00:00:00Z") - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const runners = new Map();
  for (const r of [...runs].sort((a, b) => a.at.localeCompare(b.at))) {
    let p = runners.get(r.u);
    if (!p) runners.set(r.u, (p = { u: r.u, name: r.name, seed: r.seed || SEED_DEFAULT, ownSeed: !!r.seed, index: null, counted: 0, scores: [], last: "" }));
    p.name = r.name || p.name;
    if (r.at > p.last) p.last = r.at;
  }
  const circuitKey = (r) => `${r.race}|${r.event || ""}|${r.course}|${r.kind === "competition" ? "c" : "t"}`;
  const groups = new Map();
  for (const r of runs) { const k = circuitKey(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const idx = new Map([...runners.values()].map((p) => [p.u, p.seed]));
  const circuits = new Map();
  const counts = (r) => why.get(r) === "" && r.at.slice(0, 10) >= from;
  for (let round = 0; round < ROUNDS; round++) {
    const raw = new Map();
    for (const [k, list] of groups) {
      const ranked = list.filter((r) => why.get(r) === "" || (why.get(r) === "training" && !r.help && firstTraining(list, r)));
      const pairs = ranked.map((r) => [idx.get(r.u), r.t]);
      raw.set(k, { v: pairs.length ? circuitValue(pairs, { sample_fraction: SAMPLE, min_ranked: 1 }) : null, n: ranked.length });
    }
    // the scale: the runners with an index keep the mean of their seeds
    let sumSeed = 0, sumCn = 0;
    for (const p of runners.values()) {
      const mine = runs.filter((r) => r.u === p.u && counts(r)).map((r) => raw.get(circuitKey(r)).v / r.t).filter((x) => x > 0);
      const res = topWeighted(mine, mine.map(() => 1), { topN: 6, frac: 0.6, minScores: MIN_RUNS });
      if (res.cn) { sumSeed += p.seed; sumCn += res.cn; }
    }
    const k = sumCn ? sumSeed / sumCn : 1;
    for (const [key, c] of raw) circuits.set(key, { value: c.v ? dround(c.v * k) : null, n: c.n });
    for (const r of runs) { const v = raw.get(circuitKey(r)).v; r.value = v ? dround(v * k) : null; r.score = v ? dround((v * k) / r.t) : null; }
    for (const p of runners.values()) {
      const mine = runs.filter((r) => r.u === p.u && counts(r) && r.score);
      const res = topWeighted(mine.map((r) => r.score), mine.map(() => 1), { topN: 6, frac: 0.6, minScores: MIN_RUNS });
      p.counted = mine.length; p.scores = mine;
      idx.set(p.u, res.cn || p.seed);
    }
  }
  for (const p of runners.values()) {
    p.provisional = p.counted < MIN_RUNS;
    p.index = dround(idx.get(p.u));
  }
  for (const r of runs) r.why = why.get(r);
  return { runs, circuits, runners, circuitKey };
}

/** A training is valued (not counted) on each runner's first run of it: their later runs know the way. */
function firstTraining(list, r) {
  const mine = list.filter((x) => x.u === r.u && !x.help).sort((a, b) => a.at.localeCompare(b.at));
  return mine[0] === r;
}
