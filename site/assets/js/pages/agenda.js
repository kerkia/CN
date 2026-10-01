// Agenda: the upcoming events of the FFCO agenda (built daily by ffco_scraper/agenda.py) in one
// long scrolling table, with filters, and the details of the chosen event on the right —
// including the online-registration deadline and the number of registrants.

import { html, raw, $, $$, fmt, fmtDate, isoDay } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { replaceQuery } from "../app.js";

const KINDS = [["c", "Les courses"], ["e", "Les entraînements/stages"], ["f", "Les formations/séminaires"]];
const GROUP_ORDER = ["A", "B1", "B2", "C1", "C2", "D"];

/** Merge of FFCO's "discipline" and "format": Forêt MD, Forêt LD, Sprint, Nuit, VTT MD, Ski, … */
export function typeLabel(e) {
  const sp = e.spec || "", ep = e.epr || "";
  if (e.kind === "e") return sp && sp !== "Pédestre" ? `Entraînement ${sp}` : "Entraînement";
  if (e.kind === "f") return "Formation";
  if (sp === "Pédestre") return ep === "MD" || ep === "LD" ? `Forêt ${ep}` : ep || "Pédestre";
  if (sp === "VTT" || sp === "Ski") return ep ? `${sp} ${ep}` : sp;
  if (sp.startsWith("Raid")) return sp;
  return ep ? `${sp} ${ep}` : sp || "—";
}

const groupOf = (e) => (e.kind === "c" ? (e.groupe || "").replace(/^Groupe\s+/i, "") : "");
/** Only http(s) links are made clickable. */
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : null);
const longDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const keyOf = (e, i) => (e.id != null ? String(e.id) : `x${i}`);

export async function render(main, { query }) {
  const A = await data.agenda();
  if (!A) {
    main.innerHTML = html`<div class="page-head"><div><h1>${t("nav.agenda")}</h1></div></div>
      <div class="card"><div class="empty">L'agenda n'est pas encore disponible.</div></div>`;
    return { title: t("nav.agenda") };
  }
  const today = isoDay(new Date());
  const events = A.events.map((e, i) => ({ ...e, key: keyOf(e, i) }));
  const byKey = new Map(events.map((e) => [e.key, e]));
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

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.agenda")}</h1>
      <p class="lede">Les prochaines manifestations de course d'orientation en France, d'après l'agenda de la FFCO
        (mis à jour chaque matin${A.generated ? html`, dernière mise à jour le ${fmtDate(A.generated.slice(0, 10))}` : ""}).</p></div></div>
    <section class="card agenda-filters" id="filters"></section>
    <div class="agenda-layout">
      <section class="card"><div class="card-head"><h2 id="count"></h2></div><div class="agenda-table" id="table"></div></section>
      <section class="card agenda-detail" id="detail"></section>
    </div>`;

  // ---- filtering -------------------------------------------------------------------------------
  function visible() {
    const places = everyPlace();
    return events.filter((e) => {
      if (!st.kinds.has(e.kind)) return false;
      if (e.date < st.from || (st.to && e.date > st.to)) return false;
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
        <div class="multi-actions"><button type="button" class="clear" data-all="${id}">Tout cocher</button><button type="button" class="clear" data-none="${id}">Tout décocher</button></div>
        ${body}
      </div></details>`;
  const summary = (n, total, all, none) => (n === total ? all : n === 0 ? none : `${n} sur ${total}`);
  const regionSummary = () => {
    const states = A.regions.map(regionState);
    const on = states.filter((x) => x === "on").length, part = states.filter((x) => x === "part").length;
    if (on === states.length) return "Toutes";
    if (on + part === 0) return "Aucune";
    return part ? `${on} sur ${states.length} (+${part} partielle${part > 1 ? "s" : ""})` : `${on} sur ${states.length}`;
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
        <label class="checkline"><input type="checkbox" id="cn-only" ${raw(st.cnOnly ? "checked" : "")}>Comptant pour le CN uniquement</label>
      </div>
      <div class="frow">
        <label class="field"><span>Entre le</span><input type="date" id="f-from" value="${st.from}"></label>
        <label class="field"><span>et le</span><input type="date" id="f-to" value="${st.to}" min="${st.from}"></label>
        <label class="field"><span>Spécialité</span><select id="f-spec"><option value="">Toutes</option>
          ${A.specs.map((s) => html`<option value="${s}" ${raw(st.spec === s ? "selected" : "")}>${s}</option>`)}</select></label>
        <div class="field"><span>Région</span>${multi("m-regions", regionSummary(),
          A.regions.map((r) => opt("m-regions", r.name, r.name, regionState(r))))}</div>
        <div class="field"><span>Département</span>${multi("m-depts", summary(st.depts.size, allDepts.length, "Tous", "Aucun"),
          A.regions.filter((r) => r.depts.length).map((r) => html`<div class="multi-group">${r.name}</div>
            ${r.depts.map((d) => opt("m-depts", d, `${d} · ${deptName(d)}`, st.depts.has(d) ? "on" : "off"))}`))}</div>
        <button type="button" class="btn btn-sm" id="f-reset">Réinitialiser</button>
      </div>
      ${groupsPresent.length ? html`<div class="frow"><div class="field"><span>Groupe (courses)</span>
        <div class="chips" role="group" aria-label="Groupe">${groupsPresent.map((g) => html`<button type="button" class="chip toggle" data-group="${g}" aria-pressed="${st.groups.has(g)}"><span class="tick" aria-hidden="true"></span>${g}</button>`)}
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
  function drawTable() {
    shown = visible();
    $("#count").textContent = `${fmt(shown.length)} manifestation${shown.length > 1 ? "s" : ""}`;
    $("#table").innerHTML = shown.length ? html`<table class="data"><thead><tr>
        <th>Date</th><th>CN</th><th>Événement</th><th>Lieu</th><th>Type</th></tr></thead>
      <tbody>${shown.map((e) => html`<tr data-key="${e.key}" tabindex="0" class="${e.key === st.selected ? "selected" : ""} ${e.cancelled ? "cancelled" : ""}">
        <td class="num nowrap">${fmtDate(e.date, "short")}</td>
        <td>${e.cn ? html`<span class="tag tag-in">oui</span>` : html`<span class="dim">non</span>`}</td>
        <td>${e.name}${e.cancelled ? html` <span class="tag">annulée</span>` : ""}</td>
        <td>${e.place || ""}${e.dep ? html` <span class="dim">(${e.dep})</span>` : ""}</td>
        <td class="nowrap">${typeLabel(e)}</td></tr>`)}</tbody></table>` : html`<div class="empty">Aucune manifestation avec ces critères.</div>`;
  }
  const select = (key, scroll) => {
    st.selected = key;
    $$("#table tr.selected").forEach((r) => r.classList.remove("selected"));
    const row = key && $(`#table tr[data-key="${CSS.escape(key)}"]`);
    row?.classList.add("selected");
    if (scroll) row?.scrollIntoView({ block: "center" });
    drawDetail();
    const e = key && byKey.get(key);
    replaceQuery({ id: e && e.id != null ? e.id : null });
    if (key && window.matchMedia("(max-width: 980px)").matches) $("#detail").scrollIntoView({ block: "start" });
  };
  $("#table").addEventListener("click", (e) => { const r = e.target.closest("tr[data-key]"); if (r && !e.target.closest("a")) select(r.dataset.key); });
  $("#table").addEventListener("keydown", (e) => {
    const r = e.target.closest("tr[data-key]");
    if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(r.dataset.key); }
  });

  // ---- details ------------------------------------------------------------------------------------------------
  const link = (u, label) => (safeUrl(u) ? html`<a href="${u}" target="_blank" rel="noopener">${label || u}</a>` : (u || ""));
  const row = (label, value) => (value ? html`<dt>${label}</dt><dd>${value}</dd>` : "");
  const when = (iso) => {
    const n = Math.round((new Date(iso + "T00:00:00") - new Date(today + "T00:00:00")) / 86400e3);
    return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : n > 1 ? `dans ${n} jours` : n === -1 ? "hier" : `il y a ${-n} jours`;
  };

  function registration(e) {
    if (e.kind !== "c") return "";
    const r = e.reg;
    if (!r) return html`<div class="reg closed"><div class="reg-title">Inscriptions</div><div class="dim">Pas d'inscription en ligne sur le site de la FFCO.</div></div>`;
    const closed = r.closed || (r.close && r.close < today);
    const dates = r.close || r.mods || r.count != null;
    return html`<div class="reg ${closed ? "closed" : "open"}">
      <div class="reg-title">Inscriptions en ligne · ${closed ? "fermées" : "ouvertes"}</div>
      ${dates ? html`<dl>
        ${row("Clôture des inscriptions", r.close ? html`<b>${fmtDate(r.close)}</b> <span class="dim">(${when(r.close)})</span>` : "")}
        ${row("Clôture des modifications (puces, compositions)", r.mods ? html`${fmtDate(r.mods)} <span class="dim">(${when(r.mods)})</span>` : "")}
        ${row("Nombre d'inscrits", r.count != null ? html`<b>${fmt(r.count)}</b>` : "")}
      </dl>` : html`<div class="dim">Dates de clôture non publiées.</div>`}
      <p style="margin:10px 0 0"><a class="btn btn-primary btn-sm" href="${r.url}" target="_blank" rel="noopener">Inscriptions en ligne ↗</a></p>
    </div>`;
  }

  function drawDetail() {
    const e = st.selected && byKey.get(st.selected);
    const box = $("#detail");
    if (!e) { box.innerHTML = html`<div class="empty">Cliquez sur une manifestation pour en voir le détail.</div>`; return; }
    const region = e.region || (e.dep && regionOfDept.get(e.dep)) || "";
    box.innerHTML = html`
      <div class="card-head"><div><h2>${e.name}</h2>
        <div class="hint">${longDate(e.date)}${e.cancelled ? " · annulée" : ""}</div></div></div>
      <div class="card-body stack" style="gap:14px">
        <div class="row" style="gap:6px">${e.cn ? html`<span class="tag tag-in">Compte pour le CN</span>` : html`<span class="tag">Hors CN</span>`}
          <span class="tag">${typeLabel(e)}</span>${e.groupe && e.kind === "c" ? html`<span class="tag">${e.groupe}</span>` : ""}</div>
        ${registration(e)}
        <dl>
          ${row("Manifestation", e.manif)}
          ${row("Lieu", e.place ? html`${e.place}${e.dep ? html` (${e.dep} · ${deptName(e.dep)})` : ""}` : "")}
          ${row("Région", region)}
          ${row("Spécialité", e.spec)}
          ${row("Épreuve", e.epr)}
          ${row("Organisateur", e.org)}
          ${row("Arbitre titulaire", e.referee)}
          ${row("Arbitre stagiaire", e.referee2)}
          ${row("Contrôleur des circuits", e.controller)}
          ${row("Délégué", e.delegate)}
          ${row("Fléchage", e.flechage ? link(e.flechage) : "")}
          ${row("Site web", e.site ? link(e.site) : "")}
          ${row("Invitation", e.invitation ? link(e.invitation, "Télécharger") : "")}
          ${row("Contact", e.contact)}
          ${row("Téléphone", e.phone ? html`<a href="tel:${e.phone.replace(/\s+/g, "")}">${e.phone}</a>` : "")}
          ${row("E-mail", e.email ? html`<a href="mailto:${e.email}">${e.email}</a>` : "")}
          ${row("Observations", e.obs ? html`<span style="white-space:pre-line">${e.obs}</span>` : "")}
        </dl>
        ${e.id != null ? html`<p style="margin:0"><a class="btn btn-sm" href="https://api.ffcorientation.fr/iframe/courses/${e.id}/" target="_blank" rel="noopener">Fiche sur le site de la FFCO ↗</a></p>` : ""}
      </div>`;
  }

  drawFilters();
  drawTable();
  if (st.selected) {
    // a linked event outside the default filters (past date, other kind) must still be visible
    const e = byKey.get(st.selected);
    if (e && !shown.includes(e)) { st.kinds.add(e.kind); if (e.date < st.from) st.from = e.date; drawFilters(); drawTable(); }
    select(st.selected, true);
  } else drawDetail();
  return { title: t("nav.agenda"), cleanup: () => document.removeEventListener("click", closeMulti) };
}
