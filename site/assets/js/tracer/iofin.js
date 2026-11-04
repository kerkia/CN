// Courses brought in from other course-setting programs (the advanced level; owner, 2026-10-24, after the Condes study):
// IOF XML CourseData 3.0 and 2.0.3 (Condes, OCAD, Purple Pen, MeOS, SportSoftware…) with their classes and relay teams, an IOF
// XML ClassList (the classes alone), and the courses of an OCAD course-setting map (OCAD's parameter strings: a control per
// course-setting object, with its description, a course per « Course » string — read after OCAD's file format description,
// checked on an OCAD 2018 course-setting file on 2026-11-04: controls, start, courses ending at the start; variations and
// classes not yet met in a real file). Every source becomes one shape — { controls, courses, classes, teams, scale, geo } — that
// importInto() puts into the event: controls matched by code to those already there (or added), courses added or replacing
// the event's, a course's variations as courses of their own (a CourseFamily names them), classes as data (ev.classes),
// relay teams kept with their courses' names (ev.relayTeams, written back by the IOF export).

import * as M from "./model.js";
import { hasGeo, toMm } from "./geo.js";
import { t, tn } from "./lang.js";
import { symbolsLoaded, existsIn } from "./symbols.js";

const num = (s) => { const v = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(v) ? v : null; };
const kids = (el, name) => [...(el?.children || [])].filter((c) => c.localName === name);
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name) => kid(el, name)?.textContent.trim() || "";
const all = (el, name) => [...el.getElementsByTagName("*")].filter((c) => c.localName === name);

/** What an XML file holds: "coursedata3", "coursedata2", "classlist", or null. */
export function iofKind(text) {
  let doc;
  try { doc = new DOMParser().parseFromString(text, "application/xml"); } catch (e) { return null; }
  if (doc.querySelector("parsererror")) return null;
  const root = doc.documentElement, ns = root.namespaceURI || "";
  if (root.localName === "CourseData") return /datastandard\/3\.0/.test(ns) || root.getAttribute("iofVersion") === "3.0" ? "coursedata3" : "coursedata2";
  if (root.localName === "ClassList") return "classlist";
  return null;
}

/** An IOF XML text read into the import shape. */
export function readIof(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement, kind = iofKind(text);
  if (kind === "classlist") return { controls: [], courses: [], classes: all(root, "Class").map((c) => ({ name: txt(c, "Name") || txt(c, "ShortName"), course: null, est: -1 })).filter((c) => c.name), teams: [] };
  if (kind === "coursedata2") return readIof2(root);
  if (kind !== "coursedata3") throw new Error(t("trc.imp.notIof"));
  const rcd = all(root, "RaceCourseData")[0] || root;
  const out = { controls: [], courses: [], classes: [], teams: [], scale: num(txt(kid(rcd, "Map"), "Scale")) };
  const TYPE = { Start: "start", Finish: "finish", CrossingPoint: "crossing", Control: "normal", EndOfMarkedRoute: "crossing" };
  for (const c of kids(rcd, "Control")) {
    const pos = kid(c, "Position"), mp = kid(c, "MapPosition");
    out.controls.push({ code: txt(c, "Id"), kind: TYPE[c.getAttribute("type") || "Control"] || "normal",
      x: mp ? num(mp.getAttribute("x")) : null, y: mp ? num(mp.getAttribute("y")) : null,
      lat: pos ? num(pos.getAttribute("lat")) : null, lon: pos ? num(pos.getAttribute("lng")) : null });
  }
  for (const c of kids(rcd, "Course")) {
    const seq = kids(c, "CourseControl").map((cc) => {
      const type = cc.getAttribute("type") || "Control";
      return { kind: TYPE[type] || "normal", code: kids(cc, "Control").map((x) => x.textContent.trim())[0] || "", points: num(txt(cc, "Score")) || 0, random: cc.getAttribute("randomOrder") === "true" };
    });
    out.courses.push({ name: txt(c, "Name"), family: txt(c, "CourseFamily") || null, length: num(txt(c, "Length")), climb: num(txt(c, "Climb")),
      score: seq.some((s) => s.random && s.kind === "normal") || seq.some((s) => s.points > 0), seq });
  }
  for (const a of kids(rcd, "ClassCourseAssignment")) out.classes.push({ name: txt(a, "ClassName"), course: txt(a, "CourseName") || txt(a, "CourseFamily"), est: -1 });
  for (const tm of kids(rcd, "TeamCourseAssignment")) {
    out.teams.push({ bib: txt(tm, "BibNumber"), name: txt(tm, "TeamName"),
      legs: kids(tm, "TeamMemberCourseAssignment").map((m) => ({ leg: num(txt(m, "Leg")) || 0, course: txt(m, "CourseName"), family: txt(m, "CourseFamily") || null })) });
  }
  return out;
}
function readIof2(root) {
  const out = { controls: [], courses: [], classes: [], teams: [], scale: num(txt(kid(root, "Map"), "Scale")) };
  const pt = (el, kind, codeEl) => { const mp = kid(el, "MapPosition"); out.controls.push({ code: txt(el, codeEl), kind, x: mp ? num(mp.getAttribute("x")) : null, y: mp ? num(mp.getAttribute("y")) : null }); };
  for (const el of kids(root, "StartPoint")) pt(el, "start", "StartPointCode");
  for (const el of kids(root, "Control")) pt(el, "normal", "ControlCode");
  for (const el of kids(root, "FinishPoint")) pt(el, "finish", "FinishPointCode");
  for (const c of kids(root, "Course")) {
    const name = txt(c, "CourseName"), vars = kids(c, "CourseVariation");
    for (const k of kids(c, "ClassShortName")) out.classes.push({ name: k.textContent.trim(), course: name, est: -1 });
    for (const v of vars) {
      const seq = [];
      const st = txt(v, "StartPointCode"); if (st) seq.push({ kind: "start", code: st });
      for (const cc of kids(v, "CourseControl")) seq.push({ kind: "normal", code: txt(cc, "ControlCode"), points: num(txt(cc, "ScoreOPoints")) || 0 });
      const fi = txt(v, "FinishPointCode"); if (fi) seq.push({ kind: "finish", code: fi });
      const vn = txt(v, "Name");
      out.courses.push({ name: vars.length > 1 && vn ? `${name} ${vn}` : name, family: vars.length > 1 ? name : null,
        length: num(txt(v, "CourseLength")), climb: num(txt(v, "CourseClimb")), score: seq.some((s) => s.points > 0), seq });
    }
  }
  return out;
}

// OCAD's description symbols are its course-setting symbol numbers: the ISCD 2018 number with three decimals (« d1.003 » = 1.3,
// « d1.013 » = 1.13), a symbol with directions three digits more (« g12.306 » = 12.3, direction 6; « c0.208 » = 0.2, direction 8).
// The directions are numbered counter-clockwise, the cardinal ones first: N, W, S, E, then NW, SW, SE, NE — read on an OCAD 2018
// file against its map (2026-11-04: « 0.102 » the western of two pits, « 0.208 » the north-eastern of three boulders, « 12.306 »
// a depression's south-western part), OCAD's documentation saying nothing of it.
const OCAD_DIRS = ["N", "W", "S", "E", "NW", "SW", "SE", "NE"];
// ISCD 2018 numbers that Purple Pen's ids (the Tracer's) keep from 2004 (iscd.js gives the other way)
const FROM_ISCD = {
  "5.21": "5.23", "5.22": "5.24", "5.23": "5.25", "5.24": "5.26", "11.1": "11.7",
  "12.1": "11.1", "12.2": "11.2", "12.3": "11.3", "12.4": "11.4", "12.5": "11.5", "12.6": "11.6", "12.7": "11.8", "12.8": "11.9",
  "12.9": "11.10", "12.10": "11.11", "12.11": "11.13", "12.12": "11.14", "12.13": "11.12", "12.14": "11.15",
  "13.1": "12.1", "13.2": "12.2", "13.3": "12.4", "14.1": "13.6", "15.1": "13.1", "15.2": "13.2", "15.3": "13.3", "15.4": "13.4",
  "15.5": "13.5", "16.1": "14.1", "16.2": "14.2", "16.3": "14.3", "9.1": "9.1high", "9.3": "9.3high",
};
/** The Tracer's (Purple Pen's) symbol id of an OCAD description symbol number, or null. */
export function ocadSymbol(raw) {
  const m = /^(\d+)\.(\d{3})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const sub = Number(m[2]), minor = sub >= 100 ? Math.floor(sub / 100) : sub, dir = sub >= 100 ? sub % 100 : 0;
  if (!minor) return null;
  const ref = `${Number(m[1])}.${minor}`, id = FROM_ISCD[ref] || ref;
  if (!dir) return id;
  return OCAD_DIRS[dir - 1] ? `${id}${OCAD_DIRS[dir - 1]}` : null;
}

/** An OCAD course-setting map's courses (vmap/ocad.js: map.courseSetting) in the import shape, positions in the file's mm. A course
 *  that ends at its start (« s S2 » again: a finish at the start) gets a finish there. Variations keep their first branch only:
 *  `forked` names those courses. */
export function fromOcad(cs) {
  const out = { controls: [], courses: [], classes: [], teams: [], forked: [] };
  if (!cs) return out;
  const KIND = { s: "start", c: "normal", f: "finish", k: "crossing", w: "crossing" };
  const at = new Map();
  for (const c of cs.controls) {
    const symbols = c.kind === "normal" ? ["c", "d", "e", "f", "g", "h"].map((k) => ocadSymbol(c.descr?.[k])) : null;
    out.controls.push({ code: c.code, kind: c.kind, x: c.x, y: c.y, symbols: symbols?.some(Boolean) ? symbols : null });
    at.set(c.code, c);
  }
  for (const co of cs.courses) {
    const seq = [];
    let depth = 0, branch = 0, forked = false;
    for (const [k, v] of co.parts) {
      if (k === "l" || k === "r") { depth++; branch = 0; forked = true; continue; }      // a variation: its first branch only
      if (k === "b" || k === "v") { branch++; continue; }
      if (k === "p" || k === "q") { depth = Math.max(0, depth - 1); continue; }
      if (depth && branch > 1) continue;
      if (KIND[k]) seq.push({ kind: KIND[k], code: v.trim(), points: 0, exchange: false });
      else if (k === "g" && seq.length) seq[seq.length - 1].exchange = true;
    }
    // back to the start at the end: a finish drawn at the start's place (one for every course that does it)
    const last = seq[seq.length - 1];
    if (seq.length > 1 && last.kind === "start" && last.code === seq[0].code) {
      const code = `${last.code}→`;                      // the start's code and an arrow: no control's code
      if (!out.controls.some((c) => c.code === code)) { const s = at.get(last.code); out.controls.push({ code, kind: "finish", x: s?.x ?? null, y: s?.y ?? null }); }
      seq[seq.length - 1] = { kind: "finish", code, points: 0, exchange: false };
    }
    if (forked) out.forked.push(co.name);
    out.courses.push({ name: co.name, family: null, length: null, climb: num(co.climb), scale: co.scale || null, score: false, seq });
  }
  for (const k of cs.classes) out.classes.push({ name: k.name, course: k.course || null, est: k.runners > 0 ? k.runners : -1 });
  return out;
}

/** An image object's picture ({ format, data: base64 }) from an OCAD layout image (vmap/map.js LayerBitmap): PNG and JPEG as they
 *  are, any other format (BMP, GIF) as a PNG of its decoded picture. */
async function imageObject(b) {
  let bytes = b.bytes, format = bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpeg" : "";
  if (!format) {
    await b.ready;
    if (!b.image || typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = b.image.width; c.height = b.image.height;
    c.getContext("2d").drawImage(b.image, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, "image/png"));
    if (!blob) return null;
    bytes = new Uint8Array(await blob.arrayBuffer()); format = "png";
  }
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { format, data: btoa(s) };
}
/** An OCAD course file's layout images — the club's, the league's, the sponsors' logos (owner, 2026-11-04: never left out of a
 *  display of the map) — ready to place: [{ box: [l, b, r, t] in the file's mm, image }], hidden ones apart. */
export async function layoutPictures(map) {
  const out = [];
  for (const b of map?.layoutImages || []) {
    if (b.visible === false || !(b.w > 0 && b.h > 0)) continue;
    const image = await imageObject(b).catch(() => null);
    if (image) out.push({ box: b.bbox.slice(), image });
  }
  return out;
}
/** Those pictures as image objects of the event, on every course, where OCAD shows them. fileMm: the boxes are the map file's own
 *  mm (an OCAD map's event frame is shifted by its origin). Returns how many were added. */
export function placeLayoutImages(ev, pics, { fileMm = true } = {}) {
  const [fx, fy] = fileMm ? M.fileOffset(ev) : [0, 0];
  const near = (p, q) => Math.abs(p[0] - q[0]) < 0.1 && Math.abs(p[1] - q[1]) < 0.1;
  let n = 0;
  for (const { box: [l, b, r, tp], image } of pics) {
    const pts = [[l - fx, tp - fy], [r - fx, b - fy]];
    // the same picture at the same place already (a course file imported again): not twice
    if (Object.values(ev.specials).some((s) => s.kind === "image" && s.image?.data === image.data && near(s.pts[0], pts[0]))) continue;
    M.addSpecial(ev, "image", pts, { image, text: t("trc.imp.logo", { n: ++n }) });
  }
  return n;
}
export async function addLayoutImages(ev, map, opts) { return placeLayoutImages(ev, await layoutPictures(map), opts); }

/** What the import holds, in a few words (the dialog). */
export function summary(data, logos = 0) {
  const ok = data.controls.filter((c) => c.code).length;
  return [tn("trc.imp.nControls", ok), tn("trc.imp.nCourses", data.courses.length), data.classes.length ? tn("trc.imp.nClasses", data.classes.length) : "",
    data.teams.length ? tn("trc.imp.nTeams", data.teams.length) : "", logos ? tn("trc.imp.nLogos", logos) : ""].filter(Boolean).join(" · ");
}

/**
 * Put an import into the event (in a change: undoable). opts: { replace (the event's courses go first), place: "geo" | "map",
 * fileMm (the positions are the map file's own mm, as OCAD and IOF write them for an OCAD map) }. Returns { added, matched,
 * courses, skipped: [names], unplaced: [codes] }.
 */
export function importInto(ev, data, { replace = false, place = "map", fileMm = true } = {}) {
  const res = { added: 0, matched: 0, courses: 0, skipped: [], unplaced: [] };
  const [fx, fy] = fileMm ? M.fileOffset(ev) : [0, 0];
  if (replace) {
    for (const id of M.courseIds(ev)) M.deleteCourse(ev, id);
    ev.classes = {}; delete ev.relayTeams;
  }
  // the controls: one per code (a start, finish or crossing keeps its own name as its code here)
  const byCode = new Map();
  for (const c of data.controls) {
    if (!c.code) continue;
    let pos = null;
    if (place === "geo" && hasGeo(ev) && c.lat != null && c.lon != null) pos = toMm(ev, c.lat, c.lon);
    else if (c.x != null && c.y != null) pos = [c.x - fx, c.y - fy];
    let id = c.kind === "normal" ? M.findCode(ev, c.code) : 0;
    if (!id && c.kind !== "normal") id = Number(Object.keys(ev.controls).find((k) => ev.controls[k].kind === c.kind && ev.controls[k].importCode === c.code) || 0);
    // a start, finish or crossing point without a code of its own: the one of its kind at the same place
    if (!id && c.kind !== "normal" && pos) id = Number(Object.keys(ev.controls).find((k) => ev.controls[k].kind === c.kind && M.dist([ev.controls[k].x, ev.controls[k].y], pos) < 0.5) || 0);
    if (id) { res.matched++; byCode.set(c.code, id); continue; }
    if (!pos) { res.unplaced.push(c.code); pos = [0, 0]; }
    id = M.addControl(ev, c.kind, pos, { code: c.kind === "normal" ? c.code : null });
    if (c.kind !== "normal") ev.controls[id].importCode = c.code;
    // its description (OCAD's): the symbols the description standard has, the others left empty
    if (c.symbols && c.kind === "normal") ev.controls[id].symbols = c.symbols.map((s) => (s && (!symbolsLoaded() || existsIn(s, ev.descStandard)) ? s : null));
    byCode.set(c.code, id); res.added++;
  }
  // the courses, in the file's order
  const courseByName = new Map();
  for (const co of data.courses) {
    if (!co.seq.length) { res.skipped.push(co.name); continue; }
    const id = M.createCourse(ev, { name: co.name || t("trc.imp.course"), kind: co.score ? "score" : "normal", addStartFinish: false,
      climb: co.climb > 0 ? co.climb : -1, scoreColumn: co.score ? 0 : null, ...(co.scale > 100 ? { printScale: co.scale } : {}) });
    courseByName.set(co.name, id);
    if (co.family && !courseByName.has(co.family)) courseByName.set(co.family, id);
    let last = 0;
    for (const s of co.seq) {
      const cid = byCode.get(s.code);
      if (!cid) continue;
      const kind = ev.controls[cid].kind;
      if (kind === "start") { last = M.addStartOrIssue(ev, cid, id); continue; }
      if (kind === "finish") { M.addFinish(ev, cid, id); continue; }
      const p = M.insertionPoint(ev, M.cdCourse(id), last || 0, 0);
      last = M.addCourseControl(ev, cid, id, p.cc1, p.cc2, p.loc);
      if (s.points) ev.courseControls[last].points = s.points;
      if (s.exchange) ev.courseControls[last].exchange = true;
    }
    res.courses++;
  }
  // the classes: by course name (or family), else left for the classes dialog
  if (data.classes.length) {
    ev.classes = ev.classes || {};
    const known = new Set(Object.values(ev.classes).map((k) => `${k.name}|${k.course}`));
    for (const k of data.classes) {
      const course = k.course ? courseByName.get(k.course) || 0 : 0;
      if (known.has(`${k.name}|${course}`)) continue;
      M.addObj(ev, "class", { name: k.name, course, est: k.est ?? -1 });
    }
  }
  if (data.teams.length) ev.relayTeams = data.teams;
  M.syncDerived(ev);
  return res;
}

/** « Importer des circuits » (IOF XML, OCAD course setting): the file, what it holds, how to place it, then the import. */
export async function importDialog(E, preset = null) {
  const { modal, dropHtml, dropZone, field, sel } = await import("./dialogs.js");
  let file = preset, data = null, err = "", pics = [];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const read = async (f) => {
    data = null; err = ""; pics = [];
    try {
      if (/\.(ocd)$/i.test(f.name)) {
        const { readOcad } = await import("./vmap/ocad.js");
        const { map } = readOcad(new Uint8Array(await f.arrayBuffer()));
        data = fromOcad(map.courseSetting);
        if (!data.courses.length && !data.controls.length) err = t("trc.imp.noOcadCourses");
        // its logos, unless this very file is the event's map (they are drawn with it)
        else if (String(E.ev.map?.file || "").toLowerCase() !== f.name.toLowerCase()) pics = await layoutPictures(map);
      } else {
        const text = await f.text();
        if (!iofKind(text)) throw new Error(t("trc.imp.notIof"));
        data = readIof(text);
      }
    } catch (e) { err = e.message || t("trc.imp.unreadable"); }
  };
  if (file) await read(file);
  const geoOk = () => hasGeo(E.ev) && data?.controls.some((c) => c.lat != null);
  const v = await modal(E, { title: t("trc.imp.title"), wide: true, ok: t("trc.imp.ok"), remember: "import-courses", body: `
    <p>${esc(t("trc.imp.intro"))}</p>
    ${dropHtml("tr-imp-drop", t("trc.imp.drop"), ".xml,.ocd", false)}
    <p class="tr-hint" id="tr-imp-what"></p>
    ${field(t("trc.imp.how"), sel("mode", [["add", t("trc.imp.add")], ["replace", t("trc.imp.replace")]], "add"))}
    ${field(t("trc.imp.place"), sel("place", [["map", t("trc.imp.placeMap")], ["geo", t("trc.imp.placeGeo")]], "map"), t("trc.imp.placeHint"))}`,
  onOpen: (f) => {
    const show = () => {
      f.querySelector("#tr-imp-what").textContent = !file ? t("trc.imp.noFile") : err ? `${t("ui.colon", { a: file.name })} ${err}` : `${file.name} — ${summary(data, pics.length)}`;
      f.elements.place.disabled = !geoOk(); if (!geoOk()) f.elements.place.value = "map";
    };
    dropZone(f.querySelector("#tr-imp-drop"), async (list) => { file = list[0]; await read(file); show(); });
    show();
  },
  validate: () => (!file ? t("trc.imp.noFile") : err || (!data ? t("trc.imp.unreadable") : null)) });
  if (!v || !data) return;
  let res;
  E.change((x) => { res = importInto(x, data, { replace: v.mode === "replace", place: v.place }); placeLayoutImages(x, pics); }, t("trc.imp.undo"));
  if (!res) return;
  const first = M.courseIds(E.ev)[0];
  if (first) E.setCourse(first);
  E.fitCourse?.();
  E.toast([t("trc.imp.done", { courses: res.courses, added: res.added, matched: res.matched }),
    res.unplaced.length ? t("trc.imp.unplaced", { list: res.unplaced.slice(0, 8).join(", ") }) : "", t("trc.imp.calageHint")].filter(Boolean).join(" "), 9000);
}
