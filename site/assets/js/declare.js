// The competitions an organiser declares outside France (owner, 2026-10-20): France's come from FFCO's calendar, the other
// countries' are declared here by their organisers — an account that has joined the country (Réglages › Mes pays) — and
// then take their start list and results under « Organisation › Horaires / Résultats », as France's. Server:
// functions/api/declared.js (kept in R2); the provisional-results run publishes them under their country (race key « d<id> »):
// the Agenda, « Résultats » and the race's page show them within minutes of a change. One card for the organisers' pages.

import { html, raw, $, $$, fmtDate } from "./util.js";
import { t } from "./i18n.js";
import * as country from "./country.js";

const TERRAINS = [["Forêt", "For"], ["Sprint", "Spr"], ["VTT", "VTT"], ["Ski", "Ski"]];     // the data's values (i18n-ignore)
const FORMATS = ["MD", "LD", "Sprint", "Nuit", "Autre"];                                       // (i18n-ignore)
let memo = null, flash = "";         // flash: the last change's message, kept while the page draws itself again

async function call(method, body) {
  const r = await fetch("api/declared", { method, credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { code: j.error || "" });
  return j;
}
/** The account's declared competitions and the countries it may declare in: { competitions, countries, admin }. */
export async function load({ fresh = false } = {}) {
  if (!memo || fresh) memo = call("GET").catch(() => ({ competitions: [], countries: [], admin: false }));
  return memo;
}
/** A declared competition shaped as a race of the list (as the organisers' pages use them). */
export const asRace = (d) => ({ key: d.key, name: d.name, date_iso: d.date, place: d.place, org: d.club, country: d.country,
  terrain: d.terrain, epreuve: d.epreuve, declared: true });
const errText = (e) => { const k = `dc.err.${String(e.code || "").replace(/\s+/g, "_")}`; return t(k) !== k ? t(k) : t("dc.err.other"); };

/**
 * The card « Mes compétitions déclarées » in `container`: the list, « Déclarer une compétition », each one changed or taken
 * off. Nothing for an account that may declare in no country. `onChange()`: after a change (the page draws its lists again).
 */
export async function card(container, { onChange = () => {} } = {}) {
  const D = await load();
  if (!D.countries.length && !D.admin) { container.innerHTML = ""; return; }
  const countries = D.countries.length ? D.countries : country.sortedMembers(["FR"]).map((cc) => ({ cc, club: "" }));
  const draw = (editing = null, message = "") => {
    const list = D.competitions;
    container.innerHTML = html`<section class="card" style="margin-bottom:14px">
      <div class="card-head"><div><h2>${t("dc.title")}</h2><div class="hint">${t("dc.lede")}</div></div>
        ${editing ? "" : html`<button type="button" class="btn btn-sm btn-primary" id="dc-add">${t("dc.add")}</button>`}</div>
      ${message ? html`<div class="notice" style="margin:0 16px 10px">${message}</div>` : ""}
      ${editing ? form(editing) : ""}
      ${list.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("prov.race")}</th>
          <th>${t("cty.field.country")}</th><th>${t("sh.org.col.org")}</th><th></th></tr></thead>
        <tbody>${list.map((d) => html`<tr><td class="num">${fmtDate(d.date, "short")}</td>
          <td>${d.name}${d.place ? html` <span class="muted">· ${d.place}</span>` : ""}</td>
          <td>${country.name(d.country)}</td><td class="muted">${d.club || "—"}</td>
          <td class="r" style="white-space:nowrap"><button type="button" class="btn btn-sm" data-dc-edit="${d.id}">${t("dc.edit")}</button>
            <button type="button" class="btn btn-sm" data-dc-del="${d.id}">${t("dc.remove")}</button></td></tr>`)}</tbody></table></div>`
        : editing ? "" : html`<div class="empty" style="padding:10px 16px 16px">${t("dc.none")}</div>`}
    </section>`;
    $("#dc-add", container)?.addEventListener("click", () => draw({}));
    $$("[data-dc-edit]", container).forEach((b) => b.addEventListener("click", () => draw(list.find((d) => d.id === b.dataset.dcEdit))));
    $$("[data-dc-del]", container).forEach((b) => b.addEventListener("click", async () => {
      const d = list.find((x) => x.id === b.dataset.dcDel);
      if (!confirm(t("dc.removeConfirm", { name: d.name }))) return;
      b.disabled = true;
      try { await call("DELETE", { id: d.id }); D.competitions = list.filter((x) => x !== d); flash = t("dc.removed"); draw(null, flash); onChange(); }
      catch (e) { b.disabled = false; alert(errText(e)); }
    }));
    if (editing) bindForm(editing);
  };
  const form = (d) => {
    const cc = d.country || countries[0].cc;
    const sel = (v, w) => raw(v === w ? "selected" : "");
    return html`<form class="dc-form" id="dc-form" style="padding:0 16px 14px;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
      <label class="field"><span>${t("cty.field.country")}</span><select id="dc-country" required>
        ${countries.map((c) => html`<option value="${c.cc}" ${sel(c.cc, cc)}>${country.name(c.cc)}</option>`)}</select></label>
      <label class="field"><span>${t("dc.f.club")}</span><input id="dc-club" maxlength="80" value="${d.club ?? countries.find((c) => c.cc === cc)?.club ?? ""}"></label>
      <label class="field" style="grid-column:1/-1"><span>${t("dc.f.name")}</span><input id="dc-name" required minlength="3" maxlength="120" value="${d.name || ""}"></label>
      <label class="field"><span>${t("f.date")}</span><input id="dc-date" type="date" required value="${d.date || ""}"></label>
      <label class="field"><span>${t("dc.f.place")}</span><input id="dc-place" maxlength="80" value="${d.place || ""}"></label>
      <label class="field"><span>${t("dc.f.terrain")}</span><select id="dc-terrain">
        ${TERRAINS.map(([v, code]) => html`<option value="${v}" ${sel(v, d.terrain || TERRAINS[0][0])}>${t(`terrain.${code}`)}</option>`)}</select></label>
      <label class="field"><span>${t("dc.f.format")}</span><select id="dc-format"><option value="">—</option>
        ${FORMATS.map((v) => html`<option value="${v}" ${sel(v, d.epreuve || "")}>${t(`dc.fmt.${v}`)}</option>`)}</select></label>
      <label class="field" style="grid-column:1/-1"><span>${t("dc.f.site")}</span><input id="dc-site" type="url" maxlength="300" placeholder="https://" value="${d.site || ""}"></label>
      <div class="row" style="gap:8px;grid-column:1/-1"><button type="submit" class="btn btn-primary btn-sm">${d.id ? t("dc.save") : t("dc.create")}</button>
        <button type="button" class="btn btn-sm" id="dc-cancel">${t("dc.cancel")}</button>
        <span class="muted" style="font-size:12.5px" id="dc-msg"></span></div>
    </form>`;
  };
  const bindForm = (d) => {
    const f = $("#dc-form", container);
    $("#dc-cancel", container).addEventListener("click", () => draw());
    // the club of the membership chosen, while the field has not been typed in
    let typed = !!d.club;
    $("#dc-club", container).addEventListener("input", () => { typed = true; });
    $("#dc-country", container).addEventListener("change", (e) => {
      if (!typed) $("#dc-club", container).value = countries.find((c) => c.cc === e.target.value)?.club || "";
    });
    $("#dc-name", container).focus();
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = (id) => $(`#${id}`, container).value.trim();
      const body = { country: v("dc-country"), club: v("dc-club"), name: v("dc-name"), date: v("dc-date"), place: v("dc-place"),
        terrain: v("dc-terrain"), epreuve: v("dc-format"), site: v("dc-site") };
      const btn = $("button[type=submit]", f);
      btn.disabled = true;
      try {
        const r = d.id ? await call("PUT", { id: d.id, ...body }) : await call("POST", body);
        D.competitions = [r.competition, ...D.competitions.filter((x) => x.id !== d.id)].sort((a, b) => b.date.localeCompare(a.date));
        flash = t(r.soon ? "dc.saved.soon" : "dc.saved.later", { name: r.competition.name });
        draw(null, flash);
        onChange();
      } catch (err) { btn.disabled = false; $("#dc-msg", container).textContent = errText(err); }
    });
  };
  draw(null, flash);
  flash = "";
}
