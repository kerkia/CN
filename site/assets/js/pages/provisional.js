// Résultats provisoires (administrators only, a pilot): the results organisers publish before FFCO does — found on
// liveresultat, WinSplits and the clubs' own websites (ffco_scraper/prov) — race by race, with the provisional scores
// and CNs of each method. For a race FFCO has since published, its own figures sit next to them as a check.
// The data (site/data/prov/) is served to administrators only (functions/_middleware.js).

import { html, raw, $, $$, fmt, fmtDate, normalise } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { available } from "../store.js";
import { methodShort, methodKey, seg } from "../ui.js";
import { link, replaceQuery } from "../app.js";

const SOURCE = { liveresultat: "liveresultat", winsplits: "WinSplits", heyries: "Orientation Data", site: "site du club", livelox: "Livelox",
  helga: "Helga", olive: "O'Live" };
const KIND = { empty: "rapproché, vide", refused: "refusé aux robots", platform: "lien seulement", unparsed: "format non lu" };
const STATUS = { ok: "", mp: "PM", dnf: "Abandon", dsq: "Disq.", ot: "Hors délai", dns: "Non partant", nc: "NC" };

export const getProv = async (path) => {
  const r = await fetch(`data/prov/${path}`, { credentials: "same-origin", cache: "no-store" });
  return r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null;
};
export const clock = (s) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
const when = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export async function render(main, { query = {} } = {}) {
  if (!auth.session()?.admin) {
    main.innerHTML = html`<div class="notice">${t("ad.forbidden")}</div>`;
    return { title: t("prov.title") };
  }
  const idx = await getProv("index.json");
  if (!idx) {
    main.innerHTML = html`<div class="page-head"><div><h1>${t("prov.title")}</h1></div></div><div class="card"><div class="empty">${t("prov.none")}</div></div>`;
    return { title: t("prov.title") };
  }
  return query.course ? detail(main, idx, query) : list(main, idx, query);
}

// ---- the races -------------------------------------------------------------------------------------------------
function list(main, idx, query) {
  let filter = ["all", "found", "missing", "pending"].includes(query.f) ? query.f : "all", q = query.q || "";
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("prov.title")}</h1><p class="lede">${t("prov.lede")}</p></div>
      <a class="btn btn-sm" href="#/temps-inter">${t("spl.title")} →</a></div>
    <div class="tiles tiles-compact" id="pv-tiles" style="margin-bottom:14px"></div>
    <div class="filters"><div class="field"><span>${t("prov.show")}</span><div id="pv-f"></div></div>
      <label class="field"><span>${t("prov.search")}</span><input type="search" id="pv-q" value="${q}" style="width:240px"></label></div>
    <section class="card"><div class="table-wrap" id="pv-table"></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("prov.def")} ${t("prov.generated")} ${when(idx.generated)}.</p>`;
  const R = idx.races;
  $("#pv-tiles").innerHTML = html`
    <div class="tile"><div class="tile-label">${t("prov.races")}</div><div class="tile-value">${fmt(R.length)}</div></div>
    <div class="tile"><div class="tile-label">${t("prov.withResults")}</div><div class="tile-value">${fmt(R.filter((r) => r.docs).length)}</div>
      <div class="tile-sub">${R.length ? fmt((100 * R.filter((r) => r.docs).length) / R.length) : 0} %</div></div>
    <div class="tile"><div class="tile-label">${t("prov.withSplits")}</div><div class="tile-value">${fmt(R.filter((r) => r.splits).length)}</div></div>
    <div class="tile"><div class="tile-label">${t("prov.matched")}</div><div class="tile-value">${(() => {
      const n = R.reduce((s, r) => s + r.runners, 0), m = R.reduce((s, r) => s + r.matched, 0);
      return n ? `${fmt((100 * m) / n)} %` : "—";
    })()}</div><div class="tile-sub">${t("prov.matched.hint")}</div></div>`;
  function draw() {
    replaceQuery({ f: filter === "all" ? null : filter, q: q || null });
    $("#pv-f").innerHTML = seg("pvf", [["all", t("prov.f.all")], ["found", t("prov.f.found")], ["missing", t("prov.f.missing")], ["pending", t("prov.f.pending")]], filter);
    $$('[data-seg="pvf"]').forEach((b) => b.addEventListener("click", () => { filter = b.dataset.value; draw(); }));
    const qn = normalise(q);
    const rows = R.filter((r) => (filter === "all" || (filter === "found" ? r.docs : filter === "missing" ? !r.docs : !r.ffco_id))
      && (!qn || normalise(`${r.name} ${r.place || ""} ${r.org || ""}`).includes(qn)));
    $("#pv-table").innerHTML = rows.length ? html`<table class="data compact"><thead><tr>
      <th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("prov.kind")}</th><th>${t("prov.sources")}</th>
      <th class="r">${t("prov.runners")}</th><th class="r">${t("prov.matchedShort")}</th><th class="c">${t("prov.splits")}</th>
      <th>FFCO</th><th>${t("prov.checked")}</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td class="num">${fmtDate(r.date_iso, "short")}</td>
        <td><a href="#/provisoires?course=${encodeURIComponent(r.key)}">${r.name}</a>
          <div class="muted" style="font-size:12px">${[r.place, r.org].filter(Boolean).join(" · ")}</div></td>
        <td>${[r.epreuve, r.terrain].filter(Boolean).join(" · ")}${r.cn ? "" : html` <span class="tag">${t("prov.notCn")}</span>`}</td>
        <td>${r.sources.length ? r.sources.map((s) => html`<span class="tag">${SOURCE[s] || s}</span> `) : html`<span class="muted">${r.refused ? t("prov.refusedOnly") : "—"}</span>`}</td>
        <td class="r num">${r.runners ? fmt(r.runners) : "—"}</td>
        <td class="r num">${r.runners ? `${fmt((100 * r.matched) / r.runners)} %` : "—"}</td>
        <td class="c">${r.splits ? "✓" : ""}</td>
        <td>${r.ffco_id ? html`<a href="https://cn.ffcorientation.fr/course/${r.ffco_id}/" target="_blank" rel="noopener">${t("prov.published")}</a>` : html`<span class="muted">${t("prov.waiting")}</span>`}</td>
        <td class="num muted" style="font-size:12px">${when(r.last_check)}${r.done ? "" : html`<div>${t("prov.next")} ${when(r.next_check)}</div>`}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("prov.empty")}</div>`;
  }
  $("#pv-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
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
  const M = ["official", ...available().filter((m) => m !== "official")];

  main.innerHTML = html`
    <div class="crumbs"><a href="#/provisoires">${t("prov.title")}</a><span>›</span><span>${race.name}</span></div>
    <div class="page-head"><div><h1>${race.name}</h1>
      <p class="lede">${fmtDate(race.date_iso)} · ${[race.place, race.org, race.epreuve, race.terrain].filter(Boolean).join(" · ")}</p></div>
      <div class="row" style="gap:8px">${race.site ? html`<a class="btn btn-sm" href="${race.site}" target="_blank" rel="noopener">${t("prov.site")} ↗</a>` : ""}
        ${race.ffco_id ? html`<a class="btn btn-sm" href="https://cn.ffcorientation.fr/course/${race.ffco_id}/" target="_blank" rel="noopener">FFCO ↗</a>` : ""}</div></div>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${t("prov.documents")}</h2></div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("prov.source")}</th><th>${t("prov.doc")}</th><th>${t("prov.format")}</th>
        <th class="r">${t("prov.classes")}</th><th>${t("prov.found")}</th><th>${t("prov.changed")}</th></tr></thead>
      <tbody>${race.docs.map((d) => html`<tr${raw(d.classes?.length ? "" : ' style="opacity:.65"')}>
        <td><span class="tag">${SOURCE[d.source] || d.source}</span></td>
        <td style="max-width:420px;overflow-wrap:anywhere"><a href="${d.url}" target="_blank" rel="noopener">${d.title || d.note || decodeURIComponent(d.url.split("/").pop() || d.url)}</a>
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
    replaceQuery({ course: race.key, doc: di || null, c: ci || null });
    $("#pv-pick").innerHTML = html`
      <label class="field"><span>${t("prov.doc")}</span><select id="pv-doc" style="max-width:420px">${docs.map((x, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${SOURCE[x.source] || x.source} · ${x.kind} · ${x.title || decodeURIComponent(x.url.split("/").pop())}</option>`)}</select></label>
      <label class="field"><span>${d.by === "category" ? t("prov.category") : t("prov.circuit")}</span><select id="pv-c">${d.classes.map((x, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")}>${x.name} (${x.runners.length})</option>`)}</select></label>
      ${d.classes.some((x) => x.runners.some((r) => r.splits)) ? html`<a class="btn btn-sm" style="align-self:flex-end" href="#/temps-inter?course=${encodeURIComponent(race.key)}&doc=${di}&c=${ci}">${t("spl.title")} →</a>` : ""}`;
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
      <tbody>${k.runners.map((r) => html`<tr>
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
