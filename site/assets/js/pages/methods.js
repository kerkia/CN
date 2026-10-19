// The documentation, in four tabs (owner, 2026-10-14): « CN officiel » and « Méthode Ozimut », each the method's rules and
// formulas, facts only; « L'étude », the white paper — objectives, method of evaluation, the point of departure, the
// choices, the score and its mean, the circuit's value, the recalage, the results, the alternatives discarded, the
// conclusion — with the figures that support each decision (site/assets/study.json, the study of 13 October 2026, and
// the live evaluation, site/data/evaluation.json) and the PDF; « Les calculs du site », the other calculations. The
// study and the site's calculations have chapters as a second row of tabs (?voir=). Only the methods this account sees
// are named; the Fit is never named (owner, 2026-10-14: the circuits are measured from the scores the runners present earned
// in their previous races, their « niveau habituel », not from another ranking).

import { html, raw, $, $$, fmt, fmtSigned, mean } from "../util.js";
import { t, lang } from "../i18n.js";
import * as data from "../data.js";
import { timeChart, scatterChart, methodColor, terrainColor, METHOD_SLOT, css } from "../charts.js";
import { TERRAINS, available } from "../store.js";
import { chartCard, bindChartCard, legend, methodKey, methodLabel, methodShort, seg, cnLabel } from "../ui.js";
import { replaceQuery } from "../app.js";
import * as TR from "../tracer/icons.js";
import * as TRD from "../tracer/ribbon-data.js";

// the white paper in the reader's language (docs/whitepaper: methode-ozimut.tex, methode-ozimut.en.tex; the old ocn-methode-top*.pdf
// are copies kept for old links)
const PDF = lang() === "en" ? "assets/ozimut-methode.en.pdf" : "assets/ozimut-methode.pdf";
const cvar = (m) => `--c:var(--s${METHOD_SLOT[m]})`;
const MINUS = "−";

// Race-score exponent k, measured once on database copies (7 October 2026) with the strength CN (Fit), on
// the same pairs: ln(score) = C − k·ln(time). Reference period July 2025 - October 2026; ski over 2010-2025
// (2 to 4 races a season). Then 2018-2024 for forest and sprint, as a check.
const EXAMPLE = [[7200, "cdf"], [6900, "other"], [6800, "national"], [6500, "other"], [6400, "other"],
  [6100, "other"], [5900, "other"], [5600, "other"], [5200, "other"], [4800, "other"]];
// The recalage corrections tried (study of 13 October 2026), in the order of study.json's rows.
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
/** The separator inside an interval: « [a ; b] » in French, « [a, b] » in English. */
const SEP = () => (lang() === "en" ? ", " : " ; ");
const ci = (a, dec = 2, pt = false) => (a ? `${sg(a[0], dec, pt)} [${sg(a[1], dec, pt)}${SEP()}${sg(a[2], dec, pt)}]` : "—");
/** The opposite difference (b − a from a − b), its interval turned round. */
const neg = (a) => (a ? [-a[0], -a[2], -a[1]] : null);
/** Gridlines: a round step giving at most eight lines, and the decimals it needs. */
const tickStep = (span) => [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find((x) => span / x <= 8) || 10;
const tickDec = (x) => (x >= 1 ? 0 : x >= 0.1 && Number.isInteger(Math.round(x * 1000) / 100) ? 1 : 2);
const est = (a) => a && (a[1] > 0 || a[2] < 0);
const star = (a) => (est(a) ? "*" : "");

export async function render(main, { query = {} } = {}) {
  const meta = data.meta();
  const pf = meta.methods.fair.params, p6 = meta.methods.top6w.params;
  // the methods the documentation names: the official one and Ozimut (top6w); never the usual level (fair)
  const M = available();
  const analyst = false;                      // (no analysis methods since 2026-10-19; the content modules still take it)
  const tops = ["top6w"];
  const fmtW = (w) => fmt(w, Number.isInteger(w) ? 0 : 1);
  // a discipline's own value: meta files the params under the codes (For, Spr, VTT, Ski); the French name kept as a fallback
  const own = (p, tr, key) => p.by_terrain?.[tr]?.[key] ?? p.by_terrain?.[TNAME[tr]]?.[key] ?? p[key];
  const TNAME = { For: "Forêt", Spr: "Sprint", VTT: "VTT", Ski: "Ski" };     // meta's keys (i18n-ignore)

  // the live evaluation (site_eval.py) and the 2025 duel validation; the study's numbers (a static file, public)
  const [v, ev, study] = await Promise.all([data.validation(), data.evaluation(),
    fetch("assets/study.json", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  const season = v ? v.season || Object.keys(v.acc.For?.all || {}).pop() : null;
  const VM = v ? M.filter((m) => v.methods.includes(m)) : [];
  const ref = VM.includes("top6w") ? "top6w" : null;
  const entry = (tr, scope = "all") => (v?.acc?.[tr]?.[scope]?.[season]?.[0] ? v.acc[tr][scope][season] : null);
  const right = (e, m) => e[1 + v.methods.indexOf(m)];
  const share = (e, m) => (100 * right(e, m)) / e[0];

  // ---- the evaluation: helpers ---------------------------------------------------------------------------------
  // the published measures (owner, 2026-10-14): the duels called right, each circuit weighing its runners, and the R²;
  // evaluation.json also carries Kendall's tau (2 × the duels − 1) and the Plackett-Luce information, not shown
  const EVM = ["acc", "r2"];
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
  const evWins = (tr, pair = "top6w-official") => {
    const ss = evSeasons(tr);
    return [ss.filter((y) => evRows(tr)[y].d[pair]?.acc[1] > 0).length, ss.length];
  };
  const lvl = (e, meas, m) => evFmt(meas, e[meas][m], false);
  const hf = ev ? evRows("For").holdout : null, hs = ev ? evRows("Spr").holdout : null;
  const hfn = ev ? evRows("For", "nat").holdout : null, hsn = ev ? evRows("Spr", "nat").holdout : null;
  const dci = (e, pair, meas) => (e?.d?.[pair]?.[meas] ? `${evFmt(meas, e.d[pair][meas][0])}${EV_UNIT[meas]} [${evFmt(meas, e.d[pair][meas][1])}${SEP()}${evFmt(meas, e.d[pair][meas][2])}]` : "—");

  // the second row of tabs of a panel: `?voir=` picks the chapter
  const subTabs = (chapters, current) => html`<nav class="mx-subtabs" role="tablist">${chapters.map(([k, label], i) => html`<button type="button" role="tab"
    data-subtab="${k}" aria-selected="${String(k === current)}"><span class="mx-n">${i + 1}</span>${label}</button>`)}</nav>
    ${chapters.map(([k]) => html`<div data-subpanel="${k}"${k === current ? "" : " hidden"}></div>`)}`;
  // per discipline: the window, the share of best scores, the share of the field valuing a circuit (the published method, pf)
  const windows = TERRAINS.map((tr) => [tr, own(pf, tr, "window_days"), own(pf, tr, "eligible_fraction"), own(pf, tr, "sample_fraction") ?? 2 / 3]);

  // ---- the worked circuit used throughout the documentation (owner, 2026-10-14: the doc is for humans, not mathematicians):
  // six runners with a CN (for the Top, read « niveau habituel »), in finishing order; F got lost
  const RACE6 = [["A", 6000, 50], ["B", 5500, 56], ["C", 5000, 62], ["D", 4500, 66], ["E", 4000, 80], ["F", 5000, 90]];
  const r6 = (() => {
    const prod = RACE6.map(([, c, tm]) => c * tm);
    const amean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const gmean = (xs) => Math.exp(amean(xs.map(Math.log)));
    // the fastest share of the field, rounded up; all four when a circuit has only four (the official rule, kept)
    const keepOf = (f) => (prod.length === pf.min_ranked ? prod.length : Math.max(1, Math.ceil(f * prod.length)));
    const keepOff = Math.ceil((2 * prod.length) / 3);
    const value = (tr) => amean(prod.slice(0, keepOf(own(pf, tr, "sample_fraction") ?? 2 / 3)));
    return { prod, keep: keepOff, keepFor: keepOf(own(pf, "For", "sample_fraction") ?? 2 / 3), off: amean(prod.slice(0, keepOff)),
      topFor: value("For"), topSpr: value("Spr"), arithAll: amean(prod), geoAll: gmean(prod) };
  })();
  const n0 = (x) => fmt(Math.round(x));
  const more = (label, body) => html`<details class="mx-more" style="margin:12px 0"><summary style="cursor:pointer;font-weight:600">${label}</summary>
    <div style="margin-top:10px">${body}</div></details>`;

  // the words: one module per language (content/methods.fr.js, methods.en.js), given the helpers and data above
  const C = (await import(`../content/methods.${lang()}.js`).catch(() => import("../content/methods.fr.js"))).build({ html, raw, $, $$, fmt, fmtSigned, mean, t, data, timeChart,
    scatterChart, methodColor, terrainColor, METHOD_SLOT, css, TERRAINS, available, chartCard, bindChartCard, legend, methodKey,
    methodLabel, methodShort, seg, cnLabel, replaceQuery, TR, TRD, PDF, cvar, MINUS, EXAMPLE, pearson, roundHalfUp, sg, ci, neg,
    tickStep, tickDec, est, star, SEP, main, meta, pf, p6, M, analyst, tops, fmtW, own, TNAME, v, ev, study, season, VM, ref, entry,
    right, share, EVM, EV_UNIT, evRows, evSeasons, evFmt, pairLabel, evWins, lvl, hf, hs, hfn, hsn, dci, subTabs, windows, RACE6,
    r6, n0, more });
  const { TABS } = C;
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("page.methods")}</h1>
      <p class="lede">${C.lede}</p></div></div>
    <nav class="mx-tabs" role="tablist">${TABS.map(([k, label], i) => html`<button type="button" role="tab" data-tab="${k}"
      aria-selected="false"><span class="mx-n">${i + 1}</span>${label}</button>`)}</nav>
    ${TABS.map(([k]) => html`<div data-panel="${k}" role="tabpanel" hidden></div>`)}
    <p class="muted" style="font-size:13px;margin-top:8px">${C.note}</p>`;

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
  // the study's figures (SVG), drawn when their chapter is first shown
  function drawStudyFigures() {}            // the first study's SVG figures left with their chapters (2026-10-16)
  const DRAW = { top: drawNorm, etude: () => {} };
  const DRAW_CHAPTER = { resultats: () => { C.drawAgreement(); C.drawEval(); } };
  const BUILD = { officiel: C.officiel, top: C.top, etude: C.etude, calculs: C.calculs, tracer: C.tracerDoc };

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
  // the study's chapters until 2026-10-16, folded into « Les choix et les variantes »
  const OLD_CH = { score: "choix", circuit: "choix", recalage: "choix", ecartes: "choix" };
  show(first, OLD_CH[query.voir] || query.voir, true);
  return { title: t("page.methods") };
}
