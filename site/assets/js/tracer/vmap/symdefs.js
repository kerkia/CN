// Symbol definitions of the vector maps: a port of Purple Pen's SymDef and Glyph (BSD licence, Copyright (c) 2006-2008
// Peter Golde — see /assets/tracer/LICENSE-PurplePen.txt), which reproduce how OCAD and OpenOrienteering Mapper draw:
// point symbols as glyphs (lines, areas, circles, dots), line symbols (main line, framing line, double lines, dashes with
// OCAD's spacing, symbols along the line, pointed ends), area symbols (fill, border line, hatching, structure patterns),
// text (formatted and unformatted, along a line, framing, underline), rectangles with their grids.
// Drawing goes through a graphics target (target.js): one colour at a time, as OCAD layers its colours.

import { Matrix, MITER_LIMIT, miterFactor, rectUnion, transformRect, rotatedRect, bizarro, euclid } from "./geom.js";
import { SymPath, PathWithHoles, K, FLAG_LEFT, FLAG_RIGHT, FLAG_MAIN } from "./sympath.js";
import { textWidth, family as fontFamily } from "../fonts.js";

/** A pen: colour, width (mm), cap (butt, round, square), join (miter, round, bevel). */
export const pen = (color, width, cap = "butt", join = "miter") => ({ color, width, cap, join, miter: MITER_LIMIT });
const STYLE = { rounded: ["round", "round"], mitered: ["butt", "miter"], beveled: ["butt", "bevel"], flatRounded: ["butt", "round"] };
export const penStyle = (color, width, style) => pen(color, width, ...STYLE[style]);

// ---- glyphs ------------------------------------------------------------------------------------------------------------------
export class Glyph {
  constructor() { this.parts = []; this.simple = false; this.radius = 0; this.box = [0, 0, 0, 0]; }
  addLine(color, path, width, join = "miter", cap = "butt") { this.add({ kind: "line", color, path, width, join, cap }); }
  addArea(color, area) { this.add({ kind: "area", color, area }); }
  addCircle(color, x, y, width, diam) { this.add({ kind: "circle", color, x, y, width, diam }); }
  addDot(color, x, y, diam) { this.add({ kind: "dot", color, x, y, diam }); }
  add(part) {
    this.parts.push(part);
    this.simple = this.parts.length === 1 && (part.kind === "circle" || part.kind === "dot") && part.x === 0 && part.y === 0;
  }
  done() {
    let radius = 0, box = null;
    for (const p of this.parts) {
      let r = 0, b = null;
      if (p.kind === "line") {
        const w = p.width * (p.join === "miter" ? p.path.maxMiter : 1);
        r = p.path.maxDistance(0, 0) + w / 2;
        if (p.width > 0 && !p.path.zero) { const bb = p.path.bbox; b = [bb[0] - w / 2, bb[1] - w / 2, bb[2] + w / 2, bb[3] + w / 2]; }
      } else if (p.kind === "area") { r = p.area.maxDistance(0, 0); b = p.area.bbox; }
      else {
        r = p.diam / 2 + Math.hypot(p.x, p.y);
        if (p.kind === "circle" ? p.width > 0 && p.diam > p.width : p.diam > 0) b = [p.x - p.diam / 2, p.y - p.diam / 2, p.x + p.diam / 2, p.y + p.diam / 2];
      }
      radius = Math.max(radius, r);
      if (b) box = rectUnion(box, b);
    }
    this.radius = radius; this.box = box || [0, 0, 0, 0];
    return this;
  }
  get empty() { return !this.parts.length; }
  hasColor(color) { return this.parts.some((p) => p.color === color); }
  /** Draw at (x, y) turned by angle; extra: a matrix applied to positions and sizes but not to line widths. */
  draw(g, x, y, angle, extra, gaps, color, filter = null) {
    if (this.simple && !gaps && !extra && !filter) {
      const p = this.parts[0];
      if (p.color !== color) return;
      if (p.kind === "circle") {
        if (p.width > 0 && p.diam > 0) {
          const r = (p.diam - p.width) / 2;
          if (r < 0) g.ellipse(x, y, p.diam / 2, p.diam / 2, null, color);
          else g.ellipse(x, y, r, r, penStyle(color, p.width, "mitered"), null);
        }
      } else if (p.diam > 0) g.ellipse(x, y, p.diam / 2, p.diam / 2, null, color);
      return;
    }
    let pushed = false, m = null;
    for (const p of this.parts) {
      if (p.color !== color) continue;
      if (!pushed) { pushed = true; m = new Matrix().translate(x, y).rotateAt(angle, 0, 0); g.push(m); }
      const fl = filter ? (pts, c) => filter(pts.map(([px, py]) => [m.x(px, py), m.y(px, py)]), [m.x(c[0], c[1]), m.y(c[0], c[1])]) : null;
      drawPart(g, p, gaps, extra, fl);
    }
    if (pushed) g.pop();
  }
}
function pathPoints(path) { const out = []; for (let i = 0; i < path.n; i++) out.push([path.x(i), path.y(i)]); return out; }
function circlePoints(p) {
  const r = p.diam / 2, h = Math.SQRT1_2 * r;
  return [[p.x, p.y + r], [p.x, p.y - r], [p.x + r, p.y], [p.x - r, p.y], [p.x + h, p.y + h], [p.x - h, p.y + h], [p.x + h, p.y - h], [p.x - h, p.y - h]];
}
function drawPart(g, p, gaps, extra, filter) {
  const diamOf = (d) => (extra ? Math.abs(extra.x(d, 0)) : d);
  const at = (x, y) => (extra ? [extra.x(x, y), extra.y(x, y)] : [x, y]);
  switch (p.kind) {
    case "line":
      if (p.width > 0 && !p.path.zero) {
        if (filter && !filter(pathPoints(p.path), p.path.centroid())) return;
        g.stroke(p.path.commands([], false, extra), pen(p.color, p.width, p.cap, p.join));
      }
      return;
    case "area":
      if (filter && !filter(pathPoints(p.area.main), p.area.main.centroid())) return;
      g.fill(p.area.commands(extra), p.color);
      return;
    case "circle": {
      if (!(p.width > 0 && p.diam > p.width)) return;
      if (filter && !filter(circlePoints(p), [p.x, p.y])) return;
      const [cx, cy] = at(p.x, p.y);
      let r = (diamOf(p.diam) - p.width) / 2;
      if (r < 0) { r = diamOf(p.diam) / 2; g.ellipse(cx, cy, r, r, null, p.color); }
      else if (!gaps || !gaps.length) g.ellipse(cx, cy, r, r, penStyle(p.color, p.width, "mitered"), null);
      else {
        for (let i = 1; i < gaps.length; i += 2) {
          const start = gaps[i], end = i === gaps.length - 1 ? gaps[0] : gaps[i + 1];
          g.arc(cx, cy, r, start, (end - start + 360) % 360, penStyle(p.color, p.width, "mitered"));
        }
      }
      return;
    }
    case "dot": {
      if (!(p.diam > 0)) return;
      if (filter && !filter(circlePoints(p), [p.x, p.y])) return;
      const [cx, cy] = at(p.x, p.y), r = diamOf(p.diam) / 2;
      g.ellipse(cx, cy, r, r, null, p.color);
    }
  }
}

// ---- symbol definitions ---------------------------------------------------------------------------------------------------
export class SymDef {
  constructor(name, id) { this.name = name; this.id = id; this.symbols = []; this.visible = true; }
  hasColor() { return false; }
}
export class PointSymDef extends SymDef {
  constructor(name, id, glyph, rotatable = false) { super(name, id); this.glyph = glyph; this.rotatable = rotatable; this.kind = "point"; }
  hasColor(c) { return !c.special && this.glyph.hasColor(c); }
  draw(g, x, y, angle, gaps, color) { this.glyph.draw(g, x, y, angle, null, gaps, color); }
  bounds(x, y, angle) {
    let b = this.glyph.box;
    if (angle) b = rotatedRect(b, 0, 0, angle);
    const r = this.glyph.radius;
    return [Math.max(b[0] + x, x - r), Math.max(b[1] + y, y - r), Math.min(b[2] + x, x + r), Math.min(b[3] + y, y + r)];
  }
}

export const SPACING = { OCAD: 0, OMDashes: 1, OMMid: 2 };
export const LOC = { Start: 0, End: 1, Corners: 2, CornersIgnoreEnds: 3, DashPoints: 4, DashPointsIgnoreEnds: 5, DashCenters: 6, GapCenters: 7, Spaced: 8, SpacedOffset: 9, SpacedDecrease: 10 };
const LK = { Lengths: 0, DashCenters: 1, GapCenters: 2, GapCentersOffset: 3, GapCentersDecrease: 4 };
const DEC = { None: 0, SmallToLarge: 1, LargeToSmall: 2, Both: 3 };
const CORNER_GLYPH_STRETCH_LIMIT = 3;
const emptyDash = () => ({ dash: 0, first: 0, last: 0, halfClosed: false, gap: 0, minGaps: 0, secMid: 0, secMidLen: 0, secEnd: 0, secEndLen: 0, spacing: SPACING.OCAD });

export class LineSymDef extends SymDef {
  /** color, width, join, cap: the main line. */
  constructor(name, id, color, width, join = "miter", cap = "butt") {
    super(name, id); this.kind = "line";
    this.color = color; this.width = width; this.join = join; this.cap = cap;
    this.second = null;                         // { color, width, join, cap }: OCAD's framing line
    this.dashes = null;                         // dash info, or null
    this.double = null;                         // { fill, left, right (colours), thick, leftWidth, rightWidth, fillDashed, leftDashed, rightDashed, dashes }
    this.shorten = null;                        // { start, end, pointy }
    this.glyphs = null;                         // [{ glyph, loc, distance, first, last, minimum, number, spacing, offset, decreaseLimit, decreaseBoth, noScaleAtCorners, spacingMethod }]
  }
  setDashes(d) { this.dashes = { ...emptyDash(), ...d }; this.isDashed = this.dashes.gap > 0 || this.dashes.secMidLen > 0 || this.dashes.secEndLen > 0; }
  get hasDashes() { return !!this.isDashed || !!(this.double && (this.double.fillDashed || this.double.leftDashed || this.double.rightDashed)); }
  finish() {
    // the thickness, for bounds
    let max = 0, miterMax = 0;
    if (this.color && this.width > max) max = this.width;
    if (this.color && this.join === "miter") miterMax = Math.max(miterMax, this.width);
    if (this.second?.color) { max = Math.max(max, this.second.width); if (this.second.join === "miter") miterMax = Math.max(miterMax, this.second.width); }
    if (this.double) { const t = 2 * Math.max(this.double.leftWidth, this.double.rightWidth) + this.double.thick; max = Math.max(max, t); miterMax = Math.max(miterMax, t); }
    for (const gi of this.glyphs || []) { max = Math.max(max, gi.glyph.radius * 2); if (gi.loc === LOC.Corners) miterMax = Math.max(miterMax, gi.glyph.radius * 2); }
    this.maxThick = max; this.maxMiterThick = miterMax;
    return this;
  }
  hasColor(c) {
    if (c.special) return false;
    const d = this.double;
    if ((this.color === c && this.width > 0) || (this.second && this.second.color === c && this.second.width > 0) ||
      (d && d.fill === c) || (d && d.leftWidth > 0 && d.left === c) || (d && d.rightWidth > 0 && d.right === c)) return true;
    return !!this.glyphs?.some((gi) => gi.glyph.hasColor(c));
  }
  bounds(path) {
    let t = this.maxThick ?? (this.finish(), this.maxThick);
    if (this.maxMiterThick > 0) t = Math.max(t, Math.min(path.maxMiter, MITER_LIMIT) * this.maxMiterThick);
    const b = path.bbox;
    return [b[0] - t / 2, b[1] - t / 2, b[2] + t / 2, b[3] + t / 2];
  }
  parts(path, metric) {
    const without = path.subpaths(FLAG_MAIN);
    let withS = without;
    const s = this.shorten;
    if (s && (s.start > 0 || s.end > 0)) {
      const sh = path.shorten(s.start, s.end, metric);
      withS = sh ? sh.subpaths(FLAG_MAIN) : [];
    }
    return [withS, without];
  }
  draw(g, path, color, ro) {
    if (path.zero) return;
    const metric = ro.metric;
    const [withS, without] = this.parts(path, metric);
    const sh = this.shorten;
    if (this.color && color === this.color && this.width > 0) {
      const p = pen(this.color, this.width, sh && sh.start > 0 && sh.pointy ? "round" : this.cap, this.join);
      if (!this.isDashed) for (const q of withS) strokePath(g, q, p);
      else for (const q of withS) drawDashed(g, q, p, this.dashes, 0, 1, ro, metric);
    }
    if (this.color && color === this.color && sh?.pointy && this.width > 0 && (sh.start > 0 || sh.end > 0)) this.pointyEnds(g, path, sh.start, sh.end, this.width, metric);
    if (this.second && color === this.second.color && this.second.width > 0) {
      const p = pen(this.second.color, this.second.width, this.second.cap, this.second.join);
      for (const q of without) strokePath(g, q, p);
    }
    const d = this.double;
    if (d) {
      if (d.fill && d.fill === color) {
        const p = penStyle(d.fill, d.thick, "mitered");
        for (const q of without) d.fillDashed ? drawDashed(g, q, p, d.dashes, 0, 1, ro, metric) : strokePath(g, q, p);
      }
      if (d.left && d.left === color && d.leftWidth > 0) {
        const p = penStyle(d.left, d.leftWidth, "flatRounded"), off = -(d.thick + d.leftWidth) / 2;
        for (const q of path.subpaths(FLAG_LEFT)) d.leftDashed ? drawDashed(g, q, p, d.dashes, off, MITER_LIMIT, ro, metric) : strokePath(g, q.offsetRight(off, MITER_LIMIT), p);
      }
      if (d.right && d.right === color && d.rightWidth > 0) {
        const p = penStyle(d.right, d.rightWidth, "flatRounded"), off = (d.thick + d.rightWidth) / 2;
        for (const q of path.subpaths(FLAG_RIGHT)) d.rightDashed ? drawDashed(g, q, p, d.dashes, off, MITER_LIMIT, ro, metric) : strokePath(g, q.offsetRight(off, MITER_LIMIT), p);
      }
    }
    for (const gi of this.glyphs || []) {
      if (!gi.glyph.hasColor(color)) continue;
      if ((gi.loc === LOC.Start || gi.loc === LOC.End) && withS.length > 0) this.drawGlyphs(g, gi, path, path, color, ro);
      else withS.forEach((q, i) => this.drawGlyphs(g, gi, q, i < without.length ? without[i] : path, color, ro));
    }
  }
  drawGlyphs(g, gi, path, longPath, color, ro) {
    const metric = ro.metric;
    let distances;
    switch (gi.loc) {
      case LOC.CornersIgnoreEnds: case LOC.DashPointsIgnoreEnds: case LOC.Corners: case LOC.DashPoints: {
        const dash = gi.loc === LOC.DashPoints || gi.loc === LOC.DashPointsIgnoreEnds;
        const ignore = gi.loc === LOC.CornersIgnoreEnds || gi.loc === LOC.DashPointsIgnoreEnds;
        for (const c of path.cornerOrDashPoints(dash ? K.Dash : K.Corner, ignore)) {
          let stretch = c.sub !== 0 && !gi.noScaleAtCorners && !dash ? miterFactor(c.sub) : 1;
          stretch = Math.min(stretch, CORNER_GLYPH_STRETCH_LIMIT);
          gi.glyph.draw(g, c.pt[0], c.pt[1], c.perp + 90, stretch !== 1 ? new Matrix().scale(1, stretch) : null, null, color);
        }
        return;
      }
      case LOC.Spaced: distances = dashDistances(path, LK.GapCenters, gi.spacingMethod, gi.distance, gi.first, gi.last, 0, false, gi.minimum, 0, 0, 0, 0, 0, 1, false, null, metric); break;
      case LOC.SpacedOffset: distances = dashDistances(path, LK.GapCentersOffset, gi.spacingMethod, gi.distance, gi.first, gi.last, 0, false, gi.minimum, gi.offset, 0, 0, 0, 0, 1, false, null, metric); break;
      case LOC.SpacedDecrease: {
        const ranges = { s2l: 0, n2l: 0, l2s: 0, nl2s: 0, both: 0, nboth: 0 };
        distances = dashDistances(path, LK.GapCentersDecrease, gi.spacingMethod, gi.distance, gi.first, gi.last, 0, false, gi.minimum, 0, 0, 0, 0, 0, gi.decreaseLimit, gi.decreaseBoth, ranges, metric);
        if (distances?.length) {
          const first = distances[0];
          for (let n = 0; n < gi.number; n++) {
            distances[0] = first - (gi.number - 1 - n * 2) * (gi.spacing / 2);
            const { pts, angles } = path.pointsAlong(distances, metric);
            pts.forEach((pt, i) => {
              const f = decreaseFactor(i, ranges, gi.decreaseLimit);
              if (f >= 0.001) gi.glyph.draw(g, pt[0], pt[1], angles[i], new Matrix().scale(f, f), null, color);
            });
          }
        }
        return;
      }
      case LOC.DashCenters: { const d = this.dashes || emptyDash(); distances = dashDistances(path, LK.DashCenters, d.spacing, d.dash, d.first, d.last, d.gap, d.halfClosed, d.minGaps, 0, 0, 0, 0, 0, 1, false, null, metric); break; }
      case LOC.GapCenters: { const d = this.dashes || emptyDash(); distances = dashDistances(path, LK.GapCenters, d.spacing, d.dash, d.first, d.last, d.gap, d.halfClosed, Math.max(gi.minimum, d.minGaps), 0, 0, 0, 0, 0, 1, false, null, metric); break; }
      case LOC.Start: distances = [0]; break;
      case LOC.End: distances = [longPath.lengthBy(metric)]; break;
      default: return;
    }
    if (!distances?.length) return;
    const first = distances[0];
    for (let n = 0; n < gi.number; n++) {
      distances[0] = first - (gi.number - 1 - n * 2) * (gi.spacing / 2);
      let res;
      if (gi.loc !== LOC.Start && gi.loc !== LOC.End) {
        if ((longPath.p[0] !== path.p[0] || longPath.p[1] !== path.p[1]) && this.shorten?.start > 0) {
          const d = distances.slice(); d[0] += this.shorten.start;
          res = longPath.pointsAlong(d, metric);
        } else res = path.pointsAlong(distances, metric);
      } else res = longPath.pointsAlong(distances, metric);
      res.pts.forEach((pt, i) => gi.glyph.draw(g, pt[0], pt[1], res.angles[i], null, null, color));
    }
  }
  pointyEnds(g, path, ls, le, width, metric) {
    const len = path.lengthBy(metric);
    let d;
    if (len >= ls + le) d = [0, ls / 2, ls / 2, len - le - ls, le / 2, le / 2];
    else { const f = len / (ls + le); d = [0, (ls / 2) * f, (ls / 2) * f, 0, (le / 2) * f, (le / 2) * f]; }
    const { pts, angles } = path.pointsAlong(d, metric);
    const mid = width * 0.666;
    const mv = ([x, y], dd, a) => [x + Math.cos((a * Math.PI) / 180) * dd, y + Math.sin((a * Math.PI) / 180) * dd];
    const poly = (c) => g.fill([["M", ...c[0]], ...c.slice(1).map((q) => ["L", ...q]), ["Z"]], this.color, false);
    if (ls > 0) poly([pts[0], mv(pts[1], mid / 2, angles[1] - 90), mv(pts[2], width / 2, angles[2] - 90), mv(pts[2], width / 2, angles[2] + 90), mv(pts[1], mid / 2, angles[1] + 90)]);
    if (le > 0) poly([pts[5], mv(pts[4], mid / 2, angles[4] - 90), mv(pts[3], width / 2, angles[3] - 90), mv(pts[3], width / 2, angles[3] + 90), mv(pts[4], mid / 2, angles[4] + 90)]);
  }
}
function strokePath(g, path, p) { g.stroke(path.commands(), p); }
function drawDashed(g, path, p, dashes, offsetRight, miterLimit, ro, metric) {
  const d = dashDistances(path, LK.Lengths, dashes.spacing, dashes.dash, dashes.first, dashes.last, dashes.gap, dashes.halfClosed, dashes.minGaps, 0,
    dashes.secEnd, dashes.secEndLen, dashes.secMid, dashes.secMidLen, 1, false, null, metric);
  const tiny = dashes.gap < ro.minRes && (!dashes.secMid || dashes.secMidLen < ro.minRes) && (!dashes.secEnd || dashes.secEndLen < ro.minRes);
  if (!d.length || tiny) { strokePath(g, offsetRight ? path.offsetRight(offsetRight, miterLimit) : path, p); return; }
  path.dashes(d, metric, offsetRight, miterLimit, (pts) => g.polyline(pts, false, p));
}
function decreaseFactor(i, r, limit) {
  if (i >= r.both && i - r.both < r.nboth) { const k = i - r.both; return r.nboth <= 2 ? limit : 1 - (Math.abs(k - (r.nboth - 1) / 2) * (1 - limit)) / ((r.nboth - 1) / 2); }
  if (i >= r.l2s && i - r.l2s < r.nl2s) { const k = i - r.l2s; return k === 0 ? 1 : 1 - (k * (1 - limit)) / (r.nl2s - 1); }
  if (i >= r.s2l && i - r.s2l < r.n2l) { const k = r.n2l - 1 - (i - r.s2l); return k === 0 ? 1 : 1 - (k * (1 - limit)) / (r.n2l - 1); }
  return 1;
}

/** OCAD's dash layout along a whole path (parts between corner and dash points). See Purple Pen's ComputeDashDistances. */
function dashDistances(path, kind, spacing, dash, firstDash, lastDash, gap, halfClosed, minGaps, offset, nEndSec, lEndSec, nMidSec, lMidSec, decLimit, decBoth, ranges, metric) {
  const original = kind;
  const { distances: segs, kinds } = path.cornerAndDashDistances(metric);
  const n = segs.length, atEnd = new Array(n).fill(0), parts = new Array(n);
  let s2l = -1, l2s = -1, both = -1;
  if (kind === LK.DashCenters) kind = LK.Lengths;
  if (path.closed && halfClosed) { firstDash /= 2; lastDash /= 2; }
  let longest = 0, longestLen = 0;
  for (let i = 0; i < n; i++) if (segs[i] >= longestLen) { longestLen = segs[i]; longest = i; }
  let total = 0;
  for (let i = 0; i < n; i++) {
    let firstIsDash = i !== 0 && kinds[i] === K.Dash, lastIsDash = i < n - 1 && kinds[i + 1] === K.Dash;
    if (spacing !== SPACING.OCAD && nMidSec > 0) firstIsDash = lastIsDash = false;
    const fl = firstIsDash ? dash / 2 : firstDash, ll = lastIsDash ? dash / 2 : lastDash;
    let dk = DEC.None;
    if (kind === LK.GapCentersDecrease) {
      if (decBoth) {
        if (n === 1) { dk = DEC.Both; both = i; } else if (i === 0) { dk = DEC.SmallToLarge; s2l = i; } else if (i === n - 1) { dk = DEC.LargeToSmall; l2s = i; }
      } else if (i === n - 1) { dk = DEC.LargeToSmall; l2s = i; }
    }
    const mg = i === longest || segs[i] >= segs[longest] - 0.1 || spacing === SPACING.OMMid ? minGaps : 0;
    const r = segmentDashes(segs[i], kind, spacing, dash, fl, ll, gap, mg, offset, nEndSec, lEndSec, nMidSec, lMidSec, decLimit, dk);
    parts[i] = r.locations; atEnd[i] = r.atEnd;
    total += r.locations.length;
    if (kind === LK.Lengths && i > 0) total--;
  }
  let out;
  if (n === 1) {
    if (ranges) {
      if (s2l === 0) { ranges.s2l = 0; ranges.n2l = parts[0].length; }
      else if (l2s === 0) { ranges.l2s = 0; ranges.nl2s = parts[0].length; }
      else if (both === 0) { ranges.both = 0; ranges.nboth = parts[0].length; }
    }
    out = parts[0];
  } else {
    out = new Array(total).fill(0);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < parts[i].length; q++) out[idx + q] = parts[i][q];
      if (ranges) {
        if (s2l === i) { ranges.s2l = idx; ranges.n2l = parts[i].length; }
        else if (l2s === i) { ranges.l2s = idx; ranges.nl2s = parts[i].length; }
        else if (both === i) { ranges.both = idx; ranges.nboth = parts[i].length; }
      }
      if (i > 0 && parts[i].length > 0) out[idx] += atEnd[i - 1];
      if (i > 0 && (parts[i].length === 0 || (kind === LK.Lengths && parts[i].length === 1))) atEnd[i] += atEnd[i - 1];
      idx += parts[i].length;
      if (kind === LK.Lengths) idx--;
    }
  }
  if (kind === LK.Lengths) out = removeZeroGaps(out);
  if (original === LK.DashCenters) out = dashCenters(out, path.closed);
  return out;
}
function segmentDashes(len, kind, spacing, dash, first, last, gap, minGaps, offset, nEndSec, lEndSec, nMidSec, lMidSec, decLimit, dk) {
  let numGaps;
  if (dk === DEC.None && kind === LK.GapCentersDecrease) kind = LK.GapCenters;
  if (kind === LK.GapCentersDecrease) dash = (dash + dash * decLimit) / 2;
  if (dash + gap > 0) {
    if (spacing === SPACING.OCAD) {
      if (len - first - last <= gap) numGaps = minGaps >= 1 || len >= first / 2 + last / 2 + gap ? 1 : 0;
      else numGaps = Math.round((len + dash - first - last) / (dash + gap));
    } else if (spacing === SPACING.OMMid) {
      const segLen = dash, endLen = (first + last) / 2, endTwice = first + last;
      const segmented = Math.max(0, len - endTwice);
      const raw = Math.max(endLen === 0 ? 1 : 0, segmented / segLen);
      const lo = Math.floor(raw), hi = Math.ceil(raw);
      let count;
      if (endLen > 0) {
        const dlo = Math.abs(len - lo * segLen - endTwice), dhi = Math.abs(len - hi * segLen - endTwice);
        count = dlo >= dhi ? hi : lo;
        numGaps = hi > 0 || len > endTwice - 0.5 * segLen ? count + 1 : 0;
      } else {
        const dlo = Math.abs(len - lo * segLen) / lo, dhi = Math.abs(len - hi * segLen) / hi;
        count = dlo > dhi ? hi : lo;
        numGaps = count + 1;
      }
    } else {
      const numShort = (first < 0.6 * dash ? 1 : 0) + (last < 0.6 * dash ? 1 : 0);
      const ng = (len + dash - first - last + gap * numShort) / (dash + gap);
      const fl = Math.floor(ng), ce = Math.ceil(ng);
      const devF = (len + gap - (fl + 1) * (dash + gap)) / (fl + 1), devC = -(len + gap - (ce + 1) * (dash + gap)) / (ce + 1);
      numGaps = devF > devC ? ce : fl;
      const minOptLen = 2 * (dash + gap), minOptDashes = (nMidSec + 1) * 2 - numShort * 0.5, switchDev = (0.2 * (dash + gap)) / (nMidSec + 1);
      if (fl === 0 && len < minOptLen - minOptDashes * switchDev) numGaps = 0;
      if (numGaps < minGaps) numGaps = minGaps;
    }
  } else numGaps = 0;
  if (numGaps < minGaps) numGaps = minGaps;
  let aDash, aFirst, aLast;
  if (numGaps === 0) aDash = aFirst = aLast = len;
  else if (numGaps === 1 && first === 0 && last === 0) aDash = aFirst = aLast = 0;
  else { aDash = (len - gap * numGaps) / (numGaps - 1 + first / dash + last / dash); aFirst = (aDash * first) / dash; aLast = (aDash * last) / dash; }
  if (!(aDash > 0)) {
    if (kind === LK.GapCenters) return numGaps > 1 ? { locations: [0, len], atEnd: 0 } : { locations: [len / 2], atEnd: len / 2 };
    if (kind === LK.DashCenters || kind === LK.GapCentersOffset) return { locations: [], atEnd: len };
    return { locations: [0, len, 0], atEnd: 0 };
  }
  const loc = [];
  let atEnd;
  if (kind === LK.GapCenters) {
    if (numGaps === 0) atEnd = len;
    else { atEnd = aLast + gap / 2; loc.push(aFirst + gap / 2); for (let i = 1; i < numGaps; i++) loc.push(aDash + gap); }
  } else if (kind === LK.GapCentersDecrease) {
    if (numGaps === 0) atEnd = len;
    else {
      atEnd = aLast + gap / 2; loc.push(aFirst + gap / 2);
      if (numGaps > 1) {
        if (dk === DEC.Both) {
          let cur = (2 * aDash) / (1 + decLimit);
          if (numGaps % 2 === 1) {
            let delta = (cur - decLimit * cur) / (numGaps - 1);
            cur = decLimit * cur;
            for (let i = 1; i < numGaps; i++) { if (i === (numGaps + 1) / 2) delta = -delta; cur += delta; loc.push(cur + gap); cur += delta; }
          } else {
            let delta;
            if (numGaps === 2) delta = 0;
            else { delta = cur * ((1 - (1 - decLimit) / numGaps - decLimit) / (numGaps - 2)); cur = decLimit * cur; }
            for (let i = 1; i < numGaps; i++) {
              if (i !== numGaps / 2) cur += delta;
              loc.push(cur + gap);
              if (i === numGaps / 2) delta = -delta; else cur += delta;
            }
          }
        } else if (dk === DEC.LargeToSmall) {
          let cur = (2 * aDash) / (1 + decLimit);
          const delta = -(cur - decLimit * cur) / ((numGaps - 1) * 2);
          for (let i = 1; i < numGaps; i++) { cur += delta; loc.push(cur + gap); cur += delta; }
        } else if (dk === DEC.SmallToLarge) {
          let cur = (2 * aDash) / (1 + decLimit);
          const delta = (cur - decLimit * cur) / ((numGaps - 1) * 2);
          cur -= cur - decLimit * cur;
          for (let i = 1; i < numGaps; i++) { cur += delta; loc.push(cur + gap); cur += delta; }
        }
      }
    }
  } else if (kind === LK.GapCentersOffset) {
    if (numGaps <= 1) atEnd = len;
    else { atEnd = aLast + gap / 2 + aDash + gap - offset; loc.push(aFirst + gap / 2 + offset); for (let i = 1; i < numGaps - 1; i++) loc.push(aDash + gap); }
  } else {
    if (numGaps > 0) {
      if (nEndSec > 0 && aFirst >= first / 2) loc.push(...secondaryGaps(aFirst, nEndSec, lEndSec)); else loc.push(aFirst);
      for (let i = 1; i < numGaps; i++) {
        loc.push(gap);
        if (nMidSec > 0 && aDash >= dash / 2) loc.push(...secondaryGaps(aDash, nMidSec, lMidSec)); else loc.push(aDash);
      }
      loc.push(gap);
    }
    if (nEndSec > 0 && aLast >= last / 2 && numGaps > 0) loc.push(...secondaryGaps(aLast, nEndSec, lEndSec)); else loc.push(aLast);
    atEnd = loc[loc.length - 1];
  }
  return { locations: loc, atEnd };
}
function secondaryGaps(len, count, gap) {
  if (len > count * gap) {
    const d = (len - count * gap) / (count + 1), out = [d];
    for (let k = 0; k < count; k++) out.push(gap, d);
    return out;
  }
  return [len];
}
function removeZeroGaps(a) {
  let any = false;
  for (let i = 1; i < a.length - 2; i += 2) if (a[i] === 0) any = true;
  if (!any) return a;
  const l = a.slice();
  for (let i = a.length - 2; i >= 1; i -= 2) if (l[i] === 0) { l[i - 1] += l[i + 1]; l.splice(i, 2); }
  return l;
}
function dashCenters(a, closed) {
  if (a.length === 1) return [a[0] / 2];
  const out = [];
  let firstPos;
  if (closed) firstPos = a[0] >= a[a.length - 1] ? a[0] - (a[0] + a[a.length - 1]) / 2 : null;
  else firstPos = a[0] / 2;
  if (firstPos != null) out.push(firstPos);
  let len = a[0] - (firstPos ?? 0);
  for (let i = 1; i < (a.length + 1) / 2; i++) {
    const gi = i * 2 - 1, dl = a[gi + 1], gl = a[gi];
    if (dl > 0) {
      if (closed && i === (a.length - 1) / 2) { if (a[0] < a[a.length - 1]) out.push(len + gl + (a[0] + a[a.length - 1]) / 2); }
      else { out.push(len + gl + dl / 2); len = dl / 2; }
    } else len += dl + gl;
  }
  return out;
}

/** Several line symbols drawn together (OpenOrienteering Mapper's combined line symbols). */
export class LineComboSymDef extends SymDef {
  constructor(name, id, parts) { super(name, id); this.kind = "line"; this.partsDefs = parts; }
  finish() { for (const p of this.partsDefs) p.finish?.(); return this; }
  get hasDashes() { return this.partsDefs.some((p) => p.hasDashes); }
  get maxThick() { return Math.max(0, ...this.partsDefs.map((p) => p.maxThick || 0)); }
  hasColor(c) { return this.partsDefs.some((p) => p.hasColor(c)); }
  bounds(path) { return this.partsDefs.reduce((b, p) => rectUnion(b, p.bounds(path)), null) || path.bbox; }
  draw(g, path, color, ro) { for (const p of this.partsDefs) p.draw(g, path, color, ro); }
}

// ---- areas -----------------------------------------------------------------------------------------------------------------
export const ROTATE = { Always: 0, ManualOnly: 1, Never: 2 };
export const FILL = { Clip: 0, CompletelyInside: 1, CenterInside: 2, PartiallyInside: 3 };
export class AreaSymDef extends SymDef {
  constructor(name, id, fill, border = null) { super(name, id); this.kind = "area"; this.fill = fill; this.border = border; this.hatches = []; this.patterns = []; }
  hasColor(c) {
    if (c.special) return false;
    return c === this.fill || !!this.border?.hasColor(c) || this.hatches.some((h) => h.color === c) || this.patterns.some((p) => p.glyph.hasColor(c));
  }
  get hasDashes() { return !!this.border?.hasDashes; }
  bounds(area) { return this.border ? this.border.bounds(area.main) : area.bbox; }
  draw(g, area, color, angle, rcx, rcy, ro) {
    if (color === this.fill) g.fill(area.commands(), color);
    if (this.hatches.some((h) => h.color === color)) {
      g.clip(area.commands());
      for (const h of this.hatches) if (h.color === color) {
        const ang = h.rotate === ROTATE.Never ? 0 : angle, cx = h.rotate === ROTATE.Never ? 0 : rcx, cy = h.rotate === ROTATE.Never ? 0 : rcy;
        const m = new Matrix().translate(cx, cy).rotate(ang).rotate(h.angle);
        g.push(m);
        const inv = m.clone().invert(), b = transformRect(visiblePart(area.bbox, ro.view, h.width), inv);
        hatchLines(g, pen(color, h.width, "butt", "miter"), h.spacing, h.offset || 0, b);
        g.pop();
      }
      g.unclip();
    }
    for (const p of this.patterns) {
      if (!p.glyph.hasColor(color)) continue;
      const never = p.rotate === ROTATE.Never;
      this.drawPattern(p, g, area, never ? 0 : angle, never ? 0 : rcx, never ? 0 : rcy, color, ro);
    }
    if (this.border?.hasColor(color)) {
      this.border.draw(g, area.main, color, ro);
      if (area.holes) for (const h of area.holes) this.border.draw(g, h, color, ro);
    }
  }
  drawPattern(p, g, area, angle, rcx, rcy, color, ro) {
    const m = new Matrix().translate(rcx, rcy).rotate(angle).rotate(p.angle).translate(p.offsetX || 0, p.offsetY || 0);
    // on the screen, a regular pattern clipped to the area is one fill with a tile of the pattern
    if (g.patternFill && p.fillMode === FILL.Clip && !p.irregular && g.patternFill(area.commands(), p, color, m)) return;
    if (p.fillMode === FILL.Clip) g.clip(area.commands());
    g.push(m);
    const inv = m.clone().invert(), bound = transformRect(visiblePart(area.bbox, ro.view, p.glyph.radius + Math.max(p.width, p.height)), inv);
    const local = p.fillMode === FILL.Clip ? null : area.transform(inv);
    let filter = null;
    if (p.fillMode === FILL.CompletelyInside) filter = (pts) => pts.every(([x, y]) => local.isInside(x, y));
    else if (p.fillMode === FILL.CenterInside) filter = (pts, c) => local.isInside(c[0], c[1]);
    else if (p.fillMode === FILL.PartiallyInside) filter = (pts) => pts.some(([x, y]) => local.isInside(x, y));
    // the rows of the pattern covering the area (Purple Pen's DrawPatternRows)
    const gb = rotatedRect(p.glyph.box, 0, 0, -p.angle), pw = p.width, ph = p.height;
    const pb = [-pw / 2, -ph / 2, pw / 2, ph / 2];
    // Purple Pen's rectangles have Top = min y, Bottom = max y
    const topCount = Math.round((bound[1] - gb[3] + pb[3]) / ph);
    const top = topCount * ph, bottom = (Math.round((bound[3] - gb[1] + pb[1]) / ph) + 0.5) * ph;
    const left = Math.round((bound[0] - gb[2] + pb[2]) / pw) * pw, right = (Math.round((bound[2] - gb[0] + pb[0]) / pw) + 0.5) * pw;
    let offsetLine = p.offsetRows && (topCount & 1) !== 0;
    const count = ((bottom - top) / ph) * ((right - left) / pw);
    if (count > 400000) { g.pop(); if (p.fillMode === FILL.Clip) g.unclip(); return; }   // a pattern too fine to draw at this size
    for (let y = top; y <= bottom; y += ph) {
      const l = offsetLine ? left - pw / 2 : left, r = offsetLine ? right + pw / 2 : right;
      for (let x = l; x <= r; x += pw) {
        const [px, py] = p.irregular ? irregular(p, x, y) : [x, y];
        p.glyph.draw(g, px, py, -p.angle, null, null, color, filter);
      }
      if (p.offsetRows) offsetLine = !offsetLine;
    }
    g.pop();
    if (p.fillMode === FILL.Clip) g.unclip();
  }
}
/** The part of an area's box in view (with a margin), or the box itself when no view is given. */
function visiblePart(box, view, margin = 0) {
  if (!view) return box;
  const l = Math.max(box[0], view[0] - margin), b = Math.max(box[1], view[1] - margin), r = Math.min(box[2], view[2] + margin), t = Math.min(box[3], view[3] + margin);
  return r >= l && t >= b ? [l, b, r, t] : [box[0], box[1], box[0], box[1]];
}
function hatchLines(g, p, spacing, offset, b) {
  if (!(spacing > 0)) return;
  const first = Math.round((b[1] - offset) / spacing) * spacing + offset, last = (Math.round((b[3] - offset) / spacing) + 0.5) * spacing + offset;
  if ((last - first) / spacing > 20000) return;
  const cmds = [];
  for (let y = first; y <= last; y += spacing) cmds.push(["M", b[0], y], ["L", b[2], y]);
  if (cmds.length) g.stroke(cmds, p);
}
/** A pattern element moved at random, the same way wherever the areas overlap (seeded by its place). */
function irregular(p, x, y) {
  let mx = Math.min((p.width / 2) * p.varX, p.width / 2 - p.glyph.radius), my = Math.min((p.height / 2) * p.varY, p.height / 2 - p.glyph.radius);
  mx = Math.min(mx, mx - p.minDist * 0.5);
  my = p.offsetRows ? Math.min(my, (p.height - (p.glyph.radius * 2 + p.minDist) * 0.85) * 0.5) : Math.min(my, my - p.minDist * 0.5);
  mx = Math.max(0, mx); my = Math.max(0, my);
  let s = (Math.round(x * 100) * 73856093) ^ (Math.round(y * 100) * 19349663);
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  return [x + (rnd() * 2 - 1) * mx, y + (rnd() * 2 - 1) * my];
}
/** Several symbols drawn together as one area (OpenOrienteering Mapper's combined area symbols). */
export class AreaComboSymDef extends SymDef {
  constructor(name, id, parts) { super(name, id); this.kind = "area"; this.partsDefs = parts; }
  hasColor(c) { return this.partsDefs.some((p) => p.hasColor(c)); }
  get hasDashes() { return this.partsDefs.some((p) => p.hasDashes); }
  bounds(area) { return this.partsDefs.reduce((b, p) => rectUnion(b, p.kind === "line" ? p.bounds(area.main) : p.bounds(area)), null) || area.bbox; }
  draw(g, area, color, angle, rcx, rcy, ro) {
    for (const p of this.partsDefs) {
      if (p.kind === "line") { p.draw(g, area.main, color, ro); if (area.holes) for (const h of area.holes) p.draw(g, h, color, ro); }
      else p.draw(g, area, color, angle, rcx, rcy, ro);
    }
  }
}

// ---- text -------------------------------------------------------------------------------------------------------------------
export const HALIGN = { Default: 0, Left: 1, Right: 2, Center: 3, Justified: 4 };
export const VALIGN = { Default: 0, TopAscent: 1, Midpoint: 2, Baseline: 3, BaselineLast: 4, MidpointAllLines: 5, Bottom: 6 };
export const PARA = " ";
// font metrics (em fractions): GDI's cell ascent and descent and the cap height of the faces each name prints as
// (and GDI's recommended line spacing: ascent + descent + line gap)
const METRICS = { Arial: [0.9053, 0.2119, 0.716, 1.1499], Times: [0.8911, 0.2163, 0.662, 1.1499], Courier: [0.8325, 0.3003, 0.571, 1.1328], Roboto: [0.9277, 0.2441, 0.711, 1.1719], "Roboto Condensed": [0.9277, 0.2441, 0.711, 1.1719] };
/** The metrics of a face at a size (mm): ascent, descent, cap height, space width and the width of any text. */
export function faceMetrics(name, size, bold = false, italic = false) {
  const fam = fontFamily(name), [a, d, c, ls] = METRICS[fam] || METRICS.Arial;
  return { fam, name, size, bold, italic, ascent: a * size, descent: d * size, capHeight: c * size, em: size, lineSpacing: ls * size,
    width: (s) => textWidth(s, bold, fam, italic) * size, get space() { return textWidth(" ", bold, fam, italic) * size; } };
}
const nextSegment = (s) => { if (!s) return null; if (s[0] === " ") return " "; if (s[0] === "\t") return "\t"; let i = 0; while (i < s.length && s[i] !== " " && s[i] !== "\t") i++; return s.slice(0, i); };
const nextGrapheme = (s) => (s ? [...s][0] : "");

export class TextSymDef extends SymDef {
  constructor(name, id, preferred = "normal", centerPoint = null) {
    super(name, id); this.kind = "text"; this.preferred = preferred; this.centerPoint = centerPoint;
    this.framing = { style: "none" }; this.underline = { on: false };
  }
  setFont({ font, size, bold = false, italic = false, underlineEffect = false, color, lineSpacing, paraSpacing = 0, firstIndent = 0, restIndent = 0, tabs = null, charSpacing = 0, wordSpacing = 1, halign = HALIGN.Left, valign = VALIGN.Baseline }) {
    Object.assign(this, { font, size, bold, italic, underlineEffect, color, lineSpacing: lineSpacing ?? size, paraSpacing, firstIndent, restIndent, tabs, charSpacing, wordSpacing, halign, valign });
    this.m = faceMetrics(font, size, bold, italic);
  }
  hasColor(c) {
    if (c.special) return false;
    return c === this.color || (this.framing.style !== "none" && c === this.framing.color) || (this.underline.on && c === this.underline.color) || !!this.centerPoint?.hasColor(c);
  }
  hAlign(h) { return h && h !== HALIGN.Default ? h : this.halign && this.halign !== HALIGN.Default ? this.halign : HALIGN.Left; }
  vAlign(v) { return v && v !== VALIGN.Default ? v : this.valign && this.valign !== VALIGN.Default ? this.valign : VALIGN.TopAscent; }
  get ascent() { return this.m.ascent; }
  get descent() { return this.m.descent; }
  get wHeight() { return this.m.capHeight; }
  textHeight(lines) {
    let paras = 0; for (const l of lines) if (l === PARA) paras++;
    return this.ascent + this.descent + (lines.length - paras - 1) * this.lineSpacing + paras * this.paraSpacing;
  }
  vertOffset(v, lines) {
    switch (this.vAlign(v)) {
      case VALIGN.TopAscent: return 0;
      case VALIGN.Baseline: return this.ascent;
      case VALIGN.Bottom: return this.ascent + this.descent;
      case VALIGN.Midpoint: return this.ascent / 2;
      case VALIGN.MidpointAllLines: return (this.textHeight(lines) - this.descent) / 2;
      case VALIGN.BaselineLast: return this.textHeight(lines) - this.descent;
      default: return 0;
    }
  }
  lineTextVertOffset(v) {
    switch (this.vAlign(v)) {
      case VALIGN.TopAscent: return this.ascent - this.wHeight;
      case VALIGN.Baseline: return this.ascent;
      case VALIGN.Bottom: return this.ascent + this.descent;
      default: return this.ascent - this.wHeight / 2;
    }
  }
  segWidth(text, soFar) {
    if (text === " ") return this.m.space * this.wordSpacing;
    if (text === "\t") {
      const tabs = this.tabs;
      if (!tabs?.length) return 0;
      for (const t of tabs) if (t > soFar) return t - soFar;
      let stop, inc;
      if (tabs.length > 2 && tabs[tabs.length - 1] > tabs[tabs.length - 2]) { stop = tabs[tabs.length - 1]; inc = tabs[tabs.length - 1] - tabs[tabs.length - 2]; }
      else stop = inc = tabs[tabs.length - 1];
      if (!(inc > 0)) return 0;
      for (;;) { if (stop > soFar) return stop - soFar; stop += inc; }
    }
    if (this.charSpacing > 0) { let w = 0; for (const ch of text) w += this.m.width(ch) + this.charSpacing * this.m.space; return w; }
    return this.m.width(text);
  }
  lineWidth(text) { let w = 0, s; while ((s = nextSegment(text))) { w += this.segWidth(s, w); text = text.slice(s.length); } return w; }
  /** Unwrapped lines: a paragraph mark between each. */
  unwrapped(lines) {
    const out = [], widths = [];
    lines.forEach((l, i) => { out.push(l); widths.push(this.lineWidth(l)); if (i !== lines.length - 1) { out.push(PARA); widths.push(0); } });
    return { lines: out, widths, wrapped: false };
  }
  /** Lines wrapped to a width (formatted text). */
  wrap(lines, width, h) {
    const align = this.hAlign(h), out = [], widths = [];
    let wrapped = false;
    const w1 = align === HALIGN.Left || align === HALIGN.Justified ? Math.max(0, width - this.firstIndent) : width;
    const w2 = align === HALIGN.Left || align === HALIGN.Justified ? Math.max(0, width - this.restIndent) : width;
    lines.forEach((text, i) => {
      let first = true, count = 0;
      while (text != null) {
        const r = this.wrapOne(text, first ? w1 : w2);
        out.push(r.line); widths.push(r.width); text = r.rest; first = false; count++;
      }
      if (count > 1) wrapped = true;
      if (i < lines.length - 1) { out.push(PARA); widths.push(0); }
    });
    return { lines: out, widths, wrapped };
  }
  wrapOne(line, width) {
    let so = "", used = 0, single = false;
    while (line) {
      const seg = single ? nextGrapheme(line) : nextSegment(line);
      if (!seg) break;
      const w = this.segWidth(seg, used);
      if (w + used > width) {
        if (used === 0) { if (!single) { single = true; continue; } }
        else break;
      }
      so += seg; line = line.slice(seg.length); used += w;
    }
    if (line.length > 0) {
      while (so.endsWith(" ")) { so = so.slice(0, -1); used -= this.segWidth(" ", used); }
      line = line.replace(/^ +/, "");
    }
    return { line: so, width: used, rest: line === "" ? null : line };
  }
  fullWidth(widths, full, h) {
    if (full !== 0) return full;
    let f = Math.max(0, ...widths);
    const a = this.hAlign(h);
    if (a === HALIGN.Justified || a === HALIGN.Left) f += this.firstIndent;
    return f;
  }
  bounds(lines, widths, x, y, angle, full, h, v) {
    const height = this.textHeight(lines), fw = this.fullWidth(widths, full, h), a = this.hAlign(h);
    let l = a === HALIGN.Right ? x - fw : a === HALIGN.Center ? x - fw / 2 : x;
    // Purple Pen's rectangle (Top = y − height) then offset by the vertical alignment: in y-up mm, the text spans down from the top
    let b = y - height, r = l + fw, t = y;
    if (this.underline.on) b -= this.underline.distance + this.underline.width;
    if (this.framing.style === "line") { l -= this.framing.width; b -= this.framing.width; r += this.framing.width; t += this.framing.width; }
    else if (this.framing.style === "shadow") { l = Math.min(l, l + this.framing.dx); r = Math.max(r, r + this.framing.dx); b = Math.min(b, b + this.framing.dy); t = Math.max(t, t + this.framing.dy); }
    else if (this.framing.style === "rect") { l -= this.framing.left; b -= this.framing.bottom; r += this.framing.right; t += this.framing.top; }
    const off = this.vertOffset(v, lines);
    b += off; t += off;
    let rect = [l, b, r, t];
    if (angle) rect = rotatedRect(rect, x, y, angle);
    return rect;
  }
  drawString(g, color, text, x, y) {
    if (this.color && color === this.color) g.text(text, this.m, color, x, y);
    const f = this.framing;
    if (f.style !== "none" && f.color && color === f.color) {
      if (f.style === "line") {
        g.text(text, this.m, f.color, x, y);
        // widening outlines, as Purple Pen (several pens avoid artefacts where strokes overlap)
        for (let w = this.size * 0.33; w < f.width * 2; w += this.size * 0.33) g.textOutline(text, this.m, penStyle(f.color, w, "beveled"), x, y);
        g.textOutline(text, this.m, penStyle(f.color, f.width * 2, f.lineStyle || "mitered"), x, y);
      } else if (f.style === "shadow") g.text(text, this.m, f.color, x + f.dx, y - f.dy);
    }
  }
  drawUnderline(g, u, color, baseline, width, indent, align) {
    if (!u.on || !color || color !== u.color) return;
    const l = align === HALIGN.Right ? -width : align === HALIGN.Center ? -width / 2 : indent;
    const y = baseline + u.distance + u.width / 2;
    g.stroke([["M", l, y], ["L", l + width, y]], penStyle(u.color, u.width, "mitered"));
  }
  /** Draw lines of text at (x, y) turned by angle (degrees). */
  draw(g, lines, widths, x, y, angle, full, color, h, v) {
    const align = this.hAlign(h), va = this.vAlign(v);
    const f = this.framing;
    if (this.color && color !== this.color && (f.style === "none" || color !== f.color) && (!this.underline.on || color !== this.underline.color) && !this.centerPoint?.hasColor(color)) return;
    const effect = { on: !!this.underlineEffect, color: this.color, distance: this.size * 0.02, width: this.size * 0.05 };
    const m = new Matrix().translate(x, y).scale(1, -1);
    if (angle) m.rotateAt(-angle, 0, 0);
    g.push(m);
    let px = 0, py = -this.vertOffset(va, lines), baseline = 0, firstOfPara = true;
    const top = py;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], lw = widths[i], lastOfPara = i === lines.length - 1 || lines[i + 1] === PARA;
      if (line === PARA) { py += this.paraSpacing; firstOfPara = true; continue; }
      let indent = 0, leftEdge;
      if (align === HALIGN.Right) px = leftEdge = -lw;
      else if (align === HALIGN.Center) px = leftEdge = -lw / 2;
      else { leftEdge = 0; px = indent = firstOfPara ? this.firstIndent : this.restIndent; }
      let space = this.wordSpacing * this.m.space;
      if (align === HALIGN.Justified && !lastOfPara && full > 0) { const n = (line.match(/ /g) || []).length; if (n) space += (full - indent - lw) / n; }
      let idx = 0;
      for (;;) {
        const seg = this.charSpacing > 0 ? nextGrapheme(line.slice(idx)) : nextSegment(line.slice(idx));
        if (!seg) break;
        if (seg === " ") px += space;
        else if (seg === "\t") px += this.segWidth("\t", px - leftEdge);
        else {
          this.drawString(g, color, seg, px, py);
          px += this.m.width(seg);
          if (this.charSpacing > 0) px += this.charSpacing * this.m.space;
        }
        idx += seg.length;
      }
      baseline = py + this.ascent;
      this.drawUnderline(g, effect, color, baseline, lw, indent, align);
      if (lastOfPara) this.drawUnderline(g, this.underline, color, baseline, Math.max(full, lw), full === 0 ? indent : 0, align);
      py += this.lineSpacing; firstOfPara = false;
    }
    // the centre point symbol (unformatted text only)
    if (this.centerPoint && this.centerPoint.hasColor(color) && full === 0) {
      const fw = this.fullWidth(widths, full, align);
      const l = align === HALIGN.Right ? -fw : align === HALIGN.Center ? -fw / 2 : 0, r = l + fw;
      const t = top - (this.ascent + this.descent) + this.size, b = baseline + this.descent;
      g.push(new Matrix().translate((l + r) / 2, (t + b) / 2).scale(1, -1));
      this.centerPoint.draw(g, 0, 0, 0, null, color);
      g.pop();
    }
    let bottom = baseline;
    if (this.underline.on) bottom += this.underline.distance + this.underline.width;
    if (f.style === "rect" && color === f.color) {
      const fw = this.fullWidth(widths, full, align);
      const l = align === HALIGN.Right ? -fw : align === HALIGN.Center ? -fw / 2 : 0, r = l + fw;
      const t = top + this.ascent - this.wHeight;
      g.fillRect([l - f.left, t - f.top, r + f.right, bottom + f.bottom], color);
    }
    g.pop();
  }
  /** Text along a path (OCAD's line text, with its « Bizarro » metric). */
  drawOnPath(g, path, text, color, h, v) {
    if (!color) return;
    const f = this.framing;
    if (color !== this.color && (f.style === "none" || color !== f.color)) return;
    const list = this.placements(path, text, this.hAlign(h));
    const ty = -this.lineTextVertOffset(v);
    for (const gp of list) {
      g.push(new Matrix().translate(gp.x, gp.y).scale(1, -1).rotateAt(-gp.angle, 0, 0));
      this.drawString(g, color, gp.text, 0, ty);
      g.pop();
    }
  }
  placements(path, text, align) {
    const len = path.bizarroLength, list = [];
    if (!len) return list;
    let total = 0;
    for (const ch of [...(text || "")]) {
      const w = ch === " " ? this.wordSpacing * this.m.space : this.m.width(ch) + this.charSpacing * this.m.space;
      list.push({ text: ch, w }); total += w;
      if (total + 0.01 >= len && align !== HALIGN.Justified) break;
    }
    if (len < total && align !== HALIGN.Left && align !== HALIGN.Justified) {
      total -= list[list.length - 1].w;
      if (align === HALIGN.Right) list.pop();
    }
    let start = 0;
    if (align === HALIGN.Right) start = len - total; else if (align === HALIGN.Center) start = (len - total) / 2;
    if (align === HALIGN.Justified && list.length > 1) {
      if (this.charSpacing > 0) { list[list.length - 1].w -= this.charSpacing * this.m.space; total -= this.charSpacing * this.m.space; }
      const adj = (len - total) / (list.length - 1);
      for (let i = 0; i < list.length - 1; i++) list[i].w += adj;
    }
    const pts = [];
    let d = start;
    for (const gp of list) { pts.push(path.pointAtLength(d, bizarro)); d += gp.w; }
    pts.push(path.pointAtLength(Math.min(d, len), bizarro));
    list.forEach((gp, i) => { gp.x = pts[i][0]; gp.y = pts[i][1]; gp.angle = (Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]) * 180) / Math.PI; });
    return list;
  }
  pathBounds(path) {
    const d = this.ascent + this.descent + (this.framing.style === "line" ? this.framing.width : this.framing.style === "shadow" ? Math.max(this.framing.dx, this.framing.dy) : 0);
    const b = path.bbox;
    return [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
  }
  /** OCAD aligns text a little differently: the shift its stored position needs. */
  ocadTopAdjustment(formatted, version) {
    if (formatted) return this.size - (this.ascent + this.descent) - this.vertOffset(this.valign, [" "]);
    if (version >= 10) {
      if (this.valign === VALIGN.TopAscent) return this.ascent - this.wHeight;
      if (this.valign === VALIGN.Midpoint) return (this.ascent - this.wHeight) / 2;
      return 0;
    }
    return this.ascent - this.vertOffset(this.valign, [" "]);
  }
  ocadFormattedHorizAdjustment(width) { return this.halign === HALIGN.Right ? width : this.halign === HALIGN.Center ? width / 2 : 0; }
}

// ---- rectangles (OCAD's rectangle symbols, with their optional grid of numbered cells) -------------------------------------
export class RectangleSymDef extends SymDef {
  constructor(name, id, color, width, radius, gridFlags, cellW, cellH, textSize, unnumbered, unnumberedText) {
    super(name, id); this.kind = "rect";
    Object.assign(this, { color, width, radius, gridFlags, cellW, cellH, textSize, unnumbered, unnumberedText });
  }
  hasColor(c) { return !c.special && this.color === c; }
  path(x, y, w, h, rot) { const p = SymPath.roundedRect(x, y, w, h, this.radius); return rot ? p.transform(new Matrix().rotateAt(rot, x, y)) : p; }
  bounds(x, y, w, h, rot) { const b = [x - this.width / 2, y - this.width / 2, x + w + this.width / 2, y + h + this.width / 2]; return rot ? rotatedRect(b, x, y, rot) : b; }
  draw(g, x, y, w, h, rot, color) {
    if (!w && !h) return;
    if (this.color && color === this.color && this.width > 0) g.stroke(this.path(x, y, w, h, rot).commands(), penStyle(color, this.width, this.radius > 0 ? "rounded" : "mitered"));
    if (this.gridFlags & 1 && this.color && color === this.color && w > 0 && h > 0) {
      g.push(new Matrix().translate(x, y).rotate(rot));
      const cx = Math.max(1, Math.round(w / this.cellW)), cy = Math.max(1, Math.round(h / this.cellH)), cw = w / cx, ch = h / cy;
      const cmds = [];
      for (let i = 1; i < cx; i++) cmds.push(["M", i * cw, 0], ["L", i * cw, h]);
      for (let j = 1; j < cy; j++) cmds.push(["M", 0, j * ch], ["L", w, j * ch]);
      if (cmds.length) g.stroke(cmds, penStyle(color, 0.15, "beveled"));
      if (this.gridFlags & 2) {
        const m = faceMetrics("Arial", this.textSize, true);
        for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
          const num = this.gridFlags & 4 ? j * cx + i + 1 : (cy - 1 - j) * cx + i + 1;
          const text = num > cx * cy - this.unnumbered ? this.unnumberedText : String(num);
          g.push(new Matrix().translate(i * cw + this.textSize * 0.28, (j + 1) * ch - this.textSize * 0.17).scale(1, -1));
          g.text(text, m, color, 0, 0);
          g.pop();
        }
      }
      g.pop();
    }
  }
}

/** The symbols an OCAD object broke apart into (« To graphics »): each its own colour and shape. */
export class GraphicsSymDef extends SymDef {
  constructor() { super("Graphics object", "-2"); this.kind = "graphics"; }
  hasColor(c) { return !c.special; }
}
/** Image and layout objects of an OCAD map: drawn below (image) or above (layout) every colour. */
export class ImageSymDef extends SymDef {
  constructor(layer) { super(layer === "image" ? "Image object" : "Layout object", layer === "image" ? "-3" : "-4"); this.kind = "image"; this.layer = layer; this.sortSymbols = true; }
  hasColor(c) { return c.layer === this.layer; }
}
