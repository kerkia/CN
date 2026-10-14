// « Analyse » (#/analyse, menu « Courses »; administrators only for now — owner, 2026-10-13): a runner's GPS trace on
// their own map, for a race of « Résultats », played back as Livelox does.
// 1. The race (one with results), the circuit and the runner — the logged-in one by default.
// 2. The files, all read in the browser and never sent: the map (an image, a PDF's first page, or a KMZ), the trace
//    (GPX, TCX or FIT — with heart rate, cadence, altitude…), and if there are any a world file (+ .prj) or a KML for
//    the map's georeferencing, and an IOF XML CourseData (Purple Pen, OCAD, Condes) for the course.
// 3. The calibration, automatic: the course is read on the map (trace/course.js: the purple circles, the start
//    triangle, the finish's double circle); if the map is georeferenced, the trace's place on it follows; else the
//    trace is laid over the controls (trace/align.js: the similarity that makes it run through most of them, no
//    split times needed) and the controls are ordered by the trace's passes. The runner's published split times,
//    when there are any, refine the result (each click/circle pairs with the trace point of its time: least-squares
//    similarity plus the trace's clock offset — the start time is often unknown). The user can correct anything by
//    hand (clicks snap to the circles found).
// 4. The playback: the trace, plain or coloured by pace, the runner moving with a tail, play / pause / speed, jumps
//    by control, « suivre le coureur »; under the map the pace and the file's channels along the race; a table of
//    the legs (times and ranks when published, else the trace's own times; time lost by the split-times page's
//    rule; the trace's length against the straight line; pace; mean heart rate and cadence).
// Only the calibration (the controls' positions) is kept, in localStorage, per race, circuit, runner and image.

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { getProv, clock } from "./provisional.js";
import { replaceQuery } from "../app.js";
import { parseTrace, isTraceName, indexAt, posAt, cumAt, speedAt, valueAt, meanBetween, toLocal } from "../trace/track.js";
import { fitSimilarity, toPx, toM, registerPoints, simplify } from "../trace/geom.js";
import { detectCourse } from "../trace/course.js";
import { alignTrack, visitOrder } from "../trace/align.js";
import { readZip, parseKml, fitFromKml, isWorldFileName, parseWorldFile, crsFromWkt, guessCrs, fitFromWorld, parseIofCourse } from "../trace/georef.js";

const SPEEDS = [1, 2, 5, 10, 20, 60];
const TAILS = [30, 60, 120, 300, 0];                   // seconds of trace behind the runner; 0: all of it
const ERR = { pct: 20, s: 10 };                        // the split-times page's mistake rule
const TOL = 20;                                        // metres: a control is "reached" within this of the trace
const CAL_KEY = "ocn.an.cal";                          // localStorage: the positions, per race / circuit / runner / image
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const MAX_SIDE = 4200;                                 // a PDF page rendered at most this wide or high
const TRACE = "#3b0764";                               // the trace's default colour: a dark purple (owner, 2026-10-14)
const TRACE_PRESETS = ["#3b0764", "#c8102e", "#0b3d91", "#111111", "#ff6a00"];
const CHANNEL_LABEL = { hr: "an.ch.hr", cad: "an.ch.cad", ele: "an.ch.ele", temp: "an.ch.temp", pw: "an.ch.pw" };
const CHANNEL_UNIT = { hr: "bpm", cad: "", ele: "m", temp: "°C", pw: "W" };
const CHANNEL_COLOUR = { hr: "#d6336c", cad: "#1c80bb", ele: "#8a5a2b", temp: "#2a9d8f", pw: "#6f42c1" };
const WIDTHS = [[1, "an.width.thin"], [1.6, "an.width.normal"], [2.4, "an.width.thick"], [3.5, "an.width.thicker"]];   // × the trace's base widths
const PREFS_KEY = "ocn.an.prefs";                      // the playback's settings, kept on the device
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } }
const pace = (v) => (v > 0.05 ? `${Math.floor(1000 / v / 60)}'${String(Math.round((1000 / v) % 60)).padStart(2, "0")}` : "—");   // min/km from m/s
const signed = (s) => (s == null ? "—" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);
const detour = (dist, straight) => { const p = (100 * dist) / straight - 100; return `${p >= 0 ? "+" : "−"}${fmt(Math.abs(p))} %`; };
const tick = () => new Promise((r) => setTimeout(r, 30));

// ---- the precise calibration, with split times -----------------------------------------------------------------------
/**
 * pairs [{ tau (race seconds), px, py }] -> the similarity and the clock offset (the trace time of the race start).
 * guess: the offset already estimated (the results' start time, the trace's own passes); the search covers ± 15 min
 * around it, else the whole trace. fixed: an affine transform already known (a georeferenced map): then only the
 * offset is searched. Two pairs without a fixed geometry: the offset is the guess (or 0).
 */
function calibrate(tr, pairs, guess, fixed = null) {
  if (pairs.length < (fixed ? 1 : 2)) return null;
  const evaluate = fixed
    ? (d) => { let ss = 0; for (const p of pairs) { const [px, py] = toPx(fixed, ...posAt(tr, d + p.tau)); ss += (px - p.px) ** 2 + (py - p.py) ** 2; } return { ...fixed, rms: Math.sqrt(ss / pairs.length) }; }
    : (d) => fitSimilarity(pairs.map((p) => posAt(tr, d + p.tau)), pairs.map((p) => [p.px, p.py]));
  if (!fixed && pairs.length === 2) { const d = guess ?? 0; const f = evaluate(d); return f && { fit: f, offset: d, rms: f.rms }; }
  const last = Math.max(...pairs.map((p) => p.tau));
  const lo = guess != null ? guess - 900 : Math.min(0, tr.dur - last) - 60, hi = guess != null ? guess + 900 : Math.max(0, tr.dur - last) + 60;
  let best = null;
  for (let d = lo; d <= hi; d += 1) { const f = evaluate(d); if (f && (!best || f.rms < best.rms)) best = { fit: f, offset: d, rms: f.rms }; }
  if (!best) return null;
  for (let d = best.offset - 1; d <= best.offset + 1; d += 0.1) { const f = evaluate(d); if (f && f.rms < best.rms) best = { fit: f, offset: d, rms: f.rms }; }
  return best;
}
/** Two increasing time sequences matched by dynamic programming (gaps allowed): pairs [i, j] with |Δt| ≤ 240 s. */
function matchTimes(det, off, P = 120) {
  const m = det.length, n = off.length;
  const M = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const B = Array.from({ length: m + 1 }, () => new Int8Array(n + 1));
  M[0][0] = 0;
  for (let i = 1; i <= m; i++) { M[i][0] = i * P; B[i][0] = 1; }
  for (let j = 1; j <= n; j++) { M[0][j] = j * P; B[0][j] = 2; }
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = off[j - 1] == null ? Infinity : Math.abs(det[i - 1] - off[j - 1]);
    const d = M[i - 1][j - 1] + c, u = M[i - 1][j] + P, l = M[i][j - 1] + P;
    if (d <= u && d <= l) { M[i][j] = d; B[i][j] = 0; } else if (u <= l) { M[i][j] = u; B[i][j] = 1; } else { M[i][j] = l; B[i][j] = 2; }
  }
  const pairs = [];
  for (let i = m, j = n; i > 0 || j > 0;) {
    const b = B[i][j];
    if (b === 0) { if (Math.abs(det[i - 1] - off[j - 1]) <= 240) pairs.push([i - 1, j - 1]); i--; j--; } else if (b === 1) i--; else j--;
  }
  return pairs.reverse();
}

/** Paris's offset to UTC on a day (ms): the results' start times are wall-clock, the trace's are UTC. */
function parisOffsetMs(dateIso) {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const h = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).formatToParts(d).find((p) => p.type === "hour").value;
  return (h - 12) * 3600e3;
}
const parisDay = (ms) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// ---- the files ------------------------------------------------------------------------------------------------------
async function readMap(file) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    let pdfjs;
    try { pdfjs = await import(/* webpackIgnore: true */ PDFJS); } catch (e) { throw new Error("pdf"); }
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await pdf.getPage(1);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SIDE / v1.width, MAX_SIDE / v1.height, 6);
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      return c;
    } catch (e) { throw new Error("pdf"); }
  }
  try { return await createImageBitmap(file); } catch (e) { throw new Error("map"); }
}
const isImage = (f) => /\.(png|jpe?g|webp|gif|bmp|pdf)$/i.test(f.name) || f.type.startsWith("image/") || f.type === "application/pdf";
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.kmz,.kml,.gpx,.tcx,.fit,.xml,.jgw,.pgw,.tfw,.gfw,.bpw,.wld,.prj,image/*,application/pdf";

// ---- the memory between visits ---------------------------------------------------------------------------------------
// The files and the work stay while the site is open: a visit to another page and back finds the map, the trace and the
// course read on it as they were (memo, in memory). The files themselves are also kept in the browser's IndexedDB for
// the tab's session (a tag in sessionStorage: a reload recovers them, a new tab does not), never sent; « Oublier les
// fichiers » drops them. The calibration (the controls' positions, the geometry found) is in localStorage, so a finished
// calibration comes back as it was left rather than being redone — the controls placed by hand included.
let memo = null;
const DB = "ocn-analyse", STORE = "files";
function idbOpen() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbWrite(value) {
  const db = await idbOpen();
  await new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); if (value) tx.objectStore(STORE).put(value, "files"); else tx.objectStore(STORE).delete("files"); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}
async function idbRead() {
  const db = await idbOpen();
  const v = await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get("files"); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  db.close();
  return v;
}
function sessionTag() {
  try {
    let tag = sessionStorage.getItem("ocn.an.tag");
    if (!tag) { tag = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("ocn.an.tag", tag); }
    return tag;
  } catch (e) { return null; }
}

// ---- the page -------------------------------------------------------------------------------------------------------
export async function render(main, { query = {} } = {}) {
  const me = auth.session();
  const idx = await getProv("index.json");
  const races = (idx?.races || []).filter((r) => r.docs && !r.soon).sort((a, b) => b.date_iso.localeCompare(a.date_iso));
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("an.title")}</h1><p class="lede">${t("an.lede")}</p></div></div>
    <ol class="dep-steps" id="an-steps"></ol>
    <div class="filters" id="an-pick"></div>
    <section class="card" id="an-files"></section>
    <div class="an-brief" id="an-brief" hidden></div>
    <div id="an-work" hidden>
      <div class="an-layout">
        <div class="an-map"><canvas id="an-canvas"></canvas>
          <div class="an-tools"><button type="button" class="btn btn-sm" id="an-zin" title="+">+</button><button type="button" class="btn btn-sm" id="an-zout" title="−">−</button>
            <button type="button" class="btn btn-sm" id="an-fit" title="${t("an.fitTrace")}">⤢</button><button type="button" class="btn btn-sm" id="an-map" title="${t("an.fitMap")}">▭</button></div>
          <div class="an-hud" id="an-hud"></div></div>
        <aside class="an-side" id="an-side"></aside>
      </div>
      <div class="card an-strip-card" id="an-strip-card" hidden><div class="an-strip-head"><span class="hint">${t("an.strip.hint")}</span><div class="an-chips" id="an-chips"></div></div>
        <canvas id="an-strip"></canvas></div>
      <section class="card" id="an-legs" hidden></section>
    </div>`;
  if (!races.length) {
    $("#an-pick").innerHTML = html`<div class="empty">${t("an.none")}</div>`;
    return { title: t("an.title") };
  }

  // ---- state
  // the race, circuit and runner of the last visit (the menu's link carries no query): the tab's session remembers them
  const selKey = "ocn.an.sel";
  if (!query.course) { try { const sel = JSON.parse(sessionStorage.getItem(selKey) || "null"); if (sel?.course && races.some((r) => r.key === sel.course)) query = { ...sel, ...query }; } catch (e) { /* none */ } }
  let key = races.some((r) => r.key === query.course) ? query.course : (races.find((r) => (r.lics || []).includes(me?.lic)) || races[0]).key;
  let race = null, docs = [], di = 0, ci = 0, ri = 0;
  let map = null, track = null;
  const files = { map: null, trace: null, geo: null, world: null, prj: null, iof: null };     // { name, note, ... } per role
  let iofIndex = 0, northUp = true, restoredFiles = false;
  let course = null, courseCache = null, geoFit = null, geoHow = "", auto = null, prepToken = 0, status = "";
  let targets = [], cur = 0, fit = null, offset = null, rmsM = null, calibrated = false, mode = "auto", notes = [];
  const prefs = loadPrefs();
  let view = { k: 1, ox: 0, oy: 0 }, follow = !!prefs.follow, colour = prefs.colour === "speed" ? "speed" : "plain", marks = true, tail = TAILS.includes(prefs.tail) ? prefs.tail : 60, speed = 10, playing = false, tNow = 0;
  let width = WIDTHS.some(([w]) => w === prefs.width) ? prefs.width : 2.4;              // the trace's thickness, × the base
  let traceColour = /^#[0-9a-f]{6}$/i.test(prefs.traceColour || "") ? prefs.traceColour : TRACE;
  let chans = new Set(Array.isArray(prefs.chans) ? prefs.chans : ["pace", "hr"]);        // the curves under the map
  const pct = (v, d) => (Number.isFinite(v) && v >= 10 && v <= 100 ? v : d);
  let mapAlpha = pct(prefs.mapAlpha, 100), traceAlpha = pct(prefs.traceAlpha, 100);     // the map's and the trace's opacity, %
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ follow, colour, tail, width, chans: [...chans], mapAlpha, traceAlpha, traceColour })); } catch (e) { /* not kept */ } };
  /** Whether the sequence of controls is known complete: the published split times or a course file give it. A course
   *  read on the map alone may miss controls, and legs numbered from what was found would mislead. */
  const sequenceKnown = () => !!officialTaus() || !!(files.iof?.data?.courses[iofIndex]);
  let legs = [], total = 0, raf = 0, last = 0, pxs = null, pys = null, fullPath = null, scrubbing = false;
  let vLo = 0, vHi = 1;                               // the pace colours' range (10-90 % of the trace's speeds)
  const canvas = $("#an-canvas"), ctx = canvas.getContext("2d");
  const strip = $("#an-strip"), sctx = strip.getContext("2d");

  const steps = (n) => { $("#an-steps").innerHTML = html`${[t("an.s1"), t("an.s2"), t("an.s3"), t("an.s4")].map((s, i) => html`<li class="${i + 1 < n ? "done" : i + 1 === n ? "now" : ""}"><b>${i + 1}</b> ${s}</li>`)}`; };
  const stage = () => (!map || !track ? 2 : calibrated ? 4 : 3);
  const runner = () => docs[di]?.classes[ci]?.runners[ri], klass = () => docs[di]?.classes[ci];
  /** The runner's official sequence of race times: start, the controls, the finish (null where unknown), or null. */
  const officialTaus = () => { const r = runner(); if (!r?.splits) return null; return [0, ...r.splits, r.status === "ok" && r.time_s != null ? r.time_s : null]; };
  const totalOfficial = () => { const r = runner(); return r && r.status === "ok" && r.time_s != null ? r.time_s : null; };

  // ---- 1. the race, the circuit, the runner
  async function loadRace() {
    race = await getProv(`${encodeURIComponent(key)}.json`);
    docs = (race?.docs || []).filter((d) => d.classes?.length && d.by !== "category");
    const rank = (d) => (d.classes.some((k) => k.runners.some((r) => r.splits)) ? 1e9 : 0) + (d.prio ?? 0);
    docs.sort((a, b) => rank(b) - rank(a));
    const wanted = query.r || null;
    const pick = (test) => { for (let i = 0; i < docs.length; i++) for (let j = 0; j < docs[i].classes.length; j++) {
      const n = docs[i].classes[j].runners.findIndex(test); if (n >= 0) return [i, j, n]; } return null; };
    [di, ci, ri] = (wanted && pick((r) => r.name === wanted)) || (me && pick((r) => r.lic && r.lic === me.lic)) || [0, 0, 0];
    if (Number.isInteger(Number(query.doc)) && docs[Number(query.doc)] && !wanted) { di = Number(query.doc); ci = Math.min(Number(query.c) || 0, docs[di].classes.length - 1); ri = 0; }
    if (query.r && docs[di]?.classes[ci]) { const n = docs[di].classes[ci].runners.findIndex((r) => r.name === query.r); if (n >= 0) ri = n; }
  }
  function pickers() {
    const k = klass();
    $("#an-pick").innerHTML = html`
      <label class="field"><span>${t("prov.race")}</span><select id="an-race" style="max-width:420px">${races.map((r) => html`<option value="${r.key}" ${raw(r.key === key ? "selected" : "")}>${fmtDate(r.date_iso, "short")} · ${r.name}${r.splits ? "" : ` (${t("an.noSplitsShort")})`}</option>`)}</select></label>
      ${docs.length > 1 ? html`<label class="field"><span>${t("prov.doc")}</span><select id="an-doc" style="max-width:320px">${docs.map((d, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${d.source} · ${d.title || decodeURIComponent((d.url || "").split("/").pop())}</option>`)}</select></label>` : ""}
      ${docs.length ? html`<label class="field"><span>${t("prov.circuit")}</span><select id="an-c">${docs[di].classes.map((x, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")}>${x.name} (${x.runners.length})</option>`)}</select></label>
      <label class="field"><span>${t("prov.runner")}</span><select id="an-r" style="max-width:300px">${k.runners.map((r, i) => html`<option value="${i}" ${raw(i === ri ? "selected" : "")}>${r.place ? `${r.place}. ` : ""}${r.name}${r.club ? ` (${r.club})` : ""}${r.splits ? "" : ` — ${t("an.noSplitsShort")}`}</option>`)}</select></label>`
      : html`<div class="field"><span></span><span class="muted">${t("an.noList")}</span></div>`}`;
    $("#an-race").addEventListener("change", async (e) => { key = e.target.value; query = {}; await loadRace(); pickers(); setup(); });
    $("#an-doc")?.addEventListener("change", (e) => { di = Number(e.target.value); ci = 0; ri = 0; pickers(); setup(); });
    $("#an-c")?.addEventListener("change", (e) => { ci = Number(e.target.value); ri = 0; pickers(); setup(); });
    $("#an-r")?.addEventListener("change", (e) => { ri = Number(e.target.value); pickers(); setup(); });
    replaceQuery({ course: key, doc: di || null, c: ci || null, r: runner()?.name || null });
    try { sessionStorage.setItem(selKey, JSON.stringify({ course: key, doc: di || null, c: ci || null, r: runner()?.name || null })); } catch (e) { /* not kept */ }
  }

  // ---- 2. the files
  function filesCard() {
    const row = (role, f, extra = "") => html`<tr><th>${t(`an.role.${role}`)}</th><td>${f ? html`<b>${f.name}</b>${f.detail ? html` <span class="muted">· ${f.detail}</span>` : ""}` : html`<span class="muted">${t(`an.role.${role}.none`)}</span>`}${extra}
      ${f?.note ? html`<div class="notice" style="margin-top:4px">${f.note}</div>` : ""}</td></tr>`;
    const iof = files.iof;
    const courseSel = iof?.data?.courses?.length > 1 ? html` <select id="an-iof-course" style="margin-left:8px">${iof.data.courses.map((c, i) => html`<option value="${i}" ${raw(i === iofIndex ? "selected" : "")}>${c.name || `#${i + 1}`}${c.length ? ` · ${fmt(c.length / 1000, 1)} km` : ""}</option>`)}</select>` : "";
    $("#an-files").innerHTML = html`<div class="card-body">
      <label class="dropzone an-drop" id="an-drop"><input type="file" id="an-in" multiple hidden accept="${ACCEPT}">
        <strong>${t("an.drop")}</strong><span class="muted">${t("an.drop.hint")}</span></label>
      <table class="data compact an-filelist"><tbody>
        ${row("map", files.map)}${row("trace", files.trace)}${row("geo", files.geo || files.world, files.world && files.prj ? html` <span class="muted">+ ${files.prj.name}</span>` : "")}${row("iof", files.iof, courseSel)}
      </tbody></table>
      <p class="muted" style="font-size:13px;margin:10px 0 0">${t("an.private")}${restoredFiles ? html` <span class="pill">${t("an.files.kept")}</span>` : ""}
        ${files.map || files.trace ? html` <button type="button" class="btn btn-sm" id="an-forget" style="margin-left:8px">${t("an.forget")}</button>` : ""}</p>
      <details class="an-formats"><summary>${t("an.formats")}</summary><ul>
        <li>${t("an.formats.map")}</li><li>${t("an.formats.trace")}</li><li>${t("an.formats.geo")}</li><li>${t("an.formats.iof")}</li><li>${t("an.formats.ocad")}</li></ul></details>
      </div>`;
    $("#an-in").addEventListener("change", (e) => { take([...e.target.files]); e.target.value = ""; });
    $("#an-forget")?.addEventListener("click", () => {
      stop();
      for (const role of Object.keys(files)) files[role] = null;
      map = null; track = null; courseCache = null; course = null; restoredFiles = false; memo = null;
      idbWrite(null).catch(() => {});
      filesCard(); setup();
    });
    const drop = $("#an-drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take([...e.dataTransfer.files]); });
    $("#an-iof-course")?.addEventListener("change", (e) => { iofIndex = Number(e.target.value); setup(); });
  }
  async function take(list, { remember = true } = {}) {
    for (const f of list) {
      const name = f.name, low = name.toLowerCase();
      for (const role of Object.keys(files)) if (files[role]?.file === f) files[role] = null;
      try {
        if (isTraceName(name)) {
          files.trace = { name, note: "" };
          filesCard();
          track = parseTrace(name, await f.arrayBuffer());
          files.trace.detail = `${t(`an.src.${track.source}`)} · ${fmt(track.n)} ${t("an.points")} · ${clock(track.dur)}${Object.keys(track.ch).filter((c) => c !== "ele").length ? ` · ${Object.keys(track.ch).filter((c) => c !== "ele").map((c) => t(CHANNEL_LABEL[c])).join(", ")}` : ""}`;
          if (race?.date_iso) { const day = parisDay(track.ms0); if (day !== race.date_iso) files.trace.note = t("an.date.diff", { d1: fmtDate(day), d2: fmtDate(race.date_iso) }); }
        } else if (low.endsWith(".kmz")) {
          files.geo = { name, note: t("an.reading") }; filesCard();
          const entries = await readZip(await f.arrayBuffer());
          const kml = entries.find((e) => /\.kml$/i.test(e.name));
          const ovs = kml ? parseKml(new TextDecoder().decode(kml.data)) : [];
          if (!ovs.length) throw new Error("kmz");
          const ov = ovs[0], img = entries.find((e) => e.name.toLowerCase() === ov.href.toLowerCase().replace(/^\.\//, "")) || entries.find((e) => /\.(png|jpe?g|webp|gif)$/i.test(e.name));
          files.geo = { name, kind: "kmz", overlay: ov, note: "", detail: ov.quad ? "LatLonQuad" : `LatLonBox${ov.box.rot ? ` · ${fmt(ov.box.rot, 1)}°` : ""}` };
          if (img) { map = await createImageBitmap(new Blob([img.data])); files.map = { name: `${name} › ${img.name}`, note: "", detail: `${map.width} × ${map.height}` }; courseCache = null; }
          else files.geo.note = t("an.kmz.noImage");
        } else if (low.endsWith(".kml")) {
          const ovs = parseKml(await f.text());
          if (!ovs.length) throw new Error("kml");
          files.geo = { name, kind: "kml", overlay: ovs[0], note: "", detail: ovs[0].href ? `→ ${ovs[0].href}` : "" };
        } else if (isWorldFileName(name)) {
          const wf = parseWorldFile(await f.text());
          if (!wf) throw new Error("world");
          files.world = { name, wf, note: "" }; files.geo = null;
        } else if (low.endsWith(".prj")) {
          const crs = crsFromWkt(await f.text());
          files.prj = { name, crs, note: crs ? "" : t("an.prj.unknown"), detail: crs?.name || "" };
        } else if (low.endsWith(".xml")) {
          const text = await f.text();
          const data = parseIofCourse(text);
          if (data) { files.iof = { name, data, note: data.courses.length ? "" : t("an.iof.noCourse"), detail: `${data.courses.length} ${t("an.iof.courses")} · ${data.controls.size} ${t("prov.controls")}${[...data.controls.values()].some((c) => c.lat != null) ? ` · ${t("an.iof.geo")}` : ""}` }; iofIndex = pickCourse(data); }
          else if (/<gpx[\s>]/.test(text)) { files.trace = { name, note: "" }; track = parseTrace(name, new TextEncoder().encode(text).buffer); files.trace.detail = `GPX · ${fmt(track.n)} ${t("an.points")}`; }
          else throw new Error("xml");
        } else if (isImage(f)) {
          files.map = { name, note: t("an.reading") }; filesCard();
          map = await readMap(f); courseCache = null;
          files.map = { name, note: "", detail: `${map.width} × ${map.height}` };
        } else { notes.push(t("an.err.type", { f: name })); }
      } catch (e) {
        e.__role = true;
        const msg = { time: "an.err.time", gpx: "an.err.gpx", pdf: "an.err.pdf", map: "an.err.map", kmz: "an.err.kmz", kml: "an.err.kml", world: "an.err.world", xml: "an.err.xml" }[e.message] || "an.err.gpx";
        if (isTraceName(name) || e.message === "time" || e.message === "gpx") { track = null; files.trace = { name, note: t(msg) }; }
        else if (low.endsWith(".kmz") || low.endsWith(".kml")) files.geo = { name, note: t(msg) };
        else if (isWorldFileName(name)) files.world = { name, note: t(msg) };
        else if (low.endsWith(".xml")) files.iof = { name, note: t(msg) };
        else { map = null; files.map = { name, note: t(msg) }; }
      }
      // the file itself, with its role (a KMZ gives both the map and its georeferencing)
      for (const role of Object.keys(files)) { const rec = files[role]; if (rec && !rec.file && (rec.name === name || rec.name?.startsWith(`${name} › `))) rec.file = f; }
    }
    if (remember) rememberFiles();
    filesCard();
    setup();
  }
  /** The files kept for the tab's session, in IndexedDB (never sent). */
  function rememberFiles() {
    const tag = sessionTag();
    if (!tag) return;
    const seen = new Set(), entries = [];
    for (const role of Object.keys(files)) { const f = files[role]?.file; if (f && !seen.has(f)) { seen.add(f); entries.push({ role, name: f.name, type: f.type, blob: f }); } }
    idbWrite(entries.length ? { tag, at: Date.now(), entries } : null).catch(() => {});
  }
  /** The files of the last visit of this tab, read again. */
  async function restoreFromIdb() {
    const tag = sessionTag();
    let rec = null;
    try { rec = await idbRead(); } catch (e) { return; }
    if (!rec || rec.tag !== tag || !rec.entries?.length || map || track) return;
    restoredFiles = true;
    await take(rec.entries.map((e) => new File([e.blob], e.name, { type: e.type })), { remember: false });
  }
  /** The course of the IOF file to use: the one named like the circuit, else the first. */
  function pickCourse(data) {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const want = norm(klass()?.name);
    const i = want ? data.courses.findIndex((c) => norm(c.name) === want || (norm(c.name) && want.includes(norm(c.name)))) : -1;
    return i >= 0 ? i : 0;
  }

  // ---- 3. the calibration ------------------------------------------------------------------------------------------
  function setup() {
    stop();
    calibrated = false; fit = null; offset = null; rmsM = null; auto = null; mode = "auto"; targets = []; cur = 0; tNow = 0;
    vLo = 0; vHi = 1;
    hideResults();
    const r = runner();
    const work = $("#an-work");
    work.hidden = !(map && track && r);
    steps(stage());
    if (work.hidden) return;
    size();
    fitView();
    prepare();
  }
  const hideResults = () => { $("#an-legs").hidden = true; $("#an-strip-card").hidden = true; $("#an-hud").textContent = ""; showPanels(true); document.body.classList.remove("an-theatre"); };
  /** During the playback the race's pickers and the files card give way to one line (owner, 2026-10-14). */
  function showPanels(on) {
    $("#an-pick").hidden = !on; $("#an-files").hidden = !on;
    const brief = $("#an-brief");
    brief.hidden = on;
    if (on) return;
    const r = runner(), rc = races.find((x) => x.key === key);
    brief.innerHTML = html`<button type="button" class="btn btn-sm" id="an-brief-edit">← ${t("an.brief.edit")}</button>
      <span><b>${rc?.name || ""}</b> · ${klass()?.name || ""} · ${r?.name || ""}</span>
      <span class="muted">${[files.map?.name, files.trace?.name, files.geo?.name || files.world?.name, files.iof?.name].filter(Boolean).join(" · ")}</span>`;
    $("#an-brief-edit").addEventListener("click", leavePlayback);
  }
  const setStatus = (s) => { status = s; side(); };
  const calKey = () => `${CAL_KEY}.${key}.${di}.${ci}.${runner()?.name}.${map?.width}x${map?.height}`;
  function savePositions(done = calibrated) {
    const rec = { v: 2, done, items: targets.map((g) => ({ kind: g.kind, code: g.code || "", pos: g.pos || null })),
      fit: fit && !geoFit ? { kind: fit.kind, m11: fit.m11, m12: fit.m12, m21: fit.m21, m22: fit.m22, tx: fit.tx, ty: fit.ty, scale: fit.scale, rotation: fit.rotation } : null };
    try { localStorage.setItem(calKey(), JSON.stringify(rec)); } catch (e) { /* not kept */ }
  }
  function savedPositions() { try { const r = JSON.parse(localStorage.getItem(calKey()) || "null"); return r && r.v === 2 && Array.isArray(r.items) ? r : null; } catch (e) { return null; } }
  /** The offset the results' start time gives: the trace's time at the race start (seconds), if the start is known. */
  /** A runner's published start (seconds after midnight, Paris), from any list of the race (liveresultat's gives it
   *  when the organiser's does not), or null. */
  function startOf(r) {
    if (!r) return null;
    if (r.start_s != null) return r.start_s;
    const key = (n) => (n || "").toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").sort().join(" ");
    let startS = null;
    for (const d of race?.docs || []) for (const k of d.classes || []) for (const x of k.runners) if (x.start_s != null && key(x.name) === key(r.name)) startS = x.start_s;
    return startS;
  }
  function guessOffset() {
    const r = runner(), startS = startOf(r);
    if (startS == null || !race?.date_iso) return null;
    const startMs = Date.parse(`${race.date_iso}T00:00:00Z`) - parisOffsetMs(race.date_iso) + startS * 1000;
    return (startMs - track.ms0) / 1000;
  }
  /** The trace's first point as a Paris time of day (seconds after midnight). */
  const traceStartS = () => { const p = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(track.ms0)); const g = (x) => +p.find((q) => q.type === x).value; return g("hour") * 3600 + g("minute") * 60 + g("second"); };
  const hhmm = (s) => `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  /** Whose trace is this? The selected runner, unless they did not start or their published start does not fit the
   *  trace's beginning (the watch starts a few minutes before the gun at most): then the classified runner whose
   *  start fits best, if any — the trace of a relative dropped under one's own name (owner, 2026-10-14). */
  function whoseTrace() {
    if (!track || !race) return null;
    const t0 = traceStartS(), r = runner(), fits = (s) => s != null && s - t0 >= -120 && s - t0 <= 900;
    const mine = startOf(r);
    if (r?.status !== "dns" && (mine == null || fits(mine))) return null;
    let best = null;
    docs.forEach((d, i) => d.classes.forEach((k, j) => k.runners.forEach((x, n) => {
      if (x.status !== "ok" || x === r) return;
      const s = startOf(x);
      if (!fits(s) || (best && Math.abs(s - t0) >= Math.abs(best.start - t0))) return;
      best = { name: x.name, di: i, ci: j, ri: n, start: s };
    })));
    return { t0, mine, dns: r?.status === "dns", other: best };
  }
  const ptsOf = (gs) => gs.map((g) => ({ x: g.pos[0], y: g.pos[1], kind: g.kind }));

  /** The automatic calibration: read the course, place the trace, order the controls, refine with the split times. */
  async function prepare({ fresh = false } = {}) {
    const my = ++prepToken;
    notes = [];
    mode = "auto";
    if (fresh) { try { localStorage.removeItem(calKey()); } catch (e) { /* nothing kept */ } }
    setStatus(t("an.st.reading"));
    await tick();
    if (!courseCache || courseCache.image !== map) {
      let c = null;
      try { c = await detectCourse(map); } catch (e) { console.error(e); }
      courseCache = { image: map, course: c };
    }
    if (my !== prepToken) return;
    course = courseCache.course;
    if (!course) notes.push(t("an.st.noCourse"));
    // the georeferencing
    geoFit = null; geoHow = "";
    const W = map.width, H = map.height;
    if (files.geo?.overlay) { geoFit = fitFromKml(files.geo.overlay, W, H, track); geoHow = files.geo.kind.toUpperCase(); }
    else if (files.world?.wf) {
      const crs = files.prj?.crs || guessCrs(files.world.wf[4], files.world.wf[5], track.lon0);
      if (!crs) notes.push(t("an.geo.noCrs"));
      else { geoFit = fitFromWorld(files.world.wf, crs, W, H, track); geoHow = `${t("an.geo.world")} · ${crs.name}`; }
    }
    if (geoFit) {
      const [mx, my_] = toM(geoFit, W / 2, H / 2);
      if (Math.hypot(mx - track.x[0], my_ - track.y[0]) > 30000) { notes.push(t("an.geo.far")); geoFit = null; geoHow = ""; }
    }
    // a calibration kept from an earlier visit: back as it was left, the controls placed by hand included
    const kept = fresh ? null : savedPositions();
    if (kept && kept.items.some((s) => s.pos)) {
      const taus = officialTaus();
      if (taus) { targets = officialTargets(null); if (kept.items.length === targets.length) kept.items.forEach((s, i) => { targets[i].pos = s.pos; }); }
      else targets = kept.items.map((s, i) => ({ i, kind: s.kind, code: s.code || "", pos: s.pos, tau: null, tEst: null, label: s.kind === "start" ? t("an.start") : s.kind === "finish" ? t("an.finish") : "" }));
      const geometry = geoFit || (kept.fit ? { ...kept.fit } : null);
      notes.push(t("an.st.restored"));
      recompute({ geometry });
      cur = nextTarget(0);
      side(); draw();
      if (kept.done && fit && offset != null) finish();
      return;
    }
    // the course's points
    const pts = [];
    const iofData = files.iof?.data, iofCourse = iofData?.courses[iofIndex] || null;
    const r = course?.r || null;
    if (iofCourse) {
      const seq = iofCourse.controls.map((cc) => ({ ...(iofData.controls.get(cc.id) || { id: cc.id }), type: cc.type }));
      const circles = [...(course?.controls || []).map((c) => [c.x, c.y]), ...(course?.start ? [[course.start.x, course.start.y]] : []), ...(course?.finish ? [[course.finish.x, course.finish.y]] : [])];
      const withMm = seq.filter((c) => c.mx != null && c.my != null);
      let mmFit = null;
      if (withMm.length >= 3 && circles.length >= 3) {
        const src = withMm.map((c) => [c.mx, -c.my]);
        const ext = (A, k) => Math.max(...A.map((p) => p[k])) - Math.min(...A.map((p) => p[k]));
        const s0 = Math.hypot(ext(circles, 0), ext(circles, 1)) / Math.max(1e-6, Math.hypot(ext(src, 0), ext(src, 1)));
        const reg = registerPoints(src, circles, Math.max(8, 0.7 * (r || 20)), { scaleRange: [s0 / 3, s0 * 3], rotRange: (15 * Math.PI) / 180, minInliers: Math.max(3, Math.ceil(0.5 * withMm.length)) });
        if (reg) mmFit = reg.fit;
      }
      if (!mmFit && iofData.map.tl && iofData.map.br) {      // the image is the whole map
        const [lx, ty] = iofData.map.tl, [rx, by] = iofData.map.br;
        if (rx !== lx && ty !== by) mmFit = { m11: W / (rx - lx), m12: 0, m21: 0, m22: H / (ty - by), tx: (-W * lx) / (rx - lx), ty: (H * ty) / (ty - by), scale: W / (rx - lx) };
      }
      if (!mmFit) notes.push(t("an.iof.noPlace"));
      for (const c of seq) {
        let pos = mmFit && c.mx != null ? toPx(mmFit, c.mx, -c.my) : null;
        if (pos && r) { const near = circles.map((q) => [Math.hypot(q[0] - pos[0], q[1] - pos[1]), q]).sort((a, b) => a[0] - b[0])[0]; if (near && near[0] <= 0.8 * r) pos = near[1]; }
        pts.push({ kind: c.type === "Start" ? "start" : c.type === "Finish" ? "finish" : "control", code: c.type === "Control" ? c.id : "", pos, lat: c.lat, lon: c.lon });
      }
      const geo = pts.filter((p) => p.pos && p.lat != null && p.lon != null);
      if (!geoFit && geo.length >= 3) { geoFit = fitSimilarity(geo.map((p) => toLocal(track, p.lat, p.lon)), geo.map((p) => p.pos)); geoHow = "IOF XML"; }
    } else if (course) {
      if (course.start) pts.push({ kind: "start", code: "", pos: [course.start.x, course.start.y] });
      for (const c of course.controls) pts.push({ kind: "control", code: "", pos: [c.x, c.y] });
      if (course.finish) pts.push({ kind: "finish", code: "", pos: [course.finish.x, course.finish.y] });
    }
    // the geometry
    let located = pts.filter((p) => p.pos);
    let geometry = geoFit;
    auto = null;
    if (!geometry && located.length >= 3) {
      setStatus(t("an.st.aligning"));
      await tick();
      if (my !== prepToken) return;
      auto = alignTrack(track, ptsOf(located), { rStar: r, northUp, tol: TOL });
      geometry = auto?.fit || null;
      if (!auto) notes.push(t("an.st.noAlign"));
    } else if (!geometry) notes.push(t("an.st.fewPoints", { n: located.length }));
    // the rings the first pass missed: where the trace turns sharply and no control is placed, look again
    if (geometry && course?.probe && !iofCourse) {
      const added = probeTurns(geometry, located);
      if (added.length) {
        pts.push(...added.filter((a) => !pts.some((p) => p.pos && Math.hypot(p.pos[0] - a.pos[0], p.pos[1] - a.pos[1]) < 1.5 * r)));
        located = pts.filter((p) => p.pos);
        if (!geoFit) { const again = alignTrack(track, ptsOf(located), { rStar: r, northUp, tol: TOL }); if (again && again.inliers > (auto?.inliers || 0)) { auto = again; geometry = again.fit; } }
        notes.push(t("an.st.probed", { n: added.length }));
      }
    }
    // the targets: in the course's order (IOF), else in the trace's visiting order
    const saved = savedPositions();
    if (!geometry) {
      targets = iofCourse ? pts.map((p, i) => ({ i, label: p.kind === "start" ? t("an.start") : p.kind === "finish" ? t("an.finish") : String(pts.slice(0, i).filter((q) => q.kind === "control").length + 1), ...p, tau: null, tEst: null }))
        : officialTargets(null);
      if (saved) restorePositions(saved);
      mode = "manual"; cur = nextTarget(0);
      recompute();
      side(); draw();
      return;
    }
    const vo = visitOrder(track, geometry, ptsOf(located), TOL);
    const passOf = (p) => { const i = located.indexOf(p); return i >= 0 && vo.pass.has(i) ? vo.pass.get(i) : null; };
    // two circles passed within 15 s are not two controls (a leg takes longer): the second is a phantom
    let prevT = -Infinity;
    const visited = vo.order.map((i) => located[i]).map((p) => { const tp = passOf(p); const ok = tp == null || tp - prevT >= 15; if (ok && tp != null) prevT = tp; return ok ? p : { ...p, missed: true }; });
    const slot = (kind) => pts.find((p) => p.kind === kind) || { kind, code: "", pos: null };
    const ordered = iofCourse ? pts : [slot("start"), ...visited, ...located.filter((p, i) => p.kind === "control" && !vo.order.includes(i)).map((p) => ({ ...p, missed: true })), slot("finish")];
    let seqTargets = ordered.map((p, i) => ({ i, kind: p.kind, code: p.code, pos: p.pos, tEst: passOf(p), tau: null, missed: !!p.missed,
      label: p.kind === "start" ? t("an.start") : p.kind === "finish" ? t("an.finish") : p.missed ? "?" : String(ordered.slice(0, i).filter((q) => q.kind === "control" && !q.missed).length + 1) }));
    const taus = officialTaus();
    if (taus) {
      // the official sequence, each control placed by the detected one that passed at its time
      const off = [], det = seqTargets.filter((g) => g.kind === "control" && g.tEst != null);
      const startT = vo.startT ?? (vo.finishT != null && totalOfficial() ? vo.finishT - totalOfficial() : null);
      const ctrlTaus = taus.slice(1, -1);
      const shift = startT != null ? startT : (det.length && ctrlTaus.some((x) => x != null) ? median(det.map((g) => g.tEst)) - median(ctrlTaus.filter((x) => x != null)) : 0);
      for (const g of seqTargets) if (g.kind === "control") off.push(g);
      // the pairs, with the clock shift re-estimated twice from the pairs themselves (a phantom circle passed early
      // would otherwise hijack a control), then the pairs far from the shift dropped
      let pairs = matchTimes(det.map((g) => g.tEst - shift), ctrlTaus), sh = shift;
      for (let it = 0; it < 2 && pairs.length >= 3; it++) {
        sh = sh + median(pairs.map(([a, b]) => det[a].tEst - sh - ctrlTaus[b]));
        pairs = matchTimes(det.map((g) => g.tEst - sh), ctrlTaus);
      }
      if (pairs.length >= 3) { const res = pairs.map(([a, b]) => det[a].tEst - sh - ctrlTaus[b]), md = median(res); pairs = pairs.filter((p, i) => Math.abs(res[i] - md) <= 60); }
      targets = officialTargets(null);
      for (const [a, b] of pairs) { targets[b + 1].pos = det[a].pos; targets[b + 1].tEst = det[a].tEst; }
      const st = seqTargets.find((g) => g.kind === "start"), fi = seqTargets.find((g) => g.kind === "finish");
      if (st?.pos) { targets[0].pos = st.pos; targets[0].tEst = st.tEst; }
      if (fi?.pos) { targets[targets.length - 1].pos = fi.pos; targets[targets.length - 1].tEst = fi.tEst; }
      if (!pairs.length && !st?.pos && !fi?.pos) notes.push(t("an.st.noMatch"));
    } else targets = seqTargets;
    savePositions();
    recompute({ geometry, vo });
    cur = nextTarget(0);
    side(); draw();
    if (fit && !notes.length && targets.filter((g) => g.pos).length >= 3) steps(3);
  }
  const median = (xs) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : 0; };
  /** The trace's sharp turns (over 50°) with no control placed nearby, probed on the map for a ring: the rings found. */
  function probeTurns(geometry, located) {
    const r = course.r, V = simplify(track.x, track.y, track.n, 10), out = [];
    const diff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    for (let k = 1; k < V.length - 1 && out.length < 40; k++) {
      const i = V[k], a = V[k - 1], b = V[k + 1];
      const ang = Math.abs(diff(Math.atan2(track.y[i] - track.y[a], track.x[i] - track.x[a]), Math.atan2(track.y[b] - track.y[i], track.x[b] - track.x[i])));
      if (ang < (50 * Math.PI) / 180) continue;
      const [px, py] = toPx(geometry, track.x[i], track.y[i]);
      if (px < 0 || py < 0 || px > map.width || py > map.height) continue;
      if (located.some((p) => Math.hypot(p.pos[0] - px, p.pos[1] - py) < 2.5 * r) || out.some((p) => Math.hypot(p.pos[0] - px, p.pos[1] - py) < 2.5 * r)) continue;
      const hit = course.probe(px, py, 2.5 * r);
      if (hit && hit.score >= 0.45 && hit.raw >= 0.3 && hit.inner <= 0.35 && hit.outer <= 0.5) out.push({ kind: "control", code: "", pos: [hit.x, hit.y], probed: true });
    }
    return out;
  }
  /** The official sequence of targets (start, the controls with their codes, the finish), positions from a saved set. */
  function officialTargets(saved) {
    const k = klass(), r = runner();
    const codes = k?.controls || [], n = Math.max(codes.length, r?.splits?.length || 0);
    const taus = officialTaus();
    const out = [{ i: 0, kind: "start", label: t("an.start"), code: "", tau: 0, tEst: null, pos: null }];
    for (let i = 0; i < n; i++) out.push({ i: i + 1, kind: "control", label: `${i + 1}`, code: codes[i] || "", tau: taus?.[i + 1] ?? null, tEst: null, pos: null });
    out.push({ i: n + 1, kind: "finish", label: t("an.finish"), code: "", tau: taus ? taus[n + 1] : null, tEst: null, pos: null });
    if (saved) restorePositions(saved, out);
    return out;
  }
  function restorePositions(saved, gs = targets) { if (saved?.items?.length === gs.length) saved.items.forEach((s, i) => { if (s?.pos) gs[i].pos = s.pos; }); }
  const nextTarget = (from) => { for (let i = from; i < targets.length; i++) if (!targets[i].pos && !targets[i].missed) return i; return -1; };
  /** The race time of a target: published, else the trace's own. */
  const timeOf = (g) => (g.tau != null ? g.tau : g.tEst != null && offset != null ? g.tEst - offset : null);

  /** The geometry and the clock from the targets as they stand: the split times when published, else the trace. */
  function recompute({ geometry = null, vo = null } = {}) {
    window.anDebug = () => ({ fit, offset, geoFit, targets, course, auto, view, mode, legs, total, place: placeClick, manual: () => { mode = "manual"; cur = nextTarget(0); if (cur < 0) cur = 0; side(); draw(); } });   // for support, in the console
    const located = targets.filter((g) => g.pos && !g.missed);
    const taus = officialTaus();
    fit = null; offset = null; rmsM = null;
    if (taus) {
      const pairs = targets.filter((g) => g.tau != null && g.pos && !g.missed).map((g) => ({ tau: g.tau, px: g.pos[0], py: g.pos[1] }));
      const guess = vo?.startT ?? guessOffset() ?? (geometry && located.length ? visitOrder(track, geometry, ptsOf(located), TOL).startT : null);
      const c = pairs.length >= (geoFit ? 1 : 2) ? calibrate(track, pairs, guess, geoFit) : null;
      if (c) { fit = c.fit; offset = c.offset; rmsM = c.rms / fit.scale; }
      else if (geoFit) { fit = geoFit; offset = guess; }
      if (fit && offset == null) { const v = visitOrder(track, fit, ptsOf(located), TOL); offset = v.startT; }
    } else {
      if (geoFit) fit = geoFit;
      else if (geometry) fit = geometry;
      else if (auto?.fit) fit = auto.fit;                                   // placed by hand: the geometry found stays
      else if (located.length >= 3) { auto = alignTrack(track, ptsOf(located), { rStar: course?.r || null, northUp, tol: TOL }); fit = auto?.fit || null; }
      if (fit) {
        const v = visitOrder(track, fit, ptsOf(located), TOL);
        located.forEach((g, i) => { g.tEst = v.pass.has(i) ? v.pass.get(i) : null; });
        // the controls in the trace's visiting order, the unreached ones after, then renumbered
        const ctrls = targets.filter((g) => g.kind === "control");
        const byTime = ctrls.filter((g) => g.pos && g.tEst != null && !g.missed).sort((a, b) => a.tEst - b.tEst);
        // two points passed within 15 s are one control (a leg takes longer): the second is set aside
        const reached = byTime.filter((g, i) => !i || g.tEst - byTime[i - 1].tEst >= 15), rest = ctrls.filter((g) => !reached.includes(g));
        targets = [...targets.filter((g) => g.kind === "start"), ...reached, ...rest, ...targets.filter((g) => g.kind === "finish")];
        let n = 0;
        targets.forEach((g, i) => { g.i = i; if (g.kind === "control") g.label = reached.includes(g) ? String(++n) : g.pos ? "?" : "+"; });
        const tot = totalOfficial();
        const firstPass = located.find((g) => g.kind === "control" && g.tEst != null)?.tEst ?? null;
        // the published start time first (the clock the results keep); else the start symbol's departure; else the
        // finish's arrival less the published total time; else the trace's own beginning when the first control comes
        // within 10 minutes (the watch started at the start), else the first control's pass
        let published = guessOffset();
        if (published != null && (runner()?.status === "dns" || (firstPass != null && (firstPass < published || firstPass - published > 1800)))) published = null;
        offset = published ?? v.startT ?? (v.finishT != null && tot ? v.finishT - tot : null) ?? (firstPass != null && firstPass <= 600 ? 0 : firstPass);
        rmsM = auto ? auto.rms / fit.scale : null;
      }
    }
    if (fit) {
      pxs = new Float64Array(track.n); pys = new Float64Array(track.n);
      fullPath = new Path2D();
      for (let i = 0; i < track.n; i++) {
        const [px, py] = toPx(fit, track.x[i], track.y[i]);
        pxs[i] = px; pys[i] = py;
        if (i) fullPath.lineTo(px, py); else fullPath.moveTo(px, py);
      }
      computeLegs();
    } else { pxs = pys = fullPath = null; legs = []; total = 0; }
  }
  /** The race in legs: times and ranks from the class's splits when published, else the trace's; lengths from the trace. */
  function computeLegs() {
    const k = klass(), r = runner();
    const times = targets.map(timeOf);
    const tot = totalOfficial();
    const lastT = [...times].reverse().find((x) => x != null);
    total = tot ?? lastT ?? Math.max(0, track.dur - (offset || 0));
    const n = targets.length - 1;
    const taus = officialTaus();
    let best = [], all = [], mine = [], med = null;
    if (taus) {
      const cumOf = (x) => Array.from({ length: n }, (_, i) => (i < n - 1 ? x.splits?.[i] ?? null : x.status === "ok" ? x.time_s : null));
      const legsOf = (x) => { const c = cumOf(x); return c.map((v, i) => (v != null && (i === 0 || c[i - 1] != null) ? v - (i ? c[i - 1] : 0) : null)); };
      all = k.runners.filter((x) => x.splits).map(legsOf);
      best = Array.from({ length: n }, (_, i) => { const v = all.map((l) => l[i]).filter((x) => x != null && x > 0); return v.length ? Math.min(...v) : null; });
      mine = legsOf(r);
      const ratios = mine.map((v, i) => (v != null && best[i] ? v / best[i] : null)).filter((x) => x != null).sort((a, b) => a - b);
      med = ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)] : null;
    } else mine = times.slice(1).map((v, i) => (v != null && times[i] != null ? v - times[i] : null));     // per leg
    legs = [];
    for (let i = 0; i < n; i++) {
      const from = targets[i], to = targets[i + 1], t0 = times[i], t1 = times[i + 1];
      const leg = { n: i + 1, code: to.code || "", label: to.label, t0, t1, time: mine[i], best: best[i] ?? null, rank: null, lost: null, mistake: false, dist: null, straight: null, v: null, hr: null, cad: null, estimated: !taus };
      if (taus && leg.time != null) leg.rank = 1 + all.filter((l) => l[i] != null && l[i] < leg.time).length;
      if (taus && leg.time != null && best[i] && med) { leg.lost = leg.time - best[i] * med; leg.mistake = leg.lost >= ERR.s && leg.lost >= (ERR.pct / 100) * leg.time; }
      if (fit && t0 != null && t1 != null && offset != null) {
        leg.dist = cumAt(track, offset + t1) - cumAt(track, offset + t0);
        const a = from.pos ? toM(fit, ...from.pos) : posAt(track, offset + t0), b = to.pos ? toM(fit, ...to.pos) : posAt(track, offset + t1);
        leg.straight = Math.hypot(a[0] - b[0], a[1] - b[1]);
        leg.v = leg.time > 0 ? leg.dist / leg.time : null;
        leg.hr = meanBetween(track, "hr", offset + t0, offset + t1);
        leg.cad = meanBetween(track, "cad", offset + t0, offset + t1);
      }
      legs.push(leg);
    }
  }

  function side() {
    steps(stage());
    if (calibrated) return;
    const taus = officialTaus(), r = runner();
    const placed = targets.filter((g) => g.pos && !g.missed).length, want = targets.filter((g) => !g.missed).length;
    const summary = [];
    if (status && !targets.length) summary.push(status);
    if (course) summary.push(t("an.st.found", { n: course.controls.length, s: course.start ? "✓" : "—", f: course.finish ? "✓" : "—" }));
    if (geoHow) summary.push(`${t("an.st.geo")} ${geoHow}`);
    else if (auto) summary.push(t("an.st.aligned", { m: targets.filter((g) => g.pos && !g.missed && g.tEst != null).length, n: placed, r: fmt(auto.rotationDeg, 1) }));
    if (taus) summary.push(t("an.st.official", { n: targets.filter((g) => g.pos && g.tau != null).length, t: targets.filter((g) => g.tau != null).length }));
    else if (r) summary.push(totalOfficial() ? t("an.st.totalOnly") : t("an.st.noTimes"));
    const whose = whoseTrace();
    const whoseNote = !whose ? "" : html`<div class="notice" style="margin-bottom:6px">${t("an.st.whose", { t: hhmm(whose.t0), r: runner()?.name || "", rs: whose.dns ? t("an.st.whose.dns") : whose.mine != null ? t("an.st.whose.start", { s: hhmm(whose.mine) }) : t("an.st.whose.noStart") })}
      ${whose.other ? html` ${t("an.st.other", { o: whose.other.name, os: hhmm(whose.other.start) })} <button type="button" class="btn btn-sm" id="an-switch" data-di="${whose.other.di}" data-ci="${whose.other.ci}" data-ri="${whose.other.ri}">${t("an.switch")}</button>` : ""}</div>`;
    const need = mode === "manual" ? Math.max(0, (taus ? (guessOffset() != null || geoFit ? 2 : 3) : 3) - placed) : 0;
    $("#an-side").innerHTML = html`<div class="an-side-title">${t(mode === "manual" ? "an.cal.title" : "an.cal.auto")}</div>
      ${summary.length ? html`<ul class="an-summary">${summary.map((s) => html`<li>${s}</li>`)}</ul>` : ""}
      ${whoseNote}${notes.map((n) => html`<div class="notice" style="margin-bottom:6px">${n}</div>`)}
      ${mode === "manual" ? html`<p class="hint">${t("an.cal.help")}</p>${taus ? "" : html`<p class="hint">${t("an.cal.noSplits")}</p>`}` : ""}
      <div class="an-targets">${targets.map((g) => html`<button type="button" class="an-target${g.i === cur && mode === "manual" ? " now" : ""}${g.pos ? " done" : ""}${g.missed ? " missed" : ""}" data-target="${g.i}" title="${g.missed ? t("an.missed") : ""}">
        <b>${g.label}</b>${g.code ? html`<span class="muted">${g.code}</span>` : html`<span></span>`}<span class="num">${g.tau != null ? clock(g.tau) : timeOf(g) != null ? html`<span class="muted">~${clock(timeOf(g))}</span>` : "—"}</span>
        <span class="an-mark">${g.pos ? "✓" : g.i === cur && mode === "manual" ? "▶" : ""}</span></button>`)}</div>
      ${mode === "manual" ? html`<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        ${taus ? "" : html`<button type="button" class="btn btn-sm" id="an-add">${t("an.cal.add")}</button>`}
        <button type="button" class="btn btn-sm" id="an-skip">${t("an.cal.skip")}</button>
        <button type="button" class="btn btn-sm" id="an-undo">${t("an.cal.undo")}</button>
        <button type="button" class="btn btn-sm" id="an-clear">${t("an.cal.clear")}</button></div>` : ""}
      <div class="an-fitbox">${fit ? html`${rmsM != null ? html`<div><span class="muted">${t("an.cal.fit")}</span> <b>${fmt(rmsM)} m</b> <span class="muted" title="${t("an.cal.fit.hint")}">ⓘ</span></div>` : ""}
          ${offset != null && guessOffset() != null ? html`<div><span class="muted">${t("an.cal.offset")}</span> <b>${signed(offset - guessOffset())}</b> <span class="muted" title="${t("an.cal.offset.hint")}">ⓘ</span></div>` : ""}
          ${offset == null ? html`<div class="notice">${t("an.cal.noStart")}</div>` : ""}`
        : html`<div class="muted">${mode === "manual" ? t("an.cal.need", { n: need }) : status}</div>`}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center">
        <button type="button" class="btn btn-primary" id="an-done" ${raw(fit && offset != null ? "" : "disabled")}>${t("an.cal.done")}</button>
        ${mode === "manual" ? html`<button type="button" class="btn btn-sm" id="an-auto">${t("an.cal.backAuto")}</button>` : html`<button type="button" class="btn btn-sm" id="an-manual">${t("an.cal.manual")}</button>`}</div>
      <label class="an-opt" style="margin-top:8px"><input type="checkbox" id="an-north" ${raw(northUp ? "checked" : "")}> ${t("an.northUp")}</label>`;
    $$("[data-target]").forEach((b) => b.addEventListener("click", () => { cur = Number(b.dataset.target); if (mode !== "manual") { mode = "manual"; } side(); draw(); }));
    $("#an-switch")?.addEventListener("click", (e) => { di = Number(e.target.dataset.di); ci = Number(e.target.dataset.ci); ri = Number(e.target.dataset.ri); pickers(); setup(); });
    $("#an-skip")?.addEventListener("click", () => { if (cur >= 0) cur = nextTarget(cur + 1); side(); draw(); });
    $("#an-add")?.addEventListener("click", () => {
      // a new control before the finish (or at the end), then the controls renumbered
      const fi = targets.findIndex((g) => g.kind === "finish"), at = fi >= 0 ? fi : targets.length;
      targets.splice(at, 0, { kind: "control", label: "", code: "", tau: null, tEst: null, pos: null });
      let n = 0;
      targets.forEach((g, i) => { g.i = i; if (g.kind === "control") g.label = String(++n); });
      cur = at; side(); draw();
    });
    $("#an-undo")?.addEventListener("click", () => {
      const done = targets.filter((g) => g.pos).map((g) => g.i);
      if (done.length) { const lastI = Math.max(...done); targets[lastI].pos = null; targets[lastI].tEst = null; cur = lastI; savePositions(); recompute(); side(); draw(); }
    });
    $("#an-clear")?.addEventListener("click", () => { targets.forEach((g) => { g.pos = null; g.tEst = null; }); cur = 0; savePositions(); recompute(); side(); draw(); });
    $("#an-done").addEventListener("click", finish);
    $("#an-manual")?.addEventListener("click", () => { mode = "manual"; cur = nextTarget(0); if (cur < 0) cur = 0; side(); draw(); });
    $("#an-auto")?.addEventListener("click", () => prepare({ fresh: true }));
    $("#an-north").addEventListener("change", (e) => { northUp = e.target.checked; prepare(); });
  }
  /** A click on the map in manual mode: the current target goes there (snapped to a circle found nearby). */
  function placeClick(px, py) {
    if (cur < 0 || mode !== "manual") return;
    let pos = [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
    if (course?.r) {
      const all = [...course.controls, ...(course.start ? [course.start] : []), ...(course.finish ? [course.finish] : [])];
      const near = all.map((c) => [Math.hypot(c.x - px, c.y - py), c]).sort((a, b) => a[0] - b[0])[0];
      if (near && near[0] <= 1.2 * course.r) pos = [near[1].x, near[1].y];
      else if (course.probe && targets[cur].kind === "control") {                  // a ring the first pass missed, right here?
        const hit = course.probe(px, py, 1.2 * course.r);
        if (hit && hit.score >= 0.4 && hit.raw >= 0.25 && hit.inner <= 0.4) pos = [hit.x, hit.y];
      }
    }
    targets[cur].pos = pos; targets[cur].missed = false;
    cur = nextTarget(cur + 1);
    savePositions();
    recompute();
    side();
    draw();
  }

  // ---- 4. the playback ----------------------------------------------------------------------------------------------
  function finish() {
    if (!fit || offset == null) return;
    calibrated = true; marks = false; tNow = 0;
    savePositions(true);
    steps(4);
    showPanels(false);
    document.body.classList.add("an-theatre");           // the site's menus give way to the map (owner, 2026-10-14)
    const avail = Object.keys(track.ch).filter((c) => CHANNEL_LABEL[c]);
    const known = sequenceKnown();
    $("#an-side").innerHTML = html`
      <div class="an-transport">
        <button type="button" class="btn btn-sm" id="an-prev" title="${t("an.prevLeg")}">⏮</button>
        <button type="button" class="btn btn-sm btn-primary" id="an-play" title="${t("an.play")}">▶</button>
        <button type="button" class="btn btn-sm" id="an-next" title="${t("an.nextLeg")}">⏭</button>
        <select id="an-speed" aria-label="${t("an.speed")}">${SPEEDS.map((s) => html`<option value="${s}" ${raw(s === speed ? "selected" : "")}>× ${s}</option>`)}</select>
        <button type="button" class="btn btn-sm an-follow" id="an-follow" aria-pressed="${follow}" title="${t("an.follow.hint")}">⌖ ${t("an.follow.short")}</button></div>
      <input type="range" id="an-time" min="0" max="${Math.ceil(total)}" step="0.5" value="0" style="width:100%;margin:6px 0 4px">
      <dl class="an-stats">
        <dt>${t("an.time")}</dt><dd><b id="an-t">0:00</b> <span class="muted" id="an-t-sub"></span></dd>
        <dt>${t(known ? "an.leg" : "an.legNear")}</dt><dd><b id="an-leg">—</b> <span class="muted" id="an-leg-sub"></span></dd>
        <dt>${t("an.pace")}</dt><dd><b id="an-pace">—</b> <span class="muted">${t("an.pace.short")}</span></dd>
        <dt>${t("an.dist")}</dt><dd><b id="an-dist">0 m</b> <span class="muted" id="an-dist-sub"></span></dd>
        ${avail.filter((c) => c !== "ele").map((c) => html`<dt>${t(CHANNEL_LABEL[c])}</dt><dd><b id="an-ch-${c}">—</b> <span class="muted">${CHANNEL_UNIT[c]}</span></dd>`)}
      </dl>
      <details class="an-settings"><summary>${t("an.display")}</summary>
        <div class="an-opts">
          <label><span>${t("an.traceColour")}</span><span class="an-swatches">${TRACE_PRESETS.map((c) => html`<button type="button" class="an-swatch" data-colour="${c}" style="background:${c}" aria-pressed="${c === traceColour}" title="${c}"></button>`)}<input type="color" id="an-colour-pick" value="${traceColour}" title="${t("an.traceColour.any")}"></span></label>
          <label><span>${t("an.width")}</span><select id="an-width">${WIDTHS.map(([w, k]) => html`<option value="${w}" ${raw(w === width ? "selected" : "")}>${t(k)}</option>`)}</select></label>
          <label><span>${t("an.colour")}</span><select id="an-colour"><option value="plain" ${raw(colour === "plain" ? "selected" : "")}>${t("an.colour.plain")}</option><option value="speed" ${raw(colour === "speed" ? "selected" : "")}>${t("an.colour.speed")}</option></select></label>
          <label><span>${t("an.tail")}</span><select id="an-tail">${TAILS.map((s) => html`<option value="${s}" ${raw(s === tail ? "selected" : "")}>${s ? clock(s) : t("an.tail.all")}</option>`)}</select></label>
          <label><span>${t("an.mapAlpha")}</span><input type="range" id="an-map-alpha" min="10" max="100" step="5" value="${mapAlpha}"></label>
          <label><span>${t("an.traceAlpha")}</span><input type="range" id="an-trace-alpha" min="10" max="100" step="5" value="${traceAlpha}"></label>
          <label><input type="checkbox" id="an-marks" ${raw(marks ? "checked" : "")}> ${t("an.marks")}</label>
        </div></details>
      <div class="an-fitbox muted">${rmsM != null ? html`${t("an.cal.fit")} ${fmt(rmsM)} m` : ""}${geoHow ? html` · ${t("an.st.geo")} ${geoHow}` : ""}
        <button type="button" class="btn btn-sm" id="an-again" style="margin-left:6px">${t("an.cal.again")}</button></div>`;
    $("#an-play").addEventListener("click", () => (playing ? stop() : play()));
    $("#an-prev").addEventListener("click", () => jumpLeg(-1));
    $("#an-next").addEventListener("click", () => jumpLeg(1));
    $("#an-speed").addEventListener("change", (e) => { speed = Number(e.target.value); });
    const slider = $("#an-time");
    slider.addEventListener("input", (e) => { seek(Number(e.target.value)); });
    slider.addEventListener("pointerdown", () => { scrubbing = true; });
    slider.addEventListener("pointerup", () => { scrubbing = false; });
    $("#an-follow").addEventListener("click", () => { setFollow(!follow); draw(); });
    $("#an-marks").addEventListener("change", (e) => { marks = e.target.checked; draw(); });
    $("#an-colour").addEventListener("change", (e) => { colour = e.target.value; savePrefs(); draw(); });
    $("#an-width").addEventListener("change", (e) => { width = Number(e.target.value); savePrefs(); draw(); });
    $("#an-map-alpha").addEventListener("input", (e) => { mapAlpha = Number(e.target.value); savePrefs(); draw(); });
    $("#an-trace-alpha").addEventListener("input", (e) => { traceAlpha = Number(e.target.value); savePrefs(); draw(); });
    $("#an-tail").addEventListener("change", (e) => { tail = Number(e.target.value); savePrefs(); draw(); });
    const setColour = (c) => { traceColour = c; savePrefs(); $$(".an-swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.colour === c))); $("#an-colour-pick").value = c; draw(); drawChips(); };
    $$(".an-swatch").forEach((b) => b.addEventListener("click", () => setColour(b.dataset.colour)));
    $("#an-colour-pick").addEventListener("input", (e) => setColour(e.target.value));
    $("#an-again").addEventListener("click", leavePlayback);
    // the curves under the map: the pace and the file's channels, any number of them, one above the other
    const chipsBox = $("#an-chips");
    const drawChips = () => {
      chipsBox.innerHTML = html`${["pace", ...avail].map((c) => html`<button type="button" class="an-chip" data-ch="${c}" aria-pressed="${chans.has(c)}" style="--chip:${c === "pace" ? traceColour : CHANNEL_COLOUR[c]}">${t(c === "pace" ? "an.ch.pace" : CHANNEL_LABEL[c])}</button>`)}`;
      $$("[data-ch]", chipsBox).forEach((b) => b.addEventListener("click", () => { const c = b.dataset.ch; if (chans.has(c)) chans.delete(c); else chans.add(c); savePrefs(); drawChips(); sizeStrip(); drawStrip(); }));
    };
    drawChips();
    $("#an-strip-card").hidden = false;
    if (known) legsTable(); else { $("#an-legs").hidden = true; $("#an-legs").innerHTML = ""; }
    sizeStrip();
    if (legs[0]?.t1 != null) zoomTo(legs[0], 2.4); else fitTrace();    // the first leg, with room around it
    seek(0);
  }
  /** Back from the playback to the calibration and the files. */
  function leavePlayback() {
    stop(); calibrated = false; marks = true; mode = "manual"; cur = nextTarget(0); if (cur < 0) cur = 0;
    hideResults(); side(); draw();
  }
  function setFollow(on) { follow = on; savePrefs(); const b = $("#an-follow"); if (b) b.setAttribute("aria-pressed", String(on)); }
  const legAt = (s) => { let j = -1; for (let i = 0; i < legs.length; i++) if (legs[i].t0 != null && s >= legs[i].t0) j = i; return j; };
  function jumpLeg(dir) {
    const j = legAt(tNow);
    const target = dir < 0 ? (j >= 0 && tNow - legs[j].t0 > 2 ? legs[j].t0 : legs[Math.max(0, j - 1)]?.t0 ?? 0) : legs[j + 1]?.t0 ?? total;
    seek(target ?? 0);
  }
  function seek(s) {
    tNow = Math.max(0, Math.min(total, s));
    hud();
    draw();
    drawStrip();
  }
  // the clock runs on a timer, not on requestAnimationFrame: browsers pause the latter for a hidden or background
  // pane, which left the runner frozen (owner, 2026-10-14); a throttled timer still advances by the time elapsed
  function play() {
    if (tNow >= total - 0.01) tNow = 0;
    playing = true; last = performance.now();
    $("#an-play").textContent = "⏸";
    if (raf) clearInterval(raf);
    raf = setInterval(() => {
      if (!playing) return;
      if (!main.isConnected) { stop(); return; }
      const now = performance.now();
      tNow = Math.min(total, tNow + ((now - last) / 1000) * speed);
      last = now;
      hud(); draw(); drawStrip();
      if (tNow >= total) stop();
    }, 40);
  }
  function stop() {
    playing = false;
    if (raf) clearInterval(raf);
    raf = 0;
    const b = $("#an-play"); if (b) b.textContent = "▶";
  }
  function hud() {
    if (!calibrated) return;
    const s = offset + tNow, j = legAt(tNow), leg = legs[j];
    const slider = $("#an-time"); if (slider && !scrubbing) slider.value = String(tNow);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("#an-t", clock(tNow)); set("#an-t-sub", total ? `${t("an.of")} ${clock(total)}` : "");
    set("#an-leg", leg ? `${leg.n}${leg.code ? ` (${leg.code})` : ""}` : "—");
    set("#an-leg-sub", leg ? `${leg.time != null ? `${leg.estimated ? "~" : ""}${clock(leg.time)}` : ""}${leg.dist != null ? ` · ${fmt(leg.dist)} m` : ""}${leg.rank ? ` · ${t("an.rankShort")} ${leg.rank}` : ""}`.replace(/^ · /, "") : "");
    const win = Math.min(30, tNow);
    set("#an-pace", win >= 5 ? pace((cumAt(track, s) - cumAt(track, s - win)) / win) : "—");
    const d = cumAt(track, s) - cumAt(track, offset);
    set("#an-dist", `${fmt(d >= 1000 ? d / 1000 : d, d >= 1000 ? 2 : 0)} ${d >= 1000 ? "km" : "m"}`);
    const len = klass()?.length_m;
    set("#an-dist-sub", len ? `${t("an.course.len")} ${fmt(len / 1000, 1)} km` : "");
    for (const c of Object.keys(track.ch)) { const v = valueAt(track, c, s); set(`#an-ch-${c}`, v == null || Number.isNaN(v) ? "—" : fmt(v, c === "temp" ? 1 : 0)); }
    $("#an-hud").textContent = `${clock(tNow)}${leg ? ` · ${leg.n}` : ""}`;
  }
  function legsTable() {
    const k = klass(), r = runner(), est = !officialTaus();
    const hasHr = !!track.ch.hr, hasCad = !!track.ch.cad;
    const sum = legs.reduce((a, l) => ({ dist: a.dist + (l.dist || 0), straight: a.straight + (l.straight || 0), lost: a.lost + (l.mistake ? l.lost : 0), n: a.n + (l.mistake ? 1 : 0) }), { dist: 0, straight: 0, lost: 0, n: 0 });
    $("#an-legs").hidden = false;
    $("#an-legs").innerHTML = html`<div class="card-head"><div><h2>${t("an.legs")}</h2><div class="hint">${t(est ? "an.legs.hint.est" : "an.legs.hint")}</div></div></div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("an.col.leg")}</th><th class="r">${t("an.col.time")}${est ? html`<div class="th-sub">${t("an.col.est")}</div>` : ""}</th>${est ? "" : html`<th class="r">${t("an.col.best")}</th>
        <th class="r">${t("an.col.rank")}</th><th class="r">${t("an.col.lost")}</th>`}<th class="r">${t("an.col.trace")}</th><th class="r">${t("an.col.straight")}</th><th class="r">${t("an.col.detour")}</th><th class="r">${t("an.col.pace")}</th>
        ${hasHr ? html`<th class="r">${t("an.col.hr")}</th>` : ""}${hasCad ? html`<th class="r">${t("an.col.cad")}</th>` : ""}</tr></thead>
      <tbody>${legs.map((l, i) => html`<tr data-leg="${i}" class="${l.mistake ? "an-mistake" : ""}" style="cursor:pointer">
        <td>${l.label}${l.code ? html` <span class="muted">${l.code}</span>` : ""}</td>
        <td class="r num">${l.time != null ? clock(l.time) : "—"}</td>${est ? "" : html`<td class="r num">${l.best != null ? clock(l.best) : "—"}</td>
        <td class="r num">${l.rank ?? "—"}</td><td class="r num${l.mistake ? " an-lost" : ""}">${l.lost != null ? signed(Math.round(l.lost)) : "—"}</td>`}
        <td class="r num">${l.dist != null ? `${fmt(l.dist)} m` : "—"}</td><td class="r num">${l.straight != null ? `${fmt(l.straight)} m` : "—"}</td>
        <td class="r num">${l.dist != null && l.straight ? detour(l.dist, l.straight) : "—"}</td>
        <td class="r num">${l.v != null ? pace(l.v) : "—"}</td>
        ${hasHr ? html`<td class="r num">${l.hr != null ? fmt(l.hr) : "—"}</td>` : ""}${hasCad ? html`<td class="r num">${l.cad != null ? fmt(l.cad) : "—"}</td>` : ""}</tr>`)}
      <tr class="an-total"><td>${t("an.total")}</td><td class="r num">${r.status === "ok" && r.time_s != null ? clock(r.time_s) : total ? `~${clock(total)}` : "—"}</td>${est ? "" : html`<td></td><td class="r num">${r.place ?? "—"}</td>
        <td class="r num">${sum.n ? `${signed(Math.round(sum.lost))} (${sum.n})` : "—"}</td>`}<td class="r num">${fmt(sum.dist)} m</td>
        <td class="r num">${sum.straight ? `${fmt(sum.straight)} m` : "—"}${k.length_m ? html`<div class="muted" style="font-size:11.5px">${t("an.course.len")} ${fmt(k.length_m)} m</div>` : ""}</td>
        <td class="r num">${sum.straight ? detour(sum.dist, sum.straight) : "—"}</td>
        <td class="r num">${total && sum.dist ? pace(sum.dist / total) : "—"}</td>
        ${hasHr ? html`<td class="r num">${fmt(meanBetween(track, "hr", offset, offset + total))}</td>` : ""}${hasCad ? html`<td class="r num">${fmt(meanBetween(track, "cad", offset, offset + total))}</td>` : ""}</tr></tbody></table></div>`;
    $$("#an-legs tr[data-leg]").forEach((tr) => tr.addEventListener("click", () => {
      const l = legs[Number(tr.dataset.leg)];
      if (l.t0 == null) return;
      stop();
      zoomTo(l);
      seek(l.t0);
    }));
  }
  /** The view on one leg: its trace, with a margin. */
  function zoomTo(l, margin = 1.3) {
    if (!fit || l.t1 == null) return;
    const a = indexAt(track, offset + l.t0), b = indexAt(track, offset + l.t1);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = a; i <= b; i++) { x0 = Math.min(x0, pxs[i]); y0 = Math.min(y0, pys[i]); x1 = Math.max(x1, pxs[i]); y1 = Math.max(y1, pys[i]); }
    const { w, h } = box();
    const k = Math.min(w / Math.max(60, (x1 - x0) * margin + 40), h / Math.max(60, (y1 - y0) * margin + 40), 6);
    view = { k, ox: w / 2 - ((x0 + x1) / 2) * k, oy: h / 2 - ((y0 + y1) / 2) * k };
    setFollow(false);
  }

  // ---- the map canvas: pan, zoom, click
  const box = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  function size() {
    const dpr = window.devicePixelRatio || 1, { w, h } = box();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  function fitView() {
    const { w, h } = box();
    const k = w && h ? Math.min(w / map.width, h / map.height) : 1;       // a hidden box has no size
    view = { k, ox: (w - map.width * k) / 2, oy: (h - map.height * k) / 2 };
  }
  function zoomBy(f, cx, cy) {
    const { w, h } = box();
    if (cx == null) { cx = w / 2; cy = h / 2; }
    const k = Math.max(0.02, Math.min(12, view.k * f));
    view = { k, ox: cx - ((cx - view.ox) / view.k) * k, oy: cy - ((cy - view.oy) / view.k) * k };
    draw();
  }
  const toImg = (sx, sy) => [(sx - view.ox) / view.k, (sy - view.oy) / view.k];
  let drag = null, pinch = null;
  const pointers = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY, ox: view.ox, oy: view.oy, moved: false };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }; drag = null; }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const k = Math.max(0.02, Math.min(12, (pinch.k * d) / pinch.d));
      view = { k, ox: cx - ((cx - view.ox) / view.k) * k, oy: cy - ((cy - view.oy) / view.k) * k };
      draw();
    } else if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { view = { ...view, ox: drag.ox + dx, oy: drag.oy + dy }; if (follow && playing) setFollow(false); draw(); }
    }
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && !drag.moved && !calibrated) placeClick(...toImg(e.offsetX, e.offsetY));
    if (!pointers.size) drag = null;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
  canvas.addEventListener("dblclick", (e) => zoomBy(1.6, e.offsetX, e.offsetY));
  $("#an-zin").addEventListener("click", () => zoomBy(1.4));
  $("#an-zout").addEventListener("click", () => zoomBy(1 / 1.4));
  $("#an-fit").addEventListener("click", () => { if (!map) return; if (calibrated) { fitTrace(); setFollow(false); } else fitView(); draw(); });
  $("#an-map").addEventListener("click", () => { if (map) { fitView(); draw(); } });
  const ro = new ResizeObserver(() => { if (map) { size(); sizeStrip(); draw(); drawStrip(); } });
  ro.observe(canvas);

  // the pace colours: from the fastest (blue) through green to the slowest (red), on the trace's own 10-90 % range
  const PACE_COLOURS = ["#1c5fd6", "#19a0c9", "#1aa34a", "#8bc34a", "#f2c200", "#f28a00", "#e23a1f", "#8e0f1f"];
  function paceScale() {
    const vs = Array.from(track.v).filter((v) => v > 0.3).sort((a, b) => a - b);
    vLo = vs[Math.floor(vs.length * 0.1)] || 0; vHi = vs[Math.floor(vs.length * 0.9)] || 1;
  }
  const paceColour = (v) => PACE_COLOURS[Math.max(0, Math.min(PACE_COLOURS.length - 1, Math.floor(((vHi - v) / (vHi - vLo || 1)) * PACE_COLOURS.length)))];

  function draw() {
    if (!map) return;
    const dpr = window.devicePixelRatio || 1, { w, h } = box();
    if (calibrated && follow && fit) {               // the runner kept at the centre
      const [px, py] = toPx(fit, ...posAt(track, offset + tNow));
      view = { ...view, ox: w / 2 - px * view.k, oy: h / 2 - py * view.k };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e9e6dc"; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.ox, dpr * view.oy);
    ctx.imageSmoothingEnabled = view.k < 1;
    ctx.globalAlpha = calibrated ? mapAlpha / 100 : 1;
    ctx.drawImage(map, 0, 0);
    ctx.globalAlpha = 1;
    const ta = calibrated ? traceAlpha / 100 : 1;
    const lw = (px) => px / view.k;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (fit && fullPath && offset != null) {
      const s = offset + (calibrated ? tNow : total), iNow = indexAt(track, s), i0 = Math.max(0, indexAt(track, offset));
      // the whole trace, faint; the part run so far, full; the tail, thicker
      const bySpeed = calibrated && colour === "speed";
      if (!bySpeed) { ctx.globalAlpha = (calibrated ? 0.45 : 0.85) * ta; ctx.strokeStyle = traceColour; ctx.lineWidth = lw(2.5 * width); ctx.stroke(fullPath); }
      ctx.globalAlpha = ta;
      if (calibrated) {
        const iTail = tail ? Math.max(i0, indexAt(track, s - tail)) : i0;
        if (bySpeed) {                                   // the whole race coloured by pace, the part to come faint
          if (!vHi || vHi === 1) paceScale();
          const iEnd = indexAt(track, offset + total);
          for (let i = i0 + 1; i <= iEnd; i++) {
            ctx.globalAlpha = (i <= iNow ? 1 : 0.45) * ta;
            ctx.strokeStyle = paceColour(track.v[i]); ctx.lineWidth = lw((i > iTail && i <= iNow ? 5 : 3) * width);
            ctx.beginPath(); ctx.moveTo(pxs[i - 1], pys[i - 1]); ctx.lineTo(pxs[i], pys[i]); ctx.stroke();
          }
          ctx.globalAlpha = ta;
        } else {
          const part = (from, to, width) => { if (to <= from) return; ctx.lineWidth = lw(width); ctx.beginPath(); ctx.moveTo(pxs[from], pys[from]);
            for (let i = from + 1; i <= to; i++) ctx.lineTo(pxs[i], pys[i]); ctx.stroke(); };
          ctx.strokeStyle = traceColour;
          part(i0, Math.min(iNow, iTail), 3 * width);
          part(iTail, iNow, 5 * width);
        }
        const [px, py] = toPx(fit, ...posAt(track, s));
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(px, py, lw(9), 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, lw(6.5), 0, Math.PI * 2); ctx.fillStyle = "#e8641c"; ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (marks || !calibrated) {
      // the circles read on the map, faint
      if (course && !calibrated) {
        ctx.strokeStyle = "rgba(166, 38, 164, 0.45)"; ctx.lineWidth = lw(1.5);
        for (const c of course.controls) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 1.15, 0, Math.PI * 2); ctx.stroke(); }
      }
      // the targets placed: a ring and the number
      ctx.font = `${lw(13)}px system-ui, sans-serif`; ctx.textBaseline = "middle";
      for (const g of targets) {
        const c = g.pos;
        if (!c) continue;
        const now = g.i === cur && mode === "manual" && !calibrated;
        ctx.beginPath(); ctx.arc(c[0], c[1], lw(now ? 11 : 9), 0, Math.PI * 2);
        ctx.strokeStyle = now ? "#e8641c" : g.missed ? "#999999" : "#a626a4"; ctx.lineWidth = lw(now ? 3 : 2); ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = lw(3); ctx.strokeText(g.label, c[0] + lw(13), c[1]);
        ctx.fillStyle = g.missed ? "#999999" : "#a626a4"; ctx.fillText(g.label, c[0] + lw(13), c[1]);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- the curves under the map: one row per curve chosen, the same time axis, the controls' passes when the sequence is known
  const ROW = 56, TOP = 14;
  const stripRows = () => ["pace", ...Object.keys(CHANNEL_COLOUR)].filter((c) => chans.has(c) && (c === "pace" || track.ch[c]));
  function sizeStrip() {
    const dpr = window.devicePixelRatio || 1, rows = Math.max(1, stripRows().length);
    strip.style.height = `${TOP + rows * ROW + 4}px`;
    strip.width = Math.round(strip.clientWidth * dpr); strip.height = Math.round(strip.clientHeight * dpr);
    document.documentElement.style.setProperty("--an-strip", `${TOP + rows * ROW + 4}px`);
  }
  function drawStrip() {
    if (!calibrated || !total) return;
    const dpr = window.devicePixelRatio || 1, w = strip.clientWidth, h = strip.clientHeight;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-3").trim() || "#888";
    const grid = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#ddd";
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, h);
    if (!vHi || vHi === 1) paceScale();
    const X = (s) => (s / total) * w, step = Math.max(1, Math.floor(total / w));
    const i0 = indexAt(track, offset), i1 = indexAt(track, offset + total), known = sequenceKnown();
    const rows = stripRows();
    rows.forEach((c, r) => {
      const top = TOP + r * ROW + 2, bottom = top + ROW - 6;
      if (r) { sctx.strokeStyle = grid; sctx.lineWidth = 1; sctx.beginPath(); sctx.moveTo(0, top - 3); sctx.lineTo(w, top - 3); sctx.stroke(); }
      if (known) for (const l of legs) if (l.mistake && l.t1 != null) { sctx.fillStyle = "rgba(198,40,40,0.12)"; sctx.fillRect(X(l.t0), top, X(l.t1) - X(l.t0), bottom - top); }
      let label, range;
      if (c === "pace") {
        sctx.beginPath(); sctx.moveTo(0, bottom);
        for (let s = 0; s <= total; s += step) {
          const v = speedAt(track, offset + s), y = bottom - ((Math.max(vLo * 0.7, Math.min(vHi * 1.15, v)) - vLo * 0.7) / (vHi * 1.15 - vLo * 0.7 || 1)) * (bottom - top);
          sctx.lineTo(X(s), y);
        }
        sctx.lineTo(w, bottom); sctx.closePath();
        sctx.fillStyle = traceColour; sctx.globalAlpha = 0.3; sctx.fill(); sctx.globalAlpha = 1;
        label = t("an.ch.pace"); range = `${pace(vHi)} – ${pace(vLo)}`;
        sctx.fillStyle = traceColour;
      } else {
        const ch = track.ch[c];
        let lo = Infinity, hi = -Infinity;
        for (let i = i0; i <= i1; i++) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi > lo) {
          sctx.beginPath();
          for (let s = 0; s <= total; s += step) { const v = valueAt(track, c, offset + s), y = bottom - ((v - lo) / (hi - lo)) * (bottom - top - 4) - 2; if (s) sctx.lineTo(X(s), y); else sctx.moveTo(X(s), y); }
          sctx.strokeStyle = CHANNEL_COLOUR[c]; sctx.lineWidth = 1.6; sctx.stroke();
        }
        const dec = c === "temp" ? 1 : 0;
        label = t(CHANNEL_LABEL[c]); range = hi > lo ? `${fmt(lo, dec)} – ${fmt(hi, dec)} ${CHANNEL_UNIT[c]}` : "";
        sctx.fillStyle = CHANNEL_COLOUR[c];
      }
      sctx.font = "600 10px system-ui, sans-serif"; sctx.textAlign = "left"; sctx.fillText(label, 4, top + 9);
      sctx.font = "10px system-ui, sans-serif"; sctx.textAlign = "right"; sctx.fillText(range, w - 4, top + 9);
    });
    // the controls' passes, numbered when the sequence is known
    sctx.font = "10px system-ui, sans-serif"; sctx.textAlign = "center"; sctx.fillStyle = ink; sctx.strokeStyle = ink; sctx.lineWidth = 1;
    targets.forEach((g, i) => { const tt = timeOf(g); if (tt == null || !i) return; const x = X(tt); sctx.globalAlpha = 0.45; sctx.beginPath(); sctx.moveTo(x, TOP); sctx.lineTo(x, h - 2); sctx.stroke(); sctx.globalAlpha = 1; if (known) sctx.fillText(g.label, x, 9); });
    sctx.strokeStyle = "#e8641c"; sctx.lineWidth = 2; sctx.beginPath(); sctx.moveTo(X(tNow), 0); sctx.lineTo(X(tNow), h); sctx.stroke();
  }
  const scrub = (e) => { if (!calibrated) return; stop(); seek((e.offsetX / strip.clientWidth) * total); };
  strip.addEventListener("pointerdown", (e) => { scrub(e); strip.setPointerCapture(e.pointerId); strip.dataset.down = "1"; });
  strip.addEventListener("pointermove", (e) => { if (strip.dataset.down) scrub(e); });
  const stripUp = () => { delete strip.dataset.down; };
  strip.addEventListener("pointerup", stripUp); strip.addEventListener("pointercancel", stripUp);

  // ---- go
  steps(1);
  await loadRace();
  pickers();
  if (memo) {
    ({ map, track, courseCache, iofIndex, northUp, restoredFiles } = memo);
    Object.assign(files, memo.files);
    memo = null;
    filesCard(); setup();
  } else {
    filesCard(); setup();
    restoreFromIdb();
  }
  return { title: t("an.title"), cleanup: () => {
    document.body.classList.remove("an-theatre");      // the site's menus come back on every other page
    stop(); ro.disconnect(); prepToken++;
    if (map || track) memo = { map, track, courseCache, iofIndex, northUp, restoredFiles: true, files: { ...files } };
  } };
}
