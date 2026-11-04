// Courses as circuits of a map analysis: each course (each variation of a forked one) its map with the course printed on it, the
// controls' positions on that image and the georeference. The Tracer's « Publier vers l'analyse de carte » (race.js) and the
// organisers' « Importer un fichier OCAD » of an analysis (pages/shared.js; owner, 2026-11-04: an OCAD course-setting file holds
// the map and every course, one file for every circuit) share it.
import * as M from "./model.js";
import { courseImage } from "./exports.js";

export const MAX = 12;                                    // the analyses' API takes 12 circuits

/** The event's courses, each variation of a forked course apart: [{ cd, name, id }]. */
export function designs(ev) {
  const des = [];
  for (const id of M.courseIds(ev, false)) {
    if (M.hasVariations(ev, id)) for (const x of M.allVariations(ev, id)) des.push({ cd: M.cdCourse(id, -1, x.path), name: `${ev.courses[id].name} ${x.code}`, id });
    else des.push({ cd: M.cdCourse(id), name: ev.courses[id].name, id });
  }
  return des;
}

/** A design's controls (the start and finish apart). */
export const controlCount = (ev, d) => M.ccIds(ev, d.cd).filter((cc) => ev.controls[ev.courseControls[cc].control]?.kind === "normal").length;

/** One course as a circuit: { blob (PNG), w, h, geo (lon, lat) -> px, r (px), controls [{ kind, code, x, y }] }. */
export async function circuitOf(E, d, dpi) {
  const ev = E.ev;
  const { canvas, box, pxPerMm: k } = await courseImage(E, d.cd, dpi, { withMap: true });
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  const g = ev.geo, geo = { a: g.a * k, b: g.b * k, c: (g.c - box[0]) * k, d: -g.d * k, e: -g.e * k, f: (box[3] - g.f) * k };
  const r = M.controlRadius(ev) * M.objRatio(ev, ev.courses[d.id].printScale) * k;
  const controls = M.ccIds(ev, d.cd).map((cc) => ev.controls[ev.courseControls[cc].control]).filter((c) => ["start", "normal", "finish"].includes(c.kind))
    .map((c) => ({ kind: c.kind === "normal" ? "control" : c.kind, code: c.code || "", x: Math.round((c.x - box[0]) * k * 10) / 10, y: Math.round((box[3] - c.y) * k * 10) / 10 }));
  return { blob, w: canvas.width, h: canvas.height, geo, r: Math.round(r * 10) / 10, controls };
}

const fail = (code) => Object.assign(new Error(code), { code });

/**
 * An OCAD course-setting project read as an event in memory, ready for circuitOf: { E, designs, info }. files: what was dropped. The
 * courses file is the OCAD file whose course setting has courses; it holds its map itself, or names it as its first OCAD or Mapper
 * template (OCAD's course setting draws the courses over a background map file: « …P.ocd » over « …F.ocd »), the two in the same
 * OCAD coordinates, as the Tracer takes them (pages/tracer.js ocadCourses). Throws { code }: "unreadable" (no OCAD or Mapper map),
 * "noCourses" (maps only: Mapper files, OCAD maps not made for course setting), "needMap" (the background map not given yet;
 * { name } its file's name), "noGeo" (no georeference in either file: an analysis needs one).
 */
export async function readCourseFiles(files) {
  const { openMap, mimeOf } = await import("./mapsrc.js");
  const open = async (f) => { const bytes = new Uint8Array(await f.arrayBuffer()); return openMap(bytes, mimeOf(f.name, f.type), f.name).catch(() => null); };
  const vec = files.filter((f) => /\.(ocd|omap|xmap)$/i.test(f.name));
  const read = [];
  for (const f of vec) { const src = await open(f); if (src?.kind === "vector") read.push({ f, src }); }
  if (!read.length) throw fail("unreadable");
  const course = read.find((x) => x.src.vmap.courseSetting?.courses?.length);
  if (!course) throw fail("noCourses");
  const base = (n) => String(n || "").split(/[\\/]/).pop().toLowerCase();
  let map = course;
  if (!(course.src.vmap.mapObjects > 0)) {
    const tpl = (course.src.vmap.templates || []).find((x) => /\.(ocd|omap|xmap)$/i.test(x.file));
    map = read.find((x) => x !== course && tpl && base(x.f.name) === base(tpl.file)) || read.find((x) => x !== course);
    if (!map) throw Object.assign(fail("needMap"), { name: tpl ? tpl.file.split(/[\\/]/).pop() : "" });
  }
  const { fromOcad, importInto } = await import("./iofin.js");
  const data = fromOcad(course.src.vmap.courseSetting);
  const src = map.src;
  const ev = M.newEvent({ title: course.f.name, map: { kind: "ocad", file: map.f.name, w: src.w, h: src.h, ox: src.ox, oy: src.oy, scale: src.scale } });
  importInto(ev, data, { fileMm: true });                 // the courses' file mm, in the map's frame
  const geoOf = async (s) => (await import("./vmap/georef.js")).geoFromVector(s.vmap, s).catch(() => null);
  let g = await geoOf(src);
  if (!g && map !== course) {                              // the courses file's own grid, the map's frame being the same coordinates
    const c = course.src, gc = await geoOf({ ...c, ox: src.ox, oy: src.oy, w: src.w, h: src.h });
    if (gc) g = gc;
  }
  if (!g) throw fail("noGeo");
  ev.geo = g.geo;
  await (await import("./fonts.js")).loadFonts().catch(() => {});   // the controls' numbers in the Tracer's own font
  const E = { ev, map: src };
  return { E, designs: designs(ev), info: { format: src.format, version: src.version, scale: src.scale, geo: g.name, courses: course.f.name, map: map.f.name } };
}
