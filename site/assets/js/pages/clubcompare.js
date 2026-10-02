// Compare clubs: up to 8 clubs, each keeping one colour; line style is the CN
// method. Season by season for any base, measure, sex and age group; month by
// month for the CN of all ranked runners; and where each club stands today.

import { html, raw, $, $$, fmt, fmtDate, normalise, debounce, addDays, ord } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { CLUB } from "../data.js";
import { timeChart, slotColor, METHOD_DASH } from "../charts.js";
import { methodChips, bindMethodChips, chartCard, bindChartCard, dataTable, methodLabel, methodShort, seg } from "../ui.js";
import { MEASURES, measureLabel, baseLabel, clubTable, rankOn, clubName, fromSummary } from "../clubstats.js";
import { clubSelectors, bindClubSelectors, selFromQuery, selToQuery, selDescription } from "./clubs.js";
import { link, replaceQuery } from "../app.js";
import { myClub } from "../auth.js";

const DASH_CSS = { official: "solid", v2026: "dashed", top6w: "dotted" };

export async function render(main, { query }) {
  if (query.c) store.setClubs(query.c.split(",").filter(Boolean));
  // nothing to compare yet: start from the logged-in runner's club
  else if (!store.get().clubs.length && myClub()) store.addClub(myClub());
  const sel = selFromQuery(query);
  let range = query.range || "all";
  let showPicker = false, pq = "";
  const meta = data.meta();
  const terrain = store.get().terrain;

  main.innerHTML = html`
    <div class="crumbs"><a href="#/clubs">${t("nav.clubs")}</a><span>›</span><span>${t("cm.title")}</span></div>
    <div class="page-head"><div><h1>${t("cm.title")}</h1><p class="lede">${t("cm.lede")}</p></div></div>
    <section class="card" style="margin-bottom:16px"><div class="card-body stack" style="gap:12px">
      <div class="row">
        <div class="search inline" id="club-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="search" autocomplete="off" placeholder="${t("cm.search")}" aria-label="${t("cm.search")}">
          <div class="search-results hidden" role="listbox"></div>
        </div>
        <button class="btn btn-sm" type="button" id="toggle-picker"></button>
        <span class="spacer"></span><span class="muted num" id="cnt"></span>
      </div>
      <div class="row" id="picked"></div>
      <div id="picker-panel" hidden>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:8px"><span>${t("f.name")}</span>
          <input type="search" id="pq" style="width:200px"></label>
        <div id="picker"></div>
      </div>
    </div></section>
    <div class="filters" id="filters"></div>
    <div class="notice info" id="desc" style="margin-bottom:16px"></div>
    <div style="margin-bottom:16px">${chartCard({ id: "yrs", title: t("cm.years"), hint: t("cm.years.hint"), tall: true })}</div>
    <section class="card" style="margin-bottom:16px">
      <div class="card-head"><div><h2>${t("cm.summary")}</h2><div class="hint" id="sum-hint"></div></div></div>
      <div id="summary"></div></section>
    <div>${chartCard({ id: "evo", title: t("cm.monthly"), hint: t("cm.monthly.hint"), tools: html`<span id="range-seg"></span>` })}</div>`;
  bindChartCard(main, "yrs");
  bindChartCard(main, "evo");

  const drawToggle = () => {
    $("#toggle-picker").textContent = showPicker ? `✕ ${t("cp.hideList")}` : `☰ ${t("cp.fromList")}`;
    $("#picker-panel").hidden = !showPicker;
  };
  $("#toggle-picker").addEventListener("click", () => { showPicker = !showPicker; drawToggle(); drawPicker(); });
  drawToggle();

  // ---- club search -----------------------------------------------------------
  (() => {
    const root = $("#club-search"), input = $("input", root), box = $(".search-results", root);
    const clubs = Object.entries(meta.names.clubs);
    const pick = (code) => { box.classList.add("hidden"); input.value = ""; if (!store.addClub(code)) alert(t("cm.max")); };
    input.addEventListener("input", debounce(() => {
      const qn = normalise(input.value.trim());
      if (qn.length < 2) { box.classList.add("hidden"); return; }
      const items = clubs.filter(([c, n]) => normalise(`${c} ${n}`).includes(qn)).slice(0, 12);
      box.innerHTML = items.length ? html`${items.map(([c, n]) => html`<button type="button" data-code="${c}" ${raw(store.inClubs(c) ? "disabled" : "")}>
          <span>${n}<div class="sub">${c}</div></span><span class="sub">${store.inClubs(c) ? "✓" : ""}</span></button>`)}`
        : html`<div class="empty">${t("search.none")}</div>`;
      box.classList.remove("hidden");
    }, 120));
    input.addEventListener("keydown", (e) => {
      const first = $("button:not([disabled])", box);
      if (e.key === "Enter" && first) { e.preventDefault(); pick(first.dataset.code); }
      if (e.key === "Escape") box.classList.add("hidden");
    });
    box.addEventListener("click", (e) => { const b = e.target.closest("button[data-code]"); if (b && !b.disabled) pick(b.dataset.code); });
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) box.classList.add("hidden"); });
  })();

  const files = new Map();
  async function loadFiles() {
    await Promise.all(store.get().clubs.map(async (c) => {
      if (!files.has(c.code)) files.set(c.code, (await data.clubSeries(c.code)) || {});
    }));
  }

  function drawFilters() {
    $("#filters").innerHTML = html`
      ${clubSelectors(sel)}
      ${sel.base === "cn" ? html`<div class="field"><span>${t("f.methods")}</span>${methodChips(undefined, { dash: true })}</div>` : ""}`;
    bindClubSelectors(main, sel, () => { drawFilters(); drawAll(); });
    bindMethodChips(main, () => { drawFilters(); drawAll(); });
  }
  const sync = () => replaceQuery({ c: store.get().clubs.map((c) => c.code).join(",") || null,
    range: range === "all" ? null : range, ...selToQuery(sel) });

  function drawPicked() {
    const selc = store.get().clubs;
    $("#cnt").textContent = `${selc.length} / ${store.MAX_CLUBS}`;
    $("#picked").innerHTML = selc.length ? html`${selc.map((c) => html`<span class="pill">
        <span class="dot" style="background:${raw(slotColor(c.slot))}"></span>
        <a href="${link.club(c.code)}">${clubName(c.code)}</a>
        <button type="button" data-rm="${c.code}" aria-label="×">×</button></span>`)}
      <span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" id="clear">${t("cp.clear")}</button>`
      : html`<span class="muted">${t("cm.empty")}</span>`;
    $$("[data-rm]", $("#picked")).forEach((b) => b.addEventListener("click", () => store.removeClub(b.dataset.rm)));
    $("#clear")?.addEventListener("click", () => store.set({ clubs: [] }));
    sync();
  }

  const legendHtml = (selc, withMethods) => html`${selc.map((c) => html`<span><span class="dot" style="background:${raw(slotColor(c.slot))}"></span>${clubName(c.code)}</span>`)}
    ${withMethods && store.get().methods.length > 1 ? store.get().methods.map((m) => html`<span><span class="dash-key" style="border-top-style:${raw(DASH_CSS[m])}"></span>${methodShort(m)}</span>`) : ""}`;
  const keyFor = (m, y) => (m === "official" && Number(y) < meta.split_year ? "official_Ped" : `${m}_${terrain}`);
  const group = () => `${sel.sexe}${sel.age}`;
  const yLabel = () => (sel.measure === "n" ? t("cb.runners") : sel.base === "pts" ? t("cm.points") : "CN");

  /** Season by season, at each season's last month-end. */
  function drawYears() {
    const selc = store.get().clubs, methods = sel.base === "cn" ? store.get().methods : [null];
    $("#desc").innerHTML = html`${selDescription(sel)}`;
    if (!selc.length) { $("#yrs").innerHTML = html`<div class="empty">${t("cm.empty")}</div>`; $("#yrs-legend").innerHTML = ""; return; }
    const seasons = meta.seasons.map(String);
    const endOf = (y) => meta.months.filter((m) => m.startsWith(y)).pop();
    const series = [];
    for (const c of selc) {
      const f = files.get(c.code) || {};
      for (const m of methods) {
        const pts = [];
        for (const y of seasons) {
          const s = sel.base === "cn" ? f.years?.[keyFor(m, y)]?.[y]?.[group()] : f.pts?.[terrain]?.[y]?.[group()];
          const v = fromSummary(s)?.[sel.measure];
          if (v) pts.push([endOf(y), v]);
        }
        series.push({ name: m ? `${clubName(c.code)} · ${methodShort(m)}` : clubName(c.code), color: slotColor(c.slot),
          dash: m ? METHOD_DASH[m] : "solid", data: pts, markers: true });
      }
    }
    $("#yrs-legend").innerHTML = legendHtml(selc, sel.base === "cn");
    timeChart($("#yrs"), { series, zoom: false, yName: yLabel(), yMin: 0 });
    $("#yrs-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.season")}</th>
      ${series.map((s) => html`<th class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${[...seasons].reverse().map((y) => html`<tr><td>${y}</td>${series.map((s) => html`<td class="r num">${fmt(s.data.find((p) => p[0]?.startsWith(y))?.[1])}</td>`)}</tr>`)}</tbody></table>`;
  }

  /** Month by month: CN of all ranked runners only (not stored per sex/age group). */
  function drawMonthly() {
    const selc = store.get().clubs, methods = store.get().methods;
    $("#range-seg").innerHTML = seg("range", [["3", t("chart.3y")], ["5", t("chart.5y")], ["all", t("chart.all")]], range);
    $$('[data-seg="range"]').forEach((b) => b.addEventListener("click", () => { range = b.dataset.value; drawMonthly(); sync(); }));
    if (sel.base !== "cn" || group() !== "**") {
      $("#evo").innerHTML = html`<div class="empty">${t("cm.monthly.na")}</div>`; $("#evo-legend").innerHTML = ""; $("#evo-table").innerHTML = ""; return;
    }
    if (!selc.length) { $("#evo").innerHTML = html`<div class="empty">${t("cm.empty")}</div>`; $("#evo-legend").innerHTML = ""; return; }
    const pick = (v) => (sel.measure === "mean" ? (v[CLUB.n] ? Math.round(v[CLUB.sum] / v[CLUB.n]) : null) : v[CLUB[sel.measure]]);
    const series = [];
    for (const c of selc) for (const m of methods) {
      const s = files.get(c.code)?.monthly || {};
      const keys = m === "official" ? ["official_Ped", `official_${terrain}`] : [`${m}_${terrain}`];
      const pts = [];
      for (const k of keys) for (const [ym, v] of Object.entries(s[k] || {})) {
        if (m === "official" && (Number(ym.slice(0, 4)) < meta.split_year) !== k.endsWith("_Ped")) continue;
        pts.push([data.monthFor(ym), pick(v)]);
      }
      pts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      series.push({ name: `${clubName(c.code)} · ${methodShort(m)}`, color: slotColor(c.slot), dash: METHOD_DASH[m], data: pts });
    }
    const all = series.flatMap((s) => s.data.map((p) => p[0])).sort();
    let start = 0;
    if (range !== "all" && all.length) {
      const first = all[0], last = all[all.length - 1], from = addDays(last, -365 * Number(range));
      start = Math.max(0, 100 * (new Date(from) - new Date(first)) / Math.max(1, new Date(last) - new Date(first)));
    }
    $("#evo-legend").innerHTML = legendHtml(selc, true);
    timeChart($("#evo"), { series, zoom: { start, end: 100 }, yName: yLabel() });
    const months = [...new Set(all)].reverse();
    const idx = series.map((s) => new Map(s.data));
    $("#evo-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.date")}</th>
      ${series.map((s) => html`<th class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${months.map((d) => html`<tr><td>${fmtDate(d, "month")}</td>${idx.map((m) => html`<td class="r num">${fmt(m.get(d))}</td>`)}</tr>`)}</tbody></table>`;
  }

  let res = null;
  async function drawSummary() {
    const m0 = store.get().methods[0], month = data.latestMonth();
    res = await clubTable(m0, terrain, month, sel);
    rankOn(res.clubs, sel.base, sel.measure);
    const byCode = new Map(res.clubs.map((g) => [g.code, g]));
    const ranks = Object.fromEntries(MEASURES.map((m) => {
      const sorted = res.clubs.filter((g) => g[sel.base][m]).sort((a, b) => b[sel.base][m] - a[sel.base][m]);
      return [m, new Map(sorted.map((g, i) => [g.code, i + 1]))];
    }));
    const rows = store.get().clubs.map((c) => ({ c, g: byCode.get(c.code) }));
    $("#sum-hint").textContent = `${baseLabel(sel.base)}${sel.base === "cn" ? ` · ${methodLabel(m0)}` : ` · ${t("cb.last12")}`} · ${fmtDate(month)} · ${t("cm.rankOf")} ${fmt(res.clubs.filter((g) => g.rank).length)} ${t("nav.clubs").toLowerCase()}`;
    dataTable($("#summary"), {
      rows, sortKey: sel.measure, sortDir: -1, emptyText: t("cm.empty"),
      columns: [
        { key: "name", label: t("col.name"), render: (x) => html`<span class="dot" style="background:${raw(slotColor(x.c.slot))};margin-right:7px"></span><a class="name" href="${link.club(x.c.code)}">${clubName(x.c.code)}</a>` },
        ...MEASURES.map((m) => ({
          key: m, label: measureLabel(m), align: "r", cls: "num", sort: (x) => x.g?.[sel.base][m],
          render: (x) => (x.g?.[sel.base][m] ? html`<b>${fmt(x.g[sel.base][m])}</b> <span class="dim">${ord(ranks[m].get(x.c.code))}</span>` : html`<span class="dim">—</span>`),
        })),
      ],
    });
    if (showPicker) drawPicker();
  }

  function drawPicker() {
    if (!showPicker || !res) return;
    const qn = normalise(pq);
    const rows = res.clubs.filter((g) => g.rank && (!qn || normalise(`${g.code} ${clubName(g.code)}`).includes(qn)));
    dataTable($("#picker"), {
      rows, sortKey: "rank", sortDir: 1,
      rowClass: (g) => (store.inClubs(g.code) ? "selected" : ""),
      columns: [
        { key: "sel", label: "", cls: "c", render: (g) => html`<input type="checkbox" data-club="${g.code}" ${raw(store.inClubs(g.code) ? "checked" : "")} aria-label="${clubName(g.code)}">` },
        { key: "rank", label: "#", cls: "rank num", sort: (g) => g.rank, defaultDir: 1, render: (g) => g.rank },
        { key: "name", label: t("col.name"), sort: (g) => clubName(g.code), defaultDir: 1, render: (g) => html`<span class="name">${clubName(g.code)}</span> <span class="dim">${g.code}</span>` },
        { key: "lg", label: t("f.ligue"), render: (g) => data.ligueName(g.ligue) },
        { key: "v", label: measureLabel(sel.measure), align: "r", cls: "num", sort: (g) => g[sel.base][sel.measure], render: (g) => fmt(g[sel.base][sel.measure]) },
      ],
      onRender(el) {
        $$("[data-club]", el).forEach((cb) => cb.addEventListener("change", () => {
          if (!store.toggleClub(cb.dataset.club)) { cb.checked = false; alert(t("cm.max")); }
        }));
      },
    });
  }
  $("#pq").addEventListener("input", debounce((e) => { pq = e.target.value; drawPicker(); }, 180));

  async function drawAll() {
    await loadFiles();
    drawPicked();
    drawYears();
    drawMonthly();
    await drawSummary();
  }

  drawFilters();
  if (!store.get().clubs.length) { showPicker = true; drawToggle(); }
  await drawAll();
  let last = JSON.stringify(store.get().clubs);
  const unsubscribe = store.subscribe((st) => {
    const now = JSON.stringify(st.clubs);
    if (now === last) return;
    last = now;
    drawAll();
  });
  return { title: t("cm.title"), cleanup: unsubscribe };
}
