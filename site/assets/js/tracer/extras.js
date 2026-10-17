// The Tracer's further tools: a new map for the event, punch patterns, custom symbol texts, the map's georeference,
// other courses shown faintly, a course read from the map (a PDF or photo with a printed course), and the differences
// between two versions. The tools that use the race's data or other services (climb from IGN, winning times, pick-up plan,
// review after the race, competitor loads from the registrations, publication to « Analyse multi ») are in race.js; the
// team's comments and the field mode in team.js.

import * as M from "./model.js";
import * as S from "./store.js";
import * as G from "./geo.js";
import { openMap, isMapFile, mimeOf, imageDpi, isPdf, MAP_ACCEPT } from "./mapsrc.js";
import { modal, field, sel, num, dropHtml, dropZone } from "./dialogs.js";
import { symbol, symbolText, symbolName, symbolsFor, loadAllTexts } from "./symbols.js";
import { ctrlName } from "./reports.js";
import { where } from "./ribbon-data.js";
import { t, tn, lang as uiLang, locale } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

// ---- the other modules, loaded when asked for ------------------------------------------------------------------------------
const race = () => import("./race.js"), team = () => import("./team.js");
export const climb = async (E) => (await race()).climb(E);
export const winningTimes = async (E) => (await race()).winningTimes(E);
export const pickup = async (E) => (await race()).pickup(E);
export const afterRace = async (E) => (await race()).afterRace(E);
export const publish = async (E) => (await race()).publish(E);
export const sendCourses = async (E) => (await race()).sendCourses(E);
export const registrationLoads = async (E) => (await race()).registrationLoads(E);
export const comments = async (E) => (await team()).comments(E);
export const fieldMode = async (E) => (await team()).fieldMode(E);

// ---- a new map -------------------------------------------------------------------------------------------------------------
/** Replace the event's map (a corrected version, a better scan, the PDF instead of an image, the OCAD file itself): the controls
 *  keep their place on the sheet, their map coordinates (a new version of the same OCAD or Mapper file), or their place on the
 *  ground, or follow a change of size when the new map covers the same ground. */
export async function changeMap(E, preset = null) {
  const ev = E.ev, hadGeo = G.hasGeo(ev);
  let src = null, bytes = null, type = "", name = "", geoFiles = [];
  const v = await modal(E, { title: t("trc.ext.cmTitle"), wide: true, ok: t("trc.ext.cmOk"), body: `
    <p>${t("trc.ext.cmIntro")}</p>
    ${dropHtml("tr-cm-drop", t("trc.ext.cmDrop"), MAP_ACCEPT, false)}
    <p class="tr-hint" id="tr-cm-info">${t("trc.ext.cmNone")}</p>
    <div class="tr-grid2">${field(t("trc.ext.scale"), `<input name="scale" value="${ev.map.scale}" inputmode="numeric">`)}
    ${field(t("trc.ext.dpi"), `<input name="dpi" value="${ev.map.dpi || ""}" inputmode="numeric">`, t("trc.ext.dpiHint"))}</div>
    ${field(t("trc.ext.cmGeo"), '<input type="file" name="geo" multiple accept=".jgw,.pgw,.tfw,.gfw,.wld,.prj,.kml,.kmz,.jpgw,.pngw">')}
    <h3>${t("trc.ext.cmControls")}</h3>
    <label class="tr-check" id="tr-cm-file" ${ev.map.kind === "ocad" ? "" : "hidden"}><input type="radio" name="fit" value="file"> ${t("trc.ext.cmFitFile")}</label>
    <label class="tr-check"><input type="radio" name="fit" value="keep" checked> ${t("trc.ext.cmFitKeep")}</label>
    <label class="tr-check"><input type="radio" name="fit" value="scale"> ${t("trc.ext.cmFitScale")}</label>
    <label class="tr-check"><input type="radio" name="fit" value="ground" ${hadGeo ? "" : "disabled"}> ${t(hadGeo ? "trc.ext.cmFitGround" : "trc.ext.cmFitGroundNo")}</label>
    <label class="tr-check"><input type="radio" name="fit" value="calage"> ${t("trc.ext.cmFitCalage")}</label>`,
  onOpen: (f) => {
    const info = f.querySelector("#tr-cm-info");
    const take = async (list) => {
      const file = list.find(isMapFile);
      if (!file) { info.textContent = t("trc.ext.notMap"); return; }
      bytes = new Uint8Array(await file.arrayBuffer()); type = mimeOf(file.name, file.type); name = file.name;
      if (!isPdf(name, type)) { const d = imageDpi(bytes); if (d) f.elements.dpi.value = d; }
      let err = null;
      info.textContent = t("trc.ext.reading", { name });
      src = await openMap(bytes, type, name, Number(f.elements.dpi.value) || 0).catch((e) => { err = e; return null; });
      if (src?.kind === "vector") {
        f.elements.scale.value = String(src.scale);
        src.geoInfo = await (await import("./vmap/georef.js")).geoFromVector(src.vmap, src).catch(() => null);
      }
      const vfmt = src?.format === "oom" ? "OpenOrienteering Mapper" : `OCAD ${src?.version}`;
      info.textContent = !src ? (err?.message && err.message !== "map" ? t("trc.ext.openFailWhy", { why: err.message }) : t("trc.ext.openFail")) : src.kind === "pdf"
        ? t("trc.ext.readPdf", { name, w: nf(src.w), h: nf(src.h), cw: nf(ev.map.w), ch: nf(ev.map.h) })
        : src.kind === "vector" ? (src.geoInfo ? t("trc.ext.readVectorGeo", { name, format: vfmt, scale: nf(src.scale), w: nf(src.w), h: nf(src.h), crs: src.geoInfo.name })
          : t("trc.ext.readVector", { name, format: vfmt, scale: nf(src.scale), w: nf(src.w), h: nf(src.h) }))
        : t(src.world ? "trc.ext.readImageGeo" : "trc.ext.readImage", { name, w: src.pxW, h: src.pxH });
      const both = src?.kind === "vector" && ev.map.kind === "ocad";
      f.querySelector("#tr-cm-file").hidden = !both;
      if (both) f.querySelector('input[value="file"]').checked = true;
      else if ((src?.world || src?.geoInfo) && hadGeo) f.querySelector('input[value="ground"]').checked = true;
      else if (f.elements.fit.value === "file") f.querySelector('input[value="keep"]').checked = true;
    };
    dropZone(f.querySelector("#tr-cm-drop"), take);
    f.elements.geo.addEventListener("change", () => { geoFiles = [...f.elements.geo.files]; });
    if (preset) take([preset]);
  },
  validate: (o) => (!src ? t("trc.ext.vMap") : !(num(o.scale) > 100) ? t("trc.ext.vScale") : src.kind === "bitmap" && !(num(o.dpi) > 10) ? t("trc.ext.vDpi")
    : o.fit === "ground" && !src.world && !src.geoInfo && !geoFiles.length ? t("trc.ext.vGround") : null) });
  if (!v || !src) return;
  const vector = src.kind === "vector", kind = vector ? "ocad" : src.kind;
  const dpi = src.kind === "bitmap" ? num(v.dpi) : 0;
  const w = src.kind === "bitmap" ? (src.pxW * 25.4) / dpi : src.w, h = src.kind === "bitmap" ? (src.pxH * 25.4) / dpi : src.h;
  // the new map's georeference: its GeoTIFF, an OCAD or Mapper file's own, or the files given
  const shape = { map: { ...ev.map, kind, w, h } };
  let newGeo = null;
  try {
    if (geoFiles.length) newGeo = (await geoFromFiles({ ev: shape, map: src }, geoFiles)).geo;
    else if (src.geoInfo) newGeo = src.geoInfo.geo;
    else if (src.world) newGeo = G.geoFromWorld(shape, src.world.wf, null, src.pxW, src.pxH, src.world.crs);
  } catch (err) { E.toast(err.message || t("trc.ext.geoUnreadable")); return; }
  E.status(t("trc.ext.sendingMap"), "busy");
  try {
    await S.saveMap(E.meta.id, bytes, type, E.key);
    const r = await S.api(`/${E.meta.id}`, { method: "PUT", body: { map: { name, type, size: bytes.length } } });
    E.meta = r.event;
  } catch (err) { E.status(t("trc.ext.sendFailed"), "err"); E.toast(t("trc.ext.mapNotSent")); return; }
  if (src.kind === "bitmap") src.dpi = dpi;
  E.map = src;
  E.change((x) => {
    const old = { ...x };
    if (v.fit === "file" && vector && x.map.kind === "ocad") {
      // the same map file's coordinates: the Tracer's frame moves from the old origin to the new one
      const [ox, oy] = M.fileOffset(x);
      M.transformAll(x, [1, 0, 0, 1, ox - src.ox, oy - src.oy]);
      if (x.geo && !newGeo) { const g = x.geo, dx = ox - src.ox, dy = oy - src.oy; x.geo = { ...g, c: g.c + dx, f: g.f + dy }; }
    } else if (v.fit === "scale") {
      const k = w / x.map.w, ky = h / x.map.h;
      M.transformAll(x, [k, 0, 0, ky, 0, 0]);
      if (x.geo) { const g = x.geo; x.geo = { a: g.a * k, b: g.b * k, c: g.c * k, d: g.d * ky, e: g.e * ky, f: g.f * ky }; }
    } else if (v.fit === "ground" && old.geo && newGeo) {
      // each point: old map mm -> (lat, lon) -> new map mm; the composition of two affines is an affine, found on three points
      const pts = [[0, 0], [x.map.w, 0], [0, x.map.h]].map((p) => { const [lat, lon] = G.toLatLon(old, p[0], p[1]); return [p, G.toMm({ geo: newGeo }, lat, lon)]; });
      const [[p0, q0], [p1, q1], [p2, q2]] = pts;
      const a = (q1[0] - q0[0]) / (p1[0] - p0[0]), c = (q1[1] - q0[1]) / (p1[0] - p0[0]);
      const b = (q2[0] - q0[0]) / (p2[1] - p0[1]), d = (q2[1] - q0[1]) / (p2[1] - p0[1]);
      M.transformAll(x, [a, b, c, d, q0[0] - a * p0[0] - b * p0[1], q0[1] - c * p0[0] - d * p0[1]]);
    }
    x.map = { ...x.map, kind, file: name, scale: num(v.scale), dpi, w, h };
    if (vector) Object.assign(x.map, { ox: src.ox, oy: src.oy }); else { delete x.map.ox; delete x.map.oy; }
    if (newGeo) x.geo = newGeo;
    else if (v.fit === "calage") delete x.geo;                  // the old calibration no longer fits once the course moves
  }, t("trc.ext.undoMap"));
  E.fitCourse();
  if (v.fit === "calage") { E.toast(hadGeo && !newGeo ? t("trc.ext.mapChangedGeoOff", { where: where("georef") }) : t("trc.ext.mapChanged"), 6000); (await import("./calage.js")).calage(E, { fromPpen: false }); }
  else E.toast(newGeo ? t("trc.ext.mapChangedGeo") : t("trc.ext.mapChanged"));
}

// ---- punch patterns ------------------------------------------------------------------------------------------------------------
/** Each control's punch pattern, clicked on a grid (Purple Pen's punch patterns, for the paper cards' check). */
export async function punchPatterns(E) {
  const ev = E.ev;
  const ids = Object.keys(ev.controls).map(Number).filter((id) => ev.controls[id].kind === "normal").sort((a, b) => M.compareControls(ev, a, b));
  const pats = new Map(ids.map((id) => { const p = ev.controls[id].punch; const n = p?.size || 3; return [id, { n, dots: (p?.dots || "").padEnd(n * n, "0").slice(0, n * n) }]; }));
  const grid = (id) => { const p = pats.get(id); return `<span class="tr-punch" style="--n:${p.n}">${[...p.dots].map((d, i) => `<button type="button" data-c="${id}" data-i="${i}" class="${d === "1" ? "on" : ""}" aria-label="${esc(t("trc.ext.punchCell", { n: i + 1 }))}"></button>`).join("")}</span>`; };
  const v = await modal(E, { title: t("trc.ext.punchTitle"), wide: true, body: `
    <p>${t("trc.ext.punchIntro")}</p>
    <div class="tr-punches">${ids.map((id) => `<div class="tr-punch-row"><b>${esc(ev.controls[id].code)}</b> ${grid(id)}
      <select data-size="${id}" aria-label="${esc(t("trc.ext.punchSize"))}">${[3, 4, 5, 6, 7].map((n) => `<option ${n === pats.get(id).n ? "selected" : ""}>${n}</option>`).join("")}</select></div>`).join("")}</div>
    <p class="tr-hint">${t("trc.ext.punchHint", { where: where("pdf-punch"), rows: ev.punchCard.rows, cols: ev.punchCard.cols })}</p>
    <div class="tr-grid2">${field(t("trc.ext.punchRows"), `<input name="rows" value="${ev.punchCard.rows}" inputmode="numeric">`)}${field(t("trc.ext.punchCols"), `<input name="cols" value="${ev.punchCard.cols}" inputmode="numeric">`)}</div>
    <label class="tr-check"><input type="checkbox" name="ltr" ${ev.punchCard.ltr ? "checked" : ""}> ${t("trc.ext.punchLtr")}</label>
    <label class="tr-check"><input type="checkbox" name="ttb" ${ev.punchCard.ttb ? "checked" : ""}> ${t("trc.ext.punchTtb")}</label>`,
  onOpen: (f) => {
    f.addEventListener("click", (e) => {
      const b = e.target.closest("[data-c]"); if (!b) return;
      const id = Number(b.dataset.c), i = Number(b.dataset.i), p = pats.get(id);
      p.dots = p.dots.slice(0, i) + (p.dots[i] === "1" ? "0" : "1") + p.dots.slice(i + 1);
      b.classList.toggle("on", p.dots[i] === "1");
    });
    f.querySelectorAll("[data-size]").forEach((s) => s.addEventListener("change", () => {
      const id = Number(s.dataset.size), n = Number(s.value);
      pats.set(id, { n, dots: "0".repeat(n * n) });
      s.previousElementSibling.outerHTML = grid(id);
    }));
  } });
  if (!v) return;
  E.change((x) => {
    for (const [id, p] of pats) { if (/1/.test(p.dots)) x.controls[id].punch = { size: p.n, dots: p.dots }; else delete x.controls[id].punch; }
    x.punchCard = { rows: Math.max(1, Math.round(num(v.rows)) || 3), cols: Math.max(1, Math.round(num(v.cols)) || 8), ltr: v.ltr, ttb: v.ttb };
  }, t("trc.ext.punchTitle"));
}

// ---- custom symbol texts ---------------------------------------------------------------------------------------------------------
/** A symbol's text in the event's language, singular and plural, and whether the symbol sheet's key lists it (Purple Pen's
 *  « Customize description text »). */
export async function customSymbolText(E) {
  const ev = E.ev, lang = ev.lang || "fr", std = ev.descStandard;
  if (!["fr", "en"].includes(lang)) await loadAllTexts();
  const kinds = ["C", "D", "E", "F", "G", "H"];
  const all = kinds.flatMap((k) => symbolsFor(k, std)).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i);
  const opt = (s) => `<option value="${esc(s.id)}">${esc(s.id)} — ${esc(symbolName(s, uiLang()))}${ev.customText?.[s.id] ? " ✎" : ""}</option>`;
  const v = await modal(E, { title: t("trc.ext.ctTitle"), wide: true, body: `
    <p>${t("trc.ext.ctIntro", { lang: esc(lang) })}</p>
    ${field(t("trc.ext.ctSymbol"), `<select name="id">${all.map(opt).join("")}</select>`)}
    <div class="tr-grid2">${field(t("trc.ext.ctT1"), '<input name="t1">')}${field(t("trc.ext.ctT2"), '<input name="t2">', t("trc.ext.ctT2Hint"))}</div>
    <label class="tr-check"><input type="checkbox" name="key"> ${t("trc.ext.ctKey")}</label>
    <p class="tr-hint" id="tr-ct-def"></p>`,
  ok: t("trc.ext.save"),
  onOpen: (f) => {
    const load = () => {
      const s = symbol(f.elements.id.value, std), cur = ev.customText?.[s.id] || [];
      const one = cur.find((x) => x.lang === lang && !x.plural), many = cur.find((x) => x.lang === lang && x.plural);
      f.elements.t1.value = one?.text || ""; f.elements.t2.value = many?.text || "";
      f.elements.key.checked = !!ev.customKey?.[s.id];
      f.querySelector("#tr-ct-def").textContent = symbolText(s, lang, { plural: true }) && symbolText(s, lang, { plural: true }) !== symbolText(s, lang)
        ? t("trc.ext.ctStdPl", { text: symbolText(s, lang) || "—", plural: symbolText(s, lang, { plural: true }) })
        : t("trc.ext.ctStd", { text: symbolText(s, lang) || "—" });
    };
    f.elements.id.addEventListener("change", load); load();
  } });
  if (!v) return;
  E.change((x) => {
    x.customText ||= {}; x.customKey ||= {};
    const others = (x.customText[v.id] || []).filter((t) => t.lang !== lang);
    const mine = [];
    if (v.t1.trim()) mine.push({ text: v.t1.trim(), plural: false, gender: "", case: "", modCase: "", lang });
    if (v.t2.trim()) mine.push({ text: v.t2.trim(), plural: true, gender: "", case: "", modCase: "", lang });
    if (others.length || mine.length) x.customText[v.id] = [...others, ...mine]; else delete x.customText[v.id];
    if (v.key && x.customText[v.id]) x.customKey[v.id] = true; else delete x.customKey[v.id];
  }, t("trc.ext.undoSymText"));
}

// ---- the map's georeference ------------------------------------------------------------------------------------------------------
/** Points clicked on the map with their latitude and longitude, a world file (and .prj) of an image map, or a KMZ/KML of the
 *  same image: GPX, KML, the controls' positions in IOF XML, the field mode, IGN's climb and the publication use it. */
export async function georef(E, state = null) {
  const ev = E.ev;
  const st = state || { pts: (ev.georefPts || []).map((p) => ({ ...p })) };
  const has = G.hasGeo(ev);
  let check = "";
  if (has) {
    const [sx, sy] = G.groundScale(ev), measured = ((sx + sy) / 2) * 1000;
    check = t("trc.ext.geoCheck", { sx: nf(sx, 1), sy: nf(sy, 1), measured: nf(Math.round(measured / 10) * 10), scale: nf(ev.map.scale) });
    if (Math.abs(measured / ev.map.scale - 1) > 0.03) check += ` ${t("trc.ext.geoCheckOff")}`;
  }
  const resid = st.pts.length >= 3 ? (() => { const g = G.geoFromPoints(st.pts); if (!g) return null; return st.pts.map((p) => { const [x, y] = G.toMm({ geo: g }, p.lat, p.lon); return M.mmToM(ev, Math.hypot(x - p.mm[0], y - p.mm[1])); }); })() : null;
  const v = await modal(E, { title: t("trc.ext.geoTitle"), wide: true, ok: t("trc.ext.save"), body: `
    <p>${has ? esc(check) : t("trc.ext.geoNone")}</p>
    <h3>${t("trc.ext.geoPoints")}</h3>
    <p class="tr-hint">${t("trc.ext.geoHint")}</p>
    <table class="tr-table"><thead><tr><th>${t("trc.ext.thPoint")}</th><th>${t("trc.ext.thMap")}</th><th>${t("trc.ext.thLatLon")}</th><th class="r">${t("trc.ext.thResid")}</th><th></th></tr></thead><tbody>
    ${st.pts.map((p, i) => `<tr><td>${i + 1}</td><td>${nf(p.mm[0], 1)}, ${nf(p.mm[1], 1)}</td><td>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}</td><td class="r">${resid ? `${nf(resid[i], 1)} m` : ""}</td>
      <td><button type="button" class="btn btn-sm" data-rm="${i}">${t("trc.ext.remove")}</button></td></tr>`).join("") || `<tr><td colspan="5"><small>${t("trc.ext.noPoint")}</small></td></tr>`}</tbody></table>
    <p><button type="button" class="btn btn-sm" data-pick>${t("trc.ext.addPoint")}</button></p>
    <h3>${t("trc.ext.orFile")}</h3>
    ${field(t("trc.ext.geoFile"), '<input type="file" name="files" multiple accept=".jgw,.pgw,.tfw,.gfw,.wld,.prj,.kml,.kmz,.jpgw,.pngw">')}
    ${ev.map.kind === "pdf" ? `<p class="tr-hint">${t("trc.ext.geoPdfHint")}</p>` : ""}
    ${E.map?.kind === "vector" ? `<label class="tr-check"><input type="checkbox" name="fromFile" ${E.map.vmap.realWorld ? "" : "disabled"}> ${t(E.map.vmap.realWorld ? "trc.ext.geoFromFile" : "trc.ext.geoFromFileNone", { format: E.map.format === "oom" ? "Mapper" : "OCAD" })}</label>` : ""}
    ${has ? `<label class="tr-check"><input type="checkbox" name="remove"> ${t("trc.ext.geoRemove")}</label>` : ""}`,
  onOpen: (f, done) => {
    f.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { st.pts.splice(Number(b.dataset.rm), 1); done({ again: true }); }));
    f.querySelector("[data-pick]").addEventListener("click", () => done({ pick: true }));
  } });
  if (!v) return;
  if (v.again) { georef(E, st); return; }
  if (v.pick) {
    E.help(t("trc.ext.geoPickHelp"));
    E.pickOnce = async (p) => {
      const w = await modal(E, { title: t("trc.ext.geoPtTitle"), body: field(t("trc.ext.geoPtField"), '<input name="ll" required>'),
        validate: (o) => (parseLatLon(o.ll) ? null : t("trc.ext.geoPtInvalid")) });
      if (w) { const [lat, lon] = parseLatLon(w.ll); st.pts.push({ mm: p, lat, lon }); }
      georef(E, st);
    };
    return;
  }
  if (v.remove) { E.change((x) => { delete x.geo; delete x.georefPts; }, t("trc.ext.undoGeoOff")); return; }
  let geo = null, how = "";
  if (v.fromFile) {
    const r = await (await import("./vmap/georef.js")).geoFromVector(E.map.vmap, E.map).catch(() => null);
    if (!r) { E.toast(t("trc.ext.geoFileUnknown")); return; }
    geo = r.geo; how = t("trc.ext.howMapFile", { crs: r.name });
  } else if (v.files?.length) {
    try { ({ geo, how } = await geoFromFiles(E, [...v.files])); } catch (err) { E.toast(err.message || t("trc.ext.geoUnreadable")); return; }
  } else if (st.pts.length >= 2) { geo = G.geoFromPoints(st.pts); how = tn("trc.ext.howPoints", st.pts.length); }
  if (!geo) { if (st.pts.length === 1) E.toast(t("trc.ext.secondPoint")); return; }
  E.change((x) => { x.geo = geo; if (st.pts.length) x.georefPts = st.pts; else delete x.georefPts; }, t("trc.ext.undoGeo"));
  const [sx, sy] = G.groundScale(E.ev);
  E.toast(t("trc.ext.geoDone", { how, scale: nf(Math.round(((sx + sy) / 2) * 100) * 10) }), 6000);
}
function parseLatLon(s) {
  const m = String(s).trim().replace(/[°NnEe]/g, "").match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lon = Number(m[2].replace(",", "."));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}
async function geoFromFiles(E, files) {
  const T = await import("../trace/georef.js");
  const ev = E.ev;
  const kml = files.find((f) => /\.km[lz]$/i.test(f.name));
  if (kml) {
    let text;
    if (/\.kmz$/i.test(kml.name)) { const z = await T.readZip(await kml.arrayBuffer()); const k = z.find((x) => /\.kml$/i.test(x.name)); if (!k) throw new Error(t("trc.ext.kmzNoKml")); text = new TextDecoder().decode(k.data); }
    else text = await kml.text();
    const ov = T.parseKml(text)[0];
    if (!ov) throw new Error(t("trc.ext.kmlNoOverlay"));
    return { geo: G.geoFromOverlay(ev, ov), how: "KML" };
  }
  const wf = files.find((f) => T.isWorldFileName(f.name));
  if (!wf) throw new Error(t("trc.ext.chooseGeoFile"));
  if (ev.map.kind !== "bitmap" || !E.map) throw new Error(t("trc.ext.worldNeedsImage"));
  const six = T.parseWorldFile(await wf.text());
  if (!six) throw new Error(t("trc.ext.geoUnreadable"));
  const prj = files.find((f) => /\.prj$/i.test(f.name));
  const geo = G.geoFromWorld(ev, six, prj ? await prj.text() : null, E.map.pxW, E.map.pxH);
  if (!geo) throw new Error(t("trc.ext.unknownCrs"));
  return { geo, how: t(prj ? "trc.ext.howWorldPrj" : "trc.ext.howWorld") };
}

// ---- other courses, faint ----------------------------------------------------------------------------------------------------
export async function otherCourses(E) {
  const ev = E.ev, ids = M.courseIds(ev);
  const cur = new Set(E.opts.others || []);
  const v = await modal(E, { title: t("trc.ext.othersTitle"), body: `<p>${t("trc.ext.othersIntro")}</p>
    ${ids.map((id) => `<label class="tr-check"><input type="checkbox" name="c${id}" ${cur.has(id) ? "checked" : ""} ${id === E.cd.course ? "disabled" : ""}> ${esc(ev.courses[id].name)}</label>`).join("")}` });
  if (!v) return;
  E.opts.others = ids.filter((id) => v[`c${id}`]);
  E.refresh();
}

// ---- a course read from the map ------------------------------------------------------------------------------------------------
/** The circles, start and finish printed on the map (a course drawn by other software, a scan of last year's): read as on
 *  « Analyse solo » (trace/course.js), they become controls of « Tous les postes », or a new course whose order (the
 *  detection gives none) goes from each control to the nearest one left, to be checked. */
export async function readCourseFromMap(E) {
  if (!E.map) { E.toast(t("trc.ext.mapNotLoaded")); return; }
  const v = await modal(E, { title: t("trc.ext.readTitle"), body: `
    <p>${t("trc.ext.readIntro")}</p>
    <label class="tr-check"><input type="radio" name="to" value="course" checked> ${t("trc.ext.readToCourse")}</label>
    <label class="tr-check"><input type="radio" name="to" value="all"> ${t("trc.ext.readToAll")}</label>
    ${field(t("trc.ext.readName"), `<input name="name" value="${esc(t("trc.ext.readDefault"))}">`)}`, ok: t("trc.ext.readOk") });
  if (!v) return;
  E.status(t("trc.ext.readingMap"), "busy");
  const C = await import("../trace/course.js");
  // the map at about 8 px per mm, the scale course.js was tuned at (3 px lines)
  const pxPerMm = Math.min(8, 6000 / Math.max(E.ev.map.w, E.ev.map.h));
  const W = Math.round(E.ev.map.w * pxPerMm), H = Math.round(E.ev.map.h * pxPerMm);
  let canvas;
  if (E.map.renderRegion) canvas = await E.map.renderRegion([0, 0, E.ev.map.w, E.ev.map.h], pxPerMm);
  else { canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; canvas.getContext("2d").drawImage(E.map.image, 0, 0, W, H); }
  let det;
  try { det = await C.detectCourse(canvas, { maxSide: Math.min(4000, Math.max(canvas.width, canvas.height)) }); } catch (err) { console.error(err); det = null; }
  const toMm = ([x, y]) => [x / pxPerMm, E.ev.map.h - y / pxPerMm];
  const circles = det?.controls || [];
  if (!circles.length && !det?.start && !det?.finish) { E.status(t("trc.ext.ready"), "ok"); E.toast(t("trc.ext.noCircle")); return; }
  let added = 0, courseId = 0;
  E.change((x) => {
    const ids = [];
    const near = (p, kind) => Object.keys(x.controls).map(Number).find((id) => x.controls[id].kind === kind && M.dist([x.controls[id].x, x.controls[id].y], p) < 1.5);
    const put = (p, kind) => { const ex = near(p, kind); if (ex) return ex; added++; return M.addControl(x, kind, p); };
    const start = det.start ? put(toMm([det.start.x, det.start.y]), "start") : 0;
    // the circles come unordered: nearest neighbour from the start (or the first found)
    const left = circles.map((c) => toMm([c.x, c.y])), order = [];
    let at = det.start ? toMm([det.start.x, det.start.y]) : left[0];
    while (left.length) { let k = 0; left.forEach((p, i) => { if (M.dist(p, at) < M.dist(left[k], at)) k = i; }); at = left.splice(k, 1)[0]; order.push(at); }
    const ctrls = order.map((p) => put(p, "normal"));
    const finish = det.finish ? put(toMm([det.finish.x, det.finish.y]), "finish") : 0;
    ids.push(...(start ? [start] : []), ...ctrls, ...(finish ? [finish] : []));
    if (v.to === "course") {
      courseId = M.createCourse(x, { name: v.name.trim() || t("trc.ext.readDefault"), addStartFinish: false });
      let last = 0;
      for (const id of ids) last = M.addCourseControl(x, id, courseId, last, 0);
    }
  }, t("trc.ext.readDefault"));
  if (courseId) E.setCourse(courseId);
  E.status(t("trc.ext.ready"), "ok");
  const found = [tn("trc.ext.nCircles", circles.length), det.start ? t("trc.ext.theStart") : "", det.finish ? t("trc.ext.theFinish") : ""].filter(Boolean).join(", ");
  E.toast(t(courseId ? "trc.ext.readDoneOrder" : "trc.ext.readDone", { found, added: tn("trc.ext.nAdded", added) }), 7000);
}

// ---- differences between two versions ------------------------------------------------------------------------------------------
/** What changed from one event to another, in sentences. */
export function diff(a, b) {
  if (!a || !b) return [];
  const out = [];
  const mm = (ev, d) => Math.round(M.mmToM(ev, d));
  if ((a.title || "") !== (b.title || "")) out.push(t("trc.ext.dTitle", { a: a.title, b: b.title }));
  if (a.map?.file !== b.map?.file || a.map?.scale !== b.map?.scale) out.push(t("trc.ext.dMap", { a: a.map?.file, as: a.map?.scale, b: b.map?.file, bs: b.map?.scale }));
  // controls, matched by id (a code changes, the control stays)
  const ca = a.controls || {}, cb = b.controls || {};
  const nameIn = (ev, id) => ctrlName(ev, Number(id));
  const added = Object.keys(cb).filter((id) => !ca[id]), removed = Object.keys(ca).filter((id) => !cb[id]);
  if (added.length) out.push(t("trc.ext.dAdded", { list: added.map((id) => nameIn(b, id)).join(", ") }));
  if (removed.length) out.push(t("trc.ext.dRemoved", { list: removed.map((id) => nameIn(a, id)).join(", ") }));
  const moved = [], recoded = [], redesc = [];
  for (const id of Object.keys(ca)) {
    const x = ca[id], y = cb[id];
    if (!y) continue;
    const d = Math.hypot(x.x - y.x, x.y - y.y);
    if (d > 0.05) moved.push(`${nameIn(b, id)} (${mm(b, d)} m)`);
    if (x.code !== y.code && x.kind === "normal") recoded.push(`${x.code} → ${y.code}`);
    if (JSON.stringify(x.symbols) !== JSON.stringify(y.symbols) || (x.descText || "") !== (y.descText || "")) redesc.push(nameIn(b, id));
  }
  if (moved.length) out.push(t("trc.ext.dMoved", { list: moved.join(", ") }));
  if (recoded.length) out.push(t("trc.ext.dRecoded", { list: recoded.join(", ") }));
  if (redesc.length) out.push(t("trc.ext.dRedesc", { list: redesc.join(", ") }));
  // courses, matched by id
  const ka = a.courses || {}, kb = b.courses || {};
  for (const id of Object.keys(kb)) if (!ka[id]) out.push(t("trc.ext.dCourseAdded", { name: kb[id].name }));
  for (const id of Object.keys(ka)) if (!kb[id]) out.push(t("trc.ext.dCourseRemoved", { name: ka[id].name }));
  for (const id of Object.keys(ka)) {
    if (!kb[id]) continue;
    const n = Number(id), x = ka[id], y = kb[id], tag = y.name;
    if (x.name !== y.name) out.push(t("trc.ext.dCourseRenamed", { a: x.name, b: y.name }));
    // compared by control (a code renamed is listed above), shown with each version's codes
    const ctl = (ev) => { try { return M.ccIds(ev, M.cdCourse(n)).map((cc) => ev.courseControls[cc].control); } catch (e) { return []; } };
    const ia = ctl(a), ib = ctl(b);
    if (ia.join() !== ib.join()) out.push(t("trc.ext.dCourseSeq", { course: tag, a: ia.map((c) => nameIn(a, c)).join("-") || t("trc.ext.dEmpty"), b: ib.map((c) => nameIn(b, c)).join("-") || t("trc.ext.dEmpty") }));
    try {
      const va = M.view(a, M.cdCourse(n), { specials: false, descriptions: false }), vb = M.view(b, M.cdCourse(n), { specials: false, descriptions: false });
      if (Math.abs(va.maxLength - vb.maxLength) >= 10) out.push(t("trc.ext.dLength", { course: tag, a: nf(va.maxLength / 1000, 2), b: nf(vb.maxLength / 1000, 2) }));
    } catch (e) { /* a broken older version */ }
    if ((x.climb ?? -1) !== (y.climb ?? -1)) out.push(t("trc.ext.dClimb", { course: tag, a: x.climb >= 0 ? `${x.climb} m` : "—", b: y.climb >= 0 ? `${y.climb} m` : "—" }));
    if ((x.printScale || 0) !== (y.printScale || 0)) out.push(t("trc.ext.dPrintScale", { course: tag, a: x.printScale, b: y.printScale }));
  }
  const la = a.legs || {}, lb = b.legs || {};
  const legKey = (l) => `${l.c1}:${l.c2}`;
  const legsA = new Map(Object.values(la).map((l) => [legKey(l), l])), legsB = new Map(Object.values(lb).map((l) => [legKey(l), l]));
  let legsChanged = 0;
  for (const [k, l] of legsB) if (JSON.stringify(legsA.get(k) || null) !== JSON.stringify(l)) legsChanged++;
  for (const k of legsA.keys()) if (!legsB.has(k)) legsChanged++;
  if (legsChanged) out.push(t("trc.ext.dLegs", { n: legsChanged }));
  const sa = Object.keys(a.specials || {}).length, sb = Object.keys(b.specials || {}).length;
  if (sa !== sb) out.push(t("trc.ext.dSpecials", { a: sa, b: sb }));
  else if (JSON.stringify(a.specials) !== JSON.stringify(b.specials)) out.push(t("trc.ext.dSpecialsChanged"));
  if (JSON.stringify(a.appearance) !== JSON.stringify(b.appearance)) out.push(t("trc.ext.dAppearance"));
  if (JSON.stringify(a.geo || null) !== JSON.stringify(b.geo || null)) out.push(t("trc.ext.dGeo"));
  return out;
}
export { sel };
