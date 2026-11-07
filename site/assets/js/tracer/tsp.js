// The visiting order of a controller's tour (tour.js, 2026-11-07): an asymmetric travelling salesman over the controls chosen,
// on the route engine's costs (climbing a slope costs more than going down it). Pure: no page, no map; tested in Node.
// - a closed tour (back to where one left, or a loop starting anywhere): a cycle over the controls;
// - an open one (from a point to another, or either end left free): a cycle through a dummy node joined at no cost to the
//   allowed first and last controls only.
// Up to 13 nodes the order is exact (Held-Karp's dynamic programme); beyond, the best of several nearest-neighbour starts
// improved by moving runs of 1-3 controls (Or-opt, either way round) and reversing stretches (2-opt, the reversed stretch
// costed both ways), then shaken by double-bridge kicks for the time budget (iterated local search).

const BIG_F = 1e6;                                         // a forbidden arc: this many times the largest real cost

/**
 * The order through n nodes, C their costs (flat n × n, finite). opts: from (the first node's index, -1 free), to (the last
 * node's, -1 free), loop (back to the first: a closed tour), budgetMs (the search's time beyond the exact sizes), seed.
 * Returns { order (node indexes, the first node not repeated at the end of a loop), cost }.
 */
export function solveTour(C, n, { from = -1, to = -1, loop = false, budgetMs = 400, seed = 1 } = {}) {
  if (n <= 0) return { order: [], cost: 0 };
  if (n === 1) return { order: [0], cost: loop ? 0 : 0 };
  if (!loop && from >= 0 && from === to) loop = true;
  let max = 0;
  for (let i = 0; i < n * n; i++) if (Number.isFinite(C[i]) && C[i] > max) max = C[i];
  const BIG = (max || 1) * BIG_F;
  let m, D;
  if (loop) {
    m = n; D = Float64Array.from(C);
  } else {
    // the dummy node d = n: d → j allowed only to a possible first node, i → d only from a possible last one
    m = n + 1; D = new Float64Array(m * m);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i * m + j] = C[i * n + j];
    for (let j = 0; j < n; j++) { D[n * m + j] = from < 0 || j === from ? 0 : BIG; D[j * m + n] = to < 0 || j === to ? 0 : BIG; }
    if (from >= 0) for (let i = 0; i < n; i++) if (i !== from) D[i * m + from] += BIG;        // nothing leads into the first node
    if (to >= 0) for (let j = 0; j < n; j++) if (j !== to) D[to * m + j] += BIG;              // nothing leaves the last one
  }
  const cyc = m <= 13 ? exact(D, m) : search(D, m, budgetMs, seed);
  // the order read off the cycle: from the dummy node on (open), else from the first node asked (closed)
  let start = loop ? (from >= 0 ? from : cyc[0]) : n;
  const at = cyc.indexOf(start), order = [];
  for (let s = 0; s < m; s++) order.push(cyc[(at + s) % m]);
  if (!loop) order.shift();
  let cost = 0;
  for (let s = 1; s < order.length; s++) cost += C[order[s - 1] * n + order[s]];
  if (loop) cost += C[order[order.length - 1] * n + order[0]];
  return { order, cost };
}

const cycleCost = (D, m, t) => { let s = 0; for (let i = 0; i < m; i++) s += D[t[i] * m + t[(i + 1) % m]]; return s; };

/** The best cycle exactly (Held-Karp from node 0). */
function exact(D, m) {
  const F = 1 << (m - 1), dp = new Float64Array(F * m).fill(Infinity), par = new Int8Array(F * m).fill(-1);
  for (let j = 1; j < m; j++) dp[(1 << (j - 1)) * m + j] = D[j];
  for (let mask = 1; mask < F; mask++) for (let j = 1; j < m; j++) {
    const bit = 1 << (j - 1);
    if (!(mask & bit)) continue;
    const v = dp[mask * m + j];
    if (!(v < Infinity)) continue;
    for (let k = 1; k < m; k++) {
      const b2 = 1 << (k - 1);
      if (mask & b2) continue;
      const w = v + D[j * m + k], idx = (mask | b2) * m + k;
      if (w < dp[idx]) { dp[idx] = w; par[idx] = j; }
    }
  }
  let best = Infinity, last = 1;
  for (let j = 1; j < m; j++) { const w = dp[(F - 1) * m + j] + D[j * m]; if (w < best) { best = w; last = j; } }
  const out = [];
  let mask = F - 1, j = last;
  while (j > 0) { out.push(j); const p = par[mask * m + j]; mask &= ~(1 << (j - 1)); j = p; }
  out.push(0);
  return out.reverse();
}

/** A small seeded generator (the same tour for the same costs). */
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Nearest neighbour from a node. */
function nearest(D, m, s) {
  const t = [s], used = new Uint8Array(m);
  used[s] = 1;
  for (let q = 1; q < m; q++) {
    const a = t[t.length - 1];
    let b = -1;
    for (let j = 0; j < m; j++) if (!used[j] && (b < 0 || D[a * m + j] < D[a * m + b])) b = j;
    t.push(b); used[b] = 1;
  }
  return t;
}

/** Local search to a local optimum: Or-opt (runs of 1-3, either way round), then 2-opt with the reversed stretch costed. */
function improve(D, m, t) {
  const c = (a, b) => D[a * m + b];
  for (let guard = 0; guard < 200; guard++) {
    let moved = false;
    // Or-opt
    for (let L = 1; L <= 3 && !moved; L++) {
      for (let i = 0; i < m && !moved; i++) {
        const p = t[(i - 1 + m) % m], s0 = t[i], s1 = t[(i + L - 1) % m], q = t[(i + L) % m];
        if (L >= m - 1) break;
        let inF = 0, inR = 0;
        for (let u = 0; u < L - 1; u++) { const x = t[(i + u) % m], y = t[(i + u + 1) % m]; inF += c(x, y); inR += c(y, x); }
        const gain = c(p, s0) + c(s1, q) - c(p, q);
        for (let off = L; off < m - 1; off++) {
          const jx = (i + off) % m, x = t[jx], y = t[(jx + 1) % m];
          const add = c(x, s0) + c(s1, y) - c(x, y), addR = c(x, s1) + c(s0, y) - c(x, y) + inR - inF;
          if (add < gain - 1e-9 || addR < gain - 1e-9) {
            const rev = addR < add;
            const seg = []; for (let u = 0; u < L; u++) seg.push(t[(i + u) % m]);
            if (rev) seg.reverse();
            const rest = []; for (let u = 0; u < m - L; u++) rest.push(t[(i + L + u) % m]);
            const pos = rest.indexOf(x);
            t.splice(0, m, ...rest.slice(0, pos + 1), ...seg, ...rest.slice(pos + 1));
            moved = true; break;
          }
        }
      }
    }
    if (moved) continue;
    // 2-opt: reverse t[i+1..j]
    const Fp = new Float64Array(m), Rp = new Float64Array(m);
    for (let k = 1; k < m; k++) { Fp[k] = Fp[k - 1] + c(t[k - 1], t[k]); Rp[k] = Rp[k - 1] + c(t[k], t[k - 1]); }
    for (let i = 0; i < m - 2 && !moved; i++) {
      for (let j = i + 2; j < m; j++) {
        const a = t[i], b = t[i + 1], cc = t[j], d = t[(j + 1) % m];
        if (d === a && j === m - 1 && i === 0) continue;
        const delta = c(a, cc) + c(b, d) - c(a, b) - c(cc, d) + (Rp[j] - Rp[i + 1]) - (Fp[j] - Fp[i + 1]);
        if (delta < -1e-9) {
          for (let u = i + 1, v = j; u < v; u++, v--) { const x = t[u]; t[u] = t[v]; t[v] = x; }
          moved = true; break;
        }
      }
    }
    if (!moved) break;
  }
  return t;
}

/** The iterated local search: the best of a few starts, then double-bridge kicks while the budget lasts. */
function search(D, m, budgetMs, seed) {
  const rand = rng(seed), t0 = Date.now();
  let best = null, bestC = Infinity;
  const starts = Math.min(m, 8);
  for (let s = 0; s < starts; s++) {
    const t = improve(D, m, nearest(D, m, Math.floor((s * m) / starts)));
    const cst = cycleCost(D, m, t);
    if (cst < bestC - 1e-9) { best = t; bestC = cst; }
  }
  let cur = best.slice(), curC = bestC;
  for (let it = 0; it < 20000 && Date.now() - t0 < budgetMs; it++) {
    const cuts = [1 + Math.floor(rand() * (m - 3)), 0, 0];
    cuts[1] = cuts[0] + 1 + Math.floor(rand() * (m - cuts[0] - 2));
    cuts[2] = cuts[1] + 1 + Math.floor(rand() * (m - cuts[1] - 1));
    const [p1, p2, p3] = cuts;
    const kicked = [...cur.slice(0, p1), ...cur.slice(p2, p3), ...cur.slice(p1, p2), ...cur.slice(p3)];
    const t = improve(D, m, kicked), cst = cycleCost(D, m, t);
    if (cst <= curC + 1e-9) { cur = t; curC = cst; }
    if (cst < bestC - 1e-9) { best = t.slice(); bestC = cst; }
  }
  return best;
}
