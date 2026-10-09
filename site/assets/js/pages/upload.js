// « Publier sur O'CN » — the last step of « Déposer » (pages/deposit.js): the file the organiser has read and looked at
// in the browser is sent, for a race of the list or for a race the site does not know yet (its name, date, place,
// club and format). The races of the file's date come first. The file goes as is to functions/api/upload.js (R2), and
// the provisional-results run reads it (ffco_scraper/prov/sources/upload.py): it is published within minutes, or at
// the next hourly run.

import { html, raw, $, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import * as local from "../local.js";

const TERRAINS = [["Forêt", "terrain.For"], ["Sprint", "terrain.Spr"], ["VTT", "terrain.VTT"], ["Ski", "terrain.Ski"]];
const FORMATS = ["Sprint", "MD", "LD", "Nuit", "Autre"];
const day = (d) => d.toISOString().slice(0, 10);
export const mb = (n) => `${fmt(n / 1024 / 1024, 1)} Mo`;

/** The form, in `container`. races: the list's races (index.json); preset: a race's key to choose first. */
export function publishCard(container, { races, preset = "", onDone = () => {} }) {
  const rec = local.get();
  if (!rec) { container.innerHTML = ""; return; }
  const fileDate = rec.docs?.map((d) => d.date).find(Boolean) || null;
  const fileTitle = rec.docs?.map((d) => d.title).find(Boolean) || "";
  const myClub = auth.myClub();
  const clubs = Object.entries(data.meta()?.names?.clubs || {}).sort((a, b) => a[1].localeCompare(b[1], "fr"));
  const today = new Date(), from = new Date(Date.now() - 60 * 86400e3);
  const sorted = [...races].sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name, "fr"));
  const sameDay = fileDate ? sorted.filter((r) => r.date_iso === fileDate) : [];
  const mine = myClub ? sorted.filter((r) => (r.org || "").startsWith(myClub) && !sameDay.includes(r)) : [];
  const rest = sorted.filter((r) => !sameDay.includes(r) && !mine.includes(r));
  const pick = preset || (sameDay.length === 1 ? sameDay[0].key : "");
  const opt = (r) => html`<option value="${r.key}" ${raw(r.key === pick ? "selected" : "")}>${fmtDate(r.date_iso, "short")} · ${r.name}${r.place ? ` · ${r.place}` : ""}</option>`;
  const inWindow = fileDate && fileDate >= day(from) && fileDate <= day(today);

  container.innerHTML = html`<section class="card" style="margin-top:16px">
    <div class="card-head"><div><h2>${t("dep.pub.title")}</h2><div class="hint">${t("dep.pub.lede")}</div></div></div>
    <div class="card-body upload-form" style="max-width:640px">
      <label class="field"><span>${t("up.race")}</span><select id="up-race" required>
        <option value="">${t("up.race.pick")}</option>
        ${sameDay.length ? html`<optgroup label="${t("dep.pub.sameDay")} ${fmtDate(fileDate)}">${sameDay.map(opt)}</optgroup>` : ""}
        ${mine.length ? html`<optgroup label="${t("up.race.mine")}">${mine.map(opt)}</optgroup>` : ""}
        <optgroup label="${t("up.race.all")}">${rest.map(opt)}</optgroup>
        <option value="__new">${t("up.race.new")}</option></select></label>
      <div id="up-new" class="upload-new" hidden>
        <label class="field"><span>${t("up.new.name")}</span><input id="up-name" maxlength="120" value="${fileTitle.slice(0, 120)}" placeholder="${t("up.new.name.ph")}"></label>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <label class="field"><span>${t("f.date")}</span><input type="date" id="up-date" min="${day(from)}" max="${day(today)}" value="${inWindow ? fileDate : ""}"></label>
          <label class="field" style="flex:1;min-width:160px"><span>${t("up.new.place")}</span><input id="up-place" maxlength="80"></label></div>
        <label class="field"><span>${t("up.new.club")}</span><select id="up-club"><option value="">${t("up.new.club.none")}</option>
          ${clubs.map(([c, n]) => html`<option value="${c}" ${raw(c === myClub ? "selected" : "")}>${n} (${c})</option>`)}</select></label>
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <label class="field"><span>${t("f.terrain")}</span><select id="up-terrain">${TERRAINS.map(([v, k]) => html`<option value="${v}">${t(k)}</option>`)}</select></label>
          <label class="field"><span>${t("up.new.format")}</span><select id="up-format">${FORMATS.map((f) => html`<option value="${f}">${f === "Autre" ? t("up.new.other") : f}</option>`)}</select></label>
          <label class="check" style="align-self:flex-end;margin-bottom:8px"><input type="checkbox" id="up-cn"> ${t("up.new.cn")}</label></div>
      </div>
      <div id="up-date-warn" class="notice" hidden></div>
      <div id="up-again" hidden><label class="dropzone" style="min-height:0;padding:12px">
        <input type="file" id="up-file" hidden><strong>${t("dep.pub.again")} ${rec.name}</strong><span class="muted">${t("dep.pub.again.hint")}</span></label></div>
      <label class="check"><input type="checkbox" id="up-consent"> ${t("up.consent")}</label>
      <div class="row" style="gap:10px;align-items:center">
        <button type="button" class="btn btn-primary" id="up-send" disabled>${t("dep.pub.send")}</button>
        <progress id="up-progress" max="100" value="0" hidden style="flex:1"></progress></div>
      <div id="up-msg" role="status"></div>
      <p class="muted" style="font-size:12px;margin:0">${t("up.privacy")}</p>
    </div></section>`;

  const $c = (sel) => $(sel, container);
  const raceSel = $c("#up-race"), newBox = $c("#up-new");
  const raceDate = () => (raceSel.value === "__new" ? $c("#up-date").value : races.find((r) => r.key === raceSel.value)?.date_iso) || null;
  const ready = () => {
    $c("#up-again").hidden = !!local.file();
    const raceOk = raceSel.value && (raceSel.value !== "__new" || ($c("#up-name").value.trim().length >= 3 && $c("#up-date").value));
    $c("#up-send").disabled = !(raceOk && local.file() && $c("#up-consent").checked);
    const d = raceDate(), warn = $c("#up-date-warn");
    warn.hidden = !(fileDate && d && fileDate !== d);
    if (!warn.hidden) warn.textContent = `${t("up.date.diff")} (${fmtDate(fileDate)} / ${fmtDate(d)}).`;
  };
  raceSel.addEventListener("change", () => { newBox.hidden = raceSel.value !== "__new"; ready(); });
  newBox.addEventListener("input", ready);
  $c("#up-consent").addEventListener("change", ready);
  $c("#up-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f && !local.attach(f)) { $c("#up-msg").className = "notice"; $c("#up-msg").textContent = t("dep.pub.notSame"); }
    ready();
  });
  ready();

  $c("#up-send").addEventListener("click", () => {
    const file = local.file();
    const body = { filename: file.name, consent: true };
    if (raceSel.value === "__new") {
      body.new_race = { name: $c("#up-name").value.trim(), date: $c("#up-date").value, place: $c("#up-place").value.trim(),
        org_code: $c("#up-club").value, terrain: $c("#up-terrain").value, epreuve: $c("#up-format").value, cn: $c("#up-cn").checked };
    } else body.race = raceSel.value;
    const msg = $c("#up-msg"), bar = $c("#up-progress"), btn = $c("#up-send");
    btn.disabled = true;
    bar.hidden = false;
    msg.textContent = "";
    // XMLHttpRequest: the only way to follow an upload's progress
    const x = new XMLHttpRequest();
    x.open("POST", "/api/upload");
    x.setRequestHeader("X-Upload", encodeURIComponent(JSON.stringify(body)));
    x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable) bar.value = (100 * e.loaded) / e.total; };
    x.onload = () => {
      bar.hidden = true;
      let r = {};
      try { r = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
      if (x.status === 200 && r.ok) {
        msg.className = "notice ok";
        msg.innerHTML = html`${r.soon ? t("up.done.soon") : t("up.done.later")} <a href="#/recemment">${t("prov.title")} →</a>`;
        onDone(body);
        return;
      }
      msg.className = "notice";
      msg.textContent = t({ 413: "up.err.big", 415: "up.err.type", 429: "up.err.many", 401: "up.err.login" }[x.status]
        || (r.error === "race" || r.error === "unknown race" ? "up.err.race" : "up.err.other"));
      ready();
    };
    x.onerror = () => { bar.hidden = true; msg.className = "notice"; msg.textContent = t("up.err.other"); ready(); };
    x.send(file);
  });
  container.scrollIntoView({ behavior: "smooth", block: "start" });
}
