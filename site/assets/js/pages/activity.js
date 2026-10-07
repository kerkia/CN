// Réseau · Activité: the headline figures and the participation season by season, for
// everyone or for one ligue or club, in all the specialités or the one chosen at the top.
//
// Competitors and results: the runners of the clubs selected, each under the club of their
// last race of the season ("nc" rows included; site_extras.pyramid). Competitions: those
// organised by the club, or in the ligue (from the organiser, as in Territoires).

import { html, raw, $, $$, fmt } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { columnChart, terrainColor } from "../charts.js";
import { chartCard, bindChartCard, tile, seg, legend } from "../ui.js";
import { TERRAINS } from "../store.js";
import { DEPT_REGION, regionOf, placeOf } from "../geo.js";
import { replaceQuery, viewTerrain, terrainField } from "../app.js";
import { modeSwitch, bindModeSwitch } from "./netmodes.js";

const MEASURES = ["runners", "comps", "results"];
const FLAG = { For: 1, Spr: 2, VTT: 4, Ski: 8 };          // site_extras.PYR_FLAG

/** Club number and ligue (region) of a club string. */
function placeOfClub(club) {
  const p = data.clubParts(club);
  return { code: p.code, region: DEPT_REGION[p.dept] || regionOf(p.ligue) };
}

export async function render(main, query) {
  const spec = viewTerrain(query);                        // "" = every specialité
  const shown = spec ? [spec] : TERRAINS;
  let measure = MEASURES.includes(query.par) ? query.par : "runners";
  let ligue = query.ligue || "";
  let club = query.club || "";

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("act.title")}</h1><p class="lede">${t("act.lede")}</p></div>
      ${modeSwitch("activity")}</div>
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    ${chartCard({ id: "part", title: t("ov.participation"), hint: t("ov.participation.hint"), short: true,
      tools: html`<span id="measure-seg"></span>` })}
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("act.def")}</p>`;
  bindChartCard(main, "part");
  bindModeSwitch(main);

  const [part, everyone] = await Promise.all([data.participation(), data.pyramid("all")]);
  const seasons = Object.keys(part).sort();
  // every club's place, once
  const where = new Map();
  for (const rows of Object.values(part)) for (const [c] of rows) if (!where.has(c)) where.set(c, placeOfClub(c));
  const comps = [...data.comps().values()].map((c) => {
    const o = c.organizer || "", m = /^(\d{4}) - /.exec(o);
    return { ...c, code: m ? m[1] : null, region: placeOf(o).region };
  });

  const inClub = (c) => { const p = where.get(c) || placeOfClub(c); return (!ligue || p.region === ligue) && (!club || p.code === club); };
  const inComp = (c) => (!ligue || c.region === ligue) && (!club || c.code === club);

  function drawFilters() {
    // clubs and ligues with competitors in the specialités shown
    const perClub = new Map(), regions = new Set();
    for (const [cat, c, flags, n] of everyone) {
      if (!shown.some((x) => flags & FLAG[x])) continue;
      const p = where.get(c) || placeOfClub(c);
      if (p.region) regions.add(p.region);
      if (p.code && (!ligue || p.region === ligue)) perClub.set(p.code, (perClub.get(p.code) || 0) + n);
    }
    if (ligue && !regions.has(ligue)) ligue = "";
    if (club && !perClub.has(club)) club = "";
    const regionList = [...regions].sort((a, b) => data.ligueName(a).localeCompare(data.ligueName(b), "fr"));
    const clubList = [...perClub.keys()].sort();           // by club number: département first
    $("#filters").innerHTML = html`${terrainField()}
      <label class="field"><span>${t("f.ligue")}</span><select id="act-ligue">
        <option value="">${t("ag.allLigues")}</option>
        ${regionList.map((l) => html`<option value="${l}" ${raw(l === ligue ? "selected" : "")}>${data.ligueName(l)}</option>`)}</select></label>
      <label class="field"><span>${t("f.club")}</span><select id="act-club" style="max-width:340px">
        <option value="">${t("ag.allClubs")}</option>
        ${clubList.map((c) => html`<option value="${c}" ${raw(c === club ? "selected" : "")}>${c} · ${data.clubName(c)} (${fmt(perClub.get(c))})</option>`)}</select></label>`;
    $("#act-ligue").addEventListener("change", (e) => { ligue = e.target.value; club = ""; drawFilters(); draw(); });
    $("#act-club").addEventListener("change", (e) => { club = e.target.value; draw(); });
  }

  function draw() {
    replaceQuery({ vue: "activite", t: spec || null, ligue: ligue || null, club: club || null, par: measure === "runners" ? null : measure });
    // season -> terrain -> [competitions, competitors, results]
    const by = Object.fromEntries(seasons.map((y) => [y, Object.fromEntries(shown.map((x) => [x, [0, 0, 0]]))]));
    for (const [y, rows] of Object.entries(part)) {
      for (const [c, x, n, r] of rows) if (by[y][x] && inClub(c)) { by[y][x][1] += n; by[y][x][2] += r; }
    }
    let circuits = 0, nComps = 0;
    for (const c of comps) {
      const y = String(c.season);
      if (!by[y]?.[c.terrain] || !inComp(c)) continue;
      by[y][c.terrain][0]++;
      nComps++;
      circuits += c.nCircuits;
    }
    let runners = 0;
    for (const [, c, flags, n] of everyone) if (shown.some((x) => flags & FLAG[x]) && inClub(c)) runners += n;
    const results = seasons.reduce((s, y) => s + shown.reduce((u, x) => u + by[y][x][2], 0), 0);
    const active = seasons.filter((y) => shown.some((x) => by[y][x][1] || by[y][x][0]));
    const scope = club ? `${club} · ${data.clubName(club)}` : ligue ? data.ligueName(ligue) : t("ag.total");
    $("#tiles").innerHTML = html`
      ${tile(t("ov.seasons"), active.length ? `${active[0]}–${active[active.length - 1]}` : "—", `${fmt(active.length)} ${t("ov.seasonsN")}`)}
      ${tile(t("ov.runners"), fmt(runners), `${scope} · ${spec ? t(`terrain.${spec}`) : t("ag.allSpecs")}`)}
      ${tile(t("ov.comps"), fmt(nComps), `${fmt(circuits)} ${t("co.circuits")}${club ? ` · ${t("act.organised")}` : ""}`)}
      ${tile(t("ov.results"), fmt(results))}`;

    $("#measure-seg").innerHTML = seg("measure", MEASURES.map((m) => [m, t(`ov.${m}`)]), measure);
    $$('[data-seg="measure"]').forEach((b) => b.addEventListener("click", () => { measure = b.dataset.value; draw(); }));
    const i = { comps: 0, runners: 1, results: 2 }[measure];
    const series = shown.map((x) => ({ name: t(`terrain.${x}`), color: terrainColor(x), data: seasons.map((y) => by[y][x][i]) }));
    $("#part-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
    columnChart($("#part"), { categories: seasons, series });
    $("#part-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.season")}</th>
      ${shown.map((x) => html`<th class="r">${t("ov.comps")} · ${t(`terrain.${x}`)}</th><th class="r">${t("ov.runners")}</th><th class="r">${t("ov.results")}</th>`)}</tr></thead>
      <tbody>${[...seasons].reverse().map((y) => html`<tr><td>${y}</td>${shown.map((x) =>
        by[y][x].map((v) => html`<td class="r num">${fmt(v)}</td>`))}</tr>`)}</tbody></table>`;
  }

  drawFilters();
  draw();
  return { title: `${t("nw.title")} · ${t("act.title")}` };
}
