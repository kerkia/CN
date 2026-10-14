// The documentation, in four tabs (owner, 2026-10-14): « CN officiel » and « CN Top », each the method's rules and
// formulas, facts only; « L'étude », the white paper — objectives, method of evaluation, the point of departure, the
// choices, the score and its mean, the circuit's value, the recalage, the results, the alternatives discarded, the
// conclusion — with the figures that support each decision (site/assets/study.json, the study of 13 October 2026, and
// the live evaluation, site/data/evaluation.json) and the PDF; « Les calculs du site », the other calculations. The
// study and the site's calculations have chapters as a second row of tabs (?voir=). Only the methods this account sees
// are named: « Fit » is for analysts.

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
const RECAL_LABELS = ["Jusqu'au 13 octobre : la moyenne des 13 mois se terminant 2 mois plus tôt", "Une droite ajustée sur ces 13 mois, lue le jour où le facteur s'applique",
  "La même droite, lue 6 mois plus loin (le retard propre du CN)", "La moyenne de 13 mois, prolongée de 7 mois par la dérive sur 3 ans",
  "La moyenne de 13 mois, prolongée de 7 mois par la dérive sur 10 ans — retenue"];

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
  E("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: col("--ink-3") }, s, "score de la course ÷ niveau habituel du coureur (échelle log)");
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
  E("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: col("--ink-3") }, s, "valeur sur tout le peloton, au-dessus des ⅔ les plus rapides (part des circuits)");
}

const FAM_COLOR = { gall: "--forest", g23: "--ink", aall: "--ink-3", race: "--flag", pow: "--water" };
const FAM_DODGE = { gall: -0.06, g23: -0.03, aall: 0, race: 0.03, pow: 0.06 };
/** Figure: the gain in duels called right (points) against the quadratic Top by k, per family of circuit value. */
function figK(host, fams, scope, name) {
  const W = 470, H = 290, m = { l: 52, r: 12, t: 12, b: 40 };
  const s = svgIn(host, W, H, `Gain en duels bien prédits selon k, ${name}`);
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
  E("text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: col("--ink-3") }, s, "k");
  fams.forEach((f) => {
    const fp = pts.filter((p) => p.f === f).sort((a, b) => a.k - b.k);
    const c = col(FAM_COLOR[f.key]);
    if (fp.length > 1) E("polyline", { points: fp.map((p) => `${xs(p.k + FAM_DODGE[f.key])},${ys(p.a[0])}`).join(" "), fill: "none", stroke: c, "stroke-width": 2,
      ...(f.key === "g23" ? { "stroke-dasharray": "5 3" } : {}) }, s);
    fp.forEach((p) => {
      const x = xs(p.k + FAM_DODGE[f.key]);
      if (p.a[1] !== p.a[2]) E("line", { x1: x, x2: x, y1: ys(p.a[1]), y2: ys(p.a[2]), stroke: c, "stroke-width": 1.4, opacity: 0.8 }, s);
      const dot = E("circle", { cx: x, cy: ys(p.a[0]), r: 3.6, fill: c, stroke: col("--plane"), "stroke-width": 1 }, s);
      E("title", {}, dot, `${f.label}, k = ${fmt(p.k, p.k % 1 ? 2 : 0)} : ${ci(p.a)}`);
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
  const M = available();                 // display order: the Top before the Top linéaire, the Fits for analysts
  const analyst = M.includes("fair");
  const tops = M.filter((m) => m === "top6w" || m === "top6w3");
  const pctOf = (x) => `${fmt(100 * x)} %`;
  const fmtW = (w) => fmt(w, Number.isInteger(w) ? 0 : 1);
  const own = (p, tr, key) => p.by_terrain?.[tr]?.[key] ?? p[key];
  const force = analyst ? html`le niveau habituel des coureurs (le ${cnLabel("fair3")})` : html`le niveau habituel des coureurs`;
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
  const EV_LABEL = { acc: "Duels bien prédits", r2: "Écarts de temps expliqués (R²)" };
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
  const windows = TERRAINS.map((tr) => [tr, own(p3, TNAME[tr], "window_days"), own(p3, TNAME[tr], "eligible_fraction"), own(p3, TNAME[tr], "cn_power") ?? 1,
    own(p3, TNAME[tr], "cv_power") ?? 1, own(p3, TNAME[tr], "sample_fraction") ?? 2 / 3]);
  const years = (d) => (d === 365 ? "12 mois" : `${fmt(Math.round(d / 365))} ans`);
  const meanName = (q) => (q === 3 ? "cubique" : q === 2 ? "quadratique" : "simple");
  const cvName = (q, sf) => `${q === 0 ? "géométrique" : "arithmétique"}, ${sf >= 1 ? "tout le peloton classé" : "les ⌈2N/3⌉ plus rapides"}`;

  // ======================================================================================================
  // 1. CN officiel
  // ======================================================================================================
  function officiel() {
    return html`
    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">${methodKey("official")} ${methodLabel("official")}</p>
      <h2>Le score d'une course</h2>
      <div class="mx-eq">valeur du circuit = moyenne des (<i>CN J-15</i> × <i>temps</i>) des ⌈2N/3⌉ plus rapides ayant un CN
        <small>N : les coureurs classés du circuit qui ont un CN 15 jours avant la course ; s'ils ne sont que trois, les trois comptent</small></div>
      <div class="mx-eq">score = valeur du circuit ÷ <i>temps du coureur</i></div>
      <ul class="mx-list">
        <li><span>Les CN J-15 sont les CN officiels publiés quinze jours avant la course.</span></li>
        <li><span>Un poinçon manquant, un abandon, une disqualification ou un hors-délai donnent un score de 0, qui compte. Un résultat
          « non classé » (nc) ne compte nulle part.</span></li>
        <li><span>Un coefficient de 0,95 s'appliquait à la valeur des circuits en 2022 (1,00 les autres années).</span></li>
      </ul>
    </section>
    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">Le CN</p>
      <h2>La moyenne du milieu</h2>
      <div class="mx-eq">CN = moyenne des scores des 12 derniers mois, sans les 10 % meilleurs ni les 40 % moins bons
        <small>les nombres écartés sont arrondis ; la règle depuis 2026</small></div>
      <ul class="mx-list">
        <li><span>Avant 2026, seule la meilleure course était écartée.</span></li>
        <li><span>Chaque 1<sup>er</sup> janvier depuis 2026, un recalage fixe à 5 600 la moyenne des 20 % meilleurs CN de chaque spécialité, par simple
          proportionnalité. Avant, le meilleur CN était ramené à 10 000 quand il dépassait ce plafond (observé au 1<sup>er</sup> janvier 2013, 2023, 2024 et 2025).</span></li>
        <li><span>Quatre classements depuis 2026 : forêt (longue distance, moyenne distance, nuit), sprint, VTT (tous formats) et ski (tous formats).
          Avant 2026, un seul classement pédestre réunissait forêt et sprint ; le site l'affiche tel quel.</span></li>
      </ul>
    </section>
    <section class="mx-slide" style="${cvar("official")}">
      <p class="mx-kicker">Sur le site</p>
      <h2>Ce que le site reprend</h2>
      <ul class="mx-list">
        <li><span>Les CN et les scores officiels sont repris tels que publiés sur le site du classement national de la FFCO, course par course.</span></li>
        <li><span>La page d'un coureur lit en direct la page CN de la FFCO : la fédération réévalue les courses des saisons passées sous de nouveaux
          identifiants de circuit, et ses points peuvent différer de la page de résultats de la course.</span></li>
        <li><span>À côté du CN publié, la page d'un coureur présente une reconstruction indicative : la règle documentée appliquée aux scores officiels.
          Les écarts éventuels viennent de résultats absents du site ou corrigés après coup, ou des réévaluations.</span></li>
        <li><span>Le classement officiel fait foi : c'est le seul classement des sélections.</span></li>
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
      official: { cn: offCn, used: offUsed, what: html`moyenne des ${fmt(n - offDrop - offLow)} scores du milieu : sans la meilleure (10 %) ni les
        ${fmt(offLow)} moins bonnes (40 %)` },
      top6w3: { ...aggregate(p6.top_n, 3), what: html`${fmt(p6.top_n)} places remplies par les meilleures courses, chacune selon son poids, en moyenne cubique` },
      fair3: { ...aggregate(Infinity, 3), what: html`le niveau habituel : moyenne cubique pondérée des ${pctOf(pf.eligible_fraction)} meilleures, sans plafond` },
    };
    const chips = (m) => html`<div class="mx-scores">${EXAMPLE.map(([s, k], i) => {
      const u = EX[m].used[i];
      const sup = m !== "official" && u ? html`<sup>${u === W[k] && k === "other" ? "" : `×${fmtW(u)}`}</sup>` : "";
      return html`<span class="mx-sc ${u ? "on" : "off"} ${k === "cdf" ? "star" : ""}">${fmt(s)}${sup}</span>`;
    })}</div>`;
    const kindName = { cdf: "championnat de France", national: "nationale" };
    const exLabel = (m) => (m === "official" ? cnLabel("official") : m === "fair3" ? "Niveau habituel" + (analyst ? ` (${cnLabel("fair3")})` : "") : cnLabel("top6w3"));

    return html`
    <section class="mx-slide">
      <p class="mx-kicker" style="${cvar("top6w3")}">${methodKey("top6w3")} ${methodLabel("top6w3")}</p>
      <h2>Un score Top par course, un CN Top par coureur</h2>
      <p class="mx-lead">Comme le classement mondial de l'IOF sépare les points d'une course du classement des coureurs, la méthode Top
        se lit en deux temps : <b>le score Top</b>, ce que vaut la course de chaque coureur, puis <b>le CN Top</b>, ce que valent ses meilleures courses.</p>
      <div class="mx-grid">
        <div class="mx-box" style="--c:var(--s1)"><h3>Le score Top d'une course</h3>
          <p>Le niveau habituel des coureurs présents donne la valeur du circuit ; le score d'un coureur est cette valeur divisée par son temps,
            au facteur de recalage du jour, fixé une fois pour toutes.</p></div>
        <div class="mx-box" style="--c:var(--s3)"><h3>Le CN Top d'un coureur</h3>
          <p>Ses meilleurs scores Top des 12 derniers mois remplissent ${fmt(p6.top_n)} places pondérées ; le CN Top en est la moyenne cubique.</p></div>
      </div>
      <p style="margin-top:14px">En ligne depuis le 13 octobre 2026. Les choix qui y mènent et leurs mesures sont dans
        <a href="#/methodes?onglet=etude" data-tab-link="etude">l'étude</a>.</p>
    </section>

    <section class="mx-slide" style="--c:var(--s1)">
      <p class="mx-kicker">Le score Top d'une course · 1</p>
      <h2>Le niveau habituel des coureurs présents</h2>
      <p>Pour valoriser un circuit, chaque coureur compte pour son <b>niveau habituel</b> ${fmt(pf.lag_days)} jours avant la course : la moyenne
        cubique pondérée de ses ${pctOf(pf.eligible_fraction)} meilleurs scores Top des 12 derniers mois, sans plafond de places — ce que vaut le
        coureur d'ordinaire. Ce n'est pas son CN Top, qui ne retient que ses meilleures courses.${analyst ? html` Pour les analystes, ce niveau est aussi un
        classement : le ${cnLabel("fair3")}.` : ""}</p>
      <ul class="mx-list">
        <li><span>Seuls les coureurs ayant leur propre niveau dans la spécialité comptent ; un circuit en demande au moins ${fmt(pf.min_ranked)}, sinon il
          n'est pas valorisé et ne donne aucun score.</span></li>
        <li><span>Les calculs partent des résultats de 2010, avec les CN officiels de cette première saison pour amorcer les premiers circuits.</span></li>
        <li><span>Les résultats « non classé » (nc) et les catégories H10 et D10 ne comptent pas.</span></li>
      </ul>
    </section>

    <section class="mx-slide" style="--c:var(--s1)">
      <p class="mx-kicker">Le score Top d'une course · 2</p>
      <h2>La valeur du circuit</h2>
      <div class="mx-eq">valeur du circuit = exp( moyenne des ln(<i>niveau habituel</i> × <i>temps</i>) )
        <small>la moyenne géométrique de niveau × temps — en forêt sur tous les coureurs classés ayant un niveau, en sprint sur les ⌈2N/3⌉ plus rapides</small></div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Moyenne</th><th>Coureurs comptés</th></tr></thead>
        <tbody>${windows.map(([tr, , , , cv, sf]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>${cv === 0 ? "géométrique" : "arithmétique (règle FFCO)"}</td>
          <td>${sf >= 1 ? "tous les classés ayant un niveau" : "les ⌈2N/3⌉ plus rapides ayant un niveau"}</td></tr>`)}</tbody></table></div>
    </section>

    <section class="mx-slide" style="--c:var(--s1)">
      <p class="mx-kicker">Le score Top d'une course · 3</p>
      <h2>Le score</h2>
      <div class="mx-eq">score Top = valeur du circuit ÷ <i>temps du coureur</i> × facteur de recalage du jour</div>
      <ul class="mx-list">
        <li><span>Courir aussi vite que son niveau le prévoit donne un score proche de ce niveau ; 10 % plus vite, un score 11 % plus haut.</span></li>
        <li><span>Un poinçon manquant, un abandon, une disqualification ou un hors-délai donnent un score de 0, qui compte.</span></li>
        <li><span>Le score est calculé une fois pour toutes, avec le facteur de recalage du jour de la course ; il n'est jamais révisé.</span></li>
      </ul>
    </section>

    <section class="mx-slide" style="${cvar("top6w3")}">
      <p class="mx-kicker">Le CN Top d'un coureur</p>
      <h2>${fmt(p6.top_n)} places pour les meilleures courses</h2>
      <div class="mx-eq">CN Top = ∛( Σ (places × score Top³) ÷ Σ places ), au plus ${fmt(p6.top_n)} places, parmi les ${pctOf(p6.eligible_fraction)} meilleurs scores
        <small>la moyenne cubique des scores retenus, chacun compté pour ses places (en VTT et en ski, la moyenne quadratique : la racine de la moyenne des carrés)</small></div>
      <ul class="mx-list">
        <li><span>Du meilleur score au moins bon, chaque course occupe autant de places que son poids. Un championnat de France occupe ${fmtW(pf.weights.cdf)} places,
          une course nationale (O'France, Nationale) ${fmtW(pf.weights.national)} place, toute autre course ${fmtW(pf.weights.other)} place, courses de sélection et
          championnats de ligue compris. La dernière course retenue ne prend que les places qui restent.</span></li>
        <li><span>Les poids suivent le nom de la compétition ; les niveaux A, B, C et D de la FFCO ne sont pas utilisés.</span></li>
        <li><span>Il faut au moins ${fmt(pf.min_scores)} courses dans la fenêtre pour être classé. Avec moins de ${fmt(p6.top_n)} places remplies, le CN Top est la
          moyenne cubique de ce qui est là.</span></li>
        <li><span>Une course de plus ne peut jamais faire baisser le CN Top : soit elle entre dans les places en chassant une moins bonne, soit elle n'y entre pas.</span></li>
      </ul>
      <div class="table-wrap" style="margin-top:14px"><table class="data compact"><thead><tr><th>${t("f.terrain")}</th><th>Fenêtre</th><th class="r">Scores retenus</th><th>Moyenne</th></tr></thead>
        <tbody>${windows.map(([tr, w, f, q]) => html`<tr><td>${t(`terrain.${tr}`)}</td><td>${years(w)}</td><td class="r">${pctOf(f)} meilleurs</td><td>${meanName(q)}</td></tr>`)}</tbody></table></div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker">Le recalage</p>
      <h2>Un facteur par jour, jamais rétroactif</h2>
      <ul class="mx-list">
        <li><span>Chaque jour, un facteur fixe à ${fmt(pf.anchor_target)} la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN Top de chaque spécialité
          — la règle 2026 de la FFCO, appliquée en continu plutôt qu'au 1<sup>er</sup> janvier.</span></li>
        <li><span>Le niveau est mesuré ${fmt(pf.anchor_lag_months)} mois plus tôt et lissé sur 13 mois ; en forêt et en sprint, il est prolongé de 7 mois à la
          dérive mesurée sur les dix dernières années. Une droite relie les points mensuels, chacun atteint le 1<sup>er</sup> du mois suivant.</span></li>
        <li><span>Le score Top d'une course est multiplié par le facteur de son jour, puis fixé une fois pour toutes : le CN Top ne change que lorsqu'une course
          entre dans la fenêtre ou en sort, jamais à cause du recalage.</span></li>
      </ul>
      <div style="margin-top:16px">${chartCard({ id: "norm", title: t("me.norm"), hint: t("me.norm.hint"), short: true })}</div>
    </section>

    <section class="mx-slide">
      <p class="mx-kicker" style="--c:var(--s3)">Illustration</p>
      <h2>Mêmes scores, CN différents</h2>
      <p class="mx-lead">Un coureur a couru ${fmt(n)} courses en 12 mois. Sa meilleure, ${fmt(EXAMPLE[0][0])}, est un championnat de France (★) ;
        ${fmt(EXAMPLE[2][0])} est une nationale. Ce que chaque calcul retient de ces mêmes scores :</p>
      ${["official", "top6w3", ...(analyst ? ["fair3"] : ["fair3"])].map((m) => html`<div class="mx-agg" style="${cvar(m)}">
        <div><b>${methodKey(m)} ${exLabel(m)}</b><div class="what">${EX[m].what}</div></div>
        ${chips(m)}
        <div class="cn">${fmt(EX[m].cn)}</div></div>`)}
      <p class="muted" style="font-size:13px">×2, ×1,5 : le poids de la course, ou les places qui lui restent. Exemple pédagogique : dans la réalité,
        chaque méthode a aussi ses propres valeurs de circuit, donc ses propres scores. Les
        ${EXAMPLE.filter(([, k]) => k !== "other").map(([s, k]) => `${fmt(s)} (${kindName[k]})`).join(" et ")} sont marqués.</p>
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
    const isTop = (m) => m.startsWith("top");
    const mark = (kind, label, note) => html`<span class="mx-mark ${kind}">${label}</span>${note ? html`<span class="mx-note">${note}</span>` : ""}`;
    const YES = (n) => mark("yes", "oui", n), NO = (n) => mark("no", "non", n), PART = (n) => mark("part", "en partie", n);
    const CRIT = [
      ["Compte les championnats et les nationales", (m) => (m === "official" ? NO("souvent écartés") : YES(`× ${fmtW(pf.weights.cdf)} et × ${fmtW(pf.weights.national)}`))],
      ["Une course de plus ne fait jamais baisser le CN", (m) => (m === "official" ? NO() : isTop(m) ? YES() : PART("une course moyenne peut le baisser"))],
      ["Reflète le niveau dans les grandes compétitions", (m) => (m === "official" ? NO("sans les 10 % meilleures") : isTop(m) ? YES("ses meilleures courses") : PART("son niveau habituel"))],
      ["Stable d'une année à l'autre", (m) => (m === "official" ? NO("marche au 1er janvier") : YES("recalage progressif"))],
      ["Simple à expliquer", (m) => (m === "official" || m === "fair" ? YES() : m === "top6w" ? PART("règle des 6 places") : PART("moyenne cubique, tout le peloton"))],
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
      const ks = [[1, "var(--s3)", "k = 1 · FFCO, score Top", ""], [2, "var(--ink-3)", "k = 2", "5 4"], [3, "var(--s4)", "k = 3", ""]];
      return html`<svg viewBox="0 0 ${W_} ${H}" role="img" aria-label="Score selon le temps pour k = 1, 2 et 3" style="width:100%;max-width:${W_}px;height:auto;display:block">
        ${[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3].map((s) => html`<line x1="${x0}" x2="${x0 + w}" y1="${Y(s)}" y2="${Y(s)}" stroke="var(--grid)"/>
          <text x="${x0 - 6}" y="${Y(s) + 4}" text-anchor="end" font-size="13" fill="var(--ink-3)">${fmt(100 * s)} %</text>`)}
        ${[1, 1.1, 1.2, 1.3, 1.4, 1.5].map((r) => html`<text x="${X(r)}" y="${y0 + h + 16}" text-anchor="middle" font-size="13" fill="var(--ink-3)">${r === 1 ? "temps prévu" : `+${fmt(100 * (r - 1))} %`}</text>`)}
        ${ks.map(([k, c, , dash]) => html`<polyline points="${line(k)}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="${dash}"/>`)}
        ${ks.map(([k, c, label], i) => html`<g transform="translate(${x0 + w - 170},${y0 + 10 + i * 21})"><line x1="0" x2="18" y1="0" y2="0" stroke="${c}" stroke-width="2.5"/>
          <text x="24" y="5" font-size="14" fill="var(--ink-2)">${label}</text></g>`)}
        <text x="${x0 + w / 2}" y="${H - 2}" text-anchor="middle" font-size="13" fill="var(--ink-2)">temps du coureur, par rapport au temps prévu par son CN</text>
      </svg>`;
    })();
    const fig = (id, caption, two = true) => html`<figure class="mx-fig">${two ? html`<div class="panels"><div class="panel"><h4>Forêt</h4><div id="${id}-For"></div></div>
      <div class="panel"><h4>Sprint</h4><div id="${id}-Spr"></div></div></div>` : html`<div id="${id}"></div>`}<figcaption>${caption}</figcaption></figure>`;
    const noStudy = html`<p class="muted">Les chiffres de l'étude ne sont pas disponibles pour le moment.</p>`;

    const CH = {
      objectifs: () => html`
        <section class="mx-slide mx-hero">
          <p class="mx-kicker">L'étude</p>
          <h2>Un CN qui compte vos meilleures courses et prédit mieux les résultats</h2>
          <p class="mx-lead">Ce chapitre rassemble les objectifs de la méthode Top, la façon dont elle a été évaluée, les études menées et les choix
            qui en découlent, avec les chiffres qui les fondent — jusqu'à la méthode en ligne depuis le 13 octobre 2026.</p>
          ${hf && hs ? html`<div class="mx-stats">
            <div class="mx-stat"><b>${lvl(hf, "r2", "official")} → ${lvl(hf, "r2", "top6w3")} %</b><span>des écarts de temps expliqués par le CN en forêt,
              méthode officielle puis Top (${ev.holdout[0]}–${ev.holdout[1]})</span></div>
            <div class="mx-stat"><b>${lvl(hs, "r2", "official")} → ${lvl(hs, "r2", "top6w3")} %</b><span>des écarts de temps expliqués en sprint, sur les
              mêmes saisons</span></div>
            <div class="mx-stat"><b>${lvl(hf, "acc", "official")} → ${lvl(hf, "acc", "top6w3")} %</b><span>de duels bien prédits en forêt
              (${fmt(Math.round(hf.pairs / 1e6 * 10) / 10, 1)} millions de duels)</span></div>
            <div class="mx-stat"><b>${fmt(ev.rows.For.all.holdout.comps + ev.rows.Spr.all.holdout.comps)}</b><span>compétitions de ${ev.holdout[0]} à
              ${ev.holdout[1]}, avant toute mise au point des méthodes</span></div>
          </div>` : ""}
          <p style="margin-top:18px"><a class="mx-dl" href="${PDF}" download>⬇ Télécharger l'étude en PDF (livre blanc)</a></p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Le point de départ</p>
          <h2>Le CN sert à deux choses très différentes</h2>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>Mesurer la force des coureurs</h3>
              <p>Pour calculer la valeur d'un circuit, il faut le <b>niveau habituel</b> des coureurs présents, que ne déforment ni une
                contre-performance ni un exploit isolé.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>Classer selon le potentiel</h3>
              <p>Pour les qualifications aux championnats de France, il faut ce dont un coureur est capable <b>dans une grande compétition</b> :
                ses meilleures courses.</p></div>
          </div>
          <div class="mx-callout">La ${methodLabel("official")} utilise <b>un seul CN pour les deux</b> : il convient au premier usage, et dessert le second.
            La méthode Top les sépare : <b>le score Top</b> d'une course se mesure sur le niveau habituel des coureurs présents, <b>le CN Top</b> d'un coureur
            retient ses meilleures courses.</div>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Les objectifs</p>
          <h2>Ce que la méthode doit faire</h2>
          <ul class="mx-list">
            <li><span>Partir des <b>mêmes résultats et du même score de course</b> que la FFCO, pour rester lisible et vérifiable.</span></li>
            <li><span><b>Compter les championnats de France et les nationales</b>, que la méthode officielle écarte souvent avec les 10 % meilleures courses.</span></li>
            <li><span><b>Ne jamais faire baisser le CN</b> d'un coureur parce qu'il a couru une course de plus.</span></li>
            <li><span><b>Supprimer la marche du 1<sup>er</sup> janvier</b>, pour permettre le suivi sur plusieurs saisons.</span></li>
            <li><span><b>Prédire mieux les résultats</b>, et le mesurer de façon sûre.</span></li>
            <li><span><b>Rester simple à expliquer</b> : une règle, pas un modèle ajusté coureur par coureur.</span></li>
          </ul>
        </section>`,

      depart: () => html`
        <section class="mx-slide" style="${cvar("official")}">
          <p class="mx-kicker">${methodKey("official")} ${methodLabel("official")}</p>
          <h2>La référence : solide pour mesurer, mal adaptée pour classer</h2>
          <div class="mx-grid">
            <div><h3 style="margin-top:4px">Ce qu'elle fait bien</h3><ul class="mx-list">
              <li><span>Elle fait foi : c'est le <b>seul classement officiel</b>, celui des sélections.</span></li>
              <li><span>Une moyenne qui écarte les scores extrêmes : une bonne mesure du <b>niveau habituel</b>, pour valoriser les circuits.</span></li>
              <li><span>Une règle publique, simple à expliquer.</span></li>
            </ul></div>
            <div><h3 style="margin-top:4px">Ce qu'elle fait mal</h3><ul class="mx-list bad">
              <li><span><b>Elle écarte les 10 % meilleures courses</b> : pour les meilleurs coureurs, ce sont le plus souvent les championnats de France et
                les nationales, les courses qu'ils préparent et les plus relevées.</span></li>
              <li><span><b>Elle n'incite pas à courir</b> : pour un coureur à fort CN, une course de plus le fait souvent baisser ; certains s'arrêtent
                dès leur CN qualifiant, d'autres ne courent que les courses « rentables ».</span></li>
              <li><span><b>Une marche chaque 1<sup>er</sup> janvier</b>, et des règles qui ont changé au fil des saisons : le suivi sur plusieurs années est faussé.</span></li>
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
          <h2>Mêmes résultats, mêmes temps</h2>
          <div class="mx-fix">
            <div class="head">Méthode officielle</div><div></div><div class="head">Méthode « Top »</div>
            <div class="p"><b>Les meilleures courses écartées</b>souvent les championnats de France et les nationales</div><div class="arrow">→</div>
            <div class="s"><b>Les meilleures courses comptent le plus</b>un championnat de France compte double, une nationale une fois et demie ;
              seules les moins bonnes sont laissées de côté</div>
            <div class="p"><b>Une course de plus peut faire baisser le CN</b>de quoi dissuader de courir</div><div class="arrow">→</div>
            <div class="s"><b>Une course de plus ne peut jamais le faire baisser</b>${fmt(p6.top_n)} places, remplies par les meilleures courses :
              courir plus, c'est plus de chances de les remplir</div>
            <div class="p"><b>Le circuit mesuré sur les deux tiers les plus rapides</b>les coureurs qui se sont trompés sont laissés de côté : sur
              un circuit piégeux, bien s'orienter rapporte moins qu'ailleurs</div><div class="arrow">→</div>
            <div class="s"><b>Le circuit mesuré sur tout le peloton classé</b>en forêt, en moyenne géométrique : la difficulté d'un circuit comprend
              les erreurs qu'il provoque, et les éviter rapporte</div>
            <div class="p"><b>Une marche au 1<sup>er</sup> janvier</b>tout le classement change d'un coup</div><div class="arrow">→</div>
            <div class="s"><b>Un recalage progressif, jour après jour</b>le score d'une course est fixé une fois pour toutes ; le CN ne bouge que
              quand une course entre dans la fenêtre ou en sort</div>
            <div class="p"><b>Un seul CN pour deux usages</b>mesurer et classer</div><div class="arrow">→</div>
            <div class="s"><b>Un calcul pour chaque usage</b>le score Top d'une course se mesure sur le niveau habituel des coureurs${analyst
              ? html` (le ${cnLabel("fair3")})` : ""}, le CN Top retient leur potentiel</div>
          </div>
        </section>`,

      mesure: () => html`
        <section class="mx-slide mx-hero">
          <p class="mx-kicker">Le test</p>
          <h2>Avant la course, qui est favori ? Après, qui a fini devant, et avec quel écart ?</h2>
          <p class="mx-lead">Un bon CN doit annoncer les résultats. Pour chaque coureur, on prend le CN qu'il avait <b>15 jours avant</b> la course :
            ce CN ne sait rien d'elle. Sur chaque circuit, on regarde si ces CN annonçaient l'ordre d'arrivée et les écarts de temps. Toutes les méthodes
            sont jugées sur les mêmes coureurs : ceux qui avaient un CN dans chacune d'elles.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Première mesure</p>
          <h2>La part des duels bien prédits</h2>
          <p>Sur un circuit, chaque paire de coureurs forme un duel : 45 duels pour 10 coureurs, 11 175 pour 150. Le CN prédit bien un duel quand le
            coureur qui a le CN le plus haut termine devant l'autre. Deux CN égaux comptent pour un demi-duel bien prédit. Un CN tiré au hasard prédit
            bien la moitié des duels. Aucun CN ne peut les prédire tous, car la forme du jour et les erreurs décident d'une partie des résultats.</p>
          <div class="mx-eq">part des duels bien prédits d'un circuit = (duels bien prédits + ½ × égalités de CN) ÷ nombre de duels
            <small>puis la moyenne sur tous les circuits, chaque circuit pesant son nombre de coureurs</small></div>
          <p><b>Chaque circuit pèse son nombre de coureurs.</b> Un coureur affronte tous les autres coureurs de son circuit. La part de ses duels bien
            prédits dit si le CN l'a bien placé parmi eux. La moyenne de cette part sur tous les résultats d'une saison est exactement la moyenne des
            circuits pondérée par leur nombre de coureurs : chaque résultat compte une fois. Compter chaque duel une fois donnerait trop de poids aux
            grands circuits, puisqu'un circuit de 150 coureurs pèserait autant que 250 circuits de 10. Compter chaque circuit une fois en donnerait trop
            aux petits, puisqu'un circuit de 5 coureurs pèserait autant qu'un circuit de championnat de France.</p>
          <p><b>Le lien avec le τ de Kendall.</b> Les statisticiens mesurent l'accord entre deux classements par le τ de Kendall : la part des duels bien
            prédits moins la part des duels mal prédits. Si <i>p</i> est la part des duels bien prédits, τ = <i>p</i> − (1 − <i>p</i>) = 2<i>p</i> − 1,
            soit 1 − 2 × la part des duels mal prédits. C'est la même mesure sur une autre échelle : τ vaut 0 pour un CN tiré au hasard
            (<i>p</i> = 50 %) et 1 pour un ordre parfait. Le site donne la part des duels, plus parlante.</p>
          ${hf ? html`<p>En forêt, de ${ev.holdout[0]} à ${ev.holdout[1]}, le CN officiel prédit bien ${lvl(hf, "acc", "official")} % des duels et le CN Top
            ${lvl(hf, "acc", "top6w3")} %. Le CN officiel se trompe donc sur ${fmt(100 * (1 - hf.acc.official), 1)} % des duels et le CN Top sur
            ${fmt(100 * (1 - hf.acc.top6w3), 1)} %, soit ${fmt(Math.round(100 * (1 - (1 - hf.acc.top6w3) / (1 - hf.acc.official))))} % d'erreurs en moins.
            Entre les variantes de l'étude, les écarts sont souvent de quelques dixièmes de point.</p>` : ""}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Deuxième mesure</p>
          <h2>Les écarts de temps expliqués</h2>
          <p>L'ordre ne dit pas tout : finir 10 secondes ou 10 minutes derrière un autre coureur, ce n'est pas la même chose. Un CN se lit comme une
            vitesse : un coureur dont le CN est 10 % plus haut doit courir environ 10 % plus vite. Sur chaque circuit, on compare donc le temps de chaque
            coureur à celui que son CN annonce.</p>
          <div class="mx-eq">ln(temps) = constante du circuit − <i>b</i> × ln(CN) + écart
            <small>la constante tient compte de la longueur et de la difficulté du circuit ; <i>b</i> est proche de 1</small></div>
          <ul class="mx-list">
            <li><span><b>Des logarithmes, parce que les temps se comparent en proportion.</b> Perdre 5 minutes sur un sprint de 15 minutes n'est pas
              la même chose que sur une longue distance de 90 minutes. En logarithme, 10 % de temps en plus pèse autant sur les deux.</span></li>
            <li><span><b>Le R²</b> est la part de la dispersion des temps d'un circuit autour de sa moyenne, en logarithme, que les CN expliquent :
              0 % si le CN n'annonce rien, 100 % si chaque temps est exactement celui qu'il annonce. Les sommes portent sur tous les résultats : là
              aussi, chaque résultat compte une fois.</span></li>
            <li><span><b>La pente <i>b</i> est apprise sur la saison précédente.</b> Chaque saison est ainsi prédite sans être connue, comme le serait
              la saison à venir.</span></li>
          </ul>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">La marge d'incertitude</p>
          <h2>Un écart est-il réel, ou dû au hasard des courses ?</h2>
          <p>Les courses d'une saison sont un échantillon : avec d'autres courses, l'écart entre deux méthodes aurait été un peu différent. Pour savoir
            de combien, on refait le calcul ${ev ? fmt(ev.boot) : "1 000"} fois sur des saisons tirées au sort. Chaque tirage prend autant de compétitions
            que la saison réelle, choisies au hasard parmi elles : certaines sortent deux fois, d'autres pas du tout. C'est la méthode du <i>bootstrap</i>.</p>
          <ul class="mx-list">
            <li><span><b>L'intervalle à 95 %</b>, écrit entre crochets après chaque écart, contient l'écart obtenu dans 95 % de ces tirages.</span></li>
            <li><span><b>Un écart est significatif quand son intervalle ne contient pas 0.</b> Presque tous les tirages donnent alors un écart de même
              signe : le hasard des courses courues ne suffit pas à l'expliquer. Quand l'intervalle contient 0, la mesure ne permet pas de départager les
              deux méthodes.</span></li>
            <li><span><b>On tire des compétitions entières, pas des duels.</b> Les coureurs d'une même course partagent le terrain, la carte et la météo :
              leurs duels ne sont pas indépendants. Tirer les duels un par un donnerait des intervalles trop étroits.</span></li>
            <li><span><b>Les comparaisons sont appariées</b> : mêmes coureurs, mêmes courses. L'écart entre deux méthodes est calculé course par course.</span></li>
            <li><span><b>Des saisons mises de côté.</b> Les paramètres ont été choisis sur la période de juillet 2025 à octobre 2026. Les saisons
              ${ev ? `${ev.holdout[0]} à ${ev.holdout[1]}` : "2012 à 2024"} n'ont servi qu'à la mesure : le réglage n'a pas pu s'adapter à leurs
              particularités, comme un examen fait de questions jamais vues à l'entraînement.</span></li>
            <li><span>Chaque variante est recalculée depuis 2010 sur une copie de la base, avec son propre recalage. Les CN J-15 sont ceux qu'elle aurait
              publiés.</span></li>
          </ul>
          <p class="muted" style="font-size:13px">Jusqu'au 14 octobre 2026, chaque circuit comptait une fois dans la mesure, quel que soit son nombre de
            coureurs. Toutes les mesures de l'étude ont été refaites avec la pondération par le nombre de coureurs ; aucun choix n'a changé. Les tableaux
            datés du 6 et du 7 octobre donnent la mesure de la mise au point, où chaque duel comptait une fois, sans intervalle.</p>
        </section>`,

      choix: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Les poids et les places</p>
          <h2>Les meilleures courses comptent, chacune selon son poids</h2>
          <ul class="mx-list">
            <li><span><b>Les poids suivent le nom de la compétition.</b> Un championnat de France a un poids de ${fmtW(pf.weights.cdf)} : c'est la course la
              plus relevée, celle que les coureurs préparent, et elle compte comme deux courses. Une course nationale a un poids de ${fmtW(pf.weights.national)},
              toute autre course un poids de ${fmtW(pf.weights.other)}. Les niveaux A, B, C et D de la FFCO ne sont pas utilisés.</span></li>
            <li><span><b>${fmt(p6.top_n)} places</b>, remplies du meilleur score au moins bon. Une course de plus ne peut jamais faire baisser le CN : soit elle
              prend la place d'une course moins bonne, soit elle reste dehors. Le classement mondial de l'IOF procède de même avec les cinq meilleures courses.
              Dix places, essayées, ne faisaient pas mieux une fois les circuits valorisés avec le niveau habituel.</span></li>
            <li><span><b>Les ${pctOf(pf.eligible_fraction)} meilleurs scores</b> de la fenêtre seulement, et au moins ${fmt(pf.min_scores)} courses. Les scores
              écartés sont, pour l'essentiel, les courses où le coureur s'est trompé. Garder 70 ou 80 % des scores coûtait de 0,4 à 1 point de duels en forêt
              et en sprint. Exiger cinq courses réduisait le nombre de coureurs qui valorisent les circuits et faisait moins bien. Deux courses classaient 11 %
              de coureurs de plus en forêt et 38 % en sprint, mais coûtaient de 0,1 à 0,4 point sur les duels entre coureurs déjà classés. Ce sont des mesures de
              la mise au point, où chaque duel comptait une fois.</span></li>
          </ul>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Le niveau habituel</p>
          <h2>Pourquoi le score d'une course ne se mesure pas sur les CN Top</h2>
          <p>Le classement mondial de l'IOF valorise une course d'après les points de classement des coureurs présents. Un CN qui ne garde que les
            meilleures courses ne peut pas jouer ce rôle : il se nourrirait de lui-même. Un groupe qui court surtout entre soi, comme les vétérans ou les
            jeunes, aurait des CN tirés vers le haut, donc des valeurs de circuit plus hautes, donc des scores plus hauts, donc des CN plus hauts encore.
            Dans les premiers essais, les H/D 21 se trouvaient ainsi dévalués de 13 % environ. Le score Top d'une course se mesure donc sur ${force} : la
            moyenne cubique de leurs ${pctOf(pf.eligible_fraction)} meilleurs scores, sans plafond de places, ce que vaut chacun d'ordinaire. Le CN Top
            agrège ensuite les mêmes scores sur ${fmt(p6.top_n)} places.</p>
          ${S ? html`<p>Mesuré de nouveau avec la méthode retenue, un CN Top à ${fmt(p6.top_n)} places qui valoriserait lui-même les circuits perd
            ${ci(onecn("For")?.ST6_t)} point de duels sur 2012–2024, et ${ci(onecn("For", "all_tuned")?.ST6_t)} depuis juillet 2025 : <b>la perte grandit au
            fil des saisons</b>. Il surévalue aussi les jeunes de ${fmt(Math.abs(calib("For", "young", "ST6_t")?.[0] ?? 1.4), 1)} % face aux H/D 21. À 10 places,
            la perte est divisée par trois ; à 16, elle disparaît presque, mais le CN Top se confond alors avec le niveau habituel pour presque tout le monde.</p>
          ${fig("fig-onecn", html`<b>Un CN Top qui valorise lui-même les circuits</b>, contre la méthode retenue (le niveau habituel les valorise) : écart de duels
            bien prédits par saison, en points, en forêt, pour 6, 10 et 16 places. Pour 62 % des coureurs de forêt (sept courses par an en médiane) et 96 % en sprint, le CN Top et le niveau
            habituel sont déjà le même nombre ; ils diffèrent pour les coureurs assidus (12 courses et plus, un quart des coureurs de forêt), de 4,6 % en médiane.`, false)}` : noStudy}
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Le recalage continu</p>
          <h2>Un facteur par jour plutôt qu'une marche</h2>
          <ul class="mx-list">
            <li><span>Le score d'une course est multiplié par le facteur de son jour, puis fixé une fois pour toutes : le CN ne change que lorsqu'une course
              entre dans la fenêtre ou en sort, jamais à cause du recalage.</span></li>
            <li><span>Le facteur suit la règle 2026 de la FFCO, appliquée en continu : dans chaque spécialité, la moyenne des ${pctOf(pf.anchor_top_fraction)}
              meilleurs CN est ramenée à ${fmt(pf.anchor_target)}. D'un mois à l'autre, il bouge de 0,3 % environ, contre une marche de 3 à 7 % au
              1<sup>er</sup> janvier.</span></li>
            <li><span>Un recalage qui réagissait à ses propres effets, essayé, oscillait d'un mois à l'autre : il a été écarté. Le facteur n'agit jamais sur
              les calculs internes, seulement sur ce qui est publié.</span></li>
          </ul>
          <p>Une faille de ce recalage, découverte le 13 octobre 2026, est traitée au chapitre
            <a href="#/methodes?onglet=etude&voir=recalage" data-tab-link="etude" data-goto="recalage">Le recalage</a>.</p>
        </section>`,

      score: () => html`
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">La première piste</p>
          <h2>Combien doit coûter une minute de retard ?</h2>
          <p class="mx-lead">Le score de la FFCO est inversement proportionnel au temps : 10 % de temps en plus, 9 % de score en moins. La première idée
            de l'étude était de rendre le retard plus cher, avec un exposant <i>k</i> :</p>
          <div class="mx-eq">score ∝ 1 ÷ temps<sup><i>k</i></sup> &nbsp;&nbsp;⇔&nbsp;&nbsp; ln(score) = constante − <i>k</i> × ln(temps)
            <small>k = 1 : la règle de la FFCO, que garde le score Top. k = 2 : 10 % de temps en plus coûte 17 % de score. k = 3 : 25 %.</small></div>
          <div style="margin:8px 0 4px">${curve}</div>
          <h3>Première mesure (7 octobre 2026) : la part des duels bien prédits selon k</h3>
          <div class="table-wrap"><table class="data compact mx-ktab"><thead><tr><th>${t("f.terrain")}</th><th>Période</th><th class="r">Duels</th>
            <th class="r">${methodShort("official")}</th>${K_TESTS.ks.map((k) => html`<th class="r ${k === 2 ? "k2" : ""}">k = ${String(k).replace(".", ",")}</th>`)}</tr></thead>
            <tbody>${K_TESTS.rows.map(kRow)}</tbody>
            <tbody><tr><td colspan="${4 + K_TESTS.ks.length}" class="muted" style="font-size:12.5px">Contrôle sur les saisons précédentes</td></tr>
              ${K_TESTS.past.map(kRow)}</tbody></table></div>
          <p class="muted" style="font-size:13px">Part des duels bien prédits (%), chaque duel compté une fois, avec k appliqué au score et un niveau habituel
            en moyenne simple. En gras, le meilleur de chaque ligne. C'est une mesure de la mise au point, sur une seule période et sans intervalle. Le gain se
            faisait entre k = 1 et k = 2 dans les quatre spécialités, puis plafonnait. La suite a montré où placer k, et d'où venait ce plafond.</p>
        </section>

        <section class="mx-slide">
          <p class="mx-kicker">7 octobre 2026</p>
          <h2>Où placer k ? Dans la moyenne des courses</h2>
          <p>Appliquer k = 2 au score, puis prendre la racine carrée du CN, revient exactement à remplacer deux moyennes par des <b>moyennes quadratiques</b>
            (la racine de la moyenne des carrés) : celle qui donne la <b>valeur du circuit</b> et celle qui donne le <b>CN</b>. Les scores restent alors à
            l'échelle habituelle. Les deux ont été mesurées séparément et ensemble, de k = 1 à 3, sur le Top et les mêmes duels :</p>
          <div class="table-wrap"><table class="data compact mx-ktab"><thead>
            <tr><th rowspan="2">k appliqué à</th><th class="r" rowspan="2">k circuit</th><th class="r" rowspan="2">k CN</th>
              <th class="r" colspan="2">Forêt</th><th class="r" colspan="2">Sprint</th><th class="r" rowspan="2">Échelle forêt<br>(p90 ÷ p10)</th></tr>
            <tr><th class="r">toutes</th><th class="r">nationales</th><th class="r">toutes</th><th class="r">nationales</th></tr></thead>
            ${K_GRID.map(([what, rows]) => html`<tbody>${rows.map((r, i) => {
              const chosen = r[0] === 1 && r[1] === 2, today = r[0] === 1 && r[1] === 1;
              const k = (x) => String(x).replace(".", ",");
              return html`<tr>${i === 0 ? html`<td rowspan="${rows.length}">${{ cn: "la moyenne des courses (CN)", cv: "la valeur du circuit", both: "les deux" }[what]}</td>` : ""}
                <td class="r num ${chosen ? "k2" : ""}">${k(r[0])}</td><td class="r num ${chosen ? "k2" : ""}">${k(r[1])}</td>
                ${r.slice(2, 6).map((x, j) => html`<td class="r num ${chosen ? "k2" : ""}">${x === Math.max(...K_GRID.flatMap(([, rr]) => rr.map((y) => y[2 + j])))
                  ? html`<b>${fmt(x, 2)}</b>` : fmt(x, 2)}</td>`)}
                <td class="r num ${chosen ? "k2" : ""}">${fmt(r[6], 2)}${today ? html` <span class="muted">(linéaire)</span>` : chosen
                  ? html` <span class="muted">(Top du 7 au 13 oct.)</span>` : ""}</td></tr>`;
            })}</tbody>`)}</table></div>
          <p class="muted" style="font-size:13px">Part des duels bien prédits (%) par la méthode Top, chaque duel compté une fois, de juillet 2025 à octobre 2026 :
            771 511 duels en forêt (276 703 sur courses nationales), 113 914 en sprint (21 452). En gras, le meilleur de chaque colonne. Placé dans la moyenne
            des courses, k gagnait sans rien coûter sur les nationales. Placé dans la valeur du circuit, il coûtait sur les nationales, n'apportait rien en sprint
            et resserrait l'échelle. Le Top publié du 7 au 13 octobre 2026 avait donc un CN en moyenne quadratique, sur la valeur de circuit de la FFCO.</p>
        </section>

        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">Pourquoi pencher vers les bonnes courses</p>
          <h2>Une erreur ne fait que ralentir</h2>
          <p>Le score d'une course mêle trois choses : le niveau du coureur ; la forme du jour, qui joue dans les deux sens ; le temps perdu en erreurs, qui ne
            joue que dans un sens, car une erreur ralentit et ne fait jamais gagner de temps. Les courses d'un coureur ne sont donc pas réparties de façon
            symétrique autour de son niveau : la plupart en sont proches, et une longue traîne descend vers les courses ratées.</p>
          ${S ? html`<p>En forêt, ${fmt(100 * dev("For").below_08, 1)} % des courses donnent moins de 0,8 fois le niveau habituel du coureur, et seulement
            ${fmt(100 * dev("For").above_125, 1)} % plus de 1,25 fois. En sprint, ces parts sont de ${fmt(100 * dev("Spr").below_08, 1)} % et
            ${fmt(100 * dev("Spr").above_125, 1)} %.</p>
          ${fig("fig-dev", html`<b>Le score d'une course rapporté à la médiane des autres courses du coureur</b> dans la saison (coureurs de 6 courses et plus,
            2012–2025). Barres : les données. Tirets : le modèle niveau × forme du jour × perte due aux erreurs, avec une forme du jour qui varie de 12 % en
            forêt (6,6 % en sprint) et une perte moyenne de 10 % (6,5 %). En orange, les courses sous 0,8 fois le niveau.`)}` : noStudy}
          <p>Pour retrouver le niveau sous ce bruit, il faut faire plus confiance aux bonnes courses qu'aux mauvaises. Le CN Top le fait de deux façons. Il ne
            garde que les ${pctOf(pf.eligible_fraction)} meilleurs scores : les courses ratées ne comptent pas. Parmi les scores gardés, il prend la
            <b>moyenne cubique</b>, la racine cubique de la moyenne des cubes, qui donne plus de poids aux meilleurs.</p>
          <div class="mx-eq">trois scores : 6 000, 5 000 et 4 000
            <small>moyenne simple : 5 000 · moyenne quadratique : 5 066 · moyenne cubique : ∛((6 000³ + 5 000³ + 4 000³) ÷ 3) = 5 130</small></div>
          <p>Pour un coureur régulier, l'effet est faible : la moyenne cubique de ses ${fmt(p6.top_n)} places retenues dépasse leur moyenne simple de 0,3 % en
            médiane, et de 1,3 % pour un coureur sur dix. Elle compte surtout pour les coureurs irréguliers, dont les courses retenues mêlent de très bonnes
            courses et des courses à petites erreurs.</p>
          ${S ? html`<p>Un autre calcul a été essayé : l'estimation du niveau par maximum de vraisemblance dans ce modèle, qui sépare la forme du jour et les
            pertes. Il fait mieux en sprint (${sg(S.mle_fit.Spr[0], 2)} point de duels pour le niveau habituel) et bien moins bien en forêt
            (${sg(S.mle_fit.For[0], 2)} point). En forêt, la tendance à se tromper persiste d'une course à l'autre et fait partie du niveau : un modèle qui
            traite chaque course ratée comme de la malchance surestime les coureurs qui se trompent souvent.</p>` : ""}
        </section>

        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">13 octobre 2026</p>
          <h2>Le choix de k = 3</h2>
          <p>La moyenne d'ordre k, la racine k-ième de la moyenne des puissances k, penche d'autant plus vers les meilleures courses que k est grand. Pour k = 1,
            c'est la moyenne simple ; pour k = 2, la moyenne quadratique ; pour k = 3, la moyenne cubique. Un k très grand ne garde plus que la meilleure course.
            Avec la valeur de circuit retenue (chapitre suivant), sur 2012–2024 :</p>
          ${S ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th></th><th class="r">Toutes les courses</th><th class="r">Courses nationales</th>
            <th class="r">Depuis juillet 2025</th></tr></thead><tbody>
            <tr><td>Forêt, k = 3 contre k = 2</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(k3("For", sc)?.G4_t)}</td>`)}</tr>
            <tr><td>Forêt, k = 4 contre k = 2</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(k3("For", sc)?.G5_t)}</td>`)}</tr>
            <tr><td>Sprint, k = 3 contre k = 2</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(neg(k3("Spr", sc)?.G4_t))}</td>`)}</tr>
            <tr><td>Sprint, k = 4 contre k = 3</td>${["all_holdout", "nat_holdout", "all_tuned"].map((sc) => html`<td class="r num">${ci(k3("Spr", sc)?.G5_t)}</td>`)}</tr>
            </tbody></table></div>
          <p class="muted" style="font-size:13px">Écarts en points de duels bien prédits, avec leur intervalle à 95 %.</p>` : noStudy}
          <p>En forêt, k = 3 gagne sur k = 2 sans rien perdre sur les courses nationales ; k = 4 gagne encore un peu sur l'ensemble des courses, mais perd sur
            les nationales. En sprint, k = 4 gagnerait quelques centièmes de point, sans gain sur les nationales. Un k plus grand fait reposer le CN sur une ou
            deux courses : une course exceptionnelle, ou un circuit mal valorisé, suffirait à le porter. Le Top retient k = 3 dans les deux spécialités.</p>
        </section>

        <section class="mx-slide">
          <p class="mx-kicker">Une autre écriture du même calcul</p>
          <h2>Pourquoi on parle parfois de « 3 % de points pour 1 % de temps »</h2>
          <p>Prendre la moyenne cubique des scores, c'est prendre la moyenne simple des scores élevés au cube, puis revenir à l'échelle habituelle par la racine
            cubique. Un score élevé au cube varie trois fois plus vite que le temps : 1 % de temps en plus lui coûte environ 3 %. On peut donc décrire le même
            calcul ainsi : sur une échelle de travail, 1 % de temps en plus coûte 3 % de points, et le CN est la moyenne simple des meilleures courses, ramenée
            ensuite à l'échelle habituelle. <b>Sur l'échelle publiée, rien ne change</b> : le score Top d'une course baisse de 1 % quand le temps augmente de 1 %,
            comme le score de la FFCO.</p>
          <div class="mx-eq">CN<sup>1/k</sup> avec score = V ÷ temps<sup>k</sup> &nbsp;=&nbsp; moyenne d'ordre k des (V<sup>1/k</sup> ÷ temps)
            <small>V : la valeur géométrique du circuit, qui ne dépend pas de k. L'égalité est exacte quand la valeur du circuit est une moyenne géométrique.
              Vérifié sur les données : les deux calculs donnent le même CN de forêt à la pente près (${S ? fmt(S.equiv.For.slope, 2) : "1,98"} pour k = 2), et
              ${S ? fmt(100 * S.equiv.For.same_order, 1) : "98"} % des paires d'un même circuit sont dans le même ordre. Les autres sont des quasi-égalités, déplacées
              par le recalage, qui agit sur une échelle différente dans chaque écriture.</small></div>
        </section>`,

      circuit: () => html`
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">Ce qui plafonnait</p>
          <h2>Les deux tiers les plus rapides laissent de côté les coureurs qui se sont trompés</h2>
          <p class="mx-lead">La valeur d'un circuit mesure sa difficulté : le temps qu'y met un coureur d'un niveau donné. Elle fixe le niveau de tous les
            scores de la course par rapport aux autres courses. Elle ne change rien à l'ordre à l'intérieur de la course : le coureur qui s'oriente bien devance
            ceux qui se trompent, et son score dépasse le leur d'autant.</p>
          <p>La FFCO mesure cette valeur sur les ⌈2N/3⌉ coureurs les plus rapides. Le dernier tiers réunit des coureurs plus faibles, dont le produit
            CN × temps est normal, et des coureurs qui se sont trompés, dont le produit est trop grand. En les écartant, on mesure la difficulté du circuit
            couru presque sans erreur. Or certains circuits provoquent bien plus d'erreurs que d'autres. Sur un circuit piégeux, la valeur sort donc plus
            basse qu'ailleurs, par rapport à sa difficulté réelle, et tous les scores de la course avec elle. Le coureur qui a fait les erreurs habituelles de
            ce circuit marque sous son niveau ; celui qui a évité les pièges marque au-dessus, mais moins qu'il ne le mériterait.</p>
          <p>Mesurée sur tout le peloton, la valeur compte les erreurs que le circuit provoque d'ordinaire. Faire les erreurs habituelles donne alors son niveau,
            et les éviter rapporte nettement plus : bien s'orienter est récompensé là où cela fait la différence.</p>
          ${S ? html`${fig("fig-trunc", html`<b>Par circuit</b> (2012–2026, au moins 6 classés ayant un CN) : la valeur mesurée sur tout le peloton divisée par
            la valeur mesurée sur les deux tiers les plus rapides (moyennes de CN × temps). Forêt : +${fmt(100 * (tru("For").mean - 1), 1)} % en moyenne, avec un
            écart-type de ${fmt(100 * tru("For").sd, 1)} points et un circuit sur dix au-delà de +${fmt(100 * (tru("For").p90 - 1), 0)} %. Sprint :
            +${fmt(100 * (tru("Spr").mean - 1), 1)} %, écart-type ${fmt(100 * tru("Spr").sd, 1)}. L'écart est d'autant plus grand que les temps du circuit sont
            dispersés (corrélation de ${fmt(tru("For").corr_spread, 2)} en forêt) : c'est la part des erreurs.`)}` : noStudy}
          <p>C'est ce défaut que k compensait en partie quand il s'appliquait sur la valeur de la FFCO : une moyenne d'ordre k de CN × temps penche vers les
            grands produits, donc vers les coureurs qui se sont trompés. Appliquer k = 2 au score gardait ainsi l'essentiel de son gain
            (${S ? ci(kpt("For", "race", 2)) : "+0,20"} point de duels en forêt, face au Top quadratique).</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">La correction</p>
          <h2>Tout le peloton, en moyenne géométrique</h2>
          <ul class="mx-list">
            <li><span><b>La moyenne géométrique</b>, l'exponentielle de la moyenne des logarithmes, est la moyenne naturelle d'un produit. Or le temps d'un
              coureur est un produit : la difficulté du circuit, divisée par le niveau du coureur, multipliée par un aléa. Un coureur deux fois plus fort va deux
              fois plus vite ; un circuit deux fois plus long prend deux fois plus de temps. La moyenne géométrique traite de la même façon un coureur deux fois
              trop lent et un coureur deux fois trop rapide, alors que la moyenne arithmétique compte bien plus le coureur lent : la moyenne de 0,5 et de 2 vaut
              1,25, et non 1. Une seule course catastrophique ne peut donc pas emporter la valeur du circuit.</span></li>
            <li><span><b>Avec la moyenne arithmétique</b>, tout le peloton fait aussi bien sur l'ensemble des courses, mais ne gagne rien sur les nationales
              (${S ? ci(kpt("For", "aall", 2, "nat_holdout")) : "±0"} point à k = 2, contre ${S ? ci(kpt("For", "gall", 2, "nat_holdout")) : "+0,13"} avec la moyenne
              géométrique).</span></li>
            <li><span><b>Les erreurs font partie du circuit.</b> N'écarter que les 15 % les plus lents, ou amortir les courses aberrantes avec l'estimateur de
              Huber, fait moins bien que tout le peloton : environ 0,1 point de duels de moins, au même k.</span></li>
            <li><span><b>En sprint</b>, où les erreurs sont deux fois moins fréquentes, tout le peloton fait moins bien que les deux tiers
              (${S ? ci(kpt("Spr", "gall", 3)) : "−0,12"} point face au Top quadratique, contre ${S ? ci(kpt("Spr", "g23", 3)) : "+0,12"} pour les deux tiers en
              moyenne géométrique). Le sprint garde les deux tiers les plus rapides, en moyenne géométrique.</span></li>
          </ul>
          ${S ? fig("fig-k", html`<b>Gain en duels bien prédits face au Top quadratique</b> (2012–2024, toutes les courses), en points, selon k et selon la façon de
            mesurer la valeur du circuit, avec les intervalles à 95 % ; cerclé, le choix retenu.
            <span class="mx-legend" style="display:inline-flex;margin-left:8px"><span><i style="background:var(--forest)"></i>géométrique, tout le peloton</span>
            <span><i style="background:var(--ink);border-top:2px dashed var(--ink);height:0"></i>géométrique, ⅔</span><span><i style="background:var(--ink-3)"></i>arithmétique, tout le peloton</span>
            <span><i style="background:var(--flag)"></i>k au score, valeur FFCO</span><span><i style="background:var(--water)"></i>puissance du CN seul, valeur FFCO</span></span>`) : ""}
          <div class="filters" id="fig-k-scope" style="margin-top:-8px"></div>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Les jeunes</p>
          <h2>À leur place face aux H/D 21</h2>
          <p>Pour chaque groupe, on cherche la correction de CN qui ferait le mieux prédire ses duels contre les H/D 21 (une régression logistique sur l'écart de
            CN). Une correction de +3 % veut dire que le groupe gagne ses duels comme si son CN était 3 % plus haut : il est sous-évalué de 3 %. Comparer la
            part des duels où le groupe est « prévu devant » à la part où il est « arrivé devant » tromperait : le hasard des courses rapproche la seconde de 50 %,
            et même un CN parfait paraîtrait biaisé.</p>
          ${S ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th></th><th></th><th class="r">${methodShort("official")}</th><th class="r">Top quadratique</th><th class="r">Méthode retenue</th></tr></thead>
            <tbody>${[["For", "Forêt", "G4_t"], ["Spr", "Sprint", "G1_t"]].flatMap(([tr, name, cand]) => [["young", "jeunes"], ["old", "vétérans"]].map(([g, gl]) => html`<tr><td>${name}</td><td>${gl}</td>
              ${["official", "Q_t", cand].map((m) => html`<td class="r num">${pctCi(calib(tr, g, m))}</td>`)}</tr>`))}</tbody></table></div>
          <p class="muted" style="font-size:13px">2012–2026, intervalles à 95 % par tirage au sort des compétitions.</p>` : noStudy}
          <p>En forêt, toutes les méthodes sous-évaluaient les jeunes : leurs circuits provoquent beaucoup d'erreurs, et la valeur mesurée sur les deux tiers les
            sous-évaluait. Avec tout le peloton, ils sont à leur place. Les vétérans restent surévalués de 8 à 9 % par toutes les méthodes, l'officielle comprise.
            La cause est ailleurs que dans la valeur du circuit (un niveau qui baisse pendant les 12 mois de la fenêtre, des CN acquis surtout entre vétérans) et
            demanderait une étude à part.</p>
        </section>
        <section class="mx-slide" style="--c:var(--bad)">
          <p class="mx-kicker">Mesurée en octobre 2026, puis écartée</p>
          <h2>Une valeur de circuit quadratique sur les deux tiers</h2>
          <p>Avant d'élargir le peloton, une autre piste avait été mesurée : garder les deux tiers, mais en moyenne quadratique.</p>
          <div class="mx-eq">trois coureurs : 6 000 × 50 min, 5 000 × 66 min, 4 000 × 80 min, soit 300 000, 330 000 et 320 000
            <small>moyenne simple : 316 667 · moyenne quadratique : √((300 000² + 330 000² + 320 000²) ÷ 3) = 316 912, soit +0,08 %</small></div>
          <div class="table-wrap"><table class="data compact"><thead>
            <tr><th rowspan="2">Méthode Top</th><th class="r" colspan="2">Forêt</th><th class="r" colspan="2">Sprint</th>
              <th class="r" rowspan="2">Échelle forêt<br>(p90 ÷ p10)</th><th class="r" rowspan="2">Places gagnées ou<br>perdues (médiane, forêt)</th>
              <th class="r" rowspan="2">55 ans et + prévus devant<br>un H/D 21 (réel : 42,9 %)</th></tr>
            <tr><th class="r">toutes</th><th class="r">nationales</th><th class="r">toutes</th><th class="r">nationales</th></tr></thead>
            <tbody>${[
              ["Linéaire (circuit et CN)", [82.06, 82.80, 83.94, 82.18], 2.65, "—", 51.3, ""],
              ["Circuit quadratique seul", [82.17, 82.76, 83.92, 82.09], 2.50, "", 52.0, ""],
              ["Circuit et CN quadratiques (1re version, 7 oct.)", [82.21, 82.77, 84.04, 82.09], 2.42, "61", 52.2, ""],
              ["CN quadratique seul (le Top du 7 au 13 octobre)", [82.12, 82.80, 84.01, 82.11], 2.57, "15", 51.4, "k2"],
            ].map(([label, acc, spread, moves, old, cls]) => html`<tr><td class="${cls}">${cls ? html`<b>${label}</b>` : label}</td>
              ${acc.map((x) => html`<td class="r num ${cls}">${fmt(x, 2)} %</td>`)}<td class="r num ${cls}">${fmt(spread, 2)}</td>
              <td class="r num ${cls}">${moves || "—"}</td><td class="r num ${cls}">${fmt(old, 1)} %</td></tr>`)}</tbody></table></div>
          <p class="muted" style="font-size:13px">Part des duels bien prédits, chaque duel compté une fois, de juillet 2025 à octobre 2026, sur les mêmes duels ;
            places gagnées ou perdues face à la version linéaire, au 7 octobre 2026. Cette piste rebattait les classements, resserrait l'échelle et surévaluait
            davantage les vétérans, sans corriger le vrai défaut : les deux tiers eux-mêmes.</p>
        </section>`,

      recalage: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Une cible manquée</p>
          <h2>Le niveau publié dépassait la cible</h2>
          <p>Chaque mois, un facteur doit ramener la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN à ${fmt(pf.anchor_target)}. En forêt, il ne le faisait pas : au
            1<sup>er</sup> octobre 2026, le niveau habituel de la méthode d'alors avait ses 20 % meilleurs à ${S ? fmt(S.levels_pub.today.fit) : "6 007"} et le CN Top à ${S ? fmt(S.levels_pub.today.top) : "6 144"} ;
            la méthode retenue, avec le même recalage, les aurait eus à ${S ? fmt(S.levels_pub.cand.fit) : "6 592"} et ${S ? fmt(S.levels_pub.cand.top) : "6 757"}.</p>
          <p>La cause est une <b>dérive de l'échelle brute</b>. Un CN garde les meilleures courses, donc il dépasse le score typique du coureur ; les circuits
            suivants sont valorisés avec ces CN, et leurs scores sortent plus hauts à leur tour. L'échelle brute monte de ${S ? fmt(100 * S.levels_pub.drift.today, 2) : "0,35"} %
            par mois avec la valeur de la FFCO, de ${S ? fmt(100 * S.levels_pub.drift.cand, 2) : "0,92"} % avec la valeur géométrique (les deux tiers compensaient une
            partie de la montée). Or le facteur d'un jour vient d'un niveau qui le précède : la moyenne de 13 mois se terminant 2 mois plus tôt, lue sur le CN de
            chaque coureur actif à sa dernière course, lui-même la moyenne d'un an de courses.</p>
          <div class="mx-eq">niveau publié ≈ ${fmt(pf.anchor_target)} × exp(dérive mensuelle × retard)
            <small>sous une montée régulière, le niveau publié dépasse la cible de la montée accumulée sur le retard : 18 à 20 mois ici</small></div>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">La correction</p>
          <h2>Prolonger le niveau de sa dérive, sans faire trembler les facteurs</h2>
          <p>Trois corrections ont été essayées, qui n'utilisent que le passé, sur les mêmes données et avec la même marge de deux mois. Les facteurs doivent rester lisses : un facteur
            qui oscille mêle des scores de mois voisins sur des échelles différentes, et le CN prédit moins bien.</p>
          ${S ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th rowspan="2">Recalage (forêt)</th><th class="r" colspan="2">Méthode d'alors</th><th class="r" colspan="2">Méthode retenue</th></tr>
            <tr><th class="r">Niveau habituel</th><th class="r">CN Top</th><th class="r">Niveau habituel</th><th class="r">CN Top</th></tr></thead>
            <tbody>${S.recal.rows.map((r, i) => html`<tr class="${r.rec ? "rec" : ""}"><td>${r.rec ? html`<b>${RECAL_LABELS[i]}</b>` : RECAL_LABELS[i]}</td>
              ${[r.today.level[0], r.today.level[1], r.cand.level[0], r.cand.level[1]].map((x) => html`<td class="r num ${Math.abs(x - 5600) <= 120 ? "delta-up" : ""}">${fmt(x)}</td>`)}</tr>`)}</tbody></table></div>
          <p class="muted" style="font-size:13px">La moyenne des 20 % meilleurs CN au 1<sup>er</sup> octobre 2026 ; cible ${fmt(pf.anchor_target)}. En vert, à moins de 2 % de la cible.</p>` : noStudy}
          <ul class="mx-list">
            <li><span>Une droite ajustée sur les 13 mois et lue le jour du facteur ramène le niveau, mais coûte ${S ? ci(S.variants.For.all_holdout.Qn_t?.acc) : "−0,06"}
              point de duels pour le Top d'alors. Lue six mois plus loin, elle coûte davantage (${S ? ci(S.variants.For.all_holdout.Qm_t?.acc) : "−0,13"}) et est tombée à
              5 307 en 2022, après les saisons Covid : une pente réestimée chaque mois fait trembler les facteurs.</span></li>
            <li><span><b>Retenu</b> : prolonger la moyenne lisse de 13 mois sur 7 mois, à la dérive mesurée sur les dix dernières années. Le facteur ne change
              presque pas d'un mois à l'autre, et le coût est minime (${S ? ci(S.variants.For.all_holdout.Qe_t?.acc) : "−0,02"} point). En forêt et en sprint ; le VTT et
              le ski gardent la moyenne simple.</span></li>
            <li><span><b>Et la cohorte fixée à ${fmt(pf.anchor_target)} est celle des CN Top</b>, le CN publié, et non celle du niveau habituel (le CN Top est de 2,5 %
              environ au-dessus du niveau habituel en haut du classement, par construction). Au 1<sup>er</sup> octobre 2026 : 5 645 en forêt, 5 560 en sprint, 5 598 en VTT.</span></li>
          </ul>
        </section>`,

      resultats: () => html`
        <section class="mx-slide mx-hero">
          <p class="mx-kicker">Le Top retenu</p>
          <h2>Contre le Top quadratique, puis contre le classement officiel</h2>
          ${S ? html`<p class="mx-lead">Sur les mêmes coureurs, de ${S.holdout[0]} à ${S.holdout[1]}, la méthode retenue gagne
            ${ci(kpt("For", "gall", 3))} point de duels bien prédits sur le Top quadratique en forêt. Le gain est significatif à
            ${fmt(Object.values(S.seasons.For).filter((r) => r.acc[1] > 0).length)} saisons sur ${fmt(Object.keys(S.seasons.For).length)}, et sur les courses
            nationales (${ci(kpt("For", "gall", 3, "nat_holdout"))}). En sprint, il est de ${ci(kpt("Spr", "g23", 3))}. Depuis juillet 2025 :
            ${ci(kpt("For", "gall", 3, "all_tuned"))} en forêt, ${ci(kpt("Spr", "g23", 3, "all_tuned"))} en sprint.</p>` : ""}
        </section>
        ${S ? html`<section class="mx-slide">
          <p class="mx-kicker">Saison par saison</p>
          <h2>Contre le Top quadratique</h2>
          ${fig("fig-seasons", html`<b>La méthode retenue contre le Top quadratique</b> : gain en duels bien prédits par saison, en points, toutes les courses, avec
            les intervalles à 95 %. En vert, un gain significatif ; en rouge, une perte significative. En VTT, tout le peloton fait perdre le CN Top à chaque saison
            depuis 2022 (de façon significative de 2023 à 2026) : le VTT et le ski gardent la règle d'avant.`)}
        </section>` : ""}
        ${ev ? html`<section class="mx-slide">
          <p class="mx-kicker">Contre le classement officiel</p>
          <h2>Sur quinze saisons, avant toute mise au point</h2>
          <div class="table-wrap"><table class="data compact"><thead><tr><th></th><th class="r" colspan="2">Forêt</th><th class="r" colspan="2">Sprint</th></tr>
            <tr><th></th><th class="r">${methodShort("official")}</th><th class="r">Top</th><th class="r">${methodShort("official")}</th><th class="r">Top</th></tr></thead>
            <tbody>
              <tr><td>duels bien prédits</td><td class="r num">${lvl(hf, "acc", "official")} %</td><td class="r num"><b>${lvl(hf, "acc", "top6w3")} %</b></td><td class="r num">${lvl(hs, "acc", "official")} %</td><td class="r num"><b>${lvl(hs, "acc", "top6w3")} %</b></td></tr>
              <tr><td>écarts de temps expliqués (R²)</td><td class="r num">${lvl(hf, "r2", "official")} %</td><td class="r num"><b>${lvl(hf, "r2", "top6w3")} %</b></td><td class="r num">${lvl(hs, "r2", "official")} %</td><td class="r num"><b>${lvl(hs, "r2", "top6w3")} %</b></td></tr>
              <tr><td>duels, Top − officiel</td><td class="r num" colspan="2">${dci(hf, "top6w3-official", "acc")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-official", "acc")}</td></tr>
              <tr><td>sur les courses nationales</td><td class="r num" colspan="2">${dci(hfn, "top6w3-official", "acc")}</td><td class="r num" colspan="2">${dci(hsn, "top6w3-official", "acc")}</td></tr>
              <tr><td>R², Top − officiel</td><td class="r num" colspan="2">${dci(hf, "top6w3-official", "r2")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-official", "r2")}</td></tr>
              <tr><td>saisons où le Top l'emporte (significatif)</td><td class="r num" colspan="2">${evWins("For").join(" sur ")}</td><td class="r num" colspan="2">${evWins("Spr").join(" sur ")}</td></tr>
              ${tops.includes("top6w") ? html`<tr><td>duels, Top − Top linéaire (la méthode d'origine)</td><td class="r num" colspan="2">${dci(hf, "top6w3-top6w", "acc")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-top6w", "acc")}</td></tr>
              <tr><td>R², Top − Top linéaire</td><td class="r num" colspan="2">${dci(hf, "top6w3-top6w", "r2")}</td><td class="r num" colspan="2">${dci(hs, "top6w3-top6w", "r2")}</td></tr>` : ""}
            </tbody></table></div>
          <p class="muted" style="font-size:13px">${ev.holdout[0]}–${ev.holdout[1]}, ${fmt(ev.rows.For.all.holdout.comps)} compétitions en forêt et ${fmt(ev.rows.Spr.all.holdout.comps)} en sprint ;
            mêmes coureurs pour chaque méthode, chaque circuit pesant son nombre de coureurs. Écarts en points, avec leur intervalle à 95 %. Mesure recalculée
            à chaque mise à jour du site.</p>
        </section>
        <section class="mx-slide" id="saisons">
          <p class="mx-kicker">Saison après saison</p>
          <h2>L'écart entre deux méthodes, chaque saison, avec sa marge</h2>
          <div class="filters" id="ev-controls"></div>
          <div class="grid grid-2" id="ev-seasons"></div>
          <p class="muted" style="font-size:13px">Point : l'écart mesuré ; trait : son intervalle à 95 %. En vert, un écart significatif en faveur de la
            première méthode ; en rouge, en faveur de la seconde ; en gris, un écart non significatif. Sont comptés les circuits d'au moins ${ev.min_runners}
            coureurs comparables. La méthode officielle reprend, avant 2026, le classement commun forêt + sprint de la FFCO.</p>
        </section>
        <section class="mx-slide" id="periodes">
          <p class="mx-kicker">Toutes les méthodes</p>
          <h2>Avant la mise au point, et pendant</h2>
          <div id="ev-periods"></div>
        </section>` : html`<section class="mx-slide"><p>${t("me.val.none")}</p></section>`}
        <section class="mx-slide">
          <p class="mx-kicker">Pour les coureurs</p>
          <h2>Ce qui change dans les CN</h2>
          <ul class="mx-list">
            <li><span>Par rapport au Top quadratique publié jusqu'au 13 octobre 2026, un CN de forêt change de −8 % à +6 % (médiane −5 %), surtout parce que le niveau
              revient à ${fmt(pf.anchor_target)} ; à recalage égal, la méthode seule change un CN de 2 % en médiane, et la moitié des coureurs bougent de moins de 1,7 % du
              classement. En sprint, les CN changent de moins de 1 %.</span></li>
            <li><span>L'échelle se resserre à peine : l'écart entre le 10<sup>e</sup> et le 90<sup>e</sup> centile passe d'un facteur 2,60 à 2,47 en forêt et reste à 1,84 en sprint
              (le classement officiel : 3,4 et 2,4).</span></li>
          </ul>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Accord entre méthodes</p>
          <h2>Des classements proches, pas identiques</h2>
          <p>Chaque point est un coureur à la dernière date disponible : son CN dans une méthode proposée face à son CN officiel.</p>
          <div class="filters" id="agr-filters"></div>
          <div class="grid grid-main-side" style="align-items:start">
            ${chartCard({ id: "agr", title: t("ov.agreement"), hint: t("ov.agreement.hint"), tall: true })}
            <section class="card"><div class="card-head"><h2>${t("ov.agreeStats")}</h2></div><div id="agr-stats"></div>
              <div class="card-body"><p class="muted" style="font-size:13px;margin:0">${t("ov.agreeStats.note")}</p></div></section>
          </div>
        </section>`,

      ecartes: () => html`
        <section class="mx-slide" style="--c:var(--bad)">
          <p class="mx-kicker">Mesuré, puis écarté</p>
          <h2>Les alternatives, et ce qu'elles ont donné</h2>
          <p class="mx-lead">Chaque idée a été calculée depuis 2010 sur une copie de la base et mesurée comme la méthode retenue, sur les mêmes coureurs.
            Écarts en points de duels bien prédits, de 2012 à 2024, face au Top quadratique sauf mention contraire.</p>
          <ul class="mx-list bad">
            <li><span><b>Le CN Top comme base de la valeur des circuits</b> (un seul CN) : une perte qui grandit au fil des saisons, et des jeunes surévalués
              (<a href="#/methodes?onglet=etude&voir=choix" data-tab-link="etude" data-goto="choix">les choix de base</a>).</span></li>
            <li><span><b>Une élasticité par circuit</b> : mesurer sur chaque circuit la pente qui relie les temps aux CN et s'en servir comme k propre au
              circuit. ${S ? `${ci(onecn("For")?.IK_t)} en forêt, ${ci(onecn("Spr")?.IK_t)} en sprint, face à la méthode retenue.` : ""} Sur vingt coureurs, cette
              pente est trop bruitée, et resserrer les scores d'un circuit bruité vers la moyenne n'est pas la bonne correction.</span></li>
            <li><span><b>Des poids par course selon l'information qu'elle porte</b> : rien de significatif (${S ? ci(onecn("For")?.IW_t) : "+0,02"}). Combinés à
              l'élasticité par circuit, ils gagnent un peu en forêt (${S ? ci(onecn("For")?.IKW_t) : "+0,05"}) mais perdent en sprint depuis juillet 2025
              (${S ? ci(onecn("Spr", "all_tuned")?.IKW_t) : "−0,17"}). Les formats diffèrent peu : une longue distance porte 24 % d'information de plus qu'une
              moyenne distance.</span></li>
            <li><span><b>Un score courbé</b>, où les grandes pertes de temps coûtent moins que proportionnellement : ${S ? `${ci(S.variants.For.all_holdout.c30_t?.acc)}
              en forêt, ${ci(S.variants.Spr.all_holdout.c30_t?.acc)} en sprint` : "+0,05 en forêt, −0,28 en sprint"}.</span></li>
            <li><span><b>Le niveau estimé par maximum de vraisemblance</b> : meilleur en sprint (${S ? sg(S.mle_fit.Spr[0], 2) : "+0,37"} pour le niveau habituel),
              bien pire en forêt (${S ? sg(S.mle_fit.For[0], 2) : "−1,62"}).</span></li>
            <li><span><b>Une valeur de circuit quadratique</b> sur les deux tiers (7 octobre 2026) : elle rebat les classements, resserre l'échelle, surévalue davantage
              les vétérans, et ne corrige pas le vrai défaut (<a href="#/methodes?onglet=etude&voir=circuit" data-tab-link="etude" data-goto="circuit">la valeur du circuit</a>).</span></li>
            <li><span><b>La moyenne géométrique sur les deux tiers</b> en forêt (${S ? ci(kpt("For", "g23", 1)) : "−0,39"} à k = 1) : la coupe a déjà retiré les courses
              lentes que le logarithme aurait amorties.</span></li>
            <li><span><b>Une moyenne d'ordre 1,5 de CN × temps sur tout le peloton</b> : instable sur les courses nationales
              (${S ? ci(S.variants.For.nat_holdout.E6_t?.acc) : "−0,40"}).</span></li>
            <li><span><b>Les 85 % les plus rapides, ou l'estimateur de Huber</b> sur tout le peloton : environ 0,1 point de moins que tout le peloton au même k
              (Huber à k = 2 : ${S ? ci(k3("For")?.H1_t) : "−0,12"}).</span></li>
            <li><span><b>k = 4</b> : un peu mieux que k = 3 sur l'ensemble des courses de forêt, mais une perte sur les nationales,
              ${S ? ci(k3("For", "nat_holdout")?.G5_t) : "−0,03"} contre k = 2 ; voir <a href="#/methodes?onglet=etude&voir=score" data-tab-link="etude" data-goto="score">le score
              et la moyenne</a>.</span></li>
            <li><span><b>Tout le peloton en sprint</b> (${S ? ci(kpt("Spr", "gall", 3)) : "−0,12"}) et <b>en VTT</b> (le CN Top y perd depuis 2022).</span></li>
            <li><span><b>Les valeurs de circuit regroupées par distance en sprint</b> : l'allure n'est pas comparable d'un circuit à l'autre.</span></li>
            <li><span><b>Le z-score du logarithme du temps</b>, à la façon du classement mondial de l'IOF : moins bon que le score de la FFCO.</span></li>
            <li><span><b>Dix places, des parts de 70 et 80 %, cinq ou deux courses minimum, un recalage qui réagit à ses propres effets</b> :
              <a href="#/methodes?onglet=etude&voir=choix" data-tab-link="etude" data-goto="choix">les choix de base</a>.</span></li>
          </ul>
        </section>`,

      conclusion: () => html`
        <section class="mx-slide" style="${cvar("top6w3")}">
          <p class="mx-kicker">La méthode retenue</p>
          <h2>En ligne depuis le 13 octobre 2026</h2>
          <ul class="mx-list">
            <li><span><b>Niveau habituel</b> : celui de chaque coureur quinze jours avant la course, soit la moyenne cubique pondérée de ses ${pctOf(pf.eligible_fraction)}
              meilleurs scores Top sur 12 mois, sans plafond de places (70 % sur deux ans en VTT, trois ans en ski, en moyenne quadratique)${analyst ? html` — le ${cnLabel("fair3")}` : ""}.</span></li>
            <li><span><b>Valeur du circuit</b> : en forêt, la moyenne géométrique de niveau × temps sur tous les coureurs classés qui ont un niveau (au moins ${fmt(pf.min_ranked)}) ;
              en sprint, sur les ⌈2N/3⌉ plus rapides ; en VTT et en ski, la moyenne arithmétique de la FFCO sur les ⌈2N/3⌉ plus rapides.</span></li>
            <li><span><b>Score Top</b> : valeur du circuit ÷ temps, × le facteur de recalage du jour, fixé une fois pour toutes ; 0 pour un poinçon manquant, un abandon, une
              disqualification ou un hors-délai, et il compte.</span></li>
            <li><span><b>CN Top</b> : du meilleur score Top au moins bon, parmi les ${pctOf(pf.eligible_fraction)} meilleurs de la fenêtre, chaque course occupe autant de places que
              son poids, jusqu'à ${fmt(p6.top_n)} places : ${fmtW(pf.weights.cdf)} pour un championnat de France, ${fmtW(pf.weights.national)} pour une nationale, ${fmtW(pf.weights.other)} pour
              une autre course. Le CN Top est la moyenne cubique des scores retenus. Il faut au moins ${fmt(pf.min_scores)} courses.</span></li>
            <li><span><b>Recalage</b> : chaque jour, un facteur fixe à ${fmt(pf.anchor_target)} la moyenne des ${pctOf(pf.anchor_top_fraction)} meilleurs CN Top de chaque spécialité,
              d'après le niveau mesuré deux mois plus tôt, lissé sur 13 mois et prolongé de 7 mois à la dérive des dix dernières années (forêt, sprint).</span></li>
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
              <p>Le potentiel au meilleur niveau, nourri par les grandes compétitions ; une course de plus ne le fait jamais baisser.</p></div>
            <div class="mx-box" style="${cvar(analyst ? "fair3" : "top6w3")}"><h3>Prédire qui finira devant</h3>
              <div class="who">${analyst ? html`Le ${cnLabel("fair3")}, puis le ${cnLabel("top6w3")}` : cnLabel("top6w3")}</div>
              <p>${analyst ? "À un demi-point de duels près entre eux, et nettement devant la méthode officielle."
                : "Nettement devant la méthode officielle : 2 points de duels bien prédits de plus, en forêt comme en sprint."}</p></div>
            <div class="mx-box" style="${cvar(analyst ? "fair3" : "official")}"><h3>Mesurer le score d'une course</h3>
              <div class="who">${analyst ? `Le niveau habituel (${cnLabel("fair3")})` : "Le niveau habituel"}</div>
              <p>Le niveau habituel des coureurs présents, sur tout le peloton, sans le plafond de places qui fausserait les circuits.</p></div>
            <div class="mx-box" style="${cvar("official")}"><h3>Faire foi</h3>
              <div class="who">${cnLabel("official")}</div>
              <p>Le seul classement officiel : celui des sélections, quelles que soient ses limites.</p></div>
          </div>
          <p class="muted" style="font-size:13px;margin-top:14px">Les données proviennent du site du classement national de la FFCO ; une course absente, mal saisie ou
            corrigée ensuite peut expliquer un écart. Les méthodes proposées partent des CN de 2010 ; leurs premiers mois reflètent surtout ce point de départ.
            Leurs CN ne remplacent en aucun cas le classement officiel.</p>
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
          <p>Un club se classe selon deux choix indépendants, sur les coureurs d'un sexe et d'une tranche d'âge donnés
            (jeunes : jusqu'à H/D 20 ; adultes : H/D 21 et plus ; élite : H/D 21 seulement) :</p>
          <div class="mx-grid">
            <div class="mx-box" style="--c:var(--s1)"><h3>Ce que l'on compte</h3><p>Le <b>CN</b> de chaque coureur classé (dans la méthode choisie),
              ou ses <b>points en courses nationales</b>.</p></div>
            <div class="mx-box" style="--c:var(--s3)"><h3>Comment on l'agrège</h3><p>La <b>somme</b> (effectif et niveau à la fois), la <b>moyenne</b>
              (le niveau du coureur moyen), le <b>top 5</b> (moyenne des cinq meilleurs, un coureur manquant comptant 0) ou l'<b>effectif</b>.</p></div>
          </div>
        </section>
        <section class="mx-slide" id="elite">
          <p class="mx-kicker">Clubs</p>
          <h2>Points en courses nationales</h2>
          <p>Ils ne dépendent d'aucune méthode de CN : ils reposent sur les résultats bruts. Aux courses de niveau national (groupes A et B1 :
            championnats de France, nationales, courses de sélection), les 10 premiers de chaque catégorie marquent 25, 18, 15, 12, 10, 8, 6, 4, 2
            et 1 points ; les points sont <b>doublés aux championnats de France</b>. Une catégorie est classée sur le circuit où la majorité de ses
            coureurs ont couru. Sur la page des clubs, les points portent sur les 12 mois précédant la date choisie ; la comparaison de clubs les
            montre saison par saison.</p>
        </section>
        <section class="mx-slide" id="cfc">
          <p class="mx-kicker">Clubs</p>
          <h2>Coupe de France des clubs</h2>
          <p>La règle 2026 de la FFCO (« Classement national des clubs », annexe 2) appliquée à chaque saison : pour chaque coureur, ses 5 meilleurs scores
            de course officiels de l'année en pédestre et ses 5 meilleurs en VTT ou en ski, les points des dames multipliés par 1,4 ; le total du club.
            Calcul non officiel : tous les coureurs classés comptent (le type de licence n'est pas connu), et le club d'un coureur est celui de sa dernière
            course de l'année. La coupe n'a pas été décernée de 2023 à 2025.</p>
        </section>`,
      coureurs: () => html`
        <section class="mx-slide" id="progression">
          <p class="mx-kicker">Coureurs</p>
          <h2>Progression par âge</h2>
          <p>Pour chaque saison et chaque catégorie (H14, D21, H45…), on prend les CN de tous les coureurs classés à la fin de la saison et on en
            calcule la distribution (médiane, 50 % et 80 % centraux). Chaque mois, le CN d'un coureur est situé dans la distribution de sa
            catégorie de la saison : son <b>centile</b> est la part des coureurs de sa catégorie ayant un CN inférieur ou égal. La courbe
            « toutes saisons » regroupe les saisons depuis 2012 ; c'est une photographie de l'ensemble des coureurs, pas le suivi d'une même génération.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Coureurs</p>
          <h2>La page d'un coureur</h2>
          <ul class="mx-list">
            <li><span><b>Calcul du CN</b> : à toute date, les courses de la fenêtre, celles qui comptent et le CN qui en sort, reproduit exactement — mêmes arrondis,
              même règle des places — à partir des scores publiés course par course.</span></li>
            <li><span><b>Historique du CN</b> : chaque entrée d'une course dans la fenêtre et chaque sortie, avec le CN après et sa variation ; pour le CN officiel,
              l'historique publié par la FFCO, lu en direct.</span></li>
            <li><span><b>Évolution</b> : le CN mois par mois ; après un changement de méthode, la méthode précédente reste en gris le temps de la visite.</span></li>
            <li><span><b>Carte</b> : les courses par département ; <b>Saisons</b> : le bilan de chaque saison ; <b>Réseau</b> : les coureurs rencontrés.</span></li>
          </ul>
        </section>`,
      reseau: () => html`
        <section class="mx-slide" id="reseau">
          <p class="mx-kicker">Réseau</p>
          <h2>Qui court avec qui</h2>
          <p>Deux coureurs se « rencontrent » quand ils courent le même circuit. Sur toutes les saisons, le site retient pour chaque coureur les
            30 coureurs rencontrés le plus souvent (au moins 2 fois) ; pour une saison, il les recalcule à partir des résultats de la saison.
            Il compte aussi le nombre de fois où chacun a terminé devant l'autre ; un coureur non classé (PM, abandon…) est derrière tous les classés.</p>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Statistiques</p>
          <h2>Territoires, participation, âges</h2>
          <ul class="mx-list">
            <li><span><b>Territoires</b> : compétitions organisées, coureurs rattachés et compétitions pour 100 coureurs, par ligue ou par département. Une compétition est
              placée d'après son organisateur : le club (deux premiers chiffres de son numéro), le comité départemental ou la ligue.</span></li>
            <li><span><b>Participation</b> : les grands chiffres saison par saison, pour tous, pour une ligue ou un club, dans une spécialité ou toutes.</span></li>
            <li><span><b>Âges</b> : la répartition des compétiteurs entre les catégories d'âge, dames à gauche, hommes à droite, en part de l'ensemble choisi.</span></li>
          </ul>
        </section>`,
      resultats: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Résultats</p>
          <h2>Scores et CN provisoires</h2>
          <p>Les organisateurs publient leurs résultats le jour de la course ou le lendemain, des jours avant la FFCO. Le site les collecte (plateformes de
            résultats, site du club, dépôts des utilisateurs), reconnaît les coureurs par leur nom et leur club, et calcule des scores provisoires avec les
            formules de chaque méthode :</p>
          <ul class="mx-list">
            <li><span><b>Officiel</b> : le CN officiel J-15 de chaque coureur reconnu et la règle de la FFCO (les ⌈2N/3⌉ plus rapides, moyenne arithmétique).</span></li>
            <li><span><b>Top</b> : le niveau habituel J-15 de chaque coureur reconnu, la valeur de circuit de la méthode (géométrique, tout le peloton en forêt), le score Top
              brut × le facteur de recalage du jour ; le CN Top provisoire « après » suit la règle des places.</span></li>
            <li><span>Seules les listes <b>par circuit</b> sont notées ; une liste par catégorie l'est circuit par circuit une fois les catégories placées (d'après les listes
              par circuit de la même course, la liste d'inscription de la FFCO ou l'annonce de course). Les coureurs non reconnus restent sans CN.</span></li>
            <li><span>Provisoire jusqu'à la publication par la FFCO : les valeurs définitives peuvent différer (résultats corrigés, coureurs ajoutés).</span></li>
          </ul>
        </section>
        <section class="mx-slide">
          <p class="mx-kicker">Temps intermédiaires</p>
          <h2>Le temps perdu et les erreurs</h2>
          <ul class="mx-list">
            <li><span>Sur chaque inter-poste, le <b>temps perdu</b> est l'écart du coureur à son allure habituelle sur la course (sa place moyenne sur les autres postes),
              signé : négatif quand il va plus vite que d'habitude.</span></li>
            <li><span>Une <b>erreur</b> est un inter-poste où le coureur a perdu au moins 20 % du temps de l'inter-poste <b>et</b> au moins 10 secondes (les deux seuils se règlent).
              « Perdu » et « Sans temps perdu » ne comptent que les erreurs.</span></li>
            <li><span>Les <b>écarts</b> se mesurent au « superman », le meilleur temps de chaque inter-poste, parmi tous les coureurs ou ceux que l'on compare.</span></li>
            <li><span>Les <b>groupes</b> repèrent les coureurs qui pointent les mêmes postes à quelques secondes d'intervalle, poste après poste.</span></li>
          </ul>
        </section>`,
      relais: () => html`
        <section class="mx-slide">
          <p class="mx-kicker">Relais</p>
          <h2>Le simulateur de relais</h2>
          <ul class="mx-list">
            <li><span><b>Le modèle</b> : un coureur de CN c court un relais en k × temps de référence ÷ c ; k est réglé pour que la meilleure équipe de tous les clubs
              totalise la somme des temps de référence du format (CNE : la moyenne des 5 meilleures équipes).</span></li>
            <li><span><b>Les formats</b> suivent les règles 2026 de la FFCO : CFC N1 à N4 avec leurs critères de composition et leurs relais réservés (les premiers et
              derniers relais dames/hommes alternent avec la parité de l'année), CNE hommes, dames, jeunes et mini, relais de catégorie, relais sprint
              (2 dames, 2 hommes, D-H-H-D) — ou un format de son choix.</span></li>
            <li><span><b>La meilleure équipe est exacte</b> : chaque affectation possible des critères aux relais, puis l'algorithme hongrois ; l'âge et le sexe viennent de la
              catégorie (un vétéran courant en H21 compte 21). La première équipe se modifie coureur par coureur ; un compte peut ajouter les coureurs
              sans CN (étrangers, relais seulement), avec le CN attendu.</span></li>
          </ul>
        </section>`,
      limites: () => html`
        <section class="mx-slide" id="limites">
          <p class="mx-kicker">À garder en tête</p>
          <h2>Limites et précautions</h2>
          <ul class="mx-list bad">
            <li><span>Les données proviennent du site du CN de la FFCO. Une course absente, mal saisie ou corrigée ensuite peut expliquer un écart.</span></li>
            <li><span>Les méthodes proposées partent des CN de 2010 ; les premiers mois reflètent surtout ce point de départ.</span></li>
            <li><span>Leurs CN ne remplacent en aucun cas le classement officiel, qui reste la seule référence.</span></li>
            <li><span>Les instantanés du classement sont calculés en fin de mois ; la page d'un coureur détaille le calcul à n'importe quelle date.</span></li>
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
  const computed = M.filter((m) => m !== "official");
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
      ...(computed.includes("fair") && computed.includes("top6w") ? [vs("fair", "top6w")] : []),
    ];
    $("#agr-stats").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th>${t("ov.pair")}</th><th class="r">n</th><th class="r">r</th><th class="r">${t("ov.bias")}</th><th class="r">${t("ov.mae")}</th></tr></thead>
      <tbody>${stats.map((s) => html`<tr><td>${s.name}</td><td class="r num">${fmt(s.n)}</td>
        <td class="r num">${fmt(s.r, 3)}</td><td class="r num">${fmtSigned(Math.round(s.bias))}</td><td class="r num">${fmt(s.mae)}</td></tr>`)}</tbody></table></div>`;
    $("#agr-table").innerHTML = $("#agr-stats").innerHTML;
  }
  // the evaluation's season-by-season chart: one measure, one comparison, one scope, forest and sprint side by side
  let evMeas = "acc", evPair = "top6w3-official", evScope = "all", evPeriod = "holdout";
  const EV_PAIRS = () => (analyst ? ev.pairs : ["top6w3-official", "top6w3-top6w"]);
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
        ...[["holdout", `${ev.holdout[0]}–${String(ev.holdout[1]).slice(2)}`], ["tuned", "réglage"]]
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
      <div class="filters"><div class="field"><span>Période</span>${seg("evq", [["holdout", `${ev.holdout[0]}–${ev.holdout[1]} (contrôle)`],
        ["tuned", "juillet 2025 – octobre 2026 (réglage)"]], evPeriod)}</div></div>
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
