// Settings: e-mail notifications, password change, account deletion (e-mail accounts only).

import { html, $, $$, displayName } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import * as store from "../store.js";
import { link } from "../app.js";

// Same names as the regions of the Agenda page (ffco_scraper/agenda.py).
const REGIONS = ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Bretagne", "Centre-Val de Loire", "Corse", "Grand Est",
  "Hauts-de-France", "Île-de-France", "Normandie", "Nouvelle-Aquitaine", "Occitanie", "Pays de la Loire",
  "Provence-Alpes-Côte d'Azur", "Outre-mer"];

export async function render(main) {
  const me = auth.session();
  if (!me.email) {                                  // signed in with name + licence: no account behind it
    main.innerHTML = html`<div class="page-head"><div><h1>${t("st.title")}</h1></div></div>
      <div class="notice info">${t("st.legacy")}</div><a class="btn" href="#/compte/inscription">${t("ac.register")}</a>`;
    return { title: t("st.title") };
  }
  const r = await fetch("api/account/me", { credentials: "same-origin", cache: "no-store" });
  const user = r.ok ? await r.json() : null;
  if (!user) { window.dispatchEvent(new Event("cnx:unauthorised")); return null; }

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("st.title")}</h1></div></div>
    <div class="stack" style="max-width:640px">
      <section class="card"><div class="card-head"><h2>${t("st.account")}</h2></div><div class="card-body stack" style="gap:10px">
        <div><span class="muted">${t("ac.email")}</span><br><b>${user.email}</b></div>
        <div><span class="muted">${t("st.licensee")}</span><br><a href="${link.runner(user.lic)}">${displayName(user.nom)}</a> · ${t("rn.licence")} ${user.lic}</div>
        <label class="check"><input id="notify" type="checkbox" ${user.notify ? "checked" : ""}><span>${t("st.notify")}
          <br><span class="muted" style="font-size:12.5px">${t("st.notify.hint")}</span></span></label>
        <div class="notice ok" id="notify-ok" hidden>${t("st.saved")}</div>
      </div></section>

      <section class="card"><div class="card-head"><h2>${t("st.ag.title")}</h2></div><div class="card-body stack" style="gap:10px">
        ${user.agendaAllowed ? html`
        <label class="check"><input id="ag-alert" type="checkbox" ${user.agendaAlert ? "checked" : ""}><span>${t("st.ag.label")}
          <br><span class="muted" style="font-size:12.5px">${t("st.ag.hint")}</span></span></label>
        <label class="check"><input id="dl-alert" type="checkbox" ${user.deadlineAlert ? "checked" : ""}><span>${t("st.dl.label")}
          <br><span class="muted" style="font-size:12.5px">${t("st.dl.hint")}</span></span></label>
        <div id="ag-regions" ${user.agendaAlert || user.deadlineAlert ? "" : "hidden"}>
          <div class="row" style="gap:8px;margin-bottom:8px"><b style="font-size:13.5px">${t("st.ag.regions")}</b>
            <button type="button" class="btn btn-ghost btn-sm" id="ag-all">${t("st.ag.all")}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ag-none">${t("st.ag.clear")}</button></div>
          <div class="ag-grid">${REGIONS.map((r) => html`<label class="check"><input type="checkbox" data-region="${r}" ${user.agendaRegions.includes(r) ? "checked" : ""}><span>${r}</span></label>`)}</div>
        </div>
        <div class="notice" id="ag-hint" hidden>${t("st.ag.none")}</div>
        <div class="notice ok" id="ag-ok" hidden>${t("st.saved")}</div>` : html`<p class="soft" style="margin:0">${t("st.ag.locked")}</p>`}
      </div></section>

      <section class="card"><div class="card-head"><h2>${t("st.pw.title")}</h2></div><div class="card-body">
        <form id="pw" class="stack" style="gap:12px;max-width:360px">
          <label class="field"><span>${t("st.pw.old")}</span><input name="old" type="password" autocomplete="current-password" required></label>
          <label class="field"><span>${t("st.pw.new")} <span class="muted">· ${t("ac.password.hint")}</span></span><input name="password" type="password" autocomplete="new-password" required minlength="6" maxlength="200"></label>
          <div class="notice" hidden></div>
          <button class="btn" type="submit">${t("st.pw.submit")}</button>
        </form></div></section>

      <section class="card"><div class="card-head"><h2>${t("st.del.title")}</h2></div><div class="card-body">
        <p class="soft" style="margin:0 0 12px">${t("st.del.lede")}</p>
        <form id="del" class="stack" style="gap:12px;max-width:360px">
          <label class="field"><span>${t("ac.password")}</span><input name="password" type="password" autocomplete="current-password" required></label>
          <div class="notice" hidden></div>
          <button class="btn" type="submit" style="color:var(--bad)">${t("st.del.submit")}</button>
        </form></div></section>

      <p class="muted"><a href="#/compte/confidentialite">${t("pv.title")}</a></p>
    </div>`;

  const flash = (el, text, ok) => { el.textContent = text; el.className = `notice${ok ? " ok" : ""}`; el.hidden = false; };

  $("#notify").addEventListener("change", async (e) => {
    const box = e.target;
    box.disabled = true;
    const res = await auth.api("api/account/settings", { notify: box.checked });
    box.disabled = false;
    if (!res.ok) { box.checked = !box.checked; return; }
    $("#notify-ok").hidden = false;
    setTimeout(() => { const n = $("#notify-ok"); if (n) n.hidden = true; }, 2500);
  });

  // the agenda alerts (new courses, registrations closing soon), one list of regions: saved at each change
  const agState = () => ({
    agendaAlert: $("#ag-alert").checked,
    deadlineAlert: $("#dl-alert").checked,
    agendaRegions: $$("[data-region]").filter((i) => i.checked).map((i) => i.dataset.region),
  });
  async function saveAlert() {
    const s = agState(), on = s.agendaAlert || s.deadlineAlert;
    $("#ag-regions").hidden = !on;
    $("#ag-hint").hidden = !(on && !s.agendaRegions.length);
    const res = await auth.api("api/account/settings", s);
    if (!res.ok) return;
    $("#ag-ok").hidden = false;
    setTimeout(() => { const n = $("#ag-ok"); if (n) n.hidden = true; }, 2500);
  }
  if (user.agendaAllowed) {                   // the alerts are a right the administrator grants
    $("#ag-alert").addEventListener("change", saveAlert);
    $("#dl-alert").addEventListener("change", saveAlert);
    $$("[data-region]").forEach((i) => i.addEventListener("change", saveAlert));
    $("#ag-all").addEventListener("click", () => { $$("[data-region]").forEach((i) => (i.checked = true)); saveAlert(); });
    $("#ag-none").addEventListener("click", () => { $$("[data-region]").forEach((i) => (i.checked = false)); saveAlert(); });
  }

  $("#pw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target), err = $(".notice", e.target);
    const res = await auth.api("api/account/password", { old: f.get("old"), password: f.get("password") });
    if (res.ok) { e.target.reset(); flash(err, t("st.pw.ok"), true); }
    else flash(err, res.status === 401 ? t("st.pw.bad") : res.status === 422 ? t("ac.reg.err.password") : res.status === 429 ? t("ac.err.rate") : t("ac.err.generic"));
  });

  $("#del").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm(t("st.del.confirm"))) return;
    const err = $(".notice", e.target);
    const res = await auth.api("api/account/delete", { password: new FormData(e.target).get("password") });
    if (!res.ok) { flash(err, res.status === 401 ? t("st.pw.bad") : t("ac.err.generic")); return; }
    auth.forget();
    data.dropPrivate();
    store.set({ lastRunner: null, compare: [], clubs: [] });
    location.hash = "#/";
    location.reload();
  });
  return { title: t("st.title") };
}
