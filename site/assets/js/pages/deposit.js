// « Déposer » (#/deposer, from « Récemment »): an organiser's results file, in three steps.
// 1. The file, with what to export: dropped here, it is read in the browser (localparse.js) — nothing is sent.
// 2. What it holds: the circuits, runners, split and start times, the results circuit by circuit, and every analysis
//    of « Temps intermédiaires » on it (#/temps-inter?course=fichier) — to look at a race privately, before or
//    without publishing. The file stays in the tab's session (local.js) until the tab is closed or the account logs out.
// 3. Only then, if the organiser wishes: « Publier sur O'CN » (upload.js) — the race, the consent, the send.
// A PDF cannot be read in the browser: it goes straight to step 3, and the site reads it on reception.

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as local from "../local.js";
import { readFile } from "../localparse.js";
import { publishCard, mb } from "./upload.js";
import { getProv, clock, STATUS } from "./provisional.js";
import { replaceQuery } from "../app.js";

const MAX = 30 * 1024 * 1024;
const EXT = /\.(xml|html?|pdf|zip|gz|txt)$/i;
const KINDS = { iofxml: "IOF XML", oe_html: "OE / OS (HTML)", meos_html: "MeOS (HTML)" };

export async function render(main, { query = {} } = {}) {
  const idx = await getProv("index.json");
  const races = idx?.races || [];
  const preset = races.some((r) => r.key === query.course) ? query.course : "";
  let di = 0, ci = 0, publishing = query.publier === "1", sessionNote = "";

  main.innerHTML = html`
    <div class="crumbs"><a href="#/recemment">${t("prov.title")}</a><span>›</span><span>${t("dep.title")}</span></div>
    <div class="page-head"><div><h1>${t("dep.title")}</h1><p class="lede">${t("dep.lede")}</p></div></div>
    <ol class="dep-steps" id="dep-steps"></ol>
    <div id="dep-body"></div>
    <div id="dep-pub"></div>`;

  const steps = (n) => {
    $("#dep-steps").innerHTML = html`${[t("dep.s1"), t("dep.s2"), t("dep.s3")].map((s, i) => html`<li class="${i + 1 < n ? "done" : i + 1 === n ? "now" : ""}"><b>${i + 1}</b> ${s}</li>`)}`;
  };

  function draw() {
    const rec = local.get();
    if (rec) shown(rec); else ask();
  }

  // ---- 1. the file -------------------------------------------------------------------------------------------
  function ask(error = "") {
    steps(1);
    $("#dep-pub").innerHTML = "";
    $("#dep-body").innerHTML = html`<section class="card"><div class="card-body upload-grid">
      <div class="upload-form">
        <label class="dropzone" id="dep-drop" style="min-height:180px">
          <input type="file" id="dep-file" accept=".xml,.html,.htm,.pdf,.zip,.gz,.txt" hidden>
          <strong id="dep-file-name">${t("dep.drop")}</strong><span class="muted">${t("up.drop.hint")}</span></label>
        ${error ? html`<div class="notice">${error}</div>` : ""}
        <p class="muted" style="font-size:13px;margin:0">${t("dep.private")}</p>
      </div>
      <div class="upload-help prose">
        <h3>${t("up.help.title")}</h3>
        <p><strong>${t("up.help.best")}</strong> ${t("up.help.best.text")}</p>
        <p>${t("up.help.soft")}</p>
        <p><strong>${t("up.help.else")}</strong> ${t("up.help.else.text")}</p>
        <p><strong>${t("up.help.last")}</strong> ${t("dep.help.pdf")}</p>
        <ul><li>${t("up.help.one")}</li><li>${t("up.help.circuit")}</li><li>${t("up.help.size")}</li><li>${t("up.help.replace")}</li></ul>
      </div></div></section>`;
    $("#dep-file").addEventListener("change", (e) => e.target.files[0] && take(e.target.files[0]));
    const drop = $("#dep-drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
  }

  async function take(file) {
    if (file.size > MAX) return ask(t("up.err.big"));
    if (!EXT.test(file.name)) return ask(t("up.err.type"));
    $("#dep-file-name").textContent = `${file.name} — ${t("dep.reading")}`;
    let read;
    try { read = await readFile(file); } catch (e) { read = { docs: [], pdf: false, unread: [file.name] }; }
    const kept = local.set(file, read);
    di = 0; ci = 0;
    publishing = false;
    if (!kept) sessionNote = t("dep.notKept");
    draw();
  }

  // ---- 2. what it holds ------------------------------------------------------------------------------------------
  function shown(rec) {
    steps(publishing ? 3 : 2);
    const docs = rec.docs || [];
    const runners = (d) => d.classes.flatMap((k) => k.runners);
    const withSplits = docs.some((d) => d.classes.some((k) => k.runners.some((r) => r.splits)));
    const notes = [];
    if (!docs.length) notes.push(rec.pdf ? t("dep.pdf") : t("dep.unread"));
    else if (!withSplits) notes.push(t("dep.noSplits"));
    if (docs.length && docs.every((d) => d.by === "category")) notes.push(t("dep.byCategory"));
    if (sessionNote) notes.push(sessionNote);
    $("#dep-body").innerHTML = html`<section class="card">
      <div class="card-head"><div><h2>${rec.name}</h2><div class="hint">${mb(rec.size)} · ${t("dep.readHere")}</div></div>
        <div class="row" style="gap:8px">
          ${withSplits ? html`<a class="btn btn-sm btn-primary" href="#/temps-inter?course=${local.LOCAL}">${t("spl.title")} →</a>` : ""}
          <button type="button" class="btn btn-sm" id="dep-change">${t("dep.change")}</button>
          <button type="button" class="btn btn-sm" id="dep-forget">${t("dep.forget")}</button></div></div>
      ${docs.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>${t("dep.doc")}</th><th>${t("prov.format")}</th>
        <th>${t("f.date")}</th><th class="r">${t("prov.classes")}</th><th class="r">${t("prov.runners")}</th>
        <th class="r">${t("dep.withSplits")}</th><th class="r">${t("dep.withStarts")}</th></tr></thead>
        <tbody>${docs.map((d) => { const rs = runners(d); return html`<tr>
          <td>${d.title || d.url}${docs.length > 1 ? html`<div class="muted" style="font-size:12px">${d.url}</div>` : ""}</td>
          <td>${KINDS[d.kind] || d.kind} <span class="muted">· ${t(`prov.by.${d.by}`)}</span></td>
          <td class="num">${d.date ? fmtDate(d.date) : "—"}</td>
          <td class="r num">${fmt(d.classes.length)}</td><td class="r num">${fmt(rs.length)}</td>
          <td class="r num">${fmt(rs.filter((r) => r.splits).length)}</td><td class="r num">${fmt(rs.filter((r) => r.start_s != null).length)}</td></tr>`; })}</tbody></table></div>` : ""}
      ${notes.length ? html`<div class="card-body">${notes.map((n) => html`<div class="notice" style="margin-bottom:6px">${n}</div>`)}</div>` : ""}
    </section>
    ${docs.length ? html`<div class="filters" id="dep-pick" style="margin-top:16px"></div>
      <section class="card"><div class="card-head"><div><h2 id="dep-class-title"></h2><div class="hint" id="dep-class-hint"></div></div></div>
        <div class="table-wrap" id="dep-class"></div></section>` : ""}
    <section class="card dep-publish" style="margin-top:16px"><div class="card-body row" style="gap:14px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:260px"><strong>${t("dep.pub.ask")}</strong><div class="muted" style="font-size:13px">${t("dep.pub.askHint")}</div></div>
      <button type="button" class="btn btn-primary" id="dep-pub-open">${t("dep.pub.open")}</button></div></section>`;
    $("#dep-change").addEventListener("click", () => { local.clear(); sessionNote = ""; replaceQuery({ course: preset || null }); ask(); $("#dep-file").click(); });
    $("#dep-forget").addEventListener("click", () => { local.clear(); sessionNote = ""; replaceQuery({ course: preset || null }); ask(); });
    $("#dep-pub-open").addEventListener("click", openPublish);
    if (docs.length) results(docs);
    if (publishing || !docs.length) openPublish();
  }

  function results(docs) {
    di = Math.min(di, docs.length - 1);
    const d = docs[di];
    ci = Math.min(ci, d.classes.length - 1);
    const k = d.classes[ci];
    const splitLink = `#/temps-inter?course=${local.LOCAL}${di ? `&doc=${docs.filter((x) => x.classes.some((c) => c.runners.some((r) => r.splits))).indexOf(d)}` : ""}${ci ? `&c=${ci}` : ""}`;
    $("#dep-pick").innerHTML = html`
      ${docs.length > 1 ? html`<label class="field"><span>${t("dep.doc")}</span><select id="dep-doc" style="max-width:360px">${docs.map((x, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${x.title || x.url}</option>`)}</select></label>` : ""}
      <label class="field"><span>${d.by === "category" ? t("prov.category") : t("prov.circuit")}</span><select id="dep-c">${d.classes.map((x, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")}>${x.name} (${x.runners.length})</option>`)}</select></label>
      ${k.runners.some((r) => r.splits) ? html`<a class="btn btn-sm" style="align-self:flex-end" href="${splitLink}">${t("spl.ofClass")} →</a>` : ""}`;
    $("#dep-doc")?.addEventListener("change", (e) => { di = Number(e.target.value); ci = 0; results(docs); });
    $("#dep-c").addEventListener("change", (e) => { ci = Number(e.target.value); results(docs); });
    $("#dep-class-title").textContent = `${k.name} · ${k.runners.length} ${t("prov.runners").toLowerCase()}`;
    $("#dep-class-hint").textContent = [k.length_m ? `${fmt(k.length_m / 1000, 1)} km` : "", k.climb_m ? `${fmt(k.climb_m)} m D+` : "",
      k.controls ? `${k.controls.length} ${t("prov.controls")}` : ""].filter(Boolean).join(" · ");
    $("#dep-class").innerHTML = html`<table class="data compact"><thead><tr><th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th>
      <th>${t("prov.club")}</th><th>${t("prov.cat")}</th><th class="r">${t("prov.time")}</th></tr></thead>
      <tbody>${k.runners.map((r) => html`<tr><td class="r num">${r.place ?? ""}</td><td>${r.name}</td><td style="font-size:12.5px">${r.club || ""}</td>
        <td>${r.category || ""}</td><td class="r num">${r.status === "ok" ? clock(r.time_s) : STATUS[r.status]}</td></tr>`)}</tbody></table>`;
  }

  // ---- 3. publish ----------------------------------------------------------------------------------------------------
  function openPublish() {
    publishing = true;
    steps(3);
    const box = $(".dep-publish");
    if (box) box.hidden = true;
    replaceQuery({ course: preset || null, publier: "1" });
    publishCard($("#dep-pub"), { races, preset, onDone: () => { $$("#dep-steps li").forEach((li) => li.classList.add("done")); } });
  }

  draw();
  return { title: t("dep.title") };
}
