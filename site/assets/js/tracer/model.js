// The Tracer's event model (Organisation › Tracer): a course-setting event shaped as Purple Pen's (.ppen) so that a
// .ppen file comes in and goes out without loss — the event, its controls (the « Tous les postes » collection), its
// courses, each a linked list of course controls (forks and loops as Purple Pen's splits), the legs that carry bends,
// gaps or flagging, and the special objects (descriptions, texts, out-of-bounds areas…). Coordinates are Purple Pen's:
// millimetres on the map sheet at the map's scale, origin at the sheet's bottom left, y up. The rules (numbering, parts
// between map exchanges, variations, lengths, loads, insertion of a control) follow Purple Pen's QueryEvent,
// CourseView and ChangeEvent (BSD licence, assets/tracer/LICENSE-PurplePen.txt).
//
// The event is plain data (JSON): `ev.controls`, `ev.courses`, `ev.courseControls`, `ev.legs`, `ev.specials` map ids to
// objects; `ev.next` holds the last id of each. The functions below read it (queries) or change it in place (changes);
// the editor snapshots it for undo.

export const VERSION = 1;

// ---- geometry, in map millimetres --------------------------------------------------------------------------------
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const samePt = (a, b) => Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
export function pathLength(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
/** The point at a length along a polyline (clamped to its ends). */
export function pointAt(pts, len) {
  if (len <= 0) return pts[0].slice();
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (len <= d && d > 0) { const f = len / d; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; }
    len -= d;
  }
  return pts[pts.length - 1].slice();
}
/** The closest point of a polyline to p: { d, at, len (along the line), seg }. */
export function nearest(pts, p) {
  let best = { d: Infinity, at: pts[0], len: 0, seg: 0 }, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t], d = dist(p, q);
    if (d < best.d) best = { d, at: q, len: acc + Math.sqrt(L2) * t, seg: i - 1 };
    acc += Math.sqrt(L2);
  }
  return best;
}
/** Insert a point into a polyline at the segment closest to it (Purple Pen's Util.AddPointToArray). */
export function insertPoint(pts, p) {
  const { seg } = nearest(pts, p);
  return [...pts.slice(0, seg + 1), p, ...pts.slice(seg + 1)];
}
/** The angle of a vector in degrees (counter-clockwise from +x, y up). */
export const angleDeg = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;

// ---- standards and sizes (Purple Pen's NormalCourseAppearance) ----------------------------------------------------
export const LINE = 0.35;                                  // mm: legs, circles, triangle
export const SIZES = {
  "2000": { control: 6.0, finishOut: 7.0, finishIn: 5.0, start: 4.04 },
  "2017": { control: 5.35, finishOut: 6.35, finishIn: 4.35, start: 3.46 },
  "Spr2019": { control: 6.35, finishOut: 7.35, finishIn: 5.35, start: 4.04 },
};
export const CROSSING_RADIUS = 2.5, ISSUE_LENGTH = 2.5, ISSUE_WIDTH = 0.6;
export const NUMBER_HEIGHT = 4.0, NUMBER_DISTANCE = 1.825, CODE_DISTANCE = 0.325, CODE_HEIGHT = 3.0;
export const PURPLE = [0.35, 0.85, 0, 0];                  // CMYK, ISOM 2017 appendix
export const sizes = (ev) => SIZES[ev.appearance.mapStandard] || SIZES["2017"];

/** Ratio of course objects' size to the map: Purple Pen's CourseView.CourseObjRatio. */
export function objRatio(ev, printScale) {
  const a = ev.appearance, ms = ev.map.scale || 10000;
  if (a.itemScaling === "RelativeToMap") return 1;
  if (a.itemScaling === "RelativeTo15000") return 15000 / ms;
  const r = (printScale || ms) / ms;
  return r > 0.99999 && r < 1.00001 ? 1 : r;
}
/** The scale circle gaps are stored at (CourseView.CircleGapScale). */
export function gapScale(ev, printScale) {
  const a = ev.appearance;
  if (a.itemScaling === "RelativeToMap") return ev.map.scale;
  if (a.itemScaling === "RelativeTo15000") return 15000;
  return printScale || ev.map.scale;
}
export const controlRadius = (ev) => (sizes(ev).control * ev.appearance.controlCircleSize) / 2;
export const finishRadius = (ev) => (sizes(ev).finishOut * ev.appearance.controlCircleSize) / 2;
export const startRadius = (ev) => sizes(ev).start * ev.appearance.controlCircleSize;

// ---- a new event ---------------------------------------------------------------------------------------------------
export const DEFAULT_APPEARANCE = {
  controlCircleSize: 1, lineWidth: 1, numberHeight: 1, centerDot: 0, numberBold: false, numberFont: "Roboto",
  numberOutline: 0, autoLegGap: 3.5, blend: "blend", lowerPurpleLayer: 0, purple: null /* [c,m,y,k] in 0..1, null = default */,
  descriptionsPurple: false, ocadOverprint: false, mapStandard: "2017", itemScaling: "RelativeTo15000",
};
export const DEFAULT_PRINT_AREA = () => ({ auto: true, restrict: true, rect: null, pageW: 827, pageH: 1169, margins: 0, landscape: false });

/** A new event. map: { kind: "bitmap"|"pdf"|"ocad"|"none", file, scale, dpi (bitmap), w, h (mm of the sheet), ox, oy (ocad) }. */
export function newEvent({ title = "", map = { kind: "none", scale: 10000 }, standard = "2017", descStandard = "2018", lang = "fr", firstCode = 31 } = {}) {
  return {
    v: VERSION, title, notes: "",
    map: { kind: map.kind || "none", file: map.file || "", scale: map.scale || 10000, dpi: map.dpi || 0, w: map.w || 0, h: map.h || 0,
      ...(map.kind === "ocad" ? { ox: map.ox || 0, oy: map.oy || 0 } : {}) },
    descStandard, lang, allControls: { printScale: map.scale || 10000, descKind: "symbols" }, printArea: DEFAULT_PRINT_AREA(),
    numbering: { start: firstCode, noInvertible: true }, punchCard: { rows: 3, cols: 8, ltr: true, ttb: false },
    appearance: { ...DEFAULT_APPEARANCE, mapStandard: standard }, customText: {}, customKey: {}, livelox: null,
    controls: {}, courses: {}, courseControls: {}, legs: {}, specials: {},
    next: { control: 0, course: 0, courseControl: 0, leg: 0, special: 0 },
  };
}
const STORE = { control: "controls", course: "courses", courseControl: "courseControls", leg: "legs", special: "specials" };
export function addObj(ev, kind, obj) {
  const id = ++ev.next[kind];
  ev[STORE[kind]][id] = obj;
  return id;
}
export const clone = (ev) => JSON.parse(JSON.stringify(ev));

// ---- control codes (QueryEvent) -----------------------------------------------------------------------------------
const UPSIDE_DOWN = new Set([61, 66, 68, 81, 86, 89, 98, 99, 106, 108, 109, 116, 118, 119, 161, 166, 168, 169, 186, 188, 189, 191, 196, 198,
  199, 601, 606, 608, 611, 616, 618, 661, 666, 668, 669, 681, 686, 688, 691, 696, 698, 699, 801, 806, 809, 811, 816, 819, 861, 866, 868, 869,
  881, 886, 889, 891, 896, 898, 899, 901, 908, 909, 911, 918, 919, 961, 966, 968, 969, 981, 988, 989, 991, 996, 998, 999]);
/** "" if the code is fine, else why not ("length", "space": illegal; "zero", "upside": legal, not preferred). */
export function codeProblem(ev, code) {
  if (!code || code.length > 3) return "length";
  if (/\s/.test(code)) return "space";
  if (/^\d+$/.test(code)) {
    if (code[0] === "0") return "zero";
    if (ev.numbering.noInvertible && UPSIDE_DOWN.has(Number(code))) return "upside";
  }
  return "";
}
export const findCode = (ev, code) => { for (const [id, c] of Object.entries(ev.controls)) if (c.code === code) return Number(id); return 0; };
export function nextCode(ev) {
  let n = ev.numbering.start || 31, wrapped = false;
  for (;;) {
    const code = String(n);
    if (!findCode(ev, code) && !codeProblem(ev, code)) return code;
    if (++n === 1000) { if (wrapped) return "XX"; wrapped = true; n = 31; }
  }
}
/** Codes in Purple Pen's order: numbers numerically, then text. */
export function compareCodes(a, b) {
  a = a ?? ""; b = b ?? "";
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
const KIND_ORDER = { "map-issue": 1, start: 2, "map-exchange": 3, normal: 4, finish: 5, crossing: 6 };
export function compareControls(ev, id1, id2) {
  const a = ev.controls[id1], b = ev.controls[id2];
  return (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || compareCodes(a.code, b.code) || id1 - id2;
}

// ---- courses -------------------------------------------------------------------------------------------------------
/** Course ids by their order (the course tabs). */
export function courseIds(ev, includeHidden = true) {
  return Object.keys(ev.courses).map(Number).filter((id) => includeHidden || !ev.courses[id].hideFromReports)
    .sort((a, b) => ev.courses[a].order - ev.courses[b].order);
}
export const isScore = (ev, courseId) => ev.courses[courseId]?.kind === "score";
export const cdAll = () => ({ course: 0, part: -1, path: null });           // « Tous les postes »
export const cdCourse = (course, part = -1, path = null, extra = {}) => ({ course, part, path, ...extra });

/**
 * The course controls of a course designator, in order, with the share of variations that visit each
 * (QueryEvent.EnumCourseControlIdsWithPercent). cd: { course, part (-1 all), path (variation choices or null) }.
 */
export function enumCC(ev, cd) {
  const course = ev.courses[cd.course];
  if (!course) return [];
  return enumToJoin(ev, cd, course.first || 0, 0, cd.path ? cd.path.slice() : null, false, { part: 0 }, 1);
}
function enumToJoin(ev, cd, start, join, choices, ignoreFirstSplit, state, frac) {
  const out = [];
  let id = start, first = true, guard = 0;
  while (id && id !== join && guard++ < 10000) {
    let cc = ev.courseControls[id];
    if (!cc) break;
    if (cc.split && !(first && ignoreFirstSplit)) {
      if (choices && choices.length) {
        id = choices.shift();
        cc = ev.courseControls[id];
      } else {
        const nf = cc.loop ? frac : frac / cc.splitCCs.length;
        for (const s of cc.splitCCs) if (s !== id) out.push(...enumToJoin(ev, cd, s, cc.splitEnd, choices, true, state, nf));
        if (!cc.loop) {
          out.push(...enumToJoin(ev, cd, id, cc.splitEnd, choices, true, state, nf));
          id = cc.splitEnd;
          if (!id || id === join) break;
          first = false;
          continue;
        }
      }
    }
    if (cd.part < 0 || state.part === cd.part) out.push({ cc: id, frac });
    if (cc.exchange) {
      state.part++;
      if (cd.part >= 0 && state.part === cd.part) out.push({ cc: id, frac });
    }
    id = cc.next || 0;
    first = false;
  }
  return out;
}
export const ccIds = (ev, cd) => enumCC(ev, cd).map((x) => x.cc);
export const ctrlOf = (ev, ccId) => ev.controls[ev.courseControls[ccId]?.control];
export const kindOfCC = (ev, ccId) => ctrlOf(ev, ccId)?.kind;

export function hasVariations(ev, courseId) {
  const c = ev.courses[courseId];
  if (!c || c.kind === "score") return false;
  return ccIds(ev, cdCourse(courseId)).some((id) => ev.courseControls[id].split);
}
/** The letter of each branch (QueryEvent.GetVariantCodeMapping): the loop's way out gets none. */
export function variantLetters(ev, courseId) {
  const map = new Map();
  let code = 65;
  for (const id of ccIds(ev, cdCourse(courseId))) {
    const cc = ev.courseControls[id];
    if (!cc.split) continue;
    cc.splitCCs.forEach((s, i) => {
      if (cc.loop && i === 0) return;
      if (!map.has(s)) { map.set(s, String.fromCharCode(code)); code = code === 90 ? 97 : code + 1; }
    });
  }
  return map;
}
/** Every variation of a course: [{ code: "ACE", path: [ccIds] }], sorted by code (QueryEvent.GetAllVariations). */
export function allVariations(ev, courseId) {
  const letters = variantLetters(ev, courseId), visited = new Set();
  const vars = variationsFrom(ev, ev.courses[courseId].first || 0, visited);
  if (vars.length === 1 && !vars[0].length) return [];
  return vars.map((path) => ({ code: path.map((s) => letters.get(s) || "").join(""), path }))
    .sort((a, b) => a.code.localeCompare(b.code, "en", { sensitivity: "base" }));
}
function variationsFrom(ev, start, visited) {
  const out = [];
  let id = start, guard = 0;
  while (id && guard++ < 10000) {
    const cc = ev.courseControls[id];
    if (cc.split) {
      let allLoops = true;
      if (cc.loop) for (let i = 1; i < cc.splitCCs.length; i++) if (!visited.has(cc.splitCCs[i])) allLoops = false;
      for (let i = allLoops ? 0 : 1; i < cc.splitCCs.length; i++) {
        const s = cc.splitCCs[i], after = ev.courseControls[s].next;
        if (after && !visited.has(s)) {
          visited.add(s);
          for (const tail of variationsFrom(ev, after, visited)) out.push([s, ...tail]);
          visited.delete(s);
        }
      }
      break;
    }
    id = cc.next || 0;
  }
  if (!out.length) out.push([]);
  return out;
}
export function countParts(ev, cd) {
  if (!cd.course) return 1;
  const all = { ...cd, part: -1 };
  if (hasVariations(ev, cd.course) && !cd.path) return 1;
  let parts = 0;
  for (const id of ccIds(ev, all)) if (ev.courseControls[id].exchange) parts++;
  return parts + 1;
}
export function partOptions(ev, cd) {
  const c = ev.courses[cd.course];
  const o = { showFinish: false, ...(c?.partOptions?.[cd.part] || {}) };
  if (cd.part === countParts(ev, cd) - 1) o.showFinish = true;
  return o;
}
/** The first and last course controls of a part (inclusive). */
export function partBounds(ev, cd) {
  const ids = ccIds(ev, cd);
  return ids.length ? [ids[0], ids[ids.length - 1]] : [0, 0];
}
export function findKind(ev, courseId, kind) {
  for (const id of ccIds(ev, cdCourse(courseId))) if (kindOfCC(ev, id) === kind) return id;
  return 0;
}
export function lastCC(ev, courseId, notFinish) {
  let last = 0;
  for (const id of ccIds(ev, cdCourse(courseId))) if (!notFinish || kindOfCC(ev, id) !== "finish") last = id;
  return last;
}
export const hasFinish = (ev, courseId) => { const l = lastCC(ev, courseId, false); return !!l && kindOfCC(ev, l) === "finish"; };

// ---- legs ----------------------------------------------------------------------------------------------------------
export function findLeg(ev, c1, c2) {
  for (const [id, l] of Object.entries(ev.legs)) if (l.c1 === c1 && l.c2 === c2) return Number(id);
  return 0;
}
/** The leg's points: the two controls and its bends (QueryEvent.GetLegPath). */
export function legPoints(ev, c1, c2) {
  const a = ev.controls[c1], b = ev.controls[c2], leg = ev.legs[findLeg(ev, c1, c2)];
  return [[a.x, a.y], ...(leg?.bends || []), [b.x, b.y]];
}
export const legLengthM = (ev, c1, c2) => pathLength(legPoints(ev, c1, c2)) * ev.map.scale / 1000;
export const mmToM = (ev, mm) => mm * ev.map.scale / 1000;
/** The leg's flagging (QueryEvent.GetLegFlagging): "none", "all", "begin", "end", "issue-middle". */
export function legFlagging(ev, c1, c2) {
  const leg = ev.legs[findLeg(ev, c1, c2)];
  let f = leg?.flagging || "none";
  const a = ev.controls[c1], b = ev.controls[c2];
  if (b.kind === "finish" && b.symbols?.[0] === "14.1") f = "all";
  if (b.kind === "map-exchange") f = "all";
  if (a.kind === "map-issue") f = "all";
  return f;
}
/** The length of a leg's flagged part in metres (QueryEvent.ComputeFlaggedLegLength). */
export function flaggedLengthM(ev, c1, c2) {
  const leg = ev.legs[findLeg(ev, c1, c2)], pts = legPoints(ev, c1, c2);
  if (!leg?.bends) return mmToM(ev, pathLength(pts));
  let i0 = 0, i1 = pts.length - 1;
  const k = pts.findIndex((p) => leg.flag && samePt(p, leg.flag));
  if (leg.flagging === "begin" && k >= 0) i1 = k;
  if (leg.flagging === "end" && k >= 0) i0 = k;
  return mmToM(ev, pathLength(pts.slice(i0, i1 + 1)));
}
/** The legs of a course designator: [{ cc1, cc2, frac }] (QueryEvent.EnumLegs). */
export function enumLegs(ev, cd) {
  if (!cd.course || isScore(ev, cd.course)) return [];
  const out = [];
  enumCC(ev, cd).forEach(({ cc, frac }, i) => {
    const c = ev.courseControls[cc];
    if (i === 0 || cd.part < 0 || !c.exchange) if (c.next) out.push({ cc1: cc, cc2: c.next, frac });
  });
  return out;
}

// ---- the course view (CourseView): what a course shows and its statistics -------------------------------------------
/**
 * The view of a course designator: { kind: "normal"|"all"|"score"|"variations", name, controls: [{ ordinal (0 start,
 * -1 none), control, ccs, legTo (indices), legLen (m), join, hidden, exchangeStart }], specials, descriptions, extra,
 * printScale, scoreColumn, lengths and counts }. Purple Pen's rules: a normal course numbers its normal controls from its
 * first control number; a part keeps the numbers of the whole course; « Tous les postes » sorts by kind then code; a
 * score course by kind, points and code.
 */
export function view(ev, cd, { specials = true, descriptions = true } = {}) {
  let v;
  if (!cd.course) v = allControlsView(ev);
  else if (isScore(ev, cd.course)) v = scoreView(ev, cd);
  else if (hasVariations(ev, cd.course) && !cd.path) v = allVariationsView(ev, cd);
  else v = standardView(ev, cd);
  finishView(ev, cd, v);
  for (const [sid, sp] of Object.entries(ev.specials)) {
    const id = Number(sid);
    if (!containsSpecial(ev, cd, id)) continue;
    if (sp.kind === "descriptions") { if (descriptions) v.descriptions.push(id); }
    else if (specials) v.specials.push(id);
  }
  return v;
}
const blankView = (kind, name) => ({ kind, name, controls: [], specials: [], descriptions: [], extra: [], scoreColumn: -1 });
function allControlsView(ev) {
  const v = blankView("all", "");
  const ids = Object.keys(ev.controls).map(Number).sort((a, b) => compareControls(ev, a, b));
  for (const id of ids) v.controls.push({ ordinal: -1, control: id, ccs: [0], legTo: null, join: -1 });
  return v;
}
function standardView(ev, cd) {
  const course = ev.courses[cd.course];
  const v = blankView("normal", course.name);
  let ordinal = course.firstNumber || 1;
  const all = ccIds(ev, { ...cd, part: -1 });
  let first, last = 0;
  if (cd.part < 0) first = all[0] || 0;
  else [first, last] = partBounds(ev, cd);
  let i = 0;
  while (i < all.length && all[i] !== first) { if (kindOfCC(ev, all[i]) === "normal") ordinal++; i++; }
  for (; i < all.length; i++) {
    const id = all[i], cc = ev.courseControls[id], ctrl = ev.controls[cc.control];
    const cv = { ordinal: ctrl.kind === "normal" ? ordinal++ : ctrl.kind === "start" || ctrl.kind === "map-exchange" ? 0 : -1,
      control: cc.control, ccs: [id], legTo: null, join: -1 };
    if (id === last && cd.part >= 0 && ctrl.kind === "map-exchange") cv.hidden = true;
    if (cc.exchange && id !== last) cv.exchangeStart = true;
    if (i < all.length - 1 && id !== last) cv.legTo = [all[i + 1]];
    v.controls.push(cv);
    if (id === last) break;
  }
  if (cd.part >= 0 && cd.part !== countParts(ev, cd) - 1 && partOptions(ev, cd).showFinish && hasFinish(ev, cd.course))
    v.extra.push(lastCC(ev, cd.course, false));
  return v;
}
function allVariationsView(ev, cd) {
  const course = ev.courses[cd.course];
  const v = blankView("variations", course.name);
  for (const id of ccIds(ev, cd)) {
    const cc = ev.courseControls[id];
    if (cc.split && v.controls.some((x) => x.ccs.includes(id))) continue;
    const cv = { ordinal: -1, control: cc.control, ccs: cc.split ? cc.splitCCs.slice() : [id], legTo: null, join: -1 };
    if (cc.split) {
      if (cc.next) cv.legTo = cv.ccs.map((s) => ev.courseControls[s].next);
      cv.join = cc.loop ? id : cc.splitEnd;
    } else if (cc.next) cv.legTo = [cc.next];
    if (cc.exchange) cv.exchangeStart = true;
    v.controls.push(cv);
  }
  return v;
}
function scoreView(ev, cd) {
  const course = ev.courses[cd.course];
  const v = blankView("score", course.name);
  v.scoreColumn = course.scoreColumn ?? 0;
  let id = course.first || 0, guard = 0;
  while (id && guard++ < 10000) {
    const cc = ev.courseControls[id];
    v.controls.push({ ordinal: -1, control: cc.control, ccs: [id], legTo: null, join: -1 });
    id = cc.next || 0;
  }
  v.controls.sort((a, b) => {
    const ka = KIND_ORDER[ev.controls[a.control].kind], kb = KIND_ORDER[ev.controls[b.control].kind];
    if (ka !== kb) return ka - kb;
    const pa = ev.courseControls[a.ccs[0]].points || 0, pb = ev.courseControls[b.ccs[0]].points || 0;
    if (pa !== pb) return pa - pb;
    return compareCodes(ev.controls[a.control].code, ev.controls[b.control].code) || a.control - b.control;
  });
  const showOrdinals = v.scoreColumn !== 0 && ["sequence", "sequence-and-code", "sequence-and-score"].includes(course.labels);
  if (showOrdinals) {
    let n = course.firstNumber || 1;
    for (const c of v.controls) if (ev.controls[c.control].kind === "normal") c.ordinal = n++;
  }
  if (v.controls.length >= 2 && ev.controls[v.controls[0].control].kind === "map-issue" && ev.controls[v.controls[1].control].kind === "start")
    v.controls[0].legTo = [v.controls[1].ccs[0]];
  return v;
}
function finishView(ev, cd, v) {
  v.mapScale = ev.map.scale;
  v.printScale = cd.course ? ev.courses[cd.course].printScale : ev.allControls.printScale;
  // legTo: course control ids -> indices; leg lengths
  for (const cv of v.controls) {
    if (!cv.legTo) continue;
    cv.legLen = [];
    cv.legTo = cv.legTo.map((ccId) => {
      const j = v.controls.findIndex((x) => x.ccs.includes(ccId));
      cv.legLen.push(j >= 0 ? legLengthM(ev, cv.control, v.controls[j].control) : 0);
      return j;
    });
    if (cv.join > 0) cv.join = v.controls.findIndex((x) => x.ccs.includes(cv.join));
  }
  // statistics
  const course = cd.course ? ev.courses[cd.course] : null;
  v.climb = course ? course.climb : -1;
  let points = 0, normal = 0, len = 0;
  for (const cv of v.controls) {
    if (ev.controls[cv.control].kind === "normal") normal++;
    if (cv.ccs[0] && ev.controls[cv.control].kind === "normal") points += ev.courseControls[cv.ccs[0]].points || 0;
    if (cv.legTo?.length) len += cv.legLen[0];
  }
  v.points = points; v.normalControls = normal; v.partLength = len;
  if (!cd.course || cd.part < 0 && !(hasVariations(ev, cd.course) && !cd.path)) v.minLength = v.maxLength = len;
  else if (hasVariations(ev, cd.course) && !cd.path) {
    const vars = allVariations(ev, cd.course).map((x) => view(ev, cdCourse(cd.course, -1, x.path), { specials: false, descriptions: false }));
    v.minLength = Math.min(...vars.map((x) => x.minLength)); v.maxLength = v.partLength = Math.max(...vars.map((x) => x.maxLength));
    v.minNormal = Math.min(...vars.map((x) => x.normalControls)); v.maxNormal = Math.max(...vars.map((x) => x.normalControls));
  } else {
    const whole = view(ev, { ...cd, part: -1 }, { specials: false, descriptions: false });
    v.minLength = whole.minLength; v.maxLength = whole.maxLength;
  }
  if (v.minNormal == null) v.minNormal = v.maxNormal = normal;
  v.totalMin = course?.length != null ? course.length * 1000 : v.minLength;
  v.totalMax = course?.length != null ? course.length * 1000 : v.maxLength;
}
/** The view's next control index from an index (the first branch of a split), or -1. */
export const nextIndex = (v, i) => (v.controls[i]?.legTo?.length ? v.controls[i].legTo[0] : -1);

// ---- specials -----------------------------------------------------------------------------------------------------
/** Does a course designator show a special (QueryEvent.CourseContainsSpecial)? */
export function containsSpecial(ev, cd, sid) {
  const sp = ev.specials[sid];
  if (!sp) return false;
  if (sp.all) return true;
  const course = cd.course || 0, part = cd.part ?? -1;
  if (part < 0 && sp.kind !== "descriptions") return sp.courses.some((x) => x.course === course);
  return sp.courses.some((x) => x.course === course && ((x.part ?? -1) === part || (x.part ?? -1) < 0));
}

// ---- uses and loads --------------------------------------------------------------------------------------------------
export const courseUses = (ev, cd, controlId) => ccIds(ev, cd).some((id) => ev.courseControls[id].control === controlId);
export const coursesUsing = (ev, controlId, includeHidden = true) => courseIds(ev, includeHidden).filter((c) => courseUses(ev, cdCourse(c), controlId));
export const coursesUsingLeg = (ev, c1, c2, includeHidden = true) => courseIds(ev, includeHidden).filter((c) =>
  enumLegs(ev, cdCourse(c)).some((l) => ev.courseControls[l.cc1].control === c1 && ev.courseControls[l.cc2].control === c2));
/** Competitors through a control (QueryEvent.GetControlLoad), or -1 when no course using it has a load. */
export function controlLoad(ev, controlId) {
  let any = false, total = 0;
  for (const c of coursesUsing(ev, controlId, false)) {
    const load = ev.courses[c].load;
    if (load == null || load < 0) continue;
    any = true;
    if (hasVariations(ev, c)) {
      let f = 0;
      for (const x of enumCC(ev, cdCourse(c))) {
        const cc = ev.courseControls[x.cc];
        if (cc.control !== controlId) continue;
        f = Math.max(f, cc.split && !cc.loop ? x.frac * cc.splitCCs.length : x.frac);
      }
      total += Math.ceil(f * load);
    } else total += load;
  }
  return any ? total : -1;
}
export function legLoad(ev, c1, c2) {
  let any = false, total = 0;
  for (const c of coursesUsingLeg(ev, c1, c2, false)) {
    const load = ev.courses[c].load;
    if (load == null || load < 0) continue;
    any = true;
    if (hasVariations(ev, c)) {
      let f = 0;
      for (const l of enumLegs(ev, cdCourse(c))) if (ev.courseControls[l.cc1].control === c1 && ev.courseControls[l.cc2].control === c2) f = Math.max(f, l.frac);
      total += Math.ceil(f * load);
    } else total += load;
  }
  return any ? total : -1;
}
export function unusedControls(ev, includeHidden = true) {
  return Object.keys(ev.controls).map(Number).filter((id) => !coursesUsing(ev, id, includeHidden).length);
}

// ---- insertion point of a new control (QueryEvent.FindControlInsertionPoint) -----------------------------------------
/** Where a control goes: after cc1 / before cc2 (either may be 0); returns { cc1, cc2, loc: "normal"|"presplit"|"postjoin" }. */
export function insertionPoint(ev, cd, cc1 = 0, cc2 = 0) {
  const courseId = cd.course;
  let loc = "normal";
  if (cc1 && cc2) {
    const a = ev.courseControls[cc1];
    if (a.next !== cc2) {
      if (isScore(ev, courseId)) return insertionPoint(ev, cd, cc1, 0);
      cc2 = a.next;
    }
  } else {
    if (!cc1 || kindOfCC(ev, cc1) === "finish") cc1 = lastCC(ev, courseId, true);
    if (!cc1) { cc2 = ev.courses[courseId].first || 0; loc = "normal"; }
    else {
      const before = ev.courseControls[cc1];
      cc2 = before.next || 0;
      loc = before.split && !before.loop ? "presplit" : "normal";
    }
  }
  if (cc1 && cc2 && kindOfCC(ev, cc1) === "map-issue" && kindOfCC(ev, cc2) === "start") return insertionPoint(ev, cd, cc2, 0);
  return { cc1, cc2, loc };
}

// ---- changes (ChangeEvent) ---------------------------------------------------------------------------------------------
/** A new control point (not in any course). kind: "normal", "start", "finish", "crossing", "map-issue", "map-exchange". */
export function addControl(ev, kind, pt, { code = null, orientation = 0, issueKind = "beginning" } = {}) {
  const c = { kind, code: kind === "normal" ? (code || nextCode(ev)) : null, x: pt[0], y: pt[1],
    symbols: ["normal", "start", "map-exchange"].includes(kind) ? [null, null, null, null, null, null] : [null], colF: null };
  if (kind === "finish") c.symbols[0] = "14.3";
  if (kind === "crossing") { c.orientation = orientation; c.stretch = 0; c.symbols[0] = "13.3"; }
  if (kind === "map-issue") c.issueKind = issueKind;
  return addObj(ev, "control", c);
}
const newCC = (control, next = 0) => ({ control, next });
/** Put a control into a course after cc1 / before cc2 at loc (from insertionPoint). Returns the new course control. */
export function addCourseControl(ev, controlId, courseId, cc1, cc2, loc = "normal") {
  if (!cc1) {
    const course = ev.courses[courseId];
    const id = addObj(ev, "courseControl", newCC(controlId, course.first || 0));
    course.first = id;
    return id;
  }
  if (loc === "presplit") {
    const before = ev.courseControls[cc1], ids = before.splitCCs.slice(), idx = ids.indexOf(cc1);
    const fresh = ids.map((s) => addObj(ev, "courseControl", newCC(controlId, ev.courseControls[s].next || 0)));
    for (const f of fresh) Object.assign(ev.courseControls[f], { split: true, loop: !!before.loop, splitCCs: fresh.slice(), splitEnd: before.splitEnd });
    const head = ev.courseControls[ids[0]];
    Object.assign(head, { split: false, loop: false, next: fresh[0] });
    delete head.splitCCs; delete head.splitEnd;
    for (let i = 1; i < ids.length; i++) { repoint(ev, courseId, ids[i], ids[0]); delete ev.courseControls[ids[i]]; }
    return fresh[idx];
  }
  const before = ev.courseControls[cc1];
  const id = addObj(ev, "courseControl", newCC(controlId, before.next || 0));
  before.next = id;
  if (loc === "postjoin") repoint(ev, courseId, cc2, id);
  return id;
}
/** Course controls of a course pointing (next / splitEnd) to idOld point to idNew instead. */
function repoint(ev, courseId, idOld, idNew) {
  for (const id of ccIds(ev, cdCourse(courseId))) {
    const cc = ev.courseControls[id];
    if (id === idNew) continue;
    if (cc.next === idOld) cc.next = idNew;
    if (cc.splitEnd === idOld) cc.splitEnd = idNew;
  }
}
/** A start or map issue point at the head of a course (replacing one already there); « others »: in every course lacking one. */
export function addStartOrIssue(ev, controlId, courseId, others = false) {
  const kind = ev.controls[controlId].kind;
  const existing = findKind(ev, courseId, kind);
  let id;
  if (existing) { ev.courseControls[existing].control = controlId; id = existing; }
  else if (kind === "start" && findKind(ev, courseId, "map-issue")) {
    const p = insertionPoint(ev, cdCourse(courseId), findKind(ev, courseId, "map-issue"), 0);
    id = addCourseControl(ev, controlId, courseId, p.cc1, p.cc2, p.loc);
  } else id = addCourseControl(ev, controlId, courseId, 0, ev.courses[courseId].first || 0);
  const f = ev.courseControls[ev.courses[courseId].first];
  const s = f?.next ? ev.courseControls[f.next] : null;
  if (f && s && ev.controls[f.control].kind === "map-issue" && ev.controls[s.control].kind === "start" && ev.controls[f.control].issueKind === "middle")
    setFlagging(ev, f.control, s.control, "issue-middle");
  if (others) for (const c of courseIds(ev)) if (c !== courseId && !findKind(ev, c, kind)) addStartOrIssue(ev, controlId, c, false);
  return id;
}
export function addFinish(ev, controlId, courseId, others = false) {
  const last = lastCC(ev, courseId, false);
  let id;
  if (!last) { id = addObj(ev, "courseControl", newCC(controlId)); ev.courses[courseId].first = id; }
  else if (kindOfCC(ev, last) === "finish") { ev.courseControls[last].control = controlId; id = last; }
  else { id = addObj(ev, "courseControl", newCC(controlId)); ev.courseControls[last].next = id; }
  if (others) for (const c of courseIds(ev)) if (c !== courseId && !hasFinish(ev, c)) addFinish(ev, controlId, c, false);
  return id;
}
/** Remove one course control from a course (and what a removed split orphans). Returns the controls it used. */
export function removeCourseControl(ev, courseId, rm) {
  const course = ev.courses[courseId];
  const all = ccIds(ev, cdCourse(courseId));
  const ccRm = ev.courseControls[rm], kindRm = ev.controls[ccRm.control]?.kind;
  let after = ccRm.next || 0;
  if (ccRm.split && !ccRm.loop) after = ccRm.splitCCs[0] === rm ? ccRm.splitCCs[1] : ccRm.splitCCs[0];
  for (const id of all) {
    const cc = ev.courseControls[id];
    if (cc.next === rm) cc.next = after;
    if (cc.split && cc.splitEnd === rm) {
      cc.splitEnd = after;
      if (!after) { cc.split = false; delete cc.splitCCs; }
    }
    if (cc.split && cc.splitCCs?.includes(rm)) {
      cc.splitCCs = cc.splitCCs.filter((x) => x !== rm);
      if (cc.splitCCs.length < 2) { cc.split = false; cc.loop = false; delete cc.splitCCs; cc.splitEnd = 0; }
    }
  }
  if (course.first === rm) course.first = after;
  const kept = new Set(ccIds(ev, cdCourse(courseId))), removed = new Set();
  for (const id of all) if (!kept.has(id)) { removed.add(ev.courseControls[id].control); delete ev.courseControls[id]; }
  if (kindRm === "start" && course.first && kindOfCC(ev, course.first) === "map-issue")
    for (const c of removeCourseControl(ev, courseId, course.first)) removed.add(c);
  return [...removed];
}
/** Remove a control from the event: from every course, its legs, and itself. */
export function removeControl(ev, controlId) {
  for (const c of coursesUsing(ev, controlId)) {
    let id;
    while ((id = ccIds(ev, cdCourse(c)).find((x) => ev.courseControls[x].control === controlId))) removeCourseControl(ev, c, id);
  }
  for (const [id, l] of Object.entries(ev.legs)) if (l.c1 === controlId || l.c2 === controlId) delete ev.legs[id];
  delete ev.controls[controlId];
}
/** Move a control; gaps on its legs follow (ChangeEvent.ChangeControlLocation). */
export function moveControl(ev, controlId, pt) {
  const before = Object.entries(ev.legs).filter(([, l]) => (l.c1 === controlId || l.c2 === controlId) && l.gaps?.length)
    .map(([id, l]) => [Number(id), legPoints(ev, l.c1, l.c2)]);
  Object.assign(ev.controls[controlId], { x: pt[0], y: pt[1] });
  for (const [id, oldPath] of before) {
    const l = ev.legs[id];
    setLegGaps(ev, l.c1, l.c2, moveGaps(l.gaps, oldPath, legPoints(ev, l.c1, l.c2)));
  }
}
function vacuous(l) { return (!l.flagging || l.flagging === "none") && !l.bends?.length && !l.gaps?.length && !l.route?.length; }
function legFor(ev, c1, c2) {
  const id = findLeg(ev, c1, c2);
  return id ? [id, ev.legs[id]] : [0, { c1, c2, flagging: "none" }];
}
function putLeg(ev, id, leg) {
  if (vacuous(leg)) { if (id) delete ev.legs[id]; return; }
  if (id) ev.legs[id] = leg; else addObj(ev, "leg", leg);
}
/** The route the setter expects on a leg (Ozimut's, not in .ppen): the points between the two controls, or null. */
export function setLegRoute(ev, c1, c2, pts) {
  const [id, leg] = legFor(ev, c1, c2);
  if (pts?.length) leg.route = pts.map((p) => p.slice()); else delete leg.route;
  putLeg(ev, id, leg);
}
/** The leg as run: the drawn route when there is one, else the leg itself (with its bends). */
export function legRoutePoints(ev, c1, c2) {
  const leg = ev.legs[findLeg(ev, c1, c2)];
  if (!leg?.route?.length) return legPoints(ev, c1, c2);
  const a = ev.controls[c1], b = ev.controls[c2];
  return [[a.x, a.y], ...leg.route, [b.x, b.y]];
}
export function setLegGaps(ev, c1, c2, gaps) {
  const [id, leg] = legFor(ev, c1, c2);
  leg.gaps = gaps?.length ? gaps.map((g) => g.slice()) : null;
  putLeg(ev, id, leg);
}
/** Flagging of a leg (ChangeEvent.ChangeFlagging): partial flagging needs a bend where it starts or stops. */
export function setFlagging(ev, c1, c2, flagging) {
  const [id, leg] = legFor(ev, c1, c2);
  if (leg.flagging === "issue-middle" && flagging !== "issue-middle") return;
  leg.flagging = flagging;
  if (["begin", "end", "issue-middle"].includes(flagging)) {
    if (leg.bends?.length) leg.flag = (flagging === "begin" ? leg.bends[leg.bends.length - 1] : leg.bends[0]).slice();
    else {
      const a = ev.controls[c1], b = ev.controls[c2];
      leg.flag = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      leg.bends = [leg.flag.slice()];
    }
  } else delete leg.flag;
  putLeg(ev, id, leg);
  const b = ev.controls[c2];
  if (b.kind === "finish" && (flagging === "none" || flagging === "begin") && b.symbols[0] === "14.1") b.symbols[0] = "14.3";
}
export function addBend(ev, c1, c2, pt) {
  const [id, leg] = legFor(ev, c1, c2), old = legPoints(ev, c1, c2);
  const pts = insertPoint(old, pt);
  leg.bends = pts.slice(1, -1);
  putLeg(ev, id, leg);
  if (leg.gaps) setLegGaps(ev, c1, c2, moveGaps(leg.gaps, old, legPoints(ev, c1, c2)));
}
export function moveBend(ev, c1, c2, oldPt, newPt) {
  const id = findLeg(ev, c1, c2), leg = ev.legs[id], old = legPoints(ev, c1, c2);
  if (!leg) return;
  leg.bends = leg.bends.map((b) => (samePt(b, oldPt) ? newPt.slice() : b));
  if (leg.flag && samePt(leg.flag, oldPt)) leg.flag = newPt.slice();
  if (leg.gaps) leg.gaps = moveGaps(leg.gaps, old, legPoints(ev, c1, c2));
}
export function removeBend(ev, c1, c2, pt) {
  const id = findLeg(ev, c1, c2), leg = ev.legs[id];
  if (!leg?.bends) return;
  const old = legPoints(ev, c1, c2);
  let refl = null;
  if (["begin", "end", "issue-middle"].includes(leg.flagging) && leg.flag && samePt(leg.flag, pt)) {
    if (leg.bends.length === 1) refl = leg.flagging === "issue-middle" ? "issue-middle" : "all";
    else {
      const i = leg.bends.findIndex((b) => samePt(b, pt));
      leg.flag = ((i === 0 || leg.flagging === "end") && i !== leg.bends.length - 1 ? leg.bends[i + 1] : leg.bends[i - 1]).slice();
    }
  }
  leg.bends = leg.bends.filter((b) => !samePt(b, pt));
  if (!leg.bends.length) leg.bends = null;
  if (refl) { leg.flagging = "none"; delete leg.flag; }
  putLeg(ev, id, leg);
  if (refl) setFlagging(ev, c1, c2, refl);
  const gaps = ev.legs[findLeg(ev, c1, c2)]?.gaps;
  if (gaps) setLegGaps(ev, c1, c2, moveGaps(gaps, old, legPoints(ev, c1, c2)));
}

// ---- leg gaps (LegGap): [start, length] in mm from the start control's centre --------------------------------------------
export function simplifyGaps(gaps, len) {
  if (!gaps?.length) return null;
  let g = gaps.map(([s, l]) => {
    if (s + l > len) l = len - s;
    if (s < 0) { l += s; s = 0; }
    return [s, l];
  }).filter(([, l]) => l > 0).sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < g.length - 1;) {
    if (g[i][0] + g[i][1] >= g[i + 1][0]) {
      if (g[i][0] + g[i][1] < g[i + 1][0] + g[i + 1][1]) g[i] = [g[i][0], g[i + 1][1] + (g[i + 1][0] - g[i][0])];
      g.splice(i + 1, 1);
    } else i++;
  }
  return g.length ? g : null;
}
export function addLegGap(ev, c1, c2, p1, p2) {
  const pts = legPoints(ev, c1, c2), a = nearest(pts, p1).len, b = nearest(pts, p2).len;
  const gaps = [...(ev.legs[findLeg(ev, c1, c2)]?.gaps || []), [Math.min(a, b), Math.abs(b - a)]];
  setLegGaps(ev, c1, c2, simplifyGaps(gaps, pathLength(pts)));
}
export function removeLegGap(ev, c1, c2, p) {
  const pts = legPoints(ev, c1, c2), at = nearest(pts, p).len;
  const gaps = (ev.legs[findLeg(ev, c1, c2)]?.gaps || []).filter(([s, l]) => !(s <= at && s + l >= at));
  setLegGaps(ev, c1, c2, simplifyGaps(gaps, pathLength(pts)));
}
export function moveGaps(gaps, oldPath, newPath) {
  gaps = simplifyGaps(gaps, pathLength(oldPath));
  if (!gaps) return null;
  const out = [];
  for (const [s, l] of gaps) {
    const a = nearest(newPath, pointAt(oldPath, s)), b = nearest(newPath, pointAt(oldPath, s + l));
    if (a.d + b.d <= 2 * l) out.push(a.len < b.len ? [a.len, b.len - a.len] : [b.len, a.len - b.len]);
  }
  return simplifyGaps(out, pathLength(newPath));
}

// ---- circle gaps: { scale: [[startDeg, stopDeg], ...] } on a control ---------------------------------------------------
export function circleGaps(ev, controlId, scale) {
  const g = ev.controls[controlId]?.gaps;
  return g?.[Math.round(scale)] || null;
}
export function setCircleGaps(ev, controlId, scale, gaps) {
  const c = ev.controls[controlId];
  const k = Math.round(scale);
  if (!gaps?.length) { if (c.gaps) { delete c.gaps[k]; if (!Object.keys(c.gaps).length) delete c.gaps; } return; }
  c.gaps = { ...(c.gaps || {}), [k]: gaps.map((x) => x.slice()) };
}
/** Two angles in gap order (CircleGap.OrderGapAngles): stop in 0..360, start before it, the gap at most 180°. */
export function orderGapAngles(a1, a2) {
  const rem = (a) => a - 360 * Math.round(a / 360);
  a1 = rem(a1); a2 = rem(a2);
  if (Math.abs(a2 - a1) > 180) { if (a1 < a2) a1 += 360; else a2 += 360; }
  if (a1 > a2) [a1, a2] = [a2, a1];
  if (a2 < 0) { a1 += 360; a2 += 360; }
  return [a1, a2];
}
/** Gaps sorted and merged (CircleGap.SimplifyGaps): stop in 0..360, start in -360..stop. */
export function simplifyCircleGaps(gaps) {
  if (!gaps?.length) return null;
  const g = [];
  for (const [s0, e0] of gaps) {
    if (e0 <= s0) continue;
    let e = e0 % 360; if (e < 0) e += 360;
    let s = s0 % 360; if (s < 0) s += 360;
    if (s > e) s -= 360;
    g.push([s, e]);
  }
  g.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < g.length - 1;) {
    if (g[i][1] >= g[i + 1][0]) { if (g[i][1] < g[i + 1][1]) g[i] = [g[i][0], g[i + 1][1]]; g.splice(i + 1, 1); } else i++;
  }
  while (g.length >= 2 && g[0][0] < g[g.length - 1][1] - 360) { g[0] = [g[g.length - 1][0] - 360, g[0][1]]; g.pop(); }
  return g.length ? g : null;
}
/** Add a gap between two points seen from the circle's centre (ChangeEvent.AddGap). */
export function addCircleGap(ev, controlId, scale, p1, p2) {
  const c = ev.controls[controlId], ctr = [c.x, c.y];
  if (samePt(ctr, p1) || samePt(ctr, p2)) return;
  const [a1, a2] = orderGapAngles(angleDeg(ctr, p1), angleDeg(ctr, p2));
  setCircleGaps(ev, controlId, scale, simplifyCircleGaps([...(circleGaps(ev, controlId, scale) || []), [a1, a2]]));
}
/** Remove the gap at the angle of a point (CircleGap.RemoveGap). */
export function removeCircleGap(ev, controlId, scale, p) {
  const c = ev.controls[controlId];
  let a = angleDeg([c.x, c.y], p) % 360; if (a < 0) a += 360;
  const g = (simplifyCircleGaps(circleGaps(ev, controlId, scale)) || []).filter(([s, e]) => !((s <= a && e >= a) || (s <= a - 360 && e >= a - 360)));
  setCircleGaps(ev, controlId, scale, g);
}

// ---- courses: create, delete, duplicate, variations --------------------------------------------------------------------
export function createCourse(ev, { kind = "normal", name = "", printScale = ev.map.scale, climb = -1, length = null, descKind = "symbols",
  labels = null, firstNumber = 1, secondary = null, hideFromReports = false, scoreColumn = null, addStartFinish = true } = {}) {
  const order = Math.max(0, ...Object.values(ev.courses).map((c) => c.order)) + 1;
  const id = addObj(ev, "course", { kind, name, order, labels: labels || (kind === "score" ? "code" : "sequence"), secondary, printScale, climb,
    length, load: -1, firstNumber, scoreColumn: kind === "score" ? (scoreColumn ?? 0) : -1, hideFromReports, descKind,
    printArea: JSON.parse(JSON.stringify(ev.printArea)), partAreas: {}, partOptions: {}, relay: { first: 1, teams: 0, legs: 1, branches: {} },
    hideVariations: false, first: 0 });
  if (addStartFinish) {
    const unique = (k) => { const ids = Object.keys(ev.controls).filter((c) => ev.controls[c].kind === k); return ids.length === 1 ? Number(ids[0]) : 0; };
    const s = unique("start"), m = unique("map-issue"), f = unique("finish");
    if (s) addStartOrIssue(ev, s, id);
    if (m) addStartOrIssue(ev, m, id);
    if (f) addFinish(ev, f, id);
  }
  return id;
}
export function deleteCourse(ev, courseId) {
  const ccs = ccIds(ev, cdCourse(courseId));
  delete ev.courses[courseId];
  for (const id of ccs) delete ev.courseControls[id];
  for (const [sid, sp] of Object.entries(ev.specials)) {
    if (sp.all || !sp.courses.some((x) => x.course === courseId)) continue;
    sp.courses = sp.courses.filter((x) => x.course !== courseId);
    if (!sp.courses.length) delete ev.specials[sid];
  }
}
export function duplicateCourse(ev, courseId, name) {
  const old = ev.courses[courseId], order = old.order + 1;
  for (const c of Object.values(ev.courses)) if (c.order >= order) c.order++;
  const map = new Map();
  const ids = ccIds(ev, cdCourse(courseId));
  for (const id of ids) map.set(id, addObj(ev, "courseControl", {}));
  const copy = JSON.parse(JSON.stringify(old));
  Object.assign(copy, { name, order, first: old.first ? map.get(old.first) : 0 });
  const newId = addObj(ev, "course", copy);
  for (const id of ids) {
    const cc = JSON.parse(JSON.stringify(ev.courseControls[id]));
    if (cc.next) cc.next = map.get(cc.next);
    if (cc.splitEnd) cc.splitEnd = map.get(cc.splitEnd);
    if (cc.splitCCs) cc.splitCCs = cc.splitCCs.map((x) => map.get(x));
    ev.courseControls[map.get(id)] = cc;
  }
  for (const sp of Object.values(ev.specials)) {
    if (sp.all) continue;
    const add = sp.courses.filter((x) => x.course === courseId).map((x) => ({ course: newId, part: x.part ?? -1 }));
    if (add.length) sp.courses = [...sp.courses, ...add];
  }
  return newId;
}
/** Can a variation start at this course control? "" if so, else why not (QueryEvent.CanAddVariation). */
export function variationProblem(ev, cd, ccId) {
  if (!cd.course) return "all";
  if (isScore(ev, cd.course)) return "score";
  if (!ccId) return "none";
  if (kindOfCC(ev, ccId) === "finish" || lastCC(ev, cd.course, false) === ccId) return "finish";
  if (ev.courseControls[ccId].split) return "exists";
  return "";
}
/** A fork (n branches) or a loop (n loops) from a course control (ChangeEvent.AddVariation). */
export function addVariation(ev, cd, ccId, loop, n) {
  if (variationProblem(ev, cd, ccId)) return false;
  const base = ev.courseControls[ccId];
  Object.assign(base, { split: true, loop: !!loop, splitEnd: loop ? ccId : base.next });
  const extra = loop ? n : n - 1, ids = [ccId];
  for (let i = 0; i < extra; i++) {
    const c = JSON.parse(JSON.stringify(base));
    if (loop) c.next = ccId;
    ids.push(addObj(ev, "courseControl", c));
  }
  for (const id of ids) ev.courseControls[id].splitCCs = ids.slice();
  return true;
}
export function deleteVariation(ev, cd, ccId) {
  const cc = ev.courseControls[ccId];
  if (!cc?.split) return;
  for (const s of cc.splitCCs.slice(1)) if (ev.courseControls[s]) removeCourseControl(ev, cd.course, s);
}

// ---- numbering ---------------------------------------------------------------------------------------------------------
/** Renumber every normal control from the event's first code (ChangeEvent.AutoRenumberControls). */
export function autoRenumber(ev) {
  const normal = Object.keys(ev.controls).map(Number).filter((id) => ev.controls[id].kind === "normal");
  const fresh = [];
  let n = ev.numbering.start || 31;
  for (let i = 0; i < normal.length; i++) {
    fresh.push(String(n));
    do { n++; if (n >= 1000) n = 31; } while (codeProblem(ev, String(n)));
  }
  const freshSet = new Set(fresh);
  const keep = new Set(normal.filter((id) => freshSet.has(ev.controls[id].code)).map((id) => ev.controls[id].code));
  const toAssign = fresh.filter((c) => !keep.has(c)).sort(compareCodes);
  const toChange = normal.filter((id) => !keep.has(ev.controls[id].code)).sort((a, b) => compareCodes(ev.controls[a].code, ev.controls[b].code));
  toChange.forEach((id, i) => { ev.controls[id].code = toAssign[i]; });
}
export function removeUnused(ev) { const u = unusedControls(ev); for (const id of u) removeControl(ev, id); return u.length; }

/** An OCAD or Mapper map's own millimetres are the Tracer's moved by the map's origin (ev.map.ox, oy: mapsrc.openVector);
 *  .ppen and IOF XML files keep the map's own, as Purple Pen does. */
export const fileOffset = (ev) => (ev.map?.kind === "ocad" ? [Number(ev.map.ox) || 0, Number(ev.map.oy) || 0] : [0, 0]);
/** The event moved into (sign 1) or out of (sign -1) the map file's frame. */
export function shiftToFile(ev, sign = 1) {
  const [ox, oy] = fileOffset(ev);
  if (ox || oy) transformAll(ev, [1, 0, 0, 1, sign * ox, sign * oy]);
  return ev;
}

// ---- move every object (Event › Move All Controls): an affine [a, b, c, d, e, f], x' = a x + b y + e, y' = c x + d y + f ----
export function transformAll(ev, m) {
  const T = ([x, y]) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
  const rot = Math.atan2(m[2], m[0]) * 180 / Math.PI, scale = Math.hypot(m[0], m[2]);
  for (const c of Object.values(ev.controls)) {
    [c.x, c.y] = T([c.x, c.y]);
    if (c.kind === "crossing") c.orientation = (c.orientation || 0) + rot;
  }
  for (const l of Object.values(ev.legs)) {
    if (l.bends) l.bends = l.bends.map(T);
    if (l.route) l.route = l.route.map(T);
    if (l.flag) l.flag = T(l.flag);
    if (l.gaps) l.gaps = l.gaps.map(([s, len]) => [s * scale, len * scale]);
  }
  for (const s of Object.values(ev.specials)) {
    s.pts = s.pts.map(T);
    if (s.kind === "optional-crossing-point") s.orientation = (s.orientation || 0) + rot;
  }
  for (const cc of Object.values(ev.courseControls)) if (cc.number) cc.number = [cc.number[0] * scale, cc.number[1] * scale];
  const moveArea = (pa) => {
    if (!pa || pa.auto || !pa.rect) return;
    const [l, b, r, t] = pa.rect, [cx, cy] = T([(l + r) / 2, (b + t) / 2]), w = (r - l) * scale / 2, h = (t - b) * scale / 2;
    pa.rect = [cx - w, cy - h, cx + w, cy + h];
  };
  moveArea(ev.printArea);
  for (const c of Object.values(ev.courses)) { moveArea(c.printArea); for (const p of Object.values(c.partAreas || {})) moveArea(p); }
}

// ---- specials ----------------------------------------------------------------------------------------------------------
export const POINT_SPECIALS = ["first-aid", "water", "optional-crossing-point", "forbidden-route", "registration-mark"];
export const LINE_SPECIALS = ["boundary", "line"];
export const AREA_SPECIALS = ["out-of-bounds", "dangerous-area", "temporary-construction", "white-out"];
export const RECT_SPECIALS = ["text", "descriptions", "image", "rectangle", "ellipse"];
export function addSpecial(ev, kind, pts, extra = {}) {
  const sp = { kind, pts: pts.map((p) => p.slice()), all: true, courses: [], ...extra };
  if (["text", "line", "rectangle", "ellipse"].includes(kind) && !sp.color) sp.color = "purple";
  if (kind === "optional-crossing-point" && sp.orientation == null) sp.orientation = 0;
  return addObj(ev, "special", sp);
}
/** Show a special on some course designators only ([] = « Tous les postes » only); all of them = every course. */
export function setDisplayedCourses(ev, sid, cds) {
  const sp = ev.specials[sid];
  const all = courseIds(ev).every((c) => cds.some((x) => x.course === c && (x.part ?? -1) < 0)) && cds.some((x) => !x.course);
  if (all && sp.kind !== "descriptions") { sp.all = true; sp.courses = []; }
  else { sp.all = false; sp.courses = cds.map((x) => ({ course: x.course, part: x.part ?? -1 })); }
}
export function addSpecialCorner(ev, sid, pt) {
  const sp = ev.specials[sid];
  const closed = AREA_SPECIALS.includes(sp.kind);
  const pts = closed ? [...sp.pts, sp.pts[0]] : sp.pts;
  const out = insertPoint(pts, pt);
  sp.pts = closed ? out.slice(0, -1) : out;
}
export function removeSpecialCorner(ev, sid, pt) {
  const sp = ev.specials[sid];
  const min = AREA_SPECIALS.includes(sp.kind) ? 3 : 2;
  if (sp.pts.length <= min) return;
  sp.pts = sp.pts.filter((p) => !samePt(p, pt));
}

// ---- texts: $(…) fields (CourseFormatter.ExpandText) -------------------------------------------------------------------
export function expandText(ev, cd, text, { fileName = "", variation = "", team = null, leg = null } = {}) {
  const v = cd.course ? view(ev, cd, { specials: false, descriptions: false }) : null;
  const course = cd.course ? ev.courses[cd.course] : null;
  // numbers as the event's own language writes them (its description sheets'), not the interface's: « 4,2 km » / "4.2 km"
  let nf;
  try { nf = (d) => new Intl.NumberFormat(ev.lang || "fr", { minimumFractionDigits: d, maximumFractionDigits: d }); nf(0); } catch (e) { nf = (d) => new Intl.NumberFormat("fr", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  const km = (m) => nf(1).format(m / 1000);
  const len = v ? (Math.abs(v.totalMax - v.totalMin) < 1 ? `${km(v.totalMin)} km` : `${km(v.totalMin)}–${km(v.totalMax)} km`) : "";
  return String(text)
    .replaceAll("$(EventTitle)", ev.title.replace(/\|/g, " "))
    .replaceAll("$(CourseName)", course?.name || "")
    .replaceAll("$(CoursePart)", cd.course && cd.part >= 0 ? String(cd.part + 1) : "")
    .replaceAll("$(Variation)", variation)
    .replaceAll("$(RelayTeam)", team != null ? String(team) : "--")
    .replaceAll("$(RelayLeg)", leg != null ? String(leg) : "-")
    .replaceAll("$(CourseLength)", len)
    .replaceAll("$(CourseClimb)", course && course.climb >= 0 ? String(Math.round(course.climb / 5) * 5) : "")
    .replaceAll("$(PrintScale)", `1:${nf(0).format(v?.printScale || ev.map.scale)}`)
    .replaceAll("$(ClassList)", (course?.secondary || "").replace(/\|/g, " "))
    .replaceAll("$(FileName)", fileName)
    .replaceAll("$(MapFileName)", ev.map.file || "");
}

// ---- print areas ---------------------------------------------------------------------------------------------------------
export function printAreaOf(ev, cd) {
  if (!cd.course) return ev.printArea;
  const c = ev.courses[cd.course];
  return (cd.part >= 0 && c.partAreas?.[cd.part]) || c.printArea;
}
/** The view's bounds in mm (controls ± 10 mm), or the map's when empty. */
export function viewBounds(ev, v) {
  const xs = [], ys = [];
  for (const cv of v.controls) { const c = ev.controls[cv.control]; xs.push(c.x); ys.push(c.y); }
  if (!xs.length) return [0, 0, ev.map.w || 210, ev.map.h || 297];
  return [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10];
}

// ---- checks of an event read from a file (EventDB.Validate, lenient: fixes what can be fixed) -----------------------------
export function sanitize(ev) {
  for (const [id, cc] of Object.entries(ev.courseControls)) if (!ev.controls[cc.control]) delete ev.courseControls[id];
  for (const [id, l] of Object.entries(ev.legs)) if (!ev.controls[l.c1] || !ev.controls[l.c2]) delete ev.legs[id];
  for (const c of Object.values(ev.courses)) if (c.first && !ev.courseControls[c.first]) c.first = 0;
  const orders = new Set();
  for (const id of courseIds(ev)) { const c = ev.courses[id]; while (!(c.order > 0) || orders.has(c.order)) c.order = (c.order > 0 ? c.order : 0) + 1; orders.add(c.order); }
  for (const k of Object.keys(STORE)) ev.next[k] = Math.max(ev.next[k] || 0, ...Object.keys(ev[STORE[k]]).map(Number), 0);
  return ev;
}
