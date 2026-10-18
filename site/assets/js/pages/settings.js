// Settings: the alerts — each by e-mail and/or push notification (2026-10-18; the agenda's e-mails a right the administrator
// grants, push open to all) —, this device's notifications, the language, password change, account deletion (e-mail
// accounts only).

import { html, $, $$, displayName } from "../util.js";
import { t, tn, lang, setLang, OPEN, LANGS, LANG_NAMES } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import * as store from "../store.js";
import { link } from "../app.js";

// The alerts of the table: the user's field for each channel (publicUser, /api/account/settings); `gated`: the e-mail
// needs the administrator's right (users.alerts_allowed); no `mail`: by notification only.
const ALERTS = [
  { key: "results", mail: "notify", push: "pushResults" },
  { key: "starts", mail: "startsAlert", push: "pushStarts", gated: true },
  { key: "agenda", mail: "agendaAlert", push: "pushAgenda", gated: true },
  { key: "deadline", mail: "deadlineAlert", push: "pushDeadline", gated: true },
];

// Same names as the regions of the Agenda page (ffco_scraper/agenda.py).
// the agenda values, proper names (i18n-ignore-next 3)
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
    <div class="page-head"><div><h1>${t("st.title")}</h1><p class="lede">${t("st.lede")}</p></div></div>
    <div class="stack" style="max-width:640px">
      <section class="card"><div class="card-head"><h2>${t("st.account")}</h2></div><div class="card-body stack" style="gap:10px">
        <div><span class="muted">${t("ac.email")}</span><br><b>${user.email}</b></div>
        <div><span class="muted">${t("st.licensee")}</span><br><a href="${link.runner(user.lic)}">${displayName(user.nom)}</a> · ${t("rn.licence")} ${user.lic}</div>
        ${OPEN || user.admin ? html`<label class="field"><span>${t("st.lang")}</span><select id="st-lang" style="max-width:220px">
          ${LANGS.map((l) => html`<option value="${l}" lang="${l}" ${l === lang() ? "selected" : ""}>${LANG_NAMES[l]}</option>`)}</select>
          <span class="muted" style="font-size:12.5px">${t("st.lang.hint")}</span></label>` : ""}
      </div></section>

      <section class="card"><div class="card-head"><h2>${t("st.alerts.title")}</h2></div><div class="card-body stack" style="gap:10px">
        <table class="alerts-table">
          <thead><tr><th></th><th>${t("st.alerts.mail")}</th><th>${t("st.alerts.push")}</th></tr></thead>
          <tbody>${ALERTS.map((a) => html`<tr>
            <td><b>${t(`st.alerts.${a.key}`)}</b><br><span class="muted">${t(`st.alerts.${a.key}.hint`)}</span></td>
            <td>${!a.mail ? html`<span class="muted" title="${t("st.alerts.pushOnly")}">—</span>`
              : a.gated && !user.agendaAllowed ? html`<span class="muted" title="${t("st.alerts.mailLocked")}">🔒</span>`
              : html`<input type="checkbox" data-alert="${a.mail}" aria-label="${t(`st.alerts.${a.key}`)} · ${t("st.alerts.mail")}" ${user[a.mail] ? "checked" : ""}>`}</td>
            <td><input type="checkbox" data-alert="${a.push}" aria-label="${t(`st.alerts.${a.key}`)} · ${t("st.alerts.push")}" ${user[a.push] ? "checked" : ""}></td>
          </tr>`)}</tbody>
        </table>
        ${user.agendaAllowed ? "" : html`<p class="muted" style="margin:0;font-size:12.5px">🔒 ${t("st.alerts.mailLocked")}</p>`}
        <div id="ag-regions" hidden>
          <div class="row" style="gap:8px;margin-bottom:8px"><b style="font-size:13.5px">${t("st.ag.regions")}</b>
            <button type="button" class="btn btn-ghost btn-sm" id="ag-all">${t("st.ag.all")}</button>
            <button type="button" class="btn btn-ghost btn-sm" id="ag-none">${t("st.ag.clear")}</button></div>
          <div class="ag-grid">${REGIONS.map((r) => html`<label class="check"><input type="checkbox" data-region="${r}" ${user.agendaRegions.includes(r) ? "checked" : ""}><span>${r}</span></label>`)}</div>
        </div>
        <div class="notice" id="ag-hint" hidden>${t("st.ag.none")}</div>
        <div class="notice ok" id="alerts-ok" hidden>${t("st.saved")}</div>
      </div></section>

      <section class="card"><div class="card-head"><h2>${t("st.push.title")}</h2></div><div class="card-body stack" style="gap:8px">
        <p class="soft" style="margin:0">${t("st.push.hint")}</p>
        <div id="push-device" class="stack" style="gap:8px"></div>
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

  // the language: on the account (its e-mails), then on this device, the page drawn again in it
  $("#st-lang")?.addEventListener("change", (e) => {
    const l = e.target.value;
    auth.api("api/account/settings", { lang: l }).catch(() => {}).finally(() => setLang(l));
  });
  // the alerts: each box saved as it changes; the regions shown while an agenda alert is on, by either channel
  const agendaOn = () => $$("[data-alert]").some((i) => i.checked && /^(agendaAlert|deadlineAlert|pushAgenda|pushDeadline)$/.test(i.dataset.alert));
  const regions = () => $$("[data-region]").filter((i) => i.checked).map((i) => i.dataset.region);
  const showRegions = () => {
    $("#ag-regions").hidden = !agendaOn();
    $("#ag-hint").hidden = !(agendaOn() && !regions().length);
  };
  const saved = () => {
    $("#alerts-ok").hidden = false;
    setTimeout(() => { const n = $("#alerts-ok"); if (n) n.hidden = true; }, 2500);
  };
  showRegions();
  $$("[data-alert]").forEach((box) => box.addEventListener("change", async () => {
    box.disabled = true;
    const res = await auth.api("api/account/settings", { [box.dataset.alert]: box.checked });
    box.disabled = false;
    if (!res.ok) { box.checked = !box.checked; return; }
    showRegions();
    saved();
    if (box.dataset.alert.startsWith("push")) drawDevice();
  }));
  async function saveRegions() {
    showRegions();
    if ((await auth.api("api/account/settings", { agendaRegions: regions() })).ok) saved();
  }
  $$("[data-region]").forEach((i) => i.addEventListener("change", saveRegions));
  $("#ag-all").addEventListener("click", () => { $$("[data-region]").forEach((i) => (i.checked = true)); saveRegions(); });
  $("#ag-none").addEventListener("click", () => { $$("[data-region]").forEach((i) => (i.checked = false)); saveRegions(); });

  // this device: its notifications on or off (the browser asks first), a test
  const push = await import("../push.js");
  async function drawDevice(note = "") {
    const box = $("#push-device");
    if (!box) return;
    const [state, cfg] = await Promise.all([push.deviceState(), push.getConfig(true)]);
    const n = cfg?.devices || 0;
    const wanted = $$("[data-alert]").some((i) => i.checked && i.dataset.alert.startsWith("push"));
    box.innerHTML = html`<p style="margin:0"><b>${t("st.push.dev.title")}</b> ${t(`st.push.dev.${state}`)}</p>
      ${state === "on" ? html`<div class="row" style="gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="push-test">${t("st.push.test")}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="push-off">${t("st.push.off")}</button></div>`
        : state === "off" ? html`<div><button type="button" class="btn btn-primary btn-sm" id="push-on">${t("st.push.on")}</button></div>` : ""}
      ${n ? html`<p class="muted" style="margin:0;font-size:12.5px">${tn("st.push.devices", n)}</p>` : ""}
      ${state === "on" && !wanted ? html`<p class="muted" style="margin:0;font-size:12.5px">${t("st.push.noneWanted")}</p>` : ""}
      ${note ? html`<div class="notice">${note}</div>` : ""}`;
    $("#push-on")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const s = await push.enable();
      drawDevice(s === "on" || s === "denied" ? "" : t("st.push.failed"));
    });
    $("#push-off")?.addEventListener("click", async (e) => { e.target.disabled = true; await push.disable(); drawDevice(); });
    $("#push-test")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const r = await push.test();
      drawDevice(r === null ? t("st.push.test.fail") : r === 0 ? t("st.push.test.none") : tn("st.push.test.sent", r));
    });
  }
  drawDevice();

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
