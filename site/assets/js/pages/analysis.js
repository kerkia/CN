// « Analyse » (#/analyse, menu « Courses »; administrators only for now — owner, 2026-10-13): a runner's GPS trace on
// their own map, for a race of « Résultats », played back as Livelox does.
// 1. The race (one with results), the circuit and the runner — the logged-in one by default.
// 2. The map (an image, or a PDF's first page) and the trace (GPX or TCX), both read in the browser: nothing is sent,
//    nothing is kept but the calibration (the points clicked), on this device.
// 3. The calibration: the user clicks the centre of each control on the map, in order (start, 1, 2…, finish). The
//    published split times say when the runner punched each one, so each click pairs a map point with a trace point:
//    a similarity transform (rotation, scale, translation — the map is drawn to magnetic north) is fitted by least
//    squares, together with the trace's clock offset (the watch and the timing clock rarely agree; the start time is
//    often unknown): the offset is searched second by second over the trace, the fit refined around the best.
//    Two clicks suffice when the start time is known, three otherwise; more absorbs the GPS noise.
// 4. The playback: the trace on the map, plain or coloured by pace, the runner moving with a tail, play / pause and
//    speed, a jump to any control, « suivre le coureur »; the pace along the race under the map; a table of the legs
//    with their times, ranks and time lost (the split-times page's rule: lost ≥ 20 % of the leg and ≥ 10 s is a
//    mistake), the trace's length against the straight line, the pace.

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { getProv, clock } from "./provisional.js";
import { replaceQuery } from "../app.js";

const SPEEDS = [1, 2, 5, 10, 20, 60];
const TAILS = [30, 60, 120, 300, 0];                   // seconds of trace behind the runner; 0: all of it
const ERR = { pct: 20, s: 10 };                        // the split-times page's mistake rule
const CAL_KEY = "ocn.an.cal";                          // localStorage: the clicks, per race / circuit / runner / image
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const MAX_SIDE = 4200;                                 // a PDF page rendered at most this wide or high
const R_EARTH = 6371000;
const TRACE = "#c8102e";                               // the trace's own colour: a red the map's colours never use
const pace = (v) => (v > 0.05 ? `${Math.floor(1000 / v / 60)}'${String(Math.round((1000 / v) % 60)).padStart(2, "0")}` : "—");   // min/km from m/s
const signed = (s) => (s == null ? "—" : `${s >= 0 ? "+" : "−"}${clock(Math.abs(s))}`);

// ---- the trace ------------------------------------------------------------------------------------------------------
/** GPX (trkpt) or TCX (Trackpoint) text -> { ms0, t[], x[], y[], cum[], v[], n, lat0, lon0 } in local metres, north up
 *  (y down, like the image). Throws "gpx" when unreadable, "time" when the points carry no time. */
export function parseTrack(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("gpx");
  const pts = [];
  for (const p of doc.getElementsByTagName("trkpt")) {
    const time = p.getElementsByTagName("time")[0]?.textContent;
    pts.push({ lat: +p.getAttribute("lat"), lon: +p.getAttribute("lon"), ms: time ? Date.parse(time) : NaN });
  }
  if (!pts.length) for (const p of doc.getElementsByTagName("Trackpoint")) {
    const pos = p.getElementsByTagName("Position")[0];
    if (!pos) continue;
    pts.push({ lat: +pos.getElementsByTagName("LatitudeDegrees")[0]?.textContent, lon: +pos.getElementsByTagName("LongitudeDegrees")[0]?.textContent,
      ms: Date.parse(p.getElementsByTagName("Time")[0]?.textContent || "") });
  }
  const located = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!located.length) throw new Error("gpx");
  const timed = located.filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms);
  if (timed.length < 2) throw new Error("time");
  const P = timed.filter((p, i) => !i || p.ms > timed[i - 1].ms);           // one point per instant
  const n = P.length, lat0 = P.reduce((s, p) => s + p.lat, 0) / n, lon0 = P.reduce((s, p) => s + p.lon, 0) / n;
  const kx = (Math.PI / 180) * R_EARTH * Math.cos((lat0 * Math.PI) / 180), ky = (Math.PI / 180) * R_EARTH;
  const tt = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n), cum = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tt[i] = (P[i].ms - P[0].ms) / 1000;
    x[i] = (P[i].lon - lon0) * kx;
    y[i] = -(P[i].lat - lat0) * ky;
  }
  const tr = { ms0: P[0].ms, t: tt, x, y, cum, v, n, lat0, lon0, dur: tt[n - 1] };
  // the distance run: along the track smoothed over ± 3 s — the jitter of a 1 Hz trace adds metres at every step
  // (the trace is drawn raw); the pace: that distance over a window of ± 5 s
  let sx = x[0], sy = y[0];
  for (let i = 0; i < n; i++) {
    const a = indexAt(tr, tt[i] - 3), b = Math.min(n - 1, indexAt(tr, tt[i] + 3) + 1);
    let mx = 0, my = 0;
    for (let j = a; j <= b; j++) { mx += x[j]; my += y[j]; }
    mx /= b - a + 1; my /= b - a + 1;
    cum[i] = i ? cum[i - 1] + Math.hypot(mx - sx, my - sy) : 0;
    sx = mx; sy = my;
  }
  for (let i = 0; i < n; i++) {
    const a = indexAt(tr, tt[i] - 5), b = indexAt(tr, tt[i] + 5);
    v[i] = b > a && tt[b] > tt[a] ? (cum[b] - cum[a]) / (tt[b] - tt[a]) : 0;
  }
  return tr;
}
/** The last index whose time is ≤ s (0 before the trace). */
function indexAt(tr, s) {
  let lo = 0, hi = tr.n - 1;
  if (s <= tr.t[0]) return 0;
  if (s >= tr.t[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] <= s) lo = m; else hi = m; }
  return lo;
}
/** The position (metres) at trace time s, interpolated; clamped to the ends. */
function posAt(tr, s) {
  const i = indexAt(tr, s);
  if (i >= tr.n - 1 || s <= tr.t[0]) return [tr.x[i], tr.y[i]];
  const f = (s - tr.t[i]) / (tr.t[i + 1] - tr.t[i]);
  return [tr.x[i] + f * (tr.x[i + 1] - tr.x[i]), tr.y[i] + f * (tr.y[i + 1] - tr.y[i])];
}
const cumAt = (tr, s) => { const i = indexAt(tr, s); if (i >= tr.n - 1 || s <= tr.t[0]) return tr.cum[i];
  return tr.cum[i] + ((s - tr.t[i]) / (tr.t[i + 1] - tr.t[i])) * (tr.cum[i + 1] - tr.cum[i]); };
const speedAt = (tr, s) => tr.v[indexAt(tr, s)];

// ---- the fit --------------------------------------------------------------------------------------------------------
/** Least-squares similarity w = s·z + t (s complex) from metres (src) to pixels (dst): { a, b, tx, ty, rms, scale }. */
function fitSimilarity(src, dst) {
  const n = src.length;
  let mx = 0, my = 0, ux = 0, uy = 0;
  for (let i = 0; i < n; i++) { mx += src[i][0]; my += src[i][1]; ux += dst[i][0]; uy += dst[i][1]; }
  mx /= n; my /= n; ux /= n; uy /= n;
  let zz = 0, re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const zx = src[i][0] - mx, zy = src[i][1] - my, wx = dst[i][0] - ux, wy = dst[i][1] - uy;
    zz += zx * zx + zy * zy; re += zx * wx + zy * wy; im += zx * wy - zy * wx;
  }
  if (!zz) return null;
  const a = re / zz, b = im / zz, tx = ux - (a * mx - b * my), ty = uy - (b * mx + a * my);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    ss += (a * src[i][0] - b * src[i][1] + tx - dst[i][0]) ** 2 + (b * src[i][0] + a * src[i][1] + ty - dst[i][1]) ** 2;
  }
  return { a, b, tx, ty, rms: Math.sqrt(ss / n), scale: Math.hypot(a, b) };
}
/**
 * The calibration: pairs [{ tau (race seconds), px, py }] -> the similarity and the clock offset (the trace time of the
 * race start). guess: the offset the results' start time gives, if any; the search covers ± 15 min around it, else
 * the whole trace. Two pairs: the offset is the guess (or 0, the trace started at the start).
 */
function calibrate(tr, pairs, guess) {
  if (pairs.length < 2) return null;
  const evaluate = (d) => fitSimilarity(pairs.map((p) => posAt(tr, d + p.tau)), pairs.map((p) => [p.px, p.py]));
  if (pairs.length === 2) { const d = guess ?? 0; const f = evaluate(d); return f && { ...f, offset: d }; }
  const last = Math.max(...pairs.map((p) => p.tau));
  const lo = guess != null ? guess - 900 : Math.min(0, tr.dur - last) - 60, hi = guess != null ? guess + 900 : Math.max(0, tr.dur - last) + 60;
  let best = null;
  for (let d = lo; d <= hi; d += 1) { const f = evaluate(d); if (f && (!best || f.rms < best.rms)) best = { ...f, offset: d }; }
  if (!best) return null;
  for (let d = best.offset - 1; d <= best.offset + 1; d += 0.1) { const f = evaluate(d); if (f && f.rms < best.rms) best = { ...f, offset: d }; }
  return best;
}
const toPx = (f, x, y) => [f.a * x - f.b * y + f.tx, f.b * x + f.a * y + f.ty];
const toM = (f, px, py) => { const wx = px - f.tx, wy = py - f.ty, d = f.a * f.a + f.b * f.b;
  return [(f.a * wx + f.b * wy) / d, (f.a * wy - f.b * wx) / d]; };

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
const isTrace = (f) => /\.(gpx|tcx)$/i.test(f.name);
const isMap = (f) => /\.(png|jpe?g|webp|gif|bmp|pdf)$/i.test(f.name) || f.type.startsWith("image/") || f.type === "application/pdf";

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
    <div id="an-work" hidden>
      <div class="an-layout">
        <div class="an-map"><canvas id="an-canvas"></canvas>
          <div class="an-tools"><button type="button" class="btn btn-sm" id="an-zin" title="+">+</button><button type="button" class="btn btn-sm" id="an-zout" title="−">−</button>
            <button type="button" class="btn btn-sm" id="an-fit" title="${t("an.fitView")}">⤢</button></div>
          <div class="an-hud" id="an-hud"></div></div>
        <aside class="an-side" id="an-side"></aside>
      </div>
      <div class="card an-strip-card" id="an-strip-card" hidden><canvas id="an-strip"></canvas><div class="hint">${t("an.strip.hint")}</div></div>
      <section class="card" id="an-legs" hidden></section>
    </div>`;
  if (!races.length) {
    $("#an-pick").innerHTML = html`<div class="empty">${t("an.none")}</div>`;
    return { title: t("an.title") };
  }

  // ---- state
  let key = races.some((r) => r.key === query.course) ? query.course : (races.find((r) => (r.lics || []).includes(me?.lic)) || races[0]).key;
  let race = null, docs = [], di = 0, ci = 0, ri = 0;
  let map = null, mapName = "", track = null, traceName = "", notes = { map: "", gpx: "" };
  let targets = [], clicks = {}, cur = 0, fit = null, calibrated = false;
  let view = { k: 1, ox: 0, oy: 0 }, follow = true, colour = "plain", marks = true, tail = 60, speed = 10, playing = false, tNow = 0;
  let legs = [], total = 0, raf = 0, last = 0, pxs = null, pys = null, fullPath = null, scrubbing = false;
  let vLo = 0, vHi = 1;                               // the pace colours' range (10-90 % of the trace's speeds)
  const canvas = $("#an-canvas"), ctx = canvas.getContext("2d");
  const strip = $("#an-strip"), sctx = strip.getContext("2d");

  const steps = (n) => { $("#an-steps").innerHTML = html`${[t("an.s1"), t("an.s2"), t("an.s3"), t("an.s4")].map((s, i) => html`<li class="${i + 1 < n ? "done" : i + 1 === n ? "now" : ""}"><b>${i + 1}</b> ${s}</li>`)}`; };
  const stage = () => (!map || !track ? 2 : calibrated ? 4 : 3);

  // ---- 1. the race, the circuit, the runner
  async function loadRace() {
    race = await getProv(`${encodeURIComponent(key)}.json`);
    docs = (race?.docs || []).filter((d) => d.classes?.length && d.by !== "category");
    const rank = (d) => (d.classes.some((k) => k.runners.some((r) => r.splits)) ? 1e9 : 0) + (d.prio ?? 0);
    docs.sort((a, b) => rank(b) - rank(a));
    // the runner asked for (?r=), else the logged-in one, in the first document and circuit that holds them
    const wanted = query.r || null;
    const pick = (test) => { for (let i = 0; i < docs.length; i++) for (let j = 0; j < docs[i].classes.length; j++) {
      const n = docs[i].classes[j].runners.findIndex(test); if (n >= 0) return [i, j, n]; } return null; };
    const found = (wanted && pick((r) => r.name === wanted)) || (me && pick((r) => r.lic && r.lic === me.lic)) || [0, 0, 0];
    [di, ci, ri] = found;
    if (Number.isInteger(Number(query.doc)) && docs[Number(query.doc)] && !wanted) { di = Number(query.doc); ci = Math.min(Number(query.c) || 0, docs[di].classes.length - 1); ri = 0; }
    if (query.r && docs[di]?.classes[ci]) { const n = docs[di].classes[ci].runners.findIndex((r) => r.name === query.r); if (n >= 0) ri = n; }
  }
  const klass = () => docs[di]?.classes[ci], runner = () => klass()?.runners[ri];
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
  }

  // ---- 2. the files
  function files() {
    const box = (id, name, note, drop, hint) => html`<div class="an-file">
      <label class="dropzone${name ? " filled" : ""}" id="an-drop-${id}">
        <input type="file" id="an-in-${id}" accept="${id === "map" ? ".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,image/*,application/pdf" : ".gpx,.tcx"}" multiple hidden>
        <strong>${name ? html`${t(`an.${id}`)} : ${name}` : drop}</strong><span class="muted">${name ? t("an.change") : hint}</span></label>
      ${note ? html`<div class="notice" style="margin-top:6px">${note}</div>` : ""}</div>`;
    $("#an-files").innerHTML = html`<div class="card-body"><div class="an-files">
      ${box("map", mapName, notes.map, t("an.map.drop"), t("an.map.hint"))}
      ${box("gpx", traceName, notes.gpx, t("an.gpx.drop"), t("an.gpx.hint"))}</div>
      <p class="muted" style="font-size:13px;margin:10px 0 0">${t("an.private")}</p></div>`;
    for (const id of ["map", "gpx"]) {
      $(`#an-in-${id}`).addEventListener("change", (e) => take([...e.target.files]));
      const drop = $(`#an-drop-${id}`);
      drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("over"));
      drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take([...e.dataTransfer.files]); });
    }
  }
  async function take(list) {
    for (const f of list) {
      if (isTrace(f)) {
        try { track = parseTrack(await f.text()); traceName = f.name; notes.gpx = ""; }
        catch (e) { track = null; traceName = ""; notes.gpx = t(e.message === "time" ? "an.err.time" : "an.err.gpx"); }
      } else if (isMap(f)) {
        notes.map = t("an.reading");
        files();
        try { map = await readMap(f); mapName = f.name; notes.map = ""; }
        catch (e) { map = null; mapName = ""; notes.map = t(e.message === "pdf" ? "an.err.pdf" : "an.err.map"); }
      } else notes[isTrace(f) ? "gpx" : "map"] = t("an.err.type");
    }
    if (track && race?.date_iso) {
      const day = parisDay(track.ms0);
      if (day !== race.date_iso) notes.gpx = t("an.date.diff", { d1: fmtDate(day), d2: fmtDate(race.date_iso) });
    }
    files();
    setup();
  }

  // ---- 3. the targets (start, the controls, the finish) and the calibration
  function setup() {
    stop();
    const k = klass(), r = runner();
    targets = [];
    if (r) {
      const codes = k.controls || [];
      const n = Math.max(codes.length, r.splits?.length || 0);
      targets.push({ i: 0, label: t("an.start"), tau: 0 });
      for (let i = 0; i < n; i++) targets.push({ i: i + 1, label: `${i + 1}`, code: codes[i] || "", tau: r.splits?.[i] ?? null });
      targets.push({ i: n + 1, label: t("an.finish"), tau: r.status === "ok" && r.time_s != null ? r.time_s : null });
    }
    clicks = restoreClicks();
    cur = nextTarget(0);
    fit = null; calibrated = false; tNow = 0;
    vLo = 0; vHi = 1;                                   // the pace colours follow this trace
    hideResults();
    steps(stage());
    const work = $("#an-work");
    work.hidden = !(map && track && r);
    if (work.hidden) return;
    size();
    fitView();
    refit();
    if (fit && Object.keys(clicks).length >= 3) finish(); else side();
    draw();
  }
  // the playback's legs table and pace strip belong to one calibration: gone until the next one is done
  const hideResults = () => { $("#an-legs").hidden = true; $("#an-strip-card").hidden = true; $("#an-hud").textContent = ""; };
  const calKey = () => `${CAL_KEY}.${key}.${di}.${ci}.${runner()?.name}.${map?.width}x${map?.height}`;
  function restoreClicks() { try { return JSON.parse(localStorage.getItem(calKey()) || "{}"); } catch (e) { return {}; } }
  function saveClicks() { try { localStorage.setItem(calKey(), JSON.stringify(clicks)); } catch (e) { /* not kept */ } }
  const nextTarget = (from) => { for (let i = from; i < targets.length; i++) if (!clicks[i]) return i; return -1; };
  /** The offset the results' start time gives: the trace's time at the race start (seconds), if the start is known. */
  function guessOffset() {
    const r = runner();
    if (r?.start_s == null || !race?.date_iso) return null;
    const startMs = Date.parse(`${race.date_iso}T00:00:00Z`) - parisOffsetMs(race.date_iso) + r.start_s * 1000;
    return (startMs - track.ms0) / 1000;
  }
  function refit() {
    const pairs = targets.filter((g) => g.tau != null && clicks[g.i]).map((g) => ({ tau: g.tau, px: clicks[g.i][0], py: clicks[g.i][1] }));
    fit = pairs.length >= 2 ? calibrate(track, pairs, guessOffset()) : null;
    if (!fit) { pxs = pys = fullPath = null; return; }
    pxs = new Float64Array(track.n); pys = new Float64Array(track.n);
    fullPath = new Path2D();
    for (let i = 0; i < track.n; i++) {
      const [px, py] = toPx(fit, track.x[i], track.y[i]);
      pxs[i] = px; pys[i] = py;
      if (i) fullPath.lineTo(px, py); else fullPath.moveTo(px, py);
    }
    computeLegs();
  }
  /** The race in legs: times and ranks from the class's splits, lengths from the trace. */
  function computeLegs() {
    const k = klass(), r = runner();
    const timed = targets.filter((g) => g.tau != null);
    total = timed.length ? timed[timed.length - 1].tau : Math.max(0, track.dur - (fit?.offset || 0));
    // the class's legs (the split-times page's rule for the time lost)
    const n = targets.length - 1;
    const cumOf = (x) => Array.from({ length: n }, (_, i) => (i < n - 1 ? x.splits?.[i] ?? null : x.status === "ok" ? x.time_s : null));
    const legsOf = (x) => { const c = cumOf(x); return c.map((v, i) => (v != null && (i === 0 || c[i - 1] != null) ? v - (i ? c[i - 1] : 0) : null)); };
    const all = k.runners.filter((x) => x.splits).map(legsOf);
    const best = Array.from({ length: n }, (_, i) => { const v = all.map((l) => l[i]).filter((x) => x != null && x > 0); return v.length ? Math.min(...v) : null; });
    const mine = legsOf(r);
    const ratios = mine.map((v, i) => (v != null && best[i] ? v / best[i] : null)).filter((x) => x != null).sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)] : null;
    legs = [];
    for (let i = 0; i < n; i++) {
      const from = targets[i], to = targets[i + 1];
      const t0 = from.tau, t1 = to.tau;
      const leg = { n: i + 1, code: to.code || "", label: to.label, t0, t1, time: mine[i], best: best[i], rank: null, lost: null, mistake: false, dist: null, straight: null, v: null };
      if (leg.time != null) leg.rank = 1 + all.filter((l) => l[i] != null && l[i] < leg.time).length;
      if (leg.time != null && best[i] && med) { leg.lost = leg.time - best[i] * med; leg.mistake = leg.lost >= ERR.s && leg.lost >= (ERR.pct / 100) * leg.time; }
      if (fit && t0 != null && t1 != null) {
        leg.dist = cumAt(track, fit.offset + t1) - cumAt(track, fit.offset + t0);
        const a = clicks[from.i] ? toM(fit, ...clicks[from.i]) : posAt(track, fit.offset + t0);
        const b = clicks[to.i] ? toM(fit, ...clicks[to.i]) : posAt(track, fit.offset + t1);
        leg.straight = Math.hypot(a[0] - b[0], a[1] - b[1]);
        leg.v = leg.time > 0 ? leg.dist / leg.time : null;
      }
      legs.push(leg);
    }
  }

  function side() {
    steps(stage());
    const pairs = targets.filter((g) => g.tau != null && clicks[g.i]).length, need = Math.max(0, (guessOffset() != null ? 2 : 3) - pairs);
    const r = runner();
    $("#an-side").innerHTML = html`<div class="an-side-title">${t("an.cal.title")}</div>
      <p class="hint">${t("an.cal.help")}</p>
      ${r?.splits ? "" : html`<div class="notice" style="margin-bottom:8px">${t("an.cal.noSplits")}</div>`}
      <div class="an-targets">${targets.map((g) => html`<button type="button" class="an-target${g.i === cur ? " now" : ""}${clicks[g.i] ? " done" : ""}" data-target="${g.i}">
        <b>${g.label}</b>${g.code ? html`<span class="muted">${g.code}</span>` : ""}<span class="num">${g.tau != null ? clock(g.tau) : "—"}</span><span class="an-mark">${clicks[g.i] ? "✓" : g.i === cur ? "▶" : ""}</span></button>`)}</div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="btn btn-sm" id="an-skip">${t("an.cal.skip")}</button>
        <button type="button" class="btn btn-sm" id="an-undo">${t("an.cal.undo")}</button>
        <button type="button" class="btn btn-sm" id="an-clear">${t("an.cal.clear")}</button></div>
      <div class="an-fitbox">${fit ? html`<div><span class="muted">${t("an.cal.fit")}</span> <b>${fmt(fit.rms / fit.scale)} m</b> <span class="muted" title="${t("an.cal.fit.hint")}">ⓘ</span></div>
          ${guessOffset() != null ? html`<div><span class="muted">${t("an.cal.offset")}</span> <b>${signed(fit.offset - guessOffset())}</b> <span class="muted" title="${t("an.cal.offset.hint")}">ⓘ</span></div>` : ""}`
        : html`<div class="muted">${t("an.cal.need", { n: need })}</div>`}</div>
      <button type="button" class="btn btn-primary" id="an-done" style="margin-top:10px" ${raw(fit ? "" : "disabled")}>${t("an.cal.done")}</button>`;
    $$("[data-target]").forEach((b) => b.addEventListener("click", () => { cur = Number(b.dataset.target); side(); draw(); }));
    $("#an-skip").addEventListener("click", () => { if (cur >= 0) cur = nextTarget(cur + 1); side(); draw(); });
    $("#an-undo").addEventListener("click", () => {
      const done = Object.keys(clicks).map(Number);
      if (done.length) { const lastI = Math.max(...done); delete clicks[lastI]; cur = lastI; saveClicks(); refit(); side(); draw(); }
    });
    $("#an-clear").addEventListener("click", () => { clicks = {}; cur = 0; saveClicks(); refit(); side(); draw(); });
    $("#an-done").addEventListener("click", finish);
  }
  function placeClick(px, py) {
    if (cur < 0) return;
    clicks[cur] = [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
    cur = nextTarget(cur + 1);
    saveClicks();
    refit();
    side();
    draw();
  }

  // ---- 4. the playback
  function finish() {
    if (!fit) return;
    calibrated = true; marks = false; tNow = 0;
    steps(4);
    $("#an-side").innerHTML = html`<div class="an-side-title">${t("an.play.title")}</div>
      <div class="an-transport">
        <button type="button" class="btn btn-sm" id="an-prev" title="${t("an.prevLeg")}">⏮</button>
        <button type="button" class="btn btn-sm btn-primary" id="an-play" title="${t("an.play")}">▶</button>
        <button type="button" class="btn btn-sm" id="an-next" title="${t("an.nextLeg")}">⏭</button>
        <select id="an-speed" aria-label="${t("an.speed")}">${SPEEDS.map((s) => html`<option value="${s}" ${raw(s === speed ? "selected" : "")}>× ${s}</option>`)}</select></div>
      <input type="range" id="an-time" min="0" max="${Math.ceil(total)}" step="0.5" value="0" style="width:100%;margin:8px 0">
      <div class="tiles tiles-compact an-tiles">
        <div class="tile"><div class="tile-label">${t("an.time")}</div><div class="tile-value" id="an-t">0:00</div><div class="tile-sub" id="an-t-sub"></div></div>
        <div class="tile"><div class="tile-label">${t("an.leg")}</div><div class="tile-value" id="an-leg">—</div><div class="tile-sub" id="an-leg-sub"></div></div>
        <div class="tile"><div class="tile-label">${t("an.pace")}</div><div class="tile-value" id="an-pace">—</div><div class="tile-sub">${t("an.pace.hint")}</div></div>
        <div class="tile"><div class="tile-label">${t("an.dist")}</div><div class="tile-value" id="an-dist">0 m</div><div class="tile-sub" id="an-dist-sub"></div></div></div>
      <div class="an-opts">
        <label><input type="checkbox" id="an-follow" ${raw(follow ? "checked" : "")}> ${t("an.follow")}</label>
        <label><input type="checkbox" id="an-marks" ${raw(marks ? "checked" : "")}> ${t("an.marks")}</label>
        <label><span>${t("an.colour")}</span><select id="an-colour"><option value="plain" ${raw(colour === "plain" ? "selected" : "")}>${t("an.colour.plain")}</option><option value="speed" ${raw(colour === "speed" ? "selected" : "")}>${t("an.colour.speed")}</option></select></label>
        <label><span>${t("an.tail")}</span><select id="an-tail">${TAILS.map((s) => html`<option value="${s}" ${raw(s === tail ? "selected" : "")}>${s ? clock(s) : t("an.tail.all")}</option>`)}</select></label></div>
      <div class="an-fitbox"><div><span class="muted">${t("an.cal.fit")}</span> <b>${fmt(fit.rms / fit.scale)} m</b></div></div>
      <button type="button" class="btn btn-sm" id="an-again" style="margin-top:8px">${t("an.cal.again")}</button>`;
    $("#an-play").addEventListener("click", () => (playing ? stop() : play()));
    $("#an-prev").addEventListener("click", () => jumpLeg(-1));
    $("#an-next").addEventListener("click", () => jumpLeg(1));
    $("#an-speed").addEventListener("change", (e) => { speed = Number(e.target.value); });
    const slider = $("#an-time");
    slider.addEventListener("input", (e) => { seek(Number(e.target.value)); });
    slider.addEventListener("pointerdown", () => { scrubbing = true; });
    slider.addEventListener("pointerup", () => { scrubbing = false; });
    $("#an-follow").addEventListener("change", (e) => { follow = e.target.checked; draw(); });
    $("#an-marks").addEventListener("change", (e) => { marks = e.target.checked; draw(); });
    $("#an-colour").addEventListener("change", (e) => { colour = e.target.value; draw(); });
    $("#an-tail").addEventListener("change", (e) => { tail = Number(e.target.value); draw(); });
    $("#an-again").addEventListener("click", () => { stop(); calibrated = false; marks = true; cur = nextTarget(0); if (cur < 0) cur = targets.length - 1; hideResults(); side(); draw(); });
    $("#an-strip-card").hidden = false;
    legsTable();
    sizeStrip();
    seek(0);
  }
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
  function play() {
    if (tNow >= total - 0.01) tNow = 0;
    playing = true; last = performance.now();
    $("#an-play").textContent = "⏸";
    const step = (now) => {
      if (!playing) return;
      if (!main.isConnected) { stop(); return; }
      tNow = Math.min(total, tNow + ((now - last) / 1000) * speed);
      last = now;
      hud(); draw(); drawStrip();
      if (tNow >= total) { stop(); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    const b = $("#an-play"); if (b) b.textContent = "▶";
  }
  function hud() {
    if (!calibrated) return;
    const s = fit.offset + tNow, j = legAt(tNow), leg = legs[j];
    const slider = $("#an-time"); if (slider && !scrubbing) slider.value = String(tNow);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set("#an-t", clock(tNow)); set("#an-t-sub", total ? `${t("an.of")} ${clock(total)}` : "");
    set("#an-leg", leg ? `${leg.n}${leg.code ? ` (${leg.code})` : ""}` : "—");
    set("#an-leg-sub", leg ? `${leg.time != null ? clock(leg.time) : ""}${leg.dist != null ? ` · ${fmt(leg.dist)} m` : ""}${leg.rank ? ` · ${t("an.rankShort")} ${leg.rank}` : ""}` : "");
    const win = Math.min(30, tNow);
    set("#an-pace", win >= 5 ? pace((cumAt(track, s) - cumAt(track, s - win)) / win) : "—");
    const d = cumAt(track, s) - cumAt(track, fit.offset);
    set("#an-dist", `${fmt(d >= 1000 ? d / 1000 : d, d >= 1000 ? 2 : 0)} ${d >= 1000 ? "km" : "m"}`);
    const len = klass()?.length_m;
    set("#an-dist-sub", len ? `${t("an.course.len")} ${fmt(len / 1000, 1)} km` : "");
    $("#an-hud").textContent = `${clock(tNow)}${leg ? ` · ${leg.n}` : ""}`;
  }
  function legsTable() {
    const k = klass();
    const sum = legs.reduce((a, l) => ({ dist: a.dist + (l.dist || 0), straight: a.straight + (l.straight || 0), lost: a.lost + (l.mistake ? l.lost : 0), n: a.n + (l.mistake ? 1 : 0) }), { dist: 0, straight: 0, lost: 0, n: 0 });
    $("#an-legs").hidden = false;
    $("#an-legs").innerHTML = html`<div class="card-head"><div><h2>${t("an.legs")}</h2><div class="hint">${t("an.legs.hint")}</div></div></div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("an.col.leg")}</th><th class="r">${t("an.col.time")}</th><th class="r">${t("an.col.best")}</th>
        <th class="r">${t("an.col.rank")}</th><th class="r">${t("an.col.lost")}</th><th class="r">${t("an.col.trace")}</th><th class="r">${t("an.col.straight")}</th><th class="r">${t("an.col.detour")}</th><th class="r">${t("an.col.pace")}</th></tr></thead>
      <tbody>${legs.map((l, i) => html`<tr data-leg="${i}" class="${l.mistake ? "an-mistake" : ""}" style="cursor:pointer">
        <td>${l.label}${l.code ? html` <span class="muted">${l.code}</span>` : ""}</td>
        <td class="r num">${l.time != null ? clock(l.time) : "—"}</td><td class="r num">${l.best != null ? clock(l.best) : "—"}</td>
        <td class="r num">${l.rank ?? "—"}</td><td class="r num${l.mistake ? " an-lost" : ""}">${l.lost != null ? signed(Math.round(l.lost)) : "—"}</td>
        <td class="r num">${l.dist != null ? `${fmt(l.dist)} m` : "—"}</td><td class="r num">${l.straight != null ? `${fmt(l.straight)} m` : "—"}</td>
        <td class="r num">${l.dist != null && l.straight ? `+${fmt((100 * l.dist) / l.straight - 100)} %` : "—"}</td>
        <td class="r num">${l.v != null ? pace(l.v) : "—"}</td></tr>`)}
      <tr class="an-total"><td>${t("an.total")}</td><td class="r num">${runner().status === "ok" ? clock(runner().time_s) : "—"}</td><td></td><td class="r num">${runner().place ?? "—"}</td>
        <td class="r num">${sum.n ? `${signed(Math.round(sum.lost))} (${sum.n})` : "—"}</td><td class="r num">${fmt(sum.dist)} m</td>
        <td class="r num">${sum.straight ? `${fmt(sum.straight)} m` : "—"}${k.length_m ? html`<div class="muted" style="font-size:11.5px">${t("an.course.len")} ${fmt(k.length_m)} m</div>` : ""}</td>
        <td class="r num">${sum.straight ? `+${fmt((100 * sum.dist) / sum.straight - 100)} %` : "—"}</td>
        <td class="r num">${total && sum.dist ? pace(sum.dist / total) : "—"}</td></tr></tbody></table></div>`;
    $$("#an-legs tr[data-leg]").forEach((tr) => tr.addEventListener("click", () => {
      const l = legs[Number(tr.dataset.leg)];
      if (l.t0 == null) return;
      stop();
      zoomTo(l);
      seek(l.t0);
    }));
  }
  /** The view on one leg: its trace, with a margin. */
  function zoomTo(l) {
    if (!fit || l.t1 == null) return;
    const a = indexAt(track, fit.offset + l.t0), b = indexAt(track, fit.offset + l.t1);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = a; i <= b; i++) { x0 = Math.min(x0, pxs[i]); y0 = Math.min(y0, pys[i]); x1 = Math.max(x1, pxs[i]); y1 = Math.max(y1, pys[i]); }
    const { w, h } = box();
    const k = Math.min(w / Math.max(40, x1 - x0 + 80), h / Math.max(40, y1 - y0 + 80), 8);
    view = { k, ox: w / 2 - ((x0 + x1) / 2) * k, oy: h / 2 - ((y0 + y1) / 2) * k };
    follow = false; const f = $("#an-follow"); if (f) f.checked = false;
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
      if (drag.moved) { view = { ...view, ox: drag.ox + dx, oy: drag.oy + dy }; if (follow && playing) { follow = false; const f = $("#an-follow"); if (f) f.checked = false; } draw(); }
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
  $("#an-fit").addEventListener("click", () => { if (map) { fitView(); draw(); } });
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
      const [px, py] = toPx(fit, ...posAt(track, fit.offset + tNow));
      view = { ...view, ox: w / 2 - px * view.k, oy: h / 2 - py * view.k };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e9e6dc"; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.ox, dpr * view.oy);
    ctx.imageSmoothingEnabled = view.k < 1;
    ctx.drawImage(map, 0, 0);
    const lw = (px) => px / view.k;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (fit && fullPath) {
      const s = fit.offset + (calibrated ? tNow : total), iNow = indexAt(track, s), i0 = Math.max(0, indexAt(track, fit.offset));
      // the whole trace, faint; the part run so far, full; the tail, thicker
      ctx.globalAlpha = calibrated ? 0.28 : 0.85; ctx.strokeStyle = TRACE; ctx.lineWidth = lw(2.5); ctx.stroke(fullPath);
      ctx.globalAlpha = 1;
      if (calibrated) {
        const iTail = tail ? Math.max(i0, indexAt(track, s - tail)) : i0;
        if (colour === "speed") {
          if (!vHi || vHi === 1) paceScale();
          for (let i = i0 + 1; i <= iNow; i++) {
            ctx.strokeStyle = paceColour(track.v[i]); ctx.lineWidth = lw(i > iTail ? 5 : 3);
            ctx.beginPath(); ctx.moveTo(pxs[i - 1], pys[i - 1]); ctx.lineTo(pxs[i], pys[i]); ctx.stroke();
          }
        } else {
          const part = (from, to, width) => { if (to <= from) return; ctx.lineWidth = lw(width); ctx.beginPath(); ctx.moveTo(pxs[from], pys[from]);
            for (let i = from + 1; i <= to; i++) ctx.lineTo(pxs[i], pys[i]); ctx.stroke(); };
          ctx.strokeStyle = TRACE;
          part(i0, Math.min(iNow, iTail), 3);
          part(iTail, iNow, 5);
        }
        // the runner
        const [px, py] = toPx(fit, ...posAt(track, s));
        ctx.beginPath(); ctx.arc(px, py, lw(9), 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, lw(6.5), 0, Math.PI * 2); ctx.fillStyle = "#e8641c"; ctx.fill();
      }
    }
    // the controls clicked: a ring and the number
    if (marks || !calibrated) {
      ctx.font = `${lw(13)}px system-ui, sans-serif`; ctx.textBaseline = "middle";
      for (const g of targets) {
        const c = clicks[g.i];
        if (!c) continue;
        const now = g.i === cur && !calibrated;
        ctx.beginPath(); ctx.arc(c[0], c[1], lw(now ? 11 : 9), 0, Math.PI * 2);
        ctx.strokeStyle = now ? "#e8641c" : "#a626a4"; ctx.lineWidth = lw(now ? 3 : 2); ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = lw(3); ctx.strokeText(g.label, c[0] + lw(13), c[1]);
        ctx.fillStyle = "#a626a4"; ctx.fillText(g.label, c[0] + lw(13), c[1]);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---- the pace along the race
  function sizeStrip() {
    const dpr = window.devicePixelRatio || 1;
    strip.width = Math.round(strip.clientWidth * dpr); strip.height = Math.round(strip.clientHeight * dpr);
  }
  function drawStrip() {
    if (!calibrated || !total) return;
    const dpr = window.devicePixelRatio || 1, w = strip.clientWidth, h = strip.clientHeight;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-3").trim() || "#888";
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, h);
    if (!vHi || vHi === 1) paceScale();
    const X = (s) => (s / total) * w, top = 14, bottom = h - 4;
    // the mistakes' legs, washed
    for (const l of legs) if (l.mistake && l.t1 != null) { sctx.fillStyle = "rgba(198,40,40,0.12)"; sctx.fillRect(X(l.t0), top, X(l.t1) - X(l.t0), bottom - top); }
    // the pace, as an area (fast up)
    const step = Math.max(1, Math.floor(total / w));
    sctx.beginPath(); sctx.moveTo(0, bottom);
    for (let s = 0; s <= total; s += step) {
      const v = speedAt(track, fit.offset + s), y = bottom - ((Math.max(vLo * 0.7, Math.min(vHi * 1.15, v)) - vLo * 0.7) / (vHi * 1.15 - vLo * 0.7 || 1)) * (bottom - top);
      sctx.lineTo(X(s), y);
    }
    sctx.lineTo(w, bottom); sctx.closePath();
    sctx.fillStyle = "rgba(200,16,46,0.25)"; sctx.fill();
    // the controls
    sctx.font = "10px system-ui, sans-serif"; sctx.textAlign = "center"; sctx.fillStyle = ink; sctx.strokeStyle = ink; sctx.lineWidth = 1;
    for (const g of targets) if (g.tau != null && g.i) { const x = X(g.tau); sctx.beginPath(); sctx.moveTo(x, top); sctx.lineTo(x, bottom); sctx.globalAlpha = 0.5; sctx.stroke(); sctx.globalAlpha = 1; sctx.fillText(g.label, x, 7); }
    // now
    sctx.strokeStyle = "#e8641c"; sctx.lineWidth = 2; sctx.beginPath(); sctx.moveTo(X(tNow), 0); sctx.lineTo(X(tNow), h); sctx.stroke();
  }
  const scrub = (e) => { if (!calibrated) return; const x = e.offsetX, w = strip.clientWidth; stop(); seek((x / w) * total); };
  strip.addEventListener("pointerdown", (e) => { scrub(e); strip.setPointerCapture(e.pointerId); strip.dataset.down = "1"; });
  strip.addEventListener("pointermove", (e) => { if (strip.dataset.down) scrub(e); });
  const stripUp = () => { delete strip.dataset.down; };
  strip.addEventListener("pointerup", stripUp); strip.addEventListener("pointercancel", stripUp);

  // ---- go
  steps(1);
  await loadRace();
  pickers();
  files();
  setup();
  return { title: t("an.title"), cleanup: () => { stop(); ro.disconnect(); if (map?.close) map.close(); } };
}
