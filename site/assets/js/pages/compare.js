// Compare: up to 8 runners. Colour identifies the runner (a fixed slot that
// never moves when others are removed); line style identifies the method.
// The period applies to every panel: the chart, the summary and the head-to-head.

import { html, raw, esc, $, $$, fmt, fmtDate, displayName, initials, addDays, debounce } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { R, CNAFTER_COL } from "../data.js";
import { timeChart, slotColor, METHOD_DASH } from "../charts.js";
import {
  methodChips, bindMethodChips, chartCard, bindChartCard, dataTable, methodLabel, methodShort, seg, runnerSearch, bindRunnerSearch, dashKey,
} from "../ui.js";
import { loadRanking, applyFilters, AGES } from "./ranking.js";
import { monthlyProgress } from "../progress.js";
import { link, replaceQuery, terrainField } from "../app.js";


export async function render(main, { query }) {
  if (query.r) store.setCompare(query.r.split(",").filter(Boolean));
  // nothing to compare yet: start from the current runner, if there is one
  else if (!store.get().compare.length && store.get().lastRunner && data.runner(store.get().lastRunner)) store.addCompare(store.get().lastRunner);
  let range = query.range || "all";
  let showPicker = false;
  const pf = { sexe: "", cat: "", club: "", q: "" };
  const meta = data.meta();
  const terrain = store.get().terrain;
  const end = data.latestMonth();
  const from = () => (range === "all" ? null : addDays(end, -365 * Number(range)));
  const inWindow = (d) => !from() || d >= from();

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("cp.title")}</h1><p class="lede">${t("cp.lede")}</p></div></div>
    <section class="card" style="margin-bottom:16px"><div class="card-body stack" style="gap:12px">
      <div class="row">
        ${runnerSearch("cmp-search", t("cp.search"))}
        <button class="btn btn-sm" type="button" id="toggle-picker" aria-expanded="false"></button>
        <span class="spacer"></span><span class="muted num" id="cmp-count"></span>
      </div>
      <div class="row" id="picked"></div>
      <div id="picker-panel" hidden>
        <div class="row" style="margin-bottom:8px">
          <label class="field"><span>${t("f.sexe")}</span><select id="p-sexe"><option value="">${t("sexe.all")}</option>
            <option value="H">${t("sexe.H")}</option><option value="D">${t("sexe.D")}</option></select></label>
          <label class="field"><span>${t("f.cat")}</span><select id="p-cat"><option value="">${t("f.all")}</option>
            ${AGES.map((a) => html`<option value="${a}">${a}</option>`)}</select></label>
          <label class="field"><span>${t("f.club")}</span><select id="p-club" style="max-width:220px"></select></label>
          <label class="field"><span>${t("f.name")}</span><input type="search" id="p-q" style="width:160px"></label>
        </div>
        <div id="picker"></div>
      </div>
    </div></section>
    <div class="filters" id="filters"></div>
    <div style="margin-bottom:16px">${chartCard({ id: "cmp", title: t("cp.chart"), tall: true })}</div>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("cp.table")}</h2><div class="hint" id="sum-hint"></div></div></div>
      <div id="summary"></div></section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("cp.h2h")}</h2><div class="hint" id="h2h-hint"></div></div></div>
      <div class="card-body" id="h2h"></div></section>
    <div>${chartCard({ id: "prog", title: t("pg.pct"), hint: t("cp.prog.hint") })}</div>`;
  bindChartCard(main, "cmp");
  bindChartCard(main, "prog");
  bindRunnerSearch($("#cmp-search"), {
    isPicked: (lic) => store.inCompare(lic),
    onPick: (lic) => { if (!store.addCompare(lic)) alert(t("cp.max")); },
  });
  const drawToggle = () => {
    $("#toggle-picker").textContent = showPicker ? `✕ ${t("cp.hideList")}` : `☰ ${t("cp.fromList")}`;
    $("#toggle-picker").setAttribute("aria-expanded", String(showPicker));
    $("#picker-panel").hidden = !showPicker;
  };
  $("#toggle-picker").addEventListener("click", async () => {
    showPicker = !showPicker;
    drawToggle();
    if (showPicker && !pickRows.length) await drawPicker();
  });
  drawToggle();

  const racesOf = new Map();
  async function loadRaces() {
    await Promise.all(store.get().compare.map(async (c) => {
      if (!racesOf.has(c.lic)) racesOf.set(c.lic, await data.runnerRaces(c.lic));
    }));
  }

  function drawFilters() {
    $("#filters").innerHTML = html`${terrainField()}
      <div class="field"><span>${t("f.methods")}</span>${methodChips(undefined, { dash: true })}</div>
      <div class="field"><span>${t("f.range")}</span>${seg("range",
        [["1", t("chart.12m")], ["3", t("chart.3y")], ["5", t("chart.5y")], ["all", t("chart.all")]], range)}</div>`;
    bindMethodChips(main, () => { drawFilters(); drawAll(); if (showPicker) drawPicker(); });
    $$('[data-seg="range"]').forEach((b) => b.addEventListener("click", () => {
      range = b.dataset.value; drawFilters(); drawAll();
    }));
  }

  function drawPicked() {
    const sel = store.get().compare;
    $("#picked").innerHTML = sel.length ? html`${sel.map((c) => {
      const r = data.runner(c.lic);
      return html`<span class="pill"><span class="dot" style="background:${raw(slotColor(c.slot))}"></span>
        <a href="${link.runner(c.lic)}">${displayName(r?.nom || c.lic)}</a>
        <span class="dim">${r?.cat || ""}</span>
        <button type="button" data-rm="${c.lic}" aria-label="×">×</button></span>`;
    })}<span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="clear">${t("cp.clear")}</button>`
      : html`<span class="muted">${t("cp.empty")}</span>`;
    $("#cmp-count").textContent = `${sel.length} / ${store.MAX_COMPARE}`;
    $$("[data-rm]", $("#picked")).forEach((b) => b.addEventListener("click", () => store.removeCompare(b.dataset.rm)));
    $("#clear")?.addEventListener("click", () => store.set({ compare: [] }));
    replaceQuery({ r: sel.map((c) => c.lic).join(",") || null, range: range === "all" ? null : range });
  }

  const inSeries = (r, m) => data.inSeries(r, m, terrain);
  function seriesOf(lic, m) {
    const col = CNAFTER_COL[m];
    const pts = [];
    let prev = null;
    for (const r of racesOf.get(lic) || []) {
      if (!inSeries(r, m) || !r[col]) continue;          // a 0 CN (all-zero window) is not a ranking
      if (prev && prev[0] === r[R.date]) { prev[1] = r[col]; continue; }
      prev = [r[R.date], r[col]];
      pts.push(prev);
    }
    return pts;
  }
  const nameOf = (lic) => displayName(data.runner(lic)?.nom || lic);
  const runnerLegend = (sel) => html`${sel.map((c) => html`<span><span class="dot" style="background:${raw(slotColor(c.slot))}"></span>${nameOf(c.lic)}</span>`)}
    ${store.get().methods.length > 1 ? store.get().methods.map((m) => html`<span>${dashKey(m)} ${methodShort(m)}</span>`) : ""}`;

  function zoomOf(all) {
    const first = all[0], last = all[all.length - 1];
    if (!from() || !first) return { start: 0, end: 100 };
    return { start: Math.max(0, 100 * (new Date(from()) - new Date(first)) / Math.max(1, new Date(last) - new Date(first))), end: 100 };
  }

  function drawChart() {
    const sel = store.get().compare, methods = store.get().methods;
    if (!sel.length) {
      $("#cmp").innerHTML = html`<div class="empty">${t("cp.empty")}</div>`;
      $("#cmp-legend").innerHTML = ""; $("#cmp-table").innerHTML = "";
      return;
    }
    const series = [];
    for (const c of sel) {
      methods.forEach((m, i) => series.push({
        name: `${nameOf(c.lic)} · ${methodShort(m)}`, color: slotColor(c.slot),
        dash: METHOD_DASH[m], step: true, data: seriesOf(c.lic, m),
        endLabel: i === 0 && sel.length <= 4 ? nameOf(c.lic).split(" ")[0] : null,
      }));
    }
    const all = series.flatMap((s) => s.data.map((p) => p[0])).sort();
    $("#cmp-legend").innerHTML = runnerLegend(sel);
    timeChart($("#cmp"), { series, zoom: zoomOf(all) });
    const seasons = [...new Set(all.map((d) => d.slice(0, 4)))].sort().reverse();
    const cols = sel.flatMap((c) => methods.map((m) => ({ c, m, pts: seriesOf(c.lic, m) })));
    $("#cmp-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.season")}</th>
      ${cols.map((x) => html`<th class="r">${nameOf(x.c.lic)}<div class="dim" style="font-weight:400">${methodShort(x.m)}</div></th>`)}</tr></thead>
      <tbody>${seasons.map((y) => html`<tr><td>${y}</td>${cols.map((x) => {
        const inY = x.pts.filter((p) => p[0].startsWith(y));
        return html`<td class="r num">${inY.length ? fmt(inY[inY.length - 1][1]) : "—"}</td>`;
      })}</tr>`)}</tbody></table>`;
  }

  const periodLabel = () => (from() ? `${fmtDate(from())} → ${fmtDate(end)}` : t("cp.allTime"));

  async function drawSummary() {
    const sel = store.get().compare, methods = store.get().methods;
    $("#sum-hint").textContent = `${t(`terrain.${terrain}`)} · ${periodLabel()}`;
    const { rows } = await loadRanking(methods, terrain, end);
    const byLic = new Map(rows.map((r) => [r.lic, r]));
    const items = sel.map((c) => {
      const races = (racesOf.get(c.lic) || []).filter((x) => x[R.terrain] === terrain && inWindow(x[R.date]));
      const pts = seriesOf(c.lic, methods[0]).filter((p) => inWindow(p[0]));
      const peak = pts.reduce((b, p) => (!b || p[1] > b[1] ? p : b), null);
      return { c, r: data.runner(c.lic), now: byLic.get(c.lic), races, peak,
        pod: races.filter((r) => r[R.place] && r[R.place] <= 3).length, wins: races.filter((r) => r[R.place] === 1).length };
    });
    dataTable($("#summary"), {
      rows: items, sortKey: "cn0", sortDir: -1,
      emptyText: t("cp.empty"),
      columns: [
        { key: "name", label: t("rk.col.name"), render: (x) => html`<span class="dot" style="background:${raw(slotColor(x.c.slot))};margin-right:7px"></span><a href="${link.runner(x.c.lic)}">${nameOf(x.c.lic)}</a>` },
        { key: "cat", label: t("rk.col.cat"), render: (x) => x.now?.cat || x.r?.cat || "" },
        ...methods.map((m, i) => ({
          key: `cn${i}`, align: "r", cls: "num", label: `CN ${methodShort(m)}`, sort: (x) => x.now?.cn[m],
          render: (x) => x.now?.cn[m] == null ? html`<span class="dim">—</span>` : html`<b>${fmt(x.now.cn[m])}</b>`,
        })),
        { key: "peak", label: `${t("cp.peak")} ${methodShort(methods[0])}`, align: "r", cls: "num", sort: (x) => x.peak?.[1],
          render: (x) => x.peak ? html`${fmt(x.peak[1])} <span class="dim">${fmtDate(x.peak[0], "short")}</span>` : "—" },
        { key: "n", label: t("col.races"), align: "r", cls: "num", sort: (x) => x.races.length, render: (x) => fmt(x.races.length) },
        { key: "pod", label: t("rn.podiums"), align: "r", cls: "num", sort: (x) => x.pod, render: (x) => fmt(x.pod) },
        { key: "wins", label: t("rn.wins"), align: "r", cls: "num", sort: (x) => x.wins, render: (x) => fmt(x.wins) },
      ],
    });
  }

  function drawH2H() {
    const sel = store.get().compare;
    $("#h2h-hint").textContent = `${t("cp.h2h.hint")} · ${t(`terrain.${terrain}`)} · ${periodLabel()}`;
    if (sel.length < 2) { $("#h2h").innerHTML = html`<div class="empty">${t("cp.h2h.need2")}</div>`; return; }
    // circuit -> licence -> finishing place (null = did not finish), within the period
    const onCircuit = new Map();
    for (const c of sel) {
      for (const r of racesOf.get(c.lic) || []) {
        if (r[R.terrain] !== terrain || !inWindow(r[R.date])) continue;
        if (!onCircuit.has(r[R.cid])) onCircuit.set(r[R.cid], new Map());
        onCircuit.get(r[R.cid]).set(c.lic, r[R.status] === "ok" ? r[R.place] : null);
      }
    }
    const beats = (a, b) => {
      let w = 0, n = 0;
      for (const m of onCircuit.values()) {
        if (!m.has(a) || !m.has(b)) continue;
        n++;
        const pa = m.get(a), pb = m.get(b);
        if (pa != null && (pb == null || pa < pb)) w++;
      }
      return [w, n];
    };
    $("#h2h").innerHTML = html`<div class="table-wrap"><table class="data compact h2h">
      <thead><tr><th></th>${sel.map((c) => html`<th class="c" title="${nameOf(c.lic)}"><span class="dot" style="background:${raw(slotColor(c.slot))};margin-right:4px"></span>${initials(data.runner(c.lic)?.nom)}</th>`)}</tr></thead>
      <tbody>${sel.map((a) => html`<tr><th scope="row"><span class="dot" style="background:${raw(slotColor(a.slot))};margin-right:6px"></span>${nameOf(a.lic)}</th>
        ${sel.map((b) => {
          if (a.lic === b.lic) return html`<td class="self"></td>`;
          const [w, n] = beats(a.lic, b.lic);
          const [l] = beats(b.lic, a.lic);
          return html`<td class="cellv">${n ? html`<span class="${w > l ? "win" : ""}">${fmt(w)}</span><span class="dim"> / ${fmt(n)}</span>` : html`<span class="dim">—</span>`}</td>`;
        })}</tr>`)}</tbody></table></div>`;
  }

  // percentile within the age category, month by month
  let ac = null;
  async function drawProgress() {
    const sel = store.get().compare, methods = store.get().methods;
    if (!sel.length) { $("#prog").innerHTML = html`<div class="empty">${t("cp.empty")}</div>`; $("#prog-legend").innerHTML = ""; return; }
    ac = ac || await data.ageCurves();
    const series = [];
    for (const c of sel) for (const m of methods) {
      const p = monthlyProgress(m, racesOf.get(c.lic) || [], terrain, meta, ac);
      series.push({ name: `${nameOf(c.lic)} · ${methodShort(m)}`, color: slotColor(c.slot), dash: METHOD_DASH[m],
        data: p.filter((s) => s.pct != null).map((s) => [s.iso, Math.round(s.pct), s.cat]) });
    }
    const all = series.flatMap((s) => s.data.map((p) => p[0])).sort();
    $("#prog-legend").innerHTML = runnerLegend(sel);
    timeChart($("#prog"), {
      series, zoom: zoomOf(all), yName: "%", yMin: 0, yMax: 100,
      tooltipExtra: (s, v) => (v[2] ? `<span style="color:var(--ink-3);margin-left:6px">${esc(v[2])}</span>` : ""),
    });
    const months = [...new Set(all)].reverse();
    const idx = series.map((s) => new Map(s.data.map((p) => [p[0], p])));
    $("#prog-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.date")}</th>
      ${series.map((s) => html`<th class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${months.map((d) => html`<tr><td>${fmtDate(d, "month")}</td>${idx.map((m) => {
        const p = m.get(d); return html`<td class="r num">${p ? `${p[1]} % · ${p[2]}` : "—"}</td>`;
      })}</tr>`)}</tbody></table>`;
  }

  let pickRows = [];
  async function drawPicker() {
    const methods = store.get().methods;
    const { rows } = await loadRanking(methods, terrain, end);
    pickRows = rows;
    const clubs = new Map();
    rows.forEach((r) => { if (r.clubCode) clubs.set(r.clubCode, data.clubName(r.club)); });
    $("#p-club").innerHTML = html`<option value="">${t("f.allm")}</option>${[...clubs.entries()]
      .sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => html`<option value="${c}" ${raw(c === pf.club ? "selected" : "")}>${n}</option>`)}`;
    refreshPicker();
  }
  function refreshPicker() {
    const methods = store.get().methods, m0 = methods[0];
    const rows = applyFilters(pickRows, pf, m0).filter((r) => r.cn[m0] != null)
      .sort((a, b) => b.cn[m0] - a.cn[m0]);
    rows.forEach((r, i) => { r.pos = i + 1; });
    dataTable($("#picker"), {
      rows, sortKey: "pos", sortDir: 1,
      rowClass: (r) => (store.inCompare(r.lic) ? "selected" : ""),
      columns: [
        { key: "sel", label: "", cls: "c", render: (r) => html`<input type="checkbox" data-sel="${r.lic}" ${raw(store.inCompare(r.lic) ? "checked" : "")} aria-label="${r.name}">` },
        { key: "pos", label: "#", cls: "rank num", sort: (r) => r.pos, defaultDir: 1 },
        { key: "name", label: t("rk.col.name"), sort: (r) => r.key, defaultDir: 1, render: (r) => html`<span class="name">${r.name}</span>` },
        ...methods.map((m) => ({ key: m, label: methodShort(m), align: "r", cls: "num", sort: (r) => r.cn[m], render: (r) => fmt(r.cn[m]) })),
        { key: "cat", label: t("rk.col.cat"), sort: (r) => r.cat, defaultDir: 1 },
        { key: "club", label: t("rk.col.club"), render: (r) => html`<span title="${data.clubName(r.club)}">${r.clubCode || ""}</span>` },
      ],
      onRender(el) {
        $$("[data-sel]", el).forEach((cb) => cb.addEventListener("change", () => {
          if (!store.toggleCompare(cb.dataset.sel)) { cb.checked = false; alert(t("cp.max")); }
        }));
      },
    });
  }
  for (const k of ["sexe", "cat", "club"]) $(`#p-${k}`).addEventListener("change", (e) => { pf[k] = e.target.value; refreshPicker(); });
  $("#p-q").addEventListener("input", debounce((e) => { pf.q = e.target.value; refreshPicker(); }, 180));

  async function drawAll() {
    await loadRaces();
    drawPicked();
    drawChart();
    drawH2H();
    await drawSummary();
    await drawProgress();
  }
  /** Keep the list's ticks in step with the selection without rebuilding the table. */
  function syncPicker() {
    $$("#picker [data-sel]").forEach((cb) => {
      cb.checked = store.inCompare(cb.dataset.sel);
      cb.closest("tr").classList.toggle("selected", cb.checked);
    });
  }

  drawFilters();
  if (!store.get().compare.length) { showPicker = true; drawToggle(); await drawPicker(); }
  await drawAll();
  // The selection can change from here, the search, the tray or another tab:
  // one subscription redraws whatever depends on it.
  let last = JSON.stringify(store.get().compare);
  const unsubscribe = store.subscribe((st) => {
    const now = JSON.stringify(st.compare);
    if (now === last) return;
    last = now;
    drawAll().then(syncPicker);
  });
  return { title: t("cp.title"), cleanup: unsubscribe };
}
