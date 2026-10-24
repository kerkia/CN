// Published results on a trace (« Analyse solo », « Analyse multi » for a competition of « Résultats »): the results'
// start times are Paris wall-clock, a trace's times UTC; a class's split times are cumulative race times at its controls.
// - A course drawn by the organiser (start, controls, finish) is matched to a class's published sequence by the controls'
//   codes in order when both have them, else by their number when it is the same; else not at all.
// - A runner's trace time of the race start (the clock offset) comes from their published start time when it agrees
//   with the trace's own passes at the controls (within 2 min), else from those passes alone (the median shift of the
//   published times to them, passes over 60 s off dropped; two at least): a pass found 25 m from a control is a guess,
//   a published split time is not.

/** Paris's offset to UTC on a day (ms): the results' start times are wall-clock, the trace's are UTC. */
export function parisOffsetMs(dateIso) {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const h = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).formatToParts(d).find((p) => p.type === "hour").value;
  return (h - 12) * 3600e3;
}
/** A published start (seconds after midnight, Paris, on dateIso) as seconds of a trace beginning at ms0 (UTC ms). */
export const startOnTrace = (dateIso, startS, ms0) => (Date.parse(`${dateIso}T00:00:00Z`) - parisOffsetMs(dateIso) + startS * 1000 - ms0) / 1000;

/** A runner's published race times: the start's 0, each control's cumulative time, the finish's (null where unknown). */
export const publishedTaus = (x) => [0, ...(x.splits || []), x.status === "ok" && x.time_s != null ? x.time_s : null];

/**
 * The course's controls (each { kind, code }) matched to a class's sequence of m controls (codes, maybe empty): for
 * each course control, its index in publishedTaus (0 the start, m + 1 the finish), or null. null when they cannot be
 * matched (different numbers of controls and no codes to go by).
 */
export function matchControls(ctrls, codes, m) {
  const inner = ctrls.map((c, i) => [c, i]).filter(([c]) => c.kind === "control");
  const out = ctrls.map((c) => (c.kind === "start" ? 0 : c.kind === "finish" ? m + 1 : null));
  const norm = (s) => String(s ?? "").trim().replace(/^0+/, "");
  if (codes?.length === m && m && inner.length && inner.every(([c]) => norm(c.code))) {
    let k = 0, hit = 0;
    for (const [c, i] of inner) {                         // in order: a butterfly's codes come back
      let q = k;
      while (q < m && norm(codes[q]) !== norm(c.code)) q++;
      if (q < m) { out[i] = q + 1; k = q + 1; hit++; }
    }
    if (hit >= Math.max(2, 0.6 * inner.length)) return out;
  }
  if (inner.length !== m) return null;
  inner.forEach(([, i], k) => { out[i] = k + 1; });
  return out;
}

/**
 * The passes at the course's controls (trace seconds) from the published times: { passes, offset, from } or null.
 * map: matchControls' result; taus: publishedTaus; guess: the trace's own passes (null where not found); startT: the
 * published start on the trace (startOnTrace) or null; dur: the trace's length (s).
 */
export function publishedPasses(map, taus, guess, startT, dur) {
  if (!map) return null;
  const pairs = [];
  map.forEach((k, i) => { if (k != null && k > 0 && taus[k] != null && guess[i] != null) pairs.push(guess[i] - taus[k]); });
  const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
  let fromPasses = null;
  if (pairs.length >= 2) {
    const m0 = median(pairs), kept = pairs.filter((d) => Math.abs(d - m0) <= 60);
    if (kept.length >= 2) fromPasses = median(kept);
  }
  let offset = null, from = null;
  if (startT != null && (fromPasses == null || Math.abs(startT - fromPasses) <= 120)) { offset = startT; from = "start"; }
  else if (fromPasses != null) { offset = fromPasses; from = "passes"; }
  if (offset == null || offset < -600 || offset > dur) return null;
  const passes = map.map((k, i) => (k != null && taus[k] != null ? offset + taus[k] : null));
  // a control the published times leave out keeps the trace's pass when it falls between its neighbours'
  for (let i = 0; i < passes.length; i++) {
    if (passes[i] != null || guess[i] == null) continue;
    const before = passes.slice(0, i).filter((v) => v != null).pop() ?? -Infinity, after = passes.slice(i + 1).find((v) => v != null) ?? Infinity;
    if (guess[i] > before && guess[i] < after) passes[i] = guess[i];
  }
  return { passes, offset, from };
}

/** A class's leg times on the course's legs (each runner with split times), for the field's best and ranks. */
export function classLegs(klass, map) {
  if (!klass || !map) return [];
  return klass.runners.filter((x) => x.splits?.length).map((x) => {
    const taus = publishedTaus(x);
    return map.slice(1).map((k, j) => { const a = map[j]; return a != null && k != null && taus[a] != null && taus[k] != null && taus[k] > taus[a] ? taus[k] - taus[a] : null; });
  });
}
