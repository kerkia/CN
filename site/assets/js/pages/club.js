// Club: headline figures, how the club's ranked headcount and mean CN moved
// over time, and its roster with each runner's current CN.

import { html, raw, $, $$, fmt, fmtDate, displayName, addDays, isoDay, ord } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { E, C } from "../data.js";
import { timeChart, columnChart, methodColor, css } from "../charts.js";
import {
  methodChips, bindMethodChips, terrainSeg, bindTerrainSeg, chartCard, bindChartCard,
  legend, dataTable, tile, methodLabel, methodShort, seg, errorBox, terrainTag,
} from "../ui.js";

const WEEK_MAX_CATS = 6;       // up to this many categories on a circuit, places count per category
import { loadRanking } from "./ranking.js";
import { link, replaceQuery } from "../app.js";

export async function render(main, { arg: code, query }) {
  const meta = data.meta();
  const series = (await data.clubSeries(code))?.monthly;
  const name = meta.names.clubs[code];
  if (!series && !name) { main.innerHTML = errorBox(t("err.notfound")); return; }
  let range = query.range || "all";
  const STATS = ["mean", "max", "sum", "top5"];
  let stat = STATS.includes(query.stat) ? query.stat : "mean";
  let wkTo = isoDay(new Date()), wkFrom = addDays(wkTo, -7);        // period of the best results
  const members = data.runners().list.filter((r) => data.clubParts(r.club).code === code);
  const ligue = data.clubParts(members[0]?.club).ligue;

  main.innerHTML = html`
    <div class="crumbs"><a href="#/clubs">${t("nav.clubs")}</a><span>›</span><span>${name || code}</span></div>
    <section class="card" style="margin-bottom:16px;padding:20px 22px">
      <div class="row" style="align-items:flex-start"><h1 style="flex:1;min-width:0">${name || code}</h1>
        <div class="row"><button class="btn" type="button" id="cmp-club"></button>
        <a class="btn" href="#/comparer-clubs">${t("cm.compare")}</a>
        <a class="btn" href="${link.ranking({ club: code })}">${t("cl.inRanking")}</a></div></div>
      <div class="hero-meta"><span class="num">${t("col.code")} ${code}</span>
        ${ligue ? html`<span>${data.ligueName(ligue)}</span>` : ""}
        <span>${t("f.dept")} ${code.slice(0, 2)} · ${data.deptName(code.slice(0, 2))}</span>
        <span class="num">${fmt(members.length)} ${t("cl.everMembers")}</span></div>
    </section>
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2 class="week-title">${t("cl.week")} ${t("cl.week.from")}
          <input type="date" id="wk-from" value="${wkFrom}" max="${wkTo}" aria-label="${t("cl.week.from")}"> ${t("cl.week.to")}
          <input type="date" id="wk-to" value="${wkTo}" aria-label="${t("cl.week.to")}"></h2>
        <div class="hint">${t("cl.week.hint")}</div></div></div>
      <div id="week"></div>
    </section>
    <div class="grid grid-2" style="margin-bottom:16px">
      ${chartCard({ id: "lvl", title: t("cl.evolution"), hint: t("cl.over.mean"),
        tools: html`<span id="stat-seg"></span>` })}
      ${chartCard({ id: "cnt", title: t("cl.countOver") })}
    </div>
    <div class="grid grid-main-side" style="margin-bottom:16px;align-items:start">
      ${chartCard({ id: "eli", title: t("cm.eliteChart"), hint: t("cm.eliteChart.hint"), tools: html`<span id="elite-seg"></span>` })}
      <section class="card"><div class="card-head"><div><h2>${t("cl.eliteRecent")}</h2><div class="hint">${t("cl.eliteRecent.hint")}</div></div></div>
        <div id="elite-list"></div></section>
    </div>
    <section class="card">
      <div class="card-head"><div><h2>${t("cl.roster")}</h2><div class="hint">${t("cl.roster.hint")}</div></div>
        <label class="checkline"><input type="checkbox" id="all-members">${t("cl.showAll")}</label></div>
      <div id="roster"></div>
    </section>`;
  bindChartCard(main, "lvl");
  bindChartCard(main, "cnt");
  bindChartCard(main, "eli");
  let eliteMode = query.elite === "all" ? "all" : "elite";
  const cmpBtn = $("#cmp-club");
  const drawCmpBtn = () => {
    const on = store.inClubs(code);
    cmpBtn.textContent = on ? `✓ ${t("cl.inCompare")}` : `+ ${t("cl.addCompare")}`;
    cmpBtn.classList.toggle("btn-primary", !on);
  };
  cmpBtn.addEventListener("click", () => {
    if (!store.toggleClub(code)) alert(t("cm.max"));
    drawCmpBtn();
  });
  drawCmpBtn();
  let showAll = false;
  $("#all-members").addEventListener("change", (e) => { showAll = e.target.checked; drawRoster(); });

  function drawFilters() {
    $("#filters").innerHTML = html`
      <div class="field"><span>${t("f.methods")}</span>${methodChips()}</div>
      <div class="field"><span>${t("f.range")}</span>${seg("range",
        [["3", t("chart.3y")], ["5", t("chart.5y")], ["all", t("chart.all")]], range)}</div>`;
    $("#stat-seg").innerHTML = seg("stat", [["mean", t("cb.m.mean")], ["max", t("col.top")], ["sum", t("cb.m.sum")], ["top5", t("cb.m.top5")]], stat);
    $("#elite-seg").innerHTML = seg("elite", [["elite", t("cm.elite")], ["all", t("cm.eliteAll")]], eliteMode);
    $$('[data-seg="elite"]').forEach((b) => b.addEventListener("click", () => { eliteMode = b.dataset.value; drawFilters(); drawElite(); }));
    bindTerrainSeg(main, () => { drawFilters(); drawAll(); });
    bindMethodChips(main, () => { drawFilters(); drawAll(); });
    $$('[data-seg="range"]').forEach((b) => b.addEventListener("click", () => { range = b.dataset.value; drawFilters(); drawCharts(); }));
    $$('[data-seg="stat"]').forEach((b) => b.addEventListener("click", () => { stat = b.dataset.value; drawFilters(); drawCharts(); }));
    replaceQuery({ range: range === "all" ? null : range, stat: stat === "mean" ? null : stat, elite: eliteMode === "elite" ? null : eliteMode });
  }

  /** [[monthEndIso, n, mean, max, sum, top5]] for a method in the chosen discipline. */
  function monthly(m) {
    const terrain = store.get().terrain;
    const keys = m === "official" ? ["official_Ped", `official_${terrain}`] : [`${m}_${terrain}`];
    const out = [];
    for (const k of keys) {
      const s = series?.[k] || {};
      for (const [ym, v] of Object.entries(s)) {
        const isPed = k.endsWith("_Ped");
        if (m === "official" && (Number(ym.slice(0, 4)) < meta.split_year) !== isPed) continue;
        // stored as [n, median, max, sum, top5]; the page shows the mean instead of the median
        out.push([data.monthFor(ym), v[0], v[0] ? Math.round(v[3] / v[0]) : null, v[2], v[3], v[4]]);
      }
    }
    return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  function zoomStart(all) {
    if (range === "all" || !all.length) return 0;
    const first = all[0], last = all[all.length - 1];
    const from = addDays(last, -365 * Number(range));
    return Math.max(0, 100 * (new Date(from) - new Date(first)) / Math.max(1, new Date(last) - new Date(first)));
  }

  function drawCharts() {
    const methods = store.get().methods;
    const per = methods.map((m) => ({ m, rows: monthly(m) }));
    const all = per.flatMap((p) => p.rows.map((r) => r[0])).sort();
    const start = zoomStart(all);
    const col = 2 + STATS.indexOf(stat);     // rows are [month, n, mean, max, sum, top5]
    const lvl = per.map((p) => ({ name: methodLabel(p.m), color: methodColor(p.m), data: p.rows.map((r) => [r[0], r[col]]) }));
    const cnt = per.map((p) => ({ name: methodLabel(p.m), color: methodColor(p.m), data: p.rows.map((r) => [r[0], r[1]]) }));
    $("#lvl-legend").innerHTML = legend(lvl.map((s) => ({ label: s.name, color: s.color })));
    $("#cnt-legend").innerHTML = legend(cnt.map((s) => ({ label: s.name, color: s.color })));
    timeChart($("#lvl"), { series: lvl, zoom: { start, end: 100 } });
    timeChart($("#cnt"), { series: cnt, zoom: { start, end: 100 }, yName: t("col.members"), yMin: 0 });
    const months = [...new Set(all)].reverse();
    const idx = per.map((p) => new Map(p.rows.map((r) => [r[0], r])));
    const table = (c) => html`<table class="data compact"><thead><tr><th>${t("f.date")}</th>
      ${methods.map((m) => html`<th class="r">${methodLabel(m)}</th>`)}</tr></thead>
      <tbody>${months.map((d) => html`<tr><td>${fmtDate(d, "month")}</td>
        ${idx.map((ix) => html`<td class="r num">${fmt(ix.get(d)?.[c])}</td>`)}</tr>`)}</tbody></table>`;
    $("#lvl-table").innerHTML = table(col);
    $("#cnt-table").innerHTML = table(1);
    $("#lvl-title").nextElementSibling.textContent = t(`cl.over.${stat}`);
  }

  let ranked = [];
  async function drawTiles() {
    const methods = store.get().methods, month = data.latestMonth();
    const { rows } = await loadRanking(methods, store.get().terrain, month);
    ranked = rows.filter((r) => r.clubCode === code);
    const tiles = methods.map((m) => {
      const v = ranked.map((r) => r.cn[m]).filter((x) => x != null).sort((a, b) => a - b);
      const med = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
      return tile(`${t("cl.members")} · ${methodShort(m)}`, fmt(v.length),
        med ? `${t("cb.m.mean")} ${fmt(med)} · ${t("col.top")} ${fmt(v[v.length - 1])}` : fmtDate(month), methodColor(m));
    });
    // club rank by headcount, first method
    const m0 = methods[0];
    const counts = new Map();
    rows.forEach((r) => { if (r.cn[m0] != null && r.clubCode) counts.set(r.clubCode, (counts.get(r.clubCode) || 0) + 1); });
    const mine = counts.get(code) || 0;
    const pos = mine ? 1 + [...counts.values()].filter((n) => n > mine).length : null;
    // club rank by the sum of its runners' CN, same method
    const sums = new Map();
    rows.forEach((r) => { if (r.cn[m0] != null && r.clubCode) sums.set(r.clubCode, (sums.get(r.clubCode) || 0) + r.cn[m0]); });
    const mySum = sums.get(code) || 0;
    const posSum = mySum ? 1 + [...sums.values()].filter((n) => n > mySum).length : null;
    $("#tiles").innerHTML = html`${tiles}${tile(t("cl.rankBySize"), pos ? ord(pos) : "—",
      `${t("nav.clubs")} · ${fmt(counts.size)} · ${methodLabel(m0)}`)}${tile(t("cl.rankBySum"), posSum ? ord(posSum) : "—",
      `Σ ${fmt(mySum)} · ${fmt(sums.size)} ${t("nav.clubs").toLowerCase()} · ${methodLabel(m0)}`)}`;
  }

  function drawRoster() {
    const methods = store.get().methods, m0 = methods[0], terrain = store.get().terrain;
    const byLic = new Map(ranked.map((r) => [r.lic, r]));
    const list = showAll
      ? members.map((p) => byLic.get(p.lic) || { lic: p.lic, name: displayName(p.nom), cat: p.cat, cn: {}, rank: {}, delta: {} })
      : ranked;
    for (const r of byLic.values()) if (showAll && !members.some((p) => p.lic === r.lic)) list.push(r);
    dataTable($("#roster"), {
      rows: list, sortKey: m0, sortDir: -1,
      columns: [
        { key: "name", label: t("rk.col.name"), sort: (r) => r.name, defaultDir: 1,
          render: (r) => html`<a class="name" href="${link.runner(r.lic, { t: terrain })}">${r.name}</a>` },
        { key: "cat", label: t("rk.col.cat"), sort: (r) => r.cat, defaultDir: 1 },
        ...methods.flatMap((m) => [
          { key: m, label: methodShort(m), align: "r", cls: "num", sort: (r) => r.cn[m],
            render: (r) => (r.cn[m] != null ? html`<b>${fmt(r.cn[m])}</b>` : html`<span class="dim">—</span>`) },
          { key: `rk_${m}`, label: t("rk.col.overall"), align: "r", cls: "num dim", sort: (r) => r.rank[m], defaultDir: 1,
            render: (r) => fmt(r.rank[m]) },
        ]),
        { key: "last", label: t("cl.lastRace"), align: "r", cls: "num", sort: (r) => data.runner(r.lic)?.last,
          render: (r) => fmtDate(data.runner(r.lic)?.last) },
        { key: "sel", label: t("nav.compare"), cls: "c", render: (r) => html`<input type="checkbox" data-sel="${r.lic}" ${raw(store.inCompare(r.lic) ? "checked" : "")} aria-label="${r.name}">` },
      ],
      onRender(el) {
        $$("[data-sel]", el).forEach((cb) => cb.addEventListener("change", () => {
          if (!store.toggleCompare(cb.dataset.sel)) { cb.checked = false; alert(t("cp.max")); }
        }));
      },
    });
  }

  async function drawElite() {
    const terrain = store.get().terrain;
    const sum = await data.eliteSummary();
    const per = sum?.data?.[eliteMode]?.[terrain]?.[code] || {};
    const seasons = meta.seasons.map(String);
    const color = css("--s1");
    const series = [{ name: name || code, color, data: seasons.map((y) => per[y] || 0) }];
    columnChart($("#eli"), { categories: seasons, series, yName: t("cm.points") });
    $("#eli-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.season")}</th><th class="r">${t("cm.points")}</th></tr></thead>
      <tbody>${[...seasons].reverse().map((y) => html`<tr><td>${y}</td><td class="r num">${fmt(per[y] || 0)}</td></tr>`)}</tbody></table>`;
    // the last 12 months, finish by finish
    const win = await data.eliteWindow(data.latestMonth(), terrain);
    const rows = win.rows.filter((r) => r[E.club] === code && (eliteMode === "all" || win.cats.has(r[E.cat])))
      .sort((a, b) => (data.comp(b[E.course]).date < data.comp(a[E.course]).date ? -1 : 1) || a[E.rank] - b[E.rank]);
    dataTable($("#elite-list"), {
      rows, sortKey: null, emptyText: t("cl.eliteNone"),
      columns: [
        { key: "d", label: t("col.date"), cls: "num", render: (r) => fmtDate(data.comp(r[E.course]).date, "short") },
        { key: "c", label: t("col.comp"), render: (r) => html`<a href="${link.course(r[E.course], { mode: "club", club: code })}">${data.comp(r[E.course]).title}</a>` },
        { key: "n", label: t("rk.col.name"), render: (r) => html`<a href="${link.runner(r[E.lic])}">${displayName(data.runner(r[E.lic])?.nom || r[E.lic])}</a>` },
        { key: "cat", label: t("rk.col.cat"), render: (r) => r[E.cat] },
        { key: "rk", label: t("col.place"), align: "r", cls: "num", render: (r) => ord(r[E.rank]) },
        { key: "p", label: t("cm.points"), align: "r", cls: "num", render: (r) => html`<b>${fmt(r[E.pts])}</b>` },
      ],
    });
  }

  /** Each member's best top-10 finish of the last 7 days, all disciplines. On a
   *  circuit with at most 6 categories the place counts within the category. */
  let weekToken = 0;
  async function drawWeek() {
    const my = ++weekToken;
    const from = wkFrom, to = wkTo;
    const ids = (await data.clubCourses(code)).map(String).filter((id) => {
      const d = data.comp(id)?.date || "";
      return d >= from && d <= to;
    });
    const best = new Map();                   // lic -> finish
    for (const [id, file] of await Promise.all(ids.map(async (id) => [id, await data.course(id)]))) {
      for (const circ of file?.circuits || []) {
        const cats = new Set(circ.rows.map((r) => r[C.cat]).filter(Boolean));
        const inCat = cats.size <= WEEK_MAX_CATS;
        for (const r of circ.rows) {
          if (!r[C.place] || data.clubParts(r[C.club]).code !== code) continue;
          const pos = inCat
            ? 1 + circ.rows.filter((o) => o[C.place] && o[C.cat] === r[C.cat] && o[C.place] < r[C.place]).length
            : r[C.place];
          if (pos > 10) continue;
          const x = { lic: r[C.lic], pos, inCat, cat: r[C.cat], course: id, circ, date: data.comp(id).date };
          const b = best.get(x.lic);
          if (!b || pos < b.pos || (pos === b.pos && x.date > b.date)) best.set(x.lic, x);
        }
      }
    }
    if (my !== weekToken) return;                // another period was chosen meanwhile
    const who = (lic) => displayName(data.runner(lic)?.nom || lic);
    const rows = [...best.values()].sort((a, b) => a.pos - b.pos || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
      || who(a.lic).localeCompare(who(b.lic)));
    dataTable($("#week"), {
      rows, sortKey: null, emptyText: t("cl.week.none"),
      columns: [
        { key: "pos", label: t("col.place"), align: "r", cls: "num",
          render: (x) => html`<b>${ord(x.pos)}</b> <span class="dim">${t(x.inCat ? "cl.week.inCat" : "cl.week.inCirc")}</span>` },
        { key: "n", label: t("rk.col.name"), render: (x) => html`<a href="${link.runner(x.lic)}">${who(x.lic)}</a>` },
        { key: "cat", label: t("rk.col.cat"), render: (x) => x.cat || "" },
        { key: "c", label: t("col.comp"), render: (x) => html`${terrainTag(data.comp(x.course).terrain)}
          <a href="${link.course(x.course, { circ: x.circ.id, mode: "club", club: code })}">${data.comp(x.course).title}</a>` },
        { key: "circ", label: t("col.circuit"), render: (x) => x.circ.name || "" },
        { key: "d", label: t("col.date"), cls: "num", render: (x) => fmtDate(x.date, "short") },
      ],
    });
  }

  async function drawAll() {
    drawCharts();
    drawElite();
    await drawTiles();
    drawRoster();
  }
  for (const id of ["wk-from", "wk-to"]) {
    $(`#${id}`).addEventListener("change", (e) => {
      if (!e.target.value) { e.target.value = id === "wk-from" ? wkFrom : wkTo; return; }
      if (id === "wk-from") wkFrom = e.target.value; else wkTo = e.target.value;
      if (wkFrom > wkTo) { if (id === "wk-from") wkTo = wkFrom; else wkFrom = wkTo; }   // keep the period valid
      $("#wk-from").value = wkFrom; $("#wk-to").value = wkTo; $("#wk-from").max = wkTo;
      drawWeek();
    });
  }
  drawFilters();
  drawWeek();
  await drawAll();
  return { title: name || code };
}
