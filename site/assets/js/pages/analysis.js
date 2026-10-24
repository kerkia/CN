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

import { html, raw, $, $$, fmt, fmtDate, pctN } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { getProv, clock } from "./provisional.js";
import { raceFilters } from "../racefilters.js";
import { replaceQuery } from "../app.js";
import { parseTrace, isTraceName, indexAt, posAt, cumAt, speedAt, valueAt, meanBetween, toLocal } from "../trace/track.js";
import { fitSimilarity, toPx, toM, registerPoints, simplify } from "../trace/geom.js";
import { detectCourse } from "../trace/course.js";
import { CHANNEL_LABEL, CHANNEL_UNIT, CHANNEL_COLOUR, curveColour, pace, drawCurves, curveTimeAt } from "../trace/curves.js";
import { alignTrack, visitOrder } from "../trace/align.js";
import { paceRange, paceColour as paceColourOf, paceLegend as paceLegendHtml } from "../trace/pacecolour.js";
import { bestLegs, refLegs, legLoss } from "../trace/legs.js";
import { parisOffsetMs } from "../trace/published.js";
import { readZip, parseKml, fitFromKml, isWorldFileName, parseWorldFile, crsFromWkt, guessCrs, fitFromWorld, parseIofCourse } from "../trace/georef.js";
import { readMap, isImage } from "../trace/mapfile.js";
import { buttons as fwButtons, bindFull, setFull, leaveFull, inOwnTab, setTabParams } from "../fullwin.js";
import { takeInbox } from "../pwa.js";
import { gridPlan, loadGrid, CREDIT } from "../trace/terrain.js";
import * as RC from "../trace/routeplan.js";

const SPEEDS = [1, 2, 5, 10, 20, 40, 60, 80, 100];        // every x20 past x20 (owner, 2026-10-15)
const TAILS = [30, 60, 120, 300, 0];                   // seconds of trace behind the runner; 0: all of it
const TOL = 20;                                        // metres: a control is "reached" within this of the trace
const CAL_KEY = "ocn.an.cal";                          // localStorage: the positions, per race / circuit / runner / image
const TRACE = "#3b0764";                               // the trace's default colour: a dark purple (owner, 2026-10-14)
const TRACE_PRESETS = ["#3b0764", "#c8102e", "#0b3d91", "#111111", "#ff6a00"];
const WIDTHS = [[1, "an.width.thin"], [1.6, "an.width.normal"], [2.4, "an.width.thick"], [3.5, "an.width.thicker"]];   // × the trace's base widths
const PREFS_KEY = "ocn.an.prefs";                      // the playback's settings, kept on the device
function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } }
const signed = (s) => (s == null ? "—" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);
const detour = (dist, straight) => { const p = (100 * dist) / straight - 100; return `${p >= 0 ? "+" : "−"}${pctN(Math.abs(p))}`; };
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

const parisDay = (ms) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// ---- the files ------------------------------------------------------------------------------------------------------
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.kmz,.kml,.gpx,.tcx,.fit,.xml,.jgw,.pgw,.tfw,.gfw,.bpw,.wld,.prj,image/*,application/pdf";

// ---- the memory between visits ---------------------------------------------------------------------------------------
// The files and the work stay while the site is open: a visit to another page and back finds the map, the trace and the
// course read on it as they were (memo, in memory). The files themselves are also kept in the browser's IndexedDB for
// the tab's session (a tag in sessionStorage: a reload recovers them, a new tab does not), never sent; « Oublier les
// fichiers » drops them. The calibration (the controls' positions, the geometry found) is in localStorage, so a finished
// calibration comes back as it was left rather than being redone — the controls placed by hand included.
const memos = {};                                       // per mode: "race" (Courses) and "perso" (Entrainement)
const DB = "ocn-analyse", STORE = "files";
function idbOpen() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbWrite(value, key = "files") {
  const db = await idbOpen();
  await new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); if (value) tx.objectStore(STORE).put(value, key); else tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}
async function idbRead(key = "files") {
  const db = await idbOpen();
  const v = await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
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
export async function render(main, { query = {}, route } = {}) {
  const me = auth.session();
  bindFull();
  if (inOwnTab()) setFull(true);                         // a tab opened alone by « ↗ »: the map page without the site's bar
  // « ↗ » during the playback: the new tab gets this tab's files (their key in IndexedDB, as the address says, whether or
  // not the browser copied this tab's session) and goes on with the playback instead of stopping on the files
  if (query.tag && /^[a-z0-9]{6,40}$/.test(query.tag)) { try { sessionStorage.setItem("ocn.an.tag", query.tag); } catch (e) { /* this visit */ } }
  let autoPlay = query.play === "1";
  setTabParams(() => ({ tag: sessionTag(), play: document.body.classList.contains("an-theatre") ? "1" : null, d3: v3on ? "1" : null }));
  let autoV3 = query.d3 === "1";
  // « Analyse solo » (menu « Entrainement »): the same page with no race — a training, a map and one's trace
  const perso = route === "analysisPerso", pageMode = perso ? "perso" : "race", fileKey = perso ? "files:perso" : "files";
  const idx = perso ? null : await getProv("index.json");
  const races = (idx?.races || []).filter((r) => r.docs && !r.soon).sort((a, b) => b.date_iso.localeCompare(a.date_iso));
  // the race's list narrowed by the lists of races' filters (racefilters.js, as on Résultats); the address is the race's own
  const RF = perso || !races.length ? null : await raceFilters({ id: "anf", races, address: false, onChange: () => pickers() });
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t(perso ? "an.perso.title" : "an.title")}</h1><p class="lede">${t(perso ? "an.perso.lede" : "an.lede")}</p></div></div>
    <ol class="dep-steps" id="an-steps"></ol>
    <div class="an-brief" id="an-brief" hidden></div>
    <div id="an-rf">${RF ? RF.html : ""}</div>
    <div class="filters" id="an-pick"></div>
    <section class="card" id="an-files"></section>
    <div class="an-dropall" id="an-dropall" hidden>${t("an.dropAll")}</div>
    <div id="an-work" hidden>
      <div class="an-layout" id="an-layout">
        <section class="an-graphs" id="an-strip-card" hidden>
          <div class="an-graphs-head"><button type="button" class="btn btn-sm an-collapse" id="an-collapse"></button><span class="an-graphs-title">${t("an.graphs")}</span><div class="an-chips" id="an-chips"></div></div>
          <canvas id="an-strip"></canvas></section>
        <div class="an-split" id="an-split-g" title="${t("an.split")}" hidden></div>
        <div class="an-map"><div class="an-3d" id="an-3d-host" hidden></div><canvas id="an-canvas"></canvas>
          <div class="an-tools"><button type="button" class="btn btn-sm an-3d-btn" id="an-3d" aria-pressed="false" title="${t("an.v3.hint")}" hidden>3D</button><button type="button" class="btn btn-sm" id="an-zin" title="+">+</button><button type="button" class="btn btn-sm" id="an-zout" title="−">−</button>
            <button type="button" class="btn btn-sm" id="an-fit" title="${t("an.fitTrace")}">⤢</button><button type="button" class="btn btn-sm" id="an-map" title="${t("an.fitMap")}">▭</button></div>
          <div class="an-hud" id="an-hud"></div><div class="an-legend" id="an-legend" hidden></div><div class="an-3d-credit" id="an-3d-credit" hidden></div></div>
        <div class="an-split" id="an-split-s" title="${t("an.split")}" hidden></div>
        <aside class="an-side" id="an-side"></aside>
      </div>
      <section class="card" id="an-legs" hidden></section>
      <section class="card" id="an-rc" hidden></section>
    </div>`;
  if (!perso && !races.length) {
    $("#an-pick").innerHTML = html`<div class="empty">${t("an.none")}</div>`;
    return { title: t("an.title") };
  }
  RF?.bind();

  // ---- state
  // the race, circuit and runner of the last visit (the menu's link carries no query): the tab's session remembers them
  const selKey = "ocn.an.sel";
  if (!perso && !query.course) { try { const sel = JSON.parse(sessionStorage.getItem(selKey) || "null"); if (sel?.course && races.some((r) => r.key === sel.course)) query = { ...sel, ...query }; } catch (e) { /* none */ } }
  let key = perso ? "perso" : races.some((r) => r.key === query.course) ? query.course : (races.find((r) => (r.lics || []).includes(me?.lic)) || races[0]).key;
  let race = null, docs = [], di = 0, ci = 0, ri = 0;
  let map = null, track = null;
  const files = { map: null, trace: null, geo: null, world: null, prj: null, iof: null };     // { name, note, ... } per role
  let iofIndex = 0, northUp = true, restoredFiles = false;
  let course = null, courseCache = null, geoFit = null, geoHow = "", auto = null, prepToken = 0, status = "";
  let targets = [], cur = 0, fit = null, offset = null, rmsM = null, calibrated = false, mode = "auto", notes = [];
  const prefs = loadPrefs();
  let view = { k: 1, ox: 0, oy: 0 }, follow = !!prefs.follow, colour = prefs.colour === "speed" ? "speed" : "plain", marks = true, tail = TAILS.includes(prefs.tail) ? prefs.tail : 60, speed = 10, playing = false, tNow = 0;
  let width = WIDTHS.some(([w]) => w === prefs.width) ? prefs.width : 2.4;              // the trace's thickness, × the base
  let future = prefs.future === "faint" ? "faint" : "hide";            // the trace still to run: hidden, or faded
  let traceColour = /^#[0-9a-f]{6}$/i.test(prefs.traceColour || "") ? prefs.traceColour : TRACE;
  // the curves: all of the file's by default — there is room for them (owner, 2026-10-15); the former default (pace and
  // heart rate) counts as no choice made
  const oldDefault = Array.isArray(prefs.chans) && prefs.chans.length === 2 && prefs.chans.includes("pace") && prefs.chans.includes("hr");
  let chans = new Set(Array.isArray(prefs.chans) && !oldDefault ? prefs.chans : ["pace", ...Object.keys(CHANNEL_COLOUR)]);
  const pct = (v, d) => (Number.isFinite(v) && v >= 10 && v <= 100 ? v : d);
  let mapAlpha = pct(prefs.mapAlpha, 100), traceAlpha = pct(prefs.traceAlpha, 100);     // the map's and the trace's opacity, %
  // the 3D view (trace/view3d.js, a prototype): off at each visit; its vertical exaggeration and relief kept
  let v3 = null, v3on = false, v3token = 0, v3grid = null, v3info = null, v3refined = {};
  let v3relief = prefs.relief3d === "contours" ? "contours" : "dem", v3interval = prefs.interval3d === 2.5 ? 2.5 : 5;
  let v3ex = Number.isFinite(prefs.ex3d) && prefs.ex3d >= 1 && prefs.ex3d <= 3 ? prefs.ex3d : 1.5;
  // the playback's layout (owner, 2026-10-14): the curves on the left (or under the map), collapsible; the panels'
  // sizes set by dragging the splitters
  const px = (v, lo, hi, d) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d);
  let glayout = prefs.glayout === "left" || prefs.glayout === "below" ? prefs.glayout : (innerWidth >= 1100 ? "left" : "below");
  let gw = px(prefs.gw, 160, 1400, Math.round(Math.min(440, Math.max(260, innerWidth * 0.22))));
  let gh = px(prefs.gh, 80, 900, 200), sw = px(prefs.sw, 200, 600, 270), gcol = !!prefs.gcol;
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ follow, colour, tail, width, future, chans: [...chans], mapAlpha, traceAlpha, traceColour, glayout, gw, gh, sw, gcol, ex3d: v3ex, relief3d: v3relief, interval3d: v3interval })); } catch (e) { /* not kept */ } };
  /** Whether the sequence of controls is known complete: the published split times or a course file give it. A course
   *  read on the map alone may miss controls, and legs numbered from what was found would mislead. */
  const sequenceKnown = () => !!officialTaus() || !!(files.iof?.data?.courses[iofIndex]);
  let legs = [], total = 0, raf = 0, last = 0, pxs = null, pys = null, fullPath = null, scrubbing = false;
  let vLo = 0, vHi = 1;                               // the pace colours' range (10-90 % of the trace's speeds)
  const canvas = $("#an-canvas"), ctx = canvas.getContext("2d");
  const layoutEl = $("#an-layout");
  let lastBox = null;                                   // the map's box when the view was last set (its centre kept on a resize)
  const strip = $("#an-strip");

  const steps = (n) => {
    const labels = perso ? [t("an.s2"), t("an.s3"), t("an.s4")] : [t("an.s1"), t("an.s2"), t("an.s3"), t("an.s4")];
    if (perso) n = Math.max(1, n - 1);                    // no race to choose: three steps
    $("#an-steps").innerHTML = html`${labels.map((s, i) => html`<li class="${i + 1 < n ? "done" : i + 1 === n ? "now" : ""}"><b>${i + 1}</b> ${s}</li>`)}`;
  };
  const stage = () => (!map || !track ? 2 : calibrated ? 4 : 3);
  const runner = () => docs[di]?.classes[ci]?.runners[ri], klass = () => docs[di]?.classes[ci];
  /** The runner's official sequence of race times: start, the controls, the finish (null where unknown), or null. */
  const officialTaus = () => { const r = runner(); if (!r?.splits || !timesApply()) return null; return [0, ...r.splits, r.status === "ok" && r.time_s != null ? r.time_s : null]; };
  const totalOfficial = () => { const r = runner(); return r && r.status === "ok" && r.time_s != null && timesApply() ? r.time_s : null; };
  /**
   * The selected runner's published times are this trace's: the trace is of the race's day, and their start, when
   * published, falls within the trace. Else they are another race's or another runner's — the account's sprint of the
   * next day (25:01) ended Nadejda's night race at 25:01, then started it at control 7 (owner, 2026-10-15) — and the
   * page reads the race on the trace alone.
   */
  function timesApply() {
    if (perso) return false;
    const r = docs[di]?.classes[ci]?.runners[ri];
    if (!r || !track || !race?.date_iso) return !!r;
    if (parisDay(track.ms0) !== race.date_iso) return false;
    const s = startOf(r), t0 = traceStartS();
    return s == null || (s >= t0 - 300 && s <= t0 + track.dur);
  }
  /** Why the selected runner's times are not used, said on the calibration and on the display. */
  function timesNote() {
    if (perso || !track || !race?.date_iso || timesApply()) return "";
    const day = parisDay(track.ms0);
    return day !== race.date_iso ? t("an.st.otherDay", { d1: fmtDate(day), d2: fmtDate(race.date_iso) }) : t("an.st.otherRunner", { r: runner()?.name || "" });
  }
  let matchedNote = "";

  // ---- 1. the race, the circuit, the runner
  async function loadRace() {
    if (perso) {                                          // no race: one runner, the account's
      race = { key: "perso", name: t("an.perso.title"), date_iso: null, docs: [] };
      docs = [{ source: "", title: "", classes: [{ name: "", controls: null, runners: [{ name: me?.nom || "", status: null }] }] }];
      di = 0; ci = 0; ri = 0;
      return;
    }
    race = await getProv(`${encodeURIComponent(key)}.json`);
    docs = (race?.docs || []).filter((d) => d.classes?.length && d.by !== "category");
    const rank = (d) => (d.classes.some((k) => k.runners.some((r) => r.splits)) ? 1e9 : 0) + (d.prio ?? 0);
    docs.sort((a, b) => rank(b) - rank(a));
    const wanted = query.r || null;
    const pick = (test, only = null) => { for (let i = 0; i < docs.length; i++) { if (only != null && i !== only) continue;
      for (let j = 0; j < docs[i].classes.length; j++) { const n = docs[i].classes[j].runners.findIndex(test); if (n >= 0) return [i, j, n]; } } return null; };
    // a runner named in the address is looked for in the document it names first (a reload, a tab opened by « ↗ »: the
    // same document, so the same calibration), then in every document
    const qd = Number.isInteger(Number(query.doc)) && docs[Number(query.doc)] ? Number(query.doc) : null;
    [di, ci, ri] = (wanted && qd != null && pick((r) => r.name === wanted, qd)) || (wanted && pick((r) => r.name === wanted))
      || (me && pick((r) => r.lic && r.lic === me.lic)) || [0, 0, 0];
    if (Number.isInteger(Number(query.doc)) && docs[Number(query.doc)] && !wanted) { di = Number(query.doc); ci = Math.min(Number(query.c) || 0, docs[di].classes.length - 1); ri = 0; }
    if (query.r && docs[di]?.classes[ci]) { const n = docs[di].classes[ci].runners.findIndex((r) => r.name === query.r); if (n >= 0) ri = n; }
  }
  function pickers() {
    if (perso) { $("#an-pick").hidden = true; return; }
    const k = klass();
    $("#an-pick").innerHTML = html`
      <label class="field"><span>${t("prov.race")}</span><select id="an-race" style="max-width:420px">${races.filter((r) => r.key === key || !RF || RF.keep(r)).map((r) => html`<option value="${r.key}" ${raw(r.key === key ? "selected" : "")}>${fmtDate(r.date_iso, "short")} · ${r.name}${r.splits ? "" : ` (${t("an.noSplitsShort")})`}</option>`)}</select></label>
      ${docs.length > 1 ? html`<label class="field"><span>${t("prov.doc")}</span><select id="an-doc" style="max-width:320px">${docs.map((d, i) => html`<option value="${i}" ${raw(i === di ? "selected" : "")}>${d.source} · ${d.title || decodeURIComponent((d.url || "").split("/").pop())}</option>`)}</select></label>` : ""}
      ${docs.length ? html`<label class="field"><span>${t("prov.circuit")}</span><select id="an-c">${docs[di].classes.map((x, i) => html`<option value="${i}" ${raw(i === ci ? "selected" : "")}>${x.name} (${x.runners.length})</option>`)}</select></label>
      <label class="field"><span>${t("prov.runner")}</span><select id="an-r" style="max-width:300px">${k.runners.map((r, i) => html`<option value="${i}" ${raw(i === ri ? "selected" : "")}>${r.place ? `${r.place}. ` : ""}${r.name}${r.club ? ` (${r.club})` : ""}${r.splits ? "" : ` — ${t("an.noSplitsShort")}`}</option>`)}</select></label>`
      : html`<div class="field"><span></span><span class="muted">${t("an.noList")}</span></div>`}`;
    // a choice by hand: the race found from the trace is no longer the one shown
    $("#an-race").addEventListener("change", async (e) => { key = e.target.value; query = {}; matchedNote = ""; await loadRace(); pickers(); setup(); });
    $("#an-doc")?.addEventListener("change", (e) => { di = Number(e.target.value); ci = 0; ri = 0; matchedNote = ""; pickers(); setup(); });
    $("#an-c")?.addEventListener("change", (e) => { ci = Number(e.target.value); ri = 0; matchedNote = ""; pickers(); setup(); });
    $("#an-r")?.addEventListener("change", (e) => { ri = Number(e.target.value); matchedNote = ""; pickers(); setup(); });
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
      <p class="hint an-fit-tip">${t("an.fitTip")}</p>
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
      stop(); prepToken++;                                  // a calibration under way stops with its files
      for (const role of Object.keys(files)) files[role] = null;
      map = null; track = null; courseCache = null; course = null; restoredFiles = false; memos[pageMode] = null;
      idbWrite(null, fileKey).catch(() => {});
      filesCard(); setup();
    });
    const drop = $("#an-drop");
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take([...e.dataTransfer.files]); });
    $("#an-iof-course")?.addEventListener("change", (e) => { iofIndex = Number(e.target.value); setup(); });
  }
  async function take(list, { remember = true } = {}) {
    let newTrace = false;
    for (const f of list) {
      const name = f.name, low = name.toLowerCase();
      for (const role of Object.keys(files)) if (files[role]?.file === f) files[role] = null;
      try {
        if (isTraceName(name)) {
          newTrace = true;
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
    // the race of the trace, for a trace just dropped only: files read back (a reload, a tab opened by « ↗ ») keep the race,
    // circuit and runner chosen with them — matching again could pick another race or runner than the one chosen by hand,
    // whose calibration is not the one kept, and the new tab stopped at the calibration instead of playing (owner, 2026-10-18)
    if (newTrace && track && remember) {
      matchedNote = "";
      if (await matchRace() && files.trace) files.trace.note = race?.date_iso && parisDay(track.ms0) !== race.date_iso ? t("an.date.diff", { d1: fmtDate(parisDay(track.ms0)), d2: fmtDate(race.date_iso) }) : "";
    }
    if (newTrace && track) cadence(track);             // once the race is known (a VTT race: pedal turns)
    filesCard();
    setup();
  }
  /**
   * The race of the trace's day and its runner, when the race chosen is not the trace's (another day, or a runner whose
   * published start is not in the trace — the page opens on the account's latest race): the runner whose published
   * start falls at the trace's beginning, else the account's own run that day, else that day's race with the account.
   */
  async function matchRace() {
    if (perso || !track || timesApply()) return false;
    const day = parisDay(track.ms0), t0 = traceStartS(), sameDay = races.filter((r) => r.date_iso === day);
    let best = null;
    for (const rc of sameDay) {
      let data = null;
      try { data = await getProv(`${encodeURIComponent(rc.key)}.json`); } catch (e) { continue; }
      // a runner's start from any list of the race (liveresultat's gives it when the organiser's does not)
      const starts = new Map();
      const nk = (n) => (n || "").toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").sort().join(" ");
      for (const d of data?.docs || []) for (const k of d.classes || []) for (const x of k.runners || []) if (x.start_s != null) starts.set(nk(x.name), x.start_s);
      for (const d of data?.docs || []) for (const k of d.classes || []) for (const x of k.runners || []) {
        if (x.status === "dns") continue;
        const s = x.start_s ?? starts.get(nk(x.name)) ?? null;
        let score = runFit(s, x);
        if (score == null && me?.lic && x.lic === me.lic && s == null) score = 20000;              // one's own run that day
        if (score != null && (!best || score < best.score)) best = { key: rc.key, name: x.name, score, race: rc.name };
      }
    }
    if (!best && sameDay.length) { const rc = sameDay.find((r) => (r.lics || []).includes(me?.lic)) || sameDay[0]; best = { key: rc.key, name: null, race: rc.name }; }
    if (!best) return false;
    key = best.key; query = best.name ? { r: best.name } : {};
    await loadRace(); pickers();
    matchedNote = t("an.st.matched", { race: best.race, r: runner()?.name || "" });
    return true;
  }
  /**
   * The cadence as runners read it (owner, 2026-10-15): watches record one foot's strides a minute, or a bike's pedal
   * turns. On foot it is doubled to steps a minute (« pas/min », 160-190 running); on a bike it stays in « tr/min ». The
   * activity the file names decides; a file naming none is on foot unless the race chosen is a VTT one. Once per track.
   */
  function cadence(tr) {
    if (!tr.ch.cad || tr.cadUnit) return;
    const bike = tr.activity === "bike" || (!tr.activity && /\bvtt\b|v[ée]lo|mtb/i.test(race?.name || ""));
    if (!bike) for (let i = 0; i < tr.ch.cad.length; i++) tr.ch.cad[i] *= 2;
    tr.cadUnit = t(bike ? "an.unit.rpm" : "an.unit.spm");
  }
  const unitOf = (c) => (c === "cad" ? track?.cadUnit || t("an.unit.spm") : CHANNEL_UNIT[c]);
  /** The files kept for the tab's session, in IndexedDB (never sent). */
  function rememberFiles() {
    const tag = sessionTag();
    if (!tag) return;
    const seen = new Set(), entries = [];
    for (const role of Object.keys(files)) { const f = files[role]?.file; if (f && !seen.has(f)) { seen.add(f); entries.push({ role, name: f.name, type: f.type, blob: f }); } }
    idbWrite(entries.length ? { tag, at: Date.now(), entries } : null, fileKey).catch(() => {});
  }
  /** The files of the last visit of this tab, read again. */
  async function restoreFromIdb() {
    const tag = sessionTag();
    let rec = null;
    try { rec = await idbRead(fileKey); } catch (e) { return; }
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
  const hideResults = () => {
    close3d(); $("#an-3d").hidden = true; rcReset();
    $("#an-legs").hidden = true; $("#an-strip-card").hidden = true; $("#an-split-g").hidden = true; $("#an-split-s").hidden = true;
    $("#an-hud").textContent = ""; $("#an-legend").hidden = true; showPanels(true); document.body.classList.remove("an-theatre"); fitHeight();
  };
  /** The playback's layout as set: where the curves are, collapsed or not, the panels' sizes, the height. */
  function applyLayout() {
    layoutEl.dataset.layout = glayout;
    layoutEl.dataset.graphs = gcol ? "collapsed" : "open";
    layoutEl.style.setProperty("--an-gw", `${gcol ? 36 : gw}px`);
    layoutEl.style.setProperty("--an-gh", `${gcol ? 36 : gh}px`);
    layoutEl.style.setProperty("--an-sw", `${sw}px`);
    const b = $("#an-collapse");
    if (b) { b.textContent = glayout === "left" ? (gcol ? "›" : "‹") : (gcol ? "⌃" : "⌄"); b.title = t(gcol ? "an.graphs.open" : "an.graphs.close"); }
    fitHeight();
  }
  /** During the playback the layout fills the window below its top: no scrollbar on a desktop screen. */
  function fitHeight() {
    if (!document.body.classList.contains("an-theatre")) { layoutEl.style.removeProperty("--an-h"); return; }
    const top = layoutEl.getBoundingClientRect().top + window.scrollY;
    layoutEl.style.setProperty("--an-h", `${Math.max(380, Math.floor(innerHeight - top - 14))}px`);
  }
  function bindSplit(el, kind) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // the drag is followed on the window: a fast move leaves the thin splitter
      e.preventDefault(); el.classList.add("dragging"); document.body.style.userSelect = "none";
      const rect = layoutEl.getBoundingClientRect();
      const move = (ev) => {
        if (kind === "s") sw = Math.round(Math.min(560, Math.max(220, rect.right - ev.clientX - 5)));
        else if (glayout === "left") { gw = Math.round(Math.min(rect.width - sw - 260, Math.max(180, ev.clientX - rect.left - 5))); gcol = false; }
        else { gh = Math.round(Math.min(rect.height - 220, Math.max(90, rect.bottom - ev.clientY - 5))); gcol = false; }
        applyLayout();
      };
      const up = () => {
        el.classList.remove("dragging"); document.body.style.userSelect = "";
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
        savePrefs();
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    });
  }
  const toggleGraphs = () => { gcol = !gcol; savePrefs(); applyLayout(); };
  bindSplit($("#an-split-g"), "g"); bindSplit($("#an-split-s"), "s");
  $("#an-split-g").addEventListener("dblclick", toggleGraphs);
  $("#an-collapse").addEventListener("click", toggleGraphs);
  const onWinResize = () => fitHeight();
  window.addEventListener("resize", onWinResize);
  /** During the playback the race's pickers and the files card give way to one line (owner, 2026-10-14). */
  function showPanels(on) {
    $("#an-pick").hidden = $("#an-rf").hidden = perso || !on; $("#an-files").hidden = !on;
    const brief = $("#an-brief");
    brief.hidden = on;
    // during the playback the race's line sits in the map's top left corner, so that the site's menus can stay as on
    // every page (owner, 2026-10-15: the second row hidden and a tab turned into a menu confused); back above after
    if (on) { $("#an-rf").before(brief); return; }
    $(".an-map").prepend(brief);
    const r = runner(), rc = races.find((x) => x.key === key);
    brief.innerHTML = html`<button type="button" class="btn btn-sm" id="an-brief-edit" aria-expanded="false">${t("an.brief.edit")} ▾</button>
      <span>${perso ? html`<b>${t("an.perso.title")}</b>` : html`<b>${rc?.name || ""}</b> · ${klass()?.name || ""} · ${r?.name || ""}`}</span>
      <span class="muted">${[files.map?.name, files.trace?.name && track ? `${files.trace.name} (${clock(track.dur)})` : files.trace?.name, files.geo?.name || files.world?.name, files.iof?.name].filter(Boolean).join(" · ")}</span>`;
    // the race's and the files' choices open above the display, which stays; changing one of them starts a new
    // calibration (its inputs changed) — the display itself has nothing to recalibrate (owner, 2026-10-14)
    $("#an-brief-edit").addEventListener("click", (e) => {
      const open = $("#an-files").hidden;
      $("#an-pick").hidden = $("#an-rf").hidden = perso || !open; $("#an-files").hidden = !open;
      e.currentTarget.setAttribute("aria-expanded", String(open));
      e.currentTarget.textContent = `${t("an.brief.edit")} ${open ? "▴" : "▾"}`;
      fitHeight();
    });
  }
  const setStatus = (s) => { status = s; side(); };
  const calKey = () => `${CAL_KEY}.${key}.${di}.${ci}.${runner()?.name}.${map?.width}x${map?.height}`;
  // the trace a calibration was made with: its geometry is in that trace's own metres, and another trace (the complete
  // file after a cut one, 2026-10-15) has other passes — it starts afresh
  const traceSig = () => (track ? `${Math.round(track.ms0 / 1000)}:${track.n}` : null);
  function savePositions(done = calibrated) {
    const rec = { v: 2, done, trace: traceSig(), items: targets.map((g) => ({ kind: g.kind, code: g.code || "", pos: g.pos || null })),
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
    if (startS == null || !race?.date_iso || !timesApply()) return null;
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
      const s = startOf(x), sc = runFit(s, x);
      if (sc == null || (best && sc >= best.score)) return;
      best = { name: x.name, di: i, ci: j, ri: n, start: s, score: sc };
    })));
    return { t0, mine, dns: r?.status === "dns", other: best };
  }
  /**
   * How well a published run fits the trace — the seconds of slack at both ends (the watch started before the start,
   * stopped after the finish) — or null when it cannot be this trace's: the trace covers the start (started 5 min late
   * at most) and the finish (2 min). Runners start a minute apart: the start alone took Romane for Nadejda, whose
   * finish falls 2 s before the trace ends where Romane's falls 50 min after it (2026-10-15).
   */
  function runFit(s, x) {
    if (s == null || !track) return null;
    const t0 = traceStartS(), end = t0 + track.dur;
    if (s < t0 - 300 || s > end) return null;
    if (x.status !== "ok" || x.time_s == null) return 3600 + Math.max(0, s - t0);         // no finish to check: weaker
    const f = s + x.time_s;
    return f > end + 120 ? null : Math.max(0, s - t0) + Math.max(0, end - f);
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
    if (kept && kept.items.some((s) => s.pos) && kept.trace === traceSig()) {
      const taus = officialTaus();
      if (taus) { targets = officialTargets(null); if (kept.items.length === targets.length) kept.items.forEach((s, i) => { targets[i].pos = s.pos; }); }
      else targets = kept.items.map((s, i) => ({ i, kind: s.kind, code: s.code || "", pos: s.pos, tau: null, tEst: null, label: s.kind === "start" ? t("an.start") : s.kind === "finish" ? t("an.finish") : "" }));
      const geometry = geoFit || (kept.fit ? { ...kept.fit } : null);
      notes.push(t("an.st.restored"));
      recompute({ geometry });
      cur = nextTarget(0);
      side(); draw();
      // ready, not played: the page opens on the files and the calibration (« Voir la course » plays it), so that new
      // files can be dropped — it went straight to the playback, and the files could no longer be changed (owner, 2026-10-15);
      // except in a tab opened by « ↗ » during the playback, which goes on with it
      if (autoPlay && fit && offset != null) { autoPlay = false; finish(); }
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
    // the finish not read (its colours lost over water or yellow, a line across it): looked for where the trace ends
    if (geometry && course?.probeFinish && !iofCourse && !pts.some((p) => p.kind === "finish" && p.pos)) {
      const k = track.n - 1, [ex, ey] = toPx(geometry, track.x[k], track.y[k]);
      const sc = geometry.scale || Math.sqrt(Math.abs(geometry.m11 * geometry.m22 - geometry.m12 * geometry.m21));
      const hit = ex >= 0 && ey >= 0 && ex <= map.width && ey <= map.height ? course.probeFinish(ex, ey, 50 * sc) : null;
      if (hit) {
        for (let i = pts.length - 1; i >= 0; i--) if (pts[i].kind === "finish") pts.splice(i, 1);
        pts.push({ kind: "finish", code: "", pos: [hit.x, hit.y], probed: true });
        located = pts.filter((p) => p.pos);
        notes.push(t("an.st.finishFound"));
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
        const passT = located.filter((g) => g.kind === "control" && g.tEst != null).map((g) => g.tEst);
        const firstPass = passT.length ? Math.min(...passT) : null;           // the earliest pass (the list is not in time order)
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
    // the race ends at the published time, else at the finish's arrival; with neither (a finish not read on the map,
    // no published time), the trace's end — never the last control found, which cut the race short (owner, 2026-10-14)
    const finT = targets[targets.length - 1]?.kind === "finish" ? times[times.length - 1] : null;
    total = tot ?? finT ?? Math.max(lastT ?? 0, track.dur - (offset || 0));
    const n = targets.length - 1;
    const taus = officialTaus();
    let best = [], ref = [], all = [], mine = [];
    if (taus) {
      const cumOf = (x) => Array.from({ length: n }, (_, i) => (i < n - 1 ? x.splits?.[i] ?? null : x.status === "ok" ? x.time_s : null));
      const legsOf = (x) => { const c = cumOf(x); return c.map((v, i) => (v != null && (i === 0 || c[i - 1] != null) ? v - (i ? c[i - 1] : 0) : null)); };
      all = k.runners.filter((x) => x.splits).map(legsOf);
      best = bestLegs(all, n);
      ref = refLegs(all, n);                // (the time lost: trace/legs.js, as « Analyse de course »)
      mine = legsOf(r);
    } else mine = times.slice(1).map((v, i) => (v != null && times[i] != null ? v - times[i] : null));     // per leg
    legs = [];
    const loss = taus ? legLoss(mine, ref) : [];
    for (let i = 0; i < n; i++) {
      const from = targets[i], to = targets[i + 1], t0 = times[i], t1 = times[i + 1];
      const leg = { n: i + 1, code: to.code || "", label: to.label, t0, t1, time: mine[i], best: best[i] ?? null, rank: null, lost: null, mistake: false, dist: null, straight: null, v: null, hr: null, cad: null, estimated: !taus };
      if (taus && leg.time != null) leg.rank = 1 + all.filter((l) => l[i] != null && l[i] < leg.time).length;
      if (taus && leg.time != null && loss[i].lost != null) { leg.lost = loss[i].lost; leg.mistake = loss[i].mistake; }
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
    else if (r && !perso && !timesNote()) summary.push(totalOfficial() ? t("an.st.totalOnly") : t("an.st.noTimes"));
    const short = traceShortNote();
    if (short) summary.push(short);
    if (matchedNote) summary.push(matchedNote);
    const tn = timesNote();
    if (tn) summary.push(tn);
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
    document.body.classList.add("an-theatre");           // the page head and the steps give way to the map; the menus stay
    window.scrollTo(0, 0);
    const avail = Object.keys(track.ch).filter((c) => CHANNEL_LABEL[c]);
    const known = sequenceKnown();
    const short = [traceShortNote(), timesNote()].filter(Boolean);
    $("#an-side").innerHTML = html`
      ${short.map((s) => html`<div class="notice" style="margin-bottom:6px">${s}</div>`)}
      <div class="an-transport">
        <button type="button" class="btn btn-sm" id="an-prev" title="${t("an.prevLeg")}">⏮</button>
        <button type="button" class="btn btn-sm btn-primary" id="an-play" title="${t("an.play")}">▶</button>
        <button type="button" class="btn btn-sm" id="an-next" title="${t("an.nextLeg")}">⏭</button>
        <select id="an-speed" aria-label="${t("an.speed")}">${SPEEDS.map((s) => html`<option value="${s}" ${raw(s === speed ? "selected" : "")}>× ${s}</option>`)}</select>
        <button type="button" class="btn btn-sm an-follow" id="an-follow" aria-pressed="${follow}" title="${t("an.follow.hint")}">⌖ ${t("an.follow.short")}</button>
        <span class="fw-btns">${raw(fwButtons())}</span></div>
      <input type="range" id="an-time" min="0" max="${Math.ceil(total)}" step="0.5" value="0" style="width:100%;margin:6px 0 4px">
      <dl class="an-stats">
        <dt>${t("an.time")}</dt><dd><b id="an-t">0:00</b> <span class="muted" id="an-t-sub"></span></dd>
        <dt>${t(known ? "an.leg" : "an.legNear")}</dt><dd><b id="an-leg">—</b> <span class="muted" id="an-leg-sub"></span></dd>
        <dt>${t("an.pace")}</dt><dd><b id="an-pace">—</b> <span class="muted">${t("an.pace.short")}</span></dd>
        <dt>${t("an.dist")}</dt><dd><b id="an-dist">0 m</b> <span class="muted" id="an-dist-sub"></span></dd>
        ${avail.filter((c) => c !== "ele").map((c) => html`<dt>${t(CHANNEL_LABEL[c])}</dt><dd><b id="an-ch-${c}">—</b> <span class="muted">${unitOf(c)}</span></dd>`)}
      </dl>
      <details class="an-settings" open><summary>${t("an.display")}</summary>
        <div class="an-opts">
          <label><span>${t("an.graphs.where")}</span><select id="an-glayout"><option value="left" ${raw(glayout === "left" ? "selected" : "")}>${t("an.graphs.left")}</option><option value="below" ${raw(glayout === "below" ? "selected" : "")}>${t("an.graphs.below")}</option></select></label>
          <label><span>${t("an.width")}</span><select id="an-width">${WIDTHS.map(([w, k]) => html`<option value="${w}" ${raw(w === width ? "selected" : "")}>${t(k)}</option>`)}</select></label>
          <label><span>${t("an.colour")}</span><select id="an-colour"><option value="plain" ${raw(colour === "plain" ? "selected" : "")}>${t("an.colour.plain")}</option><option value="speed" ${raw(colour === "speed" ? "selected" : "")}>${t("an.colour.speed")}</option></select></label>
          <label id="an-colour-row" ${raw(colour === "speed" ? "hidden" : "")}><span>${t("an.traceColour")}</span><span class="an-swatches">${TRACE_PRESETS.map((c) => html`<button type="button" class="an-swatch" data-colour="${c}" style="background:${c}" aria-pressed="${c === traceColour}" title="${c}"></button>`)}<input type="color" id="an-colour-pick" value="${traceColour}" title="${t("an.traceColour.any")}"></span></label>
          <label><span>${t("an.future")}</span><select id="an-future"><option value="hide" ${raw(future === "hide" ? "selected" : "")}>${t("an.future.hide")}</option><option value="faint" ${raw(future === "faint" ? "selected" : "")}>${t("an.future.faint")}</option></select></label>
          <label><span>${t("an.tail")}</span><select id="an-tail">${TAILS.map((s) => html`<option value="${s}" ${raw(s === tail ? "selected" : "")}>${s ? clock(s) : t("an.tail.all")}</option>`)}</select></label>
          <label><span>${t("an.mapAlpha")}</span><input type="range" id="an-map-alpha" min="10" max="100" step="5" value="${mapAlpha}"></label>
          <label><span>${t("an.traceAlpha")}</span><input type="range" id="an-trace-alpha" min="10" max="100" step="5" value="${traceAlpha}"></label>
        </div><div id="an-3d-opts" hidden></div></details>
      ${me?.admin ? html`<div id="rc-host"></div>` : ""}
      ${rmsM != null || geoHow ? html`<div class="an-fitbox muted">${rmsM != null ? html`${t("an.cal.fit")} ${fmt(rmsM)} m` : ""}${geoHow ? html`${rmsM != null ? " · " : ""}${t("an.st.geo")} ${geoHow}` : ""}</div>` : ""}`;
    $("#an-play").addEventListener("click", () => (playing ? stop() : play()));
    $("#an-prev").addEventListener("click", () => jumpLeg(-1));
    $("#an-next").addEventListener("click", () => jumpLeg(1));
    $("#an-speed").addEventListener("change", (e) => { speed = Number(e.target.value); });
    const slider = $("#an-time");
    slider.addEventListener("input", (e) => { seek(Number(e.target.value)); });
    slider.addEventListener("pointerdown", () => { scrubbing = true; });
    slider.addEventListener("pointerup", () => { scrubbing = false; });
    $("#an-follow").addEventListener("click", () => { setFollow(!follow); draw(); });
    $("#an-glayout").addEventListener("change", (e) => { glayout = e.target.value; savePrefs(); applyLayout(); });
    // the trace's colour applies to the plain trace only: hidden while it is coloured by pace
    $("#an-colour").addEventListener("change", (e) => { colour = e.target.value; $("#an-colour-row").hidden = colour === "speed"; savePrefs(); paceLegend(); draw(); });
    $("#an-width").addEventListener("change", (e) => { width = Number(e.target.value); savePrefs(); draw(); });
    $("#an-map-alpha").addEventListener("input", (e) => { mapAlpha = Number(e.target.value); savePrefs(); draw(); });
    $("#an-trace-alpha").addEventListener("input", (e) => { traceAlpha = Number(e.target.value); savePrefs(); draw(); });
    $("#an-tail").addEventListener("change", (e) => { tail = Number(e.target.value); savePrefs(); draw(); });
    $("#an-future").addEventListener("change", (e) => { future = e.target.value; savePrefs(); draw(); });
    const setColour = (c) => { traceColour = c; savePrefs(); $$(".an-swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.colour === c))); $("#an-colour-pick").value = c; draw(); drawChips(); };
    $$(".an-swatch").forEach((b) => b.addEventListener("click", () => setColour(b.dataset.colour)));
    $("#an-colour-pick").addEventListener("input", (e) => setColour(e.target.value));
    // the curves under the map: the pace and the file's channels, any number of them, one above the other
    const chipsBox = $("#an-chips");
    const drawChips = () => {
      chipsBox.innerHTML = html`${["pace", ...avail].map((c) => html`<button type="button" class="an-chip" data-ch="${c}" aria-pressed="${chans.has(c)}" style="--chip:${curveColour(c)}">${t(c === "pace" ? "an.ch.pace" : CHANNEL_LABEL[c])}</button>`)}`;
      $$("[data-ch]", chipsBox).forEach((b) => b.addEventListener("click", () => { const c = b.dataset.ch; if (chans.has(c)) chans.delete(c); else chans.add(c); savePrefs(); drawChips(); sizeStrip(); drawStrip(); }));
    };
    drawChips();
    redrawChips = drawChips;
    $("#an-strip-card").hidden = false; $("#an-split-g").hidden = false; $("#an-split-s").hidden = false;
    applyLayout();
    if (known) legsTable(); else { $("#an-legs").hidden = true; $("#an-legs").innerHTML = ""; }
    sizeStrip();
    paceLegend();
    if (legs[0]?.t1 != null) zoomTo(legs[0], 1.15, 30); else fitTrace();    // the first leg, a small margin around it
    seek(0);
    $("#an-3d").hidden = false;
    if (autoV3) { autoV3 = false; toggle3d(); }
    rcPanel();
    if (rcs.on) rcStart();
  }
  /** A trace that ends before the race does — before the published time, or far from the finish placed on the map —
   *  was cut short (a file synced before the end, a watch stopped early): said plainly, nothing can show the rest. */
  function traceShortNote() {
    if (!track || !fit || offset == null) return "";
    const end = track.dur - offset, tot = totalOfficial();
    if (tot && end < tot - 60) return t("an.st.short", { t: clock(Math.max(0, end)), T: clock(tot) });
    const fin = targets.find((g) => g.kind === "finish" && g.pos);
    if (!fin) return "";
    const [fx, fy] = toM(fit, fin.pos[0], fin.pos[1]), d = Math.hypot(track.x[track.n - 1] - fx, track.y[track.n - 1] - fy);
    return d > 200 ? t("an.st.shortFar", { t: clock(Math.max(0, end)), d: fmt(Math.round(d / 10) * 10) }) : "";
  }
  /** The view on the race: the whole trace, as large as the box allows (restored: lost in c00a655). */
  function fitTrace() {
    if (!fit || offset == null || !pxs) return;
    const a = indexAt(track, offset), b = indexAt(track, offset + total);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = a; i <= b; i++) { x0 = Math.min(x0, pxs[i]); y0 = Math.min(y0, pys[i]); x1 = Math.max(x1, pxs[i]); y1 = Math.max(y1, pys[i]); }
    const { w, h } = box();
    if (!w || !h) { pendingFit = fitTrace; return; }
    if (x1 <= x0) return;
    pendingFit = null;
    const top = topReserved(), hh = Math.max(60, h - top);
    const k = Math.min(w / (x1 - x0 + 60), hh / (y1 - y0 + 60), 8);
    view = { k, ox: w / 2 - ((x0 + x1) / 2) * k, oy: top + hh / 2 - ((y0 + y1) / 2) * k };
    lastBox = { w, h };
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
        ${hasHr ? html`<th class="r">${t("an.col.hr")}</th>` : ""}${hasCad ? html`<th class="r" title="${unitOf("cad")}">${t("an.col.cad")} <span class="muted">${unitOf("cad")}</span></th>` : ""}</tr></thead>
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
  function zoomTo(l, margin = 1.3, pad = 40) {
    if (!fit || l.t1 == null) return;
    const a = indexAt(track, offset + l.t0), b = indexAt(track, offset + l.t1);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = a; i <= b; i++) { x0 = Math.min(x0, pxs[i]); y0 = Math.min(y0, pys[i]); x1 = Math.max(x1, pxs[i]); y1 = Math.max(y1, pys[i]); }
    const { w, h } = box();
    // a map without a size yet (being laid out) would give a zoom of 0, which no zooming could undo: done once it has one
    if (!w || !h || !(x1 >= x0)) { pendingFit = () => zoomTo(l, margin, pad); return; }
    pendingFit = null;
    const top = topReserved(), hh = Math.max(60, h - top);
    const k = Math.min(w / Math.max(60, (x1 - x0) * margin + pad), hh / Math.max(60, (y1 - y0) * margin + pad), 5);
    view = { k, ox: w / 2 - ((x0 + x1) / 2) * k, oy: top + hh / 2 - ((y0 + y1) / 2) * k };
    lastBox = { w, h };
    setFollow(false);
  }

  // ---- the map canvas: pan, zoom, click
  const box = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  let pendingFit = null;                                // the view to set once the map has a size
  /** The map's top band the race's line covers during the playback: the views fitted keep the trace below it. */
  const topReserved = () => { const b = $("#an-brief"); return b && !b.hidden && b.closest(".an-map") ? b.offsetHeight + 8 : 0; };
  function size() {
    const dpr = window.devicePixelRatio || 1, { w, h } = box();
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  function fitView() {
    const { w, h } = box();
    const k = w && h ? Math.min(w / map.width, h / map.height) : 1;       // a hidden box has no size
    view = { k, ox: (w - map.width * k) / 2, oy: (h - map.height * k) / 2 };
    lastBox = { w, h };
  }
  function zoomBy(f, cx, cy) {
    const { w, h } = box();
    if (!(view.k > 0) || !Number.isFinite(view.k)) { if (calibrated) fitTrace(); else fitView(); if (!(view.k > 0)) return; }
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
      if (drag.moved) { view = { ...view, ox: drag.ox + dx, oy: drag.oy + dy }; if (follow) setFollow(false); draw(); }
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
  $("#an-zin").addEventListener("click", () => (v3 ? v3.zoom(1.4) : zoomBy(1.4)));
  $("#an-zout").addEventListener("click", () => (v3 ? v3.zoom(1 / 1.4) : zoomBy(1 / 1.4)));
  $("#an-fit").addEventListener("click", () => { if (!map) return; if (v3) { setFollow(false); v3.setFollow(false); v3.fitTrace(); return; } if (calibrated) { fitTrace(); setFollow(false); } else fitView(); draw(); });
  $("#an-map").addEventListener("click", () => { if (v3) { setFollow(false); v3.setFollow(false); v3.fitMap(); return; } if (map) { fitView(); draw(); } });
  $("#an-3d").addEventListener("click", () => toggle3d());
  const ro = new ResizeObserver(() => {
    if (!map) return;
    const b = box();
    if (pendingFit && b.w && b.h) pendingFit();
    if (lastBox && b.w && b.h && (b.w !== lastBox.w || b.h !== lastBox.h)) {
      view = { ...view, ox: view.ox + (b.w - lastBox.w) / 2, oy: view.oy + (b.h - lastBox.h) / 2 };
      lastBox = b;
    }
    size(); sizeStrip(); draw(); drawStrip();
  });
  ro.observe(canvas); ro.observe(strip);
  let redrawChips = null;
  const themeWatch = new MutationObserver(() => { redrawChips?.(); drawStrip(); v3?.theme(); });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // the pace colours (trace/pacecolour.js): from the fastest (blue) through green to the slowest (red), on the trace's own 10-90 % range
  function paceScale() { [vLo, vHi] = paceRange(track.v); }
  /** The legend of the trace coloured by pace (owner, 2026-10-15: the colours said nothing without it): the colours
   *  from the fastest to the slowest, each with the pace it starts at, in the map's bottom right corner. */
  function paceLegend() {
    const el = $("#an-legend");
    if (!el) return;
    el.hidden = !(calibrated && colour === "speed");
    if (el.hidden) return;
    if (!vHi || vHi === 1) paceScale();
    el.innerHTML = paceLegendHtml(vLo, vHi);
  }
  const paceColour = (v) => paceColourOf(v, vLo, vHi);

  function draw() {
    if (!map) return;
    if (v3on) { sync3d(); return; }                    // the 3D view draws itself, on the same clock
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
    if (calibrated && rcs.on) {                       // the route choices computed (administrators, a prototype)
      if (rcs.pic) { ctx.globalAlpha = 0.6; ctx.imageSmoothingEnabled = false; ctx.drawImage(rcs.pic.canvas, 0, 0, rcs.pic.canvas.width * rcs.pic.cell, rcs.pic.canvas.height * rcs.pic.cell); ctx.globalAlpha = 1; }
      RC.drawRoutes(ctx, rcs.routes[Math.max(0, legAt(tNow))], lw, rcPace(), clock);
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (fit && fullPath && offset != null) {
      const s = offset + (calibrated ? tNow : total), iNow = indexAt(track, s), i0 = Math.max(0, indexAt(track, offset));
      // the whole trace, faint; the part run so far, full; the tail, thicker
      const bySpeed = calibrated && colour === "speed";
      if (!bySpeed && (!calibrated || future === "faint")) { ctx.globalAlpha = (calibrated ? 0.45 : 0.85) * ta; ctx.strokeStyle = traceColour; ctx.lineWidth = lw(2.5 * width); ctx.stroke(fullPath); }
      ctx.globalAlpha = ta;
      if (calibrated) {
        const iTail = tail ? Math.max(i0, indexAt(track, s - tail)) : i0;
        if (bySpeed) {                                   // the whole race coloured by pace, the part to come faint
          if (!vHi || vHi === 1) paceScale();
          const iEnd = future === "faint" ? indexAt(track, offset + total) : iNow;
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

  // ---- the route choices computed (trace/routeplan.js; administrators only, a prototype — 2026-10-24) ---------------------
  // each leg's fastest routes on the map as read, the route the runner took measured on the same model
  const rcs = { s: RC.loadSettings(), mapSet: false, pic: null, picOn: false, plan: null, planFor: "", planMap: null, dem: null, info: null,
    routes: [], mine: [], auto: null, token: 0, status: "", on: (() => { try { return localStorage.getItem("ocn.rc.on") === "1"; } catch (e) { return false; } })() };
  const rcPace = () => RC.paceOf(rcs.s, rcs.auto);
  const rcStatus = (text) => { rcs.status = text; RC.setStatus(text); };
  function rcReset() { rcs.token++; rcs.routes = []; rcs.mine = []; rcs.auto = null; const c = $("#an-rc"); if (c) { c.hidden = true; c.innerHTML = ""; } }
  function rcPanel() {
    const host = $("#rc-host");
    if (!host) return;
    host.innerHTML = RC.panelHtml(rcs.s, { on: rcs.on, picture: rcs.picOn, status: rcs.status, auto: rcs.auto });
    RC.bindPanel(host, rcs.s, (s, what) => {
      if (what === "on" || what === "off") {
        rcs.on = what === "on";
        try { localStorage.setItem("ocn.rc.on", rcs.on ? "1" : "0"); } catch (e) { /* this visit */ }
        if (rcs.on) rcStart(); else { rcReset(); draw(); }
      } else if (what === "picture-on") { rcs.picOn = true; rcPicture(); }
      else if (what === "picture-off") { rcs.picOn = false; rcs.pic = null; draw(); }
      else if (what === "pace") { rcTable(); draw(); }
      else { if (what === "map") rcs.mapSet = true; if (what === "reset") rcPanel(); rcRun(); }
    });
  }
  async function rcStart() {
    if (!rcs.on || !calibrated || !fit || !map) return;
    if (!rcs.mapSet) { rcs.s.map = !perso && RC.isSprint(race) ? "sprint" : "forest"; const sel = $("#rc-map"); if (sel) sel.value = rcs.s.map; }
    const my = ++rcs.token;
    const sig = [map.width, map.height, fit.m11, fit.m12, fit.m21, fit.m22, fit.tx, fit.ty].map((v) => Number(v).toFixed(5)).join(",");
    if (!rcs.plan || rcs.planFor !== sig || rcs.planMap !== map) {
      rcs.plan?.destroy();
      rcs.plan = RC.planner(map, (x, y) => toM(fit, x, y)); rcs.planFor = sig; rcs.planMap = map; rcs.dem = null; rcs.pic = null;
    }
    rcStatus(t("rc.st.reading"));
    try {
      rcs.info = await rcs.plan.ready;
      if (my !== rcs.token) return;
      if (!rcs.dem) {
        rcStatus(t("rc.st.relief"));
        try { const g = await heights((f) => { if (my === rcs.token) rcStatus(t("rc.st.reliefPct", { p: Math.round(100 * f) })); }); await rcs.plan.dem(g); rcs.dem = g.source; }
        catch (e) { console.warn(e); rcs.dem = "none"; }
        if (my !== rcs.token) return;
      }
      if (rcs.picOn) rcPicture();
      await rcRun();
    } catch (e) { console.error(e); if (my === rcs.token) rcStatus(t("rc.st.failed")); }
  }
  async function rcRun() {
    if (!rcs.plan || !rcs.on || !rcs.info) return;
    const my = ++rcs.token;
    rcs.routes = []; rcs.mine = []; rcs.auto = null;
    try {
      await rcs.plan.settings(rcs.s);
      if (my !== rcs.token) return;
      const n = targets.length - 1, now = Math.max(0, legAt(tNow));
      const order = [...Array(Math.max(0, n)).keys()].sort((a, b) => (a === now ? -1 : b === now ? 1 : a - b));
      let done = 0;
      const t0 = performance.now();
      for (const i of order) {
        rcStatus(t("rc.st.legs", { n: done, t: n }));
        const a = targets[i]?.pos, b = targets[i + 1]?.pos;
        if (a && b && !targets[i].missed && !targets[i + 1].missed) {
          const routes = await rcs.plan.leg(a, b);
          if (my !== rcs.token) return;
          rcs.routes[i] = routes;
          const l = legs[i];
          if (routes && l?.t0 != null && l.t1 != null && offset != null) {
            const i0 = indexAt(track, offset + l.t0), i1 = indexAt(track, offset + l.t1), pts = [];
            for (let k = i0; k <= i1; k++) pts.push([pxs[k], pys[k]]);
            if (pts.length > 1) {
              const m = await rcs.plan.line(pts);
              if (my !== rcs.token) return;
              rcs.mine[i] = { ...m, variant: RC.nearestRoute(routes, pts, 25 * fit.scale), actual: l.time };
            }
          }
          if (i === Math.max(0, legAt(tNow))) draw();
        }
        done++;
      }
      rcs.auto = RC.autoPace(rcs.mine.filter(Boolean).map((m) => ({ actual: m.actual, model: m.time })));
      const found = rcs.routes.filter(Boolean).length;
      rcStatus(t("rc.st.done", { n: found, t: n, s: fmt((performance.now() - t0) / 1000, 1), c: fmt(rcs.info.mpc, 1),
        r: rcs.dem && rcs.dem !== "none" ? CREDIT[rcs.dem]?.text || rcs.dem : t("rc.st.flat") }));
      const p = $("#rc-pace"); if (p && rcs.auto) p.placeholder = RC.minKm(rcs.auto);
      rcTable(); draw();
    } catch (e) { console.error(e); if (my === rcs.token) rcStatus(t("rc.st.failed")); }
  }
  window.anDebugRoutes = () => ({ on: rcs.on, info: rcs.info, dem: rcs.dem, routes: rcs.routes, mine: rcs.mine, auto: rcs.auto, settings: rcs.s });
  async function rcPicture() {
    if (!rcs.plan) return;
    try { rcs.pic = await rcs.plan.picture(); } catch (e) { rcs.pic = null; }
    if (!rcs.picOn) rcs.pic = null;
    draw();
  }
  /** The legs' routes as a table: each variant's time at the pace, length and climb; the runner's own, measured alike. */
  function rcTable() {
    const el = $("#an-rc");
    if (!el) return;
    const rows = legs.map((l, i) => ({ l, i, routes: rcs.routes[i], mine: rcs.mine[i] })).filter((x) => x.routes?.length);
    if (!rcs.on || !rows.length) { el.hidden = true; el.innerHTML = ""; return; }
    const pace = rcPace(), nV = Math.max(...rows.map((x) => x.routes.length));
    const how = rcs.s.pace > 0 ? "rc.pace.typed" : rcs.auto ? "rc.pace.auto" : "rc.pace.default";
    el.hidden = false;
    el.innerHTML = html`<div class="card-head"><div><h2>${t("rc.table")} <span class="pill rc-pill">${t("rc.admin")}</span></h2>
        <div class="hint">${t("rc.table.hint", { p: RC.minKm(pace), how: t(how) })}</div></div></div>
      <div class="table-wrap"><table class="data compact" data-freeze="1" data-freeze-phone="1"><thead><tr><th>${t("an.col.leg")}</th>
        ${Array.from({ length: nV }, (_, n) => html`<th><span class="rc-dot" style="background:${RC.ROUTE_COLOURS[n]}"></span> ${RC.LETTERS[n]}</th>`)}
        <th>${t("rc.col.mine")}</th><th class="r" title="${t("rc.col.choice.hint")}">${t("rc.col.choice")}</th><th class="r" title="${t("rc.col.exec.hint")}">${t("rc.col.exec")}</th></tr></thead>
      <tbody>${rows.map(({ l, i, routes, mine }) => {
        const best = routes[0].time;                    // the route suggested at the caution chosen
        return html`<tr data-leg="${i}" style="cursor:pointer"><td>${l.label}${l.code ? html` <span class="muted">${l.code}</span>` : ""}</td>
          ${Array.from({ length: nV }, (_, n) => { const r = routes[n]; return html`<td class="num">${r ? html`${RC.routeFacts(r, pace, clock)} <span class="muted">· ${RC.sideLabel(r)}</span>` : ""}</td>`; })}
          <td class="num">${mine ? html`${mine.variant >= 0 ? html`<span class="rc-dot" style="background:${RC.ROUTE_COLOURS[mine.variant]}"></span> ${RC.LETTERS[mine.variant]}` : t("rc.other")} · ${clock(mine.time * pace)} · ${fmt(Math.round(mine.len / 10) * 10)} m` : "—"}</td>
          <td class="r num">${mine ? signed(Math.round((mine.time - best) * pace)) : "—"}</td>
          <td class="r num">${mine && mine.actual != null ? signed(Math.round(mine.actual - mine.time * pace)) : "—"}</td></tr>`;
      })}</tbody></table></div>`;
    $$("#an-rc tr[data-leg]").forEach((tr) => tr.addEventListener("click", () => {
      const l = legs[Number(tr.dataset.leg)];
      if (l?.t0 == null) return;
      stop(); zoomTo(l); seek(l.t0);
    }));
  }

  // ---- the 3D view (a prototype, 2026-10-24): the map over the ground's heights, on the playback's own clock --------------
  /** The trace's time now: between two ticks of the playback's timer the 3D view moves on smoothly. */
  const clockNow = () => offset + (playing ? Math.min(total, tNow + ((performance.now() - last) / 1000) * speed) : tNow);
  /** A map pixel's [lat, lon], through the calibration (the trace's metres): only the map's area is asked of the services. */
  const pxLatLon = (px, py) => { const [mx, my] = toM(fit, px, py); return [track.lat0 - my / track.ky, track.lon0 + mx / track.kx]; };
  /** The heights under the map (trace/terrain.js), kept for the visit and in IndexedDB. */
  async function heights(onProgress) {
    const W = map.width, H = map.height, plan = gridPlan(W, H, (a, b) => toM(fit, a, b));
    const key = `${W}x${H}:${[[0, 0], [W, 0], [W, H], [0, H]].map(([a, b]) => pxLatLon(a, b).map((v) => v.toFixed(5)).join(",")).join(";")}`;
    if (v3grid?.key === key) return v3grid;
    v3refined = {};
    const g = await loadGrid({ key, ...plan, node: (i, j) => pxLatLon((i / (plan.nx - 1)) * W, (j / (plan.ny - 1)) * H), onProgress });
    v3grid = { ...g, key, plan };
    return v3grid;
  }
  const v3note = (text) => { const el = $("#an-3d-credit"); el.hidden = !text; el.innerHTML = text || ""; };
  async function toggle3d() {
    if (v3on) { close3d(); draw(); return; }
    if (!fit || offset == null || !track) return;
    const my = ++v3token;
    v3on = true;
    $("#an-3d").setAttribute("aria-pressed", "true");
    $("#an-3d-host").hidden = false; canvas.hidden = true;
    v3note(t("an.v3.loading"));
    try {
      const g = await heights((f) => { if (my === v3token) v3note(t("an.v3.loadingPct", { p: Math.round(100 * f) })); });
      if (my !== v3token) return;
      const { open3d } = await import("../trace/view3d.js");
      if (my !== v3token) return;
      const v = await open3d($("#an-3d-host"), { image: map, W: map.width, H: map.height, grid: g, toM: (x, y) => toM(fit, x, y), toPx: (x, y) => toPx(fit, x, y),
        track, i0: indexAt(track, offset), i1: indexAt(track, offset + total), now: clockNow, onUserMove: () => setFollow(false) });
      if (my !== v3token) { v.dispose(); return; }
      v3 = v; v3info = g;
      v3.setExaggeration(v3ex);
      if (v3relief === "contours") applyRelief();
      const c = CREDIT[g.source];
      v3note(html`${t("an.v3.relief")} <a href="${c.url}" target="_blank" rel="noopener">${c.text}</a>`);
      opts3d(); sync3d();
    } catch (e) {
      console.error(e);
      if (my !== v3token) return;
      close3d(); draw();
      v3note(t(e.message === "webgl" ? "an.v3.noWebgl" : "an.v3.failed"));
      setTimeout(() => { if (!v3on) v3note(""); }, 8000);
    }
  }
  function close3d() {
    v3token++;
    if (v3) { v3.dispose(); v3 = null; }
    if (!v3on) return;
    v3on = false;
    $("#an-3d").setAttribute("aria-pressed", "false");
    $("#an-3d-host").hidden = true; canvas.hidden = false; v3note("");
    const o = $("#an-3d-opts"); if (o) o.hidden = true;
  }
  /** The 2D's display settings passed on: the trace's colour or pace colours, width, the part to come, the tail. */
  function sync3d() {
    if (!v3) return;
    if (!vHi || vHi === 1) paceScale();
    const bySpeed = colour === "speed";
    v3.setStyle({ colourOf: (i) => (bySpeed ? paceColour(track.v[i]) : traceColour), colourKey: bySpeed ? `speed:${vLo}:${vHi}` : traceColour, width, future, tail, mapAlpha });
    v3.setFollow(follow);
  }
  /** The 3D view's own settings, under « Affichage »: the vertical exaggeration, the relief's source. */
  function opts3d() {
    const el = $("#an-3d-opts");
    if (!el || !v3info) return;
    const g = v3info;
    el.hidden = false;
    el.innerHTML = html`<div class="an-3d-head">${t("an.v3.title")}</div><div class="an-opts">
      <label><span>${t("an.v3.ex")}</span><span class="an-3d-ex"><input type="range" id="an-ex" min="1" max="3" step="0.25" value="${v3ex}"><b id="an-ex-v">× ${fmt(v3ex, 2)}</b></span></label></div>
      <label><span>${t("an.v3.relief.choice")}</span><select id="an-relief"><option value="dem" ${raw(v3relief === "dem" ? "selected" : "")}>${t("an.v3.relief.dem")}</option><option value="contours" ${raw(v3relief === "contours" ? "selected" : "")}>${t("an.v3.relief.contours")}</option></select></label>
      <label id="an-interval-row" ${raw(v3relief === "contours" ? "" : "hidden")}><span>${t("an.v3.interval")}</span><select id="an-interval"><option value="5" ${raw(v3interval === 5 ? "selected" : "")}>5 m</option><option value="2.5" ${raw(v3interval === 2.5 ? "selected" : "")}>${fmt(2.5, 1)} m</option></select></label></div>
      <p class="muted an-3d-info">${t(g.source === "tiles" ? "an.v3.info.tiles" : "an.v3.info.ign", { nx: g.nx, ny: g.ny, step: fmt(g.step, 1), s: g.cached ? t("an.v3.cached") : `${fmt(g.ms / 1000, 1)} s` })}</p>
      <p class="muted an-3d-info" id="an-relief-info"></p>`;
    $("#an-ex").addEventListener("input", (e) => { v3ex = Number(e.target.value); $("#an-ex-v").textContent = `× ${fmt(v3ex, 2)}`; v3?.setExaggeration(v3ex); savePrefs(); });
    $("#an-relief").addEventListener("change", (e) => { v3relief = e.target.value; $("#an-interval-row").hidden = v3relief !== "contours"; savePrefs(); applyRelief(); });
    $("#an-interval").addEventListener("change", (e) => { v3interval = Number(e.target.value); savePrefs(); applyRelief(); });
    reliefInfo();
  }
  /** The relief the view shows: the model alone, or with the map's own contour lines (trace/contours.js, an experiment). */
  async function applyRelief() {
    if (!v3 || !v3grid) return;
    if (v3relief !== "contours") { v3.setGrid(v3grid); reliefInfo(); return; }
    let r = v3refined[v3interval];
    if (r === undefined) {
      const el = $("#an-relief-info"); if (el) el.textContent = t("an.v3.contours.reading");
      await tick();
      const { refineGrid } = await import("../trace/contours.js");
      const mPerPx = Math.hypot(...[0, 1].map((k) => toM(fit, map.width, 0)[k] - toM(fit, 0, 0)[k])) / map.width;
      try { r = refineGrid(map, v3grid, map.width, map.height, mPerPx, { interval: v3interval }); } catch (e) { console.error(e); r = null; }
      v3refined[v3interval] = r;
      if (!v3 || v3relief !== "contours") return;
    }
    v3.setGrid(r || v3grid);
    reliefInfo();
  }
  function reliefInfo() {
    const el = $("#an-relief-info");
    if (!el) return;
    const r = v3refined[v3interval];
    el.textContent = v3relief !== "contours" ? "" : !r ? t("an.v3.contours.none")
      : `${t("an.v3.contours.info", { n: r.contours.pieces, s: fmt(r.contours.ms / 1000, 1) })} ${t(v3grid?.source === "tiles" ? "an.v3.contours.tiles" : "an.v3.contours.ign")}`;
  }
  window.anDebug3d = () => ({ on: v3on, grid: v3info && { nx: v3info.nx, ny: v3info.ny, step: v3info.step, source: v3info.source, ms: v3info.ms, cached: v3info.cached, zoom: v3info.zoom, tiles: v3info.tiles }, view: v3?.stats(), contours: v3refined[v3interval]?.contours });

  // ---- the curves under the map: one row per curve chosen, the same time axis, the controls' passes when the sequence is known
  const stripRows = () => ["pace", ...Object.keys(CHANNEL_COLOUR)].filter((c) => chans.has(c) && (c === "pace" || track.ch[c]));
  function sizeStrip() {
    const dpr = window.devicePixelRatio || 1;
    strip.width = Math.round(strip.clientWidth * dpr); strip.height = Math.round(strip.clientHeight * dpr);
  }
  function drawStrip() {
    if (!calibrated || !total) return;
    if (!vHi || vHi === 1) paceScale();
    const known = sequenceKnown();
    drawCurves(strip, { track, t0: offset, total, rows: stripRows(), cursor: tNow, units: { cad: unitOf("cad") },
      marks: targets.map((g, i) => { const tt = timeOf(g); return tt == null || !i ? null : { t: tt, label: known ? g.label : "" }; }).filter(Boolean),
      shade: known ? legs.filter((l) => l.mistake && l.t1 != null).map((l) => ({ t0: l.t0, t1: l.t1 })) : [] });
  }
  const scrub = (e) => { if (!calibrated) return; stop(); seek(curveTimeAt(strip, e.offsetX, total)); };
  strip.addEventListener("pointerdown", (e) => { scrub(e); strip.setPointerCapture(e.pointerId); strip.dataset.down = "1"; });
  strip.addEventListener("pointermove", (e) => { if (strip.dataset.down) scrub(e); });
  const stripUp = () => { delete strip.dataset.down; };
  strip.addEventListener("pointerup", stripUp); strip.addEventListener("pointercancel", stripUp);

  // files dropped anywhere on the page — on the map during the playback too — replace the current ones
  const dropAll = $("#an-dropall");
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  const onDragOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); dropAll.hidden = false; };
  const onDragLeave = (e) => { if (!e.relatedTarget) dropAll.hidden = true; };
  const onDrop = (e) => {
    dropAll.hidden = true;
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    if (e.target.closest?.("#an-drop")) return;                     // the drop zone takes its own
    take([...e.dataTransfer.files]);
  };
  window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop);

  // ---- go
  steps(1);
  await loadRace();
  pickers();
  const memo = memos[pageMode];
  // files opened with the installed app or shared to it (pwa.js): they join the files of the visit, as if dropped
  const received = await takeInbox();
  if (memo) {
    ({ map, track, courseCache, iofIndex, northUp, restoredFiles } = memo);
    Object.assign(files, memo.files);
    memos[pageMode] = null;
    filesCard(); setup();
  } else {
    filesCard(); setup();
    if (received.length) await restoreFromIdb(); else restoreFromIdb();
  }
  if (received.length) take(received);
  const onInbox = async () => { const got = await takeInbox(); if (got.length) take(got); };
  window.addEventListener("ocn:inbox", onInbox);
  return { title: t(perso ? "an.perso.title" : "an.title"), cleanup: () => {
    document.body.classList.remove("an-theatre");      // the site's menus come back on every other page
    leaveFull();
    window.removeEventListener("resize", onWinResize);
    window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop);
    window.removeEventListener("ocn:inbox", onInbox);
    themeWatch.disconnect();
    stop(); ro.disconnect(); prepToken++; close3d(); rcs.token++; rcs.plan?.destroy();
    if (map || track) memos[pageMode] = { map, track, courseCache, iofIndex, northUp, restoredFiles: true, files: { ...files } };
  } };
}
