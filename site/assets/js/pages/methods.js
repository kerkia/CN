// The documentation, in four tabs (owner, 2026-10-14): « CN officiel » and « CN Top », each the method's rules and
// formulas, facts only; « L'étude », the white paper — objectives, method of evaluation, the point of departure, the
// choices, the score and its mean, the circuit's value, the recalage, the results, the alternatives discarded, the
// conclusion — with the figures that support each decision (site/assets/study.json, the study of 13 October 2026, and
// the live evaluation, site/data/evaluation.json) and the PDF; « Les calculs du site », the other calculations. The
// study and the site's calculations have chapters as a second row of tabs (?voir=). Only the methods this account sees
// are named; the Fit is never named (owner, 2026-10-14: the circuits are measured from the scores the runners present earned
// in their previous races, their « niveau habituel », not from another ranking).

import { html, raw, $, $$, fmt, fmtSigned, mean } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { timeChart, scatterChart, methodColor, terrainColor, METHOD_SLOT, css } from "../charts.js";
import { TERRAINS, available } from "../store.js";
import { chartCard, bindChartCard, legend, methodKey, methodLabel, methodShort, seg, cnLabel } from "../ui.js";
import { replaceQuery } from "../app.js";

const TABS = [["officiel", "CN officiel"], ["top", "CN Top"], ["etude", "L'étude"], ["calculs", "Les calculs du site"]];
const STUDY_CHAPTERS = [["objectifs", "Objectifs"], ["depart", "Le point de départ"], ["mesure", "La mesure"], ["choix", "Les choix de base"],
  ["score", "Le score et la moyenne"], ["circuit", "La valeur du circuit"], ["recalage", "Le recalage"], ["resultats", "Les résultats"],
  ["ecartes", "Les alternatives écartées"], ["conclusion", "Conclusion"]];
const SITE_CHAPTERS = [["clubs", "Clubs"], ["coureurs", "Coureurs"], ["reseau", "Réseau"], ["resultats", "Résultats et temps intermédiaires"],
  ["relais", "Relais"], ["limites", "Limites"]];
const PDF = "assets/ocn-methode-top.pdf";
const cvar = (m) => `--c:var(--s${METHOD_SLOT[m]})`;
const MINUS = "−";

// Race-score exponent k, measured once on database copies (7 October 2026) with the strength CN (Fit), on
// the same pairs: ln(score) = C − k·ln(time). Reference period July 2025 - October 2026; ski over 2010-2025
// (2 to 4 races a season). Then 2018-2024 for forest and sprint, as a check.
const K_TESTS = {
  ks: [0.75, 1, 1.5, 2, 2.5, 3],
  rows: [
    ["For", "juil. 2025 – oct. 2026", 746087, 80.51, [82.10, 82.28, 82.50, 82.61, 82.61, 82.53]],
    ["Spr", "juil. 2025 – oct. 2026", 116243, 80.37, [83.90, 83.94, 83.97, 84.03, 84.09, 84.08]],
    ["VTT", "juil. 2025 – oct. 2026", 16924, 76.13, [null, 81.95, 82.14, 82.16, 82.14, null]],
    ["Ski", "2010 – 2025", 6944, 84.69, [null, 82.26, 83.24, 83.68, 83.87, null]],
  ],
  past: [
    ["For", "2018 – 2024", 3365113, 80.18, [81.38, 81.66, 81.98, 82.13, 82.20, 82.20]],
    ["Spr", "2018 – 2024", 320848, 82.37, [84.92, 84.86, 84.74, 84.58, 84.39, 84.09]],
  ],
};
// Where to apply k = 2: the circuit value's mean (cv) and the CN's (cn), each power from 1 to 3, alone and
// together; the Top on the same pairs, July 2025 - October 2026, measured 7 October 2026. Rows: cv, cn, forest all
// races, forest national races, sprint all, sprint national, forest p90/p10 spread of the Top CNs at that date.
const K_GRID = [
  ["cn", [[1, 1, 82.06, 82.80, 83.94, 82.18, 2.65], [1, 1.5, 82.10, 82.80, 83.97, 82.16, 2.61], [1, 2, 82.12, 82.80, 84.01, 82.11, 2.57],
    [1, 2.5, 82.15, 82.79, 84.04, 82.10, 2.55], [1, 3, 82.17, 82.80, 84.09, 82.07, 2.52]]],
  ["cv", [[1.5, 1, 82.11, 82.77, 83.94, 82.13, 2.56], [2, 1, 82.17, 82.76, 83.92, 82.09, 2.50], [2.5, 1, 82.17, 82.74, 83.92, 82.01, 2.43],
    [3, 1, 82.14, 82.66, 83.91, 81.86, 2.38]]],
  ["both", [[1.5, 1.5, 82.15, 82.78, 83.97, 82.13, 2.53], [2, 2, 82.21, 82.77, 84.04, 82.09, 2.42], [2.5, 2.5, 82.16, 82.67, 84.07, 81.91, 2.33],
    [3, 3, 82.07, 82.55, 84.09, 81.84, 2.27]]],
];
// The worked example: one runner's ten scores in the window, best first; kind: cdf | national | other.
const EXAMPLE = [[7200, "cdf"], [6900, "other"], [6800, "national"], [6500, "other"], [6400, "other"],
  [6100, "other"], [5900, "other"], [5600, "other"], [5200, "other"], [4800, "other"]];
// The recalage corrections tried (study of 13 October 2026), in the order of study.json's rows.
const RECAL_LABELS = ["Jusqu'au 13 octobre : la moyenne des 13 mois qui se terminent 2 mois plus tôt", "Une droite tracée sur ces 13 mois, lue le jour du facteur",
  "La même droite, lue 6 mois plus loin", "La moyenne des 13 mois, prolongée de 7 mois au rythme de la montée des 3 dernières années",
  "La moyenne des 13 mois, prolongée de 7 mois au rythme de la montée des 10 dernières années (retenue le 13 octobre)"];

function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const roundHalfUp = (x) => Math.sign(x) * Math.round(Math.abs(x));
/** A signed figure, the minus sign typographic; `pt`: a share shown in points. */
const sg = (v, dec, pt = false) => {
  const x = v * (pt ? 100 : 1), r = Number(x.toFixed(dec));
  return (r > 0 ? "+" : r < 0 ? MINUS : "±") + fmt(Math.abs(r), dec);
};
/** A difference with its interval, as the study's pages show it (the study's differences: points of duels called right). */
const ci = (a, dec = 2, pt = false) => (a ? `${sg(a[0], dec, pt)} [${sg(a[1], dec, pt)} ; ${sg(a[2], dec, pt)}]` : "—");
/** The opposite difference (b − a from a − b), its interval turned round. */
const neg = (a) => (a ? [-a[0], -a[2], -a[1]] : null);
/** Gridlines: a round step giving at most eight lines, and the decimals it needs. */
const tickStep = (span) => [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((x) => span / x <= 8) || 10;
const tickDec = (x) => (x >= 1 ? 0 : x >= 0.1 && Number.isInteger(Math.round(x * 1000) / 100) ? 1 : 2);
const est = (a) => a && (a[1] > 0 || a[2] < 0);
const star = (a) => (est(a) ? "*" : "");

// ---- SVG figures from the study's numbers (site/assets/study.json) -------------------------------------------
const NS = "http://www.w3.org/2000/svg";
function E(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
function svgIn(host, w, h, label) {
  host.textContent = "";
  return E("svg", { viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": label }, host);
}
const col = (name) => css(name);

/** Figure: a race's score around the runner's usual level (histogram + the ex-Gaussian fit). */
function figDev(host, d, name) {
  const W = 460, H = 240, m = { l: 40, r: 10, t: 12, b: 38 };
  const s = svgIn(host, W, H, `Scores autour du niveau habituel, ${name}`);
  const xs = lin(-1.0, 0.4, m.l, W - m.r);
  const ymax = Math.max(...d.density, ...d.curve.y) * 1.08;
  const ys = lin(0, ymax, H - m.b, m.t);
  const cut = Math.log(0.8);
  E("rect", { x: m.l, y: m.t, width: xs(cut) - m.l, height: H - m.b - m.t, fill: col("--flag-wash") }, s);
  for (let y = 1; y < ymax; y += ymax > 4 ? 2 : 1) {
    E("line", { x1: m.l, x2: W - m.r, y1: ys(y), y2: ys(y), stroke: col("--grid") }, s);
    E("text", { x: m.l - 6, y: ys(y) + 4, "text-anchor": "end", "font-size": 11 }, s, String(y));
  }
  d.density.forEach((v, i) => {
    const x0 = d.edges[i], x1 = d.edges[i + 1];
    E("rect", { x: xs(x0) + 0.4, y: ys(v), width: Math.max(0.5, xs(x1) - xs(x0) - 0.8), height: ys(0) - ys(v),
      fill: x1 <= cut + 1e-9 ? col("--flag") : col("--axis"), opacity: x1 <= cut + 1e-9 ? 0.75 : 1 }, s);
  });
  E("polyline", { points: d.curve.x.map((x, i) => `${xs(x).toFixed(1)},${ys(d.curve.y[i]).toFixed(1)}`).join(" "), fill: "none",
    stroke: col("--ink"), "stroke-width": 1.6, "stroke-dasharray": "5 3" }, s);
  E("line", { x1: m.l, x2: W - m.r, y1: ys(0), y2: ys(0), stroke: col("--axis") }, s);
  [0.4, 0.6, 0.8, 1.0, 1.2, 1.4].forEach((r) => {
    const x = xs(Math.log(r));
    E("line", { x1: x, x2: x, y1: ys(0), y2: ys(0) + 4, stroke: col("--axis") }, s);
    E("text", { x, y: H - m.b + 17, "text-anchor": "middle", "font-size": 11.5 }, s, r === 1 ? "1 ×" : fmt(r, 1));
  });
  E("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: col("--ink-3") }, s, "score de la course, en proportion du niveau habituel du coureur");
  E("text", { x: xs(cut) - 6, y: m.t + 14, "text-anchor": "end", "font-size": 11.5, fill: col("--ink") }, s, `${fmt(100 * d.below_08, 1)} % des courses`);
}

/** Figure: the whole field's circuit value over the fastest two-thirds', per circuit. */
function figTrunc(host, d, name) {
  const W = 460, H = 220, m = { l: 40, r: 10, t: 14, b: 38 };
  const s = svgIn(host, W, H, `Valeur sur tout le peloton contre les deux tiers, ${name}`);
  const x0 = d.edges[0], x1 = d.edges[d.edges.length - 1];
  const xs = lin(x0, x1, m.l, W - m.r);
  const share = d.count.map((c) => c / d.n);
  const ymax = Math.max(...share) * 1.12;
  const ys = lin(0, ymax, H - m.b, m.t);
  const step = ymax > 0.1 ? 0.05 : 0.02;
  for (let y = step; y < ymax; y += step) {
    E("line", { x1: m.l, x2: W - m.r, y1: ys(y), y2: ys(y), stroke: col("--grid") }, s);
    E("text", { x: m.l - 6, y: ys(y) + 4, "text-anchor": "end", "font-size": 11 }, s, `${Math.round(100 * y)} %`);
  }
  share.forEach((v, i) => E("rect", { x: xs(d.edges[i]) + 0.4, y: ys(v), width: Math.max(0.5, xs(d.edges[i + 1]) - xs(d.edges[i]) - 0.8),
    height: ys(0) - ys(v), fill: col("--contour"), opacity: 0.85 }, s));
  E("line", { x1: m.l, x2: W - m.r, y1: ys(0), y2: ys(0), stroke: col("--axis") }, s);
  const xm = xs(d.mean);
  E("line", { x1: xm, x2: xm, y1: m.t, y2: ys(0), stroke: col("--ink"), "stroke-dasharray": "4 3" }, s);
  E("text", { x: xm + 5, y: m.t + 10, "font-size": 11.5, fill: col("--ink") }, s, `moyenne +${fmt(100 * (d.mean - 1), 1)} %`);
  E("line", { x1: xs(1), x2: xs(1), y1: m.t, y2: ys(0), stroke: col("--ink-3") }, s);
  [1.0, 1.1, 1.2, 1.3, 1.4].forEach((r) => {
    if (r < x0 || r > x1) return;
    const x = xs(r);
    E("line", { x1: x, x2: x, y1: ys(0), y2: ys(0) + 4, stroke: col("--axis") }, s);
    E("text", { x, y: H - m.b + 17, "text-anchor": "middle", "font-size": 11.5 }, s, r === 1 ? "0" : `+${Math.round(100 * (r - 1))} %`);
  });
  E("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: col("--ink-3") }, s, "de combien la valeur sur tout le peloton dépasse celle des deux tiers (part des circuits)");
}

const FAM_COLOR = { gall: "--forest", g23: "--ink", aall: "--ink-3", race: "--flag", pow: "--water" };
const FAM_DODGE = { gall: -0.06, g23: -0.03, aall: 0, race: 0.03, pow: 0.06 };
/** Figure: the gain in duels called right (points) against the quadratic Top by k, per family of circuit value. */
function figK(host, fams, scope, name) {
  const W = 470, H = 290, m = { l: 52, r: 12, t: 12, b: 40 };
  const s = svgIn(host, W, H, `Gain en duels bien prédits selon la puissance de la moyenne, ${name}`);
  const pts = [];
  fams.forEach((f) => f.points.forEach((p) => { const a = p[scope]?.acc; if (a) pts.push({ f, k: p.k, a }); }));
  let lo = Math.min(0, ...pts.map((p) => p.a[1])), hi = Math.max(0, ...pts.map((p) => p.a[2]));
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const xs = lin(0.8, 4.2, m.l, W - m.r), ys = lin(lo, hi, H - m.b, m.t);
  const step = tickStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
    const zero = Math.abs(v) < 1e-9;
    E("line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), stroke: zero ? col("--ink-3") : col("--grid"), "stroke-width": zero ? 1.2 : 1 }, s);
    E("text", { x: m.l - 6, y: ys(v) + 4, "text-anchor": "end", "font-size": 11 }, s, sg(v, tickDec(step)));
  }
  [1, 1.5, 2, 3, 4].forEach((k) => {
    E("line", { x1: xs(k), x2: xs(k), y1: ys(lo), y2: ys(lo) + 4, stroke: col("--axis") }, s);
    E("text", { x: xs(k), y: H - m.b + 17, "text-anchor": "middle", "font-size": 11.5 }, s, fmt(k, k % 1 ? 1 : 0));
  });
  E("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: col("--ink-3") }, s, "puissance de la moyenne qui fait le CN");
  fams.forEach((f) => {
    const fp = pts.filter((p) => p.f === f).sort((a, b) => a.k - b.k);
    const c = col(FAM_COLOR[f.key]);
    if (fp.length > 1) E("polyline", { points: fp.map((p) => `${xs(p.k + FAM_DODGE[f.key])},${ys(p.a[0])}`).join(" "), fill: "none", stroke: c, "stroke-width": 2,
      ...(f.key === "g23" ? { "stroke-dasharray": "5 3" } : {}) }, s);
    fp.forEach((p) => {
      const x = xs(p.k + FAM_DODGE[f.key]);
      if (p.a[1] !== p.a[2]) E("line", { x1: x, x2: x, y1: ys(p.a[1]), y2: ys(p.a[2]), stroke: c, "stroke-width": 1.4, opacity: 0.8 }, s);
      const dot = E("circle", { cx: x, cy: ys(p.a[0]), r: 3.6, fill: c, stroke: col("--plane"), "stroke-width": 1 }, s);
      E("title", {}, dot, `${f.label}, puissance ${fmt(p.k, p.k % 1 ? 2 : 0)} : ${ci(p.a)} point`);
      if (f.rec === p.k) E("circle", { cx: x, cy: ys(p.a[0]), r: 8, fill: "none", stroke: col("--ink"), "stroke-width": 1.4 }, s);
    });
  });
}

/** Figure: bars by season with their intervals (a difference of duels called right, in points). */
function figSeasons(host, rows, name) {
  const years = Object.keys(rows).sort();
  const W = 470, H = 230, m = { l: 52, r: 8, t: 12, b: 34 };
  const s = svgIn(host, W, H, `Écart de duels bien prédits par saison, ${name}`);
  const vals = years.map((y) => rows[y]);
  let lo = Math.min(0, ...vals.map((a) => a[1])), hi = Math.max(0, ...vals.map((a) => a[2]));
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const bw = (W - m.l - m.r) / years.length, ys = lin(lo, hi, H - m.b, m.t);
  const step = tickStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
    E("line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), stroke: Math.abs(v) < 1e-9 ? col("--ink-3") : col("--grid") }, s);
    E("text", { x: m.l - 6, y: ys(v) + 4, "text-anchor": "end", "font-size": 11 }, s, sg(v, tickDec(step)));
  }
  vals.forEach((a, i) => {
    const x = m.l + i * bw, c = a[1] > 0 ? col("--forest") : a[2] < 0 ? col("--bad") : col("--axis");
    const bar = E("rect", { x: x + bw * 0.18, y: Math.min(ys(a[0]), ys(0)), width: bw * 0.64, height: Math.max(0.5, Math.abs(ys(a[0]) - ys(0))), fill: c }, s);
    E("title", {}, bar, `${years[i]} : ${ci(a)}`);
    E("line", { x1: x + bw / 2, x2: x + bw / 2, y1: ys(a[1]), y2: ys(a[2]), stroke: col("--ink-2"), "stroke-width": 1.1 }, s);
    if (i % 2 === 0) E("text", { x: x + bw / 2, y: H - m.b + 16, "text-anchor": "middle", "font-size": 11 }, s, `'${years[i].slice(2)}`);
  });
}

/** Figure: lines by season (the self-valued Tops against the method retained). */
function figLines(host, rows, series, name) {
  const years = Object.keys(rows).sort();
  const W = 470, H = 220, m = { l: 52, r: 8, t: 12, b: 34 };
  const s = svgIn(host, W, H, `Écart de duels bien prédits par saison, ${name}`);
  const all = years.flatMap((y) => series.map(([k]) => rows[y][k][0]));
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.1 || 0.01; lo -= pad; hi += pad;
  const xs = lin(0, years.length - 1, m.l + 8, W - m.r - 8), ys = lin(lo, hi, H - m.b, m.t);
  const step = tickStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) {
    E("line", { x1: m.l, x2: W - m.r, y1: ys(v), y2: ys(v), stroke: Math.abs(v) < 1e-9 ? col("--ink-3") : col("--grid") }, s);
    E("text", { x: m.l - 6, y: ys(v) + 4, "text-anchor": "end", "font-size": 11 }, s, sg(v, tickDec(step)));
  }
  years.forEach((y, i) => { if (i % 2 === 0) E("text", { x: xs(i), y: H - m.b + 16, "text-anchor": "middle", "font-size": 11 }, s, `'${y.slice(2)}`); });
  series.forEach(([k, label, c]) => {
    E("polyline", { points: years.map((y, i) => `${xs(i)},${ys(rows[y][k][0])}`).join(" "), fill: "none", stroke: col(c), "stroke-width": 2 }, s);
    years.forEach((y, i) => { const d = E("circle", { cx: xs(i), cy: ys(rows[y][k][0]), r: 3, fill: col(c) }, s); E("title", {}, d, `${label}, ${y} : ${ci(rows[y][k])}`); });
  });
}

export async function render(main, { query = {} } = {}) {
  const meta = data.meta();
  const pf = meta.methods.fair.params, p6 = meta.methods.top6w.params, p3 = meta.methods.top6w3.params;
  // the methods the documentation names: the official one and the Top, the Top linéaire for analysts; never the Fits
  const M = available().filter((m) => m !== "fair" && m !== "fair3");
  const analyst = available().includes("fair");
  const tops = M.filter((m) => m === "top6w" || m === "top6w3");
  const pctOf = (x) => `${fmt(100 * x)} %`;
  const fmtW = (w) => fmt(w, Number.isInteger(w) ? 0 : 1);
  // a discipline's own value: meta files the params under the codes (For, Spr, VTT, Ski); the French name kept as a fallback
  const own = (p, tr, key) => p.by_terrain?.[tr]?.[key] ?? p.by_terrain?.[TNAME[tr]]?.[key] ?? p[key];
  const force = html`le niveau habituel des coureurs`;
  const TNAME = { For: "Forêt", Spr: "Sprint", VTT: "VTT", Ski: "Ski" };

  // the live evaluation (site_eval.py) and the 2025 duel validation; the study's numbers (a static file, public)
  const [v, ev, study] = await Promise.all([data.validation(), data.evaluation(),
    fetch("assets/study.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  const season = v ? v.season || Object.keys(v.acc.For?.all || {}).pop() : null;
  const VM = v ? M.filter((m) => v.methods.includes(m)) : [];
  const ref = VM.includes("top6w3") ? "top6w3" : VM.includes("top6w") ? "top6w" : null;
  const entry = (tr, scope = "all") => (v?.acc?.[tr]?.[scope]?.[season]?.[0] ? v.acc[tr][scope][season] : null);
  const right = (e, m) => e[1 + v.methods.indexOf(m)];
  const share = (e, m) => (100 * right(e, m)) / e[0];

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("page.methods")}</h1>
      <p class="lede">Les règles du classement officiel et du Top, l'étude qui a conduit au Top, et les autres calculs du site.</p></div></div>
    <nav class="mx-tabs" role="tablist">${TABS.map(([k, label], i) => html`<button type="button" role="tab" data-tab="${k}"
      aria-selected="false"><span class="mx-n">${i + 1}</span>${label}</button>`)}</nav>
    ${TABS.map(([k]) => html`<div data-panel="${k}" role="tabpanel" hidden></div>`)}
    <p class="muted" style="font-size:13px;margin-top:8px">Site indépendant et non officiel, sans lien avec la Fédération française de course
      d'orientation. Seule la ${methodLabel("official")} reprend des valeurs publiées par la FFCO ; les autres sont des calculs alternatifs, à but d'analyse.</p>`;

  // ---- the evaluation: helpers ---------------------------------------------------------------------------------
  // the published measures (owner, 2026-10-14): the duels called right, each circuit weighing its runners, and the R²;
  // evaluation.json also carries Kendall's tau (2 × the duels − 1) and the Plackett-Luce information, not shown
  const EVM = ["acc", "r2"];
  const EV_LABEL = { acc: "Duels bien prédits", r2: "Écarts de temps expliqués" };
  const EV_UNIT = { acc: " pt", r2: " pt" };
  const evRows = (tr, sc = "all") => ev?.rows?.[tr]?.[sc] || {};
  const evSeasons = (tr, sc = "all") => Object.keys(evRows(tr, sc)).filter((k) => /^\d{4}$/.test(k)).sort();
  const evFmt = (meas, x, signed = true) => {
    const pts = meas === "r2" || meas === "acc";
    const y = pts ? x * 100 : x, d = pts ? (meas === "acc" ? 2 : 1) : 3;
    const r = Number(y.toFixed(d));
    return `${signed ? (r > 0 ? "+" : r < 0 ? MINUS : "±") : ""}${fmt(signed ? Math.abs(r) : r, d)}`;
  };
  const pairLabel = (p) => { const [a, c] = p.split("-"); return `${methodShort(a)} − ${methodShort(c)}`; };
  const evWins = (tr, pair = "top6w3-official") => {
    const ss = evSeasons(tr);
    return [ss.filter((y) => evRows(tr)[y].d[pair]?.acc[1] > 0).length, ss.length];
  };
  const lvl = (e, meas, m) => evFmt(meas, e[meas][m], false);
  const forestPlot = (items, meas) => {
    if (!items.length) return html`<div class="empty">—</div>`;
    const lo = Math.min(0, ...items.map((i) => i.d[1])), hi = Math.max(0, ...items.map((i) => i.d[2]));
    const pad = (hi - lo) * 0.04 || 0.01, a = lo - pad, span = hi + pad - a;
    const pos = (x) => ((x - a) / span) * 100;
    return html`<div class="ev-forest">${items.map((i) => {
      const cls = i.d[1] > 0 ? "up" : i.d[2] < 0 ? "down" : "flat";
      return html`<div class="ev-row ${cls}" title="${cls === "flat" ? "l'intervalle contient 0 : écart non significatif" : "écart significatif"}">
        <span class="ev-lab">${i.label}</span>
        <span class="ev-val num">${evFmt(meas, i.d[0])}<span class="dim"> [${evFmt(meas, i.d[1])} ; ${evFmt(meas, i.d[2])}]</span></span>
        <span class="ev-track"><i class="ev-zero" style="left:${pos(0)}%"></i>
          <i class="ev-ci" style="left:${pos(i.d[1])}%;width:${Math.max(0.6, pos(i.d[2]) - pos(i.d[1]))}%"></i>
          <i class="ev-pt" style="left:${pos(i.d[0])}%"></i></span></div>`;
    })}</div>`;
  };
  const hf = ev ? evRows("For").holdout : null, hs = ev ? evRows("Spr").holdout : null;
  const hfn = ev ? evRows("For", "nat").holdout : null, hsn = ev ? evRows("Spr", "nat").holdout : null;
  const dci = (e, pair, meas) => (e?.d?.[pair]?.[meas] ? `${evFmt(meas, e.d[pair][meas][0])}${EV_UNIT[meas]} [${evFmt(meas, e.d[pair][meas][1])} ; ${evFmt(meas, e.d[pair][meas][2])}]` : "—");

  // the second row of tabs of a panel: `?voir=` picks the chapter
  const subTabs = (chapters, current) => html`<nav class="mx-subtabs" role="tablist">${chapters.map(([k, label], i) => html`<button type="button" role="tab"
    data-subtab="${k}" aria-selected="${String(k === current)}"><span class="mx-n">${i + 1}</span>${label}</button>`)}</nav>
    ${chapters.map(([k]) => html`<div data-subpanel="${k}"${k === current ? "" : " hidden"}></div>`)}`;
  const windows = TERRAINS.map((tr) => [tr, own(p3, tr, "window_days"), own(p3, tr, "eligible_fraction"), own(p3, tr, "cn_power") ?? 1,
    own(p3, tr, "cv_power") ?? 1, own(p3, tr, "sample_fraction") ?? 2 / 3]);
  const years = (d) => (d === 365 ? "12 mois" : `${fmt(Math.round(d / 365))} ans`);
  const meanName = (q) => (q === 3 ? "cubique" : q === 2 ? "quadratique" : "pondérée");
  const cvName = (q, sf) => `${q === 0 ? "géométrique" : "arithmétique"}, ${sf >= 1 ? "tout le peloton classé" : "les ⌈2N/3⌉ plus rapides"}`;

  // ---- the worked circuit used throughout the documentation (owner, 2026-10-14: the doc is for humans, not mathematicians):
  // six runners with a CN (for the Top, read « niveau habituel »), in finishing order; F got lost
  const RACE6 = [["A", 6000, 50], ["B", 5500, 56], ["C", 5000, 62], ["D", 4500, 66], ["E", 4000, 80], ["F", 5000, 90]];
  const r6 = (() => {
    const prod = RACE6.map(([, c, tm]) => c * tm);
    const keep = Math.ceil((2 * RACE6.length) / 3);
    const amean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const gmean = (xs) => Math.exp(amean(xs.map(Math.log)));
    return { prod, keep, off: amean(prod.slice(0, keep)), topFor: gmean(prod), topSpr: gmean(prod.slice(0, keep)), arithAll: amean(prod) };
  })();
  const n0 = (x) => fmt(Math.round(x));
  const r6Table = (level, extra) => html`<div class="table-wrap"><table class="data compact"><thead><tr><th>Coureur</th><th class="r">${level}</th>
    <th class="r">Temps</th><th class="r">${level} × temps</th>${extra.map(([h]) => html`<th class="r">${h}</th>`)}</tr></thead>
    <tbody>${RACE6.map(([name, c, tm], i) => html`<tr><td>${name}</td><td class="r num">${n0(c)}</td><td class="r num">${fmt(tm)} min</td>
      <td class="r num">${n0(r6.prod[i])}</td>${extra.map(([, f]) => html`<td class="r num">${f(i, tm)}</td>`)}</tr>`)}</tbody></table></div>`;
  const more = (label, body) => html`<details class="mx-more" style="margin:12px 0"><summary style="cursor:pointer;font-weight:600">${label}</summary>
    <div style="margin-top:10px">${body}</div></details>`;

  // ======================================================================================================
  // 1. CN officiel
  // ======================================================================================================
  function officiel() {
    return html`
    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">${methodKey("official")} ${methodLabel("official")}</p>
      <h2>Le score d'une course</h2>
      <p>Chaque course rapporte un score à chaque coureur classé. Ce score dépend du temps du coureur et de la difficulté du circuit. La difficulté
        se mesure sur les coureurs présents, à partir de leur CN : c'est la <b>valeur du circuit</b>.</p>
      <p>Pour chaque coureur qui a un CN, on multiplie son CN par son temps : un coureur de CN 6 000 qui court en 50 minutes donne 300 000. La valeur du
        circuit est la moyenne de ces produits pour les deux tiers les plus rapides des coureurs qui ont un CN. Le score d'un coureur est la valeur du
        circuit divisée par son temps.</p>
      <div class="mx-eq">valeur du circuit = moyenne des (CN × temps) des deux tiers les plus rapides
        <small>score = valeur du circuit ÷ temps du coureur</small></div>
      <p>Un coureur qui court comme son CN le laisse prévoir obtient un score proche de son CN. S'il court 10 % plus vite, son score est 11 % plus haut ;
        s'il court 10 % plus lentement, son score est 9 % plus bas.</p>
      <h3>Exemple : un circuit de six coureurs</h3>
      ${r6Table("CN", [["Dans la valeur ?", (i) => (i < r6.keep ? "oui" : "non")], ["Score officiel", (i, tm) => n0(r6.off / tm)]])}
      <p>Les deux tiers de six coureurs, c'est quatre coureurs : A, B, C et D. La valeur du circuit est la moyenne de leurs quatre produits, soit
        ${n0(r6.off)}. Le score de A est ${n0(r6.off)} ÷ 50 = ${n0(r6.off / 50)}. E et F, les plus lents, ne comptent pas dans la valeur, mais reçoivent
        un score comme les autres.</p>
      <ul class="mx-list">
        <li><span>Le CN utilisé est le CN officiel publié 15 jours avant la course (le « CN J-15 »).</span></li>
        <li><span>Quand le circuit ne compte que trois coureurs ayant un CN, les trois comptent dans la valeur.</span></li>
        <li><span>Un poinçon manquant, un abandon, une disqualification ou un hors-délai donnent un score de 0, qui compte dans le CN. Un résultat
          « non classé » (nc) ne compte nulle part.</span></li>
        <li><span>En 2022, la valeur des circuits était multipliée par 0,95 ; les autres années, elle ne l'est pas.</span></li>
      </ul>
    </section>
    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">Le CN</p>
      <h2>La moyenne des scores du milieu</h2>
      <p>Le CN officiel est la moyenne des scores des 12 derniers mois, sans les meilleurs ni les moins bons. Depuis 2026, on écarte les 10 % meilleurs
        scores et les 40 % moins bons, puis on fait la moyenne de ceux qui restent. Le nombre de scores écartés est arrondi : avec 10 courses, on écarte
        la meilleure et les 4 moins bonnes, et le CN est la moyenne des 5 autres.</p>
      <ul class="mx-list">
        <li><span>Avant 2026, seule la meilleure course était écartée.</span></li>
        <li><span>Chaque 1<sup>er</sup> janvier depuis 2026, tous les CN d'une spécialité sont multipliés par un même nombre, choisi pour que la moyenne
          des 20 % meilleurs CN vaille 5 600 : c'est le recalage. Avant 2026, le meilleur CN était ramené à 10 000 quand il dépassait cette valeur ;
          c'est arrivé au 1<sup>er</sup> janvier 2013, 2023, 2024 et 2025.</span></li>
        <li><span>Il y a quatre classements depuis 2026 : forêt (longue distance, moyenne distance, nuit), sprint, VTT et ski. Avant 2026, un seul
          classement pédestre réunissait la forêt et le sprint ; le site l'affiche tel quel.</span></li>
      </ul>
    </section>
    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">Sur le site</p>
      <h2>Ce que le site reprend</h2>
      <ul class="mx-list">
        <li><span>Les CN et les scores officiels sont repris tels que la FFCO les publie sur le site du classement national, course par course.</span></li>
        <li><span>La page d'un coureur lit en direct sa page CN sur le site de la FFCO. La fédération réévalue parfois les courses des saisons passées ;
          ses points peuvent alors différer de ceux de la page de résultats de la course.</span></li>
        <li><span>À côté du CN publié, la page d'un coureur refait le calcul avec la règle ci-dessus et les scores officiels. Un écart éventuel vient d'un
          résultat absent du site, corrigé après coup, ou réévalué.</span></li>
        <li><span>Le classement officiel fait foi : c'est le seul qui compte pour les sélections.</span></li>
      </ul>
    </section>`;
  }

  // ======================================================================================================
  // 2. CN Top
  // ======================================================================================================
  function top() {
    // the worked example, computed with each visible method's rules on the same ten scores
    const W = { cdf: pf.weights.cdf, national: pf.weights.national, other: pf.weights.other };
    const n = EXAMPLE.length;
    const keep = roundHalfUp(pf.eligible_fraction * n);
    function aggregate(places, power) {
      let left = places, num = 0, den = 0;
      const used = EXAMPLE.map(([s, k], i) => {
        if (i >= keep || left <= 0) return 0;
        const u = Math.min(W[k], left);
        num += u * s ** power; den += u; left -= u;
        return u;
      });
      return { cn: roundHalfUp((num / den) ** (1 / power)), used };
    }
    const offDrop = Math.round(0.1 * n), offLow = Math.round(0.4 * n);
    const offUsed = EXAMPLE.map((_, i) => (i >= offDrop && i < n - offLow ? 1 : 0));
    const offCn = Math.round(mean(EXAMPLE.filter((_, i) => offUsed[i]).map(([s]) => s)));
    const EX = {
      official: { cn: offCn, used: offUsed, what: html`la moyenne des ${fmt(n - offDrop - offLow)} scores du milieu, sans le meilleur ni les
        ${fmt(offLow)} moins bons` },
      top6w3: { ...aggregate(p6.top_n, 1), what: html`${fmt(p6.top_n)} places, remplies par les meilleurs scores selon leur poids, en moyenne pondérée` },
    };
    const chips = (m) => html`<div class="mx-scores">${EXAMPLE.map(([s, k], i) => {
      const u = EX[m].used[i];
      const sup = m !== "official" && u ? html`<sup>${u === W[k] && k === "other" ? "" : `×${fmtW(u)}`}</sup>` : "";
      return html`<span class="mx-sc ${u ? "on" : "off"} ${k === "cdf" ? "star" : ""}">${fmt(s)}${sup}</span>`;
    })}</div>`;
    const exLabel = (m) => (m === "official" ? cnLabel("official") : cnLabel("top6w3"));

    return html`
    <section class="mx-slide">
      <p class="mx-kicker" style="${cvar("top6w3")}">${methodKey("top6w3")} ${methodLabel("top6w3")}</p>
      <h2>Un score Top par course, un CN Top par coureur</h2>
      <p class="mx-lead">La méthode Top se lit en deux temps, comme le classement mondial de l'IOF. D'abord, chaque course rapporte un <b>score Top</b> à
        chaque coureur. Ensuite, le <b>CN Top</b> d'un coureur résume ses meilleurs scores Top des 12 derniers mois.</p>
      <div class="mx-grid">
        <div class="mx-box" style="--c:var(--s1)"><h3>Le score Top d'une course</h3>
          <p>La difficulté du circuit se mesure sur le niveau habituel des coureurs présents. Le score d'un coureur est cette difficulté divisée par son
            temps.</p></div>
        <div class="mx-box" style="--c:var(--s3)"><h3>Le CN Top d'un coureur</h3>
          <p>Ses meilleurs scores Top des 12 derniers mois remplissent ${fmt(p6.top_n)} places ; le CN Top est leur moyenne, chaque course comptée
            selon ses places.</p></div>
      </div>
      <p style="margin-top:14px">Les formules sont les mêmes dans les quatre spécialités. Seuls trois réglages changent : les courses prises en compte et
        la part des meilleurs scores, parce que le VTT et le ski ont bien moins de courses, et la part du peloton qui mesure le circuit.</p>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Courses prises en compte</th>
        <th class="r">Meilleurs scores regardés</th><th>Coureurs qui mesurent le circuit</th></tr></thead>
        <tbody>${windows.map(([tr, w, f, , , sf]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>${w === 365 ? "les 12 derniers mois" : `les ${fmt(Math.round(w / 365))} dernières années`}</td>
          <td class="r">les ${pctOf(f)} meilleurs</td><td>${sf >= 1 ? "tout le peloton classé" : "les deux tiers les plus rapides"}</td></tr>`)}</tbody></table></div>
      <p style="margin-top:14px">La méthode Top est en ligne depuis le 13 octobre 2026. Les raisons de chaque choix, avec les mesures qui les justifient,
        sont dans <a href="#/methodes?onglet=etude" data-tab-link="etude">l'étude</a>.</p>
    </section>

    <section class="mx-slide" style="--c:var(--s1)">
      <p class="mx-kicker">Le score Top · étape 1</p>
      <h2>Le niveau habituel des coureurs présents</h2>
      <p>Comme pour le CN officiel, la difficulté d'un circuit se mesure sur les coureurs présents. Mais la méthode Top n'utilise pas leur CN : elle
        utilise leur <b>niveau habituel</b>, tel qu'il était ${fmt(pf.lag_days)} jours avant la course.</p>
      <p>Le niveau habituel d'un coureur est calculé sur ses scores Top des 12 derniers mois : on garde ses ${pctOf(pf.eligible_fraction)} meilleurs
        scores (70 % sur deux ans en VTT, sur trois ans en ski), chacun compté selon son poids (voir le CN Top plus bas), et on en fait la moyenne
        cubique. Il dit ce que vaut le coureur d'ordinaire.
        Ce n'est pas un classement : c'est une étape du calcul, faite des courses que le coureur a déjà courues. Le CN Top, lui, ne retient que les
        meilleures courses : il sert à classer.</p>
      <ul class="mx-list">
        <li><span>Seuls comptent les coureurs qui ont un niveau habituel dans la spécialité de la course. Il en faut au moins ${fmt(pf.min_ranked)} sur le
          circuit ; sinon le circuit n'a pas de valeur et ne donne pas de score.</span></li>
        <li><span>Le calcul part des résultats de 2010, avec les CN officiels de cette première saison comme point de départ.</span></li>
        <li><span>Les résultats « non classé » (nc) et les catégories H10 et D10 ne comptent pas.</span></li>
      </ul>
    </section>

    <section class="mx-slide" style="--c:var(--s1)">
      <p class="mx-kicker">Le score Top · étape 2</p>
      <h2>La valeur du circuit</h2>
      <p>Pour chaque coureur, on multiplie son niveau habituel par son temps. La valeur du circuit est la <b>moyenne géométrique</b> de ces produits.
        En forêt, elle porte sur tous les coureurs classés qui ont un niveau habituel. En sprint, en VTT et en ski, elle porte sur les deux tiers les plus
        rapides, comme pour le CN officiel.</p>
      <p>La moyenne géométrique de deux nombres est la racine carrée de leur produit ; celle de six nombres, la racine sixième de leur produit. Elle
        convient aux grandeurs qui se comparent en proportion, comme les temps. Prenons deux temps de 30 et de 120 minutes. Leur moyenne géométrique
        vaut √(30 × 120) = 60 minutes : 30 est deux fois moins que 60, et 120 deux fois plus. Leur moyenne ordinaire, dite arithmétique, vaut 75 minutes.</p>
      <div class="mx-eq">valeur du circuit = moyenne géométrique des (niveau habituel × temps)
        <small>en forêt sur tout le peloton classé ; ailleurs sur les deux tiers les plus rapides</small></div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Moyenne</th><th>Coureurs comptés</th></tr></thead>
        <tbody>${windows.map(([tr, , , , cv, sf]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>${cv === 0 ? "géométrique" : "arithmétique (règle de la FFCO)"}</td>
          <td>${sf >= 1 ? "tous les classés qui ont un niveau habituel" : "les deux tiers les plus rapides"}</td></tr>`)}</tbody></table></div>
    </section>

    <section class="mx-slide" style="--c:var(--s1)">
      <p class="mx-kicker">Le score Top · étape 3</p>
      <h2>Le score</h2>
      <div class="mx-eq">score Top = valeur du circuit ÷ temps du coureur × facteur de recalage du jour</div>
      <ul class="mx-list">
        <li><span>Comme pour le score officiel, courir 10 % plus vite donne un score 11 % plus haut, et courir 10 % plus lentement un score 9 % plus bas.</span></li>
        <li><span>Un poinçon manquant, un abandon, une disqualification ou un hors-délai donnent un score de 0, qui compte dans le CN Top.</span></li>
        <li><span>Le facteur de recalage, expliqué plus bas, est celui du jour de la course. Le score est calculé une fois pour toutes et n'est jamais revu.</span></li>
      </ul>
      <h3>Exemple : le même circuit de six coureurs</h3>
      ${r6Table("Niveau", [["Score Top en forêt", (i, tm) => n0(r6.topFor / tm)], ["Score Top en sprint", (i, tm) => n0(r6.topSpr / tm)]])}
      <p>On suppose ici que le niveau habituel de chaque coureur est égal à son CN, et on ne tient pas compte du recalage. En forêt, la valeur du circuit
        est la moyenne géométrique des six produits, soit ${n0(r6.topFor)}. En sprint, c'est celle des quatre plus rapides, soit ${n0(r6.topSpr)}. Le
        circuit vaut plus en forêt parce que la longue course de F y compte : l'étude explique pourquoi.</p>
    </section>

    <section class="mx-slide" style="${cvar("top6w3")}">
      <p class="mx-kicker">Le CN Top d'un coureur</p>
      <h2>${fmt(p6.top_n)} places pour les meilleures courses</h2>
      <p>On range les scores Top des 12 derniers mois du meilleur au moins bon, et on ne regarde que les ${pctOf(p6.eligible_fraction)} meilleurs. On remplit
        alors ${fmt(p6.top_n)} places, en commençant par le meilleur score. Chaque course prend autant de places que son poids : ${fmtW(pf.weights.cdf)} places
        pour un championnat de France, ${fmtW(pf.weights.national)} place pour une course nationale (O'France, Nationale), ${fmtW(pf.weights.other)} place pour
        toute autre course, courses de sélection et championnats de ligue compris. La dernière course retenue ne prend que les places qui restent.</p>
      <p>Le CN Top est la <b>moyenne pondérée</b> des scores retenus : chaque score compte autant de fois qu'il a de places. Prenons un championnat
        de France à 6 800, qui prend 2 places, et quatre autres courses à 6 500, 6 400, 6 200 et 6 000, qui prennent une place chacune. Le CN Top vaut
        (2 × 6 800 + 6 500 + 6 400 + 6 200 + 6 000) ÷ 6 = 6 450.</p>
      <div class="mx-eq">CN Top = Σ (places × score) ÷ Σ places
        <small>au plus ${fmt(p6.top_n)} places, dans toutes les spécialités</small></div>
      <ul class="mx-list">
        <li><span>Les poids suivent le nom de la compétition. Les niveaux A, B, C et D de la FFCO ne sont pas utilisés.</span></li>
        <li><span>Il faut au moins ${fmt(pf.min_scores)} courses dans les 12 derniers mois pour être classé. Quand il y a moins de ${fmt(p6.top_n)} places
          remplies, le CN Top est la moyenne pondérée de ce qui est là.</span></li>
        <li><span>Une fois les ${fmt(p6.top_n)} places remplies, une course de plus ne peut pas faire baisser le CN Top : soit elle prend la place d'une
          course moins bonne, soit elle reste dehors. Il faut pour cela en général 10 courses en 12 mois, moins avec des championnats ou des nationales.
          Tant que les places ne sont pas remplies, le CN Top est une moyenne ordinaire, et une course moins bonne que les autres le fait baisser.</span></li>
      </ul>
      <div class="table-wrap" style="margin-top:14px"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Courses prises en compte</th>
        <th class="r">Scores regardés</th><th>Moyenne</th></tr></thead>
        <tbody>${windows.map(([tr, w, f, q]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>${w === 365 ? "les 12 derniers mois" : `les ${fmt(Math.round(w / 365))} dernières années`}</td><td class="r">les ${pctOf(f)} meilleurs</td><td>${meanName(q)}</td></tr>`)}</tbody></table></div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Le recalage</p>
      <h2>Un facteur par jour, jamais revu</h2>
      <p>Sans correction, le niveau général des CN monterait peu à peu d'une année à l'autre ; l'étude explique pourquoi. Le recalage corrige cette
        dérive : chaque score Top est multiplié par un facteur, le même pour toutes les courses d'un même jour dans une même spécialité.</p>
      <ul class="mx-list">
        <li><span>Le facteur est choisi pour que la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN Top de chaque spécialité reste à
          ${fmt(pf.anchor_target)}, la règle de la FFCO depuis 2026. Il change un peu chaque jour, au lieu d'une fois par an.</span></li>
        <li><span>Pour le calculer, on mesure le niveau des CN Top ${fmt(pf.anchor_lag_months)} mois plus tôt, en moyenne sur 13 mois, puis on le prolonge
          de 10 mois, au rythme auquel il a monté pendant les dix dernières années. Les mois se comptent au calendrier : un mois sans course garde le niveau
          du mois précédent. Le facteur est calculé pour chaque mois ; entre deux mois, il passe en ligne droite de l'un à l'autre. La règle est la même
          dans les quatre spécialités.</span></li>
        <li><span>Le facteur d'une course est fixé une fois pour toutes. Un CN Top ne change donc que quand une course entre dans les 12 derniers mois ou en
          sort, jamais à cause du recalage.</span></li>
      </ul>
      <div style="margin-top:16px">${chartCard({ id: "norm", title: "Le facteur de recalage", hint: "Le facteur appliqué au score Top d'une course, selon son jour et sa spécialité", short: true })}</div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker" style="--c:var(--s3)">Illustration</p>
      <h2>Mêmes scores, CN différents</h2>
      <p class="mx-lead">Un coureur a couru ${fmt(n)} courses en 12 mois. Voici ses scores, du meilleur au moins bon. Le meilleur, ${fmt(EXAMPLE[0][0])}, est
        un championnat de France (★) ; ${fmt(EXAMPLE[2][0])} est une course nationale. Voici ce que chaque calcul retient de ces mêmes scores.</p>
      ${["official", "top6w3"].map((m) => html`<div class="mx-agg" style="${cvar(m)}">
        <div><b>${methodKey(m)} ${exLabel(m)}</b><div class="what">${EX[m].what}</div></div>
        ${chips(m)}
        <div class="cn">${fmt(EX[m].cn)}</div></div>`)}
      <p class="muted" style="font-size:13px">Les nombres en exposant (×2, ×1,5) sont les places prises par la course. L'exemple applique chaque règle aux
        mêmes scores. En réalité, le score officiel et le score Top d'une même course diffèrent, puisque la valeur du circuit n'est pas calculée de la même
        façon.</p>
    </section>`;
  }

  // ======================================================================================================
  // 3. L'étude
  // ======================================================================================================
  function etude() {
    const S = study;
    const dev = (tr) => S?.fig?.dev?.[tr], tru = (tr) => S?.fig?.trunc?.[tr];
    const k3 = (tr, sc = "all_holdout") => S?.kcmp?.[tr]?.[sc];
    const onecn = (tr, sc = "all_holdout") => S?.onecn?.[tr]?.[sc];
    const calib = (tr, g, m) => S?.calib?.[tr]?.[g]?.v?.[m];
    const pctCi = (a) => (a ? `${sg(a[0], 1)} % [${sg(a[1], 1)} ; ${sg(a[2], 1)}]` : "—");
    const kpt = (tr, key, k, sc = "all_holdout") => S?.kcurves?.[tr]?.find((f) => f.key === key)?.points.find((p) => p.k === k)?.[sc]?.acc;
    const vr = (tr, m, sc = "all_holdout") => S?.variants?.[tr]?.[sc]?.[m]?.acc;
    const isTop = (m) => m.startsWith("top");
    const mark = (kind, label, note) => html`<span class="mx-mark ${kind}">${label}</span>${note ? html`<span class="mx-note">${note}</span>` : ""}`;
    const YES = (x) => mark("yes", "oui", x), NO = (x) => mark("no", "non", x), PART = (x) => mark("part", "en partie", x);
    const CRIT = [
      ["Compte les championnats et les nationales", (m) => (m === "official" ? NO("souvent écartés") : YES("ils pèsent plus"))],
      ["Une course de plus ne fait pas baisser le CN", (m) => (m === "official" ? NO("souvent si") : PART("une fois les 6 places remplies"))],
      ["Reflète le niveau dans les grandes compétitions", (m) => (m === "official" ? NO("sans les 10 % meilleures") : isTop(m) ? YES("les meilleures courses") : PART("le niveau habituel"))],
      ["Stable d'une année à l'autre", (m) => (m === "official" ? NO("saut au 1er janvier") : YES("recalage progressif"))],
      ["Simple à expliquer", (m) => (m === "official" ? YES() : PART("règle des 6 places, circuit mesuré sur tout le peloton"))],
      ["Fait foi pour les sélections", (m) => (m === "official" ? YES("seul classement officiel") : NO("calcul d'analyse"))],
    ];
    const kBest = (vals) => Math.max(...vals.filter((x) => x != null));
    const kRow = ([tr, period, pairs, off, vals]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td class="muted">${period}</td><td class="r num">${fmt(pairs)}</td>
      <td class="r num">${fmt(off, 2)}</td>${vals.map((x, i) => html`<td class="r num ${K_TESTS.ks[i] === 2 ? "k2" : ""}">${x == null ? "—"
        : x === kBest(vals) ? html`<b>${fmt(x, 2)}</b>` : fmt(x, 2)}</td>`)}</tr>`;
    // the score curve for a few k: score relative to the reference runner's, against relative time
    const curve = (() => {
      const W_ = 640, H = 260, x0 = 52, y0 = 16, w = W_ - x0 - 16, h = H - y0 - 40;
      const X = (r) => x0 + ((r - 1) / 0.5) * w, Y = (s) => y0 + ((1 - s) / 0.75) * h;
      const line = (k) => Array.from({ length: 51 }, (_, i) => 1 + i * 0.01).map((r) => `${X(r).toFixed(1)},${Y(Math.max(0.25, r ** -k)).toFixed(1)}`).join(" ");
      const ks = [[1, "var(--s3)", "exposant 1 : FFCO et score Top", ""], [2, "var(--ink-3)", "exposant 2", "5 4"], [3, "var(--s4)", "exposant 3", ""]];
      return html`<svg viewBox="0 0 ${W_} ${H}" role="img" aria-label="Score selon le temps pour les exposants 1, 2 et 3" style="width:100%;max-width:${W_}px;height:auto;display:block">
        ${[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3].map((s) => html`<line x1="${x0}" x2="${x0 + w}" y1="${Y(s)}" y2="${Y(s)}" stroke="var(--grid)"/>
          <text x="${x0 - 6}" y="${Y(s) + 4}" text-anchor="end" font-size="13" fill="var(--ink-3)">${fmt(100 * s)} %</text>`)}
        ${[1, 1.1, 1.2, 1.3, 1.4, 1.5].map((r) => html`<text x="${X(r)}" y="${y0 + h + 16}" text-anchor="middle" font-size="13" fill="var(--ink-3)">${r === 1 ? "temps prévu" : `+${fmt(100 * (r - 1))} %`}</text>`)}
        ${ks.map(([k, c, , dash]) => html`<polyline points="${line(k)}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="${dash}"/>`)}
        ${ks.map(([k, c, label], i) => html`<g transform="translate(${x0 + w - 230},${y0 + 10 + i * 21})"><line x1="0" x2="18" y1="0" y2="0" stroke="${c}" stroke-width="2.5"/>
          <text x="24" y="5" font-size="14" fill="var(--ink-2)">${label}</text></g>`)}
        <text x="${x0 + w / 2}" y="${H - 2}" text-anchor="middle" font-size="13" fill="var(--ink-2)">temps du coureur, par rapport au temps que son CN laisse prévoir</text>
      </svg>`;
    })();
    const fig = (id, caption, two = true) => html`<figure class="mx-fig">${two ? html`<div class="panels"><div class="panel"><h4>Forêt</h4><div id="${id}-For"></div></div>
      <div class="panel"><h4>Sprint</h4><div id="${id}-Spr"></div></div></div>` : html`<div id="${id}"></div>`}<figcaption>${caption}</figcaption></figure>`;
    const noStudy = html`<p class="muted">Les chiffres de l'étude ne sont pas disponibles pour le moment.</p>`;
    const pts = (a) => (a ? html`${ci(a)} point` : "—");

    const CH = {
      objectifs: () => html`
        <section class="mx-slide mx-hero">
          <p class="mx-kicker">L'étude</p>
          <h2>Un CN qui compte vos meilleures courses et prédit mieux les résultats</h2>
          <p class="mx-lead">Ce chapitre explique pourquoi la méthode Top a été créée, comment elle a été évaluée, quelles idées ont été essayées et
            lesquelles ont été retenues, avec les chiffres qui justifient chaque choix. Il aboutit à la méthode en ligne depuis le 13 octobre 2026.</p>
          ${hf && hs ? html`<div class="mx-stats">
            <div class="mx-stat"><b>${lvl(hf, "acc", "official")} % puis ${lvl(hf, "acc", "top6w3")} %</b><span>des duels bien prédits en forêt par le CN
              officiel, puis par le CN Top. Un duel, ce sont deux coureurs d'un même circuit ; il est bien prédit quand celui qui avait le meilleur CN
              finit devant.</span></div>
            <div class="mx-stat"><b>${lvl(hs, "acc", "official")} % puis ${lvl(hs, "acc", "top6w3")} %</b><span>des duels bien prédits en sprint, sur les
              mêmes saisons.</span></div>
            <div class="mx-stat"><b>${lvl(hf, "r2", "official")} % puis ${lvl(hf, "r2", "top6w3")} %</b><span>des écarts de temps entre coureurs d'un même
              circuit expliqués par le CN en forêt.</span></div>
            <div class="mx-stat"><b>${fmt(ev.rows.For.all.holdout.comps + ev.rows.Spr.all.holdout.comps)}</b><span>compétitions de ${ev.holdout[0]} à
              ${ev.holdout[1]}, mises de côté pendant la mise au point des méthodes et utilisées seulement pour les juger.</span></div>
          </div>` : ""}
          <p style="margin-top:18px"><a class="mx-dl" href="${PDF}" download>⬇ Télécharger l'étude en PDF (livre blanc)</a></p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Le point de départ</p>
          <h2>Le CN sert à deux choses très différentes</h2>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>Mesurer la difficulté des circuits</h3>
              <p>Pour savoir si un circuit était dur, il faut connaître le <b>niveau habituel</b> des coureurs présents, sans qu'une contre-performance ou un
                exploit isolé le déforme.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>Classer les coureurs</h3>
              <p>Pour les qualifications aux championnats de France, il faut savoir ce dont un coureur est capable <b>dans une grande compétition</b>, donc
                regarder ses meilleures courses.</p></div>
          </div>
          <div class="mx-callout">Le ${cnLabel("official")} sert aux deux usages : il convient au premier et dessert le second. La méthode Top les sépare. Le
            <b>score Top</b> d'une course se mesure sur le niveau habituel des coureurs présents ; le <b>CN Top</b> d'un coureur retient ses meilleures courses.</div>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Les objectifs</p>
          <h2>Ce que la méthode doit faire</h2>
          <ul class="mx-list">
            <li><span>Partir des <b>mêmes résultats et du même score de course</b> que la FFCO, pour que chacun puisse comprendre et vérifier.</span></li>
            <li><span><b>Compter les championnats de France et les courses nationales</b>, que la méthode officielle écarte souvent, parce qu'elle écarte les
              10 % meilleures courses.</span></li>
            <li><span><b>Ne pas pénaliser le coureur qui court une course de plus</b> : une fois ses meilleures courses en place, une course de plus ne
              doit pas faire baisser son CN.</span></li>
            <li><span><b>Supprimer le saut du 1<sup>er</sup> janvier</b>, pour pouvoir suivre un coureur sur plusieurs saisons.</span></li>
            <li><span><b>Mieux prédire les résultats</b>, et le prouver par une mesure fiable.</span></li>
            <li><span><b>Rester simple à expliquer</b> : une règle commune, pas un modèle ajusté coureur par coureur.</span></li>
          </ul>
        </section>`,

      depart: () => html`
        <section class="mx-slide" style="${cvar("official")}">
          <p class="mx-kicker">${methodKey("official")} ${methodLabel("official")}</p>
          <h2>La référence : solide pour mesurer, mal adaptée pour classer</h2>
          <div class="mx-grid">
            <div><h3 style="margin-top:4px">Ce qu'elle fait bien</h3><ul class="mx-list">
              <li><span>Elle fait foi : c'est le <b>seul classement officiel</b>, celui des sélections.</span></li>
              <li><span>Elle écarte les scores extrêmes, dans les deux sens : c'est une bonne mesure du <b>niveau habituel</b>, utile pour mesurer la
                difficulté des circuits.</span></li>
              <li><span>Sa règle est publique et simple.</span></li>
              <li><span>Elle donne à chaque coureur une <b>mesure de sa performance par rapport aux autres</b>, course après course.</span></li>
              <li><span>Elle <b>incite chacun à progresser</b> : chaque course compte, et le classement montre les progrès.</span></li>
              <li><span>Elle a <b>lancé la collecte des résultats des compétitions</b>, depuis de nombreuses années ; tous ces résultats ont été publics à un
                moment ou à un autre. Sans ce travail, ni ce site ni cette étude n'existeraient.</span></li>
            </ul></div>
            <div><h3 style="margin-top:4px">Ce qu'elle fait mal</h3><ul class="mx-list bad">
              <li><span><b>Elle écarte les 10 % meilleures courses.</b> Pour les meilleurs coureurs, ce sont le plus souvent les championnats de France et
                les nationales : les courses qu'ils préparent, et les plus relevées.</span></li>
              <li><span><b>Elle n'incite pas à courir.</b> Pour un coureur bien classé, une course de plus fait souvent baisser le CN. Certains s'arrêtent
                dès qu'ils ont le CN qui les qualifie ; d'autres ne courent que les courses qu'ils jugent « rentables ».</span></li>
              <li><span><b>Un saut chaque 1<sup>er</sup> janvier</b>, et des règles qui ont changé au fil des saisons : on ne peut pas comparer les CN d'une
                année à l'autre.</span></li>
              <li><span><b>Toutes les courses pèsent pareil</b>, d'un championnat de France à une régionale.</span></li>
            </ul></div>
          </div>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">En un coup d'œil</p>
          <h2>Chaque méthode, critère par critère</h2>
          <div class="table-wrap"><table class="mx-matrix">
            <thead><tr><th></th>${M.map((m) => html`<th>${methodKey(m)}${methodShort(m)}</th>`)}</tr></thead>
            <tbody>${CRIT.map(([label, cell]) => html`<tr><td>${label}</td>${M.map((m) => html`<td>${cell(m)}</td>`)}</tr>`)}</tbody>
          </table></div>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker" style="--c:var(--s3)">Ce que change la méthode Top</p>
          <h2>Mêmes résultats, mêmes temps, autre calcul</h2>
          <div class="mx-fix">
            <div class="head">Méthode officielle</div><div></div><div class="head">Méthode Top</div>
            <div class="p"><b>Les meilleures courses sont écartées</b>souvent les championnats de France et les nationales</div><div class="arrow">→</div>
            <div class="s"><b>Les meilleures courses comptent le plus</b>un championnat de France compte double, une nationale une fois et demie ; seules
              les moins bonnes courses sont laissées de côté</div>
            <div class="p"><b>Une course de plus peut faire baisser le CN</b>ce qui dissuade de courir</div><div class="arrow">→</div>
            <div class="s"><b>Une fois les ${fmt(p6.top_n)} places remplies, une course de plus ne peut plus le faire baisser</b>les places sont remplies par
              les meilleures courses : plus on court, plus on a de chances de bien les remplir</div>
            <div class="p"><b>Le circuit mesuré sur les deux tiers les plus rapides</b>les coureurs qui se sont trompés ne comptent pas, et bien s'orienter
              sur un circuit piégeux rapporte moins qu'ailleurs</div><div class="arrow">→</div>
            <div class="s"><b>Le circuit mesuré sur tous les coureurs</b>en forêt : la difficulté d'un circuit comprend les erreurs qu'il provoque, et les
              éviter rapporte</div>
            <div class="p"><b>Un saut au 1<sup>er</sup> janvier</b>tout le classement change d'un coup</div><div class="arrow">→</div>
            <div class="s"><b>Un recalage progressif, jour après jour</b>le score d'une course est fixé une fois pour toutes, et le CN ne bouge que quand
              une course entre dans les 12 derniers mois ou en sort</div>
            <div class="p"><b>Un seul CN pour deux usages</b>mesurer les circuits et classer les coureurs</div><div class="arrow">→</div>
            <div class="s"><b>Un calcul pour chaque usage</b>la valeur d'un circuit se mesure à partir des scores que les coureurs présents ont obtenus
              dans leurs courses précédentes ; le CN Top retient leurs meilleures courses</div>
          </div>
        </section>`,

      mesure: () => html`
        <section class="mx-slide mx-hero">
          <p class="mx-kicker">Le test</p>
          <h2>Avant la course, qui est favori ? Après, qui a fini devant, et avec quel écart ?</h2>
          <p class="mx-lead">Un bon CN doit annoncer les résultats. Pour chaque coureur, on prend le CN qu'il avait <b>15 jours avant</b> la course : ce
            CN ne sait rien de la course. Puis on regarde, circuit par circuit, si ces CN annonçaient l'ordre d'arrivée et les écarts de temps. Toutes les
            méthodes sont jugées sur les mêmes coureurs : ceux qui avaient un CN dans chacune d'elles.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Première mesure</p>
          <h2>La part des duels bien prédits</h2>
          <p>Sur un circuit, chaque paire de coureurs forme un <b>duel</b> : il y a 45 duels entre 10 coureurs, et 11 175 entre 150 coureurs. Le CN prédit
            bien un duel quand le coureur qui avait le CN le plus haut termine devant l'autre. Quand les deux CN sont égaux, le duel compte pour moitié.</p>
          <p>Un CN tiré au hasard prédirait bien la moitié des duels, soit 50 %. Aucun CN ne peut les prédire tous, car la forme du jour et les erreurs
            décident d'une partie des résultats.</p>
          <div class="mx-eq">part des duels bien prédits = duels bien prédits ÷ nombre de duels
            <small>calculée pour chaque circuit, puis moyennée sur tous les circuits, chacun pesant son nombre de coureurs</small></div>
          <p><b>Pourquoi chaque circuit pèse son nombre de coureurs.</b> Chaque coureur affronte tous les autres coureurs de son circuit. La part de ses
            duels bien prédits dit si le CN l'a bien placé parmi eux. En faisant la moyenne de cette part sur tous les coureurs de la saison, on obtient
            exactement la moyenne des circuits pondérée par leur nombre de coureurs : chaque résultat compte une fois. Compter chaque duel une fois donnerait
            trop de poids aux grands circuits, puisqu'un circuit de 150 coureurs pèserait autant que 250 circuits de 10 coureurs. Compter chaque circuit une
            fois en donnerait trop aux petits, puisqu'un circuit de 5 coureurs pèserait autant qu'un circuit de championnat de France.</p>
          <p><b>Le lien avec le τ de Kendall.</b> Les statisticiens mesurent l'accord entre deux classements par le « τ de Kendall » : la part des duels
            bien prédits moins la part des duels mal prédits. Avec 80 % de duels bien prédits, et donc 20 % de mal prédits, τ vaut 0,80 − 0,20 = 0,60.
            C'est la même mesure sur une autre échelle : τ vaut 0 pour un CN tiré au hasard et 1 pour un ordre parfait. Ce document donne la part des
            duels, plus parlante.</p>
          ${hf ? html`<p>En forêt, de ${ev.holdout[0]} à ${ev.holdout[1]}, le CN officiel prédit bien ${lvl(hf, "acc", "official")} % des duels et le CN Top
            ${lvl(hf, "acc", "top6w3")} %. Le CN officiel se trompe donc sur ${fmt(100 * (1 - hf.acc.official), 1)} % des duels, et le CN Top sur
            ${fmt(100 * (1 - hf.acc.top6w3), 1)} % : c'est ${fmt(Math.round(100 * (1 - (1 - hf.acc.top6w3) / (1 - hf.acc.official))))} % d'erreurs en moins.
            Les écarts entre les variantes essayées pendant l'étude sont souvent de quelques dixièmes de point.</p>` : ""}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Deuxième mesure</p>
          <h2>Les écarts de temps expliqués</h2>
          <p>L'ordre d'arrivée ne dit pas tout : finir 10 secondes ou 10 minutes derrière un autre coureur, ce n'est pas la même chose. Or un CN se lit comme
            une vitesse : un coureur dont le CN est 10 % plus haut doit courir environ 10 % plus vite. Sur chaque circuit, on compare donc le temps de chaque
            coureur au temps que son CN annonçait.</p>
          <ul class="mx-list">
            <li><span><b>Les temps se comparent en proportion.</b> Perdre 5 minutes sur un sprint de 15 minutes n'est pas la même chose que perdre 5 minutes
              sur une longue distance de 90 minutes. Les écarts sont donc mesurés en pourcentage du temps, et non en minutes.</span></li>
            <li><span><b>La part expliquée</b>, notée R², dit quelle part des différences de temps entre les coureurs d'un même circuit le CN annonçait : 0 %
              si le CN n'annonce rien, 100 % si chaque coureur a mis exactement le temps annoncé. Là aussi, chaque résultat compte une fois.</span></li>
            <li><span><b>La règle qui traduit un écart de CN en écart de temps est apprise sur la saison précédente.</b> Chaque saison est ainsi prédite sans
              qu'on l'ait regardée, comme le serait la saison à venir.</span></li>
          </ul>
          ${more("La formule", html`<div class="mx-eq">ln(temps) = constante du circuit − b × ln(CN) + écart
            <small>ln : le logarithme, qui transforme les rapports en différences. La constante tient compte de la longueur et de la difficulté du circuit ;
              b, proche de 1, est apprise sur la saison précédente. R² = 1 − (somme des écarts²) ÷ (somme des écarts de ln(temps) à la moyenne du circuit)².</small></div>`)}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">La marge d'incertitude</p>
          <h2>Un écart est-il réel, ou dû au hasard des courses ?</h2>
          <p>Les courses d'une saison ne sont qu'un échantillon de toutes les courses possibles. Avec d'autres courses, l'écart entre deux méthodes aurait été
            un peu différent. Pour savoir de combien, on refait le calcul ${ev ? fmt(ev.boot) : "2 000"} fois sur des saisons tirées au sort. Chaque tirage
            prend autant de compétitions que la saison réelle, choisies au hasard parmi elles : certaines sortent deux fois, d'autres pas du tout.</p>
          <ul class="mx-list">
            <li><span><b>L'intervalle à 95 %</b>, écrit entre crochets après chaque écart, va du plus petit au plus grand écart obtenu dans 95 % de ces
              tirages. Par exemple, « +0,40 [+0,35 ; +0,44] » veut dire que l'écart mesuré est de 0,40 point, et que 95 % des tirages donnent entre 0,35 et
              0,44 point.</span></li>
            <li><span><b>Un écart est dit significatif quand son intervalle ne contient pas 0.</b> Presque tous les tirages donnent alors un écart du même
              signe : le hasard des courses ne suffit pas à l'expliquer. Quand l'intervalle contient 0, par exemple [−0,02 ; +0,01], on ne peut pas dire
              laquelle des deux méthodes est la meilleure.</span></li>
            <li><span><b>On tire des compétitions entières, pas des duels.</b> Les coureurs d'une même course partagent le terrain, la carte et la météo :
              leurs duels ne sont pas indépendants. Les tirer un par un donnerait des intervalles trop étroits, donc trop optimistes.</span></li>
            <li><span><b>Les méthodes sont comparées sur les mêmes coureurs et les mêmes courses</b>, course par course.</span></li>
            <li><span><b>Des saisons mises de côté.</b> Les réglages ont été choisis sur la période de juillet 2025 à octobre 2026. Les saisons
              ${ev ? `${ev.holdout[0]} à ${ev.holdout[1]}` : "2012 à 2024"} n'ont servi qu'à juger : les réglages n'ont pas pu s'adapter à leurs
              particularités, comme un examen fait de questions jamais vues à l'entraînement.</span></li>
            <li><span>Chaque variante est recalculée depuis 2010 sur une copie de la base de données, avec son propre recalage. Les CN de 15 jours avant la
              course sont ceux qu'elle aurait publiés.</span></li>
          </ul>
          <p class="muted" style="font-size:13px">Jusqu'au 14 octobre 2026, chaque circuit comptait une fois dans la mesure, quel que soit son nombre de
            coureurs. Toutes les mesures de l'étude ont été refaites en pesant chaque circuit par son nombre de coureurs ; aucun choix n'a changé. Les tableaux
            datés du 6 et du 7 octobre, repliés dans les chapitres suivants, viennent de la mise au point : chaque duel y comptait une fois, sans intervalle.</p>
        </section>`,

      choix: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Les poids et les places</p>
          <h2>Les meilleures courses comptent, chacune selon son importance</h2>
          <ul class="mx-list">
            <li><span><b>Le poids d'une course suit le nom de la compétition.</b> Un championnat de France a un poids de ${fmtW(pf.weights.cdf)} : c'est la
              course la plus relevée, celle que les coureurs préparent, et elle compte comme deux courses. Une course nationale a un poids de
              ${fmtW(pf.weights.national)}, toute autre course un poids de ${fmtW(pf.weights.other)}. Les niveaux A, B, C et D de la FFCO ne sont pas utilisés.</span></li>
            <li><span><b>${fmt(p6.top_n)} places</b>, remplies du meilleur score au moins bon. Une fois les places remplies, une course de plus ne peut pas faire baisser le CN : soit elle
              prend la place d'une course moins bonne, soit elle reste dehors. Le classement mondial de l'IOF fonctionne de la même façon, avec les cinq
              meilleures courses. Dix places ont été essayées : elles ne faisaient pas mieux.</span></li>
            <li><span><b>Seuls les ${pctOf(pf.eligible_fraction)} meilleurs scores</b> des 12 derniers mois peuvent compter, et il faut au moins
              ${fmt(pf.min_scores)} courses. Les scores laissés de côté sont, pour l'essentiel, les courses où le coureur s'est trompé.</span></li>
          </ul>
          ${more("Les autres réglages essayés", html`<ul class="mx-list">
            <li><span>Regarder les 70 % ou les 80 % meilleurs scores au lieu de 60 % coûtait de 0,4 à 1 point de duels bien prédits, en forêt comme en sprint.</span></li>
            <li><span>Exiger cinq courses au lieu de trois réduisait le nombre de coureurs qui servent à mesurer les circuits, et la prédiction était moins bonne.</span></li>
            <li><span>Se contenter de deux courses classait 11 % de coureurs de plus en forêt et 38 % en sprint, mais coûtait de 0,1 à 0,4 point sur les duels
              entre les coureurs déjà classés.</span></li>
            <li><span>Ce sont des mesures de la mise au point (6 et 7 octobre 2026), où chaque duel comptait une fois.</span></li></ul>`)}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Le niveau habituel</p>
          <h2>Pourquoi les circuits ne se mesurent pas avec les CN Top</h2>
          <p>Le classement mondial de l'IOF mesure une course d'après les points de classement des coureurs présents. Ici, ce n'est pas possible avec les
            CN Top, parce qu'ils ne retiennent que les meilleures courses : ils se nourriraient d'eux-mêmes. Un groupe qui court surtout entre soi, comme les
            vétérans ou les jeunes, aurait des CN tirés vers le haut. Ses circuits paraîtraient alors plus difficiles, ses scores seraient plus hauts, et ses
            CN plus hauts encore. Dans les premiers essais, les H/D 21 se trouvaient ainsi sous-évalués de 13 % environ face à ces groupes.</p>
          <p>Les circuits se mesurent donc sur ${force} : la moyenne cubique de leurs ${pctOf(pf.eligible_fraction)} meilleurs scores, sans limite de
            places, ce que vaut chacun d'ordinaire. Le CN Top se calcule ensuite sur les mêmes scores, avec ${fmt(p6.top_n)} places.</p>
          ${S ? html`<p>L'idée a été mesurée de nouveau avec la méthode retenue. Si les circuits étaient mesurés avec les CN Top, la part des duels bien prédits
            serait plus basse : ${ci(onecn("For")?.ST6_t)} point de ${S.holdout[0]} à ${S.holdout[1]}, et ${ci(onecn("For", "all_tuned")?.ST6_t)} point
            depuis juillet 2025. <b>La perte grandit au fil des saisons.</b> Les jeunes seraient aussi
            surévalués de ${fmt(Math.abs(calib("For", "young", "ST6_t")?.[0] ?? 1.4), 1)} % face aux H/D 21. Avec 10 places au lieu de 6, la perte serait trois
            fois plus petite ; avec 16, elle disparaîtrait presque, mais le CN Top se confondrait alors avec le niveau habituel pour presque tout le monde.</p>
          ${fig("fig-onecn", html`<b>Si les circuits étaient mesurés avec les CN Top</b> au lieu du niveau habituel : écart de duels bien prédits par saison,
            en points, en forêt, avec 6, 10 et 16 places. Sous la ligne zéro, la prédiction est moins bonne. Pour 62 % des coureurs de forêt (sept courses
            par an en médiane) et 96 % en sprint, le CN Top et le niveau habituel sont déjà le même nombre. Ils diffèrent pour les coureurs qui courent
            beaucoup (douze courses et plus, un quart des coureurs de forêt), de 4,6 % en médiane.`, false)}` : noStudy}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Le recalage continu</p>
          <h2>Un facteur par jour plutôt qu'un saut par an</h2>
          <ul class="mx-list">
            <li><span>Le score d'une course est multiplié par le facteur de son jour, puis fixé une fois pour toutes. Le CN ne change donc que lorsqu'une
              course entre dans les 12 derniers mois ou en sort, jamais à cause du recalage.</span></li>
            <li><span>Le facteur applique la règle 2026 de la FFCO en continu : dans chaque spécialité, la moyenne des ${pctOf(pf.anchor_top_fraction)}
              meilleurs CN est maintenue à ${fmt(pf.anchor_target)}. D'un mois à l'autre, il bouge d'environ 0,3 %, alors que le recalage officiel du
              1<sup>er</sup> janvier fait des sauts de 3 à 7 %.</span></li>
            <li><span>Un recalage qui réagissait à ses propres effets a été essayé : il oscillait d'un mois à l'autre, et il a été écarté.</span></li>
          </ul>
          <p>Un défaut de ce recalage, découvert le 13 octobre 2026, est traité au chapitre
            <a href="#/methodes?onglet=etude&voir=recalage" data-tab-link="etude" data-goto="recalage">Le recalage</a>.</p>
        </section>`,

      score: () => html`
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">Pourquoi pencher vers les bonnes courses</p>
          <h2>Une erreur ne fait que ralentir</h2>
          <p>Le score d'une course mêle trois choses : le niveau du coureur ; sa forme du jour, qui peut être bonne ou mauvaise ; et le temps qu'il a perdu en
            erreurs. Une erreur ralentit toujours, elle ne fait jamais gagner de temps. Les courses d'un coureur ne sont donc pas réparties de façon
            équilibrée autour de son niveau : la plupart en sont proches, quelques-unes sont nettement en dessous, et presque aucune n'est nettement
            au-dessus.</p>
          ${S ? html`<p>En forêt, ${fmt(100 * dev("For").below_08, 1)} % des courses donnent un score inférieur à 80 % du niveau habituel du coureur, et
            seulement ${fmt(100 * dev("For").above_125, 1)} % un score supérieur à 125 %. En sprint, ces parts sont de ${fmt(100 * dev("Spr").below_08, 1)} % et
            de ${fmt(100 * dev("Spr").above_125, 1)} %.</p>
          ${fig("fig-dev", html`<b>Le score d'une course comparé aux autres courses du même coureur</b> dans la saison (coureurs d'au moins 6 courses,
            2012–2025). Au centre, les courses courues à son niveau ; à gauche, les courses moins bonnes, en orange celles sous 80 % du niveau. Les tirets
            montrent un modèle simple : la forme du jour varie d'environ 12 % en forêt (6,6 % en sprint), et les erreurs coûtent en moyenne 10 % du temps
            (6,5 %).`)}` : noStudy}
          <p>Pour retrouver le vrai niveau d'un coureur, il faut donc faire plus confiance à ses bonnes courses qu'aux mauvaises. Les deux calculs de la
            méthode le font, chacun à sa façon. Le <b>niveau habituel</b>, qui sert à mesurer les circuits, ne garde que les ${pctOf(pf.eligible_fraction)}
            meilleurs scores, et en prend la <b>moyenne cubique</b>, qui donne un peu plus de poids aux meilleurs. Le <b>CN Top</b>, qui sert à classer, ne
            garde que les meilleures courses, sur ${fmt(p6.top_n)} places, et en prend la moyenne pondérée ordinaire.</p>
          <div class="mx-eq">trois scores : 6 000, 5 000 et 4 000
            <small>moyenne ordinaire : (6 000 + 5 000 + 4 000) ÷ 3 = 5 000 · moyenne cubique : ∛((6 000³ + 5 000³ + 4 000³) ÷ 3) = 5 130</small></div>
          <p>Pour un coureur régulier, la différence entre les deux moyennes est faible : sur ${fmt(p6.top_n)} places, la moyenne cubique dépasse la
            moyenne ordinaire de 0,3 % en médiane, et de plus de 1,3 % pour un coureur sur dix seulement. Elle compte surtout pour les coureurs irréguliers, dont les courses retenues
            mêlent de très bonnes courses et des courses avec de petites erreurs.</p>
          ${S ? html`<p>Un calcul plus élaboré a aussi été essayé : un modèle statistique qui sépare, course par course, la forme du jour et les erreurs
            (l'estimation dite du maximum de vraisemblance). Il prédit un peu mieux en sprint (${sg(S.mle_fit.Spr[0], 2)} point de duels) mais nettement
            moins bien en forêt (${sg(S.mle_fit.For[0], 2)} point). En forêt, se tromper souvent est un trait du coureur, qui se retrouve d'une course à
            l'autre : un modèle qui traite chaque course ratée comme de la malchance surestime les coureurs qui se trompent souvent.</p>` : ""}
        </section>

        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">13 octobre 2026</p>
          <h2>Pour le niveau habituel : la moyenne cubique, et pas plus</h2>
          <p>On peut pencher plus ou moins vers les meilleures courses. La moyenne quadratique est la racine carrée de la moyenne des carrés ; la moyenne
            cubique, la racine cubique de la moyenne des cubes ; on peut continuer avec les puissances 4, 5… Plus la puissance est grande, plus les meilleures
            courses pèsent ; à l'extrême, il ne reste que la meilleure course. Pour les scores 6 000, 5 000 et 4 000 : moyenne ordinaire 5 000, quadratique
            5 066, cubique 5 130, puissance 4 : 5 190. Dans ces mesures, le niveau habituel et le CN Top changent de moyenne ensemble.</p>
          ${S ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>Comparaison</th><th class="r">Toutes les courses<br>2012–2024</th>
            <th class="r">Courses nationales<br>2012–2024</th><th class="r">Toutes les courses<br>depuis juillet 2025</th></tr></thead><tbody>
            <tr><td>Forêt : cubique contre quadratique</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(k3("For", sc)?.G4_t)}</td>`)}</tr>
            <tr><td>Forêt : puissance 4 contre quadratique</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(k3("For", sc)?.G5_t)}</td>`)}</tr>
            <tr><td>Sprint : cubique contre quadratique</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(neg(k3("Spr", sc)?.G4_t))}</td>`)}</tr>
            <tr><td>Sprint : puissance 4 contre cubique</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(k3("Spr", sc)?.G5_t)}</td>`)}</tr>
            </tbody></table></div>
          <p class="muted" style="font-size:13px">Écart de la part des duels bien prédits, en points, avec son intervalle à 95 %. Un nombre positif est en
            faveur de la première moyenne nommée.</p>` : noStudy}
          <p>En forêt, la moyenne cubique fait mieux que la quadratique et ne perd rien sur les courses nationales. La puissance 4 gagne encore un peu sur
            l'ensemble des courses, mais perd sur les nationales. En sprint, la puissance 4 gagnerait quelques centièmes de point, sans gain sur les
            nationales. Au-delà de la moyenne cubique, le CN reposerait sur une ou deux courses : une course exceptionnelle, ou un circuit mal mesuré,
            suffirait à le porter. Le 13 octobre, le niveau habituel et le CN Top ont donc pris la moyenne cubique, en forêt comme en sprint. Le
            lendemain, le CN Top est passé à la moyenne pondérée ordinaire, et seul le niveau habituel l'a gardée.</p>
        </section>

        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">14 octobre 2026</p>
          <h2>Un classement fait d'une simple moyenne pondérée</h2>
          <p>Les mesures des chapitres précédents désignaient la moyenne cubique comme la plus précise, pour le CN Top comme pour le niveau habituel.
            Pour le CN Top, elle a pourtant été écartée le 14 octobre 2026, au profit de la <b>moyenne pondérée ordinaire</b> de ses meilleures courses :
            très légèrement moins précise, celle-ci est bien plus facile à comprendre et à interpréter. Un CN Top de 6 000 veut dire que les meilleures
            courses du coureur valent en moyenne 6 000 points, chacune comptée selon ses places. Chacun peut le refaire à la main, comme le CN officiel ou
            le classement mondial de l'IOF. Le niveau habituel, qui ne sert qu'à mesurer les circuits et que personne n'a besoin de recalculer, garde la
            moyenne cubique.</p>
          <p>Le choix a été mesuré avant d'être fait, sur les mêmes coureurs : mêmes scores, mêmes valeurs de circuit, seul le CN Top change de moyenne.</p>
          ${S?.arith ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>Moyenne pondérée contre moyenne du 13 octobre</th>
            <th class="r">Duels, toutes<br>les courses</th><th class="r">Duels, courses<br>nationales</th><th class="r">Duels, depuis<br>juillet 2025</th>
            <th class="r">Écarts de temps<br>expliqués</th><th class="r">Saisons<br>moins bonnes</th></tr></thead><tbody>
            ${[["For", "Forêt (contre la moyenne cubique)"], ["Spr", "Sprint (contre la moyenne cubique)"], ["VTT", "VTT (contre la moyenne quadratique)"]].map(([tr, label]) => {
              const a = S.arith[tr];
              return html`<tr><td>${label}</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(a[sc]?.acc)}</td>`)}
                <td class="r num">${a.all_holdout?.r2 ? sg(a.all_holdout.r2[0], 1) : "—"}</td><td class="r num">${fmt(a.worse)} sur ${fmt(a.seasons)}</td></tr>`;
            })}</tbody></table></div>
          <p class="muted" style="font-size:13px">Écarts en points, avec leur intervalle à 95 %, de 2012 à 2024 sauf mention. « Saisons moins bonnes » : les
            saisons où la perte en duels est significative ; aucune saison n'est meilleure. Le ski a trop peu de courses pour être mesuré.</p>` : noStudy}
          <p>En forêt, l'ordre des coureurs ne change presque pas : la moyenne cubique sert surtout à mesurer les circuits, pas à classer. Le CN Top annonce
            un peu moins bien les écarts de temps entre coureurs (environ 1 point de moins). En sprint et en VTT, la perte est d'environ un dixième de point
            de duels, et de 3,4 et 1,8 points d'écarts de temps. C'est le prix d'un classement que chacun comprend, et il est faible : le CN Top reste
            nettement meilleur que le CN officiel, avec environ 2 points de duels bien prédits de plus en forêt et en sprint.</p>
          ${S?.arith ? html`<p>Pour les coureurs, le CN Top baisse de ${fmt(Math.abs(S.arith.shift.median), 1)} % en médiane. Un coureur sur dix perd
            ${fmt(Math.abs(S.arith.shift.p10), 0)} % ou plus, et un sur cent environ ${fmt(Math.abs(S.arith.shift.p1), 0)} % : ce sont des coureurs irréguliers,
            dont les meilleures courses sont inégales. Le recalage ramène ensuite le niveau général à ${fmt(pf.anchor_target)}.</p>
          ${more("Deux autres réglages essayés le même jour", html`<div class="table-wrap"><table class="data compact"><thead><tr><th>Moyenne pondérée, et…</th>
            <th class="r">Forêt, duels</th><th class="r">Forêt, écarts de temps</th><th class="r">Sprint, duels</th><th class="r">Sprint, écarts de temps</th></tr></thead><tbody>
            ${[["best50", "les 50 % meilleurs scores au lieu de 60 %"], ["places4", "4 places au lieu de 6"]].map(([k, label]) => html`<tr><td>${label}</td>
              ${["For", "Spr"].map((tr) => html`<td class="r num">${ci(S.arith[k][tr].all_holdout.acc)}</td><td class="r num">${sg(S.arith[k][tr].all_holdout.r2[0], 1)}</td>`)}</tr>`)}
            </tbody></table></div>
            <p class="muted" style="font-size:13px">Contre la moyenne cubique, 2012–2024, en points. Garder les 50 % meilleurs scores fait un peu mieux en forêt,
              mais ce réglage a été choisi en regardant ces mêmes saisons : il demande à être confirmé sur des saisons nouvelles avant d'être adopté.
              Quatre places font moins bien.</p>`)}` : ""}
        </section>

        <section class="mx-slide">
          <p class="mx-kicker">Comment on y est arrivé</p>
          <h2>D'abord, l'idée de rendre le retard plus cher</h2>
          <p>Avec le score de la FFCO, 10 % de temps en plus coûtent 9 % de score. La première idée de l'étude était de rendre le retard plus cher, en
            élevant le temps à une puissance, appelée ici l'exposant : avec un exposant 2, 10 % de temps en plus coûtent 17 % de score ; avec un exposant 3,
            25 %. Le score Top a finalement gardé la règle de la FFCO.</p>
          <div style="margin:8px 0 4px">${curve}</div>
          <p>Les premières mesures, le 7 octobre 2026, montraient un gain entre l'exposant 1 et l'exposant 2, puis plus rien. On a alors compris qu'élever le
            temps à une puissance revenait exactement à changer deux moyennes : celle qui mesure la difficulté du circuit et celle qui fait le CN. Placée dans
            la moyenne qui fait le CN, la puissance aidait. Placée dans la difficulté du circuit, elle nuisait sur les courses nationales. Le Top publié du 7 au
            13 octobre 2026 utilisait donc la moyenne quadratique pour le CN, et la règle de la FFCO pour le circuit. L'étude du 13 octobre a ensuite montré
            d'où venait la limite : de la mesure du circuit sur les deux tiers les plus rapides (chapitre suivant).</p>
          ${more("Les mesures du 7 octobre 2026", html`
            <h3>La part des duels bien prédits selon l'exposant</h3>
            <div class="table-wrap"><table class="data compact mx-ktab"><thead><tr><th>${t("f.terrain")}</th><th>Période</th><th class="r">Duels</th>
              <th class="r">${methodShort("official")}</th>${K_TESTS.ks.map((k) => html`<th class="r ${k === 2 ? "k2" : ""}">${String(k).replace(".", ",")}</th>`)}</tr></thead>
              <tbody>${K_TESTS.rows.map(kRow)}</tbody>
              <tbody><tr><td colspan="${4 + K_TESTS.ks.length}" class="muted" style="font-size:12.5px">Contrôle sur les saisons précédentes</td></tr>
                ${K_TESTS.past.map(kRow)}</tbody></table></div>
            <p class="muted" style="font-size:13px">Part des duels bien prédits (%), chaque duel compté une fois, selon l'exposant appliqué au temps, avec un
              niveau habituel en moyenne ordinaire. En gras, le meilleur de chaque ligne. Une seule période, sans intervalle.</p>
            <h3>Où placer la puissance : dans la moyenne qui fait le CN, dans la difficulté du circuit, ou dans les deux</h3>
            <div class="table-wrap"><table class="data compact mx-ktab"><thead>
              <tr><th rowspan="2">Puissance appliquée à</th><th class="r" rowspan="2">Circuit</th><th class="r" rowspan="2">CN</th>
                <th class="r" colspan="2">Forêt</th><th class="r" colspan="2">Sprint</th><th class="r" rowspan="2">Écart des CN<br>en forêt</th></tr>
              <tr><th class="r">toutes</th><th class="r">nationales</th><th class="r">toutes</th><th class="r">nationales</th></tr></thead>
              ${K_GRID.map(([what, rows]) => html`<tbody>${rows.map((r, i) => {
                const chosen = r[0] === 1 && r[1] === 2, today = r[0] === 1 && r[1] === 1;
                const k = (x) => String(x).replace(".", ",");
                return html`<tr>${i === 0 ? html`<td rowspan="${rows.length}">${{ cn: "la moyenne qui fait le CN", cv: "la difficulté du circuit", both: "les deux" }[what]}</td>` : ""}
                  <td class="r num ${chosen ? "k2" : ""}">${k(r[0])}</td><td class="r num ${chosen ? "k2" : ""}">${k(r[1])}</td>
                  ${r.slice(2, 6).map((x, j) => html`<td class="r num ${chosen ? "k2" : ""}">${x === Math.max(...K_GRID.flatMap(([, rr]) => rr.map((y) => y[2 + j])))
                    ? html`<b>${fmt(x, 2)}</b>` : fmt(x, 2)}</td>`)}
                  <td class="r num ${chosen ? "k2" : ""}">${fmt(r[6], 2)}${today ? html` <span class="muted">(moyenne ordinaire)</span>` : chosen
                    ? html` <span class="muted">(Top du 7 au 13 oct.)</span>` : ""}</td></tr>`;
              })}</tbody>`)}</table></div>
            <p class="muted" style="font-size:13px">Part des duels bien prédits (%) par la méthode Top, chaque duel compté une fois, de juillet 2025 à
              octobre 2026 : 771 511 duels en forêt (276 703 sur courses nationales), 113 914 en sprint (21 452). En gras, le meilleur de chaque colonne.
              « Écart des CN » : le CN du coureur plus fort que 90 % des autres, divisé par celui du coureur plus fort que 10 % des autres.</p>`)}
        </section>`,

      circuit: () => html`
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">Ce que mesure la valeur du circuit</p>
          <h2>La difficulté du circuit, pas l'ordre des coureurs</h2>
          <p class="mx-lead">La valeur d'un circuit mesure sa difficulté : le temps qu'y met un coureur d'un niveau donné. Elle fixe le niveau de tous les
            scores de la course par rapport aux autres courses. Elle ne change rien à l'ordre à l'intérieur de la course : le coureur qui s'oriente bien
            devance ceux qui se trompent, et son score dépasse le leur d'autant.</p>
          <h3>Exemple : le circuit de six coureurs</h3>
          ${r6Table("CN", [["Score officiel", (i, tm) => n0(r6.off / tm)], ["Score Top (forêt)", (i, tm) => n0(r6.topFor / tm)]])}
          <p>F s'est perdu : 90 minutes pour un coureur de CN 5 000, alors que C, du même CN, a mis 62 minutes. E, le plus faible, a été un peu lent.
            La règle de la FFCO mesure le circuit sur les quatre plus rapides, A à D : la valeur est ${n0(r6.off)}, et A, qui a couru sans faute, marque
            ${n0(r6.off / 50)}, presque son CN. La méthode Top mesure le circuit sur les six coureurs, F compris : la valeur passe à ${n0(r6.topFor)}, et A
            marque ${n0(r6.topFor / 50)}. Ce circuit a coûté cher à un coureur sur six ; celui qui l'a couru sans faute en est récompensé.</p>
          <p>Sur un vrai circuit de plusieurs dizaines de coureurs, une seule erreur pèse bien moins, et le recalage ramène le niveau général à 5 600. Ce
            qui compte, c'est la différence entre les circuits : sur un circuit où beaucoup de coureurs se trompent, la valeur monte plus que sur un circuit
            sans piège.</p>
        </section>
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">Ce qui limitait la méthode</p>
          <h2>Les deux tiers les plus rapides laissent de côté les coureurs qui se sont trompés</h2>
          <p>Le dernier tiers d'un circuit réunit des coureurs plus faibles, qui ont couru à leur niveau, comme E, et des coureurs qui se sont trompés, comme F.
            En les écartant, la règle de la FFCO mesure la difficulté du circuit couru presque sans erreur. Or certains circuits provoquent bien plus d'erreurs
            que d'autres. Sur un circuit piégeux, la valeur sort donc trop basse par rapport à sa vraie difficulté, et tous les scores de la course avec elle.
            Le coureur qui a fait les erreurs habituelles de ce circuit marque sous son niveau ; celui qui a évité les pièges marque au-dessus, mais moins qu'il
            ne le mériterait.</p>
          <p>Mesurée sur tout le peloton, la valeur tient compte des erreurs que le circuit provoque d'ordinaire. Faire les erreurs habituelles donne alors
            son niveau, et les éviter rapporte nettement plus : bien s'orienter est récompensé là où cela fait la différence.</p>
          ${S ? html`${fig("fig-trunc", html`<b>Pour chaque circuit</b> de 2012 à 2026 (au moins 6 classés ayant un CN) : de combien la valeur mesurée sur tout
            le peloton dépasse la valeur mesurée sur les deux tiers les plus rapides. En forêt, elle la dépasse de ${fmt(100 * (tru("For").mean - 1), 1)} % en
            moyenne, mais très inégalement : presque pas sur un circuit sur dix, plus de ${fmt(100 * (tru("For").p90 - 1), 0)} % sur un autre sur dix. En
            sprint, l'écart moyen est de ${fmt(100 * (tru("Spr").mean - 1), 1)} %. L'écart est d'autant plus grand que les temps du circuit sont dispersés :
            c'est la part des erreurs.`)}` : noStudy}
          <p>C'est ce défaut que l'exposant compensait en partie quand il s'appliquait à la difficulté du circuit : une moyenne quadratique ou cubique des
            produits CN × temps donne plus de poids aux grands produits, donc aux coureurs qui se sont trompés.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">La correction</p>
          <h2>Tout le peloton, en moyenne géométrique</h2>
          <p><b>Pourquoi la moyenne géométrique.</b> Les temps se comparent en proportion. Un coureur qui met deux fois plus de temps que prévu s'est
            trompé, en proportion, autant qu'un coureur qui met deux fois moins de temps que prévu a réussi. Prenons un circuit où un coureur d'un niveau
            donné met normalement 60 minutes, et deux coureurs de ce niveau : l'un met 30 minutes, l'autre 120. Les deux écarts devraient s'annuler.</p>
          <ul class="mx-list">
            <li><span>La <b>moyenne arithmétique</b>, la moyenne ordinaire, donne (30 + 120) ÷ 2 = 75 minutes. Le circuit paraît 25 % plus dur qu'il n'est,
              parce que le coureur lent pèse plus que le rapide.</span></li>
            <li><span>La <b>moyenne géométrique</b> donne √(30 × 120) = 60 minutes. Les deux écarts s'annulent, et le circuit garde sa vraie difficulté.</span></li>
          </ul>
          <p>Avec la moyenne géométrique, un coureur très perdu compte, mais il ne peut pas emporter à lui seul la valeur du circuit. Dans l'exemple des six
            coureurs, la moyenne arithmétique des six produits donnerait ${n0(r6.arithAll)}, et la moyenne géométrique donne ${n0(r6.topFor)}.</p>
          <p><b>Ce qu'ont donné les mesures</b> (écarts de la part des duels bien prédits, en points, face au Top quadratique publié jusqu'au 13 octobre ;
            le niveau habituel et le CN Top en moyenne cubique, comme le 13 octobre) :</p>
          <ul class="mx-list">
            <li><span>Avec la moyenne géométrique, tout le peloton gagne ${pts(kpt("For", "gall", 3))} en forêt, et ${pts(kpt("For", "gall", 3, "nat_holdout"))}
              sur les courses nationales.</span></li>
            <li><span>Avec la moyenne arithmétique, tout le peloton gagne aussi sur l'ensemble des courses, mais rien sur les courses nationales
              (${pts(kpt("For", "aall", 2, "nat_holdout"))}, contre ${pts(kpt("For", "gall", 2, "nat_holdout"))} avec la moyenne géométrique, au même réglage).</span></li>
            <li><span>N'écarter que les 15 % les plus lents, ou atténuer le poids des temps aberrants par une autre méthode statistique (dite de Huber), fait
              moins bien que tout le peloton, d'environ 0,1 point. Les erreurs font partie du circuit.</span></li>
            <li><span>En sprint, où les erreurs sont deux fois moins fréquentes, tout le peloton fait moins bien (${pts(kpt("Spr", "gall", 3))}) que les deux
              tiers les plus rapides en moyenne géométrique (${pts(kpt("Spr", "g23", 3))}). Le sprint garde donc les deux tiers, en moyenne géométrique.</span></li>
          </ul>
          ${S ? fig("fig-k", html`<b>Gain en duels bien prédits face au Top quadratique</b>, en points (2012–2024), selon la puissance de la moyenne qui fait le
            CN (1 : ordinaire, 2 : quadratique, 3 : cubique, 4) et selon la façon de mesurer le circuit ; les traits verticaux sont les intervalles à 95 % ;
            cerclé, le choix du 13 octobre, que garde le niveau habituel.
            <span class="mx-legend" style="display:inline-flex;margin-left:8px"><span><i style="background:var(--forest)"></i>géométrique, tout le peloton</span>
            <span><i style="background:var(--ink);border-top:2px dashed var(--ink);height:0"></i>géométrique, deux tiers</span><span><i style="background:var(--ink-3)"></i>arithmétique, tout le peloton</span>
            <span><i style="background:var(--flag)"></i>exposant sur le temps, règle FFCO</span><span><i style="background:var(--water)"></i>puissance sur le CN seul, règle FFCO</span></span>`) : ""}
          <div class="filters" id="fig-k-scope" style="margin-top:-8px"></div>
        </section>
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">14 octobre 2026</p>
          <h2>Une seule méthode pour les quatre spécialités</h2>
          <p>Jusqu'au 14 octobre, le VTT et le ski mesuraient leurs circuits avec la règle de la FFCO (la moyenne arithmétique des deux tiers les plus
            rapides), leur niveau habituel était une moyenne quadratique, et leur recalage n'était pas prolongé. Depuis, les quatre spécialités suivent les
            mêmes formules. Seuls trois réglages changent : les courses prises en compte et la part des meilleurs scores, parce que le VTT et le ski ont bien
            moins de courses, et la part du peloton qui mesure le circuit.</p>
          <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Courses prises en compte</th>
          <th class="r">Meilleurs scores regardés</th><th>Coureurs qui mesurent le circuit</th></tr></thead>
          <tbody>${windows.map(([tr, w, f, , , sf]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>${w === 365 ? "les 12 derniers mois" : `les ${fmt(Math.round(w / 365))} dernières années`}</td>
            <td class="r">les ${pctOf(f)} meilleurs</td><td>${sf >= 1 ? "tout le peloton classé" : "les deux tiers les plus rapides"}</td></tr>`)}</tbody></table></div>
          ${S?.unify ? html`<p>Pour le VTT, la règle commune coûte ${pts(S.unify.U1.VTT.all_holdout.acc)} de duels bien prédits face à sa règle précédente
            (2012–2024) : une perte faible, acceptée pour que la méthode soit la même partout. Le ski a trop peu de courses pour être mesuré.</p>
          <h3>Pourquoi tout le peloton en forêt seulement ?</h3>
          <p>Mesurer chaque circuit sur tout le peloton a été essayé dans chaque spécialité, avec le CN Top d'aujourd'hui, face aux deux tiers les plus
            rapides :</p>
          <div class="table-wrap"><table class="data compact"><thead><tr><th>Tout le peloton contre les deux tiers</th><th class="r">Duels, 2012–2024</th>
            <th class="r">Duels, depuis juillet 2025</th><th>Saison par saison</th></tr></thead><tbody>
            <tr><td>Forêt</td><td class="r num">environ +0,6</td><td class="r num">environ +0,5</td><td>mieux à chaque saison sauf la première</td></tr>
            <tr><td>Sprint</td><td class="r num">${ci(S.unify.U2.Spr.all_holdout.acc)}</td><td class="r num">${ci(S.unify.U2.Spr.all_tuned.acc)}</td>
              <td>moins bien à ${fmt(S.unify.U2.Spr.worse)} saisons sur ${fmt(S.unify.U2.Spr.seasons)}, mieux à aucune</td></tr>
            <tr><td>VTT</td><td class="r num">${ci(S.unify.U2.VTT.all_holdout.acc)}</td><td class="r num">${ci(S.unify.U2.VTT.all_tuned.acc)}</td>
              <td>mieux jusqu'en 2021, moins bien à chaque saison depuis 2022</td></tr>
          </tbody></table></div>
          <p class="muted" style="font-size:13px">Écarts de la part des duels bien prédits, en points, avec leur intervalle à 95 %. En forêt, l'écart vient de
            l'étude du 13 octobre, à moyennes égales par ailleurs.</p>
          <p>En forêt, c'est le plus grand gain de toute l'étude, à presque chaque saison. Les erreurs y sont fréquentes, et leur nombre varie beaucoup d'un
            circuit à l'autre : en tenir compte fait partie de la mesure de la difficulté. En sprint, les erreurs sont deux fois moins fréquentes et varient
            moins d'un circuit à l'autre ; les coureurs les plus lents ajoutent alors plus d'incertitude qu'ils n'apportent d'information, et tout le peloton
            fait moins bien à presque chaque saison. En VTT, tout le peloton a fait mieux jusqu'en 2021, puis moins bien à chaque saison depuis 2022, sans que
            la cause soit établie ; c'est la période récente qui compte pour un classement d'aujourd'hui. La part du peloton reste donc un réglage propre à
            chaque spécialité.</p>` : ""}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Les jeunes</p>
          <h2>À leur place face aux H/D 21</h2>
          <p>Un CN juste ne doit favoriser aucun groupe. Pour le vérifier, on cherche, pour les jeunes (20 ans et moins) et pour les vétérans (55 ans et plus),
            de combien il faudrait corriger leur CN pour qu'il prédise au mieux leurs duels contre les H/D 21. Une correction de +3 % veut dire que le groupe
            gagne ses duels comme si son CN était 3 % plus haut : il est sous-évalué de 3 %. Une correction négative veut dire qu'il est surévalué.</p>
          ${S ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th></th><th></th><th class="r">${methodShort("official")}</th><th class="r">Top quadratique</th><th class="r">Méthode retenue</th></tr></thead>
            <tbody>${[["For", "Forêt", "G4_t"], ["Spr", "Sprint", "G1_t"]].flatMap(([tr, name, cand]) => [["young", "jeunes"], ["old", "vétérans"]].map(([g, gl]) => html`<tr><td>${name}</td><td>${gl}</td>
              ${["official", "Q_t", cand].map((m) => html`<td class="r num">${pctCi(calib(tr, g, m))}</td>`)}</tr>`))}</tbody></table></div>
          <p class="muted" style="font-size:13px">2012–2026, avec l'intervalle à 95 %. La correction est estimée par une régression logistique sur l'écart
            de CN des deux coureurs.</p>` : noStudy}
          <p>En forêt, toutes les méthodes sous-évaluaient les jeunes. Leurs circuits provoquent beaucoup d'erreurs, et la mesure sur les deux tiers les plus
            rapides les rendait trop faciles. Avec tout le peloton, les jeunes sont à leur place. Les vétérans restent surévalués de 8 à 9 % par toutes les
            méthodes, la méthode officielle comprise. La cause n'est donc pas la mesure du circuit ; ce peut être un niveau qui baisse pendant les 12 mois
            pris en compte, ou des CN acquis surtout entre vétérans. Cela demanderait une étude à part.</p>
        </section>
        <section class="mx-slide" style="--c:var(--bad)">
          <p class="mx-kicker">Mesurée en octobre 2026, puis écartée</p>
          <h2>Une moyenne quadratique sur les deux tiers</h2>
          <p>Avant de prendre tout le peloton, une autre piste avait été essayée : garder les deux tiers les plus rapides, mais remplacer la moyenne ordinaire
            par la moyenne quadratique, qui donne plus de poids aux grands produits. Elle bousculait les classements (61 places gagnées ou perdues en médiane,
            contre 15), resserrait l'écart entre forts et faibles, et surévaluait davantage les vétérans, sans corriger le vrai défaut : les deux tiers
            eux-mêmes.</p>
          ${more("Les mesures", html`<div class="table-wrap"><table class="data compact"><thead>
            <tr><th rowspan="2">Méthode Top</th><th class="r" colspan="2">Forêt</th><th class="r" colspan="2">Sprint</th>
              <th class="r" rowspan="2">Écart des CN<br>en forêt</th><th class="r" rowspan="2">Places gagnées ou<br>perdues (médiane, forêt)</th>
              <th class="r" rowspan="2">55 ans et plus prévus devant<br>un H/D 21 (réel : 42,9 %)</th></tr>
            <tr><th class="r">toutes</th><th class="r">nationales</th><th class="r">toutes</th><th class="r">nationales</th></tr></thead>
            <tbody>${[
              ["Moyenne ordinaire (circuit et CN)", [82.06, 82.80, 83.94, 82.18], 2.65, "—", 51.3, ""],
              ["Circuit en moyenne quadratique", [82.17, 82.76, 83.92, 82.09], 2.50, "", 52.0, ""],
              ["Circuit et CN en moyenne quadratique (7 oct.)", [82.21, 82.77, 84.04, 82.09], 2.42, "61", 52.2, ""],
              ["CN seul en moyenne quadratique (le Top du 7 au 13 octobre)", [82.12, 82.80, 84.01, 82.11], 2.57, "15", 51.4, "k2"],
            ].map(([label, acc, spread, moves, old, cls]) => html`<tr><td class="${cls}">${cls ? html`<b>${label}</b>` : label}</td>
              ${acc.map((x) => html`<td class="r num ${cls}">${fmt(x, 2)} %</td>`)}<td class="r num ${cls}">${fmt(spread, 2)}</td>
              <td class="r num ${cls}">${moves || "—"}</td><td class="r num ${cls}">${fmt(old, 1)} %</td></tr>`)}</tbody></table></div>
          <p class="muted" style="font-size:13px">Part des duels bien prédits, chaque duel compté une fois, de juillet 2025 à octobre 2026, sur les mêmes duels.
            Places gagnées ou perdues face à la version en moyenne ordinaire, au 7 octobre 2026.</p>`)}
        </section>`,

      recalage: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Une cible manquée</p>
          <h2>Le niveau publié dépassait 5 600</h2>
          <p>Chaque mois, le recalage doit ramener la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN à ${fmt(pf.anchor_target)}. En forêt, il n'y
            arrivait pas. Au 1<sup>er</sup> octobre 2026, cette moyenne valait ${S ? fmt(S.levels_pub.today.top) : "6 144"} pour le CN Top d'alors, et elle
            aurait valu ${S ? fmt(S.levels_pub.cand.top) : "6 757"} avec la méthode retenue.</p>
          <p><b>Pourquoi le niveau monte tout seul.</b> Le CN d'un coureur est fait de ses meilleures courses : il est un peu au-dessus de ses courses
            ordinaires. Les circuits suivants sont mesurés avec ces CN un peu hauts ; leurs scores sortent un peu plus hauts, et les CN qui en découlent aussi.
            Avant recalage, le niveau monte ainsi de ${S ? fmt(100 * S.levels_pub.drift.today, 2) : "0,35"} % par mois avec la mesure du circuit de la FFCO, et
            de ${S ? fmt(100 * S.levels_pub.drift.cand, 2) : "0,93"} % par mois avec celle de la méthode Top.</p>
          <p><b>Pourquoi le recalage arrivait en retard.</b> Le facteur d'un jour est calculé sur le niveau des CN mesuré avant ce jour : la moyenne des 13
            mois qui se terminent 2 mois plus tôt. Et chaque CN résume lui-même un an de courses. Au total, le facteur corrige le niveau tel qu'il était 18 à
            20 mois plus tôt. Comme le niveau monte pendant ce temps, le niveau publié dépasse la cible d'autant.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">La correction</p>
          <h2>Prolonger le niveau au rythme de sa montée, sans à-coups</h2>
          <p>Trois corrections ont été essayées, toutes calculées avec les seules données connues à la date du facteur. Le facteur doit rester régulier : un
            facteur qui fait des à-coups met les scores de deux mois voisins à des niveaux différents, et le CN prédit moins bien.</p>
          ${S ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th rowspan="2">Façon de calculer le facteur</th><th class="r" colspan="2">Méthode d'alors</th><th class="r" colspan="2">Méthode retenue</th></tr>
            <tr><th class="r">Niveau habituel</th><th class="r">CN Top</th><th class="r">Niveau habituel</th><th class="r">CN Top</th></tr></thead>
            <tbody>${S.recal.rows.map((r, i) => html`<tr class="${r.rec ? "rec" : ""}"><td>${r.rec ? html`<b>${RECAL_LABELS[i]}</b>` : RECAL_LABELS[i]}</td>
              ${[r.today.level[0], r.today.level[1], r.cand.level[0], r.cand.level[1]].map((x) => html`<td class="r num ${Math.abs(x - 5600) <= 120 ? "delta-up" : ""}">${fmt(x)}</td>`)}</tr>`)}</tbody></table></div>
          <p class="muted" style="font-size:13px">La moyenne des 20 % meilleurs CN de forêt au 1<sup>er</sup> octobre 2026, pour une cible de ${fmt(pf.anchor_target)}.
            En vert, à moins de 2 % de la cible.</p>` : noStudy}
          <ul class="mx-list">
            <li><span>Tracer une droite sur les 13 mois et la lire le jour du facteur ramène le niveau, mais coûte ${pts(vr("For", "Qn_t"))} de duels bien
              prédits. La lire six mois plus loin coûte davantage (${pts(vr("For", "Qm_t"))}), et le niveau est tombé à 5 307 en 2022, après les saisons Covid :
              une pente recalculée chaque mois fait faire des à-coups au facteur.</span></li>
            <li><span><b>La correction retenue</b> prolonge la moyenne des 13 mois au rythme moyen de la montée des dix dernières années. Ce rythme change
              très peu d'un mois à l'autre, le facteur reste régulier, et le coût est minime (${pts(vr("For", "Qe_t"))}, mesuré avec une prolongation de 7
              mois).</span></li>
            <li><span><b>Depuis le 14 octobre</b>, elle s'applique dans les quatre spécialités, et les mois se comptent au calendrier : un mois sans course garde
              le niveau du mois précédent. Avant, seuls les mois avec des courses comptaient, si bien qu'en ski, où les courses tiennent en quelques semaines
              par an, « 13 mois » couvraient des années. Comptés au calendrier, 7 mois de prolongation laissaient le niveau de forêt 2,7 % au-dessus de la
              cible ; la prolongation est donc de 10 mois, ce qui garde la forêt, le sprint et le VTT à moins de 2 % de ${fmt(pf.anchor_target)} à toutes
              les dates vérifiées, de 2018 à 2026. Le ski, avec ses quelques courses par an, ne peut pas être tenu aussi près de la cible.</span></li>
            <li><span><b>Les CN ramenés à 5 600 sont les CN Top</b>, ceux qui sont publiés, et non les niveaux habituels. En haut du classement, le CN Top dépasse
              le niveau habituel d'environ 2,5 %, puisqu'il ne garde que les meilleures courses. Au 1<sup>er</sup> octobre 2026, la moyenne des 20 % meilleurs
              CN Top vaut 5 599 en forêt, 5 511 en sprint et 5 615 en VTT.</span></li>
          </ul>
        </section>`,

      resultats: () => html`
        <section class="mx-slide mx-hero">
          <p class="mx-kicker">Le Top retenu</p>
          <h2>Contre le Top précédent, puis contre le classement officiel</h2>
          ${S ? html`<p class="mx-lead">Sur les mêmes coureurs, de ${S.holdout[0]} à ${S.holdout[1]}, la méthode du 13 octobre prédisait bien davantage
            de duels que le Top quadratique publié jusque-là : ${pts(kpt("For", "gall", 3))} de plus en forêt, avec un gain significatif à
            ${fmt(Object.values(S.seasons.For).filter((r) => r.acc[1] > 0).length)} saisons sur ${fmt(Object.keys(S.seasons.For).length)} et sur les courses
            nationales (${pts(kpt("For", "gall", 3, "nat_holdout"))}) ; ${pts(kpt("Spr", "g23", 3))} de plus en sprint. Le passage du CN Top à la moyenne
            pondérée, le 14 octobre, plus simple à comprendre, retire ${S.arith ? fmt(Math.abs(S.arith.For.all_holdout.acc[0]), 2) : "0,01"} point en forêt et
            ${S.arith ? fmt(Math.abs(S.arith.Spr.all_holdout.acc[0]), 2) : "0,10"} en sprint (voir
            <a href="#/methodes?onglet=etude&voir=score" data-tab-link="etude" data-goto="score">le score et la moyenne</a>).</p>` : ""}
        </section>
        ${S ? html`<section class="mx-slide">
          <p class="mx-kicker">Saison par saison</p>
          <h2>Contre le Top précédent</h2>
          ${fig("fig-seasons", html`<b>La méthode du 13 octobre contre le Top quadratique</b> : gain en points de duels bien prédits, saison par saison, toutes les
            courses. Le trait vertical est l'intervalle à 95 %. En vert, un gain significatif ; en rouge, une perte significative ; en gris, ni l'un ni l'autre.
            En VTT, prendre tout le peloton faisait perdre le CN Top à chaque saison depuis 2022, de façon significative de 2023 à 2026 : le VTT et le ski
            mesurent donc leurs circuits sur les deux tiers les plus rapides, comme le sprint.`)}
        </section>` : ""}
        ${ev ? html`<section class="mx-slide">
          <p class="mx-kicker">Contre le classement officiel</p>
          <h2>Sur quinze saisons qui n'ont pas servi aux réglages</h2>
          <div class="table-wrap"><table class="data compact"><thead><tr><th></th><th class="r" colspan="2">Forêt</th><th class="r" colspan="2">Sprint</th></tr>
            <tr><th></th><th class="r">${methodShort("official")}</th><th class="r">Top</th><th class="r">${methodShort("official")}</th><th class="r">Top</th></tr></thead>
            <tbody>
              <tr><td>duels bien prédits</td><td class="r num">${lvl(hf, "acc", "official")} %</td><td class="r num"><b>${lvl(hf, "acc", "top6w3")} %</b></td><td class="r num">${lvl(hs, "acc", "official")} %</td><td class="r num"><b>${lvl(hs, "acc", "top6w3")} %</b></td></tr>
              <tr><td>écarts de temps expliqués</td><td class="r num">${lvl(hf, "r2", "official")} %</td><td class="r num"><b>${lvl(hf, "r2", "top6w3")} %</b></td><td class="r num">${lvl(hs, "r2", "official")} %</td><td class="r num"><b>${lvl(hs, "r2", "top6w3")} %</b></td></tr>
              <tr><td>gain du Top en duels, toutes les courses</td><td class="r num" colspan="2">${dci(hf, "top6w3-official", "acc")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-official", "acc")}</td></tr>
              <tr><td>gain du Top en duels, courses nationales</td><td class="r num" colspan="2">${dci(hfn, "top6w3-official", "acc")}</td><td class="r num" colspan="2">${dci(hsn, "top6w3-official", "acc")}</td></tr>
              <tr><td>gain du Top en écarts de temps expliqués</td><td class="r num" colspan="2">${dci(hf, "top6w3-official", "r2")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-official", "r2")}</td></tr>
              <tr><td>saisons où le gain du Top est significatif</td><td class="r num" colspan="2">${evWins("For").join(" sur ")}</td><td class="r num" colspan="2">${evWins("Spr").join(" sur ")}</td></tr>
              ${tops.includes("top6w") ? html`<tr><td>gain du Top sur le Top linéaire, en duels</td><td class="r num" colspan="2">${dci(hf, "top6w3-top6w", "acc")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-top6w", "acc")}</td></tr>
              <tr><td>gain du Top sur le Top linéaire, en écarts de temps</td><td class="r num" colspan="2">${dci(hf, "top6w3-top6w", "r2")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-top6w", "r2")}</td></tr>` : ""}
            </tbody></table></div>
          <p class="muted" style="font-size:13px">Saisons ${ev.holdout[0]} à ${ev.holdout[1]} : ${fmt(ev.rows.For.all.holdout.comps)} compétitions en forêt et
            ${fmt(ev.rows.Spr.all.holdout.comps)} en sprint, les mêmes coureurs pour chaque méthode, chaque circuit pesant son nombre de coureurs. Les gains
            sont en points, avec leur intervalle à 95 %. Ces chiffres sont recalculés à chaque mise à jour du site.</p>
        </section>
        <section class="mx-slide" id="saisons">
          <p class="mx-kicker">Saison après saison</p>
          <h2>L'écart entre deux méthodes, chaque saison, avec sa marge</h2>
          <div class="filters" id="ev-controls"></div>
          <div class="grid grid-2" id="ev-seasons"></div>
          <p class="muted" style="font-size:13px">Chaque ligne est une saison. Le point est l'écart entre les deux méthodes, en points ; le trait est son
            intervalle à 95 %. Un point à droite de la ligne zéro est en faveur de la première méthode nommée. En vert, un écart significatif en faveur de la
            première méthode ; en rouge, en faveur de la seconde ; en gris, un écart non significatif. Seuls comptent les circuits d'au moins ${ev.min_runners}
            coureurs qui ont un CN dans chaque méthode. Avant 2026, la méthode officielle est le classement commun forêt et sprint de la FFCO.</p>
        </section>
        <section class="mx-slide" id="periodes">
          <p class="mx-kicker">Toutes les méthodes</p>
          <h2>Pendant les saisons mises de côté, et pendant la mise au point</h2>
          <div id="ev-periods"></div>
        </section>` : html`<section class="mx-slide"><p>${t("me.val.none")}</p></section>`}
        <section class="mx-slide">
          <p class="mx-kicker">Pour les coureurs</p>
          <h2>Ce qui change dans les CN</h2>
          <ul class="mx-list">
            <li><span>Par rapport au Top publié jusqu'au 13 octobre 2026, un CN de forêt change de −8 % à +6 %, et baisse de 5 % pour la moitié des coureurs,
              surtout parce que le niveau général revient à ${fmt(pf.anchor_target)}. À niveau général égal, la nouvelle méthode change un CN de 2 % en médiane,
              et la moitié des coureurs gagnent ou perdent moins de 1,7 % des places du classement. En sprint, les CN changent de moins de 1 %.</span></li>
            <li><span>L'écart entre les coureurs forts et les plus faibles change à peine. En forêt, le CN d'un coureur plus fort que 90 % des autres vaut 2,47
              fois celui d'un coureur plus fort que 10 % des autres, contre 2,60 avant ; en sprint, ce rapport reste à 1,84. Pour le classement officiel, il vaut
              3,4 en forêt et 2,4 en sprint.</span></li>
          </ul>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Accord entre méthodes</p>
          <h2>Des classements proches, pas identiques</h2>
          <p>Chaque point est un coureur au dernier classement publié : en largeur son CN officiel, en hauteur son CN dans l'autre méthode. Les points proches
            de la diagonale ont à peu près le même CN dans les deux méthodes.</p>
          <div class="filters" id="agr-filters"></div>
          <div class="grid grid-main-side" style="align-items:start">
            ${chartCard({ id: "agr", title: "Le même coureur dans deux méthodes", hint: "Chaque point est un coureur, au dernier classement publié", tall: true })}
            <section class="card"><div class="card-head"><h2>Écarts entre méthodes</h2></div><div id="agr-stats"></div>
              <div class="card-body"><p class="muted" style="font-size:13px;margin:0">Corrélation : 1 quand les deux CN sont exactement proportionnels, 0 quand
                ils n'ont aucun rapport. Écart moyen : de combien le second CN dépasse le premier, en moyenne. Écart moyen absolu : de combien les deux CN
                diffèrent en moyenne, dans un sens ou dans l'autre.</p></div></section>
          </div>
        </section>`,

      ecartes: () => html`
        <section class="mx-slide" style="--c:var(--bad)">
          <p class="mx-kicker">Mesuré, puis écarté</p>
          <h2>Les autres idées, et ce qu'elles ont donné</h2>
          <p class="mx-lead">Chaque idée a été calculée depuis 2010 sur une copie de la base de données, puis jugée comme la méthode retenue, sur les mêmes
            coureurs. Les écarts sont en points de duels bien prédits, de 2012 à 2024, face au Top quadratique publié jusqu'au 13 octobre, sauf mention
            contraire.</p>
          <ul class="mx-list bad">
            <li><span><b>Mesurer les circuits avec les CN Top</b> plutôt qu'avec le niveau habituel : une perte qui grandit au fil des saisons, et des jeunes
              surévalués (voir <a href="#/methodes?onglet=etude&voir=choix" data-tab-link="etude" data-goto="choix">les choix de base</a>).</span></li>
            <li><span><b>Une règle propre à chaque circuit pour traduire le temps en score</b>, estimée sur les temps et les CN du circuit lui-même : moins bien
              que la méthode retenue (${pts(onecn("For")?.IK_t)} en forêt, ${pts(onecn("Spr")?.IK_t)} en sprint). Sur une vingtaine de coureurs, cette estimation
              est trop incertaine.</span></li>
            <li><span><b>Donner plus de poids aux courses qui départagent mieux les coureurs</b> : pas de différence significative (${pts(onecn("For")?.IW_t)}).
              Combinée à l'idée précédente, elle gagne un peu en forêt (${pts(onecn("For")?.IKW_t)}), mais perd en sprint depuis juillet 2025
              (${pts(onecn("Spr", "all_tuned")?.IKW_t)}). Les formats diffèrent peu : une longue distance départage les coureurs à peine mieux qu'une moyenne
              distance.</span></li>
            <li><span><b>Un score qui pénalise moins les très grosses pertes de temps</b> : ${pts(vr("For", "c30_t"))} en forêt, mais ${pts(vr("Spr", "c30_t"))}
              en sprint.</span></li>
            <li><span><b>Le niveau estimé par un modèle statistique</b> qui sépare la forme du jour et les erreurs : meilleur en sprint
              (${S ? sg(S.mle_fit.Spr[0], 2) : "+0,37"} point), nettement moins bon en forêt (${S ? sg(S.mle_fit.For[0], 2) : "−1,62"} point).</span></li>
            <li><span><b>Une moyenne quadratique sur les deux tiers</b> (7 octobre 2026) : elle bousculait les classements sans corriger le vrai défaut (voir
              <a href="#/methodes?onglet=etude&voir=circuit" data-tab-link="etude" data-goto="circuit">la valeur du circuit</a>).</span></li>
            <li><span><b>La moyenne géométrique sur les deux tiers seulement</b>, en forêt : ${pts(kpt("For", "g23", 1))}. Les deux tiers ont déjà écarté les
              temps très longs que la moyenne géométrique aurait atténués ; il ne reste que le défaut des deux tiers.</span></li>
            <li><span><b>Une moyenne intermédiaire entre l'arithmétique et la quadratique</b>, sur tout le peloton : irrégulière sur les courses nationales
              (${pts(vr("For", "E6_t", "nat_holdout"))}).</span></li>
            <li><span><b>Les 85 % les plus rapides, ou une méthode qui atténue les temps aberrants</b> (dite de Huber), au lieu de tout le peloton : environ
              0,1 point de moins.</span></li>
            <li><span><b>Une moyenne de puissance 4 pour le CN</b> : un peu mieux que la moyenne cubique sur l'ensemble des courses de forêt, mais une perte sur les
              courses nationales (voir <a href="#/methodes?onglet=etude&voir=score" data-tab-link="etude" data-goto="score">le score et la moyenne</a>).</span></li>
            <li><span><b>Tout le peloton en sprint</b> (${pts(kpt("Spr", "gall", 3))}) <b>et en VTT</b>, où le CN Top y perdait depuis 2022.</span></li>
            <li><span><b>Une valeur de circuit commune aux circuits de même longueur en sprint</b> : l'allure n'est pas comparable d'un circuit à l'autre.</span></li>
            <li><span><b>Un score fondé sur l'écart au temps moyen du circuit</b>, à la façon du classement mondial de l'IOF : moins bon que le score de la FFCO.</span></li>
            <li><span><b>Dix places, 70 ou 80 % des scores, cinq ou deux courses minimum, un recalage qui réagit à ses propres effets</b> : voir
              <a href="#/methodes?onglet=etude&voir=choix" data-tab-link="etude" data-goto="choix">les choix de base</a>.</span></li>
          </ul>
        </section>`,

      conclusion: () => html`
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">La méthode retenue</p>
          <h2>En ligne depuis le 13 octobre 2026</h2>
          <ul class="mx-list">
            <li><span><b>Niveau habituel</b> : pour chaque coureur, 15 jours avant la course, la moyenne cubique de ses ${pctOf(pf.eligible_fraction)} meilleurs
              scores Top des 12 derniers mois, chacun selon son poids, sans limite de places (en VTT et en ski : 70 % des scores, sur deux et trois ans). Ce
              n'est pas un classement, mais une étape du calcul de la valeur des circuits.</span></li>
            <li><span><b>Valeur du circuit</b> : en forêt, la moyenne géométrique des produits niveau habituel × temps de tous les coureurs classés qui ont un
              niveau (au moins ${fmt(pf.min_ranked)}). En sprint, en VTT et en ski, la même moyenne sur les deux tiers les plus rapides.</span></li>
            <li><span><b>Score Top</b> : la valeur du circuit divisée par le temps, multipliée par le facteur de recalage du jour, et fixée une fois pour toutes.
              Un poinçon manquant, un abandon, une disqualification ou un hors-délai donnent 0, qui compte.</span></li>
            <li><span><b>CN Top</b> : les meilleurs scores Top, parmi les ${pctOf(pf.eligible_fraction)} meilleurs des 12 derniers mois, remplissent
              ${fmt(p6.top_n)} places : ${fmtW(pf.weights.cdf)} pour un championnat de France, ${fmtW(pf.weights.national)} pour une course nationale,
              ${fmtW(pf.weights.other)} pour une autre course. Le CN Top est la moyenne pondérée des scores retenus, chacun compté autant de fois qu'il a de
              places : la moyenne cubique, très légèrement plus précise, a été écartée parce qu'elle est bien plus difficile à comprendre et à interpréter.
              Il faut au moins ${fmt(pf.min_scores)} courses.</span></li>
            <li><span><b>Recalage</b> : chaque jour, un facteur maintient à ${fmt(pf.anchor_target)} la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN Top
              de chaque spécialité. Il est calculé sur le niveau mesuré deux mois plus tôt, en moyenne sur 13 mois, prolongé de 10 mois au rythme de la montée
              des dix dernières années, dans les quatre spécialités ; les mois se comptent au calendrier.</span></li>
          </ul>
          <p>Les règles complètes sont dans l'onglet <a href="#/methodes?onglet=top" data-tab-link="top">CN Top</a>.</p>
          <p><a class="mx-dl" href="${PDF}" download>⬇ Télécharger l'étude en PDF (livre blanc)</a></p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Quelle méthode pour quoi ?</p>
          <h2>Conclusion</h2>
          <div class="mx-verdict">
            <div class="mx-box" style="${cvar("top6w3")}"><h3>Classer, qualifier, sélectionner</h3>
              <div class="who">${cnLabel("top6w3")}</div>
              <p>Ce dont le coureur est capable à son meilleur, nourri par les grandes compétitions ; une fois ses 6 places remplies, une course de plus ne
                le fait pas baisser.</p></div>
            <div class="mx-box" style="${cvar("top6w3")}"><h3>Prédire qui finira devant</h3>
              <div class="who">${cnLabel("top6w3")}</div>
              <p>Nettement devant la méthode officielle : plus de 2 points de duels bien prédits de plus, en forêt comme en sprint.</p></div>
            <div class="mx-box" style="${cvar("official")}"><h3>Mesurer la difficulté d'un circuit</h3>
              <div class="who">Les scores déjà courus</div>
              <p>Le niveau habituel des coureurs présents, tiré de leurs courses précédentes, sur tout le peloton en forêt, sans la limite de places qui
                fausserait la mesure.</p></div>
            <div class="mx-box" style="${cvar("official")}"><h3>Faire foi</h3>
              <div class="who">${cnLabel("official")}</div>
              <p>Le seul classement officiel, celui des sélections, quelles que soient ses limites.</p></div>
          </div>
          <p class="muted" style="font-size:13px;margin-top:14px">Les données proviennent du site du classement national de la FFCO ; une course absente, mal
            saisie ou corrigée ensuite peut expliquer un écart. Les méthodes calculées par le site partent des CN de 2010 : leurs premiers mois reflètent
            surtout ce point de départ. Leurs CN ne remplacent en aucun cas le classement officiel.</p>
        </section>`,
    };
    return buildChapters(STUDY_CHAPTERS, CH, "objectifs");
  }

  /** A panel with chapters: the sub-tab bar, then every chapter's content in its own panel (the others hidden). */
  function buildChapters(chapters, CH, first) {
    return raw(subTabs(chapters, first).s.replace(/<div data-subpanel="([a-z]+)"( hidden)?><\/div>/g, (m0, k, hid) =>
      `<div data-subpanel="${k}"${hid || ""}>${CH[k]().s}</div>`));
  }

  // ======================================================================================================
  // 4. Les calculs du site
  // ======================================================================================================
  function calculs() {
    const CH = {
      clubs: () => html`
        <section class="mx-slide" id="clubs">
          <p class="mx-kicker">Clubs</p>
          <h2>Classements des clubs</h2>
          <p>Un club se classe selon deux choix indépendants, sur les coureurs d'un sexe et d'une tranche d'âge donnés (jeunes : jusqu'à H/D 20 ;
            adultes : H/D 21 et plus ; élite : H/D 21 seulement).</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>Ce que l'on compte</h3><p>Le <b>CN</b> de chaque coureur classé, dans la méthode choisie, ou ses
              <b>points en courses nationales</b>.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>Comment on l'additionne</h3><p>La <b>somme</b>, qui mêle le nombre de coureurs et leur niveau ; la
              <b>moyenne</b>, le niveau du coureur moyen ; le <b>top 5</b>, la moyenne des cinq meilleurs, un coureur manquant comptant 0 ; ou l'<b>effectif</b>.</p></div>
          </div>
        </section>
        <section class="mx-slide" id="elite">
          <p class="mx-kicker">Clubs</p>
          <h2>Points en courses nationales</h2>
          <p>Ces points ne dépendent d'aucune méthode de CN : ils reposent sur les places. Aux courses de niveau national (championnats de France,
            nationales, courses de sélection, soit les groupes A et B1), les 10 premiers de chaque catégorie marquent 25, 18, 15, 12, 10, 8, 6, 4, 2 et 1
            points. Les points sont <b>doublés aux championnats de France</b>. Une catégorie est rattachée au circuit où la plupart de ses coureurs ont
            couru. La page des clubs compte les points des 12 mois qui précèdent la date choisie ; la comparaison de clubs les montre saison par saison.</p>
        </section>
        <section class="mx-slide" id="cfc">
          <p class="mx-kicker">Clubs</p>
          <h2>Coupe de France des clubs</h2>
          <p>Le site applique à chaque saison la règle 2026 de la FFCO (« Classement national des clubs », annexe 2). Pour chaque coureur, on prend ses
            5 meilleurs scores officiels de l'année à pied et ses 5 meilleurs en VTT ou en ski ; les points des dames sont multipliés par 1,4 ; le club
            additionne les points de ses coureurs. Ce calcul n'est pas officiel : tous les coureurs classés comptent, car le site ne connaît pas le type de
            licence, et le club d'un coureur est celui de sa dernière course de l'année. La coupe n'a pas été décernée de 2023 à 2025.</p>
        </section>`,
      coureurs: () => html`
        <section class="mx-slide" id="progression">
          <p class="mx-kicker">Coureurs</p>
          <h2>Progression par âge</h2>
          <p>Pour chaque saison et chaque catégorie (H14, D21, H45…), le site prend les CN de tous les coureurs classés à la fin de la saison et regarde
            comment ils se répartissent : la médiane, et les zones où se trouvent la moitié et les quatre cinquièmes des coureurs. Chaque mois, le CN d'un
            coureur est situé dans cette répartition : son <b>centile</b> est la part des coureurs de sa catégorie qui ont un CN inférieur ou égal. Un
            coureur au 90<sup>e</sup> centile fait mieux que 90 % de sa catégorie. La courbe « toutes saisons » regroupe les saisons depuis 2012 : c'est
            une photographie de l'ensemble des coureurs, pas le suivi d'une même génération.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Coureurs</p>
          <h2>La page d'un coureur</h2>
          <ul class="mx-list">
            <li><span><b>Calcul du CN</b> : à n'importe quelle date, les courses des 12 derniers mois, celles qui comptent et le CN qui en sort, refait
              exactement, avec les mêmes arrondis et la même règle des places, à partir des scores publiés course par course.</span></li>
            <li><span><b>Historique du CN</b> : chaque course qui entre dans les 12 derniers mois et chaque course qui en sort, avec le CN qui en résulte et sa
              variation. Pour le CN officiel, c'est l'historique publié par la FFCO, lu en direct.</span></li>
            <li><span><b>Progression</b> : le CN mois par mois, puis la place du coureur dans sa catégorie d'âge. Après un changement de méthode, la méthode
              précédente reste affichée en gris le temps de la visite.</span></li>
            <li><span><b>Carte</b> : les courses par département. <b>Saisons</b> : le bilan de chaque saison. <b>Réseau</b> : les coureurs rencontrés.</span></li>
          </ul>
        </section>`,
      reseau: () => html`
        <section class="mx-slide" id="reseau">
          <p class="mx-kicker">Réseau</p>
          <h2>Qui court avec qui</h2>
          <p>Deux coureurs se « rencontrent » quand ils courent le même circuit. Sur toutes les saisons, le site retient pour chaque coureur les 30 coureurs
            qu'il a rencontrés le plus souvent, au moins 2 fois ; pour une saison, il les recalcule avec les résultats de cette saison. Il compte aussi combien
            de fois chacun a terminé devant l'autre. Un coureur non classé (poinçon manquant, abandon…) est derrière tous les classés.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Statistiques</p>
          <h2>Territoires, participation, âges</h2>
          <ul class="mx-list">
            <li><span><b>Territoires</b> : le nombre de compétitions organisées, de coureurs, et de compétitions pour 100 coureurs, par ligue ou par
              département. Une compétition est rattachée à son organisateur : le club (les deux premiers chiffres de son numéro donnent le département), le
              comité départemental ou la ligue.</span></li>
            <li><span><b>Participation</b> : les grands chiffres saison par saison, pour tous, pour une ligue ou pour un club, dans une spécialité ou dans
              toutes.</span></li>
            <li><span><b>Âges</b> : la répartition des coureurs entre les catégories d'âge, dames à gauche, hommes à droite, en part de l'ensemble choisi.</span></li>
          </ul>
        </section>`,
      resultats: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Résultats</p>
          <h2>Scores et CN provisoires</h2>
          <p>Les organisateurs publient leurs résultats le jour de la course ou le lendemain, plusieurs jours avant la FFCO. Le site les collecte (plateformes
            de résultats, site du club, fichiers déposés par les utilisateurs), reconnaît les coureurs par leur nom et leur club, et calcule des scores
            provisoires avec les règles de chaque méthode.</p>
          <ul class="mx-list">
            <li><span><b>Officiel</b> : le CN officiel de chaque coureur reconnu, 15 jours avant la course, et la règle de la FFCO (moyenne ordinaire sur les deux
              tiers les plus rapides).</span></li>
            <li><span><b>Top</b> : le niveau habituel de chaque coureur reconnu, 15 jours avant la course, la mesure du circuit de la méthode Top (moyenne
              géométrique, tout le peloton en forêt), et le facteur de recalage du jour. Le CN Top provisoire après la course suit la règle des places.</span></li>
            <li><span>Seules les listes <b>par circuit</b> sont notées. Une liste par catégorie l'est circuit par circuit une fois qu'on sait quelles catégories
              couraient sur quel circuit (d'après les listes par circuit de la même course, la liste d'inscription de la FFCO ou l'annonce de course). Les
              coureurs non reconnus restent sans CN.</span></li>
            <li><span>Ces valeurs sont provisoires jusqu'à la publication par la FFCO : les valeurs définitives peuvent différer, si des résultats sont corrigés
              ou des coureurs ajoutés.</span></li>
          </ul>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Temps intermédiaires</p>
          <h2>Le temps perdu et les erreurs</h2>
          <ul class="mx-list">
            <li><span>Sur chaque tronçon entre deux postes, le <b>temps perdu</b> est l'écart entre le temps du coureur et le temps que son allure habituelle
              sur cette course laissait prévoir. Il est négatif quand le coureur va plus vite que d'habitude.</span></li>
            <li><span>Une <b>erreur</b> est un tronçon où le coureur a perdu au moins 20 % du temps du tronçon <b>et</b> au moins 10 secondes ; les deux seuils se
              règlent. Les colonnes « Perdu » et « Sans temps perdu » ne comptent que les erreurs.</span></li>
            <li><span>Les <b>écarts</b> se mesurent au « superman », un coureur imaginaire qui aurait le meilleur temps sur chaque tronçon, parmi tous les
              coureurs ou parmi ceux que l'on compare.</span></li>
            <li><span>Les <b>groupes</b> repèrent les coureurs qui passent aux mêmes postes à quelques secondes d'intervalle, poste après poste.</span></li>
          </ul>
        </section>`,
      relais: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Relais</p>
          <h2>Le simulateur de relais</h2>
          <ul class="mx-list">
            <li><span><b>Le modèle</b> : le temps d'un coureur sur un relais est inversement proportionnel à son CN. Un coureur de CN deux fois plus haut met
              deux fois moins de temps. Le temps de référence de chaque relais est calé pour que la meilleure équipe de tous les clubs réalise exactement la
              somme des temps de référence du format (en CNE, la moyenne des 5 meilleures équipes).</span></li>
            <li><span><b>Les formats</b> suivent les règles 2026 de la FFCO : CFC N1 à N4 avec leurs conditions de composition et leurs relais réservés (les
              premiers et derniers relais dames et hommes alternent selon que l'année est paire ou impaire), CNE hommes, dames, jeunes et mini, relais de
              catégorie, relais sprint (2 dames, 2 hommes, dans l'ordre D-H-H-D). On peut aussi composer son propre format.</span></li>
            <li><span><b>La meilleure équipe est la vraie meilleure</b> : le site essaie toutes les façons de répartir les conditions entre les relais, puis
              choisit les coureurs par une méthode exacte d'affectation (l'algorithme hongrois). L'âge et le sexe viennent de la catégorie : un vétéran qui
              court en H21 compte comme un H21. On peut modifier la première équipe coureur par coureur, et ajouter les coureurs qui n'ont pas de CN
              (étrangers, coureurs de relais seulement) avec le CN qu'on leur prête.</span></li>
          </ul>
        </section>`,
      limites: () => html`
        <section class="mx-slide" id="limites">
          <p class="mx-kicker">À garder en tête</p>
          <h2>Limites et précautions</h2>
          <ul class="mx-list bad">
            <li><span>Les données proviennent du site du classement national de la FFCO. Une course absente, mal saisie ou corrigée ensuite peut expliquer un
              écart.</span></li>
            <li><span>Les méthodes calculées par le site partent des CN de 2010 ; leurs premiers mois reflètent surtout ce point de départ.</span></li>
            <li><span>Leurs CN ne remplacent en aucun cas le classement officiel, qui reste la seule référence.</span></li>
            <li><span>Les classements mensuels sont calculés en fin de mois ; la page d'un coureur détaille le calcul à n'importe quelle date.</span></li>
            <li><span>Les résultats provisoires sont ceux des organisateurs, avant toute correction de la FFCO.</span></li>
          </ul>
        </section>`,
    };
    return buildChapters(SITE_CHAPTERS, CH, "clubs");
  }

  // ---- charts, drawn when their tab is first shown -------------------------------------------------------
  function drawNorm() {
    if (!$("#norm", main)) return;
    bindChartCard(main, "norm");
    const norm = TERRAINS.filter((tr) => meta.normalisation[tr]).map((tr) => ({
      name: t(`terrain.${tr}`), color: terrainColor(tr),
      data: meta.normalisation[tr].map(([d, f]) => [d, Number(f.toFixed(4))]),
    }));
    $("#norm-legend").innerHTML = legend(norm.map((s) => ({ label: s.name, color: s.color })));
    timeChart($("#norm"), { series: norm, yName: t("calc.factor"), zoom: false, digits: 3 });
    const idx = norm.map((s) => new Map(s.data));
    const dates = [...new Set(norm.flatMap((s) => s.data.map((p) => p[0])))].sort().reverse();
    $("#norm-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.date")}</th>
      ${norm.map((s) => html`<th class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${dates.map((d) => html`<tr><td>${d}</td>${idx.map((m) => html`<td class="r num">${fmt(m.get(d), 4)}</td>`)}</tr>`)}</tbody></table>`;
  }
  // how far the methods agree, per discipline: each visible computed method against the official one.
  // meta.agreement rows: [official, fair, top6w, fair3, top6w3]
  const AGREE_COL = { fair: 1, top6w: 2, fair3: 3, top6w3: 4 };
  const computed = M.filter((m) => m !== "official");     // never the Fits (M excludes them)
  let agTerrain = "For";
  function drawAgreement() {
    if (!$("#agr-filters", main)) return;
    $("#agr-filters").innerHTML = html`<div class="field"><span>${t("f.terrain")}</span>${seg("agt", TERRAINS.filter((x) => meta.agreement[x]?.length).map((x) => [x, t(`terrain.${x}`)]), agTerrain)}</div>`;
    $$('[data-seg="agt"]').forEach((b) => b.addEventListener("click", () => { agTerrain = b.dataset.value; drawAgreement(); }));
    const pts = meta.agreement[agTerrain] || [];
    const series = computed.map((m) => ({
      m, name: methodShort(m), color: methodColor(m),
      data: pts.filter((p) => p[0] && p[AGREE_COL[m]]).map((p) => [p[0], p[AGREE_COL[m]]]),
    }));
    const max = Math.ceil(Math.max(0, ...pts.flat().filter(Boolean)) / 1000) * 1000;
    $("#agr-legend").innerHTML = legend(series.map((s) => ({ label: `${s.name} / ${methodShort("official")}`, color: s.color, dot: true })));
    scatterChart($("#agr"), { series, xName: methodLabel("official"), yName: "CN", max });
    const stat = (name, pairs) => {
      const d = pairs.map((p) => p[1] - p[0]);
      return { name, n: pairs.length, r: pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])), bias: mean(d), mae: mean(d.map(Math.abs)) };
    };
    const vs = (a, b) => stat(`${methodShort(b)} / ${methodShort(a)}`,
      pts.filter((p) => p[AGREE_COL[a]] && p[AGREE_COL[b]]).map((p) => [p[AGREE_COL[a]], p[AGREE_COL[b]]]));
    const stats = [
      ...series.map((x) => stat(`${x.name} / ${methodShort("official")}`, x.data)),
      ...(computed.includes("top6w") && computed.includes("top6w3") ? [vs("top6w", "top6w3")] : []),
    ];
    $("#agr-stats").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>Méthodes comparées</th><th class="r">Coureurs</th><th class="r">Corrélation</th><th class="r">Écart moyen</th><th class="r">Écart moyen absolu</th></tr></thead>
      <tbody>${stats.map((s) => html`<tr><td>${s.name}</td><td class="r num">${fmt(s.n)}</td>
        <td class="r num">${fmt(s.r, 3)}</td><td class="r num">${fmtSigned(Math.round(s.bias))}</td><td class="r num">${fmt(s.mae)}</td></tr>`)}</tbody></table></div>`;
    $("#agr-table").innerHTML = $("#agr-stats").innerHTML;
  }
  // the evaluation's season-by-season chart: one measure, one comparison, one scope, forest and sprint side by side
  let evMeas = "acc", evPair = "top6w3-official", evScope = "all", evPeriod = "holdout";
  const EV_PAIRS = () => (analyst ? ev.pairs.filter((x) => !x.includes("fair")) : ["top6w3-official", "top6w3-top6w"]);
  function drawEval() {
    if (!ev || !$("#ev-seasons", main)) return;
    if (!EV_PAIRS().includes(evPair)) evPair = EV_PAIRS()[0];
    $("#ev-controls").innerHTML = html`
      <div class="field"><span>Mesure</span>${seg("evm", EVM.map((m) => [m, EV_LABEL[m]]), evMeas)}</div>
      <div class="field"><span>Comparaison</span>${seg("evp", EV_PAIRS().map((p) => [p, pairLabel(p)]), evPair)}</div>
      <div class="field"><span>Courses</span>${seg("evs", [["all", "toutes"], ["nat", "nationales"]], evScope)}</div>`;
    $$('[data-seg="evm"]').forEach((x) => x.addEventListener("click", () => { evMeas = x.dataset.value; drawEval(); }));
    $$('[data-seg="evp"]').forEach((x) => x.addEventListener("click", () => { evPair = x.dataset.value; drawEval(); }));
    $$('[data-seg="evs"]').forEach((x) => x.addEventListener("click", () => { evScope = x.dataset.value; drawEval(); }));
    $("#ev-seasons").innerHTML = html`${["For", "Spr"].map((tr) => {
      const rows = evRows(tr, evScope);
      const items = [...evSeasons(tr, evScope).map((y) => ({ label: y, d: rows[y].d[evPair][evMeas], n: rows[y].comps })),
        ...[["holdout", `${ev.holdout[0]}–${String(ev.holdout[1]).slice(2)}`], ["tuned", "mise au point"]]
          .filter(([k]) => rows[k]).map(([k, label]) => ({ label: html`<b>${label}</b>`, d: rows[k].d[evPair][evMeas] }))];
      const up = items.filter((i) => i.d[1] > 0).length, against = items.filter((i) => i.d[2] < 0).length;
      return html`<section class="card"><div class="card-head"><div><h2>${t(`terrain.${tr}`)} · ${pairLabel(evPair)}</h2>
        <div class="hint">${EV_LABEL[evMeas]} (écart en points)</div></div></div>
        <div class="card-body">${forestPlot(items, evMeas)}
          <p class="muted" style="font-size:12.5px;margin:8px 0 0">Écart significatif en faveur de « ${methodShort(evPair.split("-")[0])} » :
            ${fmt(up)} ligne${up > 1 ? "s" : ""} sur ${fmt(items.length)} ; en faveur de « ${methodShort(evPair.split("-")[1])} » : ${fmt(against)}.</p></div></section>`;
    })}`;
    const shown = M.filter((m) => ev.methods.includes(m));
    $("#ev-periods").innerHTML = html`
      <div class="filters"><div class="field"><span>Période</span>${seg("evq", [["holdout", `${ev.holdout[0]}–${ev.holdout[1]} (saisons mises de côté)`],
        ["tuned", "juillet 2025 – octobre 2026 (mise au point)"]], evPeriod)}</div></div>
      <div class="grid grid-2">${["For", "Spr"].map((tr) => {
        const e = evRows(tr, "all")[evPeriod], en = evRows(tr, "nat")[evPeriod];
        if (!e) return "";
        const best = (meas) => Math.max(...shown.map((m) => e[meas][m]));
        return html`<section class="card"><div class="card-head"><div><h2>${t(`terrain.${tr}`)}</h2>
          <div class="hint">${fmt(e.comps)} compétitions, ${fmt(e.circuits)} circuits, ${fmt(e.runners)} résultats</div></div></div>
          <div class="table-wrap"><table class="data compact"><thead><tr><th>Méthode</th>${EVM.map((m) => html`<th class="r">${EV_LABEL[m]}</th>`)}</tr></thead>
            <tbody>${shown.map((m) => html`<tr><td>${methodKey(m)} ${methodShort(m)}</td>${EVM.map((meas) => {
              const x = evFmt(meas, e[meas][m], false) + (meas === "r2" || meas === "acc" ? " %" : "");
              return html`<td class="r num">${e[meas][m] === best(meas) ? html`<b>${x}</b>` : x}</td>`;
            })}</tr>`)}</tbody></table></div>
          <div class="card-body"><h3 style="margin:0 0 6px;font-size:14px">Écarts, toutes les courses</h3>
            ${forestPlot(EV_PAIRS().map((p) => ({ label: pairLabel(p), d: e.d[p][evMeas] })), evMeas)}
            ${en ? html`<h3 style="margin:12px 0 6px;font-size:14px">Écarts, courses nationales (${fmt(en.comps)} compétitions)</h3>
              ${forestPlot(EV_PAIRS().map((p) => ({ label: pairLabel(p), d: en.d[p][evMeas] })), evMeas)}` : ""}
            <p class="muted" style="font-size:12.5px;margin:8px 0 0">Mesure des écarts : ${EV_LABEL[evMeas].toLowerCase()} (choisie plus haut).</p></div></section>`;
      })}</div>`;
    $$('[data-seg="evq"]').forEach((x) => x.addEventListener("click", () => { evPeriod = x.dataset.value; drawEval(); }));
  }
  // the study's figures (SVG), drawn when their chapter is first shown
  let kScope = "all_holdout";
  function drawStudyFigures(chapter) {
    if (!study) return;
    const panel = $(`[data-subpanel="${chapter}"]`, main);
    if (!panel) return;
    const at = (id) => $(`#${id}`, panel);
    if (chapter === "score") ["For", "Spr"].forEach((tr) => at(`fig-dev-${tr}`) && figDev(at(`fig-dev-${tr}`), study.fig.dev[tr], TNAME[tr]));
    if (chapter === "circuit") {
      ["For", "Spr"].forEach((tr) => at(`fig-trunc-${tr}`) && figTrunc(at(`fig-trunc-${tr}`), study.fig.trunc[tr], TNAME[tr]));
      const drawK = () => ["For", "Spr"].forEach((tr) => at(`fig-k-${tr}`) && figK(at(`fig-k-${tr}`), study.kcurves[tr], kScope, TNAME[tr]));
      const sc = at("fig-k-scope");
      if (sc) {
        sc.innerHTML = html`<div class="field"><span>Courses</span>${seg("ksc", [["all_holdout", "toutes, 2012–2024"], ["nat_holdout", "nationales, 2012–2024"], ["all_tuned", "toutes, depuis juillet 2025"]], kScope)}</div>`;
        $$('[data-seg="ksc"]', sc).forEach((b) => b.addEventListener("click", () => { kScope = b.dataset.value; $$('[data-seg="ksc"]', sc).forEach((x) => x.setAttribute("aria-pressed", String(x === b))); drawK(); }));
      }
      drawK();
    }
    if (chapter === "choix" && at("fig-onecn")) figLines(at("fig-onecn"), study.onecn_seasons.For,
      [["ST6_t", "6 places", "--bad"], ["ST10_t", "10 places", "--flag"], ["ST16_t", "16 places", "--ink-3"]], "Forêt");
    if (chapter === "resultats") ["For", "Spr"].forEach((tr) => at(`fig-seasons-${tr}`) && figSeasons(at(`fig-seasons-${tr}`), Object.fromEntries(Object.entries(study.seasons[tr]).map(([y, r]) => [y, r.acc])), TNAME[tr]));
  }
  const DRAW = { top: drawNorm, etude: () => {} };
  const DRAW_CHAPTER = { resultats: () => { drawAgreement(); drawEval(); } };
  const BUILD = { officiel, top, etude, calculs };

  // ---- tabs and chapters ------------------------------------------------------------------------------------
  const built = new Set();
  function showChapter(panel, k, instant = false) {
    $$("[data-subpanel]", panel).forEach((p) => { p.hidden = p.dataset.subpanel !== k; });
    $$("[data-subtab]", panel).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.subtab === k)));
    const key = `${panel.dataset.panel}:${k}`;
    if (!built.has(key)) {
      built.add(key);
      drawStudyFigures(k);
      if (panel.dataset.panel === "etude" && DRAW_CHAPTER[k]) DRAW_CHAPTER[k]();
    }
    if (!instant) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function show(k, goto, instant = false) {
    const panel = $(`[data-panel="${k}"]`, main);
    if (!built.has(k)) {
      built.add(k);
      panel.innerHTML = BUILD[k]();
      bindLinks(panel);
      $$("[data-subtab]", panel).forEach((b) => b.addEventListener("click", () => {
        showChapter(panel, b.dataset.subtab, true);
        replaceQuery({ onglet: k, voir: b.dataset.subtab });
      }));
      if (DRAW[k]) DRAW[k]();
    }
    $$("[data-panel]", main).forEach((p) => { p.hidden = p !== panel; });
    $$("[data-tab]", main).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    const chapters = $$("[data-subtab]", panel).map((b) => b.dataset.subtab);
    const chapter = chapters.includes(goto) ? goto : chapters.length ? ($$("[data-subpanel]", panel).find((p) => !p.hidden)?.dataset.subpanel || chapters[0]) : null;
    if (chapter) showChapter(panel, chapter, true);
    replaceQuery({ onglet: k === "officiel" ? null : k, voir: chapter || goto || null });
    const target = goto && !chapters.includes(goto) && document.getElementById(goto);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "start" }), instant ? 50 : 0);
  }
  function bindLinks(root) {
    $$("[data-tab-link]", root).forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      show(a.dataset.tabLink, a.dataset.goto);
      if (!a.dataset.goto) main.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
  }
  $$("[data-tab]", main).forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  const OLD = { essentiel: "etude", detail: "top", analyses: "etude", autres: "calculs" };     // the tabs until 2026-10-14
  const first = TABS.some(([k]) => k === query.onglet) ? query.onglet : OLD[query.onglet] || "officiel";
  show(first, query.voir, true);
  return { title: t("page.methods") };
}
