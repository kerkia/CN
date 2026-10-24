// Legs against a field, as « Temps intermédiaires » counts them (« Analyse solo », « Analyse multi »):
// - the time lost on a leg is WinSplits' and MeOS's "time loss": the runner's leg time less what it would have been at
//   their own pace on their good legs — the leg's reference time (`refLegs`, MeOS's) × their usual pace (`usualPace`:
//   their time over the reference times on the legs without a mistake); a leg lost by 20 % of its time and by 10 s at
//   least is a mistake. Until 2026-10-24: the best leg time × the median of their ratios to it, which came out 7 % slower
//   than MeOS's pace on a sprint (mistakes and short legs counted as much as the rest) and the time lost a quarter smaller;
// - the references a gap is read against: the leader at each control (the best cumulative time there), the
//   « superman » (the sum of the best legs), or one runner.

export const ERR = { pct: 20, s: 10 };                     // the split-times page's mistake rule

/** The best time of each of n legs over a field (each runner's leg times, null where unknown; ≤ 0 ignored). */
export const bestLegs = (all, n) => Array.from({ length: n }, (_, i) => {
  const v = all.map((l) => l[i]).filter((x) => x != null && x > 0);
  return v.length ? Math.min(...v) : null;
});
/** Each leg's reference time, as MeOS's: the best under 5 times, the mean of the two best under 12, else the mean of the
 *  fastest sixth after the winner (a single best time can be a lucky or a mistimed leg); null where nobody has a time. */
export const refLegs = (all, n) => Array.from({ length: n }, (_, i) => {
  const v = all.map((l) => l[i]).filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length < 5) return v[0];
  if (v.length < 12) return (v[0] + v[1]) / 2;
  const m = Math.floor(v.length / 6);
  return v.slice(1, 1 + m).reduce((s, x) => s + x, 0) / m;
});
/** A runner's usual ratio to the best: the median of their legs' time / best time, or null. */
export function usualRatio(mine, best) {
  const ratios = mine.map((v, i) => (v != null && best[i] ? v / best[i] : null)).filter((x) => x != null).sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)] : null;
}
/** A leg lost by `d` seconds out of its `v` is a mistake. */
export const isMistake = (v, d, err = ERR) => d > 0 && d >= err.s && d >= (err.pct / 100) * v;
/** A runner's usual pace against the reference times `ref`: their time over the reference times on the legs without a
 *  mistake, each leg weighing its time — the mistakes found from the median ratio first, then from the pace, three times;
 *  null when no leg has both. */
export function usualPace(mine, ref, err = ERR) {
  const ok = mine.map((v, i) => v != null && v > 0 && ref[i] > 0);
  let pace = usualRatio(mine.map((v, i) => (ok[i] ? v : null)), ref);
  for (let round = 0; pace && round < 3; round++) {
    let tv = 0, tr = 0;
    mine.forEach((v, i) => { if (ok[i] && !isMistake(v, v - ref[i] * pace, err)) { tv += v; tr += ref[i]; } });
    if (!tr) break;
    pace = tv / tr;
  }
  return pace;
}
/** Each leg's time lost (s, negative: better than usual) and whether it is a mistake, [{ lost, mistake, expect }]
 *  (`expect`: the leg at the runner's usual pace); `ref`: the legs' reference times (refLegs). */
export function legLoss(mine, ref, err = ERR) {
  const pace = usualPace(mine, ref, err);
  return mine.map((v, i) => {
    const expect = pace && ref[i] > 0 ? ref[i] * pace : null;
    if (v == null || expect == null) return { lost: null, mistake: false, expect };
    const lost = v - expect;
    return { lost, mistake: v > 0 && isMistake(v, lost, err), expect };
  });
}
/** Leg times -> cumulative times at each control, the start (0) first; null from an unknown leg on. */
export function cumOf(legs) {
  let acc = 0;
  return [0, ...legs.map((v) => (acc == null || v == null ? (acc = null) : (acc += v)))];
}
/**
 * A reference's cumulative times at each control (the start's 0 first): "leader", the best cumulative time at each
 * control; "superman", the sum of the best legs; else the given runner's legs (`own`). all: each runner's leg times.
 */
export function referenceCum(kind, all, n, own = null) {
  if (kind === "superman") return cumOf(bestLegs(all, n));
  if (kind === "leader") {
    const cums = all.map(cumOf);
    return Array.from({ length: n + 1 }, (_, j) => { const v = cums.map((c) => c[j]).filter((x) => x != null); return v.length ? Math.min(...v) : null; });
  }
  return own ? cumOf(own) : Array(n + 1).fill(null);
}
