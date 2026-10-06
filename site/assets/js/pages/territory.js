// Réseau · Territoires: for each ligue (region) or département (of the competition's organiser), over one season or all of
// them, in both disciplines or the one chosen: the competitions hosted there, the competitors registered
// there, and the competitions per competitor — as a map (coloured by any of the three) and a table.
//
// Competitors of a place = the runners of its clubs: anyone with a result in the period ("nc"
// rows included, CN or not), placed by the club of their last race in it (site_extras.pyramid).

import { html, raw, $, $$, fmt, ord } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { mapChart } from "../charts.js";
import { chartCard, bindChartCard, dataTable, tile, seg } from "../ui.js";
import { DEPT_REGION, regionOf, placeOf, loadMap, featuresOf } from "../geo.js";
import { replaceQuery, viewTerrain } from "../app.js";
import { modeSwitch, bindModeSwitch } from "./netmodes.js";

const LEVELS = ["region", "dept"];
const MEASURES = ["comps", "runners", "ratio"];       // competitions hosted · competitors registered · competitions per 100 competitors
const RATIO_X = 100;
const digitsOf = (m) => (m === "ratio" ? 1 : 0);
const FLAG = { For: 1, Spr: 2 };

export async function render(main, query) {
  const seasons = data.meta().seasons.map(String).reverse();
  let level = LEVELS.includes(query.niveau) ? query.niveau : "region";
  let measure = MEASURES.includes(query.par) ? query.par : "comps";
  let season = query.s === "all" ? "" : (seasons.includes(query.s) ? query.s : seasons[0]);
  const terrain = viewTerrain(query);                   // "" = both disciplines

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("tr.title")}</h1><p class="lede">${t("tr.lede")}</p></div>
      ${modeSwitch("territories")}</div>
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <div class="grid grid-main-side territory-grid" style="margin-bottom:16px;align-items:start">
      ${chartCard({ id: "map", title: t("tr.map"), hint: t("tr.map.hint"), tall: true })}
      <section class="card"><div class="card-head"><div><h2 id="list-title"></h2><div class="hint" id="list-hint"></div></div></div>
        <div id="list" class="territory-table"></div>
        <div class="card-body"><p class="muted" style="font-size:12.5px;margin:0" id="def"></p></div></section>
    </div>`;
  bindChartCard(main, "map");
  bindModeSwitch(main);

  function drawFilters() {
    $("#filters").innerHTML = html`
      <label class="field"><span>${t("f.season")}</span><select id="tr-season">
        <option value="all">${t("nw.allSeasons")}</option>
        ${seasons.map((y) => html`<option value="${y}" ${raw(y === season ? "selected" : "")}>${y}</option>`)}</select></label>
      <div class="field"><span>${t("tr.level")}</span>${seg("level", LEVELS.map((l) => [l, t(`tr.level.${l}`)]), level)}</div>
      <div class="field"><span>${t("tr.measure")}</span>${seg("measure", MEASURES.map((m) => [m, t(`tr.m.${m}`)]), measure)}</div>`;
    $("#tr-season").addEventListener("change", (e) => { season = e.target.value === "all" ? "" : e.target.value; drawFilters(); draw(); });
    $$('[data-seg="level"]').forEach((b) => b.addEventListener("click", () => { level = b.dataset.value; drawFilters(); draw(); }));
    $$('[data-seg="measure"]').forEach((b) => b.addEventListener("click", () => { measure = b.dataset.value; drawFilters(); draw(); }));
  }

  /** Map(place code -> number of competitors registered there). */
  async function registered() {
    const by = new Map();
    const add = (club, n) => {
      const p = data.clubParts(club);
      const region = DEPT_REGION[p.dept] || regionOf(p.ligue);
      const code = level === "dept" ? (DEPT_REGION[p.dept] ? p.dept : null) : region;
      if (code) by.set(code, (by.get(code) || 0) + n);
    };
    for (const [, club, flags, n] of await data.pyramid(season || "all")) if (!terrain || flags & FLAG[terrain]) add(club, n);
    return by;
  }

  /** Per place: { code, comps, runners, ratio }; plus what could not be placed at this level. */
  async function tally() {
    const by = new Map();
    const get = (code) => { if (!by.has(code)) by.set(code, { code, comps: 0, runners: 0, ratio: null }); return by.get(code); };
    let unplaced = 0, total = 0;
    for (const c of data.comps().values()) {
      if ((terrain && c.terrain !== terrain) || (season && String(c.season) !== season)) continue;
      total++;
      const p = placeOf(c.organizer);
      const code = level === "dept" ? p.dept : p.region;
      if (!code) { unplaced++; continue; }
      get(code).comps++;
    }
    for (const [code, n] of await registered()) get(code).runners = n;
    const rows = [...by.values()];
    for (const g of rows) g.ratio = g.runners ? (RATIO_X * g.comps) / g.runners : null;
    return { rows, unplaced, total };
  }

  const placeName = (code) => (level === "dept" ? data.deptName(code) : data.ligueName(code));
  const show = (g, m) => (g[m] == null ? "—" : fmt(g[m], digitsOf(m)));

  let token = 0;
  async function draw() {
    const my = ++token;
    replaceQuery({ vue: "territoires", niveau: level === "region" ? null : level, par: measure === "comps" ? null : measure,
      s: season ? (season === seasons[0] ? null : season) : "all", t: terrain || null });
    const { rows, unplaced, total } = await tally();
    if (my !== token) return;
    const val = (g) => g[measure];
    rows.sort((a, b) => (val(b) ?? -1) - (val(a) ?? -1) || a.code.localeCompare(b.code));
    let pos = 0, last = null;
    rows.forEach((g, i) => { if (val(g) !== last) { pos = i + 1; last = val(g); } g.rank = val(g) == null ? null : pos; });
    const top = rows.find((g) => val(g) != null);
    const period = season ? `${t("f.season")} ${season}` : t("nw.allSeasons");
    $("#tiles").innerHTML = html`
      ${tile(t("tr.m.comps"), fmt(total), period)}
      ${tile(t(`tr.count.${level}`), fmt(rows.length), terrain ? t(`terrain.${terrain}`) : t("ag.allSpecs"))}
      ${tile(`1er · ${t(`tr.m.${measure}`)}`, top ? show(top, measure) : "—", top ? placeName(top.code) : "")}
      ${tile(t("tr.unplaced"), fmt(unplaced), t(`tr.unplaced.${level}`))}`;
    $("#list-title").textContent = `${t(`tr.by.${level}`)} · ${t(`tr.m.${measure}`)}`;
    $("#list-hint").textContent = period;
    $("#def").textContent = t(season ? "tr.def.season" : "tr.def.all");

    const num = (m, title) => ({
      key: m, label: html`<span title="${title}">${t(`tr.col.${m}`)}</span>`, align: "r", cls: "num", sort: (g) => g[m],
      render: (g) => (m === measure ? html`<b>${show(g, m)}</b>` : show(g, m)),
    });
    dataTable($("#list"), {
      rows, sortKey: "rank", sortDir: 1, emptyText: t("tr.none"),
      columns: [
        { key: "rank", label: "#", cls: "rank num", sort: (g) => g.rank, defaultDir: 1, render: (g) => (g.rank == null ? "—" : g.rank) },
        { key: "name", label: t(`tr.level.${level}`), sort: (g) => placeName(g.code), defaultDir: 1,
          render: (g) => html`<span class="name">${placeName(g.code)}</span>${level === "dept"
            ? html`<div class="dim place-sub">${g.code} · ${data.ligueName(DEPT_REGION[g.code])}</div>` : html`<span class="dim"> ${g.code}</span>`}` },
        num("comps", t("tr.m.comps")), num("runners", t("tr.m.runners")), num("ratio", t("tr.m.ratio")),
      ],
    });

    // the map: metropolitan France (overseas ligues are in the table)
    const map = await loadMap(level === "dept" ? "departements" : "regions");
    if (my !== token) return;
    const byCode = new Map(rows.map((g) => [g.code, g]));
    const values = new Map();
    for (const g of rows) if (val(g) != null) for (const f of featuresOf(g.code)) values.set(f, val(g));
    $("#map-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t(`tr.level.${level}`)}</th>
      <th class="r">${t("tr.col.comps")}</th><th class="r">${t("tr.col.runners")}</th><th class="r">${t("tr.col.ratio")}</th></tr></thead>
      <tbody>${rows.map((g) => html`<tr><td>${g.code} · ${placeName(g.code)}</td>
      <td class="r num">${show(g, "comps")}</td><td class="r num">${show(g, "runners")}</td><td class="r num">${show(g, "ratio")}</td></tr>`)}</tbody></table>`;
    if (!map) { $("#map").innerHTML = html`<div class="empty">${t("tr.noMap")}</div>`; return; }
    const code = (f) => (f === "2A" || f === "2B" ? "20" : f);
    mapChart($("#map"), {
      map, values, name: t(`tr.m.${measure}`), digits: digitsOf(measure), traffic: true,
      tip: (f) => {
        const g = byCode.get(code(f));
        return String(html`<b>${placeName(code(f))}</b> <span style="color:var(--ink-3)">${code(f)}</span><br>
          <b>${fmt(g?.comps || 0)}</b> ${t("tr.m.comps").toLowerCase()} · <b>${fmt(g?.runners || 0)}</b> ${t("tr.m.runners").toLowerCase()}
          <br>${g ? show(g, "ratio") : "—"} ${t("tr.m.ratio").toLowerCase()}
          ${g && g.rank != null ? html`<br><span style="color:var(--ink-3)">${ord(g.rank)} ${t(`tr.of.${level}`)} · ${t(`tr.m.${measure}`).toLowerCase()}</span>` : ""}`);
      },
    });
  }

  drawFilters();
  await draw();
  return { title: `${t("nw.title")} · ${t("tr.title")}` };
}
