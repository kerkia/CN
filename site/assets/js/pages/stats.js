// Réseau · Statistiques: the headline figures, the participation season by season and the age pyramid of
// a season, for everyone or for one ligue or club, in all the specialités or the one chosen.
//
// Competitors and results: the runners of the clubs selected, each under the club of their last race of
// the season ("nc" rows included; site_extras.pyramid). Competitions: those organised by the club, or in
// the ligue (from the organiser, as in Territoires). The pyramid: one season's competitors, women on the
// left, men on the right, each category as a share of everyone selected; with a ligue or a club, the whole
// population stays drawn as an outline for comparison.

import { html, raw, $, $$, fmt } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { columnChart, pyramidChart, terrainColor, css } from "../charts.js";
import { chartCard, bindChartCard, tile, seg, legend } from "../ui.js";
import { TERRAINS } from "../store.js";
import { DEPT_REGION, regionOf, placeOf } from "../geo.js";
import { replaceQuery, viewTerrain, terrainField } from "../app.js";
import { netHead, bindModeSwitch } from "./netmodes.js";

const MEASURES = ["runners", "comps", "results"];
const FLAG = { For: 1, Spr: 2, VTT: 4, Ski: 8 };          // site_extras.PYR_FLAG
const SEXES = ["D", "H"];

/** Club number and ligue (region) of a club string. */
function placeOfClub(club) {
  const p = data.clubParts(club);
  return { code: p.code, region: DEPT_REGION[p.dept] || regionOf(p.ligue) };
}

/** Rows of a pyramid season file, with what the filters need. */
function prepare(rows) {
  return rows.map(([cat, club, flags, n]) => {
    const m = /^([HD])(\d+)$/.exec(cat);
    return { sexe: m?.[1], age: m ? Number(m[2]) : null, ...placeOfClub(club), flags, n };
  }).filter((r) => r.sexe);
}

/** { count: {D: Map(age -> n), H: …}, total } over the rows kept. */
function tally(rows) {
  const count = { D: new Map(), H: new Map() };
  let total = 0;
  for (const r of rows) { count[r.sexe].set(r.age, (count[r.sexe].get(r.age) || 0) + r.n); total += r.n; }
  return { count, total };
}

export async function render(main, query) {
  const spec = viewTerrain(query);                        // "" = every specialité
  const shown = spec ? [spec] : TERRAINS;
  const pyrSeasons = data.meta().seasons.map(String).reverse();
  let measure = MEASURES.includes(query.par) ? query.par : "runners";
  let season = pyrSeasons.includes(query.s) ? query.s : pyrSeasons[0];
  let ligue = query.ligue || "";
  let club = query.club || "";

  main.innerHTML = html`
    ${netHead("stats", t("sx.title"), t("sx.lede"))}
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    ${chartCard({ id: "part", title: t("ov.participation"), hint: t("ov.participation.hint"), short: true,
      tools: html`<span id="measure-seg"></span>` })}
    <p class="muted" style="font-size:12.5px;margin:10px 2px 24px">${t("act.def")}</p>
    <h2 style="margin:0 0 12px">${t("ag.title")}</h2>
    <div class="tiles" id="pyr-tiles" style="margin-bottom:16px"></div>
    ${chartCard({ id: "pyr", title: t("ag.chart"), hint: t("ag.chart.hint"), tall: true, tools: html`<span id="season-field"></span>` })}
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("ag.def")}</p>`;
  bindChartCard(main, "part");
  bindChartCard(main, "pyr");
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

  let pyrRows = [];
  async function loadSeason() { pyrRows = prepare(await data.pyramid(season)); }

  const save = () => replaceQuery({ vue: "stats", t: spec || null, ligue: ligue || null, club: club || null,
    par: measure === "runners" ? null : measure, s: season === pyrSeasons[0] ? null : season });

  function drawFilters() {
    // clubs and ligues with competitors in the specialités shown, over every season
    const perClub = new Map(), regions = new Set();
    for (const [, c, flags, n] of everyone) {
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
      <label class="field"><span>${t("f.ligue")}</span><select id="sx-ligue">
        <option value="">${t("ag.allLigues")}</option>
        ${regionList.map((l) => html`<option value="${l}" ${raw(l === ligue ? "selected" : "")}>${data.ligueName(l)}</option>`)}</select></label>
      <label class="field"><span>${t("f.club")}</span><select id="sx-club" style="max-width:340px">
        <option value="">${t("ag.allClubs")}</option>
        ${clubList.map((c) => html`<option value="${c}" ${raw(c === club ? "selected" : "")}>${c} · ${data.clubName(c)} (${fmt(perClub.get(c))})</option>`)}</select></label>`;
    $("#sx-ligue").addEventListener("change", (e) => { ligue = e.target.value; club = ""; drawFilters(); draw(); });
    $("#sx-club").addEventListener("change", (e) => { club = e.target.value; draw(); });
  }

  function draw() {
    save();
    drawActivity();
    drawPyramid();
  }

  // ---- the headline figures and the participation ------------------------------------------------------
  function drawActivity() {
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
    $$('[data-seg="measure"]').forEach((b) => b.addEventListener("click", () => { measure = b.dataset.value; save(); drawActivity(); }));
    const i = { comps: 0, runners: 1, results: 2 }[measure];
    const series = shown.map((x) => ({ name: t(`terrain.${x}`), color: terrainColor(x), data: seasons.map((y) => by[y][x][i]) }));
    $("#part-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
    columnChart($("#part"), { categories: seasons, series });
    $("#part-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.season")}</th>
      ${shown.map((x) => html`<th class="r">${t("ov.comps")} · ${t(`terrain.${x}`)}</th><th class="r">${t("ov.runners")}</th><th class="r">${t("ov.results")}</th>`)}</tr></thead>
      <tbody>${[...seasons].reverse().map((y) => html`<tr><td>${y}</td>${shown.map((x) =>
        by[y][x].map((v) => html`<td class="r num">${fmt(v)}</td>`))}</tr>`)}</tbody></table>`;
  }

  // ---- the age pyramid of one season -------------------------------------------------------------------------
  function drawPyramid() {
    $("#season-field").innerHTML = html`<label class="field" style="flex-direction:row;align-items:center;gap:6px"><span>${t("f.season")}</span>
      <select id="sx-season">${pyrSeasons.map((y) => html`<option value="${y}" ${raw(y === season ? "selected" : "")}>${y}</option>`)}</select></label>`;
    $("#sx-season").addEventListener("change", async (e) => { season = e.target.value; await loadSeason(); save(); drawPyramid(); });

    const inSpec = pyrRows.filter((r) => !spec || r.flags & FLAG[spec]);
    const sel = inSpec.filter((r) => (!ligue || r.region === ligue) && (!club || r.code === club));
    const filtered = !!(ligue || club);
    const cur = tally(sel), ref = filtered ? tally(inSpec) : null;
    const ages = [...new Set(inSpec.map((r) => r.age))].sort((a, b) => a - b);
    const pct = (tl, s, a) => (tl.total ? (100 * (tl.count[s].get(a) || 0)) / tl.total : 0);
    const sum = (tl, keep) => { let n = 0; for (const s of SEXES) for (const [a, v] of tl.count[s]) if (keep(s, a)) n += v; return n; };
    const share = (n) => (cur.total ? fmt((100 * n) / cur.total, 1) + " %" : "—");
    const whereLabel = club ? data.clubName(club) : ligue ? data.ligueName(ligue) : t("ag.total");

    $("#pyr-tiles").innerHTML = html`
      ${tile(t("ag.runners"), fmt(cur.total), `${whereLabel} · ${season} · ${spec ? t(`terrain.${spec}`) : t("ag.allSpecs")}`)}
      ${tile(t("ag.women"), share(sum(cur, (s) => s === "D")), `${fmt(sum(cur, (s) => s === "D"))} ${t("ag.runners").toLowerCase()}`)}
      ${tile(t("ag.young"), share(sum(cur, (s, a) => a <= 20)), `${fmt(sum(cur, (s, a) => a <= 20))} ${t("ag.runners").toLowerCase()}`)}
      ${tile(t("ag.vets"), share(sum(cur, (s, a) => a >= 35)), `${fmt(sum(cur, (s, a) => a >= 35))} ${t("ag.runners").toLowerCase()}`)}`;

    if (!cur.total) {
      window.echarts?.getInstanceByDom($("#pyr"))?.dispose();
      $("#pyr").innerHTML = html`<div class="empty">${t("ag.none")}</div>`;
      $("#pyr-legend").innerHTML = "";
      $("#pyr-table").innerHTML = "";
      return;
    }
    $("#pyr .empty")?.remove();
    const cD = css("--s2"), cH = css("--s1");
    $("#pyr-legend").innerHTML = legend([
      { color: cD, label: t("ag.women") }, { color: cH, label: t("ag.men") },
      ...(filtered ? [{ color: `repeating-linear-gradient(90deg, ${css("--ink")} 0 4px, transparent 4px 7px)`, label: t("ag.ref") }] : []),
    ]);
    const n = (tl, s, a) => tl.count[s].get(a) || 0;
    const line = (color, label, tl, s, a) => `<div style="display:flex;gap:8px;align-items:center;margin-top:3px">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color}"></span><b>${fmt(pct(tl, s, a), 1)} %</b>
      <span style="color:var(--ink-2)">${label} · ${fmt(n(tl, s, a))}</span></div>`;
    pyramidChart($("#pyr"), {
      categories: ages.map(String),
      left: { name: t("ag.women"), color: cD, data: ages.map((a) => pct(cur, "D", a)) },
      right: { name: t("ag.men"), color: cH, data: ages.map((a) => pct(cur, "H", a)) },
      refLeft: ref && ages.map((a) => pct(ref, "D", a)),
      refRight: ref && ages.map((a) => pct(ref, "H", a)),
      tip: (i) => {
        const a = ages[i];
        return `<div style="color:var(--ink-3);font-size:12px">${t("ag.cat")} D${a} · H${a}</div>
          ${line(cD, t("ag.women"), cur, "D", a)}${line(cH, t("ag.men"), cur, "H", a)}
          ${ref ? `<div style="color:var(--ink-3);font-size:12px;margin-top:6px">${t("ag.refShort")} : D ${fmt(pct(ref, "D", a), 1)} % · H ${fmt(pct(ref, "H", a), 1)} %</div>` : ""}`;
      },
    });
    const cell = (tl, s, a) => html`<td class="r num">${fmt(n(tl, s, a))}</td><td class="r num">${fmt(pct(tl, s, a), 1)} %</td>`;
    $("#pyr-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("ag.cat")}</th>
      <th class="r">${t("ag.women")}</th><th class="r">%</th><th class="r">${t("ag.men")}</th><th class="r">%</th>
      ${filtered ? html`<th class="r">${t("ag.refShort")} D %</th><th class="r">${t("ag.refShort")} H %</th>` : ""}</tr></thead>
      <tbody>${[...ages].reverse().map((a) => html`<tr><td>${a}</td>${cell(cur, "D", a)}${cell(cur, "H", a)}
        ${filtered ? html`<td class="r num">${fmt(pct(ref, "D", a), 1)} %</td><td class="r num">${fmt(pct(ref, "H", a), 1)} %</td>` : ""}</tr>`)}</tbody></table>`;
  }

  await loadSeason();
  drawFilters();
  draw();
  return { title: `${t("nw.title")} · ${t("sx.title")}` };
}
