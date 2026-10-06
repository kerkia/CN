// Réseau · Âges: the age pyramid of one season's competitors — women on the left, men on
// the right, each category as a share of everyone selected. By default the whole population;
// the site's discipline switch (both by default), a ligue or a club narrow it, and the whole
// population stays drawn as an outline for comparison.
//
// Competitors of a season = anyone with a result in it, "nc" rows included, with the category
// and club of their last race of the season (site_extras.pyramid).

import { html, raw, $, fmt } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { pyramidChart, css } from "../charts.js";
import { chartCard, bindChartCard, tile, legend } from "../ui.js";
import { DEPT_REGION, regionOf } from "../geo.js";
import { replaceQuery, viewTerrain } from "../app.js";
import { modeSwitch, bindModeSwitch } from "./netmodes.js";

const FLAG = { For: 1, Spr: 2, VTT: 4, Ski: 8 };          // site_extras.PYR_FLAG
const SEXES = ["D", "H"];

/** Rows of a season file, with what the filters need. */
function prepare(rows) {
  return rows.map(([cat, club, flags, n]) => {
    const m = /^([HD])(\d+)$/.exec(cat);
    const p = data.clubParts(club);
    return { sexe: m?.[1], age: m ? Number(m[2]) : null, code: p.code, region: DEPT_REGION[p.dept] || regionOf(p.ligue), flags, n };
  }).filter((r) => r.sexe);
}

/** { ages: [..], count: {D: Map(age -> n), H: …}, total } over the rows kept. */
function tally(rows) {
  const count = { D: new Map(), H: new Map() };
  let total = 0;
  for (const r of rows) { count[r.sexe].set(r.age, (count[r.sexe].get(r.age) || 0) + r.n); total += r.n; }
  return { count, total };
}

export async function render(main, query) {
  const seasons = data.meta().seasons.map(String).reverse();
  let season = seasons.includes(query.s) ? query.s : seasons[0];
  const spec = viewTerrain(query);                      // "" = both disciplines
  let ligue = query.ligue || "";
  let club = query.club || "";

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ag.title")}</h1><p class="lede">${t("ag.lede")}</p></div>
      ${modeSwitch("ages")}</div>
    <div class="filters" id="filters"></div>
    <div class="tiles" id="tiles" style="margin-bottom:16px"></div>
    ${chartCard({ id: "pyr", title: t("ag.chart"), hint: t("ag.chart.hint"), tall: true })}
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("ag.def")}</p>`;
  bindChartCard(main, "pyr");
  bindModeSwitch(main);

  let rows = [];
  async function load() { rows = prepare(await data.pyramid(season)); }

  function drawFilters() {
    const inSpec = rows.filter((r) => !spec || r.flags & FLAG[spec]);
    const regions = [...new Set(inSpec.map((r) => r.region).filter(Boolean))]
      .sort((a, b) => data.ligueName(a).localeCompare(data.ligueName(b), "fr"));
    if (ligue && !regions.includes(ligue)) ligue = "";
    const perClub = new Map();
    for (const r of inSpec) if (r.code && (!ligue || r.region === ligue)) perClub.set(r.code, (perClub.get(r.code) || 0) + r.n);
    const clubs = [...perClub.keys()].sort();             // by club number: département first
    if (club && !perClub.has(club)) club = "";
    $("#filters").innerHTML = html`
      <label class="field"><span>${t("f.season")}</span><select id="ag-season">
        ${seasons.map((y) => html`<option value="${y}" ${raw(y === season ? "selected" : "")}>${y}</option>`)}</select></label>
      <label class="field"><span>${t("f.ligue")}</span><select id="ag-ligue">
        <option value="">${t("ag.allLigues")}</option>
        ${regions.map((l) => html`<option value="${l}" ${raw(l === ligue ? "selected" : "")}>${data.ligueName(l)}</option>`)}</select></label>
      <label class="field"><span>${t("f.club")}</span><select id="ag-club" style="max-width:340px">
        <option value="">${t("ag.allClubs")}</option>
        ${clubs.map((c) => html`<option value="${c}" ${raw(c === club ? "selected" : "")}>${c} · ${data.clubName(c)} (${fmt(perClub.get(c))})</option>`)}</select></label>`;
    $("#ag-season").addEventListener("change", async (e) => { season = e.target.value; await load(); drawFilters(); draw(); });
    $("#ag-ligue").addEventListener("change", (e) => { ligue = e.target.value; club = ""; drawFilters(); draw(); });
    $("#ag-club").addEventListener("change", (e) => { club = e.target.value; draw(); });
  }

  function draw() {
    replaceQuery({ vue: "ages", s: season === seasons[0] ? null : season, t: spec || null, ligue: ligue || null, club: club || null });
    const inSpec = rows.filter((r) => !spec || r.flags & FLAG[spec]);
    const sel = inSpec.filter((r) => (!ligue || r.region === ligue) && (!club || r.code === club));
    const filtered = !!(ligue || club);
    const cur = tally(sel), ref = filtered ? tally(inSpec) : null;
    const ages = [...new Set(inSpec.map((r) => r.age))].sort((a, b) => a - b);
    const pct = (tl, s, a) => (tl.total ? (100 * (tl.count[s].get(a) || 0)) / tl.total : 0);
    const sum = (tl, keep) => { let n = 0; for (const s of SEXES) for (const [a, v] of tl.count[s]) if (keep(s, a)) n += v; return n; };
    const share = (n) => (cur.total ? fmt((100 * n) / cur.total, 1) + " %" : "—");
    const where = club ? data.clubName(club) : ligue ? data.ligueName(ligue) : t("ag.total");

    $("#tiles").innerHTML = html`
      ${tile(t("ag.runners"), fmt(cur.total), `${where} · ${season} · ${spec ? t(`terrain.${spec}`) : t("ag.allSpecs")}`)}
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

  await load();
  drawFilters();
  draw();
  return { title: `${t("nw.title")} · ${t("ag.title")}` };
}
