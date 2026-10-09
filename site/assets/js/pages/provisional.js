// Récemment: the results organisers publish, often before FFCO does, for the races of the last 30 days — found on
// liveresultat, WinSplits and the clubs' own websites (ffco_scraper/prov) — race by race, with the provisional scores
// and CNs of each method. For a race FFCO has since published, its own figures sit next to them as a check.
// The data (site/data/prov/) is served to every logged-in user, like the rest of site/data.

import { html, raw, $, $$, fmt, fmtDate, normalise, displayName } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { available } from "../store.js";
import { methodShort, methodKey, seg, runnerSearch, bindRunnerSearch, filterFold } from "../ui.js";
import { link, replaceQuery } from "../app.js";

const SOURCE = { upload: "déposé sur O'CN", liveresultat: "liveresultat", winsplits: "WinSplits", heyries: "Orientation Data", site: "site du club", livelox: "Livelox",
  helga: "Helga", olive: "O'Live" };
const KIND = { empty: "rapproché, vide", refused: "refusé aux robots", platform: "lien seulement", unparsed: "format non lu" };
export const STATUS = { ok: "", mp: "PM", dnf: "Abandon", dsq: "Disq.", ot: "Hors délai", dns: "Non partant", nc: "NC" };

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
  if (query.deposer) { location.replace(`#/deposer?course=${encodeURIComponent(query.deposer)}`); return { title: t("prov.title") }; }
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
    <div class="page-head"><div><h1>${t("prov.title")}</h1><p class="lede">${t("prov.lede")}</p></div>
      <a class="btn btn-sm" href="#/deposer">${t("up.open")}</a></div>
    <div class="tiles tiles-compact" id="pv-tiles" style="margin-bottom:14px"></div>
    ${filterFold(html`<div class="filters"><div class="field"><span>${t("prov.show")}</span><div id="pv-f"></div></div>
      <div class="field"><span>${t("f.terrain")}</span><div id="pv-t"></div></div>
      <label class="field"><span>${t("prov.region")}</span><select id="pv-reg"><option value="">${t("f.all")}</option>
        ${regions.map((x) => html`<option value="${x}" ${raw(x === reg ? "selected" : "")}>${x}</option>`)}</select></label>
      <div class="field"><span>${t("prov.runner")}</span><div class="row" style="gap:8px" id="pv-who"></div></div>
      <label class="field"><span>${t("prov.search")}</span><input type="search" id="pv-q" value="${q}" style="width:200px"></label></div>`)}
    <section class="card"><div class="table-wrap" id="pv-table"></div></section>
    <p style="margin:12px 2px 0">${t("up.invite")} <a class="btn btn-sm" href="#/deposer">${t("up.open")}</a></p>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("prov.def")} ${t("prov.generated")} ${when(idx.generated)}.</p>
    ${idx.runs?.length ? html`<details class="muted" style="font-size:12.5px;margin:8px 2px 0"><summary>${t("prov.runs")} : ${runLine(idx.runs[idx.runs.length - 1])}
        ${idx.due ? html` · ${t("prov.dueNow")} ${fmt(idx.due)}` : ""}</summary>
      <div class="table-wrap" style="margin-top:6px;max-width:640px"><table class="data compact"><thead><tr><th>${t("prov.run.at")}</th><th class="r">${t("prov.run.looked")}</th>
        <th class="r">${t("prov.run.changed")}</th><th class="r">${t("prov.run.requests")}</th><th class="r">${t("prov.run.seconds")}</th><th></th></tr></thead>
      <tbody>${[...idx.runs].reverse().map((x) => html`<tr><td class="num">${when(x.at)}</td><td class="r num">${fmt(x.looked)} / ${fmt(x.due)}</td>
        <td class="r num">${fmt(x.changed)}</td><td class="r num">${fmt(x.requests)}</td><td class="r num">${fmt(x.seconds)} / ${fmt(x.budget)}</td>
        <td>${x.cut ? html`<span class="tag">${t("prov.run.cut")}</span>` : ""}${x.failed ? html` <span class="tag">${fmt(x.failed)} ${t("prov.run.failed")}</span>` : ""}</td></tr>`)}</tbody></table></div></details>` : ""}`;
  const R = idx.races;
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
  function draw() {
    const one = who === "runner" && runner;
    replaceQuery({ f: filter === "all" ? null : filter, t: spec === "all" ? null : spec, reg: reg || null,
      who: who === "all" ? "all" : null, r: one && runner !== me ? runner : null, q: q || null });
    $("#pv-f").innerHTML = seg("pvf", [["all", t("prov.f.all")], ["found", t("prov.f.found")], ["missing", t("prov.f.missing")], ["pending", t("prov.f.pending")]], filter);
    $$('[data-seg="pvf"]').forEach((b) => b.addEventListener("click", () => { filter = b.dataset.value; draw(); }));
    $("#pv-t").innerHTML = seg("pvt", [["all", t("f.all")], ...SPECS.map((s) => [s, t(`terrain.${s}`)])], spec);
    $$('[data-seg="pvt"]').forEach((b) => b.addEventListener("click", () => { spec = b.dataset.value; draw(); }));
    const qn = normalise(q);
    const kept = R.filter((r) => (spec === "all" || specOf(r) === spec) && (!reg || r.region === reg)
      && (!one || (r.lics || []).includes(runner))
      && (!qn || normalise(`${r.name} ${r.place || ""} ${r.org || ""}`).includes(qn)));
    drawTiles(kept);
    const rows = kept.filter((r) => filter === "all" || (filter === "found" ? r.docs : filter === "missing" ? !r.docs : !r.ffco_id));
    $("#pv-table").innerHTML = rows.length ? html`<table class="data compact"><thead><tr>
      <th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("prov.kind")}</th><th>${t("prov.sources")}</th>
      <th class="r">${t("prov.runners")}</th><th class="r">${t("prov.matchedShort")}</th><th class="c pv-wrap">${t("prov.splits")}</th>
      <th>FFCO</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr${raw(r.docs ? "" : ' class="pv-none"')}>
        <td class="num">${fmtDate(r.date_iso, "short")}</td>
        <td class="pv-race">${r.docs ? html`<a href="#/recemment?course=${encodeURIComponent(r.key)}${one ? `&r=${encodeURIComponent(runner)}` : ""}">${r.name}</a>` : html`<span>${r.name}</span>`}
          <div class="muted" style="font-size:12px">${[r.place, r.org, r.region].filter(Boolean).join(" · ")}</div></td>
        <td class="pv-wrap">${parts(r.epreuve, r.terrain)}${r.cn ? "" : html` <span class="tag">${t("prov.notCn")}</span>`}</td>
        <td class="pv-wrap">${r.sources.length ? r.sources.map((s) => html`<span class="tag">${SOURCE[s] || s}</span> `) : html`<span>${r.refused ? t("prov.refusedOnly") : t("prov.noResult")}</span>`}
          ${r.site === false ? html`<div class="muted" style="font-size:11.5px" title="${t("prov.noSite.hint")}">${t("prov.noSite")}</div>` : ""}</td>
        <td class="r num">${r.runners ? fmt(r.runners) : "—"}</td>
        <td class="r num">${r.runners ? `${fmt((100 * r.matched) / r.runners)} %` : "—"}</td>
        <td class="c">${r.splits ? html`<a href="#/temps-inter?course=${encodeURIComponent(r.key)}" title="${t("spl.title")}">${t("prov.seeSplits")}</a>` : ""}</td>
        <td>${r.ffco_id ? html`<a href="https://cn.ffcorientation.fr/course/${r.ffco_id}/" target="_blank" rel="noopener">${t("prov.published")}</a>` : html`<span class="muted">${t("prov.waiting")}</span>`}</td></tr>`)}</tbody></table>`
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
  // the document shown first: one with circuits (scored), the most runners
  const rank = (d) => (d.by !== "category" ? 1e6 : 0) + d.classes.reduce((n, k) => n + k.runners.length, 0);
  let di = Math.max(0, Number.isInteger(Number(query.doc)) && docs[Number(query.doc)] ? Number(query.doc)
    : docs.indexOf([...docs].sort((a, b) => rank(b) - rank(a))[0]));
  let ci = Number(query.c) || 0;
  const who = query.r || null;
  if (who && query.doc == null && query.c == null) {
    const found = docs.flatMap((d, i) => d.classes.map((k, j) => [i, j, k])).filter(([, , k]) => k.runners.some((r) => r.lic === who));
    const best = found.find(([i]) => docs[i].by !== "category") || found[0];
    if (best) [di, ci] = best;
  }
  const M = ["official", ...available().filter((m) => m !== "official")];
  // the splits page lists only the documents with split times: its own indexes
  const withSplits = race.docs.filter((d) => d.classes?.some((k) => k.runners.some((r) => r.splits)));
  const splitsLink = (d, c) => {
    const i = withSplits.indexOf(d);
    return `#/temps-inter?course=${encodeURIComponent(race.key)}${i > 0 ? `&doc=${i}` : ""}${i >= 0 && c ? `&c=${c}` : ""}`;
  };

  main.innerHTML = html`
    <div class="crumbs"><a href="#/recemment">${t("prov.title")}</a><span>›</span><span>${race.name}</span></div>
    <div class="page-head"><div><h1>${race.name}</h1>
      <p class="lede">${fmtDate(race.date_iso)} · ${parts(race.place, race.org, race.epreuve, race.terrain)}</p></div>
      <div class="row" style="gap:8px"><a class="btn btn-sm" href="#/deposer?course=${encodeURIComponent(race.key)}">${t("up.open")}</a>
        ${withSplits.length ? html`<a class="btn btn-sm" href="${splitsLink(null)}">${t("spl.title")} →</a>` : ""}
        ${race.site ? html`<a class="btn btn-sm" href="${race.site}" target="_blank" rel="noopener">${t("prov.site")} ↗</a>` : ""}
        ${race.ffco_id ? html`<a class="btn btn-sm" href="https://cn.ffcorientation.fr/course/${race.ffco_id}/" target="_blank" rel="noopener">FFCO ↗</a>` : ""}</div></div>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${t("prov.documents")}</h2></div>
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
      ${race.docs.length ? "" : html`<div class="empty">${t("prov.noDoc")}</div>`}</section>
    ${docs.length ? html`<div class="filters" id="pv-pick"></div><section class="card"><div class="card-head"><div><h2 id="pv-class-title"></h2>
      <div class="hint" id="pv-class-hint"></div></div></div><div class="table-wrap" id="pv-class"></div></section>
      <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("prov.scoreDef")}</p>` : ""}`;
  if (!docs.length) return { title: race.name };

  function draw() {
    const d = docs[di];
    ci = Math.min(ci, d.classes.length - 1);
    const k = d.classes[ci];
    replaceQuery({ course: race.key, doc: di || null, c: ci || null, r: who });
    $("#pv-pick").innerHTML = html`
      <label class="field"><span>${t("prov.doc")}</span><select id="pv-doc" style="max-width:420px">${docs.map((x, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${SOURCE[x.source] || x.source} · ${x.kind} · ${x.title || decodeURIComponent(x.url.split("/").pop())}</option>`)}</select></label>
      <label class="field"><span>${d.by === "category" ? t("prov.category") : t("prov.circuit")}</span><select id="pv-c">${d.classes.map((x, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")}>${x.name} (${x.runners.length})</option>`)}</select></label>
      ${k.runners.some((r) => r.splits) ? html`<a class="btn btn-sm" style="align-self:flex-end" href="${splitsLink(d, ci)}">${t("spl.ofClass")} →</a>` : ""}`;
    $("#pv-doc").addEventListener("change", (e) => { di = Number(e.target.value); ci = 0; draw(); });
    $("#pv-c").addEventListener("change", (e) => { ci = Number(e.target.value); draw(); });
    const v = k.values || {};
    $("#pv-class-title").textContent = `${k.name} · ${k.runners.length} ${t("prov.runners").toLowerCase()}`;
    $("#pv-class-hint").innerHTML = html`${[k.length_m ? `${fmt(k.length_m / 1000, 1)} km` : "", k.climb_m ? `${fmt(k.climb_m)} m D+` : "", k.controls ? `${k.controls.length} ${t("prov.controls")}` : ""].filter(Boolean).join(" · ")}
      ${d.by === "category" ? html`<span>${t("prov.byCategory")}</span>` : html`${t("prov.values")} ${M.filter((m) => m === "official" || v[m.replace("top6w2", "fair2").replace("top6w", "fair")] != null)
        .map((m) => `${methodShort(m)} ${fmt(m === "official" ? v.official : v[m === "top6w" ? "fair" : m === "top6w2" ? "fair2" : m])}`).join(" · ") || "—"}`}`;
    const scored = d.by !== "category";
    const published = k.runners.some((r) => r.ffco);
    // one cell per method: the provisional CN J-15 → race score → CN after; below, once the race is published, the
    // same method's published race score → CN after (FFCO's for the official method, the site's for the others)
    const gap = (a, b) => (a == null || b == null || a === b ? "" : html` <span style="color:var(--bad)">(${a > b ? "+" : "−"}${fmt(Math.abs(a - b))})</span>`);
    const cell = (r, m) => {
      const p = r.ffco?.[m];
      return html`<td class="r num" style="white-space:nowrap">${r.scores?.[m] != null
        ? html`<span class="muted" style="font-size:11.5px">${fmt(r.cnj15?.[m])} → </span><b>${fmt(r.scores[m])}</b><span class="muted" style="font-size:11.5px"> → ${fmt(r.cnAfter?.[m])}</span>` : "—"}
        ${p ? html`<div class="muted" style="font-size:11.5px">${t("prov.pub")} ${fmt(p.score)}${gap(r.scores?.[m], p.score)} → ${fmt(p.cn)}</div>` : ""}</td>`;
    };
    $("#pv-class").innerHTML = html`<table class="data compact"><thead><tr>
      <th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th><th>${t("prov.club")}</th><th>${t("prov.cat")}</th><th class="r">${t("prov.time")}</th>
      ${scored ? M.map((m) => html`<th class="r" title="${t("prov.colHint")}">${methodKey(m)}${methodShort(m)}<div class="muted" style="font-weight:400;font-size:11px">${t("prov.cols")}</div>
        ${published ? html`<div class="muted" style="font-weight:400;font-size:11px">${t("prov.pubCols")}</div>` : ""}</th>`) : ""}</tr></thead>
      <tbody>${k.runners.map((r) => html`<tr${raw(who && r.lic === who ? ' style="background:color-mix(in srgb, var(--accent) 14%, transparent)"' : "")}>
        <td class="r num">${r.place ?? ""}</td>
        <td>${r.lic ? html`<a href="${link.runner(r.lic)}">${r.name}</a>` : html`<span title="${t("prov.unmatched")}">${r.name}</span> <span class="muted" style="font-size:11px">?</span>`}</td>
        <td style="font-size:12.5px">${r.club || ""}</td>
        <td>${r.category || (r.catCn ? html`<span class="muted" title="${t("prov.catCn")}">${r.catCn}</span>` : "")}</td>
        <td class="r num">${r.status === "ok" ? clock(r.time_s) : STATUS[r.status]}</td>
        ${scored ? M.map((m) => cell(r, m)) : ""}</tr>`)}</tbody></table>`;
  }
  draw();
  return { title: race.name };
}
