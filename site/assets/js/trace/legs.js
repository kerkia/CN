// Legs against a field, as « Temps intermédiaires » counts them (« Analyse solo », « Analyse multi »):
// - the time lost on a leg is WinSplits' "time loss": the runner's leg time less what it would have been at their own
//   pace on their good legs — the best leg time × the median of their leg-time / best-leg-time ratios; a leg lost by
//   20 % of its time and by 10 s at least is a mistake;
// - the references a gap is read against: the leader at each control (the best cumulative time there), the
//   « superman » (the sum of the best legs), or one runner.

export const ERR = { pct: 20, s: 10 };                     // the split-times page's mistake rule

/** The best time of each of n legs over a field (each runner's leg times, null where unknown; ≤ 0 ignored). */
export const bestLegs = (all, n) => Array.from({ length: n }, (_, i) => {
  const v = all.map((l) => l[i]).filter((x) => x != null && x > 0);
  return v.length ? Math.min(...v) : null;
});
/** A runner's usual ratio to the best: the median of their legs' time / best time, or null. */
export function usualRatio(mine, best) {
  const ratios = mine.map((v, i) => (v != null && best[i] ? v / best[i] : null)).filter((x) => x != null).sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)] : null;
}
/** Each leg's time lost (s, negative: better than usual) and whether it is a mistake, [{ lost, mistake }]. */
export function legLoss(mine, best, err = ERR) {
  const med = usualRatio(mine, best);
  return mine.map((v, i) => {
    if (v == null || !best[i] || !med) return { lost: null, mistake: false };
    const lost = v - best[i] * med;
    return { lost, mistake: lost >= err.s && lost >= (err.pct / 100) * v };
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
