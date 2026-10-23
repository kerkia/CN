// « Analyse de course » (#/analyse-course, menu « Courses »; owner, 2026-10-23: the split-time analysis was buried under a
// race's page of « Résultats »): the races of the site's country whose organisers published split times, the latest first,
// each opening the analysis (pages/splits.js, #/analyse-course?course=<race>). On top, the races live now whose live results
// give split times (livesplits.js: rare — most lives give the finish only), analysed on the times received so far.

import { html, raw, $, $$, fmt, fmtDate, normalise, fmtFormat } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as country from "../country.js";
import { seg, filterFold } from "../ui.js";
import { replaceQuery } from "../app.js";
import { getProv } from "./provisional.js";
import { LIVE, LIVE_KEY, probe } from "../livesplits.js";

const SPECS = ["For", "Spr", "VTT", "Ski"];
const specOf = (r) => ({ "Forêt": "For", Sprint: "Spr", VTT: "VTT", Ski: "Ski" })[r.terrain]     // i18n-ignore
  || (r.epreuve === "Sprint" ? "Spr" : ["MD", "LD", "Nuit"].includes(r.epreuve) ? "For" : null);
const parts = (...xs) => [...new Set(xs.filter(Boolean))].join(" · ");
const MAX_PROBE = 6;                       // live races looked at, at most (each a short connection to the relay)
export const analysisLink = (key, q = "") => `#/analyse-course?course=${encodeURIComponent(key)}${q}`;

export async function render(main, { query = {} } = {}) {
  let q = query.q || "", spec = SPECS.includes(query.t) ? query.t : "all";
  const me = country.current() === "FR" ? auth.myId() : null;
  let mine = !!me && query.mes === "1";
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.raceAnalysis")}</h1><p class="lede">${t("ra.lede")}</p></div></div>
    <div id="ra-live"></div>
    ${filterFold(html`<div class="filters"><div class="field"><span>${t("f.terrain")}</span><div id="ra-t"></div></div>
      ${me ? html`<label class="field"><span>${t("prov.runner")}</span><span class="row" style="gap:6px;align-items:center;min-height:32px">
        <input type="checkbox" id="ra-mine" ${raw(mine ? "checked" : "")}> ${t("ra.mine")}</span></label>` : ""}
      <label class="field"><span>${t("prov.search")}</span><input type="search" id="ra-q" value="${q}" style="width:200px"></label></div>`)}
    ${country.hint("cty.hint.splits")}
    <section class="card"><div class="table-wrap" id="ra-table"><div class="empty">${t("lv.loading")}</div></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("ra.def")}</p>`;
  liveNow();
  const idx = await getProv("index.json");
  const races = (idx?.races || []).filter((r) => r.splits && !r.soon && country.of(r) === country.current())
    .sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name));
  const draw = () => {
    replaceQuery({ q: q || null, t: spec === "all" ? null : spec, mes: mine ? "1" : null });
    $("#ra-t").innerHTML = seg("rat", [["all", t("f.all")], ...SPECS.filter((s) => races.some((r) => specOf(r) === s)).map((s) => [s, t(`terrain.${s}`)])], spec);
    $$('[data-seg="rat"]').forEach((b) => b.addEventListener("click", () => { spec = b.dataset.value; draw(); }));
    const qn = normalise(q);
    const rows = races.filter((r) => (spec === "all" || specOf(r) === spec) && (!mine || (r.lics || []).includes(me))
      && (!qn || normalise(`${r.name} ${r.place || ""} ${r.org || ""}`).includes(qn)));
    // the format with the place and the organiser, under the name: one column less, for a phone
    $("#ra-table").innerHTML = rows.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("prov.race")}</th>
        <th class="r ra-n">${t("prov.runners")}</th><th>${t("nav.recent")}</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr><td class="num">${fmtDate(r.date_iso, "short")}</td>
        <td class="pv-race"><a href="${analysisLink(r.key)}">${r.name}</a>
          ${me && (r.lics || []).includes(me) ? html` <span class="tag" title="${t("ra.mine.tip")}">${t("ra.mine.tag")}</span>` : ""}
          ${r.ongoing ? html` <span class="lv-badge" title="${t("prov.ongoing.tip")}">${t("prov.ongoing")}</span>` : ""}
          <div class="muted" style="font-size:12px">${[parts(fmtFormat(r.epreuve), fmtFormat(r.terrain)), r.place, r.org].filter(Boolean).join(" · ")}</div></td>
        <td class="r num ra-n">${r.runners ? fmt(r.runners) : "—"}</td>
        <td><a href="#/resultats?course=${encodeURIComponent(r.key)}">${t("prov.seeSplits")}</a></td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t(races.length ? "ra.emptyFilter" : "ra.empty")}</div>`;
  };
  draw();
  $("#ra-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  $("#ra-mine")?.addEventListener("change", (e) => { mine = e.target.checked; draw(); });
  return { title: t("nav.raceAnalysis") };
}

/** The races of the site's country live now (the relay's list: their last punch under liveS seconds old) whose live
 *  results give split times, as a box above the list; nothing when there are none. */
async function liveNow() {
  let comps = [], liveS = 1800;
  try { ({ comps = [], liveS = 1800 } = await (await fetch(`${LIVE}/api/live/list`, { cache: "no-cache" })).json()); } catch (e) { return; }
  const cur = country.current();
  const now = comps.filter((c) => (c[5] || "?") === cur && c[6] != null && c[6] <= liveS).sort((a, b) => a[6] - b[6]).slice(0, MAX_PROBE);
  if (!now.length) return;
  const ok = await Promise.all(now.map((c) => probe(c[0])));
  const kept = now.filter((c, i) => ok[i]);
  const box = $("#ra-live");
  if (!kept.length || !box) return;
  box.innerHTML = html`<section class="card lv-now"><div class="card-head"><div><h2><span class="lv-dot" aria-hidden="true"></span>${t("ra.live.title")}</h2>
      <div class="hint">${t("ra.live.hint")}</div></div></div>
    <div class="lv-now-list">${kept.map(([id, name, org, , , , , via]) => html`<a class="lv-now-item" href="${analysisLink(LIVE_KEY + id)}"><b>${name}</b>
      <span class="muted">${org}${via ? ` · ${via}` : ""}</span></a>`)}</div></section>`;
}
