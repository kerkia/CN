// « Déposer des résultats » (on « Récemment »): an organiser sends their timing software's export for a race of the
// list, or for a race the site does not know yet (its name, date, place, club and format). Before anything is sent,
// the browser reads the file and says what it found — for an IOF XML list: the circuits, the runners, how many have
// split times and start times, the race's date (a different date is flagged) — so a wrong export is caught at once.
// The file goes as is to functions/api/upload.js (R2), and the provisional-results run reads it
// (ffco_scraper/prov/sources/upload.py); it is published within minutes, or at the next hourly run.

import { html, raw, $, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";

const MAX = 30 * 1024 * 1024;
const EXT = /\.(xml|html?|pdf|zip|gz|csv|txt)$/i;
const TERRAINS = [["Forêt", "terrain.For"], ["Sprint", "terrain.Spr"], ["VTT", "terrain.VTT"], ["Ski", "terrain.Ski"]];
const FORMATS = ["Sprint", "MD", "LD", "Nuit", "Autre"];
const day = (d) => d.toISOString().slice(0, 10);
const mb = (n) => `${fmt(n / 1024 / 1024, 1)} Mo`;

/** Reads the file in the browser: { level: "ok" | "warn" | "error", lines: [...], date }. */
async function inspect(file) {
  if (file.size > MAX) return { level: "error", lines: [t("up.err.big")] };
  if (!EXT.test(file.name)) return { level: "error", lines: [t("up.err.type")] };
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return { level: "warn", lines: [t("up.pdf")] };
  if (name.endsWith(".zip") || name.endsWith(".gz")) return { level: "ok", lines: [t("up.zip")] };
  const text = await file.text();
  if (name.endsWith(".xml") || /^\s*<\?xml/.test(text)) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return { level: "error", lines: [t("up.xml.bad")] };
    const root = doc.documentElement.localName;
    if (/StartList/i.test(root)) return { level: "error", lines: [t("up.xml.start")] };
    if (!/ResultList/i.test(root)) return { level: "error", lines: [t("up.xml.other")] };
    const all = (tag) => [...doc.getElementsByTagNameNS("*", tag)];
    const classes = all("ClassResult").length, people = all("PersonResult");
    const split = people.filter((p) => p.getElementsByTagNameNS("*", "SplitTime").length).length;
    const start = people.filter((p) => p.getElementsByTagNameNS("*", "StartTime").length).length;
    const ev = doc.getElementsByTagNameNS("*", "Event")[0];
    const d = (ev?.getElementsByTagNameNS("*", "Date")[0]?.textContent || ev?.getElementsByTagNameNS("*", "StartTime")[0]?.textContent || "").slice(0, 10);
    if (!people.length) return { level: "error", lines: [t("up.xml.empty")] };
    const lines = [`${t("up.xml.found")} ${fmt(classes)} ${t("up.circuits")}, ${fmt(people.length)} ${t("up.runners")}${d ? `, ${t("up.of")} ${fmtDate(d)}` : ""}.`,
      split ? `${t("up.splits")} ${fmt(split)} ${t("up.runners")}${start ? `, ${t("up.starts")} ${fmt(start)}` : ""}.` : t("up.nosplits")];
    return { level: split ? "ok" : "warn", lines, date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null };
  }
  // an HTML or text export: the server reads it; here, a few checks
  const low = text.toLowerCase();
  const soft = /meos/.test(low) ? "MeOS" : /oe20|oe12|sportsoftware|os20|os12/.test(low) ? "OE / OS" : /helga/.test(low) ? "Helga" : "";
  const times = (text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).length;
  if (/(liste|horaires?) de d[ée]part|start ?list/.test(low) && !/r[ée]sultat|result/.test(low)) return { level: "error", lines: [t("up.html.start")] };
  if (times < 10) return { level: "warn", lines: [t("up.html.notimes")] };
  return { level: "ok", lines: [`${t("up.html")}${soft ? ` (${soft})` : ""} : ${t("up.html.read")}`,
    /inter|split|temps interm/i.test(low) ? t("up.html.splits") : t("up.html.nosplits")] };
}

/**
 * The form, in `container`. races: the list's races (index.json); preset: a race's key to choose first.
 */
export function uploadCard(container, { races, preset = "", onClose = () => {} }) {
  const myClub = auth.myClub();
  const meta = data.meta();
  const clubs = Object.entries(meta?.names?.clubs || {}).sort((a, b) => a[1].localeCompare(b[1], "fr"));
  const today = new Date(), from = new Date(Date.now() - 60 * 86400e3);
  const sorted = [...races].sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name, "fr"));
  const mine = myClub ? sorted.filter((r) => (r.org || "").startsWith(myClub)) : [];
  const opt = (r) => html`<option value="${r.key}" ${raw(r.key === preset ? "selected" : "")}>${fmtDate(r.date_iso, "short")} · ${r.name}${r.place ? ` · ${r.place}` : ""}</option>`;
  let file = null, check = null;

  container.innerHTML = html`<section class="card upload-card" style="margin-bottom:16px">
    <div class="card-head"><div><h2>${t("up.title")}</h2><div class="hint">${t("up.lede")}</div></div>
      <button type="button" class="btn btn-sm" id="up-close" aria-label="${t("up.close")}">✕</button></div>
    <div class="card-body upload-grid">
      <div class="upload-form">
        <label class="field"><span>${t("up.race")}</span><select id="up-race" required>
          <option value="">${t("up.race.pick")}</option>
          ${mine.length ? html`<optgroup label="${t("up.race.mine")}">${mine.map(opt)}</optgroup>` : ""}
          <optgroup label="${t("up.race.all")}">${sorted.filter((r) => !mine.includes(r)).map(opt)}</optgroup>
          <option value="__new">${t("up.race.new")}</option></select></label>
        <div id="up-new" class="upload-new" hidden>
          <label class="field"><span>${t("up.new.name")}</span><input id="up-name" maxlength="120" placeholder="${t("up.new.name.ph")}"></label>
          <div class="row" style="gap:10px;flex-wrap:wrap">
            <label class="field"><span>${t("f.date")}</span><input type="date" id="up-date" min="${day(from)}" max="${day(today)}"></label>
            <label class="field" style="flex:1;min-width:160px"><span>${t("up.new.place")}</span><input id="up-place" maxlength="80"></label></div>
          <label class="field"><span>${t("up.new.club")}</span><select id="up-club"><option value="">${t("up.new.club.none")}</option>
            ${clubs.map(([c, n]) => html`<option value="${c}" ${raw(c === myClub ? "selected" : "")}>${n} (${c})</option>`)}</select></label>
          <div class="row" style="gap:10px;flex-wrap:wrap">
            <label class="field"><span>${t("f.terrain")}</span><select id="up-terrain">${TERRAINS.map(([v, k]) => html`<option value="${v}">${t(k)}</option>`)}</select></label>
            <label class="field"><span>${t("up.new.format")}</span><select id="up-format">${FORMATS.map((f) => html`<option value="${f}">${f === "Autre" ? t("up.new.other") : f}</option>`)}</select></label>
            <label class="check" style="align-self:flex-end;margin-bottom:8px"><input type="checkbox" id="up-cn"> ${t("up.new.cn")}</label></div>
        </div>
        <label class="dropzone" id="up-drop">
          <input type="file" id="up-file" accept=".xml,.html,.htm,.pdf,.zip,.gz,.csv,.txt" hidden>
          <strong id="up-file-name">${t("up.drop")}</strong><span class="muted">${t("up.drop.hint")}</span></label>
        <div id="up-check" class="upload-check" hidden></div>
        <label class="check"><input type="checkbox" id="up-consent"> ${t("up.consent")}</label>
        <div class="row" style="gap:10px;align-items:center">
          <button type="button" class="btn btn-primary" id="up-send" disabled>${t("up.send")}</button>
          <progress id="up-progress" max="100" value="0" hidden style="flex:1"></progress></div>
        <div id="up-msg" role="status"></div>
        <p class="muted" style="font-size:12px;margin:0">${t("up.privacy")}</p>
      </div>
      <div class="upload-help prose">
        <h3>${t("up.help.title")}</h3>
        <p><strong>${t("up.help.best")}</strong> ${t("up.help.best.text")}</p>
        <p>${t("up.help.soft")}</p>
        <p><strong>${t("up.help.else")}</strong> ${t("up.help.else.text")}</p>
        <p><strong>${t("up.help.last")}</strong> ${t("up.help.last.text")}</p>
        <ul><li>${t("up.help.one")}</li><li>${t("up.help.circuit")}</li><li>${t("up.help.size")}</li><li>${t("up.help.replace")}</li></ul>
      </div>
    </div></section>`;

  const raceSel = $("#up-race", container), newBox = $("#up-new", container);
  const raceDate = () => (raceSel.value === "__new" ? $("#up-date", container).value : races.find((r) => r.key === raceSel.value)?.date_iso) || null;
  const ready = () => {
    const raceOk = raceSel.value && (raceSel.value !== "__new" || ($("#up-name", container).value.trim().length >= 3 && $("#up-date", container).value));
    $("#up-send", container).disabled = !(raceOk && file && check && check.level !== "error" && $("#up-consent", container).checked);
  };
  const showCheck = () => {
    const box = $("#up-check", container);
    if (!check) { box.hidden = true; return; }
    const lines = [...check.lines];
    const d = raceDate();
    if (check.date && d && check.date !== d) lines.push(`${t("up.date.diff")} (${fmtDate(check.date)} / ${fmtDate(d)}).`);
    box.className = `upload-check ${check.level}`;
    box.innerHTML = html`${lines.map((l) => html`<div>${l}</div>`)}`;
    box.hidden = false;
  };
  const pick = async (f) => {
    file = f;
    $("#up-file-name", container).textContent = f ? `${f.name} — ${mb(f.size)}` : t("up.drop");
    check = f ? await inspect(f) : null;
    showCheck();
    ready();
  };
  raceSel.addEventListener("change", () => { newBox.hidden = raceSel.value !== "__new"; showCheck(); ready(); });
  newBox.addEventListener("input", () => { showCheck(); ready(); });
  $("#up-file", container).addEventListener("change", (e) => pick(e.target.files[0] || null));
  const drop = $("#up-drop", container);
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0] || null); });
  $("#up-consent", container).addEventListener("change", ready);
  $("#up-close", container).addEventListener("click", () => { container.innerHTML = ""; onClose(); });
  if (preset) raceSel.dispatchEvent(new Event("change"));

  $("#up-send", container).addEventListener("click", () => {
    const body = { filename: file.name, consent: true };
    if (raceSel.value === "__new") {
      body.new_race = { name: $("#up-name", container).value.trim(), date: $("#up-date", container).value,
        place: $("#up-place", container).value.trim(), org_code: $("#up-club", container).value,
        terrain: $("#up-terrain", container).value, epreuve: $("#up-format", container).value, cn: $("#up-cn", container).checked };
    } else body.race = raceSel.value;
    const msg = $("#up-msg", container), bar = $("#up-progress", container), btn = $("#up-send", container);
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
        msg.textContent = r.soon ? t("up.done.soon") : t("up.done.later");
        file = null; check = null;
        $("#up-file-name", container).textContent = t("up.drop");
        $("#up-check", container).hidden = true;
        $("#up-file", container).value = "";
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
