// The control description symbols' map equivalents (owner, 2026-10-30; « Définitions de postes », and the Tracer's guide
// later): for an IOF symbol id (Purple Pen's, tracer/symbols.js), a small drawing of the feature as an orienteering map
// shows it, in ISOM 2017-2 / ISSprOM 2019-2 colours and symbols, the control circle on it. Our own schematic drawings, not
// to scale: a map's paper is white whatever the site's theme. Columns D (the features), C (which of similar features), E
// (a few details), F (crossings, junctions, bends) and G (where the flag stands); column H and the special instructions
// have none. The directional families (C, G) are drawn for north and turned.

/** ISOM's colours, as printed (approximately) in RGB. */
export const MAP_COLOURS = {
  paper: "#ffffff", black: "#1c1c1c", brown: "#c8641a", blue: "#00a0e2", yellow: "#ffba36", yellow50: "#ffdd9b",
  green20: "#c9eac4", green50: "#8fd18c", green: "#3eb34a", olive: "#a2a136", rock: "#b8b8b8", building: "#6b6b6b",
  canopy: "#cfcfcf", paved: "#ebc8a5", purple: "#b5229b",
};
const K = MAP_COLOURS;

// ---- drawing helpers (a 100 × 100 box, y down, north up) -------------------------------------------------------------
const f = (v) => +v.toFixed(1);
const pt = (p) => `${f(p[0])},${f(p[1])}`;
const poly = (pts, close = false) => `M${pts.map(pt).join("L")}${close ? "Z" : ""}`;
/** A smooth curve through points (Catmull-Rom as cubic Béziers). */
function smooth(p, closed = false) {
  const n = p.length, P = (i) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${pt(p[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${pt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${pt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${pt(p2)}`;
  }
  return closed ? `${d}Z` : d;
}
const stroke = (d, col, w, extra = "") => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const fill = (d, col, edge = "", w = 1.2) => `<path d="${d}" fill="${col}"${edge ? ` stroke="${edge}" stroke-width="${w}" stroke-linejoin="round"` : ""}/>`;
const dash = (a, b) => ` stroke-dasharray="${a} ${b}" stroke-linecap="butt"`;
const dot = (x, y, r, col) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="${col}"/>`;
const ring = (x, y, r, col, w) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
const cross = (x, y, s, col, w) => stroke(`M${x - s},${y - s}L${x + s},${y + s}M${x - s},${y + s}L${x + s},${y - s}`, col, w);
/** The control circle, and the flag's spot when it matters (columns C and G). */
const ctl = (x = 50, y = 50, r = 21, spot = false) => ring(x, y, r, K.purple, 2.8) + (spot ? dot(x, y, 1.8, K.purple) : "");
const rect = (col) => `<rect width="100" height="100" fill="${col}"/>`;
/** A closed blob around a centre (deterministic wobble). */
function blob(cx, cy, rx, ry, seed = 1, n = 9, wob = 0.12) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + wob * Math.sin(seed * 7.3 + i * 2.1) * Math.cos(seed * 3.1 + i * 1.3);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smooth(pts, true);
}
/** Points scattered in a disc (deterministic). */
function scatter(cx, cy, r, n, seed = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + seed, d = r * Math.sqrt((i + 0.5) / n) * (0.85 + 0.15 * Math.sin(i * 12.9898 + seed));
    out.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
  }
  return out;
}
/** Ticks along a polyline, on its right (side 1) or left (side -1). */
function ticks(pts, len, step, side = 1, startAt = step / 2) {
  let d = "", carry = startAt;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    let s = carry;
    for (; s <= L; s += step) {
      const x = x0 + ux * s, y = y0 + uy * s;
      d += `M${f(x)},${f(y)}L${f(x - uy * len * side)},${f(y + ux * len * side)}`;
    }
    carry = s - L;
  }
  return d;
}
/** Dots along a polyline. */
function dotsAlong(pts, r, step, col) {
  let out = "", carry = step / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0);
    let s = carry;
    for (; s <= L; s += step) out += dot(x0 + ((x1 - x0) * s) / L, y0 + ((y1 - y0) * s) / L, r, col);
    carry = s - L;
  }
  return out;
}
/** Horizontal marsh lines inside an ellipse (or the whole box). */
function hatch(cx, cy, rx, ry, gap = 5.5, w = 1.6) {
  let d = "";
  for (let y = cy - ry + gap / 2; y < cy + ry; y += gap) {
    const h = rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
    if (h > 2) d += `M${f(cx - h)},${f(y)}L${f(cx + h)},${f(y)}`;
  }
  return stroke(d, K.blue, w, ' stroke-linecap="butt"');
}
/** A tapered stroke (an erosion gully) along a polyline. */
function taper(pts, w) {
  const left = [], right = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, h = (w / 2) * Math.sqrt(Math.sin((Math.PI * i) / (pts.length - 1))) + 0.3;
    left.push([p[0] + nx * h, p[1] + ny * h]); right.unshift([p[0] - nx * h, p[1] - ny * h]);
  });
  return fill(smooth([...left, ...right], true), K.brown);
}
/** A point feature drawn larger than its place on a real map, to be read at a thumbnail's size. */
const big = (body) => `<g transform="translate(50 50) scale(1.35) translate(-50 -50)">${body}</g>`;
const turn = (deg, body) => `<g transform="rotate(${deg} 50 50)">${body}</g>`;

// shapes used more than once
const contourU = (y0, depth, up = false) => { // a contour across the box bent down (a spur) or up (a re-entrant)
  const s = up ? -1 : 1;
  return [[-2, y0], [24, y0 + s * 3], [38, y0 + s * depth * 0.7], [50, y0 + s * depth], [62, y0 + s * depth * 0.7], [76, y0 + s * 3], [102, y0]];
};
const spur = () => [[16, 12], [36, 20], [56, 28]].map(([y, d]) => stroke(smooth(contourU(y, d)), K.brown, 2.2)).join("");
const reentrant = () => [[44, 28], [64, 20], [84, 12]].map(([y, d]) => stroke(smooth(contourU(y, d, true)), K.brown, 2.2)).join("");
const cliffLine = [[8, 46], [30, 50], [52, 45], [72, 49], [92, 44]];
const cliff = (pts = cliffLine, side = 1) => stroke(poly(pts), K.black, 3) + stroke(ticks(pts, 6.5, 7.5, side), K.black, 1.6, ' stroke-linecap="butt"');
const path = (d, w = 2.2) => stroke(d, K.black, w, dash(7, 3.2));
const stream = (d, w = 3) => stroke(d, K.blue, w);
const knoll = (x = 50, y = 50, r = 6) => ring(x, y, r, K.brown, 2.4);
const boulder = (x = 50, y = 50, r = 3.4) => dot(x, y, r, K.black);
const roadBand = (y = 50, h = 11) => fill(`M-2,${y - h / 2}C30,${y - h / 2 - 3} 70,${y - h / 2 + 3} 102,${y - h / 2}L102,${y + h / 2}C70,${y + h / 2 + 3} 30,${y + h / 2 - 3} -2,${y + h / 2}Z`, K.paved)
  + stroke(`M-2,${y - h / 2}C30,${y - h / 2 - 3} 70,${y - h / 2 + 3} 102,${y - h / 2}M-2,${y + h / 2}C30,${y + h / 2 - 3} 70,${y + h / 2 + 3} 102,${y + h / 2}`, K.black, 1.6);
const wall = (pts) => stroke(poly(pts), K.black, 1.5) + dotsAlong(pts, 1.7, 8, K.black);
const fence = (pts) => stroke(poly(pts), K.black, 1.4) + stroke(ticks(pts, 4.5, 7, -1), K.black, 1.2);
const tick = (x, y, len = 6) => stroke(`M${x},${y}L${x},${y + len}`, K.brown, 2); // a slope line, downhill to the south

// ---- the drawings, by IOF id ------------------------------------------------------------------------------------------
const D = {
  // landforms
  "1.1": () => stroke(smooth([[-2, 22], [40, 18], [102, 24]]), K.brown, 2.2) + stroke(smooth([[-2, 36], [22, 38], [32, 56], [50, 60], [68, 56], [78, 38], [102, 36]]), K.brown, 2.2)
    + tick(50, 60) + stroke(smooth([[-2, 76], [50, 80], [102, 75]]), K.brown, 2.2) + ctl(50, 50),
  "1.2": () => spur() + tick(50, 56) + ctl(50, 54),
  "1.3": () => reentrant() + tick(50, 44) + ctl(50, 46),
  "1.4": () => { const p = [[6, 42], [28, 46], [50, 43], [72, 48], [94, 44]]; return stroke(poly(p), K.brown, 2.6) + stroke(ticks(p, 6, 6.5, 1), K.brown, 1.6, ' stroke-linecap="butt"') + ctl(50, 47); },
  "1.5": () => { const p = [[26, 74], [22, 44], [36, 26], [64, 26], [78, 44], [74, 74]]; return stroke(smooth(p), K.black, 3) + stroke(ticks(p, 6, 7, 1), K.black, 1.6, ' stroke-linecap="butt"') + ctl(50, 50, 24); },
  "1.6": () => stroke(smooth([[6, 60], [30, 52], [52, 50], [74, 44], [96, 40]]), K.brown, 4.4) + ctl(50, 50),
  "1.7": () => taper([[52, 4], [46, 20], [53, 36], [48, 52], [54, 68], [49, 84], [52, 98]], 5.5) + ctl(50, 50),
  "1.8": () => dotsAlong([[50, 4], [46, 26], [53, 48], [48, 72], [52, 98]], 1.8, 6.5, K.brown) + ctl(50, 50),
  "1.9": () => [[34, 30, 1], [22, 19, 2], [10, 8, 3]].map(([rx, ry, s]) => stroke(blob(50, 50, rx, ry, s), K.brown, 2.2)).join("") + ctl(50, 50, 19),
  "1.10": () => big(stroke(blob(50, 50, 6.5, 5.5, 2, 7, 0.08), K.brown, 2.4)) + ctl(),
  "1.11": () => stroke(blob(28, 50, 10, 8, 1), K.brown, 2.2) + stroke(blob(74, 50, 10, 8, 2), K.brown, 2.2)
    + stroke(smooth([[50, 41], [70, 31], [92, 38], [96, 52], [90, 66], [70, 70], [50, 60], [30, 70], [8, 64], [4, 50], [10, 36], [30, 31]], true), K.brown, 2.2) + ctl(50, 50, 17),
  "1.12": () => { const r = 14; let t = ""; for (const a of [0, 1, 2, 3, 4, 5]) { const x = Math.cos(a * 1.0472 + 0.5), y = Math.sin(a * 1.0472 + 0.5); t += `M${f(50 + x * r)},${f(50 + y * r)}L${f(50 + x * (r - 5))},${f(50 + y * (r - 5))}`; }
    return stroke(blob(50, 50, r, r * 0.85, 4, 9, 0.06), K.brown, 2.2) + stroke(t, K.brown, 1.8) + ctl(50, 50, 24); },
  "1.13": () => big(stroke("M43,46A7,7 0 0 0 57,46", K.brown, 2.4)) + ctl(),
  "1.14": () => big(stroke("M44,44L50,56L56,44", K.brown, 2.4)) + ctl(),
  "1.15": () => scatter(50, 50, 30, 26, 3).map(([x, y]) => dot(x, y, 1.5, K.brown)).join("") + ctl(),
  "1.16": () => big(cross(50, 50, 5, K.brown, 2.4)) + ctl(),
  // rocks and boulders
  "2.1": () => cliff() + ctl(50, 48),
  "2.2": () => big(fill(poly([[45, 42], [53, 40], [57, 47], [55, 58], [47, 60], [43, 51]], true), K.black)) + ctl(),
  "2.3": () => stroke(smooth([[-2, 40], [30, 36], [50, 40], [70, 35], [102, 38]]), K.brown, 2.2) + stroke("M44,60L50,47L56,60", K.black, 2.4) + ctl(50, 52),
  "2.4": () => big(boulder()) + ctl(),
  "2.5": () => scatter(50, 50, 30, 11, 5).map(([x, y]) => fill(poly([[x, y - 3.4], [x + 3, y + 2], [x - 3, y + 2]], true), K.black)).join("") + ctl(),
  "2.6": () => big(fill(poly([[50, 43], [57, 55], [43, 55]], true), K.black)) + ctl(),
  "2.7": () => scatter(50, 50, 32, 34, 7).map(([x, y]) => dot(x, y, 1.1, K.black)).join("") + ctl(),
  "2.8": () => fill(blob(52, 50, 26, 18, 6), K.rock) + ctl(),
  "2.9": () => cliff([[38, 6], [41, 28], [37, 50], [41, 72], [38, 94]], -1) + cliff([[62, 94], [59, 72], [63, 50], [59, 28], [62, 6]], -1) + ctl(50, 50, 18),
  "2.10": () => { const p = [[6, 58], [24, 48], [40, 56], [58, 44], [76, 52], [94, 42]]; return stroke(poly(p), K.black, 1.8) + stroke(ticks(p, 3.5, 6, 1) + ticks(p, 3.5, 6, -1), K.black, 1.2) + ctl(50, 50); },
  // water and marshes
  "3.1": () => fill(blob(70, 72, 44, 36, 2), K.blue, K.black, 1.6) + ctl(40, 42),
  "3.2": () => big(fill(blob(50, 50, 10, 7, 3, 8, 0.1), K.blue, K.black, 1)) + ctl(),
  "3.3": () => big(stroke("M44,44L50,56L56,44", K.blue, 2.4)) + ctl(),
  "3.4": () => stream(smooth([[-2, 34], [24, 44], [50, 48], [76, 58], [102, 62]]), 3.4) + ctl(50, 49),
  "3.5": () => stroke(smooth([[-2, 34], [24, 44], [50, 48], [76, 58], [102, 62]]), K.blue, 2, dash(7, 3)) + ctl(50, 49),
  "3.6": () => stroke(smooth([[-2, 34], [24, 44], [50, 48], [76, 58], [102, 62]]), K.blue, 3, dash(2.6, 2.6)) + ctl(50, 49),
  "3.7": () => hatch(50, 50, 40, 32) + ctl(),
  "3.8": () => hatch(50, 50, 71, 71) + fill(blob(50, 50, 14, 10, 5), K.paper) + ctl(),
  "3.9": () => big(ring(50, 50, 4.5, K.blue, 2.2)) + ctl(),
  "3.10": () => stroke("M43.5,50A6.5,6.5 0 0 1 56.5,50", K.blue, 2.4) + stream(smooth([[50, 52], [47, 72], [53, 88], [50, 104]]), 2.6) + ctl(),
  "3.11": () => big(cross(50, 50, 5, K.blue, 2.4)) + ctl(),
  // vegetation
  "4.1": () => fill(smooth([[-2, 40], [30, 34], [60, 30], [102, 26], [102, 102], [-2, 102]], true), K.yellow) + ctl(52, 60),
  "4.2": () => fill(blob(50, 52, 40, 34, 2), K.yellow) + scatter(50, 52, 34, 14, 2).map(([x, y]) => dot(x, y, 2.4, K.paper)).join("") + ctl(),
  "4.3": () => rect(K.yellow) + fill(poly([[-2, -2], [52, -2], [55, 26], [54, 50], [28, 52], [-2, 49]], true), K.paper) + ctl(54, 50),
  "4.4": () => big(fill(blob(50, 50, 11, 9, 1), K.yellow)) + ctl(),
  "4.5": () => fill(blob(50, 50, 13, 10, 3), K.green) + ctl(),
  "4.6": () => rect(K.yellow) + stroke(smooth([[-2, 58], [30, 50], [62, 52], [102, 42]]), K.green, 4.6) + ctl(50, 52),
  "4.7": () => fill("M-2,-2H102V48C70,54 30,44 -2,50Z", K.yellow50) + fill("M-2,102H102V48C70,54 30,44 -2,50Z", K.green20)
    + stroke("M-2,50C30,44 70,54 102,48", K.black, 1.8, ' stroke-dasharray="0.1 4.2"') + ctl(50, 49),
  "4.8": () => rect(K.yellow) + fill(blob(50, 50, 11, 9, 4), K.paper) + ctl(),
  "4.9": () => big(rect(K.yellow) + ring(50, 50, 4.5, K.green, 2.4)) + ctl(),
  "4.10": () => big(cross(50, 50, 5, K.green, 2.4)) + ctl(),
  // man-made features
  "5.1": () => roadBand() + ctl(),
  "5.2": () => path(smooth([[-2, 60], [30, 50], [62, 50], [102, 40]])) + ctl(50, 50),
  "5.3": () => stroke(smooth([[-2, 60], [30, 50], [62, 50], [102, 40]]), K.black, 1.2, dash(4, 2.4)) + ctl(50, 50),
  "5.4": () => stream(smooth([[48, -2], [54, 26], [50, 50], [46, 74], [52, 102]])) + path("M-2,50H40M60,50H102")
    + stroke("M40,50H60M40,45V55M60,45V55", K.black, 2.2) + ctl(),
  "5.5": () => { const p = [[-2, 66], [102, 34]]; return stroke(poly(p), K.black, 1.4) + stroke(ticks(p, 4, 18, 1, 9) + ticks(p, 4, 18, -1, 9), K.black, 1.4) + ctl(50, 50); },
  "5.6": () => stroke("M-2,66L102,34", K.black, 1.4) + fill(poly([[46, 47], [53, 45], [55, 52], [48, 54]], true), K.paper, K.black, 1.8) + ctl(),
  "5.7": () => roadBand(50, 22) + path("M50,-2V34M50,66V102") + stroke("M43,32L46,38M57,32L54,38M43,68L46,62M57,68L54,62", K.black, 1.8) + ctl(),
  "5.8": () => wall([[6, 60], [30, 52], [50, 50], [72, 44], [96, 40]]) + ctl(),
  "5.9": () => fence([[6, 60], [30, 52], [50, 50], [72, 44], [96, 40]]) + ctl(),
  "5.10": () => fence([[2, 50], [44, 50]]) + fence([[56, 50], [98, 50]]) + stroke("M44,43V57M56,43V57", K.black, 2) + ctl(),
  "5.11": () => big(fill(poly([[40, 42], [60, 38], [62, 54], [42, 58]], true), K.building, K.black, 1.4)) + ctl(),
  "5.12": () => fill(blob(50, 50, 30, 22, 3), K.paved, K.black, 1.2) + ctl(),
  "5.13": () => big(stroke(poly([[40, 42], [60, 38], [62, 54], [42, 58]], true), K.black, 1.8, dash(4.5, 2.6))) + ctl(),
  "5.14": () => { const p = [[-2, 66], [102, 34]]; return stroke(poly(p), K.black, 2.2) + stroke(ticks(p, 4, 16, 1, 6) + ticks(p, 4, 16, -1, 6) + ticks(p, 4, 16, 1, 9) + ticks(p, 4, 16, -1, 9), K.black, 1.3) + ctl(50, 50); },
  "5.15": () => big(ring(50, 50, 5, K.black, 2) + dot(50, 50, 1.6, K.black)) + ctl(),
  "5.16": () => big(stroke("M44,57V44H56V57", K.black, 2.4)) + ctl(),
  "5.17": () => big(ring(50, 50, 3, K.black, 1.8)) + ctl(),
  "5.18": () => big(stroke("M43,43L50,51L57,43M50,51V58", K.black, 2.2)) + ctl(),
  "5.19": () => big(ring(50, 50, 6, K.black, 2.2)) + ctl(),
  "5.20": () => big(cross(50, 50, 5, K.black, 2.4)) + ctl(),
  "5.23": () => fill("M8,36H44V64H8Z", K.building, K.black, 1.4) + fill("M56,36H92V64H56Z", K.building, K.black, 1.4) + fill("M44,36H56V64H44Z", K.canopy)
    + stroke("M44,36H56M44,64H56", K.black, 1.4) + stroke("M44,36V64M56,36V64", K.black, 1.2, dash(2.5, 2)) + ctl(50, 50, 19),
  "5.24": () => fill("M38,-2H62V102H38Z", K.paved) + stroke("M38,-2V102M62,-2V102", K.black, 1.2) + stroke([34, 40, 46, 52, 58, 64].map((y) => `M38,${y}H62`).join(""), K.black, 1.4) + ctl(),
  "5.25": () => fill(blob(50, 50, 20, 14, 2), K.olive, K.black, 1.4) + ctl(50, 50, 24),
  "5.26": () => stroke("M-2,62C30,54 70,46 102,38", K.black, 4.4) + stroke("M-2,62C30,54 70,46 102,38", K.paper, 1.8, dash(5, 5)) + ctl(),
  // special features
  "6.1": () => big(cross(50, 50, 5, K.black, 2.4)) + ctl(),
  "6.2": () => big(ring(50, 50, 5, K.black, 2.2)) + ctl(),
  // column E: the feature's appearance (only where a map shows it)
  "8.4": () => fill(blob(50, 50, 32, 26, 3), K.green50) + knoll() + ctl(),
  "8.5": () => fill(blob(50, 50, 32, 26, 3), K.yellow) + knoll() + ctl(),
  "8.6": () => knoll(50, 50, 9) + scatter(50, 50, 7, 8, 1).map(([x, y]) => dot(x, y, 1, K.black)).join("") + ctl(),
  "8.7": () => hatch(50, 50, 34, 28) + stroke("M42,47A8,8 0 0 0 58,47", K.brown, 2.4) + ctl(),
  "8.8": () => fill(blob(50, 50, 32, 26, 3), K.yellow50) + scatter(50, 50, 27, 30, 4).map(([x, y]) => dot(x, y, 1, K.black)).join("") + ctl(),
  "8.11": () => { const p = [[6, 60], [30, 52], [50, 50], [72, 44], [96, 40]]; return stroke(poly(p), K.black, 1.5, dash(6, 4)) + dotsAlong(p, 1.7, 10, K.black) + ctl(); },
  // column F: where features meet
  "10.1": () => stream(smooth([[46, -2], [52, 30], [50, 50], [46, 74], [52, 102]])) + path("M-2,56L102,44") + ctl(),
  "10.1single": () => path("M-2,60L102,40") + path("M38,-2L62,102") + ctl(),
  "10.2": () => roadBand(40) + path("M50,47V102") + ctl(50, 46),
  "10.2single": () => path("M-2,40C30,46 70,44 102,38") + path("M50,44V102") + ctl(50, 44),
  "11.7": () => path(poly([[-2, 86], [50, 46], [102, 78]])) + ctl(50, 47),
  // column G: where the flag stands (drawn for north, the family turned)
  "11.9": () => reentrant() + tick(50, 44) + ctl(50, 27, 13, true),
  "11.10": () => reentrant() + tick(50, 44) + ctl(50, 76, 13, true),
  "11.11": () => cliff([[6, 56], [28, 58], [50, 54], [72, 58], [94, 55]]) + ctl(50, 44, 15, true),
  "11.12": () => stroke("M-2,66L102,34", K.black, 1.4) + stroke(ticks([[-2, 66], [102, 34]], 4, 18, 1, 9) + ticks([[-2, 66], [102, 34]], 4, 18, -1, 9), K.black, 1.4) + ctl(50, 50, 15, true),
  "11.13": () => cliff([[6, 44], [28, 46], [50, 42], [72, 46], [94, 43]]) + ctl(50, 58, 15, true),
  "11.15": () => boulder(28, 50, 3.6) + knoll(72, 50, 6) + ctl(50, 50, 17, true),
  "11.15single": () => boulder(30, 50, 3.6) + boulder(70, 50, 3.6) + ctl(50, 50, 17, true),
  // column C: the upper, lower or middle of three
  "0.3": () => slope3(32),
  "0.4": () => slope3(68),
  "0.5": () => slope3(50),
};
function slope3(y) {
  return [18, 50, 82].map((c) => stroke(smooth([[-2, c - 2], [50, c + 3], [102, c - 2]]), K.brown, 1.8)).join("") + boulder(46, 32) + boulder(54, 50) + boulder(47, 68)
    + ctl(y === 50 ? 54 : y === 32 ? 46 : 47, y, 12, true);
}

// the families drawn for north and turned: id prefix → drawing
const DIR = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
const NORTH = {
  "0.1": () => boulder(50, 40) + boulder(50, 55) + ctl(50, 40, 21, true), // the northern of two boulders
  "0.2": () => boulder(50, 40) + boulder(50, 55) + ctl(50, 40, 21, true),
  "11.1": () => knoll(50, 54, 9) + ctl(50, 36, 15, true), // side: beside the knoll
  "11.2": () => fill(blob(50, 54, 30, 30, 3, 10, 0.05), K.green50) + ctl(50, 24, 14, true), // edge: on the thicket's edge
  "11.3": () => fill(blob(50, 50, 32, 32, 3, 10, 0.05), K.green50) + ctl(50, 32, 13, true), // part: inside, to the north
  "11.4": () => fill(poly([[50, 22], [78, 50], [50, 78], [22, 50]], true), K.yellow, K.black, 1.6) + ctl(50, 33, 11, true), // inside corner
  "11.5": () => fill(poly([[50, 26], [76, 52], [50, 78], [24, 52]], true), K.yellow, K.black, 1.6) + ctl(50, 17, 11, true), // outside corner
  "11.6": () => fill(smooth([[50, 22], [58, 40], [68, 70], [76, 104], [24, 104], [32, 70], [42, 40]], true), K.yellow) + ctl(50, 25, 13, true), // tip
  "11.8": () => wall([[50, 26], [52, 60], [49, 104]]) + ctl(50, 26, 13, true), // end
  "11.14": () => cliff([[6, 54], [28, 56], [50, 52], [72, 56], [94, 53]], -1) + ctl(50, 40, 14, true), // foot: below the cliff, its ticks downhill
};

/** The drawing's body for an IOF id (a symbol's `id`; « 11.1NE » turns « 11.1 »'s), or "" when none. */
export function mapBody(id) {
  id = String(id || "").replace(/@.*/, "");
  if (D[id]) return D[id]();
  const m = /^(\d+\.\d+)(N|NE|E|SE|S|SW|W|NW)$/.exec(id);
  if (m && NORTH[m[1]]) return turn(DIR[m[2]], NORTH[m[1]]());
  return "";
}
/** Whether an id has a map drawing. */
export const hasMap = (id) => !!mapBody(id);
/** The map drawing as an SVG element's markup (a square of `size` px on map paper), or "" when the id has none. */
export function mapSvg(id, size = 60, cls = "cd-map") {
  const body = mapBody(id);
  return body ? `<svg class="${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">${rect(K.paper)}${body}</svg>` : "";
}
