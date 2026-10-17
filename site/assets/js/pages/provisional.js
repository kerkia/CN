// Récemment: the results organisers publish, often before FFCO does, for the races of the last 30 days — found on
// liveresultat, WinSplits and the clubs' own websites (ffco_scraper/prov) — race by race, with the provisional scores
// and CNs of each method. For a race FFCO has since published, its own figures sit next to them as a check.
// The data (site/data/prov/) is served to every logged-in user, like the rest of site/data.

import { html, raw, $, $$, fmt, fmtDate, normalise, displayName } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { available, get as storeGet } from "../store.js";
import { methodShort, seg, runnerSearch, bindRunnerSearch, filterFold, dataTable, scoreCell, subHead, cnLabel, scoreLabel } from "../ui.js";
import { link, replaceQuery } from "../app.js";

const SOURCE = { ffco: "FFCO", upload: "déposé sur O'CN", liveresultat: "liveresultat", winsplits: "WinSplits", heyries: "Orientation Data", site: "site du club", livelox: "Livelox",
  helga: "Helga", olive: "O'Live" };
const KIND = { empty: "rapproché, vide", refused: "refusé aux robots", platform: "lien seulement", unparsed: "format non lu",
  startlist: "liste de départ", startfile: "liste de départ (lien)", registration: "circuits et catégories", announcement: "annonce : circuits et catégories",
  coursedata: "circuits du traceur (IOF XML)" };
export const STATUS = { ok: "", mp: "PM", dnf: "Abandon", dsq: "Disq.", ot: "Hors délai", dns: "Non partant", nc: "NC", start: "" };
/** A results source as readers see it: who published it, and what it gives (« avec temps intermédiaires »). */
const sourceName = (d) => {
  const who = { site: "Site de l'organisateur", upload: "Fichier déposé sur O'CN", liveresultat: "liveresultat (en direct)", winsplits: "WinSplits",
    heyries: "Orientation Data", helga: "Helga" }[d.source] || SOURCE[d.source] || d.source;
  const what = d.kind === "startlist" ? "liste de départ" : d.classes?.some((k) => k.runners.some((r) => r.splits)) ? "avec temps intermédiaires"
    : d.by === "category" ? "par catégorie" : "par circuit";
  return `${who} · ${what}`;
};
/** A runner's club: the file's, else — a file without clubs — that of the runner recognised, from the CN data. */
const clubOf = (r) => {
  if (r.club_code) return { code: r.club_code, name: r.club || data.clubName(r.club_code) };
  const own = r.lic ? data.runner(r.lic)?.club : null, code = own ? data.clubParts(own).code : null;
  return code ? { code, name: data.clubName(own) } : { code: null, name: r.club || "" };
};
const TERRAIN_CODE = { "Forêt": "For", Sprint: "Spr", VTT: "VTT", Ski: "Ski" };
/** A start time (seconds after midnight) as 10:42 or 10:42:30. */
const startClock = (s) => (s == null ? "" : `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}${
  Math.round(s % 60) ? `:${String(Math.round(s % 60)).padStart(2, "0")}` : ""}`);

export const getProv = async (path) => {
  const r = await fetch(`data/prov/${path}`, { credentials: "same-origin", cache: "no-store" });
  return r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null;
};
export const clock = (s) => {
  if (s == null) return "—";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
// "Sprint · Sprint" (the format and the terrain) said once
const parts = (...xs) => [...new Set(xs.filter(Boolean))].join(" · ");
// the specialité: the CN terrain, or for a race outside the CN its format
const SPECS = ["For", "Spr", "VTT", "Ski"];
const specOf = (r) => ({ "Forêt": "For", Sprint: "Spr", VTT: "VTT", Ski: "Ski" })[r.terrain]
  || (r.epreuve === "Sprint" ? "Spr" : ["MD", "LD", "Nuit"].includes(r.epreuve) ? "For" : null);
const runLine = (x) => `${when(x.at)}, ${x.looked} ${t("prov.run.of")} ${x.due}${x.cut ? ` (${t("prov.run.cut")})` : ""}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export async function render(main, { query = {} } = {}) {
  const idx = await getProv("index.json");
  if (!idx) {
    main.innerHTML = html`<div class="page-head"><div><h1>${t("prov.title")}</h1></div></div><div class="card"><div class="empty">${t("prov.none")}</div></div>`;
    return { title: t("prov.title") };
  }
  // an old « ?deposer=<race> » link: « Déposer » is its own page now
  if (query.deposer) { location.replace(`#/orga-resultats?course=${encodeURIComponent(query.deposer)}`); return { title: t("prov.title") }; }
  return query.course ? detail(main, idx, query) : list(main, idx, query);
}

// ---- the races -------------------------------------------------------------------------------------------------
function list(main, idx, query) {
  let filter = ["all", "found", "missing", "pending"].includes(query.f) ? query.f : "all", q = query.q || "";
  let spec = SPECS.includes(query.t) ? query.t : "all", reg = query.reg || "";
  // races a runner took part in (a runner recognised in the results): the logged-in one unless another is chosen
  const me = auth.session()?.lic;
  let runner = query.r || me, who = query.who === "all" || !runner ? "all" : "runner";     // the logged-in runner's races by default
  const regions = [...new Set(idx.races.map((r) => r.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("prov.title")}</h1><p class="lede">${t("prov.lede")}</p></div></div>
    <div class="tiles tiles-compact" id="pv-tiles" style="margin-bottom:14px"></div>
    ${filterFold(html`<div class="filters"><div class="field"><span>${t("prov.show")}</span><div id="pv-f"></div></div>
      <div class="field"><span>${t("f.terrain")}</span><div id="pv-t"></div></div>
      <label class="field"><span>${t("prov.region")}</span><select id="pv-reg"><option value="">${t("f.all")}</option>
        ${regions.map((x) => html`<option value="${x}" ${raw(x === reg ? "selected" : "")}>${x}</option>`)}</select></label>
      <div class="field"><span>${t("prov.runner")}</span><div class="row" style="gap:8px" id="pv-who"></div></div>
      <label class="field"><span>${t("prov.search")}</span><input type="search" id="pv-q" value="${q}" style="width:200px"></label></div>`)}
    <section class="card"><div class="table-wrap" id="pv-table"></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("prov.def")} ${t("prov.generated")} ${when(idx.generated)}.</p>
    ${idx.runs?.length ? html`<details class="muted" style="font-size:12.5px;margin:8px 2px 0"><summary>${t("prov.runs")} : ${runLine(idx.runs[idx.runs.length - 1])}
        ${idx.due ? html` · ${t("prov.dueNow")} ${fmt(idx.due)}` : ""}</summary>
      <div class="table-wrap" style="margin-top:6px;max-width:640px"><table class="data compact"><thead><tr><th>${t("prov.run.at")}</th><th class="r">${t("prov.run.looked")}</th>
        <th class="r">${t("prov.run.changed")}</th><th class="r">${t("prov.run.requests")}</th><th class="r">${t("prov.run.seconds")}</th><th></th></tr></thead>
      <tbody>${[...idx.runs].reverse().map((x) => html`<tr><td class="num">${when(x.at)}</td><td class="r num">${fmt(x.looked)} / ${fmt(x.due)}</td>
        <td class="r num">${fmt(x.changed)}</td><td class="r num">${fmt(x.requests)}</td><td class="r num">${fmt(x.seconds)} / ${fmt(x.budget)}</td>
        <td>${x.cut ? html`<span class="tag">${t("prov.run.cut")}</span>` : ""}${x.failed ? html` <span class="tag">${fmt(x.failed)} ${t("prov.run.failed")}</span>` : ""}</td></tr>`)}</tbody></table></div></details>` : ""}`;
  // the races run so far (today's too): a coming race's start list is reached from « Bientôt »
  const R = idx.races.filter((r) => !r.soon);
  // a runner's races published by FFCO (their results are « Courses classées »'s): one's own races are those where one is
  // recognised in an organiser's list or in FFCO's (owner, 2026-10-17: the race of the day FFCO had published, with no
  // organiser's list read yet, was missing from one's own races)
  const ffcoOf = new Map();
  const ffcoSet = (lic) => {
    if (ffcoOf.has(lic)) return ffcoOf.get(lic);
    ffcoOf.set(lic, null);
    data.runnerRaces(lic).then((rows) => { ffcoOf.set(lic, new Set(rows.map((x) => String(x[data.R.course])))); },
      () => { ffcoOf.set(lic, new Set()); }).then(() => { if (document.contains(table)) draw(); });
    return null;
  };
  const has = (r) => r.docs || r.ffco_id;              // results, an organiser's or FFCO's
  // the tiles: the races the filters keep — the runner, the specialité, the region, the search; not « Afficher »,
  // which would make « avec résultats » 100 %
  const drawTiles = (T) => {
    const found = T.filter((r) => r.docs).length, n = T.reduce((s, r) => s + r.runners, 0), m = T.reduce((s, r) => s + r.matched, 0);
    $("#pv-tiles").innerHTML = html`
      <div class="tile"><div class="tile-label">${t("prov.races")}</div><div class="tile-value">${fmt(T.length)}</div></div>
      <div class="tile"><div class="tile-label">${t("prov.withResults")}</div><div class="tile-value">${fmt(found)}</div>
        <div class="tile-sub">${T.length ? fmt((100 * found) / T.length) : 0} %</div></div>
      <div class="tile"><div class="tile-label">${t("prov.withSplits")}</div><div class="tile-value">${fmt(T.filter((r) => r.splits).length)}</div></div>
      <div class="tile"><div class="tile-label">${t("prov.matched")}</div><div class="tile-value">${n ? `${fmt((100 * m) / n)} %` : "—"}</div>
        <div class="tile-sub">${t("prov.matched.hint")}</div></div>`;
  };
  function drawWho() {
    $("#pv-who").innerHTML = html`${seg("pvwho", [["all", t("f.allm")], ["runner", t("prov.oneRunner")]], who)}
      ${who === "runner" ? html`<span class="pill">${runner ? html`<a href="${link.runner(runner)}">${displayName(data.runner(runner)?.nom || runner)}</a>` : "—"}</span>
        ${runnerSearch("pv-runner", t("rn.change"))}` : ""}`;
    $$('[data-seg="pvwho"]').forEach((b) => b.addEventListener("click", () => { who = b.dataset.value; drawWho(); draw(); }));
    if (who === "runner") bindRunnerSearch($("#pv-runner"), { onPick: (l) => { runner = l; drawWho(); draw(); } });
  }
  const table = $("#pv-table");
  function draw() {
    const one = who === "runner" && runner;
    const ffcoMine = one ? ffcoSet(runner) : null;
    replaceQuery({ f: filter === "all" ? null : filter, t: spec === "all" ? null : spec, reg: reg || null,
      who: who === "all" ? "all" : null, r: one && runner !== me ? runner : null, q: q || null });
    $("#pv-f").innerHTML = seg("pvf", [["all", t("prov.f.all")], ["found", t("prov.f.found")], ["missing", t("prov.f.missing")], ["pending", t("prov.f.pending")]], filter);
    $$('[data-seg="pvf"]').forEach((b) => b.addEventListener("click", () => { filter = b.dataset.value; draw(); }));
    $("#pv-t").innerHTML = seg("pvt", [["all", t("f.all")], ...SPECS.map((s) => [s, t(`terrain.${s}`)])], spec);
    $$('[data-seg="pvt"]').forEach((b) => b.addEventListener("click", () => { spec = b.dataset.value; draw(); }));
    const qn = normalise(q);
    const kept = R.filter((r) => (spec === "all" || specOf(r) === spec) && (!reg || r.region === reg)
      && (!one || (r.lics || []).includes(runner) || (ffcoMine && r.ffco_id && ffcoMine.has(String(r.ffco_id))))
      && (!qn || normalise(`${r.name} ${r.place || ""} ${r.org || ""}`).includes(qn)));
    drawTiles(kept.filter((r) => !r.soon));         // a coming race's start list is not a result
    const rows = kept.filter((r) => filter === "all" || (filter === "found" ? has(r) : filter === "missing" ? !has(r) : !r.ffco_id));
    $("#pv-table").innerHTML = rows.length ? html`<table class="data compact"><thead><tr>
      <th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("prov.kind")}</th><th>${t("prov.sources")}</th>
      <th class="r">${t("prov.runners")}</th><th class="r">${t("prov.matchedShort")}</th><th class="c pv-wrap">${t("prov.splits")}</th>
      <th>FFCO</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr${raw(has(r) ? "" : ' class="pv-none"')}>
        <td class="num">${fmtDate(r.date_iso, "short")}</td>
        <td class="pv-race">${r.docs || r.startlist ? html`<a href="#/resultats?course=${encodeURIComponent(r.key)}${one ? `&r=${encodeURIComponent(runner)}` : ""}">${r.name}</a>`
          : r.ffco_id ? html`<a href="#/courses?id=${encodeURIComponent(r.ffco_id)}" title="${t("prov.ffcoResults")}">${r.name}</a>` : html`<span>${r.name}</span>`}
          ${r.soon ? html` <span class="tag" style="color:var(--accent)">${t("prov.soon")}</span>` : ""}
          <div class="muted" style="font-size:12px">${[r.place, r.org, r.region].filter(Boolean).join(" · ")}</div></td>
        <td class="pv-wrap">${parts(r.epreuve, r.terrain)}${r.cn ? "" : html` <span class="tag">${t("prov.notCn")}</span>`}</td>
        <td class="pv-wrap">${r.sources.length ? r.sources.map((s) => html`<span class="tag">${SOURCE[s] || s}</span> `)
          : r.ffco_id ? html`<span class="tag" title="${t("prov.ffcoResults")}">FFCO</span>` : html`<span>${r.refused ? t("prov.refusedOnly") : t("prov.noResult")}</span>`}
          ${r.site === false ? html`<div class="muted" style="font-size:11.5px" title="${t("prov.noSite.hint")}">${t("prov.noSite")}</div>` : ""}</td>
        <td class="r num">${r.runners ? fmt(r.runners) : "—"}</td>
        <td class="r num">${r.runners ? `${fmt((100 * r.matched) / r.runners)} %` : "—"}</td>
        <td class="c">${r.splits ? html`<a href="#/temps-inter?course=${encodeURIComponent(r.key)}" title="${t("spl.title")}">${t("prov.seeSplits")}</a>` : ""}</td>
        <td>${r.ffco_id ? html`<a href="https://cn.ffcorientation.fr/course/${r.ffco_id}/" target="_blank" rel="noopener">${t("prov.published")}</a>`
          : r.soon ? "" : html`<span class="muted">${t("prov.waiting")}</span>`}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t(one ? "prov.emptyRunner" : "prov.empty")}</div>`;
  }
  $("#pv-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  $("#pv-reg").addEventListener("change", (e) => { reg = e.target.value; draw(); });
  drawWho();
  draw();
  return { title: t("prov.title") };
}

// ---- one race -------------------------------------------------------------------------------------------------
async function detail(main, idx, query) {
  const race = await getProv(`${encodeURIComponent(query.course)}.json`);
  if (!race) {
    main.innerHTML = html`<div class="notice">${t("prov.notFound")}</div>`;
    return { title: t("prov.title") };
  }
  const docs = race.docs.filter((d) => d.classes?.length);
  // the document shown first: the build's order (the organiser's files before the platforms, liveresultat last)
  const rank = (d) => d.prio ?? (d.by !== "category" ? 1e6 : 0) + d.classes.reduce((n, k) => n + k.runners.length, 0);
  let di = Math.max(0, Number.isInteger(Number(query.doc)) && docs[Number(query.doc)] ? Number(query.doc)
    : docs.indexOf([...docs].sort((a, b) => rank(b) - rank(a))[0]));
  let ci = Number(query.c) || 0;
  // both views of a list of results: by circuit (how it is scored) and by category — a list by category gets its
  // circuits (d.circuits) once known, a list by circuit giving runners' categories its categories (d.catview)
  let byCat = query.vue === "categorie";
  const views = (d) => (d.circuits?.length ? { circ: d.circuits, cat: d.classes } : d.catview?.length ? { circ: d.classes, cat: d.catview } : null);
  const groupsOf = (d) => (views(d) ? views(d)[byCat ? "cat" : "circ"] : d.classes);
  const who = query.r || null;
  // a runner named (r=…): their group, in the document asked for if any (a class number from another view means nothing)
  if (who && !groupsOf(docs[di])[ci]?.runners.some((r) => r.lic === who)) {
    const found = docs.flatMap((d, i) => groupsOf(d).map((k, j) => [i, j, k])).filter(([i, , k]) => k.runners.some((r) => r.lic === who)
      && (query.doc == null || i === di));
    const best = found.find(([i]) => docs[i].by !== "category" || docs[i].circuits?.length) || found[0];
    if (best) [di, ci] = best;
  }
  const M = [storeGet().method];
  // the splits page lists only the documents with split times: its own indexes
  const withSplits = race.docs.filter((d) => d.classes?.some((k) => k.runners.some((r) => r.splits)));
  const splitsLink = (d, c) => {
    const i = withSplits.indexOf(d);
    return `#/temps-inter?course=${encodeURIComponent(race.key)}${i > 0 ? `&doc=${i}` : ""}${i >= 0 && c ? `&c=${c}` : ""}`;
  };

  main.innerHTML = html`
    <div class="crumbs">${race.date_iso > new Date().toISOString().slice(0, 10)
      ? html`<a href="#/agenda${race.agenda_id ? `?id=${race.agenda_id}` : ""}">${t("nav.agenda")}</a>` : html`<a href="#/resultats">${t("prov.title")}</a>`}<span>›</span><span>${race.name}</span></div>
    <div class="page-head"><div><h1>${race.name}</h1>
      <p class="lede">${fmtDate(race.date_iso)} · ${parts(race.place, race.org, race.epreuve, race.terrain)}</p></div>
      <div class="row" style="gap:8px">${withSplits.length ? html`<a class="btn btn-sm" href="${splitsLink(null)}">${t("spl.title")} →</a>` : ""}
        ${race.site ? html`<a class="btn btn-sm" href="${race.site}" target="_blank" rel="noopener">${t("prov.site")} ↗</a>` : ""}
        ${race.ffco_id ? html`<a class="btn btn-sm" href="https://cn.ffcorientation.fr/course/${race.ffco_id}/" target="_blank" rel="noopener">FFCO ↗</a>` : ""}</div></div>
    ${docs.length ? html`<div class="filters" id="pv-pick"></div><section class="card"><div class="card-head"><div><h2 id="pv-class-title"></h2>
      <div class="hint" id="pv-class-hint"></div></div></div><div id="pv-class"></div></section>
      <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("prov.scoreDef")}</p>` : html`<div class="card"><div class="empty">${t("prov.noDoc")}</div></div>`}
    ${auth.session()?.admin ? html`<details class="card" style="margin-top:16px"><summary class="card-head" style="cursor:pointer"><h2>${t("prov.sources.admin")}</h2></summary>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("prov.source")}</th><th>${t("prov.doc")}</th><th>${t("prov.format")}</th>
        <th class="r">${t("prov.classes")}</th><th>${t("prov.found")}</th><th>${t("prov.changed")}</th></tr></thead>
      <tbody>${race.docs.map((d) => html`<tr${raw(d.classes?.length ? "" : ' style="opacity:.65"')}>
        <td><span class="tag">${SOURCE[d.source] || d.source}</span></td>
        <td style="max-width:420px;overflow-wrap:anywhere">${d.source === "upload" ? html`<span>${d.title || d.url.split("/").pop()}</span>`
          : html`<a href="${d.url}" target="_blank" rel="noopener">${d.title || d.note || decodeURIComponent(d.url.split("/").pop() || d.url)}</a>`}
          ${d.note && d.title ? html`<div class="muted" style="font-size:12px">${d.note}</div>` : ""}</td>
        <td>${KIND[d.kind] || d.kind}${d.by ? html` <span class="muted">· ${t(`prov.by.${d.by}`)}</span>` : ""}</td>
        <td class="r num">${d.classes ? fmt(d.classes.length) : "—"}</td>
        <td class="num" style="font-size:12px">${when(d.found)}</td><td class="num" style="font-size:12px">${when(d.changed)}</td></tr>`)}</tbody></table></div>
      ${race.docs.length ? "" : html`<div class="empty">${t("prov.noDoc")}</div>`}</details>` : ""}`;
  if (!docs.length) return { title: race.name };

  function draw() {
    const d = docs[di];
    const groups = groupsOf(d), asCircuits = !!views(d) && !byCat;
    ci = Math.min(ci, groups.length - 1);
    const k = groups[ci];
    replaceQuery({ course: race.key, doc: di || null, c: ci || null, r: who, vue: views(d) && byCat ? "categorie" : null });
    $("#pv-pick").innerHTML = html`
      ${docs.length > 1 ? html`<label class="field"><span>${t("prov.source")}</span><select id="pv-doc" style="max-width:420px">${docs.map((x, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${sourceName(x)}</option>`)}</select></label>` : ""}
      ${views(d) ? html`<div class="field"><span>${t("prov.view")}</span>${seg("pvv", [["circ", t("prov.view.circ")], ["cat", t("prov.view.cat")]], byCat ? "cat" : "circ")}</div>` : ""}
      <label class="field"><span>${(views(d) ? byCat : d.by === "category") ? t("prov.category") : t("prov.circuit")}</span><select id="pv-c">${groups.map((x, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")}>${x.name}${asCircuits && x.categories?.length ? ` · ${x.categories.join(", ")}` : ""} (${x.runners.length})</option>`)}</select></label>
      ${k.runners.some((r) => r.splits) ? html`<a class="btn btn-sm" style="align-self:flex-end" href="${splitsLink(d, ci)}">${t("spl.ofClass")} →</a>` : ""}`;
    $("#pv-doc")?.addEventListener("change", (e) => {
      di = Number(e.target.value);
      ci = who ? Math.max(0, groupsOf(docs[di]).findIndex((g) => g.runners.some((r) => r.lic === who))) : 0;   // the runner's group
      draw();
    });
    $("#pv-c").addEventListener("change", (e) => { ci = Number(e.target.value); draw(); });
    $$('[data-seg="pvv"]').forEach((x) => x.addEventListener("click", () => {
      // the same runner's group in the other view: the circuit of the category shown, or the first category of the circuit
      const next = x.dataset.value === "cat";
      if (next === byCat) return;
      // (the runner named, if any, else the first category of the circuit, or the circuit of the category)
      const mine = who && k.runners.find((r) => r.lic === who);
      const name = next ? (mine?.category || mine?.catCn || k.categories?.[0] || k.runners.find((r) => r.category)?.category) : k.circuit;
      byCat = next;
      ci = Math.max(0, groupsOf(d).findIndex((g) => g.name === name || (who && g.runners.some((r) => r.lic === who))));
      draw();
    }));
    const v = k.values || {};
    $("#pv-class-title").textContent = `${k.name} · ${k.runners.length} ${t("prov.runners").toLowerCase()}`;
    $("#pv-class-hint").innerHTML = html`${[k.length_m ? `${fmt(k.length_m / 1000, 1)} km` : "", k.climb_m ? `${fmt(k.climb_m)} m D+` : "", k.controls ? `${k.controls.length} ${t("prov.controls")}` : ""].filter(Boolean).join(" · ")}
      ${d.by === "category" && !k.values ? html`<span>${t("prov.byCategory")}</span>` : html`${asCircuits && k.categories?.length ? html`${t("prov.circuitCats", { c: k.categories.join(", ") })} · ` : k.circuit ? html`${t("prov.circuitOf", { c: k.circuit })} · ` : ""}${t("prov.values")} ${M.filter((m) => m === "official" || v[m.replace("top6w3", "fair3").replace("top6w", "fair")] != null)
        .map((m) => fmt(m === "official" ? v.official : v[m === "top6w" ? "fair" : m === "top6w3" ? "fair3" : m])).join(" · ") || "—"}`}`;
    if (d.kind === "startlist") { startTable(k); return; }
    const scored = d.by !== "category" || !!k.values;
    // the same table as a race's on « Courses »: per method the CN J-15, then the score with its gap to that CN; the
    // CN after the race in the score's tooltip; once the race is published, the published score below
    const ok = (r) => r.status === "ok";
    const gap = (r, m) => (ok(r) && r.scores?.[m] && r.cnj15?.[m] ? r.scores[m] - r.cnj15[m] : null);
    const pubLine = (r, m) => {
      const p = r.ffco?.[m], s = r.scores?.[m];
      return p ? html`<div class="pub">${t("prov.pub")} ${fmt(p.score)}${s != null && s !== p.score
        ? html` <span style="color:var(--bad)">(${s > p.score ? "+" : "−"}${fmt(Math.abs(s - p.score))})</span>` : ""}</div>` : "";
    };
    dataTable($("#pv-class"), {
      compact: true, rows: k.runners, sortKey: "place", sortDir: 1, rowClass: (r) => (who && r.lic === who ? "selected" : ""),
      columns: [
        { key: "place", label: t("col.place"), cls: "rank num", defaultDir: 1, sort: (r) => r.place ?? 1e6,
          render: (r) => (r.place != null ? fmt(r.place) : html`<span class="dim">${STATUS[r.status]}</span>`) },
        { key: "name", label: t("rk.col.name"), defaultDir: 1, sort: (r) => r.name,
          render: (r) => (r.lic ? html`<a class="name" href="${link.runner(r.lic)}">${r.name}</a>`
            : html`<span title="${t("prov.unmatched")}">${r.name}</span> <span class="muted" style="font-size:11px">?</span>`) },
        { key: "cat", label: t("rk.col.cat"), defaultDir: 1, sort: (r) => r.category || r.catCn,
          render: (r) => r.category || (r.catCn ? html`<span class="muted" title="${t("prov.catCn")}">${r.catCn}</span>` : "") },
        { key: "club", label: t("rk.col.club"), cls: "num", defaultDir: 1, sort: (r) => clubOf(r).code || r.club,
          render: (r) => { const c = clubOf(r);
            return c.code ? html`<a href="${link.club(c.code)}" title="${c.name}">${c.code}</a>` : html`<span style="font-size:12.5px">${r.club || ""}</span>`; } },
        { key: "time", label: t("col.time"), align: "r", cls: "num", defaultDir: 1, sort: (r) => (ok(r) ? r.time_s : null),
          render: (r) => (ok(r) ? clock(r.time_s) : "") },
        ...(scored ? M.flatMap((m) => [{
          key: `cn_${m}`, label: subHead(cnLabel(m), "J-15"), align: "r", cls: "num", sort: (r) => r.cnj15?.[m],
          render: (r) => (r.cnj15?.[m] ? fmt(r.cnj15[m]) : html`<span class="dim">—</span>`),
        }, {
          key: `s_${m}`, label: html`<span title="${t("res.score.hint")}">${subHead(scoreLabel(m), t("res.gap"))}</span>`,
          align: "r", cls: "num", sort: (r) => gap(r, m),
          render: (r) => scoreCell(ok(r) ? r.scores?.[m] ?? null : null, r.cnj15?.[m],
            { title: r.cnAfter?.[m] ? `${t("rn.cnAfter")} : ${fmt(r.cnAfter[m])}` : "", below: pubLine(r, m) }),
        }]) : []),
      ],
    });
  }
  // a start list: the runners by start time, with their CN today (Top and official, in the race's discipline) and the
  // place the Top CN gives them among the circuit's runners
  let cnNow = null;
  async function startTable(k) {
    $("#pv-class-hint").innerHTML = html`${t("prov.start.hint")}`;
    if (!cnNow) {
      const month = data.latestMonth(), tr = TERRAIN_CODE[race.terrain] || "For";
      cnNow = await data.cnAt(storeGet().method, tr, month);      // the site's method, today
    }
    const cn = (r) => (r.lic ? cnNow.get(String(r.lic)) ?? null : null);
    const rows = [...k.runners].sort((a, b) => (a.start_s ?? 1e9) - (b.start_s ?? 1e9) || a.name.localeCompare(b.name, "fr"));
    const ranked = rows.filter((r) => cn(r)).sort((a, b) => cn(b) - cn(a));
    const expected = new Map(ranked.map((r, i) => [r, i + 1]));
    $("#pv-class").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
      <th class="r">${t("prov.start")}</th><th>${t("prov.name")}</th><th>${t("prov.club")}</th><th>${t("prov.cat")}</th>
      <th class="r">CN</th>
      <th class="r" title="${t("lv.expected.hint")}">${t("lv.expected")}</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr${raw(who && r.lic === who ? ' style="background:color-mix(in srgb, var(--accent) 14%, transparent)"' : "")}>
        <td class="r num">${startClock(r.start_s)}${r.status !== "start" && r.status !== "ok" ? html` <span class="muted">${STATUS[r.status]}</span>` : ""}</td>
        <td>${r.lic ? html`<a href="${link.runner(r.lic)}">${r.name}</a>` : html`<span title="${t("prov.unmatched")}">${r.name}</span> <span class="muted" style="font-size:11px">?</span>`}</td>
        <td style="font-size:12.5px">${clubOf(r).code ? html`<a href="${link.club(clubOf(r).code)}" title="${clubOf(r).name}">${clubOf(r).code}</a>` : r.club || ""}</td>
        <td>${r.category || (r.catCn ? html`<span class="muted" title="${t("prov.catCn")}">${r.catCn}</span>` : "")}</td>
        <td class="r num">${cn(r) ? fmt(cn(r)) : html`<span class="muted">—</span>`}</td>
        <td class="r num">${expected.get(r) ?? ""}</td></tr>`)}</tbody></table></div>`;
  }
  draw();
  return { title: race.name };
}
