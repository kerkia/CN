// A trace coloured by pace, and the other ramps drawn the same way (« Analyse solo », « Analyse multi »): eight colours
// from the fastest (blue) through green to the slowest (red), on a range of speeds — the 10th to the 90th percentile of
// one trace's (Solo) or of every runner's shown (multi: one scale, so that colours compare) — and their legend in the
// map's bottom right corner (owner, 2026-10-15: the colours said nothing without it).

import { html } from "../util.js";
import { t } from "../i18n.js";
import { pace } from "./curves.js";

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
