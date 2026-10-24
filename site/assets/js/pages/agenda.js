// Agenda: the upcoming events of the FFCO agenda (built daily by ffco_scraper/agenda.py) in one
// long scrolling table, with filters, and the details of the chosen event on the right —
// including the online-registration deadline and the number of registrants.

import { html, raw, $, $$, fmt, fmtDate, isoDay, fmtFormat } from "../util.js";
import { t, tn, locale } from "../i18n.js";
import * as data from "../data.js";
import { replaceQuery } from "../app.js";
import { getProv } from "./provisional.js";
import * as country from "../country.js";
import { sees } from "../auth.js";
import { LIVE } from "../livesplits.js";

const KINDS = ["c", "e", "f"].map((k) => [k, t(`agd.kind.${k}`)]);
const GROUP_ORDER = ["A", "B1", "B2", "C1", "C2", "D"];

/** Merge of FFCO's "discipline" and "format": Forêt MD, Forêt LD, Sprint, Nuit, VTT MD, Ski, … (the data's French
 *  values compared, shown in the site's language) */
export function typeLabel(e) {
  const sp = e.spec || "", ep = e.epr || "";
  const FOOT = "Pédestre";                                             // the agenda's value (i18n-ignore)
  if (e.kind === "e") return sp && sp !== FOOT ? t("agd.type.trainingIn", { x: fmtFormat(sp) }) : t("agd.type.training");
  if (e.kind === "f") return t("agd.type.workshop");
  if (sp === FOOT) return ep === "MD" || ep === "LD" ? t("agd.type.forest", { x: ep }) : fmtFormat(ep) || t("agd.type.foot");
  if (sp === "VTT" || sp === "Ski") return fmtFormat(ep ? `${sp} ${ep}` : sp);
  if (sp.startsWith("Raid")) return fmtFormat(sp);
  return fmtFormat(ep ? `${sp} ${ep}` : sp) || "—";
}

const groupOf = (e) => (e.kind === "c" ? (e.groupe || "").replace(/^Groupe\s+/i, "") : "");
/** Only http(s) links are made clickable. */
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
const longDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const keyOf = (e, i) => (e.id != null ? String(e.id) : `x${i}`);
// a competition its organiser declared (« d<id> », a race of the provisional index) as an event of the agenda: the agenda's
// discipline (« Pédestre ») and format from the race's terrain and format
const SPEC = { "Forêt": "Pédestre", Sprint: "Pédestre", VTT: "VTT", Ski: "Ski" };      // the data's values (i18n-ignore)
const declaredEvent = (r) => ({ kind: "c", id: r.key, declared: true, date: r.date_iso, name: r.name, place: r.place, org: r.org,
  country: r.country, site: r.url || null, spec: SPEC[r.terrain] || "", epr: r.terrain === "Sprint" ? "Sprint" : r.epreuve || "" });

export async function render(main, { query }) {
  const A = await data.agenda();
  if (!A) {
    main.innerHTML = html`<div class="page-head"><div><h1>${t("nav.agenda")}</h1></div></div>
      <div class="card"><div class="empty">${t("agd.unavailable")}</div></div>`;
    return { title: t("nav.agenda") };
  }
  const today = isoDay(new Date());
  // the coming races whose organiser has published a start list (shown on « Récemment »): agenda id -> race key; and the
  // competitions declared by their organisers outside France (functions/api/declared.js), published with the provisional results
  const starts = new Map(), declared = [];
  // the live competitions tied to an event (the provisional index's `live`: liveresultat's number, a broadcast's, a
  // MeOSDjango site's « host/<n> »), and the event of a race key (the organisers' broadcasts name their competition's)
  const liveIds = new Map(), eventOf = new Map();
  try {
    for (const r of (await getProv("index.json"))?.races || []) {
      const id = String(r.agenda_id || r.key.replace(/^a/, ""));
      eventOf.set(r.key, id);
      if (r.live) liveIds.set(id, r.live);
      if (r.startlist && r.date_iso >= today) starts.set(id, r.key);
      if (/^d/.test(r.key) && r.date_iso >= today) declared.push(declaredEvent(r));
    }
  } catch (e) { /* no start lists then */ }
  // a day's races by département number (2A and 2B after 20, overseas after 95), those known by their region only last
  const depOrder = (d) => (!d ? 1e6 : /^2A$/i.test(d) ? 20.1 : /^2B$/i.test(d) ? 20.2 : parseFloat(d) || 9e5);
  // the site's country's events (country.js; France's alone until another country's agenda is read)
  const events = [...A.events, ...declared].map((e, i) => ({ ...e, key: keyOf(e, i) })).filter((e) => country.of(e) === country.current())
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || depOrder(a.dep) - depOrder(b.dep)
      || String(a.name || "").localeCompare(String(b.name || ""), "fr"));
  const byKey = new Map(events.map((e) => [e.key, e]));
  const fr = country.current() === "FR";        // France's CN and FFCO's own pages
  // the country's places, when its agenda has them (France: regions and départements; Spain: communities and provinces)
  const places = (A.regions || []).length > 0;
  const deptName = (c) => A.depts[c] || c;
  const regionOfDept = new Map(A.regions.flatMap((r) => r.depts.map((d) => [d, r.name])));
  const allDepts = A.regions.flatMap((r) => r.depts);
  const everyPlace = () => st.regions.size === A.regions.length && st.depts.size === allDepts.length;
  const checkAllPlaces = () => { st.regions = new Set(A.regions.map((r) => r.name)); st.depts = new Set(allDepts); };

  const st = {
    kinds: new Set(["c"]), cnOnly: false, from: today, to: "", spec: "",
    regions: new Set(A.regions.map((r) => r.name)), depts: new Set(A.regions.flatMap((r) => r.depts)),
    groups: new Set(), selected: query.id && byKey.has(String(query.id)) ? String(query.id) : null,
  };
  const groupsPresent = [...new Set(events.map(groupOf).filter(Boolean))]
    .sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

  main.innerHTML = html`<div class="agenda-page" id="agenda-page">
    <div class="page-head"><div><h1>${t("nav.agenda")}</h1>
      <p class="lede">${t("agd.lede", { updated: A.generated ? t("agd.updated", { d: fmtDate(A.generated.slice(0, 10)) }) : "" })}</p></div></div>
    <details class="filters-fold" id="fold">
      <summary><span>${t("agd.filters")}</span><span class="badge" id="fold-badge" hidden></span></summary>
      <section class="card agenda-filters" id="filters"></section>
    </details>
    ${country.hint()}
    <div class="agenda-layout">
      <section class="card" id="list-card"><div class="card-head"><h2 id="count"></h2></div><div class="agenda-table" id="table"></div></section>
      <section class="card agenda-detail" id="detail"></section>
    </div></div>`;
  const page = $("#agenda-page");
  // filters: always open on a wide screen, folded behind a "Filtres" bar on a phone
  const phone = window.matchMedia("(max-width: 980px)");
  const mobile = () => phone.matches;
  const syncFold = () => { if (!phone.matches) $("#fold").open = true; };
  syncFold();
  phone.addEventListener("change", syncFold);

  // ---- filtering -------------------------------------------------------------------------------
  function visible() {
    const places = everyPlace();
    return events.filter((e) => {
      if (!st.kinds.has(e.kind)) return false;
      if ((e.end || e.date) < st.from || (st.to && e.date > st.to)) return false;      // a multi-day event under way stays
      if (st.cnOnly && !e.cn) return false;
      if (st.spec && e.spec !== st.spec) return false;
      if (!places) {                                        // some places are unchecked
        if (e.dep) { if (!st.depts.has(e.dep)) return false; }
        else if (e.region) { if (!st.regions.has(e.region)) return false; }
        else return false;                                  // no known place
      }
      if (st.groups.size && !st.groups.has(groupOf(e))) return false;
      return true;
    });
  }

  // ---- filter bar ----------------------------------------------------------------------------------
  const opt = (id, value, label, state) => html`<label><input type="checkbox" data-multi="${id}" value="${value}" data-state="${state}" ${raw(state === "on" ? "checked" : "")}>${label}</label>`;
  const multi = (id, summary, body) => html`<details class="multi" id="${id}">
      <summary><span>${summary}</span></summary>
      <div class="multi-panel">
        <div class="multi-actions"><button type="button" class="clear" data-all="${id}">${t("agd.checkAll")}</button><button type="button" class="clear" data-none="${id}">${t("agd.uncheckAll")}</button></div>
        ${body}
      </div></details>`;
  const summary = (n, total, all, none) => (n === total ? all : n === 0 ? none : t("agd.nOf", { n, total }));
  const regionSummary = () => {
    const states = A.regions.map(regionState);
    const on = states.filter((x) => x === "on").length, part = states.filter((x) => x === "part").length;
    if (on === states.length) return t("agd.allF");
    if (on + part === 0) return t("agd.noneF");
    return part ? tn("agd.partial", part, { on, total: states.length }) : t("agd.nOf", { n: on, total: states.length });
  };
  const regionState = (r) => {
    if (!r.depts.length) return st.regions.has(r.name) ? "on" : "off";
    const n = r.depts.filter((d) => st.depts.has(d)).length;
    return n === r.depts.length ? "on" : n === 0 ? "off" : "part";
  };

  function drawFilters() {
    const openIds = $$("details.multi[open]", main).map((d) => d.id);          // keep an open list open while it redraws
    $("#filters").innerHTML = html`
      <div class="frow">
        ${KINDS.map(([k, label]) => html`<label class="checkline"><input type="checkbox" data-kind="${k}" ${raw(st.kinds.has(k) ? "checked" : "")}>${label}</label>`)}
        ${sees("FR") && fr ? html`<label class="checkline"><input type="checkbox" id="cn-only" ${raw(st.cnOnly ? "checked" : "")}>${t("agd.cnOnly")}</label>` : ""}
      </div>
      <div class="frow">
        <label class="field"><span>${t("agd.from")}</span><input type="date" id="f-from" value="${st.from}"></label>
        <label class="field"><span>${t("agd.to")}</span><input type="date" id="f-to" value="${st.to}" min="${st.from}"></label>
        <label class="field"><span>${t("agd.spec")}</span><select id="f-spec"><option value="">${t("agd.allF")}</option>
          ${A.specs.map((s) => html`<option value="${s}" ${raw(st.spec === s ? "selected" : "")}>${fmtFormat(s)}</option>`)}</select></label>
        ${places ? html`<div class="field field-wide"><span>${t(fr ? "agd.region" : "agd.region.other")}</span>${multi("m-regions", regionSummary(),
          A.regions.map((r) => opt("m-regions", r.name, r.name, regionState(r))))}</div>
        ${allDepts.length ? html`<div class="field field-wide"><span>${t(fr ? "agd.dept" : "agd.dept.other")}</span>${multi("m-depts", summary(st.depts.size, allDepts.length, t("agd.allM"), t("agd.noneM")),
          A.regions.filter((r) => r.depts.length).map((r) => html`<div class="multi-group">${r.name}</div>
            ${r.depts.map((d) => opt("m-depts", d, `${d} · ${deptName(d)}`, st.depts.has(d) ? "on" : "off"))}`))}</div>` : ""}` : ""}
        <button type="button" class="btn btn-sm" id="f-reset">${t("agd.reset")}</button>
      </div>
      ${groupsPresent.length ? html`<div class="frow"><div class="field"><span>${t("agd.group")}</span>
        <div class="chips" role="group" aria-label="${t("agd.groupAria")}">${groupsPresent.map((g) => html`<button type="button" class="chip toggle" data-group="${g}" aria-pressed="${st.groups.has(g)}"><span class="tick" aria-hidden="true"></span>${g}</button>`)}
        </div></div></div>` : ""}`;
    openIds.forEach((id) => { const d = $(`#${id}`); if (d) d.open = true; });
    $$('input[data-state="part"]', main).forEach((i) => { i.indeterminate = true; });   // region with only some departments checked
  }

  // the filter bar is rebuilt on each change, so its events are delegated once
  $("#filters").addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.kind) { el.checked ? st.kinds.add(el.dataset.kind) : st.kinds.delete(el.dataset.kind); }
    else if (el.id === "cn-only") st.cnOnly = el.checked;
    else if (el.id === "f-from") { st.from = el.value || today; if (st.to && st.to < st.from) st.to = st.from; }
    else if (el.id === "f-to") st.to = el.value;
    else if (el.id === "f-spec") st.spec = el.value;
    else if (el.dataset.multi === "m-regions") {
      const r = A.regions.find((x) => x.name === el.value);
      const on = el.checked;                                   // a region carries all its departments with it
      on ? st.regions.add(r.name) : st.regions.delete(r.name);
      r.depts.forEach((d) => (on ? st.depts.add(d) : st.depts.delete(d)));
    } else if (el.dataset.multi === "m-depts") {
      el.checked ? st.depts.add(el.value) : st.depts.delete(el.value);
      const r = A.regions.find((x) => x.name === regionOfDept.get(el.value));
      if (r) (r.depts.some((d) => st.depts.has(d)) ? st.regions.add(r.name) : st.regions.delete(r.name));
    }
    else return;
    drawFilters(); drawTable();
  });
  $("#filters").addEventListener("click", (e) => {
    const g = e.target.closest("[data-group]");
    if (g) { st.groups.has(g.dataset.group) ? st.groups.delete(g.dataset.group) : st.groups.add(g.dataset.group); drawFilters(); drawTable(); return; }
    const all = e.target.closest("[data-all]"), none = e.target.closest("[data-none]");
    if (all) { checkAllPlaces(); drawFilters(); drawTable(); return; }
    if (none) { st.regions.clear(); st.depts.clear(); drawFilters(); drawTable(); return; }
    if (e.target.closest("#f-reset")) {
      Object.assign(st, { kinds: new Set(["c"]), cnOnly: false, from: today, to: "", spec: "", groups: new Set() });
      checkAllPlaces();
      drawFilters(); drawTable();
    }
  });
  document.addEventListener("click", closeMulti);
  function closeMulti(e) { if (!e.target.closest?.(".multi")) $$("details.multi[open]", main).forEach((d) => (d.open = false)); }

  // ---- table ------------------------------------------------------------------------------------------------
  let shown = [];
  function activeFilters() {
    return [st.kinds.size !== 1 || !st.kinds.has("c"), st.cnOnly, st.from !== today, !!st.to, !!st.spec, !everyPlace(), st.groups.size > 0]
      .filter(Boolean).length;
  }
  function drawTable() {
    shown = visible();
    const n = activeFilters();
    $("#fold-badge").hidden = !n;
    $("#fold-badge").textContent = n;
    $("#count").textContent = tn("agd.count", shown.length);
    $("#table").innerHTML = shown.length ? html`<table class="data"><thead><tr>
        <th>${t("agd.col.date")}</th>${sees("FR") && fr ? html`<th>${t("agd.col.cn")}</th>` : ""}<th>${t("agd.col.event")}</th><th>${t("agd.col.place")}</th><th>${t("agd.col.type")}</th></tr></thead>
      <tbody>${shown.map((e) => html`<tr data-key="${e.key}" tabindex="0" class="${e.key === st.selected ? "selected" : ""} ${e.cancelled ? "cancelled" : ""}">
        <td class="num nowrap d">${fmtDate(e.date, "short")}${e.end ? html`<span class="dim d-end"> → ${fmtDate(e.end, "short")}</span>` : ""}</td>
        ${sees("FR") && fr ? html`<td class="c">${e.cn ? html`<span class="tag tag-in"><span class="m-only">CN</span><span class="d-only">${t("agd.yes")}</span></span>` : html`<span class="dim"><span class="m-only">${t("agd.notCn")}</span><span class="d-only">${t("agd.no")}</span></span>`}</td>` : ""}
        <td class="n">${e.name}${e.cancelled ? html` <span class="tag">${t("agd.cancelled")}</span>` : ""}${starts.has(String(e.id)) ? html` <span class="tag" style="color:var(--accent)" title="${t("agd.startsTip")}">${t("agd.starts")}</span>` : ""}${lives.get(String(e.id))?.now ? html` <a class="lv-badge" href="#/direct/${lives.get(String(e.id)).id}" title="${t("agd.liveTip")}">${t("lv.badge")}</a>` : ""}</td>
        <td class="p">${e.place || ""}${e.dep ? html` <span class="dim">(${e.dep})</span>` : ""}</td>
        <td class="nowrap t">${typeLabel(e)}</td></tr>`)}</tbody></table>` : html`<div class="empty">${t("agd.empty")}</div>`;
  }
  // Wide screen: list and details side by side. Phone: one at a time. Opening an event adds a history
  // entry, so the phone's own Back button (or the one in the details) returns to the list where it was.
  let pushed = false, listY = 0;
  function showDetail(key, scroll) {
    st.selected = key;
    $$("#table tr.selected").forEach((r) => r.classList.remove("selected"));
    const row = key && $(`#table tr[data-key="${CSS.escape(key)}"]`);
    row?.classList.add("selected");
    drawDetail();
    page.classList.toggle("detail-open", !!key);
    if (mobile()) window.scrollTo(0, key ? 0 : listY);
    else if (key && scroll) row?.scrollIntoView({ block: "center" });
  }
  function select(key) {
    const e = byKey.get(key);
    if (mobile()) {
      listY = window.scrollY;
      pushed = true;
      location.hash = `#/agenda?id=${encodeURIComponent(key)}`;      // the router calls onQuery below
    } else {
      showDetail(key);
      replaceQuery({ id: e && e.id != null ? e.id : null });
    }
  }
  function back() {
    if (pushed) { pushed = false; history.back(); }
    else { history.replaceState(null, "", "#/agenda"); showDetail(null); }
  }
  /** The address changed within the page (Back / Forward, or a tap): follow it without redrawing the page. */
  function onQuery(q) {
    const k = q.id != null && byKey.has(String(q.id)) ? String(q.id) : null;
    if (!k) pushed = false;
    if (k !== st.selected) showDetail(k);
  }
  $("#detail").addEventListener("click", (e) => { if (e.target.closest("[data-back]")) back(); });
  $("#table").addEventListener("click", (e) => { const r = e.target.closest("tr[data-key]"); if (r && !e.target.closest("a")) select(r.dataset.key); });
  $("#table").addEventListener("keydown", (e) => {
    const r = e.target.closest("tr[data-key]");
    if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(r.dataset.key); }
  });

  // ---- live results -------------------------------------------------------------------------------------------
  // The events under way today with a live competition the relay lists (liveresultat, a MeOSDjango site) or an organiser's
  // broadcast tied to them: event id -> { id: the « En direct » number, now: a punch within the relay's « live » time }.
  // Read once the list is drawn; nothing when none is today.
  const lives = new Map();
  async function findLive() {
    const on = events.filter((e) => e.date <= today && (e.end || e.date) >= today && !e.cancelled);
    if (!on.length) return;
    const ids = new Set(on.map((e) => String(e.id)));
    const set = (ev, id, now) => { const o = lives.get(ev); if (ids.has(ev) && (!o || (now && !o.now))) lives.set(ev, { id, now }); };
    const [list, bc] = await Promise.all([
      fetch(`${LIVE}/api/live/list`, { cache: "no-cache" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/live/broadcasts", { credentials: "same-origin" }).then((r) => r.json()).catch(() => ({}))]);
    const liveS = list.liveS || 1800;
    // the relay numbers a MeOSDjango site's races from 800 000 000 (its site's address last in the row)
    const keyOfComp = (c) => (c[0] >= 8e8 && c[0] < 9e8 ? `${c[7]}/${c[0] % 1e6}` : c[0]);
    const comps = new Map((list.comps || []).map((c) => [keyOfComp(c), c]));
    for (const [ev, xs] of liveIds) for (const x of xs) {
      const c = comps.get(x);
      if (c) set(ev, c[0], c[6] != null && c[6] <= liveS);
    }
    for (const b of bc.broadcasts || []) {
      const ev = b.race && (eventOf.get(b.race) || b.race.replace(/^a/, ""));
      if (ev && b.last) set(ev, b.id, Date.now() - b.last <= liveS * 1000);
    }
    if (!lives.size) return;
    drawTable();
    if (st.selected) drawDetail();
  }

  // ---- details ------------------------------------------------------------------------------------------------
  const link = (u, label) => (safeUrl(u) ? html`<a href="${u}" target="_blank" rel="noopener">${label || u}</a>` : (u || ""));
  const row = (label, value) => (value ? html`<dt>${label}</dt><dd>${value}</dd>` : "");
  const when = (iso) => {
    const n = Math.round((new Date(iso + "T00:00:00") - new Date(today + "T00:00:00")) / 86400e3);
    return n === 0 ? t("agd.today") : n === 1 ? t("agd.tomorrow") : n > 1 ? t("agd.inDays", { n }) : n === -1 ? t("agd.yesterday") : t("agd.daysAgo", { n: -n });
  };

  // the start list the organiser published (liveresultat, their site), shown on « Récemment »
  function startBox(e) {
    const key = starts.get(String(e.id));
    return key ? html`<div class="reg open"><div class="reg-title">${t("agd.startList")}</div>
      <p style="margin:6px 0 0"><a class="btn btn-primary btn-sm" href="#/resultats?course=${encodeURIComponent(key)}">${t("agd.startTimes")}</a>
      ${sees("FR") && !e.declared ? html`<span class="dim" style="font-size:12px">${t("agd.startHint")}</span>` : ""}</p></div>` : "";
  }

  // the event's live results (« En direct »): today's race whose live competition the relay lists
  function liveBox(e) {
    const l = lives.get(String(e.id));
    return l ? html`<div class="reg lv-reg"><div class="reg-title">${l.now ? html`<span class="lv-dot" aria-hidden="true"></span>` : ""}${t(l.now ? "agd.live.now" : "agd.live")}</div>
      <p style="margin:6px 0 0"><a class="btn btn-primary btn-sm" href="#/direct/${l.id}">${t("agd.live.go")}</a></p></div>` : "";
  }

  function registration(e) {
    if (e.kind !== "c" || e.declared) return "";                // a declared competition: its organiser's own registration
    const r = e.reg;
    // (an agenda read from a calendar that does not tell the entries — `sources`, the other countries' — says nothing)
    if (!r && A.sources) return "";
    if (!r) return html`<div class="reg closed"><div class="reg-title">${t("agd.reg")}</div><div class="dim">${t("agd.reg.none")}</div></div>`;
    const closed = r.closed || (r.close && r.close < today);
    const dates = r.close || r.mods || r.count != null;
    return html`<div class="reg ${closed ? "closed" : "open"}">
      <div class="reg-title">${t("agd.reg.online", { state: closed ? t("agd.reg.closed") : t("agd.reg.open") })}</div>
      ${dates ? html`<dl>
        ${row(t("agd.reg.close"), r.close ? html`<b>${fmtDate(r.close)}</b> <span class="dim">(${when(r.close)})</span>` : "")}
        ${row(t("agd.reg.mods"), r.mods ? html`${fmtDate(r.mods)} <span class="dim">(${when(r.mods)})</span>` : "")}
        ${row(t("agd.reg.count"), r.count != null ? html`<b>${fmt(r.count)}</b>${r.teams != null ? html` <span class="dim">(${tn("agd.reg.teams", r.teams)})</span>` : ""}` : "")}
        ${row(t(fr ? "agd.reg.byCircuit" : "agd.reg.byCat"), r.circuits ? html`<div class="reg-circ">${r.circuits.map(([c, n]) => html`<span>${c} <b>${fmt(n)}</b></span>`)}</div>` : "")}
      </dl>` : html`<div class="dim">${t("agd.reg.noDates")}</div>`}

      <p style="margin:10px 0 0"><a class="btn btn-primary btn-sm" href="${r.url}" target="_blank" rel="noopener">${t("agd.reg.link")}</a></p>
    </div>`;
  }

  // access: the "accès" section of the announcement, and the buttons that start a GPS app
  const gmaps = (g) => `https://www.google.com/maps/dir/?api=1&destination=${g[0]},${g[1]}&travelmode=driving`;
  const waze = (g) => `https://waze.com/ul?ll=${g[0]},${g[1]}&navigate=yes`;
  const apple = (g) => `https://maps.apple.com/?daddr=${g[0]},${g[1]}&dirflg=d`;
  const onApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  function accessBox(e) {
    const fl = e.flechage || "";
    const approx = `${fl && !safeUrl(fl) ? `${fl}, ` : ""}${e.place || ""}${e.dep ? ` ${e.dep}` : ""}`.trim();
    const go = e.gps ? [[gmaps(e.gps), "Google Maps"], [waze(e.gps), "Waze"], ...(onApple ? [[apple(e.gps), t("agd.go.apple")]] : [])]
      : safeUrl(e.mapUrl) ? [[e.mapUrl, t("agd.go.route")]]
      : approx ? [[`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(approx)}`, t("agd.go.approx")]] : [];
    if (!e.access && !fl && !go.length) return "";
    return html`<div class="accessbox">
      <div class="reg-title">${t("agd.access")}</div>
      ${e.access ? html`<div class="access-text">${e.access}</div><div class="dim access-src">${t("agd.access.src")}</div>` : ""}
      ${fl && !(e.access || "").includes(fl) ? html`<div style="margin-top:6px">${raw(t("agd.signs", { x: link(fl) }))}</div>` : ""}
      ${e.gps ? html`<div class="dim" style="margin-top:6px">${t("agd.coords", { x: `${e.gps[0]}, ${e.gps[1]}` })}</div>` : ""}
      ${go.length ? html`<div class="row" style="gap:8px;margin-top:10px">${go.map(([u, l]) => html`<a class="btn btn-sm btn-primary" href="${u}" target="_blank" rel="noopener">${l} ↗</a>`)}</div>` : ""}
    </div>`;
  }

  // where an event of another country comes from: its federation's page (Spain: SICO), its results platform (O-Replay)
  // (the other countries' agendas name their sources in the file, `sources`: key -> the site's name, the value a link)
  const SOURCES = { sico: ["SICO", (v) => v], oreplay: ["O-Replay", (v) => `https://www.oreplay.es/competitions/${v.split("/")[0]}`],
    ...Object.fromEntries(Object.entries(A.sources || {}).map(([k, name]) => [k, [name, (v) => (safeUrl(v) ? v : "")]])) };
  const sourceLinks = (e) => {
    const out = Object.entries(e.src || {}).filter(([k, v]) => SOURCES[k] && v && SOURCES[k][1](v))
      .map(([k, v]) => html`<a class="btn btn-sm" href="${SOURCES[k][1](v)}" target="_blank" rel="noopener">${t("agd.src", { site: SOURCES[k][0] })}</a>`);
    return out.length ? html`<p class="row" style="margin:0;gap:8px;flex-wrap:wrap">${out}</p>` : "";
  };

  function drawDetail() {
    const e = st.selected && byKey.get(st.selected);
    const box = $("#detail");
    const backBtn = html`<button type="button" class="btn btn-sm detail-back" data-back>${t("agd.back")}</button>`;
    if (!e) { box.innerHTML = html`<div class="empty">${t("agd.pick")}</div>`; return; }
    const region = e.region || (e.dep && regionOfDept.get(e.dep)) || "";
    box.innerHTML = html`
      <div class="detail-nav">${backBtn}</div>
      <div class="card-head"><div><h2>${e.name}</h2>
        <div class="hint">${e.end ? t("agd.range", { a: longDate(e.date), b: longDate(e.end) }) : longDate(e.date)}${e.cancelled ? ` · ${t("agd.cancelled")}` : ""}</div></div></div>
      <div class="card-body stack" style="gap:14px">
        <div class="row" style="gap:6px">${!sees("FR") || !fr ? "" : e.cn ? html`<span class="tag tag-in">${t("agd.inCn")}</span>` : html`<span class="tag">${t("agd.outCn")}</span>`}
          <span class="tag">${typeLabel(e)}</span>${e.groupe && e.kind === "c" ? html`<span class="tag">${e.groupe}</span>` : ""}</div>
        ${safeUrl(e.invitation) ? html`<div><a class="btn btn-primary" href="${e.invitation}" target="_blank" rel="noopener">${t("agd.invitation")}</a></div>` : ""}
        ${liveBox(e)}
        ${startBox(e)}
        ${registration(e)}
        ${accessBox(e)}
        <dl>
          ${row(t("agd.d.manif"), e.manif)}
          ${row(t("agd.d.league"), e.league)}
          ${row(t("agd.d.level"), e.level)}
          ${row(t("agd.d.place"), e.place ? html`${e.place}${e.dep ? html` (${e.dep} · ${deptName(e.dep)})` : ""}` : "")}
          ${row(t("agd.d.region"), region)}
          ${row(t("agd.d.spec"), fmtFormat(e.spec))}
          ${row(t("agd.d.epr"), fmtFormat(e.epr))}
          ${row(t("agd.d.org"), e.org)}
          ${row(t("agd.d.referee"), e.referee)}
          ${row(t("agd.d.referee2"), e.referee2)}
          ${row(t("agd.d.controller"), e.controller)}
          ${row(t("agd.d.delegate"), e.delegate)}
          ${row(t("agd.d.monitor"), e.monitor)}
          ${row(t("agd.d.site"), e.site ? link(e.site) : "")}
          ${row(t("agd.d.contact"), e.contact)}
          ${row(t("agd.d.phone"), e.phone ? html`<a href="tel:${e.phone.replace(/\s+/g, "")}">${e.phone}</a>` : "")}
          ${row(t("agd.d.email"), e.email ? html`<a href="mailto:${e.email}">${e.email}</a>` : "")}
          ${(e.extra || []).map(([l, v]) => row(l, v))}
          ${row(t("agd.d.obs"), e.obs ? html`<span style="white-space:pre-line">${e.obs}</span>` : "")}
        </dl>
        ${fr && e.id != null && !e.declared ? html`<p style="margin:0"><a class="btn btn-sm" href="https://api.ffcorientation.fr/iframe/courses/${e.id}/" target="_blank" rel="noopener">${t("agd.ffco")}</a></p>` : ""}
        ${sourceLinks(e)}
        <div class="detail-nav">${backBtn}</div>
      </div>`;
  }

  drawFilters();
  drawTable();
  findLive();
  if (st.selected) {
    // a linked event outside the default filters (past date, other kind) must still be visible
    const e = byKey.get(st.selected);
    if (e && !shown.includes(e)) { st.kinds.add(e.kind); if (e.date < st.from) st.from = e.date; drawFilters(); drawTable(); }
    showDetail(st.selected, true);
  } else drawDetail();
  return { title: t("nav.agenda"), onQuery, cleanup: () => { document.removeEventListener("click", closeMulti); phone.removeEventListener("change", syncFold); } };
}
