// « Analyse multi » (owner, 2026-10-15; « Analyse club » / « Analyse compétition » before): for the runners, under
// « Entrainement » (#/analyse-club: training events) and « Courses » (#/analyse-competition: competitions), the events
// their organisers have set up — pick one, add one's trace, compare; one's own curves (heart rate, cadence…) beside the
// map, from one's own file kept on this device, never sent and never shown to others. For the organisers, under
// « Organisation » (#/orga-competitions: the competitions of their club, one analysis each; #/orga-entrainements: their
// training events), the same pages manage them. An organiser sets up one or more circuits — the map, its georeference (a KMZ/KML, a world file, an IOF
// XML with coordinates, or the organiser's own GPS trace laid over the controls read on the map), the controls in
// order — and chooses who may open the analysis (every logged-in account, the members of the organiser's club, or a
// password). Each runner then adds their own trace (positions and times only, cropped to the map's area), and the
// traces are replayed together as Livelox does: clock time, mass start, a mass start from any control, or waiting at
// every control; follow everyone, one runner or no one; a leg view (every runner's route on one leg, with time,
// distance, pace and rank) stepped leg by leg; the splits table, against a chosen runner (the duel). For a
// competition, the runners' published results stand beside their traces. Stored by /api/analyses (R2).

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { getProv, clock } from "./provisional.js";
import { parseTrace, isTraceName, indexAt, posAt, cumAt } from "../trace/track.js";
import { toPx, fitSimilarity } from "../trace/geom.js";
import { detectCourse } from "../trace/course.js";
import { alignTrack, visitOrder } from "../trace/align.js";
import { readZip, parseKml, fitFromKml, isWorldFileName, parseWorldFile, crsFromWkt, guessCrs, fitFromWorld, parseIofCourse, projector } from "../trace/georef.js";
import { readMap, isImage, imageBlob } from "../trace/mapfile.js";
import { encodeTrace, decodeTrace, cropToMap, geoFromFit, fitFromGeo, frameAt, validGeo, coursePasses } from "../trace/share.js";
import { mapView } from "../trace/mapview.js";
import { drawCurves, curveRows } from "../trace/curves.js";
import { buttons as fwButtons, bindFull, setFull, leaveFull, inOwnTab } from "../fullwin.js";
import { betaNotice, betaTag, betaNote } from "../beta.js";

const ROUTE = { club: "#/analyse-club", race: "#/analyse-competition" };          // the runners' pages
const ORG_ROUTE = { club: "#/orga-entrainements", race: "#/orga-competitions" };  // the organisers' pages
/** The club number (4 digits) of a race's organiser ("0109 - O'BUGEY"), as the server's _lib/club.js. */
const orgCode = (org) => { const m = /^\s*(\d{3,4})\b/.exec(String(org || "")); return m ? m[1].padStart(4, "0") : null; };
// one's own file, kept on this device for one's own curves (the same IndexedDB as « Analyse solo »)
const IDB = "ocn-analyse", STORE = "files";
const idb = (mode, fn) => new Promise((res, rej) => {
  const q = indexedDB.open(IDB, 1);
  q.onupgradeneeded = () => q.result.createObjectStore(STORE);
  q.onerror = () => rej(q.error);
  q.onsuccess = () => { const db = q.result, tx = db.transaction(STORE, mode), r = fn(tx.objectStore(STORE)); tx.oncomplete = () => { db.close(); res(r?.result); }; tx.onerror = () => { db.close(); rej(tx.error); }; };
});
const ownKey = (id, n) => `own:${id}:${n}`;
const ownGet = (k) => idb("readonly", (s) => s.get(k)).catch(() => null);
const ownPut = (k, v) => idb("readwrite", (s) => s.put(v, k)).catch(() => null);
const ownDel = (k) => idb("readwrite", (s) => s.delete(k)).catch(() => null);
const COLOURS = ["#e6194b", "#1f77b4", "#2ca02c", "#ff7f0e", "#17becf", "#8c564b", "#d62728", "#bcbd22", "#0b3d91", "#f032e6", "#008080", "#7f7f7f"];
const SPEEDS = [1, 2, 5, 10, 20, 40, 60, 80, 100];        // every x20 past x20 (owner, 2026-10-15)
const TAILS = [30, 60, 120, 300, 0];
const COURSE = "#a626a4";
const TOL = 25;                                           // metres: a control reached
const MAX_MAP = 80 * 1024 * 1024;                         // bytes: a map file at most (the server's limit)
const WIDTHS = [[1, "an.width.thin"], [1.6, "an.width.normal"], [2.4, "an.width.thick"], [3.5, "an.width.thicker"]];   // × 2 px
const PREFS_KEY = "ocn.sh.prefs";                         // the replay's display settings, kept on the device
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } };
const signed = (s) => (s == null ? "—" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);
const pace = (v) => (v > 0.05 ? `${Math.floor(1000 / v / 60)}'${String(Math.round((1000 / v) % 60)).padStart(2, "0")}` : "—");
const hms = (sec) => new Date(sec * 1000).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);
const keyOf = (id) => { try { return sessionStorage.getItem(`ocn.an.key.${id}`) || ""; } catch (e) { return ""; } };
const setKey = (id, k) => { try { sessionStorage.setItem(`ocn.an.key.${id}`, k); } catch (e) { /* this visit only */ } };

async function api(path, { method = "GET", body, type, key } = {}) {
  const headers = {};
  if (key) headers["X-Analysis-Key"] = key;
  let payload;
  if (body instanceof Blob) { payload = body; headers["Content-Type"] = type || body.type || "application/octet-stream"; }
  else if (body != null) { payload = JSON.stringify(body); headers["Content-Type"] = "application/json"; }
  const r = await fetch(`api/analyses${path}`, { method, headers, body: payload, credentials: "same-origin" });
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json().catch(() => null) : r.ok ? await r.blob() : null;
  if (!r.ok) { const e = new Error(data?.error || `http ${r.status}`); e.status = r.status; e.code = data?.error; throw e; }
  return data;
}
const errText = (e) => t(`sh.err.${e?.code}`) !== `sh.err.${e?.code}` ? t(`sh.err.${e.code}`) : `${t("sh.err.other")} (${e?.code || e?.message || ""})`;

export async function render(main, r) {
  bindFull();
  if (inOwnTab()) setFull(true);                         // a tab opened alone by « ↗ »: the map page without the site's bar
  const org = r.route === "orgRace" || r.route === "orgTraining";
  const kind = r.route === "analysisRace" || r.route === "orgRace" ? "race" : "club";
  betaNotice("multi");                                    // beta.js (owner, 2026-10-16): little tested yet
  if (org) return r.query.id ? eventPage(main, kind, r.query.id, true) : orgListPage(main, kind);
  return r.query.id ? eventPage(main, kind, r.query.id, false) : listPage(main, kind);
}

// ---- the list ----------------------------------------------------------------------------------------------------
async function listPage(main, kind) {
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t(`sh.${kind}.title`)} ${raw(betaTag())}</h1><p class="lede">${t(`sh.${kind}.lede`)}</p></div></div>
    ${raw(betaNote("multi"))}
    <section class="card"><div class="table-wrap" id="sh-list"><div class="empty">${t("misc.loading")}</div></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("sh.privacy")}</p>
    <p class="muted" style="font-size:12.5px;margin:6px 2px 0">${t(`sh.${kind}.orgHint`)} <a href="${ORG_ROUTE[kind]}">${t("nav.g.orga")} › ${t(kind === "race" ? "nav.orgRace" : "nav.orgTraining")} →</a></p>`;
  let data;
  try { data = await api(`?kind=${kind}`); } catch (e) { $("#sh-list").innerHTML = html`<div class="empty">${errText(e)}</div>`; return { title: t(`sh.${kind}.title`) }; }
  const races = kind === "race" ? ((await getProv("index.json"))?.races || []).filter((x) => x.docs && !x.soon).sort((a, b) => b.date_iso.localeCompare(a.date_iso)) : [];
  const raceName = (k) => races.find((x) => x.key === k)?.name || "";
  const rows = data.analyses.filter((a) => a.courses > 0);          // ready: the organiser has set its maps and circuits
  $("#sh-list").innerHTML = rows.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("sh.col.title")}</th>
      ${kind === "race" ? html`<th>${t("prov.race")}</th>` : ""}<th>${t("sh.col.owner")}</th><th>${t("sh.col.access")}</th><th class="r">${t("sh.col.courses")}</th></tr></thead>
    <tbody>${rows.map((a) => html`<tr><td class="num">${fmtDate(a.date, "short")}</td>
      <td><a href="${ROUTE[kind]}?id=${a.id}">${a.title}</a>${a.organiser ? html` <span class="tag">${t("sh.mine")}</span>` : ""}</td>
      ${kind === "race" ? html`<td>${raceName(a.race)}</td>` : ""}<td>${a.ownerName || "—"}</td>
      <td>${t(`sh.vis.${a.vis}`)}${a.access === "locked" ? " 🔒" : ""}</td><td class="r num">${a.courses}</td></tr>`)}</tbody></table>`
    : html`<div class="empty">${t(`sh.${kind}.none`)}</div>`;
  return { title: t(`sh.${kind}.title`) };
}

// ---- the organisers' list: their club's competitions (one analysis each), or their training events ----------------
async function orgListPage(main, kind) {
  const me = auth.session();
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t(`sh.org.${kind}.title`)} ${raw(betaTag())}</h1><p class="lede">${t(`sh.org.${kind}.lede`)}</p></div>
      ${kind === "club" ? html`<button type="button" class="btn btn-sm btn-primary" id="sh-new">${t("sh.org.new")}</button>` : ""}</div>
    ${raw(betaNote("multi"))}
    <section class="card sh-create" id="sh-create" hidden></section>
    ${kind === "race" && me?.admin ? html`<div class="filters"><label class="field"><span>${t("sh.org.filter")}</span><input id="sh-filter" placeholder="${t("sh.org.filter.ph")}" style="width:240px"></label></div>` : ""}
    <section class="card"><div class="table-wrap" id="sh-list"><div class="empty">${t("misc.loading")}</div></div></section>
    <p class="muted" style="font-size:12.5px;margin:6px 2px 0" id="sh-storage"></p>`;
  let data;
  try { data = await api(`?kind=${kind}`); } catch (e) { $("#sh-list").innerHTML = html`<div class="empty">${errText(e)}</div>`; return { title: t(`sh.org.${kind}.title`) }; }
  const club = data.club;
  if (kind === "race") {
    // the competitions of the last 60 days organised by one's club (all of them for an administrator)
    const today = new Date().toISOString().slice(0, 10);
    const all = ((await getProv("index.json"))?.races || []).filter((x) => x.docs && !x.soon && x.date_iso <= today)
      .sort((a, b) => b.date_iso.localeCompare(a.date_iso) || a.name.localeCompare(b.name, "fr"));
    const mine = me?.admin ? all : all.filter((x) => club && orgCode(x.org) === club);
    const byRace = new Map(data.analyses.map((a) => [a.race, a]));
    const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const draw = (q = "") => {
      const list = q ? mine.filter((x) => norm(`${x.name} ${x.org || ""} ${x.place || ""}`).includes(norm(q))) : mine;
      $("#sh-list").innerHTML = list.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("sh.org.col.org")}</th><th>${t("sh.org.col.status")}</th><th></th></tr></thead>
        <tbody>${list.map((x) => { const a = byRace.get(x.key);
          return html`<tr><td class="num">${fmtDate(x.date_iso, "short")}</td><td>${x.name}${x.place ? html` <span class="muted">· ${x.place}</span>` : ""}</td>
            <td class="muted">${x.org || "—"}</td>
            <td>${a ? t("sh.org.status.n", { n: a.courses }) : html`<span class="muted">${t("sh.org.status.none")}</span>`}</td>
            <td class="r">${a ? html`<a class="btn btn-sm" href="${ORG_ROUTE.race}?id=${a.id}">${t("sh.org.manage")}</a>` : html`<button type="button" class="btn btn-sm btn-primary" data-activate="${x.key}">${t("sh.org.activate")}</button>`}</td></tr>`; })}</tbody></table>`
        : html`<div class="empty">${club || me?.admin ? t("sh.org.race.none", { club: club || "—" }) : t("sh.org.noclub")}</div>`;
      $$("[data-activate]").forEach((b) => b.addEventListener("click", async () => {
        const x = mine.find((r) => r.key === b.dataset.activate);
        b.disabled = true;
        try { const r = await api("", { method: "POST", body: { kind: "race", race: x.key, title: x.name, date: x.date_iso, vis: "public" } }); location.hash = `${ORG_ROUTE.race}?id=${r.id}`; }
        catch (e) { b.disabled = false; alert(errText(e)); }
      }));
    };
    draw();
    $("#sh-filter")?.addEventListener("input", (e) => draw(e.target.value));
  } else {
    const mine = data.analyses.filter((a) => a.organiser);
    $("#sh-list").innerHTML = mine.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("sh.col.title")}</th><th>${t("sh.col.access")}</th><th class="r">${t("sh.col.courses")}</th><th></th></tr></thead>
      <tbody>${mine.map((a) => html`<tr><td class="num">${fmtDate(a.date, "short")}</td><td>${a.title}</td><td>${t(`sh.vis.${a.vis}`)}</td><td class="r num">${a.courses}</td>
        <td class="r"><a class="btn btn-sm" href="${ORG_ROUTE.club}?id=${a.id}">${t("sh.org.manage")}</a></td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("sh.org.club.none")}</div>`;
    $("#sh-new").addEventListener("click", () => {
      const box = $("#sh-create");
      box.hidden = !box.hidden;
      if (!box.hidden) createForm(box, "club", [], club);
    });
  }
  if (me?.admin) {
    const mb = (b) => (b >= 1e9 ? `${fmt(b / 1e9, 2)} Go` : `${fmt(b / 1e6, 1)} Mo`);
    api("?stats=1").then((st) => { $("#sh-storage").textContent = t("sh.storage", { used: mb(st.bytes), an: mb(st.analyses), maps: st.maps, traces: st.traces }); }).catch(() => {});
  }
  return { title: t(`sh.org.${kind}.title`) };
}

function createForm(box, kind, races, club) {
  box.innerHTML = html`<div class="card-body"><h2 style="font-size:16px;margin:0 0 10px">${t(kind === "club" ? "sh.org.new" : "sh.new")}</h2>
    <div class="filters" style="align-items:flex-end">
      ${kind === "race" ? html`<label class="field"><span>${t("prov.race")}</span><select id="sh-race" style="max-width:420px">${races.map((x) => html`<option value="${x.key}" data-date="${x.date_iso}" data-name="${x.name}">${fmtDate(x.date_iso, "short")} · ${x.name}</option>`)}</select></label>` : ""}
      <label class="field"><span>${t("sh.col.title")}</span><input id="sh-title" style="width:280px" maxlength="120"></label>
      <label class="field"><span>${t("f.date")}</span><input type="date" id="sh-date" value="${today()}"></label></div>
    <fieldset class="sh-vis"><legend>${t("sh.col.access")}</legend>
      <label><input type="radio" name="sh-vis" value="public" checked> ${t("sh.vis.public.long")}</label>
      <label><input type="radio" name="sh-vis" value="club" ${raw(club ? "" : "disabled")}> ${t("sh.vis.club.long")}${club ? "" : html` <span class="muted">(${t("sh.noclub")})</span>`}</label>
      <label><input type="radio" name="sh-vis" value="password"> ${t("sh.vis.password.long")} <input type="text" id="sh-pw" placeholder="${t("sh.pw.ph")}" style="width:180px" autocomplete="off"></label></fieldset>
    <div class="row" style="gap:8px;margin-top:10px"><button type="button" class="btn btn-primary" id="sh-create-go">${t("sh.create")}</button><span class="muted" id="sh-create-note"></span></div></div>`;
  const fromRace = () => { const o = $("#sh-race")?.selectedOptions[0]; if (o) { $("#sh-title").value = o.dataset.name; $("#sh-date").value = o.dataset.date; } };
  if (kind === "race") { $("#sh-race").addEventListener("change", fromRace); fromRace(); } else $("#sh-title").value = t("sh.club.default", { d: fmtDate(today()) });
  $("#sh-create-go").addEventListener("click", async () => {
    const vis = $("input[name=sh-vis]:checked").value;
    const body = { kind, title: $("#sh-title").value, date: $("#sh-date").value, vis, password: $("#sh-pw").value, race: $("#sh-race")?.value };
    try { const r = await api("", { method: "POST", body }); if (vis === "password") setKey(r.id, ""); location.hash = `${ORG_ROUTE[kind]}?id=${r.id}`; }
    catch (e) { $("#sh-create-note").textContent = errText(e); }
  });
}

// ---- one analysis -------------------------------------------------------------------------------------------------
async function eventPage(main, kind, id, org = false) {
  const home = org ? ORG_ROUTE[kind] : ROUTE[kind], homeTitle = t(org ? `sh.org.${kind}.title` : `sh.${kind}.title`);
  main.innerHTML = html`<div class="boot"><div class="spinner"></div></div>`;
  let data;
  try { data = await api(`/${id}`, { key: keyOf(id) }); }
  catch (e) {
    if (e.code === "locked") return unlockPage(main, kind, id);
    main.innerHTML = html`<div class="crumbs"><a href="${home}">${homeTitle}</a></div><div class="card"><div class="empty">${errText(e)}</div></div>`;
    return { title: homeTitle };
  }
  const A = data.analysis, organiser = data.you.organiser;
  if (org && !organiser) {
    main.innerHTML = html`<div class="crumbs"><a href="${home}">${homeTitle}</a></div>
      <div class="card"><div class="empty">${t("sh.org.notOrg")} <a href="${ROUTE[kind]}?id=${id}">${t("sh.org.asRunner")} →</a></div></div>`;
    return { title: homeTitle };
  }
  let race = null;
  if (kind === "race" && A.race) race = await getProv(`${encodeURIComponent(A.race)}.json`);
  let courseN = A.courses[0]?.n ?? null, viewer = null;
  main.innerHTML = html`
    <div class="sh-top">
      <a class="btn btn-sm" href="${home}">← ${homeTitle}</a>
      <b class="sh-title">${A.title}</b>${raw(betaTag("Version bêta, encore peu testée : signalez les problèmes par « Nous écrire » (le menu de votre nom)"))}<span class="muted">${fmtDate(A.date)} · ${A.ownerName || "—"} · ${t(`sh.vis.${A.vis}`)}</span>
      ${race ? html`<a class="btn btn-sm" href="#/resultats?course=${encodeURIComponent(A.race)}">${t("sh.results")}</a>` : ""}
      <span class="sh-tabs" id="sh-tabs"></span>
      ${org ? html`<button type="button" class="btn btn-sm" id="sh-manage">${t("sh.manage")}</button> <a class="btn btn-sm" href="${ROUTE[kind]}?id=${id}">${t("sh.org.asRunner")}</a>`
        : organiser ? html`<a class="btn btn-sm" href="${ORG_ROUTE[kind]}?id=${id}">${t("sh.manage")}</a>` : ""}</div>
    <section class="card sh-setup" id="sh-setup" hidden></section>
    <div id="sh-viewer"></div>`;
  const drawTabs = () => {
    $("#sh-tabs").innerHTML = A.courses.length > 1 ? html`${A.courses.map((c) => html`<button type="button" class="an-chip" data-course="${c.n}" aria-pressed="${c.n === courseN}" style="--chip:${COURSE}">${c.name}</button>`)}` : "";
    $$("[data-course]").forEach((b) => b.addEventListener("click", () => { courseN = Number(b.dataset.course); drawTabs(); openViewer(); }));
  };
  const openViewer = async () => {
    viewer?.destroy();
    viewer = null;
    const c = A.courses.find((x) => x.n === courseN);
    if (!c) {
      document.body.classList.remove("an-theatre");
      $("#sh-viewer").innerHTML = html`<div class="card"><div class="empty">${t(org ? "sh.noCourse.org" : "sh.notReady")}</div></div>`;
      return;
    }
    viewer = await replay($("#sh-viewer"), { A, id, course: c, race, traces: data.traces.filter((x) => x.course === c.n), you: data.you, reload: async () => {
      data = await api(`/${id}`, { key: keyOf(id) }); openViewer(); } });
  };
  const reloadAll = async () => {
    data = await api(`/${id}`, { key: keyOf(id) }); Object.assign(A, data.analysis);
    if (!A.courses.some((c) => c.n === courseN)) courseN = A.courses[A.courses.length - 1]?.n ?? null;
    const s = $("#sh-setup");
    if (s && !s.hidden) setup(s, { A, id, kind, race, onChange: reloadAll });
    $(".sh-title").textContent = A.title;
    drawTabs(); openViewer();
  };
  if (org) {
    // the organisers' page opens on the settings and the circuits; the replay below shows what the runners will see
    $("#sh-manage").addEventListener("click", () => { const s = $("#sh-setup"); s.hidden = !s.hidden; if (!s.hidden) setup(s, { A, id, kind, race, onChange: reloadAll }); });
    $("#sh-setup").hidden = false; setup($("#sh-setup"), { A, id, kind, race, onChange: reloadAll });
  }
  drawTabs();
  await openViewer();
  return { title: A.title, cleanup: () => { viewer?.destroy(); document.body.classList.remove("an-theatre"); leaveFull(); } };
}

function unlockPage(main, kind, id) {
  main.innerHTML = html`<div class="crumbs"><a href="${ROUTE[kind]}">${t(`sh.${kind}.title`)}</a></div>
    <section class="card account-card" style="max-width:460px"><div class="card-body">
      <p>${t("sh.locked")}</p>
      <label class="field"><span>${t("sh.pw")}</span><input type="password" id="sh-unlock-pw" autocomplete="off"></label>
      <div class="row" style="gap:8px;margin-top:10px"><button type="button" class="btn btn-primary" id="sh-unlock">${t("sh.unlock")}</button><span class="muted" id="sh-unlock-note"></span></div></div></section>`;
  const go = async () => {
    try { const r = await api(`/${id}/unlock`, { method: "POST", body: { password: $("#sh-unlock-pw").value } }); setKey(id, r.key); eventPage(main, kind, id); }
    catch (e) { $("#sh-unlock-note").textContent = errText(e); }
  };
  $("#sh-unlock").addEventListener("click", go);
  $("#sh-unlock-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  return { title: t(`sh.${kind}.title`) };
}

// ---- the organiser: the analysis's settings, its circuits ------------------------------------------------------------
function setup(box, ctx) {
  const { A, id, onChange } = ctx;
  box.innerHTML = html`<div class="card-body">
    <h2 style="font-size:16px;margin:0 0 8px">${t("sh.settings")}</h2>
    <div class="filters" style="align-items:flex-end">
      <label class="field"><span>${t("sh.col.title")}</span><input id="sh-s-title" value="${A.title}" style="width:280px" maxlength="120"></label>
      <label class="field"><span>${t("f.date")}</span><input type="date" id="sh-s-date" value="${A.date}"></label>
      <label class="field"><span>${t("sh.col.access")}</span><select id="sh-s-vis">${["public", "club", "password"].map((v) => html`<option value="${v}" ${raw(v === A.vis ? "selected" : "")}>${t(`sh.vis.${v}.long`)}</option>`)}</select></label>
      <label class="field"><span>${t("sh.pw.new")}</span><input type="text" id="sh-s-pw" style="width:160px" autocomplete="off" placeholder="${A.vis === "password" ? t("sh.pw.keep") : ""}"></label>
      <button type="button" class="btn btn-sm" id="sh-s-save">${t("sh.save")}</button><span class="muted" id="sh-s-note"></span></div>
    <h2 style="font-size:16px;margin:14px 0 8px">${t("sh.courses")}</h2>
    <table class="data compact" style="max-width:720px"><tbody>
      ${A.courses.map((c) => html`<tr><td><b>${c.name}</b>${c.circuit ? html` <span class="muted">· ${c.circuit}</span>` : ""}</td>
        <td class="muted">${c.controls.filter((p) => p.kind === "control").length} ${t("prov.controls")}</td>
        <td><button type="button" class="btn btn-sm" data-edit="${c.n}">${t("sh.edit")}</button> <button type="button" class="btn btn-sm" data-del="${c.n}">${t("sh.remove")}</button></td></tr>`)}
    </tbody></table>
    <div class="row" style="gap:8px;margin-top:8px"><button type="button" class="btn btn-sm btn-primary" id="sh-add">${t("sh.course.add")}</button>
      <button type="button" class="btn btn-sm" id="sh-delete" style="margin-left:auto">${t("sh.delete")}</button></div>
    <div id="sh-editor"></div></div>`;
  $("#sh-s-save").addEventListener("click", async () => {
    const body = { title: $("#sh-s-title").value, date: $("#sh-s-date").value, vis: $("#sh-s-vis").value };
    if ($("#sh-s-pw").value) body.password = $("#sh-s-pw").value;
    try { await api(`/${id}`, { method: "PUT", body, key: keyOf(id) }); $("#sh-s-note").textContent = t("sh.saved"); onChange(); }
    catch (e) { $("#sh-s-note").textContent = errText(e); }
  });
  $("#sh-delete").addEventListener("click", async () => {
    if (!confirm(t("sh.delete.confirm"))) return;
    try { await api(`/${id}`, { method: "DELETE", key: keyOf(id) }); location.hash = ORG_ROUTE[ctx.kind]; } catch (e) { alert(errText(e)); }
  });
  $$("[data-del]", box).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("sh.course.remove.confirm"))) return;
    const n = Number(b.dataset.del);
    try { await api(`/${id}`, { method: "PUT", body: { courses: A.courses.filter((c) => c.n !== n) }, key: keyOf(id) }); onChange(); setup(box, ctx); }
    catch (e) { alert(errText(e)); }
  }));
  $$("[data-edit]", box).forEach((b) => b.addEventListener("click", () => editor($("#sh-editor"), { ...ctx, course: A.courses.find((c) => c.n === Number(b.dataset.edit)) })));
  $("#sh-add").addEventListener("click", () => editor($("#sh-editor"), { ...ctx, course: null }));
}

/** A circuit: its map, its georeference, its controls in order. */
async function editor(box, ctx) {
  const { A, id, race, course, onChange } = ctx;
  const circuits = race ? [...new Set((race.docs || []).filter((d) => d.by !== "category").flatMap((d) => (d.classes || []).map((k) => k.name)))] : [];
  const st = { name: course?.name || "", circuit: course?.circuit || "", image: null, mapFile: null, mapType: course?.map?.type || "image/jpeg",
    detect: null, geo: course?.geo || null, geoHow: course ? t("sh.geo.kept") : "", controls: course?.controls?.map((p) => ({ ...p })) || [], r: course?.r || 20,
    track: null, files: {}, iof: null, clicking: false, notes: [] };
  box.innerHTML = html`<div class="sh-editor">
    <h2 style="font-size:16px;margin:14px 0 8px">${course ? t("sh.course.edit", { c: course.name }) : t("sh.course.add")}</h2>
    <div class="filters" style="align-items:flex-end">
      <label class="field"><span>${t("sh.course.name")}</span><input id="sh-e-name" value="${st.name}" style="width:200px" maxlength="60"></label>
      ${circuits.length ? html`<label class="field"><span>${t("sh.course.circuit")}</span><select id="sh-e-circuit"><option value="">—</option>${circuits.map((c) => html`<option ${raw(c === st.circuit ? "selected" : "")}>${c}</option>`)}</select></label>` : ""}</div>
    <label class="dropzone an-drop" id="sh-e-drop"><input type="file" id="sh-e-in" multiple hidden accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.kmz,.kml,.jgw,.pgw,.tfw,.gfw,.wld,.prj,.xml,.gpx,.tcx,.fit,image/*,application/pdf">
      <strong>${t("sh.e.drop")}</strong><span class="muted">${t("sh.e.drop.hint")}</span></label>
    <div class="muted" id="sh-e-files" style="font-size:13px;margin:6px 0"></div>
    <div class="sh-e-work"><div class="sh-map sh-e-map"><canvas id="sh-e-canvas"></canvas>
        <div class="an-tools"><button type="button" class="btn btn-sm" id="sh-e-zin">+</button><button type="button" class="btn btn-sm" id="sh-e-zout">−</button><button type="button" class="btn btn-sm" id="sh-e-fit">▭</button></div></div>
      <aside class="sh-panel" id="sh-e-side"></aside></div>
    <label class="an-opt" style="margin-top:8px"><input type="checkbox" id="sh-e-consent"> ${t("sh.e.consent")}</label>
    <div class="row" style="gap:8px;margin-top:8px"><button type="button" class="btn btn-primary" id="sh-e-save">${t("sh.course.save")}</button>
      <button type="button" class="btn btn-sm" id="sh-e-cancel">${t("sh.cancel")}</button><span class="muted" id="sh-e-note"></span></div></div>`;
  const mv = mapView($("#sh-e-canvas"), {
    onDraw: (g, view, lw) => {
      if (st.track && validGeo(st.geo)) {
        const f = fitFromGeo(st.geo, st.track);
        g.strokeStyle = "#c8102e"; g.globalAlpha = 0.8; g.lineWidth = lw(2.5); g.beginPath();
        for (let i = 0; i < st.track.n; i += 1) { const [x, y] = toPx(f, st.track.x[i], st.track.y[i]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke(); g.globalAlpha = 1;
      }
      if (st.detect && !st.controls.length) { g.strokeStyle = "rgba(166,38,164,0.5)"; g.lineWidth = lw(1.5); for (const c of st.detect.controls) { g.beginPath(); g.arc(c.x, c.y, c.r * 1.15, 0, 2 * Math.PI); g.stroke(); } }
      drawCourse(g, st.controls, st.r, lw, 1);
    },
    onClick: (x, y) => {
      if (!st.clicking) return;
      // a click snaps to a circle read on the map
      const all = st.detect ? [...st.detect.controls, ...(st.detect.start ? [st.detect.start] : []), ...(st.detect.finish ? [st.detect.finish] : [])] : [];
      const near = all.map((c) => [Math.hypot(c.x - x, c.y - y), c]).sort((a, b) => a[0] - b[0])[0];
      const p = near && near[0] <= 1.3 * st.r ? { x: near[1].x, y: near[1].y } : { x, y };
      st.controls.push({ kind: "control", code: "", ...p });
      relabel(); labels(); side(); mv.draw();
    },
  });
  $("#sh-e-zin").addEventListener("click", () => mv.zoomBy(1.4));
  $("#sh-e-zout").addEventListener("click", () => mv.zoomBy(1 / 1.4));
  $("#sh-e-fit").addEventListener("click", () => { mv.fitAll(); mv.draw(); });
  // the clicks in order: the first is the start, the last the finish (the read course keeps its own kinds: a control is
  // never made the start or the finish — the races ended at the last control found, owner 2026-10-14)
  const relabel = () => st.controls.forEach((p, i) => { p.kind = i === 0 ? "start" : i === st.controls.length - 1 && st.controls.length > 1 ? "finish" : "control"; });
  function side() {
    const ok = validGeo(st.geo), nCtrl = st.controls.filter((p) => p.kind === "control").length;
    $("#sh-e-side").innerHTML = html`
      <div class="an-side-title">${t("sh.e.state")}</div>
      <ul class="an-summary">
        <li>${st.image ? t("sh.e.map", { w: st.image.width, h: st.image.height }) : t("sh.e.noMap")}</li>
        <li>${ok ? t("sh.e.geo", { how: st.geoHow }) : t("sh.e.noGeo")}</li>
        <li>${st.controls.length ? t("sh.e.ctrls", { n: nCtrl, s: st.controls[0]?.kind === "start" ? t("sh.e.ctrls.s") : t("sh.e.ctrls.noS"), f: st.controls[st.controls.length - 1]?.kind === "finish" ? t("sh.e.ctrls.f") : t("sh.e.ctrls.noF") }) : t("sh.e.noCtrls")}</li></ul>
      ${st.notes.map((n) => html`<div class="notice" style="margin-bottom:6px">${n}</div>`)}
      <p class="hint">${t(st.clicking ? "sh.e.clicking" : "sh.e.order.hint")}</p>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm${st.clicking ? " btn-primary" : ""}" id="sh-e-click">${t(st.clicking ? "sh.e.clickDone" : "sh.e.click")}</button>
        <button type="button" class="btn btn-sm" id="sh-e-undo">${t("an.cal.undo")}</button>
        <button type="button" class="btn btn-sm" id="sh-e-clear">${t("an.cal.clear")}</button></div>
      <ol class="sh-e-list">${st.controls.map((p) => html`<li>${p.kind === "start" ? t("an.start") : p.kind === "finish" ? t("an.finish") : p.label}${p.code ? html` <span class="muted">${p.code}</span>` : ""}</li>`)}</ol>`;
    $("#sh-e-click").addEventListener("click", () => { st.clicking = !st.clicking; if (st.clicking && !confirmClear()) st.clicking = false; side(); });
    $("#sh-e-undo").addEventListener("click", () => { st.controls.pop(); if (st.clicking) relabel(); labels(); side(); mv.draw(); });
    $("#sh-e-clear").addEventListener("click", () => { st.controls = []; side(); mv.draw(); });
  }
  const confirmClear = () => { if (st.controls.length && !confirm(t("sh.e.clear.confirm"))) return false; st.controls = []; mv.draw(); return true; };
  const labels = () => { let k = 0; st.controls.forEach((p) => { p.label = p.kind === "control" ? String(++k) : ""; }); };
  const files = () => { $("#sh-e-files").textContent = Object.values(st.files).filter(Boolean).join(" · "); };

  // an existing circuit: its stored map
  if (course) {
    try { const b = await api(`/${id}/map/${course.n}?v=${course.map.v}`, { key: keyOf(id) }); st.image = await createImageBitmap(b); mv.setImage(st.image); }
    catch (e) { st.notes.push(errText(e)); }
  }
  labels(); side();

  async function take(list) {
    for (const f of list) {
      const low = f.name.toLowerCase();
      try {
        if (isTraceName(f.name)) { st.track = parseTrace(f.name, await f.arrayBuffer()); st.files.trace = f.name; }
        else if (low.endsWith(".kmz")) {
          const entries = await readZip(await f.arrayBuffer());
          const kml = entries.find((e) => /\.kml$/i.test(e.name)), ovs = kml ? parseKml(new TextDecoder().decode(kml.data)) : [];
          if (!ovs.length) throw new Error("kmz");
          st.overlay = ovs[0]; st.files.geo = f.name;
          const img = entries.find((e) => e.name.toLowerCase() === ovs[0].href.toLowerCase().replace(/^\.\//, "")) || entries.find((e) => /\.(png|jpe?g|webp|gif)$/i.test(e.name));
          if (img) { const blob = new Blob([img.data], { type: /\.png$/i.test(img.name) ? "image/png" : "image/jpeg" }); st.mapFile = new File([blob], img.name, { type: blob.type }); st.image = await createImageBitmap(blob); st.files.map = `${f.name} › ${img.name}`; }
        } else if (low.endsWith(".kml")) { const ovs = parseKml(await f.text()); if (!ovs.length) throw new Error("kml"); st.overlay = ovs[0]; st.files.geo = f.name; }
        else if (isWorldFileName(f.name)) { st.world = parseWorldFile(await f.text()); if (!st.world) throw new Error("world"); st.files.geo = f.name; }
        else if (low.endsWith(".prj")) { st.crs = crsFromWkt(await f.text()); st.files.prj = f.name; }
        else if (low.endsWith(".xml")) { st.iof = parseIofCourse(await f.text()); if (!st.iof) throw new Error("xml"); st.files.iof = f.name; }
        else if (isImage(f)) { st.image = await readMap(f); st.mapFile = f; st.files.map = f.name; }
        else throw new Error("type");
      } catch (e) { st.notes = [t(`an.err.${e.message}`, { f: f.name }) || f.name]; }
    }
    files();
    if (st.image) { mv.setImage(st.image); await auto(); }
  }
  /** The circuit read automatically: the circles, the georeference, the controls in order. */
  async function auto() {
    st.notes = [];
    $("#sh-e-note").textContent = t("an.st.reading");
    await new Promise((r) => setTimeout(r, 20));
    try { st.detect = await detectCourse(st.image); } catch (e) { st.detect = null; }
    if (st.detect?.r) st.r = st.detect.r;
    const W = st.image.width, H = st.image.height;
    // the georeference: a ground overlay, a world file, an IOF XML with coordinates, else the organiser's trace
    st.geo = null;
    if (st.overlay) {
      const pts = st.overlay.quad ? st.overlay.quad.map(([lon, lat]) => [lat, lon]) : [[st.overlay.box.n, st.overlay.box.w], [st.overlay.box.s, st.overlay.box.e]];
      const fr = frameAt(pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length);
      const f = fitFromKml(st.overlay, W, H, fr);
      if (f) { st.geo = geoFromFit(f, fr); st.geoHow = "KML"; }
    } else if (st.world) {
      const crs = st.crs || guessCrs(st.world[4], st.world[5], st.track?.lon0 ?? 2);
      if (crs) {
        const [a, d, b, e, c, f0] = st.world, X = a * W / 2 + b * H / 2 + c, Y = d * W / 2 + e * H / 2 + f0;
        const [lat, lon] = projector(crs)(X, Y), fr = frameAt(lat, lon), f = fitFromWorld(st.world, crs, W, H, fr);
        if (f) { st.geo = geoFromFit(f, fr); st.geoHow = `${t("an.geo.world")} · ${crs.name}`; }
      } else st.notes.push(t("an.geo.noCrs"));
    }
    const circles = st.detect ? [...st.detect.controls] : [];
    const pts = [...(st.detect?.start ? [{ x: st.detect.start.x, y: st.detect.start.y, kind: "start" }] : []), ...circles.map((c) => ({ x: c.x, y: c.y, kind: "control" })),
      ...(st.detect?.finish ? [{ x: st.detect.finish.x, y: st.detect.finish.y, kind: "finish" }] : [])];
    const iofCourse = st.iof ? (st.iof.courses.find((c) => norm(c.name) === norm($("#sh-e-name").value) || norm(c.name) === norm(st.circuit)) || st.iof.courses[0]) : null;
    if (!st.geo && iofCourse) {
      // the IOF controls with coordinates, matched to the circles read: the georeference by least squares
      const seq = iofCourse.controls.map((cc) => st.iof.controls.get(cc.id)).filter((c) => c?.lat != null);
      if (seq.length >= 3 && circles.length >= 3) {
        const fr = frameAt(seq[0].lat, seq[0].lon), src = seq.map((c) => [(c.lon - fr.lon0) * fr.kx, -(c.lat - fr.lat0) * fr.ky]);
        // pair by the trace-free route: try every similarity from two pairs, keep the one that places most controls on circles
        let best = null;
        for (let i = 0; i < src.length; i++) for (let j = i + 1; j < src.length; j++) for (const a of circles) for (const b of circles) {
          if (a === b) continue;
          const f = fitSimilarity([src[i], src[j]], [[a.x, a.y], [b.x, b.y]]);
          if (!f || f.scale <= 0) continue;
          let hit = 0;
          for (const p of src) { const [x, y] = toPx(f, p[0], p[1]); if (circles.some((c) => Math.hypot(c.x - x, c.y - y) < 0.8 * st.r)) hit++; }
          if (!best || hit > best.hit) best = { f, hit };
          if (best.hit === src.length) break;
        }
        if (best && best.hit >= Math.max(3, 0.6 * src.length)) { st.geo = geoFromFit(best.f, fr); st.geoHow = "IOF XML"; }
      }
    }
    if (!st.geo && st.track && pts.length >= 3) {
      const al = alignTrack(st.track, pts, { rStar: st.detect?.r || null, northUp: true, tol: 20 });
      if (al) { st.geo = geoFromFit(al.fit, st.track); st.geoHow = t("sh.geo.trace", { m: Math.round(al.rms / al.fit.scale) }); }
      else st.notes.push(t("an.st.noAlign"));
    }
    if (!st.geo) st.notes.push(t("sh.e.needGeo"));
    // the finish not read (its colours lost over water or yellow, a line across it): looked for where the trace ends
    if (!iofCourse && st.track && validGeo(st.geo) && st.detect?.probeFinish && !pts.some((p) => p.kind === "finish")) {
      const f = fitFromGeo(st.geo, st.track), k = st.track.n - 1, [ex, ey] = toPx(f, st.track.x[k], st.track.y[k]);
      const hit = ex >= 0 && ey >= 0 && ex <= W && ey <= H ? st.detect.probeFinish(ex, ey, 50 * f.scale) : null;
      if (hit) pts.push({ x: hit.x, y: hit.y, kind: "finish" });
    }
    // the controls in order: the IOF course, else the trace's visiting order, else as read (to be checked)
    st.controls = [];
    if (iofCourse && validGeo(st.geo)) {
      for (const cc of iofCourse.controls) {
        const c = st.iof.controls.get(cc.id);
        if (c?.lat == null) continue;
        let x = st.geo.a * c.lon + st.geo.b * c.lat + st.geo.c, y = st.geo.d * c.lon + st.geo.e * c.lat + st.geo.f;
        const near = circles.map((q) => [Math.hypot(q.x - x, q.y - y), q]).sort((a, b) => a[0] - b[0])[0];
        if (near && near[0] < 1.3 * st.r) { x = near[1].x; y = near[1].y; }
        st.controls.push({ kind: "control", code: cc.type === "Control" ? cc.id : "", x, y });
      }
    } else if (st.track && validGeo(st.geo) && pts.length) {
      const vo = visitOrder(st.track, fitFromGeo(st.geo, st.track), pts, 20);
      const start = pts.find((p) => p.kind === "start"), finish = pts.find((p) => p.kind === "finish");
      st.controls = [...(start ? [{ ...start }] : []), ...vo.order.filter((i) => pts[i].kind === "control").map((i) => ({ ...pts[i] })), ...(finish ? [{ ...finish }] : [])];
      if (!start || !finish) st.notes.push(t("sh.e.checkEnds"));
    } else if (pts.length) { st.controls = pts.map((p) => ({ ...p })); st.notes.push(t("sh.e.checkOrder")); }
    labels();
    $("#sh-e-note").textContent = "";
    side(); mv.draw();
  }
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  $("#sh-e-in").addEventListener("change", (e) => { take([...e.target.files]); e.target.value = ""; });
  const drop = $("#sh-e-drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take([...e.dataTransfer.files]); });
  $("#sh-e-circuit")?.addEventListener("change", (e) => { st.circuit = e.target.value; if (!$("#sh-e-name").value) $("#sh-e-name").value = st.circuit; });
  $("#sh-e-cancel").addEventListener("click", () => { mv.destroy(); box.innerHTML = ""; });
  $("#sh-e-save").addEventListener("click", async () => {
    const note = $("#sh-e-note");
    labels();
    if (!st.image) return (note.textContent = t("sh.e.noMap"));
    if (!validGeo(st.geo)) return (note.textContent = t("sh.e.needGeo"));
    if (st.controls.length < 2) return (note.textContent = t("sh.e.noCtrls"));
    if (st.mapFile && !$("#sh-e-consent").checked) return (note.textContent = t("sh.e.consentNeeded"));
    const n = course?.n ?? Math.max(-1, ...A.courses.map((c) => c.n)) + 1;
    note.textContent = t("sh.saving");
    try {
      // the map kept as it came, at its full resolution (a PDF's page as a lossless PNG)
      let type = st.mapType;
      if (st.mapFile || !course) {
        const blob = await imageBlob(st.mapFile, st.image);
        if (blob.size > MAX_MAP) return (note.textContent = t("sh.e.tooBig", { mb: Math.round(MAX_MAP / 1048576) }));
        type = blob.type || "image/jpeg";
        await api(`/${id}/map/${n}`, { method: "PUT", body: blob, type, key: keyOf(id) });
      }
      const entry = { n, name: $("#sh-e-name").value || st.circuit || t("sh.course.default", { n: n + 1 }), circuit: $("#sh-e-circuit")?.value || st.circuit || "", r: st.r,
        map: { w: st.image.width, h: st.image.height, type, v: st.mapFile || !course ? Date.now() : course.map.v }, geo: st.geo,
        controls: st.controls.map(({ kind, code, x, y }) => ({ kind, code: code || "", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })) };
      const courses = [...A.courses.filter((c) => c.n !== n), entry].sort((a, b) => a.n - b.n);
      await api(`/${id}`, { method: "PUT", body: { courses }, key: keyOf(id) });
      mv.destroy(); box.innerHTML = "";
      onChange();
    } catch (e) { note.textContent = errText(e); }
  });
}

/** The course drawn over the map: the start triangle, the circles, the finish's double circle, the legs, the numbers. */
function drawCourse(g, controls, r, lw, alpha = 0.85, first = 0) {
  if (!controls?.length) return;
  g.save(); g.globalAlpha = alpha; g.strokeStyle = COURSE; g.fillStyle = COURSE; g.lineWidth = lw(2);
  const R = (p) => (p.kind === "finish" ? r * 1.3 : r);
  for (let i = 1; i < controls.length; i++) {
    const a = controls[i - 1], b = controls[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < R(a) + R(b) + 2) continue;
    const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    g.beginPath(); g.moveTo(a.x + ux * R(a), a.y + uy * R(a)); g.lineTo(b.x - ux * R(b), b.y - uy * R(b)); g.stroke();
  }
  let n = first;                                         // the controls before the part drawn (a leg)
  g.font = `600 ${lw(14)}px system-ui, sans-serif`; g.textBaseline = "middle";
  for (const p of controls) {
    if (p.kind === "start") {
      g.beginPath(); for (let m = 0; m < 3; m++) { const a = -Math.PI / 2 + (m * 2 * Math.PI) / 3; const x = p.x + r * 1.1 * Math.cos(a), y = p.y + r * 1.1 * Math.sin(a); if (m) g.lineTo(x, y); else g.moveTo(x, y); }
      g.closePath(); g.stroke();
    } else {
      g.beginPath(); g.arc(p.x, p.y, r, 0, 2 * Math.PI); g.stroke();
      if (p.kind === "finish") { g.beginPath(); g.arc(p.x, p.y, r * 1.3, 0, 2 * Math.PI); g.stroke(); }
      else { n++; g.fillText(String(n), p.x + r + lw(3), p.y - r * 0.6); }
    }
  }
  g.restore();
}

// ---- the replay --------------------------------------------------------------------------------------------------
async function replay(box, { A, id, course, race, traces, you, reload }) {
  document.body.classList.add("an-theatre");
  const ctrls = course.controls, legsN = ctrls.length - 1;
  const legName = (j) => (j < 1 ? t("sh.leg.all") : `${ctrlLabel(j - 1)} → ${ctrlLabel(j)}`);
  const ctrlLabel = (i) => { const p = ctrls[i]; if (p.kind === "start") return t("an.start"); if (p.kind === "finish") return t("an.finish"); return String(ctrls.slice(0, i + 1).filter((q) => q.kind === "control").length); };
  // the display as on « Analyse solo » (owner, 2026-10-14: no curves per runner here — the map is what is compared)
  const prefs = loadPrefs(), pct = (v, d) => (Number.isFinite(v) && v >= 10 && v <= 100 ? v : d);
  let tail = TAILS.includes(prefs.tail) ? prefs.tail : 60, width = WIDTHS.some(([w]) => w === prefs.width) ? prefs.width : 1.6;
  let curvesOpen = prefs.curvesOpen === true;              // one's own curves: folded to the left by default (owner, 2026-10-15)
  let future = prefs.future === "faint" ? "faint" : "hide", showCourse = prefs.showCourse !== false;
  let mapAlpha = pct(prefs.mapAlpha, 100), traceAlpha = pct(prefs.traceAlpha, 100);
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ tail, width, future, showCourse, mapAlpha, traceAlpha, curvesOpen })); } catch (e) { /* not kept */ } };
  let mode = "mass", fromK = 1, leg = 0, T = 0, speed = 10, follow = "all", playing = false, timer = 0, last = 0, sel = null, ref = null;
  box.innerHTML = html`
    <div class="sh-layout" id="sh-layout">
      <aside class="sh-panel sh-curves" id="sh-curves" hidden></aside>
      <aside class="sh-panel" id="sh-left"></aside>
      <div class="sh-map"><canvas id="sh-canvas"></canvas>
        <div class="an-tools"><button type="button" class="btn btn-sm" id="sh-zin">+</button><button type="button" class="btn btn-sm" id="sh-zout">−</button>
          <button type="button" class="btn btn-sm" id="sh-fit" title="${t("sh.fit")}">⤢</button><button type="button" class="btn btn-sm" id="sh-fitmap" title="${t("an.fitMap")}">▭</button></div>
        <div class="an-hud" id="sh-hud"></div></div>
      <aside class="sh-panel" id="sh-right"></aside></div>
    <section class="card" id="sh-splits" style="margin-top:12px"></section>`;
  const mv = mapView($("#sh-canvas"), { onDraw: drawOver, onUserMove: () => { if (playing && follow !== "none") { follow = "none"; const s = $("#sh-follow"); if (s) s.value = "none"; } } });
  // the map (drawn once the runners are known: the view draws as soon as it has its image)
  let image;
  try { image = await createImageBitmap(await api(`/${id}/map/${course.n}?v=${course.map.v}`, { key: keyOf(id) })); }
  catch (e) { box.innerHTML = html`<div class="card"><div class="empty">${errText(e)}</div></div>`; return { destroy() { mv.destroy(); } }; }
  // the traces
  let recs = [];
  try { recs = await api(`/${id}/traces/${course.n}`, { key: keyOf(id) }); } catch (e) { recs = []; }
  const official = (rec) => {
    if (!race) return null;
    for (const d of race.docs || []) for (const k of d.classes || []) for (const x of k.runners) if ((x.lic && String(x.lic) === String(rec.lic)) || key(x.name) === key(rec.name)) return { time: x.time_s, place: x.place, status: x.status, circuit: k.name };
    return null;
  };
  const key = (n) => (n || "").toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").sort().join(" ");
  let runners = recs.map((rec) => {
    const tr = decodeTrace(rec);
    if (!tr) return null;
    const fit = fitFromGeo(course.geo, tr), pxs = new Float32Array(tr.n), pys = new Float32Array(tr.n);
    for (let i = 0; i < tr.n; i++) { const [x, y] = toPx(fit, tr.x[i], tr.y[i]); pxs[i] = x; pys[i] = y; }
    const passes = coursePasses(tr, fit, ctrls, TOL);
    // a circuit without its start or its finish: the race from the trace's start, to the trace's end
    const start = ctrls[0].kind === "start" ? passes[0] ?? tr.t[0] : tr.t[0], finish = ctrls[legsN].kind === "finish" ? passes[legsN] : null;
    return { uid: rec.uid, name: rec.name, lic: rec.lic, tr, fit, pxs, pys, passes, start, finish, mine: rec.uid === you.uid, visible: true, official: official(rec), abs0: tr.ms0 / 1000 };
  }).filter(Boolean);
  const total = (r) => (r.finish != null ? r.finish - r.start : null);
  const visKey = `ocn.an.vis.${id}.${course.n}`;
  try { const hidden = JSON.parse(sessionStorage.getItem(visKey) || "[]"); runners.forEach((r) => { r.visible = !hidden.includes(r.uid); }); } catch (e) { /* all shown */ }
  const saveVis = () => { try { sessionStorage.setItem(visKey, JSON.stringify(runners.filter((r) => !r.visible).map((r) => r.uid))); } catch (e) { /* this visit only */ } };
  runners.sort((a, b) => (total(a) ?? 1e9) - (total(b) ?? 1e9));
  runners.forEach((r, i) => { r.colour = COLOURS[i % COLOURS.length]; r.rank = total(r) != null ? i + 1 : null; });

  // ---- the clock of each mode: trace seconds of runner r at the display time T (null: not shown)
  const legTime = (r, j) => (r.passes[j - 1] != null && r.passes[j] != null ? r.passes[j] - r.passes[j - 1] : null);
  let waits = [];
  function range() {
    const shown = runners.filter((r) => r.visible), R = shown.length ? shown : runners;
    if (leg) return [0, Math.max(1, ...R.map((r) => legTime(r, leg) ?? 0))];
    if (mode === "clock") return [Math.min(...R.map((r) => r.abs0 + r.start)) - 30, Math.max(...R.map((r) => r.abs0 + (r.finish ?? r.tr.dur))) + 30];
    if (mode === "mass") return [0, Math.max(1, ...R.map((r) => (r.finish ?? r.tr.dur) - r.start))];
    if (mode === "from") {
      const S = R.filter((r) => r.passes[fromK] != null);
      return [-Math.max(0, ...S.map((r) => r.passes[fromK] - r.start)), Math.max(1, ...S.map((r) => (r.finish ?? r.tr.dur) - r.passes[fromK]))];
    }
    waits = [0];
    for (let j = 1; j <= legsN; j++) waits.push(waits[j - 1] + Math.max(0, ...R.map((r) => legTime(r, j) ?? 0)));
    return [0, Math.max(1, waits[legsN])];
  }
  function sAt(r, Td) {
    let s;
    if (leg) { const a = r.passes[leg - 1], d = legTime(r, leg); if (a == null || d == null) return null; s = a + Math.min(Math.max(Td, 0), d); }
    else if (mode === "clock") s = Td - r.abs0;
    else if (mode === "mass") s = r.start + Td;
    else if (mode === "from") { if (r.passes[fromK] == null) return null; s = r.passes[fromK] + Td; }
    else {
      let j = 1;
      while (j < legsN && Td >= waits[j]) j++;
      const a = r.passes[j - 1], d = legTime(r, j);
      if (a == null || d == null) return null;
      s = a + Math.min(Math.max(Td - waits[j - 1], 0), d);
    }
    return Math.max(r.tr.t[0], Math.min(r.tr.dur, s));
  }
  let [T0, T1] = range();
  T = T0;

  // ---- drawing
  function drawOver(g, view, lw) {
    if (showCourse) drawCourse(g, leg ? ctrls.slice(leg - 1, leg + 1) : ctrls, course.r || 20, lw, 0.75, leg ? ctrls.slice(0, leg - 1).filter((p) => p.kind === "control").length : 0);
    const shown = runners.filter((r) => r.visible), ta = traceAlpha / 100;
    const path = (r, a, b) => { g.beginPath(); g.moveTo(r.pxs[a], r.pys[a]); for (let i = a + 1; i <= b; i++) g.lineTo(r.pxs[i], r.pys[i]); };
    g.lineCap = "round"; g.lineJoin = "round";
    for (const r of shown) {
      const s = sAt(r, T);
      if (s == null) continue;
      const lo = leg ? r.passes[leg - 1] : Math.max(r.start, tail && !leg ? s - tail : r.start), from = indexAt(r.tr, lo), to = indexAt(r.tr, s);
      // the route still to run, faint, to its finish (or the leg's end) — hidden by default
      if (future === "faint") {
        const a = indexAt(r.tr, leg ? r.passes[leg - 1] : r.start), b = indexAt(r.tr, leg ? r.passes[leg] ?? r.tr.dur : r.finish ?? r.tr.dur);
        if (b > a) { g.strokeStyle = r.colour; g.lineWidth = lw(2 * width); g.globalAlpha = 0.3 * ta; path(r, a, b); g.stroke(); }
      }
      if (mode === "clock" && !leg && s < r.start - 1) continue;           // not started yet
      g.strokeStyle = r.colour; g.lineWidth = lw((r === sel ? 2.8 : 2) * width); g.globalAlpha = (r === sel || !sel ? 1 : 0.75) * ta;
      if (to > from) { path(r, from, to); const [mx, my] = posAt(r.tr, s); const [x, y] = toPx(r.fit, mx, my); g.lineTo(x, y); g.stroke(); }
      const [mx, my] = posAt(r.tr, s), [x, y] = toPx(r.fit, mx, my);
      g.globalAlpha = 1; g.beginPath(); g.arc(x, y, lw(7), 0, 2 * Math.PI); g.fillStyle = "#fff"; g.fill();
      g.beginPath(); g.arc(x, y, lw(5), 0, 2 * Math.PI); g.fillStyle = r.colour; g.fill();
      if (shown.length > 1 || r === sel) {
        const label = r.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
        g.font = `700 ${lw(11)}px system-ui, sans-serif`; g.textBaseline = "middle";
        g.strokeStyle = "#fff"; g.lineWidth = lw(3); g.strokeText(label, x + lw(9), y); g.fillStyle = r.colour; g.fillText(label, x + lw(9), y);
      }
    }
    g.globalAlpha = 1;
  }
  function followView() {
    if (follow === "none") return;
    const pts = (follow === "sel" && sel ? [sel] : runners.filter((r) => r.visible)).map((r) => { const s = sAt(r, T); if (s == null) return null; return toPx(r.fit, ...posAt(r.tr, s)); }).filter(Boolean);
    if (!pts.length) return;
    if (pts.length === 1 || follow === "sel") { mv.centerOn(pts[0][0], pts[0][1]); return; }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const { w, h } = mv.box(), k = mv.view.k;
    if (x1 - x0 > (w - 160) / k || y1 - y0 > (h - 160) / k) mv.fitBox(x0, y0, x1, y1, 80, 4);
    else mv.centerOn((x0 + x1) / 2, (y0 + y1) / 2);
  }
  function frame() { followView(); mv.draw(); hud(); drawOwn(); }

  // ---- one's own curves: from one's own file, kept on this device (the server keeps positions and times only, and
  // the others never see them); the panel folded to the left by default, a tab to open it
  const me = runners.find((r) => r.mine);
  let own = null;
  const prepOwn = (tr) => {
    // the cadence as runners read it: one foot's strides doubled on foot (« pas/min »), a bike's pedal turns kept
    if (tr.ch.cad && !tr.cadUnit) {
      const bike = tr.activity === "bike" || (!tr.activity && /\bvtt\b|v[ée]lo|mtb/i.test(`${race?.name || ""} ${A.title}`));
      if (!bike) for (let i = 0; i < tr.ch.cad.length; i++) tr.ch.cad[i] *= 2;
      tr.cadUnit = t(bike ? "an.unit.rpm" : "an.unit.spm");
    }
    return tr;
  };
  // the own file is the same run: it overlaps one's shared trace in time
  const overlaps = (tr) => me && tr.ms0 <= me.tr.ms0 + me.tr.dur * 1000 && tr.ms0 + tr.dur * 1000 >= me.tr.ms0;
  function drawOwn() {
    const cv = $("#sh-own-cv");
    if (!me || !own || !cv || !curvesOpen) return;
    const delta = (me.tr.ms0 - own.ms0) / 1000, end = me.finish ?? me.tr.dur, s = sAt(me, T);
    drawCurves(cv, { track: own, t0: me.start + delta, total: Math.max(1, end - me.start), rows: curveRows(own), cursor: s == null ? null : s - me.start,
      units: { cad: own.cadUnit }, marks: me.passes.map((p, j) => (p == null || !j ? null : { t: p - me.start, label: ctrls[j].kind === "control" ? ctrlLabel(j) : "" })).filter(Boolean) });
  }
  function curvesPanel() {
    const el = $("#sh-curves"), lay = $("#sh-layout");
    if (!el || !lay) return;
    el.hidden = !me;
    lay.classList.toggle("with-curves", !!me);
    if (!me) return;
    lay.style.setProperty("--sh-cw", curvesOpen ? "330px" : "36px");
    el.classList.toggle("open", curvesOpen);
    if (!curvesOpen) {
      el.innerHTML = html`<button type="button" class="sh-curves-tab" id="sh-curves-open" title="${t("sh.own.open")}">${t("sh.own.title")} ›</button>`;
      $("#sh-curves-open").addEventListener("click", () => { curvesOpen = true; savePrefs(); curvesPanel(); });
      return;
    }
    el.innerHTML = html`<div class="sh-curves-head"><b>${t("sh.own.title")}</b><button type="button" class="btn btn-sm" id="sh-curves-close" title="${t("sh.own.close")}">‹</button></div>
      ${own ? html`<canvas class="sh-own-cv" id="sh-own-cv"></canvas>`
        : html`<label class="dropzone sh-own-drop"><input type="file" id="sh-own-file" accept=".gpx,.tcx,.fit" hidden><strong>${t("sh.own.drop")}</strong><span class="muted">${t("sh.own.drop.hint")}</span></label>
          <p class="hint" style="margin:6px 0 0">${t("an.fitTip")}</p>
          <p class="notice" id="sh-own-note" hidden></p>`}`;
    $("#sh-curves-close").addEventListener("click", () => { curvesOpen = false; savePrefs(); curvesPanel(); });
    $("#sh-own-file")?.addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      let tr = null;
      try { tr = parseTrace(f.name, await f.arrayBuffer()); } catch (err) { tr = null; }
      const note = $("#sh-own-note");
      if (!tr || !overlaps(tr)) { note.hidden = false; note.textContent = t(tr ? "sh.own.mismatch" : "an.err.gpx"); return; }
      await ownPut(ownKey(id, course.n), f);
      own = prepOwn(tr); curvesPanel();
    });
    drawOwn();
  }
  if (me) {
    ownGet(ownKey(id, course.n)).then(async (f) => {
      if (f && !own) { try { const tr = parseTrace(f.name || "trace.fit", await f.arrayBuffer()); if (overlaps(tr)) own = prepOwn(tr); } catch (e) { /* unreadable: dropped again */ } }
      curvesPanel();
    });
  }
  const ownRo = new ResizeObserver(() => drawOwn());
  ownRo.observe($("#sh-curves"));

  // ---- the panels
  function left() {
    const rowsL = leg ? [...runners].sort((a, b) => (legTime(a, leg) ?? 1e9) - (legTime(b, leg) ?? 1e9)) : runners;
    const bestLeg = leg ? Math.min(...runners.map((r) => legTime(r, leg) ?? 1e9)) : null;
    const nShown = runners.filter((r) => r.visible).length;
    $("#sh-left").innerHTML = html`<div class="an-side-title">${leg ? legName(leg) : t("sh.runners.shown", { k: nShown, n: runners.length })}</div>
      <div class="row" style="gap:4px;margin-bottom:4px;flex-wrap:wrap"><button type="button" class="btn btn-sm" id="sh-all">${t("sh.all")}</button><button type="button" class="btn btn-sm" id="sh-none">${t("sh.none")}</button>
        <button type="button" class="btn btn-sm" id="sh-invert">${t("sh.invert")}</button>${runners.some((r) => r.mine) ? html`<button type="button" class="btn btn-sm" id="sh-mine-only">${t("sh.meOnly")}</button>` : ""}</div>
      <p class="hint" style="margin:0 0 6px">${t("sh.pick.hint")}</p>
      ${rowsL.length ? html`<div class="sh-runners">${rowsL.map((r) => {
        const lt = leg ? legTime(r, leg) : null, dist = leg && lt != null ? cumAt(r.tr, r.passes[leg]) - cumAt(r.tr, r.passes[leg - 1]) : null;
        return html`<div class="sh-runner${r === sel ? " sel" : ""}${r.visible ? "" : " off"}" data-uid="${r.uid}" role="checkbox" aria-checked="${r.visible}">
          <input type="checkbox" data-vis="${r.uid}" ${raw(r.visible ? "checked" : "")} tabindex="-1"><span class="sh-swatch" style="background:${r.colour}"></span>
          <span class="sh-name">${r.name}${r.mine ? html` <span class="tag">${t("sh.me")}</span>` : ""}</span>
          <button type="button" class="sh-follow-one${r === sel ? " on" : ""}" data-follow="${r.uid}" title="${t("sh.followOne")}">⌖</button>
          <span class="num muted">${leg ? (lt != null ? html`${clock(lt)}${lt > bestLeg ? html` <span class="sh-behind">${signed(lt - bestLeg)}</span>` : ""}` : "—")
            : r.official?.time != null ? clock(r.official.time) : total(r) != null ? `~${clock(total(r))}` : "—"}</span>
          ${leg && dist != null ? html`<span class="sh-sub muted">${fmt(dist)} m · ${pace(dist / lt)}</span>` : r.official?.place ? html`<span class="sh-sub muted">${t("sh.place", { p: r.official.place })}</span>` : ""}</div>`; })}</div>`
        : html`<div class="empty">${t("sh.noTraces")}</div>`}
      <div class="sh-mine">${runners.some((r) => r.mine)
        ? html`<button type="button" class="btn btn-sm" id="sh-add">${t("sh.trace.replace")}</button> <button type="button" class="btn btn-sm" id="sh-rm">${t("sh.trace.remove")}</button>`
        : html`<button type="button" class="btn btn-sm btn-primary" id="sh-add">${t("sh.trace.add")}</button>`}
        <input type="file" id="sh-file" accept=".gpx,.tcx,.fit" hidden>
        <p class="hint" style="margin:6px 0 0">${t("sh.fitTip")}</p></div>
      <div id="sh-upload"></div>`;
    const shownChanged = () => {
      saveVis();
      const was = [T0, T1];
      [T0, T1] = range();
      if (T < T0 || T > T1 || (was[0] === T && T0 !== T)) T = Math.min(T1, Math.max(T0, T));
      left(); right(); frame(); splits();
    };
    $$(".sh-runner").forEach((el) => el.addEventListener("click", (e) => {
      if (e.target.closest("[data-follow]")) return;
      const r = runners.find((x) => x.uid === Number(el.dataset.uid));
      r.visible = !r.visible;
      if (!r.visible && sel === r) sel = null;
      shownChanged();
    }));
    $$("[data-follow]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = runners.find((x) => x.uid === Number(b.dataset.follow));
      if (sel === r) { sel = null; if (follow === "sel") follow = "all"; }
      else { sel = r; r.visible = true; follow = "sel"; }
      shownChanged();
    }));
    $("#sh-all").addEventListener("click", () => { runners.forEach((r) => { r.visible = true; }); shownChanged(); });
    $("#sh-none").addEventListener("click", () => { runners.forEach((r) => { r.visible = false; }); sel = null; shownChanged(); });
    $("#sh-invert").addEventListener("click", () => { runners.forEach((r) => { r.visible = !r.visible; }); if (sel && !sel.visible) sel = null; shownChanged(); });
    $("#sh-mine-only")?.addEventListener("click", () => { runners.forEach((r) => { r.visible = r.mine; }); shownChanged(); });
    $("#sh-add").addEventListener("click", () => $("#sh-file").click());
    $("#sh-file").addEventListener("change", (e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ""; });
    $("#sh-rm")?.addEventListener("click", async () => { if (!confirm(t("sh.trace.remove.confirm"))) return; try { await api(`/${id}/trace/${course.n}`, { method: "DELETE", key: keyOf(id) }); await ownDel(ownKey(id, course.n)); reload(); } catch (e) { alert(errText(e)); } });
  }
  async function upload(file) {
    const boxU = $("#sh-upload");
    let tr;
    try { tr = parseTrace(file.name, await file.arrayBuffer()); } catch (e) { boxU.innerHTML = html`<div class="notice">${t(e.message === "time" ? "an.err.time" : "an.err.gpx")}</div>`; return; }
    const crop = cropToMap(tr, course.geo, course.map.w, course.map.h);
    if (!crop) { boxU.innerHTML = html`<div class="notice">${t("sh.trace.offMap")}</div>`; return; }
    const enc = encodeTrace(tr, crop[0], crop[1]), t0 = enc.t0, t1 = t0 + enc.dt.reduce((s, v) => s + v, 0);
    boxU.innerHTML = html`<div class="notice sh-consent"><p>${t("sh.trace.confirm", { a: hms(t0), b: hms(t1), n: enc.dt.length })}</p>
      <label class="an-opt"><input type="checkbox" id="sh-consent"> ${t("sh.trace.consent")}</label>
      <div class="row" style="gap:6px;margin-top:6px"><button type="button" class="btn btn-sm btn-primary" id="sh-send">${t("sh.trace.send")}</button><button type="button" class="btn btn-sm" id="sh-cancel">${t("sh.cancel")}</button></div></div>`;
    $("#sh-cancel").addEventListener("click", () => { boxU.innerHTML = ""; });
    $("#sh-send").addEventListener("click", async () => {
      if (!$("#sh-consent").checked) return;
      try { await api(`/${id}/trace/${course.n}`, { method: "PUT", body: { consent: true, trace: enc }, key: keyOf(id) }); await ownPut(ownKey(id, course.n), file); reload(); }
      catch (e) { boxU.innerHTML = html`<div class="notice">${errText(e)}</div>`; }
    });
  }
  function right() {
    const fromOpts = ctrls.map((p, i) => [i, ctrlLabel(i)]).slice(0, legsN);
    $("#sh-right").innerHTML = html`
      <div class="an-transport">
        <button type="button" class="btn btn-sm" id="sh-prev" title="${t("sh.leg.prev")}">⏮</button>
        <button type="button" class="btn btn-sm btn-primary" id="sh-play">${playing ? "⏸" : "▶"}</button>
        <button type="button" class="btn btn-sm" id="sh-next" title="${t("sh.leg.next")}">⏭</button>
        <select id="sh-speed">${SPEEDS.map((s) => html`<option value="${s}" ${raw(s === speed ? "selected" : "")}>× ${s}</option>`)}</select>
        <span class="fw-btns">${raw(fwButtons())}</span></div>
      <input type="range" id="sh-time" min="${Math.floor(T0)}" max="${Math.ceil(T1)}" step="1" value="${Math.round(T)}" style="width:100%;margin:6px 0">
      <div class="sh-clock"><b id="sh-t"></b> <span class="muted" id="sh-t-sub"></span></div>
      <div class="an-opts" style="margin-top:8px">
        <label><span>${t("sh.leg")}</span><select id="sh-leg"><option value="0">${t("sh.leg.all")}</option>${Array.from({ length: legsN }, (_, j) => html`<option value="${j + 1}" ${raw(j + 1 === leg ? "selected" : "")}>${legName(j + 1)}</option>`)}</select></label>
        ${leg ? "" : html`<label><span>${t("sh.mode")}</span><select id="sh-mode">${["clock", "mass", "from", "wait"].map((m) => html`<option value="${m}" ${raw(m === mode ? "selected" : "")}>${t(`sh.mode.${m}`)}</option>`)}</select></label>
        ${mode === "from" ? html`<label><span>${t("sh.from")}</span><select id="sh-from">${fromOpts.map(([i, l]) => html`<option value="${i}" ${raw(i === fromK ? "selected" : "")}>${l}</option>`)}</select></label>` : ""}`}
        <label><span>${t("sh.follow")}</span><select id="sh-follow">${["all", "sel", "none"].map((f) => html`<option value="${f}" ${raw(f === follow ? "selected" : "")}>${t(`sh.follow.${f}`)}</option>`)}</select></label></div>
      <p class="hint" style="margin-top:8px">${t(`sh.mode.${leg ? "leg" : mode}.hint`)}</p>
      <details class="an-settings" open><summary>${t("an.display")}</summary>
        <div class="an-opts">
          <label><span>${t("an.width")}</span><select id="sh-width">${WIDTHS.map(([w, k]) => html`<option value="${w}" ${raw(w === width ? "selected" : "")}>${t(k)}</option>`)}</select></label>
          <label><span>${t("an.future")}</span><select id="sh-future"><option value="hide" ${raw(future === "hide" ? "selected" : "")}>${t("an.future.hide")}</option><option value="faint" ${raw(future === "faint" ? "selected" : "")}>${t("an.future.faint")}</option></select></label>
          ${leg ? "" : html`<label><span>${t("an.tail")}</span><select id="sh-tail">${TAILS.map((s) => html`<option value="${s}" ${raw(s === tail ? "selected" : "")}>${s ? clock(s) : t("an.tail.all")}</option>`)}</select></label>`}
          <label><span>${t("an.mapAlpha")}</span><input type="range" id="sh-map-alpha" min="10" max="100" step="5" value="${mapAlpha}"></label>
          <label><span>${t("sh.traceAlpha")}</span><input type="range" id="sh-trace-alpha" min="10" max="100" step="5" value="${traceAlpha}"></label>
          <label><input type="checkbox" id="sh-course" ${raw(showCourse ? "checked" : "")}> ${t("sh.course.show")}</label></div></details>`;
    $("#sh-play").addEventListener("click", () => (playing ? stop() : play()));
    $("#sh-prev").addEventListener("click", () => setLeg(Math.max(1, (leg || 1) - (leg ? 1 : 0))));
    $("#sh-next").addEventListener("click", () => setLeg(Math.min(legsN, leg + 1)));
    $("#sh-speed").addEventListener("change", (e) => { speed = Number(e.target.value); });
    $("#sh-time").addEventListener("input", (e) => { T = Number(e.target.value); frame(); });
    $("#sh-leg").addEventListener("change", (e) => setLeg(Number(e.target.value)));
    $("#sh-mode")?.addEventListener("change", (e) => { mode = e.target.value; reset(); });
    $("#sh-from")?.addEventListener("change", (e) => { fromK = Number(e.target.value); reset(); });
    $("#sh-follow").addEventListener("change", (e) => { follow = e.target.value; frame(); });
    $("#sh-tail")?.addEventListener("change", (e) => { tail = Number(e.target.value); savePrefs(); mv.draw(); });
    $("#sh-width").addEventListener("change", (e) => { width = Number(e.target.value); savePrefs(); mv.draw(); });
    $("#sh-future").addEventListener("change", (e) => { future = e.target.value; savePrefs(); mv.draw(); });
    $("#sh-map-alpha").addEventListener("input", (e) => { mapAlpha = Number(e.target.value); mv.setAlpha(mapAlpha / 100); savePrefs(); mv.draw(); });
    $("#sh-trace-alpha").addEventListener("input", (e) => { traceAlpha = Number(e.target.value); savePrefs(); mv.draw(); });
    $("#sh-course").addEventListener("change", (e) => { showCourse = e.target.checked; savePrefs(); mv.draw(); });
  }
  function hud() {
    const sl = $("#sh-time"); if (sl) sl.value = String(Math.round(T));
    const label = mode === "clock" && !leg ? hms(T) : T < 0 ? `−${clock(-T)}` : clock(T);
    const tt = $("#sh-t"); if (tt) tt.textContent = label;
    const sub = $("#sh-t-sub"); if (sub) sub.textContent = !leg && mode === "wait" ? (() => { let j = 1; while (j < legsN && T >= waits[j]) j++; return legName(j); })() : "";
    $("#sh-hud").textContent = label;
  }
  function reset() { stop(); [T0, T1] = range(); T = T0; right(); frame(); }
  function setLeg(j) {
    leg = j; stop(); [T0, T1] = range(); T = T0;
    if (leg) {
      // the view on the leg: its two controls and the runners' routes on it
      const xs = [ctrls[leg - 1].x, ctrls[leg].x], ys = [ctrls[leg - 1].y, ctrls[leg].y];
      for (const r of runners) { if (!r.visible || legTime(r, leg) == null) continue; const a = indexAt(r.tr, r.passes[leg - 1]), b = indexAt(r.tr, r.passes[leg]); for (let i = a; i <= b; i++) { xs.push(r.pxs[i]); ys.push(r.pys[i]); } }
      mv.fitBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 40, 4);
      if (follow === "all") follow = "none";
    } else fitRoutes();
    left(); right(); frame();
  }
  function fitRoutes() {
    const xs = ctrls.map((p) => p.x), ys = ctrls.map((p) => p.y);
    mv.fitBox(Math.min(...xs) - 40, Math.min(...ys) - 40, Math.max(...xs) + 40, Math.max(...ys) + 40, 20, 4);
  }
  function play() {
    if (T >= T1 - 0.5) T = T0;
    playing = true; last = performance.now();
    clearInterval(timer);
    timer = setInterval(() => {
      if (!box.isConnected) { stop(); return; }
      const now = performance.now();
      T = Math.min(T1, T + ((now - last) / 1000) * speed); last = now;
      frame();
      if (T >= T1) stop();
    }, 40);
    const b = $("#sh-play"); if (b) b.textContent = "⏸";
  }
  function stop() { playing = false; clearInterval(timer); timer = 0; const b = $("#sh-play"); if (b) b.textContent = "▶"; }

  // ---- the splits table, against a reference (the duel)
  function splits() {
    const R = runners.filter((r) => r.visible);
    if (!R.length || legsN < 1) { $("#sh-splits").innerHTML = ""; return; }
    const best = Array.from({ length: legsN }, (_, j) => Math.min(...R.map((r) => legTime(r, j + 1) ?? 1e9)));
    const rankOf = (r, j) => { const v = legTime(r, j); return v == null ? null : 1 + R.filter((x) => (legTime(x, j) ?? 1e9) < v).length; };
    $("#sh-splits").innerHTML = html`<div class="card-head"><div><h2>${t("spl.title")}</h2><div class="hint">${t("sh.splits.hint")}</div></div>
      <label class="field" style="margin-left:auto"><span>${t("sh.ref")}</span><select id="sh-ref"><option value="">—</option>${R.map((r) => html`<option value="${r.uid}" ${raw(r === ref ? "selected" : "")}>${r.name}</option>`)}</select></label></div>
      <div class="table-wrap"><table class="data compact sh-splits"><thead><tr><th>${t("prov.name")}</th>${Array.from({ length: legsN }, (_, j) => html`<th class="r" data-legh="${j + 1}" style="cursor:pointer">${ctrlLabel(j + 1)}</th>`)}<th class="r">${t("an.total")}</th></tr></thead>
      <tbody>${R.map((r) => html`<tr><td><span class="sh-swatch" style="background:${r.colour}"></span> ${r.name}</td>
        ${Array.from({ length: legsN }, (_, j) => { const v = legTime(r, j + 1), c = r.passes[j + 1] != null ? r.passes[j + 1] - r.start : null, rv = ref && ref !== r ? legTime(ref, j + 1) : null;
          return html`<td class="r num${v != null && v === best[j] ? " sh-best" : ""}">${v != null ? html`${clock(v)} <span class="muted">(${rankOf(r, j + 1)})</span>` : "—"}
            <div class="sh-sub muted">${c != null ? clock(c) : ""}${v != null && rv != null ? html` <span class="${v > rv ? "delta-down" : "delta-up"}">${signed(v - rv)}</span>` : ""}</div></td>`; })}
        <td class="r num"><b>${total(r) != null ? clock(total(r)) : "—"}</b>${ref && ref !== r && total(r) != null && total(ref) != null ? html`<div class="sh-sub ${total(r) > total(ref) ? "delta-down" : "delta-up"}">${signed(total(r) - total(ref))}</div>` : ""}</td></tr>`)}</tbody></table></div>`;
    $("#sh-ref").addEventListener("change", (e) => { ref = runners.find((r) => r.uid === Number(e.target.value)) || null; splits(); });
    $$("[data-legh]").forEach((th) => th.addEventListener("click", () => setLeg(Number(th.dataset.legh))));
  }

  // ---- the layout: the window's height below the top line
  const fit = () => { const el = $("#sh-layout"); if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY; el.style.height = `${Math.max(380, Math.floor(innerHeight - top - 14))}px`; };
  window.addEventListener("resize", fit);
  $("#sh-zin").addEventListener("click", () => mv.zoomBy(1.4));
  $("#sh-zout").addEventListener("click", () => mv.zoomBy(1 / 1.4));
  $("#sh-fit").addEventListener("click", () => { follow = "none"; right(); fitRoutes(); mv.draw(); });
  $("#sh-fitmap").addEventListener("click", () => { follow = "none"; right(); mv.fitAll(); mv.draw(); });
  window.scrollTo(0, 0);
  fit();
  mv.setAlpha(mapAlpha / 100);
  mv.setImage(image);
  left(); right(); splits();
  fitRoutes();
  frame();
  window.anShared = () => ({ runners, mode, leg, T, T0, T1, follow, view: mv.view });   // for support, in the console
  curvesPanel();
  return { destroy() { stop(); mv.destroy(); ownRo.disconnect(); window.removeEventListener("resize", fit); } };
}
