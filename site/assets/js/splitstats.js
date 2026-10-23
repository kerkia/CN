// Two analyses of « Temps intermédiaires » (ideas seen in MeOSDjango, written here afresh). Pure: runners in
// [{ r, cum }] — r a runner of prov/model.py's shape (start_s: the start, seconds after midnight), cum the cumulative
// times at each control then the finish (null when unknown) — the results out.

/** « Autonomie » (« Lièvre / suiveur » until 2026-10-23): who ran behind whom. On each leg, two runners who left its first control within `t2` seconds of
 * each other are compared all along it, each one's progress taken as steady between the two controls: where the time
 * between them is under `t1` they ran together (weight 1), from `t1` to `t2` less and less (weight down to 0); the one
 * passing later is behind — following. A runner's leg is followed (or led) for the share of it run so behind (or in
 * front of) somebody. Per runner: { follow, lead } shares per leg, followT / leadT in seconds of their own legs,
 * index = 100 × (followT − leadT) / their time on the legs counted (> 0: a follower, < 0: a hare), and partners. */
export function followers(R, { t1 = 7, t2 = 20, samples = 24 } = {}) {
  const L = Math.max(0, ...R.map((x) => x.cum.length));
  const out = new Map(R.map((x) => [x, { follow: Array(L).fill(null), lead: Array(L).fill(null), behind: Array(L).fill(null),
    ahead: Array(L).fill(null), followT: 0, leadT: 0, total: 0, partners: new Map() }]));
  const weight = (g) => (g <= t1 ? 1 : g >= t2 ? 0 : (t2 - g) / (t2 - t1));
  for (let j = 0; j < L; j++) {
    const on = R.filter((x) => x.r.start_s != null && x.cum[j] != null && (j === 0 || x.cum[j - 1] != null))
      .map((x) => ({ x, dep: x.r.start_s + (j ? x.cum[j - 1] : 0), arr: x.r.start_s + x.cum[j] }))
      .filter((e) => e.arr > e.dep)
      .sort((a, b) => a.dep - b.dep);
    const fol = new Map(on.map((e) => [e, new Float64Array(samples)]));
    const led = new Map(on.map((e) => [e, new Float64Array(samples)]));
    const with_ = new Map(on.map((e) => [e, new Map()]));     // partner → [weight behind, weight ahead] summed
    for (let a = 0; a < on.length; a++) {
      for (let b = a + 1; b < on.length && on[b].dep - on[a].dep <= t2; b++) {
        const A = on[a], B = on[b];
        const g0 = A.dep - B.dep, g1 = A.arr - B.arr;          // > 0: A passes later, A behind
        for (let s = 0; s < samples; s++) {
          const g = g0 + ((s + 0.5) / samples) * (g1 - g0);
          const w = weight(Math.abs(g));
          if (!w || g === 0) continue;
          const [back, front] = g > 0 ? [A, B] : [B, A];
          fol.get(back)[s] = Math.max(fol.get(back)[s], w);
          led.get(front)[s] = Math.max(led.get(front)[s], w);
          const pb = with_.get(back), pf = with_.get(front);
          if (!pb.has(front)) pb.set(front, [0, 0]);
          if (!pf.has(back)) pf.set(back, [0, 0]);
          pb.get(front)[0] += w / samples;
          pf.get(back)[1] += w / samples;
        }
      }
    }
    for (const e of on) {
      const o = out.get(e.x), leg = e.arr - e.dep;
      const mean = (v) => v.reduce((s, y) => s + y, 0) / samples;
      o.follow[j] = mean(fol.get(e));
      o.lead[j] = mean(led.get(e));
      o.followT += leg * o.follow[j];
      o.leadT += leg * o.lead[j];
      o.total += leg;
      let bestB = null, bestA = null;
      for (const [p, [wb, wa]] of with_.get(e)) {
        if (!o.partners.has(p.x)) o.partners.set(p.x, { follow: 0, lead: 0, legs: [] });
        const q = o.partners.get(p.x);
        q.follow += wb * leg;
        q.lead += wa * leg;
        q.legs.push(j);
        if (wb && (!bestB || wb > bestB[1])) bestB = [p.x, wb];
        if (wa && (!bestA || wa > bestA[1])) bestA = [p.x, wa];
      }
      o.behind[j] = bestB?.[0] || null;
      o.ahead[j] = bestA?.[0] || null;
    }
  }
  for (const o of out.values()) {
    o.index = o.total ? (100 * (o.followT - o.leadT)) / o.total : null;
    o.legsFollowed = o.follow.map((v, j) => (v != null && v >= 0.5 ? j : -1)).filter((j) => j >= 0);
    o.legsLed = o.lead.map((v, j) => (v != null && v >= 0.5 ? j : -1)).filter((j) => j >= 0);
    o.main = [...o.partners].sort((a, b) => b[1].follow + b[1].lead - (a[1].follow + a[1].lead))[0] || null;
  }
  return out;
}

/** Regularity: on each leg a performance index, the leg's reference time (the mean of its best quarter of times) ÷ the
 * runner's time (1: as fast as the best, 0.5: twice as slow); per runner the weighted mean of their indices and their
 * weighted standard deviation over that mean, each leg weighing its reference time (a long leg says more than a short one); per leg the mean and the spread
 * across runners of their index against their own mean (each one's level taken out: where everyone ran unlike themself,
 * the leg was tricky). Only finishers with every split count: { ref, runners: [{ x, idx, mean, sd }], legs: [{ ref,
 * mean, sd, n }] }. */
export function regularity(R, { share = 0.25 } = {}) {
  const L = Math.max(0, ...R.map((x) => x.cum.length));
  const full = R.filter((x) => x.r.status === "ok" && x.cum.length === L && x.cum.every((v) => v != null)
    && x.cum.every((v, i) => v - (i ? x.cum[i - 1] : 0) > 0));
  const legsOf = (x) => x.cum.map((v, i) => v - (i ? x.cum[i - 1] : 0));
  const legs = new Map(full.map((x) => [x, legsOf(x)]));
  const ref = Array.from({ length: L }, (_, i) => {
    const v = full.map((x) => legs.get(x)[i]).sort((a, b) => a - b);
    const top = v.slice(0, Math.max(1, Math.ceil(share * v.length)));
    return top.length ? top.reduce((s, y) => s + y, 0) / top.length : null;
  });
  const wsum = ref.reduce((s, v) => s + (v || 0), 0);
  const runners = full.map((x) => {
    const idx = legs.get(x).map((v, i) => ref[i] / v);
    const mean = idx.reduce((s, v, i) => s + ref[i] * v, 0) / wsum;
    // relative to the runner's own mean: 10 points mean more at 40 % than at 90 %
    const sd = Math.sqrt(idx.reduce((s, v, i) => s + ref[i] * (v - mean) ** 2, 0) / wsum) / mean;
    return { x, idx, mean, sd };
  });
  const legStats = ref.map((r, i) => {
    const v = runners.map((y) => y.idx[i] / y.mean);
    const mean = v.length ? v.reduce((s, y) => s + y, 0) / v.length : null;
    const sd = v.length > 1 ? Math.sqrt(v.reduce((s, y) => s + (y - mean) ** 2, 0) / (v.length - 1)) : null;
    return { ref: r, mean, sd, n: v.length };
  });
  return { ref, runners, legs: legStats };
}
