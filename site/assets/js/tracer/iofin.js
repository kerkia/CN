// Courses brought in from other course-setting programs (the advanced level; owner, 2026-10-24, after the Condes study):
// IOF XML CourseData 3.0 and 2.0.3 (Condes, OCAD, Purple Pen, MeOS, SportSoftware…) with their classes and relay teams, an IOF
// XML ClassList (the classes alone), and the courses of an OCAD course-setting map (OCAD's parameter strings: a control per
// course-setting object, a course per « Course » string — read after OCAD's file format description, not yet checked on a
// real OCAD course-setting file). Every source becomes one shape — { controls, courses, classes, teams, scale, geo } — that
// importInto() puts into the event: controls matched by code to those already there (or added), courses added or replacing
// the event's, a course's variations as courses of their own (a CourseFamily names them), classes as data (ev.classes),
// relay teams kept with their courses' names (ev.relayTeams, written back by the IOF export).

import * as M from "./model.js";
import { hasGeo, toMm } from "./geo.js";
import { t, tn } from "./lang.js";

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

/** An OCAD course-setting map's courses (vmap/ocad.js: map.courseSetting) in the import shape, positions in the file's mm. */
export function fromOcad(cs) {
  const out = { controls: [], courses: [], classes: [], teams: [] };
  if (!cs) return out;
  const KIND = { s: "start", c: "normal", f: "finish", k: "crossing", w: "crossing" };
  for (const c of cs.controls) out.controls.push({ code: c.code, kind: c.kind, x: c.x, y: c.y });
  for (const co of cs.courses) {
    const seq = [];
    let depth = 0, branch = 0;
    for (const [k, v] of co.parts) {
      if (k === "l" || k === "r") { depth++; branch = 0; continue; }      // a variation: its first branch only
      if (k === "b" || k === "v") { branch++; continue; }
      if (k === "p" || k === "q") { depth = Math.max(0, depth - 1); continue; }
      if (depth && branch > 1) continue;
      if (KIND[k]) seq.push({ kind: KIND[k], code: v.trim(), points: 0, exchange: false });
      else if (k === "g" && seq.length) seq[seq.length - 1].exchange = true;
    }
    out.courses.push({ name: co.name, family: null, length: null, climb: num(co.climb), score: false, seq });
  }
  for (const k of cs.classes) out.classes.push({ name: k.name, course: k.course || null, est: k.runners > 0 ? k.runners : -1 });
  return out;
}

/** What the import holds, in a few words (the dialog). */
export function summary(data) {
  const ok = data.controls.filter((c) => c.code).length;
  return [tn("trc.imp.nControls", ok), tn("trc.imp.nCourses", data.courses.length), data.classes.length ? tn("trc.imp.nClasses", data.classes.length) : "",
    data.teams.length ? tn("trc.imp.nTeams", data.teams.length) : ""].filter(Boolean).join(" · ");
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
    byCode.set(c.code, id); res.added++;
  }
  // the courses, in the file's order
  const courseByName = new Map();
  for (const co of data.courses) {
    if (!co.seq.length) { res.skipped.push(co.name); continue; }
    const id = M.createCourse(ev, { name: co.name || t("trc.imp.course"), kind: co.score ? "score" : "normal", addStartFinish: false,
      climb: co.climb > 0 ? co.climb : -1, scoreColumn: co.score ? 0 : null });
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
  let file = preset, data = null, err = "";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const read = async (f) => {
    data = null; err = "";
    try {
      if (/\.(ocd)$/i.test(f.name)) {
        const { readOcad } = await import("./vmap/ocad.js");
        const { map } = readOcad(new Uint8Array(await f.arrayBuffer()));
        data = fromOcad(map.courseSetting);
        if (!data.courses.length && !data.controls.length) err = t("trc.imp.noOcadCourses");
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
      f.querySelector("#tr-imp-what").textContent = !file ? t("trc.imp.noFile") : err ? `${file.name} : ${err}` : `${file.name} — ${summary(data)}`;
      f.elements.place.disabled = !geoOk(); if (!geoOk()) f.elements.place.value = "map";
    };
    dropZone(f.querySelector("#tr-imp-drop"), async (list) => { file = list[0]; await read(file); show(); });
    show();
  },
  validate: () => (!file ? t("trc.imp.noFile") : err || (!data ? t("trc.imp.unreadable") : null)) });
  if (!v || !data) return;
  let res;
  E.change((x) => { res = importInto(x, data, { replace: v.mode === "replace", place: v.place }); }, t("trc.imp.undo"));
  if (!res) return;
  const first = M.courseIds(E.ev)[0];
  if (first) E.setCourse(first);
  E.fitCourse?.();
  E.toast([t("trc.imp.done", { courses: res.courses, added: res.added, matched: res.matched }),
    res.unplaced.length ? t("trc.imp.unplaced", { list: res.unplaced.slice(0, 8).join(", ") }) : "", t("trc.imp.calageHint")].filter(Boolean).join(" "), 9000);
}
