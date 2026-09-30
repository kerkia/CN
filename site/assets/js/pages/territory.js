// Réseau · Territoires: how many competitions each ligue (region) or département
// hosted, over one season or all of them, in the chosen discipline — as a map
// and a table.

import { html, raw, $, $$, fmt, ord } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { mapChart } from "../charts.js";
import { chartCard, bindChartCard, dataTable, tile, seg } from "../ui.js";
import { DEPT_REGION, placeOf, loadMap, featuresOf } from "../geo.js";
import { link, replaceQuery } from "../app.js";

const LEVELS = ["region", "dept"];
const MEASURES = ["comps", "runners"];

export async function render(main, query) {
  const seasons = data.meta().seasons.map(String).reverse();
  let level = LEVELS.includes(query.niveau) ? query.niveau : "region";
  let measure = MEASURES.includes(query.par) ? query.par : "comps";
  let season = query.s === "all" ? "" : (seasons.includes(query.s) ? query.s : seasons[0]);

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("tr.title")}</h1><p class="lede">${t("tr.lede")}</p></div>
      <div class="row"><a class="btn" href="${link.networkLeaders()}">${t("nw.global")}</a></div></div>
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    <div class="grid grid-main-side" style="margin-bottom:16px;align-items:start">
      ${chartCard({ id: "map", title: t("tr.map"), hint: t("tr.map.hint"), tall: true })}
      <section class="card"><div class="card-head"><div><h2 id="list-title"></h2><div class="hint" id="list-hint"></div></div></div>
        <div id="list"></div></section>
    </div>`;
  bindChartCard(main, "map");

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

  /** Per place: { code, comps, runners }; plus what could not be placed at this level. */
  function tally() {
    const terrain = store.get().terrain;
    const by = new Map();
    let unplaced = 0, total = 0;
    for (const c of data.comps().values()) {
      if (c.terrain !== terrain || (season && String(c.season) !== season)) continue;
      total++;
      const p = placeOf(c.location, c.organizer);
      const code = level === "dept" ? p.dept : p.region;
      if (!code) { unplaced++; continue; }
      const g = by.get(code) || { code, comps: 0, runners: 0 };
      g.comps++;
      g.runners += c.n || 0;
      by.set(code, g);
    }
    return { rows: [...by.values()], unplaced, total };
  }

  const placeName = (code) => (level === "dept" ? data.deptName(code) : data.ligueName(code));

  let token = 0;
  async function draw() {
    const my = ++token;
    replaceQuery({ vue: "territoires", niveau: level === "region" ? null : level, par: measure === "comps" ? null : measure,
      s: season ? (season === seasons[0] ? null : season) : "all" });
    const { rows, unplaced, total } = tally();
    const val = (g) => g[measure];
    rows.sort((a, b) => val(b) - val(a) || a.code.localeCompare(b.code));
    let pos = 0, last = null;
    rows.forEach((g, i) => { if (val(g) !== last) { pos = i + 1; last = val(g); } g.rank = pos; });
    const sum = rows.reduce((s, g) => s + val(g), 0);
    const top = rows[0];
    const period = season ? `${t("f.season")} ${season}` : t("nw.allSeasons");
    $("#tiles").innerHTML = html`
      ${tile(t("tr.m.comps"), fmt(total), period)}
      ${tile(t(`tr.count.${level}`), fmt(rows.length), t(`terrain.${store.get().terrain}`))}
      ${tile(`1er · ${t(`tr.m.${measure}`)}`, top ? fmt(val(top)) : "—", top ? placeName(top.code) : "")}
      ${tile(t("tr.unplaced"), fmt(unplaced), t(`tr.unplaced.${level}`))}`;
    $("#list-title").textContent = `${t(`tr.by.${level}`)} · ${t(`tr.m.${measure}`)}`;
    $("#list-hint").textContent = period;

    dataTable($("#list"), {
      rows, pageSize: level === "dept" ? 25 : "all", sortKey: "rank", sortDir: 1, emptyText: t("tr.none"),
      columns: [
        { key: "rank", label: t("rk.col.rank"), cls: "rank num", sort: (g) => g.rank, defaultDir: 1 },
        { key: "code", label: t("col.code"), cls: "num dim", sort: (g) => g.code, defaultDir: 1, render: (g) => g.code },
        { key: "name", label: t(`tr.level.${level}`), sort: (g) => placeName(g.code), defaultDir: 1,
          render: (g) => html`<span class="name">${placeName(g.code)}</span>` },
        ...(level === "dept" ? [{ key: "lg", label: t("f.ligue"), sort: (g) => data.ligueName(DEPT_REGION[g.code]), defaultDir: 1,
          render: (g) => html`<span class="dim">${data.ligueName(DEPT_REGION[g.code])}</span>` }] : []),
        ...MEASURES.map((m) => ({ key: m, label: t(`tr.m.${m}`), align: "r", cls: "num", sort: (g) => g[m],
          render: (g) => (m === measure ? html`<b>${fmt(g[m])}</b>` : fmt(g[m])) })),
        { key: "share", label: t("tr.share"), align: "r", cls: "num dim", sort: (g) => val(g),
          render: (g) => `${fmt(sum ? 100 * val(g) / sum : 0, 1)} %` },
      ],
    });

    // the map: metropolitan France (overseas ligues are in the table)
    const map = await loadMap(level === "dept" ? "departements" : "regions");
    if (my !== token) return;
    const byCode = new Map(rows.map((g) => [g.code, g]));
    const values = new Map();
    for (const g of rows) for (const f of featuresOf(g.code)) values.set(f, val(g));
    $("#map-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t(`tr.level.${level}`)}</th>
      <th class="r">${t(`tr.m.${measure}`)}</th></tr></thead><tbody>${rows.map((g) => html`<tr><td>${g.code} · ${placeName(g.code)}</td>
      <td class="r num">${fmt(val(g))}</td></tr>`)}</tbody></table>`;
    if (!map) { $("#map").innerHTML = html`<div class="empty">${t("tr.noMap")}</div>`; return; }
    const code = (f) => (f === "2A" || f === "2B" ? "20" : f);
    mapChart($("#map"), {
      map, values, name: t(`tr.m.${measure}`),
      tip: (f) => {
        const g = byCode.get(code(f));
        return html`<b>${placeName(code(f))}</b> <span style="color:var(--ink-3)">${code(f)}</span><br>
          <b>${fmt(g?.comps || 0)}</b> ${t("tr.m.comps").toLowerCase()} · ${fmt(g?.runners || 0)} ${t("tr.m.runners").toLowerCase()}
          ${g ? html`<br><span style="color:var(--ink-3)">${ord(g.rank)} ${t(`tr.of.${level}`)}</span>` : ""}`;
      },
    });
  }

  drawFilters();
  await draw();
  return { title: `${t("nw.title")} · ${t("tr.title")}` };
}
