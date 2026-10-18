// « Catégories » (#/categories, menu « Classement » after « Classement »; owner, 2026-10-18): how each class's CNs are
// spread at a month-end, side by side on one CN axis — a band from the 10th to the 90th percentile, the middle half
// darker, the median and the mean —, and the runners who stand out in their class. The method and the discipline are the
// site's; the rows are loadRanking's (every ranked runner of France, their class as at the end of that year).
//
// « Exceptionnel » (owner's choice, 2026-10-18): a CN above Q3 + 1.5 × the interquartile range of the class (the box
// plot's fence), in its top 5 % (percentile ≥ 95), in a class of at least 20 ranked runners. Classes of 5 to 19 are drawn
// pale and have none; under 5 they are left out. The signed-in runner is marked on their class's row, and their club's
// runners can be shown as rings. Everything is computed here from the published monthly snapshots.

import { html, raw, $, $$, fmt, fmtCat, ord, quantile, mean, pctN, debounce } from "../util.js";
import { t, tn } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { css } from "../charts.js";
import { dataTable, filterFold, seg, cnLabel } from "../ui.js";
import { link, replaceQuery, terrainField } from "../app.js";
import * as auth from "../auth.js";
import { loadRanking, dateControls, bindDateControls } from "./ranking.js";

const MIN_SHOWN = 5, MIN_OUT = 20, MIN_PCT = 95;
const AGE_ORDER = (cat) => Number(cat.slice(1));

/** Each class's distribution at a month: [{ cat, sexe, n, p10, p25, p50, p75, p90, mean, fence, rows }], by age then
 *  women before men; and every runner's place in their class. */
function classes(rows, m) {
  const by = new Map();
  for (const r of rows) {
    const v = r.cn[m];
    if (v == null || !/^[HD]\d{1,2}$/.test(r.cat)) continue;
    if (!by.has(r.cat)) by.set(r.cat, []);
    by.get(r.cat).push(r);
  }
  const out = [];
  for (const [cat, rs] of by) {
    if (rs.length < MIN_SHOWN) continue;
    const v = rs.map((r) => r.cn[m]).sort((a, b) => a - b);
    const q = (p) => quantile(v, p);
    const c = { cat, sexe: cat[0], n: v.length, sorted: v, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9),
      mean: mean(v), rows: rs };
    c.fence = c.p75 + 1.5 * (c.p75 - c.p25);
    out.push(c);
  }
  return out.sort((a, b) => AGE_ORDER(a.cat) - AGE_ORDER(b.cat) || (a.sexe === b.sexe ? 0 : a.sexe === "D" ? -1 : 1));
}
/** The share (in %) of a class's runners whose CN is lower than `v`. */
const below = (sorted, v) => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return (100 * lo) / sorted.length;
};

export async function render(main, { query }) {
  const f = {
    month: query.date ? data.monthFor(query.date) : data.latestMonth(),
    sexe: ["D", "H"].includes(query.sexe) ? query.sexe : "",
    ref: query.ref !== "0", club: query.club === "1",
  };
  const terrain = store.get().terrain;
  const me = auth.session();
  const myClub = auth.myClub();
  let all = null, cls = [], outs = [], table = null;

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("cg.title")}</h1><p class="lede">${t("cg.lede")}</p></div></div>
    ${filterFold(html`<div class="filters" id="cg-filters"></div>`)}
    <section class="card" id="cg-card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>${t("cg.chart", { cn: cnLabel(store.get().method) })}</h2><div class="hint">${t("cg.chart.hint")}</div></div></div>
      <div class="card-body">
        <div class="cg-legend" id="cg-legend"></div>
        <div class="cg-plot" id="cg-plot"><svg id="cg-svg" width="100%" role="img" aria-label="${t("cg.chart", { cn: cnLabel(store.get().method) })}"></svg>
          <div class="cg-tip" id="cg-tip" hidden></div></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2 id="cg-out-title">${t("cg.out")}</h2><div class="hint">${t("cg.out.hint", { min: MIN_OUT, pct: pctN(MIN_PCT) })}</div></div></div>
      <div id="cg-table"></div>
    </section>`;

  function syncUrl() {
    replaceQuery({ date: f.month.slice(0, 7) === data.latestMonth().slice(0, 7) ? null : f.month.slice(0, 7),
      sexe: f.sexe || null, ref: f.ref ? null : "0", club: f.club ? "1" : null });
  }

  function drawFilters() {
    $("#cg-filters").innerHTML = html`${terrainField()}
      ${dateControls(f.month)}
      <div class="field"><span>${t("f.sexe")}</span>${seg("cgs", [["", t("sexe.all")], ["D", t("sexe.D")], ["H", t("sexe.H")]], f.sexe)}</div>
      <label class="checkline"><input type="checkbox" id="cg-ref" ${raw(f.ref ? "checked" : "")}>${t("cg.ref", { w: fmtCat("D21"), m: fmtCat("H21") })}</label>
      ${myClub ? html`<label class="checkline"><input type="checkbox" id="cg-club" ${raw(f.club ? "checked" : "")}>${t("cg.club")}</label>` : ""}`;
    bindDateControls(main, (m) => { f.month = m; reload(); });
    $$('[data-seg="cgs"]', main).forEach((b) => b.addEventListener("click", () => { f.sexe = b.dataset.value; drawFilters(); refresh(); }));
    $("#cg-ref").addEventListener("change", (e) => { f.ref = e.target.checked; refresh(); });
    $("#cg-club")?.addEventListener("change", (e) => { f.club = e.target.checked; refresh(); });
  }

  async function reload() {
    $("#cg-card").classList.add("loading-veil");
    const m = store.get().method;
    all = (await loadRanking([m], terrain, f.month)).rows;
    $("#cg-card").classList.remove("loading-veil");
    cls = classes(all, m);
    // the runners who stand out: above the class's fence, in its top 5 %, in a class of 20 or more
    const ref = Object.fromEntries(cls.filter((c) => c.cat === "H21" || c.cat === "D21").map((c) => [c.sexe, c]));
    outs = [];
    for (const c of cls) {
      if (c.n < MIN_OUT) continue;
      for (const r of c.rows) {
        const v = r.cn[m];
        if (v > c.fence && (r.pct[m] ?? 0) >= MIN_PCT) {
          const rc = ref[c.sexe];
          outs.push({ ...r, v, cls: c, xMed: v / c.p50, refPct: rc && rc !== c ? below(rc.sorted, v) : null });
        }
      }
    }
    outs.sort((a, b) => b.xMed - a.xMed);
    drawFilters();
    refresh();
  }

  function refresh() {
    syncUrl();
    drawChart();
    drawTable();
  }

  // ---- the chart: one lane per class, women and men side by side for each age, on one CN axis -------------------------
  function drawChart() {
    const m = store.get().method;
    const shown = cls.filter((c) => !f.sexe || c.sexe === f.sexe);
    const svg = $("#cg-svg"), plot = $("#cg-plot");
    if (!shown.length) {
      svg.setAttribute("height", 0); svg.innerHTML = "";
      $("#cg-legend").innerHTML = html`<div class="empty">${t("cg.none")}</div>`;
      return;
    }
    const col = { D: css("--s2"), H: css("--s1") }, ink = css("--ink-2"), muted = css("--ink-3"), grid = css("--grid"),
      surf = css("--surface") || "#fff";
    const both = !f.sexe;
    const W = plot.clientWidth || 680, L = 40, R = 14, T = 22, lane = both ? 12 : 17, gap = both ? 8 : 6;
    const ages = [...new Set(shown.map((c) => AGE_ORDER(c.cat)))];
    const H = T + ages.length * ((both ? 2 : 1) * lane + gap) + 24;
    // what is drawn on the classes shown only: the runners who stand out, oneself, one's club
    const inShown = (r) => shown.some((c) => c.cat === r.cat);
    const outsShown = outs.filter(inShown);
    const mine = me ? all.find((r) => r.lic === me.lic && r.cn[m] != null && inShown(r)) : null;
    const club = f.club && myClub ? all.filter((r) => r.clubCode === myClub && r.cn[m] != null && inShown(r)) : [];
    const top = Math.max(...shown.map((c) => c.p90), ...outsShown.map((o) => o.v), mine ? mine.cn[m] : 0, ...club.map((r) => r.cn[m]));
    const low = Math.min(...shown.map((c) => c.p10), mine ? mine.cn[m] : Infinity, ...club.map((r) => r.cn[m]));
    const step = top - low > 5000 ? 1000 : 500;
    // the axis from a round value below the lowest band (or ring) to one above the highest: no width lost under 0
    const x0 = Math.max(0, Math.floor(low / step) * step), x1 = Math.ceil(top / step) * step;
    const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
    const yOf = new Map();
    let y = T;
    for (const a of ages) {
      for (const s of both ? ["D", "H"] : [f.sexe]) { const c = shown.find((k) => k.cat === `${s}${a}`); if (c) yOf.set(c.cat, y); if (both || c) y += lane; }
      y += gap;
    }
    let s = "";
    for (let v = x0; v <= x1; v += step) {
      s += `<line x1="${X(v)}" x2="${X(v)}" y1="${T - 6}" y2="${H - 22}" stroke="${grid}"/>`;
      if ((v - x0) % (step * (W < 520 ? 2 : 1)) === 0) s += `<text x="${X(v)}" y="${H - 7}" font-size="11" fill="${muted}" text-anchor="middle">${fmt(v)}</text>`;
    }
    if (f.ref) {
      for (const c of shown.filter((k) => k.cat === "D21" || k.cat === "H21")) {
        s += `<line x1="${X(c.p50)}" x2="${X(c.p50)}" y1="${T - 8}" y2="${H - 22}" stroke="${col[c.sexe]}" stroke-dasharray="3 3" opacity=".75"/>`
          // the women's label left of its line, the men's right of theirs (their median is the higher): never on each other
          + `<text x="${X(c.p50) + (c.sexe === "D" ? -3 : 3)}" y="${T - 10}" font-size="11" fill="${col[c.sexe]}" text-anchor="${c.sexe === "D" ? "end" : "start"}">${t("cg.medianOf", { cat: fmtCat(c.cat) })}</text>`;
      }
    }
    for (const a of ages) {
      const ys = shown.filter((c) => AGE_ORDER(c.cat) === a).map((c) => yOf.get(c.cat));
      s += `<text x="${L - 8}" y="${(Math.min(...ys) + Math.max(...ys) + lane) / 2 + 4}" font-size="12" fill="${ink}" text-anchor="end">${a}</text>`;
    }
    for (const c of shown) {
      const yy = yOf.get(c.cat), cy = yy + lane / 2, h = lane - 3, small = c.n < MIN_OUT, op = small ? 0.45 : 1;
      s += `<g class="cg-row" data-cat="${c.cat}" opacity="${op}">`
        + `<rect x="${L}" y="${yy}" width="${W - L - R}" height="${lane}" fill="transparent"/>`
        + `<rect x="${X(c.p10)}" y="${cy - h / 4}" width="${Math.max(1, X(c.p90) - X(c.p10))}" height="${h / 2}" rx="2" fill="${col[c.sexe]}" opacity=".28"/>`
        + `<rect x="${X(c.p25)}" y="${cy - h / 2}" width="${Math.max(1, X(c.p75) - X(c.p25))}" height="${h}" rx="2" fill="${col[c.sexe]}" opacity=".85"/>`
        + `<line x1="${X(c.p50)}" x2="${X(c.p50)}" y1="${cy - h / 2}" y2="${cy + h / 2}" stroke="${surf}" stroke-width="2"/>`
        + `<path d="M${X(c.mean)} ${cy - 3.5}l3.5 3.5-3.5 3.5-3.5-3.5z" fill="${ink}"/></g>`;
    }
    for (const r of club) {
      if (!yOf.has(r.cat)) continue;
      s += `<circle class="cg-dot" data-lic="${r.lic}" data-kind="club" cx="${X(r.cn[m])}" cy="${yOf.get(r.cat) + lane / 2}" r="3.2" fill="none" stroke="${ink}" stroke-width="1.2"/>`;
    }
    for (const o of outsShown) {
      if (!yOf.has(o.cat)) continue;
      s += `<circle class="cg-dot" data-lic="${o.lic}" data-kind="out" cx="${X(o.v)}" cy="${yOf.get(o.cat) + lane / 2}" r="4.2" fill="${col[o.sexe]}" stroke="${surf}" stroke-width="1.5"/>`;
    }
    if (mine && yOf.has(mine.cat)) {
      const mx = X(mine.cn[m]), my = yOf.get(mine.cat) + lane / 2;
      s += `<circle class="cg-dot" data-lic="${mine.lic}" data-kind="me" cx="${mx}" cy="${my}" r="6" fill="none" stroke="${css("--flag") || ink}" stroke-width="2.2"/>`
        + `<text x="${mx}" y="${my - 8}" font-size="11" font-weight="600" fill="${css("--flag") || ink}" text-anchor="middle">${t("cg.me")}</text>`;
    }
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);
    svg.innerHTML = s;
    const sw = (c, o) => `<span class="cg-sw" style="background:${c};opacity:${o}"></span>`;
    $("#cg-legend").innerHTML = html`
      ${both || f.sexe === "D" ? raw(`<span>${sw(col.D, 0.85)}${t("ag.women")}</span>`) : ""}
      ${both || f.sexe === "H" ? raw(`<span>${sw(col.H, 0.85)}${t("ag.men")}</span>`) : ""}
      <span>${raw(`<span class="cg-dotlg" style="background:${ink}"></span>`)}${t("cg.legend.out")}</span>
      ${mine ? html`<span>${raw(`<span class="cg-dotlg ring" style="border-color:${css("--flag") || ink}"></span>`)}${t("cg.legend.me")}</span>` : ""}
      ${club.length ? html`<span>${raw(`<span class="cg-dotlg ring thin" style="border-color:${ink}"></span>`)}${t("cg.legend.club")}</span>` : ""}
      ${shown.some((c) => c.n < MIN_OUT) ? html`<span class="muted">${t("cg.legend.small", { min: MIN_OUT })}</span>` : ""}`;
  }

  // the tooltip: a class's figures over its row, a runner's over their dot; a dot opens the runner's page
  const tip = () => $("#cg-tip");
  function showTip(e, body) {
    const el = tip(), box = $("#cg-plot").getBoundingClientRect();
    el.innerHTML = body;
    el.hidden = false;
    const w = el.offsetWidth;
    let left = e.clientX - box.left + 14;
    if (left + w > box.width) left = e.clientX - box.left - w - 14;
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${e.clientY - box.top + 12}px`;
  }
  const runnerTip = (r, kind) => {
    const m = store.get().method, c = cls.find((k) => k.cat === r.cat), v = r.cn[m];
    const o = kind === "out" ? outs.find((x) => x.lic === r.lic) : null;
    return html`<b>${r.name}</b> · ${fmtCat(r.cat)}${r.clubCode ? ` · ${r.clubCode}` : ""}<br>
      ${cnLabel(m)} ${fmt(v)} · ${t("cg.tip.pct", { p: data.fmtPct(r.pct[m]) })}
      ${c ? html`<br>${t("cg.tip.xmed", { x: fmt(v / c.p50, 2) })}` : ""}
      ${o?.refPct != null ? html`<br>${t("cg.tip.ref", { p: data.fmtPct(o.refPct), cat: fmtCat(`${o.sexe}21`) })}` : ""}`;
  };
  const plotEl = $("#cg-plot");
  plotEl.addEventListener("mousemove", (e) => {
    const dot = e.target.closest(".cg-dot");
    if (dot) {
      const r = all.find((x) => x.lic === dot.dataset.lic);
      if (r) { showTip(e, runnerTip(r, dot.dataset.kind)); return; }
    }
    const row = e.target.closest(".cg-row");
    if (row) {
      const c = cls.find((k) => k.cat === row.dataset.cat);
      showTip(e, html`<b>${fmtCat(c.cat)}</b> · ${tn("cg.runners", c.n)}${c.n < MIN_OUT ? html` <span class="muted">· ${t("cg.small")}</span>` : ""}<br>
        ${ord(10)} ${fmt(c.p10)} · ${ord(25)} ${fmt(c.p25)}<br>
        ${t("cg.median")} ${fmt(c.p50)} · ${t("cg.mean")} ${fmt(c.mean)}<br>
        ${ord(75)} ${fmt(c.p75)} · ${ord(90)} ${fmt(c.p90)}`);
      return;
    }
    tip().hidden = true;
  });
  plotEl.addEventListener("mouseleave", () => { tip().hidden = true; });
  plotEl.addEventListener("click", (e) => {
    const dot = e.target.closest(".cg-dot");
    if (dot) location.hash = link.runner(dot.dataset.lic);
  });

  // ---- the runners who stand out ----------------------------------------------------------------------------------------
  function drawTable() {
    const m = store.get().method;
    const rows = outs.filter((o) => !f.sexe || o.sexe === f.sexe);
    $("#cg-out-title").textContent = `${t("cg.out")} · ${fmt(rows.length)}`;
    if (!rows.length) { $("#cg-table").innerHTML = html`<div class="empty">${t("cg.noOut")}</div>`; table = null; return; }
    table = dataTable($("#cg-table"), {
      rows, sortKey: "xmed", sortDir: -1, compact: true,
      columns: [
        { key: "name", label: t("rk.col.name"), sort: (r) => r.key, defaultDir: 1,
          render: (r) => html`<a class="name" href="${link.runner(r.lic)}">${r.name}</a>${me && r.lic === me.lic ? html` <span class="tag">${t("cg.me")}</span>` : ""}` },
        { key: "cat", label: t("rk.col.cat"), sort: (r) => `${r.sexe}${String(AGE_ORDER(r.cat)).padStart(2, "0")}`, defaultDir: 1 },
        { key: "club", label: t("rk.col.club"), cls: "num", sort: (r) => r.clubCode, defaultDir: 1,
          render: (r) => (r.clubCode ? html`<a href="${link.club(r.clubCode)}" title="${data.clubName(r.club)}">${r.clubCode}</a>` : "") },
        { key: "cn", label: cnLabel(m), align: "r", cls: "num", sort: (r) => r.v, render: (r) => fmt(r.v) },
        { key: "pct", label: t("rk.col.pct"), align: "r", cls: "num", sort: (r) => r.pct[m], render: (r) => data.fmtPct(r.pct[m]) },
        { key: "xmed", label: t("cg.col.xmed"), align: "r", cls: "num", sort: (r) => r.xMed, render: (r) => fmt(r.xMed, 2) },
        { key: "ref", label: t("cg.col.ref", { w: fmtCat("D21"), m: fmtCat("H21") }), align: "r", cls: "num", sort: (r) => r.refPct,
          render: (r) => (r.refPct == null ? html`<span class="dim">—</span>` : data.fmtPct(r.refPct)) },
      ],
    });
  }

  const onResize = debounce(() => { if (main.isConnected && cls.length) drawChart(); }, 150);
  window.addEventListener("resize", onResize);
  await reload();
  return { title: t("cg.title"), cleanup: () => window.removeEventListener("resize", onResize) };
}
