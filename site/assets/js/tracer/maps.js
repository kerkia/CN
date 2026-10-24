// Several maps in one event (the advanced level; owner, 2026-10-24, after Condes's canvases): besides the event's map, other
// maps (ev.maps: { id: { name, map: { kind, file, scale, dpi, w, h }, tf } }), each placed on the event by an affine tf from the
// event's millimetres to its own sheet's — found from both maps' georeferencing, or the same frame (another print of the same
// map), or two points clicked on each. A course part prints on a map of its own (course.partMaps: { part: id }, part -1 the whole
// course): the second side of a map flip, a sprint part on a town map, a long distance on two sheets. The controls stay one set,
// in the event's millimetres: on another map they fall where the placing puts them. The files are stored beside the map
// (store.js saveExtraMap: tracer/<id>/maps/<n>) and go with the event in its .ozmt.

import * as M from "./model.js";
import * as S from "./store.js";
import { openMap, MAP_ACCEPT, isMapFile, mimeOf } from "./mapsrc.js";
import { hasGeo, toLatLon } from "./geo.js";
import { t } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** An affine [a, b, c, d, e, f] (x' = a x + b y + c, y' = d x + e y + f) applied, inverted, composed. */
export const apply = (m, [x, y]) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
export function invert(m) {
  const det = m[0] * m[4] - m[1] * m[3];
  return [m[4] / det, -m[1] / det, (m[1] * m[5] - m[4] * m[2]) / det, -m[3] / det, m[0] / det, (m[3] * m[2] - m[0] * m[5]) / det];
}
/** The similarity taking two points onto two others (a placing by two pairs of points). */
export function similarity([p1, p2], [q1, q2]) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], ex = q2[0] - q1[0], ey = q2[1] - q1[1], d2 = dx * dx + dy * dy || 1;
  const a = (dx * ex + dy * ey) / d2, b = (dx * ey - dy * ex) / d2;          // scale·cos, scale·sin
  return [a, -b, q1[0] - (a * p1[0] - b * p1[1]), b, a, q1[1] - (b * p1[0] + a * p1[1])];
}

/** The map a course designator prints on: { id, src, tf, meta } for another map, or null for the event's own. */
export function mapOf(E, cd) {
  const c = cd?.course ? E.ev.courses[cd.course] : null;
  const id = c?.partMaps?.[cd.part ?? -1] ?? c?.partMaps?.[-1];
  if (!id || !E.ev.maps?.[id]) return null;
  return { id: Number(id), src: E.extraMaps?.[id] || null, tf: E.ev.maps[id].tf, meta: E.ev.maps[id] };
}
/** The templates shown over the map (mapview.js): [{ id, src, tf, meta }]. */
export const templatesOf = (E) => Object.entries(E.ev.maps || {}).filter(([id, m]) => m.template && !m.hidden && E.extraMaps?.[id])
  .map(([id, m]) => ({ id: Number(id), src: E.extraMaps[id], tf: m.tf, meta: m }));
/** Open the event's other maps (their files read once a visit; E.extraMaps), then redraw. */
export async function loadExtraMaps(E) {
  E.extraMaps = E.extraMaps || {};
  for (const [id, m] of Object.entries(E.ev.maps || {})) {
    if (E.extraMaps[id]) continue;
    try {
      const r = await S.loadExtraMap(E.meta.id, id, E.key);
      if (r?.bytes) E.extraMaps[id] = await openMap(r.bytes, r.type, m.map.file, m.map.dpi || 0);
    } catch (err) { console.error(err); }
  }
  E.redraw?.();
}
/** Draw another map on the editor's canvas under the course: its image placed by the inverse of its tf. */
export function drawExtra(g, T, k, mo, alpha = 1) {
  const src = mo.src;
  if (!src?.image) return;
  const inv = invert(mo.tf), ppm = src.pxW / src.w;
  // pixel (u, v) → sheet mm (u / ppm, h − v / ppm) → event mm (inv) → screen (T)
  const o = T(...apply(inv, [0, src.h])), ux = T(...apply(inv, [1 / ppm, src.h])), vy = T(...apply(inv, [0, src.h - 1 / ppm]));
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  // one pixel along and down, from the image's corner: multiplied onto the editor's own transform (its device pixel ratio)
  g.transform(ux[0] - o[0], ux[1] - o[1], vy[0] - o[0], vy[1] - o[1], o[0], o[1]);
  g.drawImage(src.image, 0, 0);
  g.restore();
}

/** « Cartes »: the event's maps, a new one added and placed, one removed, and the map of each part of the course in hand. */
export async function mapsDialog(E) {
  const { modal, dropHtml, dropZone, field, sel } = await import("./dialogs.js");
  const ev = E.ev, maps = Object.entries(ev.maps || {}).filter(([, m]) => !m.template);      // an OCAD map's templates: mapview.js
  const course = E.cd.course ? ev.courses[E.cd.course] : null;
  const parts = course ? M.countParts(ev, M.cdCourse(E.cd.course)) : 0;
  const opts = [["", t("trc.maps.main", { file: ev.map.file || "—" })], ...maps.map(([id, m]) => [id, m.name || m.map.file])];
  const partSel = (p) => sel(`p${p}`, opts, String(course?.partMaps?.[p] ?? ""));
  let file = null;
  const v = await modal(E, { title: t("trc.maps.title"), wide: true, ok: t("trc.maps.save"), body: `
    <p>${esc(t("trc.maps.intro"))}</p>
    <table class="tr-table"><thead><tr><th>${esc(t("trc.maps.map"))}</th><th>${esc(t("trc.maps.file"))}</th><th>1:</th><th></th></tr></thead><tbody>
      <tr><td><b>${esc(t("trc.maps.mainName"))}</b></td><td>${esc(ev.map.file || "—")}</td><td>${ev.map.scale}</td><td></td></tr>
      ${maps.map(([id, m]) => `<tr><td><input name="n${id}" value="${esc(m.name || "")}" size="12"></td><td>${esc(m.map.file)}</td><td>${m.map.scale}</td>
        <td><label class="tr-check"><input type="checkbox" name="rm${id}"> ${esc(t("trc.maps.remove"))}</label></td></tr>`).join("")}</tbody></table>
    ${course ? `<h4>${esc(t("trc.maps.parts", { course: course.name }))}</h4><div class="tr-grid2">${parts > 1
      ? Array.from({ length: parts }, (_, p) => field(t("trc.maps.part", { n: p + 1 }), partSel(p))).join("") : field(t("trc.maps.whole"), partSel(-1))}</div>` : `<p class="tr-hint">${esc(t("trc.maps.chooseCourse"))}</p>`}
    <h4>${esc(t("trc.maps.add"))}</h4>
    ${dropHtml("tr-maps-drop", t("trc.maps.drop"), MAP_ACCEPT, false)}<p class="tr-hint" id="tr-maps-file">${esc(t("trc.maps.noFile"))}</p>
    <div class="tr-grid2">${field(t("trc.maps.newName"), '<input name="newName" value="">')}${field(t("trc.maps.scale"), `<input name="scale" value="${ev.map.scale}" inputmode="numeric">`)}
      ${field(t("trc.maps.place"), sel("place", [["same", t("trc.maps.placeSame")], ["geo", t("trc.maps.placeGeo")], ["points", t("trc.maps.placePoints")]], hasGeo(ev) ? "geo" : "same"), t("trc.maps.placeHint"))}</div>`,
  onOpen: (f) => dropZone(f.querySelector("#tr-maps-drop"), (list) => {
    file = list.find(isMapFile) || null;
    f.querySelector("#tr-maps-file").textContent = file ? t("trc.maps.chosen", { name: file.name }) : t("trc.maps.notMap");
    if (file && !f.elements.newName.value) f.elements.newName.value = file.name.replace(/\.[a-z0-9]+$/i, "");
  }) });
  if (!v) return;
  // a new map: stored, opened, then placed on the event
  let added = null;
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer()), type = mimeOf(file.name, file.type);
    let src;
    try { src = await openMap(bytes, type, file.name); } catch (e) { E.toast(t("trc.maps.unreadable")); return; }
    const tf = await placing(E, src, v.place, Number(v.scale) || ev.map.scale);
    if (!tf) return;
    const id = Math.max(0, ...Object.keys(ev.maps || {}).map(Number)) + 1;
    E.status(t("trc.maps.saving"), "busy");
    try { await S.saveExtraMap(E.meta.id, id, bytes, type, E.key); } catch (e) { E.status(t("trc.maps.notSaved"), "bad"); E.toast(t("trc.maps.notSaved")); return; }
    E.extraMaps = { ...(E.extraMaps || {}), [id]: src };
    added = { id, entry: { name: v.newName.trim() || file.name, map: { kind: src.kind === "vector" ? "ocad" : src.kind, file: file.name, scale: Number(v.scale) || ev.map.scale, dpi: src.dpi || 0, w: src.w, h: src.h }, tf } };
  }
  const removed = maps.filter(([id]) => v[`rm${id}`]).map(([id]) => Number(id));
  E.change((x) => {
    x.maps = x.maps || {};
    for (const [id] of maps) if (x.maps[id] && v[`n${id}`] != null) x.maps[id].name = v[`n${id}`].trim();
    if (added) x.maps[added.id] = added.entry;
    for (const id of removed) {
      delete x.maps[id];
      for (const c of Object.values(x.courses)) if (c.partMaps) for (const [p, m] of Object.entries(c.partMaps)) if (Number(m) === id) delete c.partMaps[p];
    }
    if (course) {
      const c = x.courses[E.cd.course], pm = {};
      for (const p of parts > 1 ? Array.from({ length: parts }, (_, i) => i) : [-1]) { const val = v[`p${p}`]; if (val) pm[p] = Number(val); }
      if (Object.keys(pm).length) c.partMaps = pm; else delete c.partMaps;
    }
    if (!Object.keys(x.maps).length) delete x.maps;
  }, t("trc.maps.undo"));
  for (const id of removed) S.deleteExtraMap(E.meta.id, id).catch(() => null);
  E.status(t("trc.maps.saved"), "ok");
}

/** The affine from the event's mm to the new map's sheet mm, by the way chosen; null when given up. */
async function placing(E, src, how, scale) {
  const ev = E.ev;
  if (how === "same") {
    // the same frame: an OCAD or Mapper map in its own file's mm (the event's origin moved), else the sheets' corners together,
    // at the two maps' scales
    const k = ev.map.scale / scale, [ox, oy] = src.kind === "vector" ? [Number(src.ox) || 0, Number(src.oy) || 0] : [0, 0], [ex, ey] = M.fileOffset(ev);
    return [k, 0, ex - ox, 0, k, ey - oy];
  }
  if (how === "geo") {
    if (!hasGeo(ev)) { E.toast(t("trc.maps.noGeoEvent")); return null; }
    let geo2 = null;
    if (src.kind === "vector") { try { geo2 = (await (await import("./vmap/georef.js")).geoFromVector(src.vmap, src))?.geo; } catch (e) { geo2 = null; } }
    else if (src.world) { const { geoFromWorld } = await import("./geo.js"); geo2 = geoFromWorld({ map: { w: src.w, h: src.h } }, src.world.wf, null, src.pxW, src.pxH, src.world.crs); }
    if (!geo2) { E.toast(t("trc.maps.noGeoMap")); return null; }
    // three points of the event: their lat/lon, then their place on the new map
    const pts = [[0, 0], [ev.map.w || 200, 0], [0, ev.map.h || 200]];
    const on = pts.map(([x, y]) => { const [lat, lon] = toLatLon(ev, x, y); return [geo2.a * lon + geo2.b * lat + geo2.c, geo2.d * lon + geo2.e * lat + geo2.f]; });
    const [p0, p1, p2] = pts, [q0, q1, q2] = on, W = p1[0] - p0[0], H = p2[1] - p0[1];
    const a = (q1[0] - q0[0]) / W, d = (q1[1] - q0[1]) / W, b = (q2[0] - q0[0]) / H, e = (q2[1] - q0[1]) / H;
    return [a, b, q0[0] - a * p0[0] - b * p0[1], d, e, q0[1] - d * p0[0] - e * p0[1]];
  }
  // two points: clicked on the event's map, then the same two on the new map
  const pick = (msg) => new Promise((res) => { E.help(msg); E.pickOnce = res; E.pickCancel = () => res(null); });
  const a1 = await pick(t("trc.maps.pickMain1")), a2 = a1 ? await pick(t("trc.maps.pickMain2")) : null;
  E.help();
  if (!a1 || !a2) return null;
  const b = await pickOnNew(E, src);
  if (!b) return null;
  return similarity([a1, a2], b);
}
/** Two points clicked on the new map, shown in a window: their places in the new map's sheet mm. */
async function pickOnNew(E, src) {
  const { modal } = await import("./dialogs.js");
  let pts = [];
  const v = await modal(E, { title: t("trc.maps.pickNewTitle"), wide: true, ok: t("trc.maps.pickNewOk"), body: `<p>${esc(t("trc.maps.pickNewIntro"))}</p>
    <canvas id="tr-maps-pick" style="width:100%;max-height:60vh;cursor:crosshair;border:1px solid var(--border)"></canvas><p class="tr-hint" id="tr-maps-picked"></p>`,
  onOpen: (f) => {
    const c = f.querySelector("#tr-maps-pick"), g = c.getContext("2d"), sc = Math.min(1, 1400 / src.pxW);
    c.width = Math.round(src.pxW * sc); c.height = Math.round(src.pxH * sc);
    const draw = () => { g.drawImage(src.image, 0, 0, c.width, c.height); g.strokeStyle = "#dc2626"; g.lineWidth = 2; pts.forEach(([u, w], i) => { g.beginPath(); g.arc(u * sc, w * sc, 9, 0, Math.PI * 2); g.stroke(); g.fillStyle = "#dc2626"; g.fillText(String(i + 1), u * sc + 11, w * sc - 6); }); };
    draw();
    c.addEventListener("click", (e) => {
      const r = c.getBoundingClientRect(), u = ((e.clientX - r.left) / r.width) * c.width / sc, w = ((e.clientY - r.top) / r.height) * c.height / sc;
      pts = pts.length >= 2 ? [[u, w]] : [...pts, [u, w]];
      f.querySelector("#tr-maps-picked").textContent = t("trc.maps.picked", { n: pts.length });
      draw();
    });
  },
  validate: () => (pts.length < 2 ? t("trc.maps.needTwo") : null) });
  if (!v) return null;
  const ppm = src.pxW / src.w;
  return pts.map(([u, w]) => [u / ppm, src.h - w / ppm]);
}
