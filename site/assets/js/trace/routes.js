// Route choices on a leg (« Analyse multi »'s « Variantes », after 2DRerun's route-choice tagging): the runners' routes
// between two controls grouped into variants.
// - Each route is resampled to the same number of points by its length, so that two routes compare point by point
//   whatever their GPS rates and speeds.
// - Two routes are as far apart as their discrete Fréchet distance (the « dog leash »: the shortest leash with which a
//   dog and its owner walk both routes from start to end, neither going back): it follows the routes' order, so a
//   loop around a hill one way and the other way are far apart even though they cover the same ground.
// - Variants are groups in which every two routes are within a threshold (complete linkage): a chain of routes each
//   a little apart never merges two different choices. The threshold defaults to a fifth of the leg's straight length,
//   30 to 120 m (GPS noise is ±10 m, two sides of a hill 100 m or more).
// - Hand edits (a runner moved, two variants merged, a name) freeze the leg: the grouping is then the edit's, and a
//   trace added later joins the variant whose routes are nearest if it is within the threshold, else a new one.

export const VARIANT_COLOURS = ["#1f77b4", "#d62728", "#2ca02c", "#ff7f0e", "#9467bd", "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#7f7f7f"];
export const variantKey = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** A polyline (xs, ys, from index a to b) resampled to n points equally spaced along its length: [[x, y]…]. */
export function resample(xs, ys, a, b, n = 32) {
  const cum = [0];
  for (let i = a + 1; i <= b; i++) cum.push(cum[cum.length - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const L = cum[cum.length - 1], out = [];
  let k = 0;
  for (let q = 0; q < n; q++) {
    const d = n > 1 ? (q / (n - 1)) * L : 0;
    while (k < cum.length - 2 && cum[k + 1] < d) k++;
    const seg = cum[k + 1] - cum[k] || 1, u = Math.max(0, Math.min(1, (d - cum[k]) / seg)), i = a + k;
    out.push(b > a ? [xs[i] + u * (xs[i + 1] - xs[i]), ys[i] + u * (ys[i + 1] - ys[i])] : [xs[a], ys[a]]);
  }
  return out;
}

/** The discrete Fréchet distance between two point lists. */
export function frechet(P, Q) {
  const n = P.length, m = Q.length;
  let prev = new Float64Array(m), cur = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const d = Math.hypot(P[i][0] - Q[j][0], P[i][1] - Q[j][1]);
      if (!i && !j) cur[j] = d;
      else if (!i) cur[j] = Math.max(cur[j - 1], d);
      else if (!j) cur[j] = Math.max(prev[j], d);
      else cur[j] = Math.max(Math.min(prev[j], prev[j - 1], cur[j - 1]), d);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m - 1];
}

/** The groups of complete linkage under a threshold: a group index per item, given the distance matrix. */
export function completeLinkage(D, th) {
  let groups = D.map((_, i) => [i]);
  const far = (A, B) => { let m = 0; for (const i of A) for (const j of B) if (D[i][j] > m) m = D[i][j]; return m; };
  for (;;) {
    let best = null;
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      const d = far(groups[a], groups[b]);
      if (d <= th && (!best || d < best.d)) best = { a, b, d };
    }
    if (!best) break;
    groups[best.a] = groups[best.a].concat(groups[best.b]);
    groups.splice(best.b, 1);
  }
  const out = new Array(D.length);
  groups.forEach((g, k) => g.forEach((i) => { out[i] = k; }));
  return out;
}

/**
 * The variants of a leg. items: [{ uid, pts (resampled, metres), time }]; th: metres; tags: a hand edit { names, assign }
 * or null. -> { th, manual, list: [{ key, name, uids, best, median }], of: Map(uid -> key) }, the automatic variants
 * lettered from the fastest (their best time).
 */
export function legVariants(items, th, tags = null) {
  const D = items.map((a) => items.map((b) => (a === b ? 0 : frechet(a.pts, b.pts))));
  const of = new Map();
  let manual = false;
  if (tags?.assign && Object.keys(tags.assign).length) {
    manual = true;
    const known = items.map((it, i) => [it, i]).filter(([it]) => tags.assign[it.uid]);
    const used = new Set(Object.values(tags.assign));
    let next = 0;
    const fresh = () => { while (used.has(variantKey(next))) next++; const k = variantKey(next); used.add(k); return k; };
    items.forEach((it, i) => {
      if (tags.assign[it.uid]) { of.set(it.uid, tags.assign[it.uid]); return; }
      // a trace added since the edit: the nearest variant (its farthest route within the threshold), else a new one
      let best = null;
      for (const k of new Set(known.map(([x]) => tags.assign[x.uid]))) {
        const d = Math.max(...known.filter(([x]) => tags.assign[x.uid] === k).map(([, j]) => D[i][j]));
        if (d <= th && (!best || d < best.d)) best = { k, d };
      }
      of.set(it.uid, best ? best.k : fresh());
    });
  } else {
    const g = completeLinkage(D, th), n = Math.max(-1, ...g) + 1;
    const bestOf = Array.from({ length: n }, (_, k) => Math.min(...items.filter((_, i) => g[i] === k).map((it) => it.time)));
    const order = [...bestOf.keys()].sort((a, b) => bestOf[a] - bestOf[b]);
    items.forEach((it, i) => of.set(it.uid, variantKey(order.indexOf(g[i]))));
  }
  const keys = [...new Set(of.values())].sort();
  const list = keys.map((key) => {
    const its = items.filter((it) => of.get(it.uid) === key), ts = its.map((it) => it.time).sort((a, b) => a - b);
    return { key, name: tags?.names?.[key] || "", uids: its.map((it) => it.uid), best: ts[0], median: ts.length % 2 ? ts[(ts.length - 1) / 2] : (ts[ts.length / 2 - 1] + ts[ts.length / 2]) / 2 };
  }).sort((a, b) => a.best - b.best);
  return { th, manual, list, of };
}
