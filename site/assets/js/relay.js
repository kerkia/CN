// Relay simulator: the formats (FFCO's 2026 rules, « Règlement des compétitions », Annexes: CFC article 9, CNE article
// 11, relais de catégorie article 8) and the solver behind the « Relais » page.
//
// The model (the owner's): on leg l, a runner of CN c runs  k · ref(l) / c  minutes, ref(l) being the leg's reference
// time (« temps de référence »); k is set so that the best team of all — over every club, each picking its best team —
// totals the sum of the reference times (FFCO's own aim: « temps total de l'équipe vainqueure »; for the CNE, the mean
// of the 5 best teams). A team: one runner per slot (the composition criteria — « 1 jeune Homme (H14 à H18) »…, each
// runner counting for one criterion only) and per leg (some legs are for a sex or an age group), each runner once.
// The best team is exact: every way of matching the criteria to the legs (identical ones counted once), then the best
// runners for that matching by the Hungarian algorithm.
//
// Age and sex come from the runner's category (H21, D16…), a category number standing for the age group: a veteran who
// races in H21 counts as a 21. The labels are the site's language (classes M21 / W16 in English, util.fmtCat).

import { t } from "./i18n.js";
import { fmtCat } from "./util.js";

/** A category's sex and age number: "H35" -> ["H", 35]; "D21E" -> ["D", 21]. */
export function catParts(cat) {
  const m = /^([HD])(\d+)/.exec(cat || "");
  return m ? [m[1], Number(m[2])] : [null, null];
}
/** Does a runner (sex, age number) fit a constraint {sex, min, max}? */
export const fits = (sex, age, c) => age != null && (!c.sex || c.sex === sex) && (c.min == null || age >= c.min) && (c.max == null || age <= c.max);

const S = (label, sex, min, max) => ({ label, sex, min, max });
const legs = (refs, extra = {}) => refs.map((ref, i) => ({ ref, ...(extra[i + 1] || {}) }));
const even = new Date().getFullYear() % 2 === 0;
// CFC: in an even year, N1's leg 1 is run by a woman (D16+) and leg 8 by a man (H16+), N2 the other way round; swapped in
// odd years. Legs 3 and 6 (orange, 20') are for the young (D/H14 to 18).
// (a tag ties criteria to legs: the two young criteria run legs 3 and 6, the others the rest)
const W16 = { sex: "D", min: 16 }, M16 = { sex: "H", min: 16 }, YOUNG = { min: 14, max: 18, tag: "j" };
const cfc12 = (refs, first) => legs(refs, { 1: first === "D" ? W16 : M16, 3: YOUNG, 6: YOUNG, 8: first === "D" ? M16 : W16 });
const C = (sex, n) => fmtCat(`${sex}${n}`);                         // « H16 » / « M16 »
const BOTH = t("rl.s.both");                                             // « D/H » / « W/M »
const WOMAN16 = t("rl.s.woman16", { c: C("D", 16) }), MAN16 = t("rl.s.man16", { c: C("H", 16) });
const YOUNG14 = t("rl.s.young", { x: BOTH, lo: 14, hi: 18 }), ANY16 = t("rl.s.any", { x: BOTH, n: 16 });
const CFC12_SLOTS = [{ ...S(t("rl.s.youngMan", { lo: C("H", 14), hi: C("H", 18) }), "H", 14, 18), tag: "j" },
  { ...S(t("rl.s.youngWoman", { lo: C("D", 14), hi: C("D", 18) }), "D", 14, 18), tag: "j" }, S(t("rl.s.plus", { c: C("H", 35) }), "H", 35),
  S(t("rl.s.plus", { c: C("D", 35) }), "D", 35), S(WOMAN16, "D", 16), S(WOMAN16, "D", 16), S(MAN16, "H", 16), S(MAN16, "H", 16)];
/** A relais de catégorie: its class, those who may run it (from `min`, up to `max`), n legs over `total` minutes. */
const cat = (c, sex, min, max, n, total) => ({
  label: c === C(sex, min) ? c : max ? t("rl.p.catRange", { c, lo: C(sex, min), hi: C(sex, max) }) : t("rl.p.catPlus", { c, lo: C(sex, min) }),
  group: t("rl.g.cat"), target: "winner",
  slots: Array.from({ length: n }, () => S(max ? t("rl.s.range", { lo: C(sex, min), hi: max }) : t("rl.s.plus", { c: C(sex, min) }), sex, min, max)),
  legs: legs(Array(n).fill(total / n)) });
const catPlus = (sex, n, k, total) => ({ ...cat(C(sex, n), sex, n, null, k, total), label: t("rl.s.plus", { c: C(sex, n) }) });

export const PRESETS = {
  cfc1: { label: t("rl.p.cfc", { n: 1 }), group: t("rl.g.cfc"), target: "winner", slots: CFC12_SLOTS,
    legs: cfc12([50, 30, 20, 50, 30, 20, 30, 50], even ? "D" : "H") },
  cfc2: { label: t("rl.p.cfc", { n: 2 }), group: t("rl.g.cfc"), target: "winner", slots: CFC12_SLOTS,
    legs: cfc12([40, 30, 20, 40, 30, 20, 30, 40], even ? "H" : "D") },
  cfc3: { label: t("rl.p.cfc", { n: 3 }), group: t("rl.g.cfc"), target: "winner",
    slots: [S(YOUNG14, null, 14, 18), S(WOMAN16, "D", 16), S(WOMAN16, "D", 16),
      S(ANY16, null, 16), S(ANY16, null, 16), S(ANY16, null, 16)],
    legs: legs([30, 40, 20, 30, 40, 30]) },
  cfc4: { label: t("rl.p.cfc", { n: 4 }), group: t("rl.g.cfc"), target: "winner",
    slots: [S(YOUNG14, null, 14, 18), S(WOMAN16, "D", 16), S(WOMAN16, "D", 16),
      S(ANY16, null, 16), S(ANY16, null, 16), S(t("rl.s.any", { x: BOTH, n: 14 }), null, 14)],
    legs: legs([30, 40, 20, 20, 40, 30]) },
  cneH: { label: t("rl.p.cneH"), group: t("rl.g.cne"), target: "top5",
    slots: Array.from({ length: 7 }, () => S(ANY16, null, 16)), legs: legs([40, 40, 50, 30, 50, 30, 50]) },
  cneD: { label: t("rl.p.cneD"), group: t("rl.g.cne"), target: "top5",
    slots: Array.from({ length: 5 }, () => S(t("rl.s.plus", { c: C("D", 16) }), "D", 16)), legs: legs([30, 40, 30, 40, 30]) },
  cneJ: { label: t("rl.p.cneJ"), group: t("rl.g.cne"), target: "top5",
    slots: [S(t("rl.s.youngWoman2", { lo: C("D", 14), hi: C("D", 16) }), "D", 14, 16),
      ...Array.from({ length: 3 }, () => S(t("rl.s.young2", { x: BOTH, lo: 14, hi: 16 }), null, 14, 16))],
    legs: legs([30, 30, 30, 30]) },
  cneM: { label: t("rl.p.cneM"), group: t("rl.g.cne"), target: "top5",
    slots: Array.from({ length: 3 }, () => S(t("rl.s.anyRange", { x: BOTH, lo: 10, hi: 12 }), null, 0, 12)), legs: legs([20, 20, 20]) },
  rcH21: cat(C("H", 21), "H", 18, null, 3, 120), rcD21: cat(C("D", 21), "D", 18, null, 3, 120),
  rcH35: catPlus("H", 35, 3, 105), rcD35: catPlus("D", 35, 3, 105),
  rcH45: catPlus("H", 45, 3, 90), rcD45: catPlus("D", 45, 3, 90),
  rcH55: catPlus("H", 55, 2, 60), rcD55: catPlus("D", 55, 2, 60),
  rcH65: catPlus("H", 65, 2, 60), rcD65: catPlus("D", 65, 2, 60),
  rcH75: catPlus("H", 75, 2, 60), rcD75: catPlus("D", 75, 2, 60),
  rcH20: cat(C("H", 20), "H", 16, 20, 3, 105), rcD20: cat(C("D", 20), "D", 16, 20, 2, 70),
  rcH16: cat(C("H", 16), "H", 14, 16, 3, 90), rcD16: cat(C("D", 16), "D", 14, 16, 2, 60),
  rcH12: { ...cat(C("H", 12), "H", 0, 12, 2, 40), label: C("H", 12) }, rcD12: { ...cat(C("D", 12), "D", 0, 12, 2, 40), label: C("D", 12) },
  // the sprint relay: 2 women and 2 men of any category, woman - man - man - woman; sprint CNs
  spr: { label: t("rl.p.spr"), group: t("rl.g.spr"), target: "winner", terrain: "Spr",
    slots: [S(t("rl.s.woman"), "D"), S(t("rl.s.man"), "H"), S(t("rl.s.man"), "H"), S(t("rl.s.woman"), "D")],
    legs: legs([15, 15, 15, 15], { 1: { sex: "D" }, 2: { sex: "H" }, 3: { sex: "H" }, 4: { sex: "D" } }) },
};
/** A format's discipline: its own (the sprint relay), else forest — CFC, CNE and relais de catégorie are forest races. */
export const terrainOf = (f) => f?.terrain || "For";
/** The next national relay of the agenda — CNE, CFC, the championnats de France de relais (de catégorie, sprint) — as
 *  the preset to propose, with the event; null when none is planned. Ligue and regional relays are not national. */
export function nextNationalRelay(events, today = new Date().toISOString().slice(0, 10)) {
  const strip = (s) => (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const coming = (events || []).filter((e) => e.kind === "c" && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of coming) {
    const s = strip(`${e.name} ${e.manif || ""}`);
    if (e.epr !== "Relais" && !/relais/.test(s)) continue;
    let key = null;
    if (/criterium national des equipes|\bcne\b/.test(s)) key = "cneH";
    else if (/championnat de france des clubs|\bcfc\b/.test(s)) key = "cfc1";
    else if (/championnat de france|\bcf\b/.test(s)) key = /sprint/.test(s) ? "spr" : "rcH21";
    if (key) return { key, id: e.id, name: e.name, date: e.date, place: e.place || "" };
  }
  return null;
}
export const TARGETS = { winner: t("rl.target.winner"), top5: t("rl.target.top5") };

// ---- the assignment problem -----------------------------------------------------------------------------------------
/** Hungarian algorithm (minimum cost), n rows <= m columns: the column of each row. cost[i][j] = Infinity forbids. */
export function hungarian(cost) {
  const n = cost.length, m = cost[0]?.length || 0;
  if (!n || m < n) return null;
  const BIG = 1e12;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const c = cost[i0 - 1][j - 1];
        const cur = (c === Infinity ? BIG : c) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const col = new Array(n);
  for (let j = 1; j <= m; j++) if (p[j]) col[p[j] - 1] = j - 1;
  return col.some((j, i) => cost[i][j] === Infinity) ? null : col;
}

const key = (c) => `${c.sex || "*"}|${c.min ?? ""}|${c.max ?? ""}|${c.tag || ""}`;
const sameTag = (s, l) => (s.tag || "") === (l.tag || "");
const both = (a, b) => ({ sex: a.sex || b.sex, min: Math.max(a.min ?? -1, b.min ?? -1), max: Math.min(a.max ?? 999, b.max ?? 999) });
const possible = (c) => (c.min ?? -1) <= (c.max ?? 999);

/** Every distinct way of giving the slots to the legs: lists of [slot index, leg index] (identical slots, and identical
 *  legs, are not permuted among themselves). */
function matchings(slots, lgs) {
  const out = [];
  const sk = slots.map(key), lk = lgs.map((l) => `${key(l)}|${l.ref}`);
  const used = new Array(slots.length).fill(false);
  const pairs = [];
  (function rec(li) {
    if (li === lgs.length) { out.push([...pairs]); return; }
    const tried = new Set();
    // the same kind of leg as the previous one: take slots in increasing order, so that two identical legs never swap
    const floor = li > 0 && lk[li] === lk[li - 1] ? pairs[li - 1][0] : -1;
    for (let si = 0; si < slots.length; si++) {
      if (used[si] || tried.has(sk[si]) || si <= floor && lk[li] === lk[li - 1]) continue;
      if (!possible(both(slots[si], lgs[li]))) continue;
      if (slots[si].sex && lgs[li].sex && slots[si].sex !== lgs[li].sex || !sameTag(slots[si], lgs[li])) continue;
      tried.add(sk[si]);
      used[si] = true; pairs.push([si, li]);
      rec(li + 1);
      used[si] = false; pairs.pop();
    }
  })(0);
  return out;
}

/** The best team from runners [{lic, sex, age, cn}] for a format: {legs: [{runner, slot}], cost} or null. The cost is
 *  sum(ref / cn): times are k times it. */
export function bestTeam(runners, fmt) {
  const { slots, legs: lgs } = fmt;
  if (slots.length !== lgs.length) return null;
  // only the strongest few of each kind can be in the best team
  const kinds = new Map();
  for (const s of slots) for (const l of lgs) { const c = both(s, l); if (possible(c) && sameTag(s, l)) kinds.set(key(c), c); }
  const pool = new Set();
  for (const c of kinds.values()) runners.filter((r) => fits(r.sex, r.age, c)).sort((a, b) => b.cn - a.cn).slice(0, lgs.length).forEach((r) => pool.add(r));
  const cand = [...pool];
  if (cand.length < lgs.length) return null;
  let best = null;
  for (const pairs of matchings(slots, lgs)) {
    const cost = pairs.map(([si, li]) => {
      const c = both(slots[si], lgs[li]);
      return cand.map((r) => (fits(r.sex, r.age, c) ? lgs[li].ref / r.cn : Infinity));
    });
    const col = hungarian(cost);
    if (!col) continue;
    const total = col.reduce((s, j, i) => s + cost[i][j], 0);
    if (!best || total < best.cost) {
      const team = new Array(lgs.length);
      pairs.forEach(([si, li], i) => { team[li] = { runner: cand[col[i]], slot: si }; });
      best = { legs: team, cost: total };
    }
  }
  return best;
}

/** A club's teams, best first, each from the runners the previous ones left (up to `max`). */
export function clubTeams(runners, fmt, max = 3) {
  const out = [];
  let left = runners;
  while (out.length < max) {
    const t = bestTeam(left, fmt);
    if (!t) break;
    out.push(t);
    const used = new Set(t.legs.map((x) => x.runner.lic));
    left = left.filter((r) => !used.has(r.lic));
  }
  return out;
}

/** Can these runners (one per leg, in order) make a valid team? The slot of each, or null. */
export function checkTeam(chosen, fmt) {
  const { slots, legs: lgs } = fmt;
  if (chosen.some((r) => !r) || new Set(chosen.map((r) => r.lic)).size !== chosen.length) return null;
  // rows: legs (runner fixed), columns: slots; allowed when the runner fits both
  const cost = chosen.map((r, li) => slots.map((s) => (fits(r.sex, r.age, s) && fits(r.sex, r.age, lgs[li]) && sameTag(s, lgs[li]) ? 0 : Infinity)));
  return hungarian(cost);
}
