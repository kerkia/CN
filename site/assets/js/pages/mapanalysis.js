// « Analyse de carte » (owner, 2026-11-01: « grouping solo and multi analyses into one workflow »): Coach's GPS analyses
// behind one page of four tiles, two by who gives the map. The organiser has published the map and its circuits
// (« Analyse multi »'s events): compare one's trace with the others' (the multi analysis, pages/shared.js) or replay one's
// race alone on that map, nothing sent (« Analyse solo » in its organiser's mode, pages/analysis.js route analysisOrga). One's
// own map: a competition of « Résultats », its published times beside the trace (#/analyse), or a training or any outing
// (#/analyse-solo). The first three open on a list of events beside a map of the country (agendamap.js, as the Agenda),
// `?choix=multi|orga|course`.

import { html, raw, $, $$, fmtDate, normalise } from "../util.js";
import { t, tn, has } from "../i18n.js";
import * as auth from "../auth.js";
import * as country from "../country.js";
import * as agendaMap from "../agendamap.js";
import { getProv } from "./provisional.js";
import { raceFilters } from "../racefilters.js";
import { replaceQuery } from "../app.js";

const CHOICES = ["multi", "orga", "course"];
const HOME = "#/analyse-carte";
/** Where a published event opens: its multi analysis, or « Analyse solo » on its map. */
export const multiHref = (a) => `${a.kind === "race" ? "#/analyse-competition" : "#/analyse-club"}?id=${a.id}`;
export const orgaHref = (id) => `#/analyse-orga?id=${id}`;
/** The line back to this page, at the top of every analysis it leads to. */
export const backLine = (choice = "") => html`<p class="ma-crumb"><a href="${HOME}${choice ? `?choix=${choice}` : ""}">‹ ${t(choice ? `ma.${choice}.title` : "ma.title")}</a></p>`;

export async function render(main, r) {
  const choice = CHOICES.includes(r.query.choix) ? r.query.choix : null;
  // the published events are read by an account (Analyse multi's API); a visitor without one sees those their organiser opened
  // to visitors (owner, 2026-11-02), with the others' traces only
  if (choice === "orga" && !auth.session()) { location.replace(HOME); return { title: t("ma.title") }; }
  return choice ? picker(main, choice, r.query) : tiles(main);
}

// ---- the four tiles -----------------------------------------------------------------------------------------------
// Each tile: what it does, what one needs (« votre trace » / « votre carte et votre trace »), and in its corner whether one
// analyses alone or with the other runners (owner, 2026-11-01: a number meant nothing).
const ICONS = {
  // the traces of several runners between two controls
  multi: '<circle cx="8" cy="9" r="3.2"/><circle cx="32" cy="31" r="3.2"/><path d="M10.5 11.5 C 16 14, 18 24, 29.5 28.5"/><path d="M10.8 10 C 20 8, 30 14, 30.5 28" stroke-dasharray="3 2.4"/><path d="M9.5 12 C 9 22, 20 30, 29 30.5" stroke-dasharray="1 2.4"/>',
  // one trace on a map handed over, the flag
  orga: '<rect x="5" y="6" width="30" height="28" rx="2"/><path d="M11 28 C 15 20, 20 24, 23 16 S 28 12, 29 11"/><path d="M27 8 l6 0 l-3 4 z" fill="currentColor"/>',
  // a stopwatch: the published times
  course: '<circle cx="20" cy="22" r="11"/><path d="M20 22 L 20 15 M17 7 h6 M20 7 v4 M29 13 l2 -2"/>',
  // a map of one's own, photographed: the camera corner and a trace
  free: '<path d="M6 30 L 6 10 L 16 6 L 24 10 L 34 6 L 34 26 L 24 30 L 16 26 Z"/><path d="M16 6 V 26 M24 10 V 30"/><path d="M10 24 C 14 16, 22 22, 30 12" stroke-dasharray="2 2"/>',
};
const icon = (k) => raw(`<svg class="ma-ico" viewBox="0 0 40 40" aria-hidden="true">${ICONS[k]}</svg>`);
// a running figure, 24 units high: one runner, or three for the analysis with the others
const RUNNER = '<circle cx="14.5" cy="4.2" r="2.3" class="ma-who-head"/><path d="M13.6 7.6 L 11 14 M13.2 8.6 L 16.8 10.6 L 19.6 9.2 M12.6 9.2 L 9.2 10.2 L 7.2 12.8 M11 14 L 15 17 L 14 22 M11 14 L 8.6 18.2 L 4.6 19.2"/>';
const who = (many) => raw(`<span class="ma-who" title="${t(many ? "ma.who.many" : "ma.who.one")}" role="img" aria-label="${t(many ? "ma.who.many" : "ma.who.one")}">${many
  ? `<svg viewBox="0 0 40 24"><g transform="translate(0 4) scale(0.82)">${RUNNER}</g><g transform="translate(20 4) scale(0.82)">${RUNNER}</g><g transform="translate(9 0)">${RUNNER}</g></svg>`
  : `<svg viewBox="0 0 24 24">${RUNNER}</svg>`}</span>`);

function tiles(main) {
  const me = auth.session();
  const tile = (k, href, account) => {
    const off = account && !me;
    return html`<a class="ma-tile${off ? " off" : ""}" data-tile="${k}" href="${off ? "#/compte/inscription" : href}">
      <span class="ma-tile-top">${icon(k)}${who(k === "multi")}</span>
      <b>${t(`ma.${k}.title`)}</b><span class="ma-tile-desc">${t(`ma.${k}.desc`)}</span>
      <span class="ma-need"><i>${t("ma.need")}</i> ${t(`ma.${k}.need`)}</span>
      ${off ? html`<span class="ma-acc">${t("ma.account")}</span>` : ""}</a>`;
  };
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ma.title")}</h1><p class="lede">${t("ma.lede")}</p></div></div>
    <div class="ma-groups">
      <section class="ma-group" data-group="orga"><h2>${t("ma.g.orga")}</h2><p class="ma-group-lede">${t("ma.g.orga.lede")}</p>
        <div class="ma-tiles">${tile("multi", `${HOME}?choix=multi`)}${tile("orga", `${HOME}?choix=orga`, true)}</div></section>
      <section class="ma-group" data-group="own"><h2>${t("ma.g.own")}</h2><p class="ma-group-lede">${t("ma.g.own.lede")}</p>
        <div class="ma-tiles">${tile("course", `${HOME}?choix=course`)}${tile("free", "#/analyse-solo")}</div></section>
    </div>
    <p class="muted ma-foot">${t("ma.foot")}</p>`;
  return { title: t("ma.title") };
}

// ---- the events to choose from --------------------------------------------------------------------------------------
async function api(path) {
  const r = await fetch(`api/analyses${auth.session() ? "" : "/v"}${path}`, { credentials: "same-origin" });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(d?.error || `http ${r.status}`), { code: d?.error });
  return d;
}
const keyOf = (id) => { try { return sessionStorage.getItem(`ocn.an.key.${id}`) || ""; } catch (e) { return ""; } };
const setKey = (id, k) => { try { sessionStorage.setItem(`ocn.an.key.${id}`, k); } catch (e) { /* this visit only */ } };

async function picker(main, choice, query) {
  const me = auth.session();
  main.innerHTML = html`
    ${backLine()}
    <div class="page-head"><div><h1>${t(`ma.${choice}.title`)}</h1><p class="lede">${t(`ma.${choice}.pick`)}</p></div></div>
    <div id="ma-filters"></div>
    <div class="ma-pick">
      <section class="card ma-list"><div class="table-wrap" id="ma-table"><div class="empty">${t("misc.loading")}</div></div></section>
      <aside class="ma-side"><div class="ma-map" id="ma-map" hidden></div><section class="card ma-detail" id="ma-detail"></section></aside>
    </div>`;
  const idx = await getProv("index.json").catch(() => null);
  const races = (idx?.races || []).filter((x) => x.docs && !x.soon);
  const raceOf = (k) => races.find((x) => x.key === k) || null;
  const cc = country.current();
  let items = [], every = [], published = new Map(), F = null;
  if (choice === "course") {
    every = races;
    items = races.filter((x) => country.of(x) === cc).sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name))
      .map((x) => ({ key: x.key, name: x.name, date: x.date_iso, place: x.place || "", pos: x.pos || null, org: x.org || "", race: x, splits: !!x.splits,
        href: `#/analyse?course=${encodeURIComponent(x.key)}` }));
    // a competition whose organiser has published its map: its tile 2 needs no map of one's own
    if (me) { try { for (const a of (await api("")).analyses) if (a.kind === "race" && a.courses > 0 && a.race && a.solo !== false) published.set(a.race, a); } catch (e) { /* none */ } }
  } else {
    let data = null;
    try { data = await api(""); } catch (e) { $("#ma-table").innerHTML = html`<div class="empty">${t("ma.err")}</div>`; return { title: t(`ma.${choice}.title`) }; }
    // « Analyse solo » on an organiser's map only where its organisers left it open (owner, 2026-11-04; they still see theirs)
    const ready = data.analyses.filter((a) => a.courses > 0 && (choice !== "orga" || a.solo !== false || a.organiser));
    every = ready.map((a) => raceOf(a.race) || {});
    // a competition of the site's country (a race no longer on « Résultats »: France's), every training
    items = ready.filter((a) => a.kind !== "race" || country.of(raceOf(a.race) || {}) === cc).map((a) => {
      const rc = raceOf(a.race);
      return { key: a.id, name: a.title, date: a.date, place: rc?.place || "", pos: a.pos || rc?.pos || null, org: a.ownerName || "", kind: a.kind,
        courses: a.courses, locked: a.access === "locked", organiser: a.organiser, draft: !!a.draft, race: rc, href: choice === "multi" ? multiHref(a) : orgaHref(a.id) };
    });
  }
  const byKey = new Map(items.map((e) => [e.key, e]));
  let kindSel = ["race", "club"].includes(query.type) ? query.type : "all", q = query.q || "";
  let selected = byKey.has(query.id) ? query.id : null;

  // ---- the filters: the lists of races' own for the competitions (racefilters.js), a kind and a search for the events
  if (choice === "course") {
    F = await raceFilters({ id: "ma", races: items.map((e) => e.race), address: false, onChange: () => draw() });
    $("#ma-filters").innerHTML = html`${F.html}${country.hint(every.map(country.of))}`;
    F.bind();
  } else {
    $("#ma-filters").innerHTML = html`<div class="filters ma-filters">
      <div class="seg" role="group" aria-label="${t("ma.kind")}">${["all", "race", "club"].map((k) => html`<button type="button" class="seg-btn${k === kindSel ? " on" : ""}" data-kind="${k}" aria-pressed="${k === kindSel}">${t(k === "all" ? "ma.kind.all" : `ma.kinds.${k}`)}</button>`)}</div>
      <label class="field"><span>${t("ma.search")}</span><input type="search" id="ma-q" value="${q}" placeholder="${t("ma.search.ph")}" style="width:240px"></label></div>
      ${country.hint(every.map(country.of))}`;
    $$("#ma-filters [data-kind]").forEach((b) => b.addEventListener("click", () => {
      kindSel = b.dataset.kind;
      $$("#ma-filters [data-kind]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      draw();
    }));
    $("#ma-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  }
  const keep = (e) => (choice === "course" ? !F || F.keep(e.race)
    : (kindSel === "all" || e.kind === kindSel) && (!q || normalise(`${e.name} ${e.place} ${e.org}`).includes(normalise(q))));

  // ---- the list
  let shown = [];
  function draw() {
    shown = items.filter(keep);
    if (selected && !shown.some((e) => e.key === selected)) selected = null;
    const sub = (e) => [e.place, choice === "course" ? e.org : ""].filter(Boolean).join(" · ");
    $("#ma-table").innerHTML = shown.length ? html`<table class="data compact ma-table" data-freeze="2" data-freeze-phone="1"><thead><tr>
        <th>${t("f.date")}</th><th>${t(choice === "course" ? "prov.race" : "ma.col.event")}</th>
        ${choice === "course" ? html`<th>${t("ma.col.what")}</th>` : html`<th>${t("ma.col.kind")}</th><th>${t("ma.col.org")}</th><th class="r">${t("sh.col.courses")}</th>`}</tr></thead>
      <tbody>${shown.map((e) => html`<tr data-key="${e.key}" tabindex="0" class="${e.key === selected ? "sel" : ""}">
        <td class="num">${fmtDate(e.date, "short")}</td>
        <td class="ma-name"><a href="${e.href}" data-open>${e.name}</a>${e.locked ? html` <span title="${t("ma.locked")}">🔒</span>` : ""}${e.draft ? html` <span class="tag sh-m-draft" title="${t("sh.m.draft.tip")}">${t("sh.m.state.draft")}</span>` : ""}${sub(e) ? html`<div class="muted ma-sub">${sub(e)}</div>` : ""}</td>
        ${choice === "course" ? html`<td>${e.splits ? html`<span class="tag">${t("ma.splits")}</span>` : ""}${published.has(e.key) ? html` <span class="tag ma-tag-orga">${t("ma.tag.orgaMap")}</span>` : ""}</td>`
          : html`<td><span class="tag">${t(`ma.kind.${e.kind}`)}</span></td><td class="muted">${e.org || "—"}</td><td class="r num">${e.courses}</td>`}</tr>`)}</tbody></table>`
      : html`<div class="empty">${t(items.length ? "ra.emptyFilter" : choice === "course" ? "ma.course.none" : "ma.events.none")}</div>`;
    // where an event comes from (named, not linked: no page leads into another module)
    if (choice !== "course") $("#ma-table").insertAdjacentHTML("beforeend", html`<p class="hint ma-how">${t("ma.events.how", { path: `${t("mod.orga")} › ${t("nav.orgAnalyses")}` })}</p>`);
    map?.show(shown, selected);
    detail();
  }

  // ---- the event chosen: its facts and the way in
  function detail() {
    const e = byKey.get(selected);
    const box = $("#ma-detail");
    if (!e) { box.innerHTML = html`<div class="card-body"><p class="muted">${t("ma.pick.hint")}</p></div>`; return; }
    const pub = choice === "course" ? published.get(e.key) : null;
    const facts = [fmtDate(e.date), e.place, choice === "course" ? e.org : e.org && t("ma.by", { org: e.org })].filter(Boolean);
    box.innerHTML = html`<div class="card-body">
      <h2 class="ma-d-title">${e.name}</h2><p class="muted">${facts.join(" · ")}</p>
      ${choice !== "course" ? html`<p>${html`<span class="tag">${t(`ma.kind.${e.kind}`)}</span>`} ${tn("ma.courses", e.courses)}</p>` : html`<p class="muted">${t(e.splits ? "ma.course.splits" : "ma.course.noSplits")}</p>`}
      ${choice === "orga" && e.locked && !keyOf(e.key) ? html`<p class="muted">${t("ma.locked.ask")}</p>
        <div class="row" style="gap:8px"><input type="password" id="ma-pw" placeholder="${t("sh.pw")}" autocomplete="off" style="width:180px">
        <button type="button" class="btn btn-primary" id="ma-unlock">${t("ma.orga.open")}</button></div><p class="muted" id="ma-pw-note"></p>`
        : html`<a class="btn btn-primary" href="${e.href}">${t(`ma.${choice}.open`)}</a>`}
      ${pub ? html`<div class="notice ma-cross"><p>${t("ma.cross")}</p><a class="btn btn-sm" href="${orgaHref(pub.id)}">${t("ma.cross.go")}</a></div>` : ""}</div>`;
    const go = async () => {
      try {
        const r = await fetch(`api/analyses/${e.key}/unlock`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#ma-pw").value }) });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error);
        setKey(e.key, d.key); location.hash = e.href;
      } catch (err) { $("#ma-pw-note").textContent = t("ma.pw.wrong"); }
    };
    $("#ma-unlock")?.addEventListener("click", go);
    $("#ma-pw")?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
  }
  function select(key) {
    selected = key;
    $$("#ma-table tr[data-key]").forEach((r) => r.classList.toggle("sel", r.dataset.key === key));
    map?.select(key);
    detail();
    replaceQuery({ choix: choice, id: key || null });
  }

  // ---- the map (a computer only, as the Agenda's): the event under the mouse in the list shown on it, and the reverse
  let map = null;
  const wide = matchMedia("(min-width: 980px)");
  async function mountMap() {
    if (map || !wide.matches) return;
    map = await agendaMap.mount($("#ma-map"), cc, {
      // the country's units as the Agenda names them (« département », « canton »…)
      levels: Object.fromEntries(["dept", "region"].map((l) => [l, (cc === "FR" ? t(`agd.${l}`) : has(`agd.${l}.${cc}`) ? t(`agd.${l}.${cc}`) : t(`agd.${l}.other`)).toLowerCase()])),
      onPick: (key) => { select(key); $(`#ma-table tr[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" }); },
      onHover: (key) => {
        $$("#ma-table tr.map-hover").forEach((r) => r.classList.remove("map-hover"));
        if (key) $(`#ma-table tr[data-key="${CSS.escape(key)}"]`)?.classList.add("map-hover");
      },
    });
    map?.show(shown, selected);
  }
  wide.addEventListener("change", mountMap);
  const table = $("#ma-table");
  table.addEventListener("click", (e) => { const r = e.target.closest("tr[data-key]"); if (r && !e.target.closest("[data-open]")) select(r.dataset.key); });
  table.addEventListener("dblclick", (e) => { const r = e.target.closest("tr[data-key]"); if (r) location.hash = byKey.get(r.dataset.key).href; });
  table.addEventListener("mouseover", (e) => { const r = e.target.closest("tr[data-key]"); if (r) map?.hover(r.dataset.key); });
  table.addEventListener("mouseleave", () => map?.hover(null));
  table.addEventListener("keydown", (e) => {
    const r = e.target.closest("tr[data-key]");
    if (!r) return;
    if (e.key === "Enter") { e.preventDefault(); if (selected === r.dataset.key) location.hash = byKey.get(r.dataset.key).href; else select(r.dataset.key); }
  });
  draw();
  mountMap();
  if (selected) map?.select(selected);
  return { title: t(`ma.${choice}.title`), cleanup: () => { wide.removeEventListener("change", mountMap); map?.destroy?.(); } };
}
