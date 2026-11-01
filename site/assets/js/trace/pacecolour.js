// A trace coloured by pace, and the other ramps drawn the same way (« Analyse solo », « Analyse multi »): eight colours
// from the fastest (blue) through green to the slowest (red), on a range of speeds — the 10th to the 90th percentile of
// one trace's (Solo) or of every runner's shown (multi: one scale, so that colours compare) — and their legend in the
// map's bottom right corner (owner, 2026-10-15: the colours said nothing without it).
// « Analyse solo » also colours the trace by the file's other channels — heart rate, altitude, the slope read from it,
// cadence, power, temperature (owner, 2026-11-01, after QuickRoute) —, low in blue, high in red, on the race's own 5-95 %.

import { html, fmt } from "../util.js";
import { t } from "../i18n.js";
import { pace, CHANNEL_LABEL, CHANNEL_UNIT } from "./curves.js";
import { indexAt } from "./track.js";

export const PACE_COLOURS = ["#1c5fd6", "#19a0c9", "#1aa34a", "#8bc34a", "#f2c200", "#f28a00", "#e23a1f", "#8e0f1f"];
const N = PACE_COLOURS.length;

/** The speeds' range [lo, hi] (m/s): the 10th and 90th percentiles of those above 0.3 m/s, over one or more arrays. */
export function paceRange(...arrays) {
  const vs = [];
  for (const a of arrays) for (const v of a) if (v > 0.3) vs.push(v);
  vs.sort((a, b) => a - b);
  return [vs[Math.floor(vs.length * 0.1)] || 0, vs[Math.floor(vs.length * 0.9)] || 1];
}
/** The ramp's colour at f (0 the fastest / best, 1 the slowest / worst). */
export const rampColour = (f) => PACE_COLOURS[Math.max(0, Math.min(N - 1, Math.floor(f * N)))];
/** The colour of a speed v on the range [lo, hi]. */
export const paceColour = (v, lo, hi) => rampColour((hi - v) / (hi - lo || 1));

/** A ramp's legend: its title, the colours, three ticks (start, middle, end) and its two ends' words. */
export function rampLegend(title, ticks, ends = [t("an.legend.fast"), t("an.legend.slow")]) {
  return html`<div class="an-legend-title">${title}</div>
    <div class="an-legend-bar">${PACE_COLOURS.map((c) => html`<span style="background:${c}"></span>`)}</div>
    <div class="an-legend-ticks">${ticks.map((x) => html`<span>${x}</span>`)}</div>
    <div class="an-legend-ends muted"><span>${ends[0]}</span><span>${ends[1]}</span></div>`;
}
/** The legend of the pace colours on [lo, hi]: the paces where the first, the middle and past the last colour start. */
export function paceLegend(lo, hi) {
  const at = (k) => hi - (k / N) * (hi - lo);          // the speed where colour k starts
  return rampLegend(t("an.legend.pace"), [pace(at(0)), pace(at(N / 2)), pace(at(N))]);
}

// ---- any measure of a trace ------------------------------------------------------------------------------------------
/** What a trace can be coloured by, in the menu's order: the pace always, the slope with an altitude, the file's channels. */
export function colourModes(tr) {
  if (!tr) return ["speed"];
  return ["speed", ...(tr.ch.hr ? ["hr"] : []), ...(tr.ch.ele ? ["ele", "slope"] : []), ...["cad", "pw", "temp"].filter((c) => tr.ch[c])];
}
const slopes = new WeakMap();
/** The slope (%) at each point: the altitude's change over the distance run in ± 10 s (none below 8 m: a stop). */
function slopeOf(tr) {
  let s = slopes.get(tr);
  if (s) return s;
  s = new Float32Array(tr.n);
  const ele = tr.ch.ele;
  for (let i = 0; i < tr.n; i++) {
    const a = indexAt(tr, tr.t[i] - 10), b = indexAt(tr, tr.t[i] + 10), d = tr.cum[b] - tr.cum[a];
    s[i] = d >= 8 ? (100 * (ele[b] - ele[a])) / d : NaN;
  }
  slopes.set(tr, s);
  return s;
}
/** The values a trace is coloured by, point by point (m/s for the pace), or null when the file has no such channel. */
export function seriesOf(tr, by) {
  if (by === "speed") return tr.v;
  if (by === "slope") return tr.ch.ele ? slopeOf(tr) : null;
  return tr.ch[by] || null;
}
/** The colours' range [lo, hi] over the points i0..i1: the pace's 10-90 % (paceRange), the others' 5-95 % — the
 *  cadence and the power when moving only (a stop's 0 would stretch the scale), the slope even about 0. */
export function rangeOf(tr, by, i0 = 0, i1 = tr.n - 1) {
  const s = seriesOf(tr, by);
  if (!s) return [0, 1];
  if (by === "speed") return paceRange(s.subarray(i0, i1 + 1));
  const vs = [];
  for (let i = i0; i <= i1; i++) { const v = s[i]; if (Number.isFinite(v) && (!(by === "cad" || by === "pw") || (v > 0 && tr.v[i] > 0.5))) vs.push(v); }
  if (!vs.length) return [0, 1];
  vs.sort((a, b) => a - b);
  let lo = vs[Math.floor(vs.length * 0.05)], hi = vs[Math.floor(vs.length * 0.95)];
  if (by === "slope") { const m = Math.max(Math.abs(lo), Math.abs(hi), 2); lo = -m; hi = m; }
  return hi > lo ? [lo, hi] : [lo - 1, hi + 1];
}
/** The colour of a value on [lo, hi]: the pace from fast (blue) to slow (red), the others from low (blue) to high (red). */
export const colourOf = (by, v, lo, hi) => (by === "speed" ? paceColour(v, lo, hi) : Number.isFinite(v) ? rampColour((v - lo) / (hi - lo || 1)) : "#9a9a9a");
/** The words of a ramp's legend: { title, ticks, ends } — `units` gives a converted unit (the cadence's steps or turns). */
export function legendOf(by, lo, hi, units = {}) {
  if (by === "speed") { const at = (k) => hi - (k / N) * (hi - lo); return { title: t("an.legend.pace"), ticks: [pace(at(0)), pace(at(N / 2)), pace(at(N))], ends: [t("an.legend.fast"), t("an.legend.slow")] }; }
  const unit = by === "slope" ? "%" : units[by] ?? CHANNEL_UNIT[by] ?? "";
  const digits = hi - lo < 10 ? 1 : 0, f = (v) => `${v > 0 && by === "slope" ? "+" : v < 0 ? "−" : ""}${fmt(Math.abs(v), digits)}`;
  return { title: `${t(by === "slope" ? "an.ch.slope" : CHANNEL_LABEL[by])}${unit ? ` (${unit})` : ""}`, ticks: [f(lo), f((lo + hi) / 2), f(hi)],
    ends: by === "slope" ? [t("an.legend.down"), t("an.legend.up")] : [t("an.legend.low"), t("an.legend.high")] };
}
/** A ramp's legend as HTML (the map's corner). */
export function legendHtml(by, lo, hi, units) { const l = legendOf(by, lo, hi, units); return rampLegend(l.title, l.ticks, l.ends); }
