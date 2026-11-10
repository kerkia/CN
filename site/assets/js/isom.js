// The map's own symbols (« Symboles de carte », Coach; owner, 2026-10-31): every symbol of ISOM 2017-2, the IOF's
// specification for forest orienteering maps, drawn as a map's legend draws it — a swatch for each, in its colour, its
// dimensions in mm taken from the specification's own drawings (the line widths, dot sizes, dashes and spacings), our own
// drawings. Grouped as the specification groups them, which is also by colour: landforms (brown), rock and boulders
// (black, grey), water and marsh (blue), vegetation (yellow, green), man-made features (black), technical symbols, course
// planning symbols (purple). Names and notes in the catalogues (`ms.s.<code>`, `ms.n.<code>`).

/** ISOM's colours, approximately, in RGB (a map's paper is white whatever the site's theme). */
const C = {
  black: "#1c1c1c", brown: "#c8641a", brown50: "#e8bf98", blue: "#00a0e2", blue50: "#80cff0", yellow: "#ffba36",
  yellow50: "#ffdd9b", green30: "#c5e9c0", green60: "#8fd18c", green: "#3cb44a", olive: "#a6a53a", grey20: "#d6d6d6",
  grey30: "#bdbdbd", grey65: "#6b6b6b", purple: "#c4238f", paper: "#ffffff",
};

// ---- drawing in mm (y down, north up); a swatch is W × H mm, `k` the course symbols' smaller scale -----------------
let W = 7, H = 3;
const n = (v) => +v.toFixed(3);
const P = (pts) => pts.map(([x, y]) => `${n(x)},${n(y)}`).join("L");
const line = (d, col, w, extra = "") => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}"${extra}/>`;
const dash = (...a) => ` stroke-dasharray="${a.join(" ")}"`;
const fillp = (d, col, edge = "", ew = 0.1) => `<path d="${d}" fill="${col}"${edge ? ` stroke="${edge}" stroke-width="${ew}" stroke-linejoin="round"` : ""}/>`;
const dot = (x, y, d, col) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(d / 2)}" fill="${col}"/>`;
/** A ring of outer diameter d. */
const ring = (x, y, d, col, w) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n((d - w) / 2)}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
const cross = (x, y, s, col, w) => line(`M${n(x - s / 2)},${n(y - s / 2)}L${n(x + s / 2)},${n(y + s / 2)}M${n(x - s / 2)},${n(y + s / 2)}L${n(x + s / 2)},${n(y - s / 2)}`, col, w);
const text = (x, y, s, size, col) => `<text x="${n(x)}" y="${n(y)}" font-family="Arial, Helvetica, sans-serif" font-size="${size}" fill="${col}" text-anchor="middle">${s}</text>`;
/** Digits `h` mm high, as the specifications measure a text symbol (704's « Arial, 4.0 mm » and 603's « 1.5 » are drawn against
 *  the digits' height): Arial's digits stand 0.716 of the font size. Centred on (x, y), or starting at x with `start`. */
const ARIAL_DIGIT = 0.716;
const digits = (x, y, s, h, col, start = false) => `<text x="${n(x)}" y="${n(y + h / 2)}" font-family="Arial, Helvetica, sans-serif" font-size="${n(h / ARIAL_DIGIT)}" fill="${col}" text-anchor="${start ? "start" : "middle"}">${s}</text>`;
// the area of a swatch
const X0 = 0.4, Y0 = 0.4, X1 = () => W - 0.4, Y1 = () => H - 0.4;
const area = (col, edge = "", ew = 0.1) => `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="${col}"${edge ? ` stroke="${edge}" stroke-width="${ew}"` : ""}/>`;
// a line across the swatch: gently curved (contours, streams), or straight at height y (lines with ticks or dots)
const wave = (y = H / 2, a = 0.35) => `M0.5,${n(y + a)}C${n(W * 0.32)},${n(y - 2.2 * a)} ${n(W * 0.62)},${n(y + 2.2 * a)} ${n(W - 0.5)},${n(y - a)}`;
const straight = (y = H / 2, x0 = 0.5, x1 = W - 0.5) => `M${x0},${n(y)}L${x1},${n(y)}`;
/** Positions every `step` mm along the straight line, from `start`. */
const along = (step, start = step / 2, x0 = 0.5, x1 = W - 0.5) => { const out = []; for (let x = x0 + start; x <= x1 + 1e-6; x += step) out.push(x); return out; };
/** Points spread irregularly over the swatch, `density` a mm² (one in each cell of a grid, anywhere in it: no clumps, no rows). */
function spread(density, seed = 0, margin = 0.2) {
  const out = [], s = 1 / Math.sqrt(density), h = (i) => { const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return v - Math.floor(v); };
  let i = 0;
  for (let y = Y0 + margin; y + s <= Y1() - margin + 1e-6; y += s) for (let x = X0 + margin; x + s <= X1() - margin + 1e-6; x += s, i++)
    out.push([x + s * (0.15 + 0.7 * h(i * 2 + 1)), y + s * (0.15 + 0.7 * h(i * 2 + 2))]);
  return out;
}
/** A regular grid of dots at 45° (staggered rows), centre to centre `cc`. */
function grid45(cc, d, col) {
  let out = "";
  const dy = cc / Math.SQRT2;
  for (let j = 0, y = Y0 + dy / 2; y < Y1(); j++, y += dy) for (let x = X0 + (j % 2 ? cc / 2 : 0) + cc / 4; x < X1(); x += cc) out += dot(x, y, d, col);
  return out;
}
/** Parallel lines across the area (horizontal, or vertical), centre to centre `cc`. */
function lines(cc, w, col, vertical = false, extra = "") {
  let d = "";
  if (vertical) for (let x = X0 + cc / 2; x < X1(); x += cc) d += `M${n(x)},${Y0}L${n(x)},${n(Y1())}`;
  else for (let y = Y0 + cc / 2; y < Y1(); y += cc) d += `M${X0},${n(y)}L${n(X1())},${n(y)}`;
  return line(d, col, w, ` stroke-linecap="butt"${extra}`);
}
/** Ticks on a straight line at height y: below it (side 1) or above (-1), at an angle from the line (90° = square). */
function tagsAt(xs, y, len, w, col, side = 1, deg = 90) {
  const a = (deg * Math.PI) / 180;
  return line(xs.map((x) => `M${n(x)},${n(y)}L${n(x - Math.cos(a) * len)},${n(y + side * Math.sin(a) * len)}`).join(""), col, w, ' stroke-linecap="butt"');
}
const tri = (x, y, s, rot, col) => { // a solid triangle of sides 8:6:5 scaled to s (its longest side), turned
  const A = [[-0.5, 0.21], [0.5, 0.21], [-0.11, -0.39]].map(([u, v]) => [u * s, v * s]);
  const c = Math.cos(rot), si = Math.sin(rot);
  return fillp(`M${P(A.map(([u, v]) => [x + u * c - v * si, y + u * si + v * c]))}Z`, col);
};
const cx = () => W / 2, cy = () => H / 2;
/** How many times a swatch's area the frame drawn has (1, but for a control circle's square). */
let areaK = 1;

// ---- helpers of the forest symbols, each after a dimension of the specification (ISOM 2017-2 and its « 3.8 Précise
// définition des symboles ») --------------------------------------------------------------------------------------------
/** Colours the specification names beyond C: green 20 % (408's stripes), green + black 50 % (416's dashed line). */
const CF = { green20: "#d8f0db", greenDark: "#1e5a25" };
/** A deterministic random number in [0, 1) for the i-th draw of a seed. */
const rnd = (i, seed) => { const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return v - Math.floor(v); };
/** Points at random over the swatch, `density` a mm², no two closer than `min` mm centre to centre and none further than
 *  `max` from its nearest neighbour (the specification's minimum and maximum distances): thrown at random, then pushed
 *  apart (or drawn closer) until they keep those distances. */
const scattered = new Map();
function scatterMM(density, min, max = Infinity, seed = 0, margin = 0.15) {
  const key = [density, min, max, seed, margin, W, H].join();
  if (!scattered.has(key)) scattered.set(key, scatterNew(density, min, max, seed, margin));
  return scattered.get(key);
}
function scatterNew(density, min, max, seed, margin) {
  const x0 = X0 + margin, y0 = Y0 + margin, x1 = X1() - margin, y1 = Y1() - margin;
  const even = Math.sqrt(2 / (Math.sqrt(3) * density));
  let p;
  if (max < 1.25 * even) {
    // a maximum distance near the even spacing (very broken ground, stony ground): thrown at random, the dots clump and leave
    // holes the relaxation cannot close, so they start from staggered rows at that spacing, each moved a little at random
    const a = Math.min(even, 0.97 * max), dy = (a * Math.sqrt(3)) / 2;
    p = [];
    for (let r = 0, y = y0; y <= y1; r++, y += dy) for (let x = x0 + (r % 2 ? a / 2 : 0); x <= x1; x += a) {
      const i = p.length;
      p.push([Math.min(x1, x + (rnd(2 * i + 1, seed) - 0.5) * 0.3 * a), Math.min(y1, y + (rnd(2 * i + 2, seed) - 0.5) * 0.3 * a)]);
    }
  } else {
    const N0 = Math.round(density * (X1() - X0) * (Y1() - Y0));
    p = Array.from({ length: N0 }, (_, i) => [x0 + rnd(2 * i + 1, seed) * (x1 - x0), y0 + rnd(2 * i + 2, seed) * (y1 - y0)]);
  }
  const N = p.length;
  // kept apart a little beyond the minimum, toward the even spacing of the density, so that they spread without clumps
  const lo = Math.min(Math.max(min, 0.85 * even), 0.92 * max) * 1.02, clamp = (q) => { q[0] = Math.min(x1, Math.max(x0, q[0])); q[1] = Math.min(y1, Math.max(y0, q[1])); };
  // the neighbours looked for in a grid of cells as wide as the farthest distance that matters (all of them, the nearest
  // beyond it, only for a dot with none so near): a swatch's few dots and a control circle's many cost alike per dot
  const cell = Math.max(lo, Number.isFinite(max) ? max : lo), cols = Math.ceil((x1 - x0) / cell) + 1;
  for (let it = 0; it < 600; it++) {
    let moved = false;
    const grid = new Map();
    p.forEach((q, j) => { const k = Math.floor((q[0] - x0) / cell) + cols * Math.floor((q[1] - y0) / cell); (grid.get(k) || grid.set(k, []).get(k)).push(j); });
    for (let i = 0; i < N; i++) {
      let nd = Infinity, nj = -1;
      const gx = Math.floor((p[i][0] - x0) / cell), gy = Math.floor((p[i][1] - y0) / cell);
      const near = [];
      for (let a = gx - 1; a <= gx + 1; a++) for (let c = gy - 1; c <= gy + 1; c++) if (a >= 0 && a < cols) near.push(...(grid.get(a + cols * c) || []));
      const look = (js) => { for (const j of js) {
        if (j === i) continue;
        const dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1], d = Math.hypot(dx, dy) || 1e-6;
        if (d < nd) { nd = d; nj = j; }
        if (d < lo) { const k = (lo - d) / 2 / d; p[i][0] -= dx * k; p[i][1] -= dy * k; p[j][0] += dx * k; p[j][1] += dy * k; clamp(p[i]); clamp(p[j]); moved = true; }
      } };
      look(near.sort((u, v) => u - v));
      if (nd > cell && nd > max) { nd = Infinity; look(p.map((_, j) => j)); }
      if (nd > max && nj >= 0) { const k = (nd - max * 0.98) / 2 / nd, dx = p[nj][0] - p[i][0], dy = p[nj][1] - p[i][1]; p[i][0] += dx * k; p[i][1] += dy * k; clamp(p[i]); moved = true; }
    }
    if (!moved) break;
  }
  return p;
}
/** Dots on a square grid turned 45° (staggered rows), `cc` mm centre to centre along the 45° lines, between x from and to. */
function diag45(cc, d, col, from = X0, to = X1()) {
  let out = "";
  const sx = cc * Math.SQRT2, dy = sx / 2;
  for (let j = 0, y = Y0 + dy / 2; y < Y1(); j++, y += dy) for (let x = X0 + (j % 2 ? sx / 2 : 0) + sx / 4; x < X1(); x += sx) if (x >= from && x < to) out += dot(x, y, d, col);
  return out;
}
/** A V of outer size w × h mm (its arms lw thick, cut level at the top) as a filled shape: pit, rocky pit, waterhole. */
function veeOM(w, h, lw, col) {
  const t = cy() - h / 2, b = cy() + h / 2, L = Math.hypot(w / 2, h), d = (lw * L) / h;
  return fillp(`M${P([[cx() - w / 2, t], [cx(), b], [cx() + w / 2, t], [cx() + w / 2 - d, t], [cx(), b - (2 * h * d) / w], [cx() - w / 2 + d, t]])}Z`, col);
}
/** An equilateral triangle of outer side s with a line lw thick (its outside edges measured), centred. */
function triOM(s, lw, col) {
  const pts = (k) => { const r = s / Math.sqrt(3) - k; return [-90, 30, 150].map((a) => [cx() + r * Math.cos((a * Math.PI) / 180), cy() + s / Math.sqrt(3) / 4 + r * Math.sin((a * Math.PI) / 180)]); };
  return `<path d="M${P(pts(0))}ZM${P(pts(2 * lw).reverse())}Z" fill="${col}" fill-rule="evenodd"/>`;
}
/** A solid triangle of sides 0.8 : 0.6 : 0.5 mm (8:6:5, the boulder field's), turned by rot about its centroid, × k. */
function tri865(x, y, rot, col, k = 1) {
  const A = [[0, 0], [0.8, 0], [0.46875, -0.37458]], g = [(0 + 0.8 + 0.46875) / 3, -0.37458 / 3];
  const c = Math.cos(rot), s = Math.sin(rot);
  return fillp(`M${P(A.map(([u, v]) => [(u - g[0]) * k, (v - g[1]) * k]).map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]))}Z`, col);
}
/** Ticks at 60° to a straight line at height y, below it and leaning forward (516-518), len mm from the line's centre. */
const ticks60 = (xs, y, len, w, col) => line(xs.map((x) => `M${n(x)},${n(y)}L${n(x + len * 0.5)},${n(y + len * 0.866)}`).join(""), col, w, ' stroke-linecap="butt"');

// ---- the symbols, by number ------------------------------------------------------------------------------------------
const S = {
  // 1 landforms (brown)
  101: () => line(wave(), C.brown, 0.14),
  102: () => line(wave(), C.brown, 0.25),
  103: () => line(wave(), C.brown, 0.1, dash(2, 0.2)), // 0.1 wide, dashes 2.0, gaps 0.2
  // top line 0.18, tags 0.14 wide every 0.5 reaching 0.40 beyond the line's edge
  104: () => { const y = 1.2; return line(straight(y, 0.8, W - 0.8), C.brown, 0.18) + tagsAt(along(0.5, 0.25, 0.8, W - 0.8), y, 0.09 + 0.4, 0.14, C.brown); },
  105: () => line(straight(), C.brown, 0.18) + along(2, 1).map((x) => dot(x, cy(), 0.45, C.brown)).join(""),
  106: () => line(straight(), C.brown, 0.18, dash(1.65, 0.35)) + along(2, 0.825).map((x) => dot(x, cy(), 0.45, C.brown)).join(""),
  107: () => { // a line tapering to points at both ends, 0.25 at its widest
    const pts = [], m = 24;
    for (let i = 0; i <= m; i++) { const u = i / m, x = 0.8 + u * (W - 1.6), y = cy() + 0.35 * Math.sin(u * Math.PI * 1.6); pts.push([x, y, 0.125 * Math.sin(u * Math.PI)]); }
    return fillp(`M${P([...pts.map(([x, y, h]) => [x, y - h]), ...pts.reverse().map(([x, y, h]) => [x, y + h])])}Z`, C.brown);
  },
  108: () => line(wave(), C.brown, 0.25, ` stroke-linecap="round"${dash(0.001, 0.45)}`),
  109: () => dot(cx(), cy(), 0.5, C.brown),
  110: () => `<ellipse cx="${cx()}" cy="${cy()}" rx="0.4" ry="0.2" fill="${C.brown}"/>`, // 0.8 × 0.4
  111: () => line(`M${cx() - 0.31},${cy() - 0.15}A0.31,0.31 0 0 0 ${cx() + 0.31},${cy() - 0.15}`, C.brown, 0.18), // 0.8 × 0.4 outside
  112: () => veeOM(0.7, 0.8, 0.18, C.brown),
  // dots ø 0.2: 113 3-4 a mm², 0.5-0.6 mm apart; 114 7-9 a mm², 0.25-0.38 mm apart
  113: () => scatterMM(3.4, 0.5, 0.6, 1).map(([x, y]) => dot(x, y, 0.2, C.brown)).join(""),
  114: () => scatterMM(8, 0.25, 0.38, 2).map(([x, y]) => dot(x, y, 0.2, C.brown)).join(""),
  115: () => triOM(0.9, 0.18, C.brown),
  // 2 rock and boulders (black, grey)
  // top line 0.35 (201) or 0.25 (202), tags 0.12 every 0.5 reaching 0.40 beyond its edge; without tags, 202's ends rounded
  201: () => { const y = 1.2; return line(straight(y, 0.8, W - 0.8), C.black, 0.35) + tagsAt(along(0.5, 0.25, 0.8, W - 0.8), y, 0.175 + 0.4, 0.12, C.black); },
  202: () => { const y = 0.95; return line(straight(y, 0.8, W - 0.8), C.black, 0.25) + tagsAt(along(0.5, 0.25, 0.8, W - 0.8), y, 0.125 + 0.4, 0.12, C.black)
    + line(straight(2.2, 0.9, W - 0.9), C.black, 0.25, ' stroke-linecap="round"'); },
  203: () => veeOM(0.7, 0.8, 0.16, C.black),
  204: () => dot(cx(), cy(), 0.4, C.black),
  205: () => dot(cx(), cy(), 0.6, C.black),
  206: () => fillp(`M${P([[cx() - 0.9, cy() - 0.2], [cx() - 0.3, cy() - 0.85], [cx() + 0.6, cy() - 0.6], [cx() + 0.95, cy() + 0.3], [cx() + 0.2, cy() + 0.85], [cx() - 0.7, cy() + 0.55]])}Z`, C.black),
  207: () => fillp(`M${P([[cx() - 0.4, cy() + 0.23], [cx() + 0.4, cy() + 0.23], [cx(), cy() - 0.46]])}Z`, C.black),
  // triangles of sides 8:6:5 (0.8 mm the longest), placed and turned at random: 208 0.8-1 a mm², 0.75-1.2 mm apart;
  // 209 2-3 a mm², at most 0.6 mm apart (no minimum given: 0.45 keeps them from overlapping)
  208: () => scatterMM(0.9, 0.75, 1.2, 3, 0.35).map(([x, y], i) => tri865(x, y, rnd(i + 50, 3) * 2 * Math.PI, C.black)).join(""),
  209: () => scatterMM(2.5, 0.45, 0.6, 4, 0.3).map(([x, y], i) => tri865(x, y, rnd(i + 50, 4) * 2 * Math.PI, C.black)).join(""),
  // dots ø 0.2: 210 3-4 a mm², 0.45-0.6 mm apart; 211 6-8, 0.32-0.4; 212 10-12, 0.25-0.32
  210: () => scatterMM(3.4, 0.45, 0.6, 5).map(([x, y]) => dot(x, y, 0.2, C.black)).join(""),
  211: () => scatterMM(7, 0.32, 0.4, 6).map(([x, y]) => dot(x, y, 0.2, C.black)).join(""),
  212: () => scatterMM(11, 0.25, 0.32, 7).map(([x, y]) => dot(x, y, 0.2, C.black)).join(""),
  213: () => area(C.yellow50) + diag45(0.45, 0.16, C.black), // yellow 50 %, black dots ø 0.16, 0.45 apart at 45°
  214: () => area(C.grey30),
  215: () => line(straight(cy() - 0.1, 0.8, W - 0.8) + straight(cy() + 0.1, 0.8, W - 0.8), C.black, 0.1),
  // 3 water and marsh (blue)
  301: () => area(C.blue, C.black, 0.18),
  // blue 50 %, its outline blue 0.1: solid, or dashed (1.25, gaps 0.25) for seasonal water (both on the specification's drawing)
  302: () => area(C.blue50) + line(`M${cx()},${Y0}H${X0}V${n(Y1())}H${cx()}`, C.blue, 0.1)
    + line(`M${cx()},${Y0}H${n(X1())}V${n(Y1())}H${cx()}`, C.blue, 0.1, dash(1.25, 0.25)),
  303: () => veeOM(0.7, 0.8, 0.18, C.blue),
  304: () => line(wave(), C.blue, 0.3),
  305: () => line(wave(), C.blue, 0.18),
  306: () => line(wave(), C.blue, 0.18, dash(1.25, 0.25)),
  307: () => area(C.paper) + lines(0.5, 0.25, C.blue) + `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="none" stroke="${C.black}" stroke-width="0.18"/>`,
  308: () => lines(0.3, 0.1, C.blue),
  309: () => line(wave(), C.blue, 0.25, ` stroke-linecap="round"${dash(0.001, 0.45)}`),
  310: () => { let o = ""; for (let j = 0, y = Y0 + 0.15; y < Y1(); j++, y += 0.3) o += line(`M${X0},${n(y)}L${n(X1())},${n(y)}`, C.blue, 0.1, `${dash(0.9, 0.25)} stroke-dashoffset="${j % 2 ? 0.55 : 0}"`); return o; },
  311: () => `<rect x="${cx() - 0.31}" y="${cy() - 0.31}" width="0.62" height="0.62" fill="none" stroke="${C.blue}" stroke-width="0.18"/>`,
  312: () => line(`M${cx() - 0.36},${cy() - 0.18}A0.36,0.36 0 0 0 ${cx() + 0.36},${cy() - 0.18}`, C.blue, 0.18), // 0.9 × 0.45 outside, open downstream
  313: () => line([0, 72, 144, 216, 288].map((a) => { const r = (a * Math.PI) / 180; return `M${cx()},${cy()}L${n(cx() + Math.sin(r) * 0.45)},${n(cy() - Math.cos(r) * 0.45)}`; }).join(""), C.blue, 0.16), // 5 spokes in a circle of 0.9
  // 4 vegetation (yellow, green)
  401: () => area(C.yellow),
  // yellow with holes ø 0.4 (402) or 0.5 (404), 0.7 or 0.8 apart at 45°: white (scattered trees) or green 60 % (bushes)
  402: () => area(C.yellow) + diag45(0.7, 0.4, C.green60, X0, cx()) + diag45(0.7, 0.4, C.paper, cx()),
  403: () => area(C.yellow50),
  404: () => area(C.yellow50) + diag45(0.8, 0.5, C.green60, X0, cx()) + diag45(0.8, 0.5, C.paper, cx()),
  405: () => area(C.paper, "#b8b8b8", 0.06),
  // a screen, and on its right half the stripes left in it for a better direction of running (0.4 wide, 1.5 apart)
  406: () => area(C.green30) + line(`M${cx()},${cy() - 0.75}H${n(X1())}M${cx()},${cy() + 0.75}H${n(X1())}`, C.paper, 0.4),
  407: () => area(C.paper) + lines(0.84, 0.12, C.green, true),
  408: () => area(C.green60) + line(`M${cx()},${cy() - 0.75}H${n(X1())}`, C.paper, 0.4) + line(`M${cx()},${cy() + 0.75}H${n(X1())}`, CF.green20, 0.4),
  409: () => area(C.paper) + lines(0.42, 0.14, C.green, true),
  410: () => area(C.green) + line(`M${cx()},${cy() - 0.75}H${n(X1())}`, C.paper, 0.4) + line(`M${cx()},${cy() + 0.75}H${n(X1())}`, C.green60, 0.4),
  412: () => { let o = area(C.yellow); for (let y = Y0 + 0.4; y < Y1(); y += 0.8) for (let x = X0 + 0.4; x < X1(); x += 0.8) o += dot(x, y, 0.2, C.black); return o; },
  // green dots ø 0.45, 0.8 apart, on yellow 50 % (left) or yellow (right)
  413: () => { let o = area(C.yellow50) + rect(cx(), Y0, X1(), Y1(), C.yellow); for (let y = Y0 + 0.4; y < Y1(); y += 0.8) for (let x = X0 + 0.4; x < X1(); x += 0.8) o += dot(x, y, 0.45, C.green); return o; },
  // green dashes 0.2 wide, 1.3 long, gaps 0.6, lines 0.85 apart, neighbouring lines staggered; on yellow 50 % or yellow
  414: () => { let o = area(C.yellow50) + rect(cx(), Y0, X1(), Y1(), C.yellow); for (let j = 0, x = X0 + 0.425; x < X1(); j++, x += 0.85) o += line(`M${n(x)},${Y0}V${n(Y1())}`, C.green, 0.2, `${dash(1.3, 0.6)} stroke-dashoffset="${j % 2 ? 0.95 : 0}"`); return o; },
  415: () => line(straight(), C.black, 0.14),
  // its two forms (a map uses one): black dots ø 0.22, 0.45 apart; or green + black 50 % dashes 0.14 wide, 0.3 long, gaps 0.2
  416: () => line(straight(cy() - 0.5), C.black, 0.22, ` stroke-linecap="round"${dash(0.001, 0.45)}`) + line(straight(cy() + 0.5), CF.greenDark, 0.14, dash(0.3, 0.2)),
  417: () => ring(cx(), cy(), 0.9, C.green, 0.18),
  418: () => ring(cx(), cy(), 0.6, C.green, 0.2), // ø 0.6, its white centre 0.2
  419: () => cross(cx(), cy(), 0.773, C.green, 0.18), // 0.9 × 0.9 outside
  // 5 man-made features (black, brown, grey)
  501: () => area(C.brown50, C.black, 0.14),
  502: () => fillp(`M0.5,${cy() - 0.22}H${W - 0.5}V${cy() + 0.22}H0.5Z`, C.brown50) + line(straight(cy() - 0.22) + straight(cy() + 0.22), C.black, 0.14), // at its minimum: 0.3 + 2 × 0.14
  503: () => line(wave(cy(), 0.25), C.black, 0.35),
  504: () => line(wave(cy(), 0.25), C.black, 0.35, dash(3, 0.25)),
  505: () => line(wave(cy(), 0.25), C.black, 0.25, dash(2, 0.25)),
  506: () => line(wave(cy(), 0.25), C.black, 0.18, dash(1, 0.25)),
  507: () => line(wave(cy(), 0.25), C.black, 0.18, dash(1, 0.25, 1, 0.8)), // pairs of dashes 1.0, gaps 0.25 within, 0.8 between
  508: () => line(wave(cy(), 0.25), C.black, 0.14, dash(2, 0.25)),
  509: () => line(straight(), C.black, 0.35) + line(straight(), C.paper, 0.1, dash(1, 1.5)),
  510: () => line(straight(), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${n(cy() - 0.37)}V${n(cy() + 0.37)}`, C.black, 0.14)).join(""), // bars 0.3 beyond the line
  511: () => line(straight(cy() - 0.2) + straight(cy() + 0.2), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${n(cy() - 0.57)}V${n(cy() + 0.57)}`, C.black, 0.2)).join(""), // 0.4 apart, bars 0.2, 0.3 beyond
  // a footpath carried over a stream: lines 0.18 on both sides, their ends 0.4 long turned away at 60°
  512: () => { const b = 0.6, y = 0.45, ex = 0.4 * Math.cos(Math.PI / 3), ey = 0.4 * Math.sin(Math.PI / 3);
    return line(`M${cx()},${Y0}V${n(cy() - y)}M${cx()},${n(cy() + y)}V${n(Y1())}`, C.blue, 0.18) + line(straight(cy(), 0.25, W - 0.5), C.black, 0.25, dash(2, 0.25)) // a dash centred on the crossing
      + line(`M${n(cx() - b - ex)},${n(cy() - y - ey)}L${n(cx() - b)},${n(cy() - y)}H${n(cx() + b)}L${n(cx() + b + ex)},${n(cy() - y - ey)}`
      + `M${n(cx() - b - ex)},${n(cy() + y + ey)}L${n(cx() - b)},${n(cy() + y)}H${n(cx() + b)}L${n(cx() + b + ex)},${n(cy() + y + ey)}`, C.black, 0.18); },
  513: () => line(straight(), C.black, 0.14) + along(2, 1).map((x) => dot(x, cy(), 0.4, C.black)).join(""),
  514: () => line(straight(), C.black, 0.14, dash(1.65, 0.35)) + along(2, 0.825).map((x) => dot(x, cy(), 0.4, C.black)).join(""),
  515: () => line(straight(), C.black, 0.25) + along(3, 1.1).flatMap((x) => [dot(x, cy(), 0.6, C.black), dot(x + 0.8, cy(), 0.6, C.black)]).join(""),
  516: () => line(straight(), C.black, 0.14) + ticks60(along(2, 1), cy(), 0.4, 0.14, C.black), // ticks 0.4 at 60°, every 2.0
  // dashes 1.65, gaps 0.35, a tick centred on each dash
  517: () => line(straight(), C.black, 0.14, dash(1.65, 0.35)) + ticks60(along(2, 0.825).map((x) => x - 0.1), cy(), 0.4, 0.14, C.black),
  518: () => line(straight(), C.black, 0.25) + ticks60(along(2.5, 0.9).flatMap((x) => [x, x + 0.6]).filter((x) => x < W - 0.7), cy(), 0.4, 0.14, C.black), // pairs 0.6 apart, every 2.5
  // two lines 0.18 wide, 1.0 long, 0.6 apart, across a wall or fence: an impassable one is broken between them (as drawn, 518)
  519: () => line(straight(cy(), 0.5, cx() - 0.3) + straight(cy(), cx() + 0.3, W - 0.5), C.black, 0.25) + ticks60([1.1, 1.7, cx() + 1.1, cx() + 1.7], cy(), 0.4, 0.14, C.black)
    + line(`M${cx() - 0.3},${cy() - 0.5}V${cy() + 0.5}M${cx() + 0.3},${cy() - 0.5}V${cy() + 0.5}`, C.black, 0.18),
  // yellow + green 50 % with its black outline 0.18, or (right) black stripes 0.35 wide, 0.75 apart, outline 0.25
  520: () => rect(X0, Y0, cx(), Y1(), C.olive) + line(`M${cx()},${Y0}H${X0}V${n(Y1())}H${cx()}`, C.black, 0.18)
    + line(along(0.75, 0.375, cx(), X1() - 0.1).map((x) => `M${n(x)},${Y0}V${n(Y1())}`).join(""), C.black, 0.35)
    + line(`M${cx()},${n(Y0 + 0.05)}H${n(X1() - 0.05)}V${n(Y1() - 0.05)}H${cx()}`, C.black, 0.25),
  // black; or (large buildings in towns) black 65 % with a black outline 0.2
  521: () => rect(cx() - 2.6, cy() - 0.9, cx() - 0.4, cy() + 0.9, C.black) + fillp(`M${cx() + 0.4},${cy() - 0.9}H${cx() + 2.6}V${cy() + 0.9}H${cx() + 0.4}Z`, C.grey65, C.black, 0.2),
  522: () => fillp(`M${cx() - 1.6},${cy() - 0.8}H${cx() + 1.6}V${cy() + 0.8}H${cx() - 1.6}Z`, C.grey20, C.black, 0.1),
  523: () => line(`M${cx() - 1.2},${cy() - 0.8}H${cx() + 1.2}V${cy() + 0.8}H${cx() - 1.2}Z`, C.black, 0.16, dash(0.5, 0.25)),
  524: () => dot(cx(), cy(), 0.8, C.black) + line(`M${cx() - 0.7},${cy()}H${cx() + 0.7}M${cx()},${cy() - 0.7}V${cy() + 0.7}`, C.black, 0.16),
  525: () => line(`M${cx() - 0.5},${cy() - 0.42}H${cx() + 0.5}M${cx()},${cy() - 0.42}V${cy() + 0.5}`, C.black, 0.16),
  526: () => ring(cx(), cy(), 0.8, C.black, 0.16) + dot(cx(), cy(), 0.14, C.black), // ring 0.8 outside, line 0.16, dot ø 0.14
  // 0.9 × 0.9: arms 60° from the stem, lines 0.16
  527: () => { const a = 0.41, top = cy() - 0.354 + 0.092, d = a * Math.tan(Math.PI / 6);
    return line(`M${n(cx() - a)},${n(top + d)}L${cx()},${n(top)}L${n(cx() + a)},${n(top + d)}`, C.black, 0.16) + line(`M${cx()},${n(top)}V${n(top - 0.092 + 0.9)}`, C.black, 0.16); },
  528: () => line(straight(), C.black, 0.14) + along(2, 1).map((x) => line(`M${n(x - 0.28)},${cy() - 0.28}L${n(x)},${cy()}L${n(x - 0.28)},${cy() + 0.28}`, C.black, 0.14)).join(""),
  529: () => line(straight(), C.black, 0.25) + along(2, 1).flatMap((x) => [x, x + 0.6]).map((x) => line(`M${n(x - 0.28)},${cy() - 0.28}L${n(x)},${cy()}L${n(x - 0.28)},${cy() + 0.28}`, C.black, 0.14)).join(""),
  530: () => ring(cx(), cy(), 0.8, C.black, 0.16),
  531: () => cross(cx(), cy(), 0.687, C.black, 0.16), // 0.8 × 0.8 outside
  532: () => { const x0 = cx() - 1.8, x1 = cx() + 1.8, y0 = cy() - 0.25, y1 = cy() + 0.25; let d = `M${x0},${y0}H${x1}M${x0},${y1}H${x1}`; for (let x = x0; x <= x1 + 1e-6; x += 0.25) d += `M${n(x)},${y0}V${y1}`; return line(d, C.black, 0.1); }, // 0.4 inside
  // 6 technical symbols
  601: () => line(`M${cx() - 2},${Y0}V${n(Y1())}M${cx() + 2},${Y0}V${n(Y1())}`, C.black, 0.1) + line(`M${cx()},${Y0}V${n(Y1())}`, C.blue, 0.18),
  602: () => line(`M${cx() - 1.1},${cy()}H${cx() + 1.1}M${cx()},${cy() - 1.1}V${cy() + 1.1}`, C.black, 0.1),
  603: () => dot(cx() - 1.85, cy() + 0.45, 0.3, C.black) + digits(cx() - 1.55, cy(), "219", 1.5, C.black, true),
};
// 7 course planning symbols (purple): drawn in a larger frame, so smaller (they are much larger than the map's symbols)
const COURSE = {
  701: () => line(`M${P([[cx() - 3, cy() + 1.732], [cx() + 3, cy() + 1.732], [cx(), cy() - 3.464]])}Z`, C.purple, 0.35, ' stroke-linejoin="miter"'),
  702: () => line(`M${cx()},${cy() - 1.25}V${cy() + 1.25}`, C.purple, 0.6), // a bar 2.5 × 0.6
  703: () => ring(cx(), cy(), 5.35, C.purple, 0.35), // ø 5.0 centre to centre
  704: () => digits(cx(), cy(), "8", 4, C.purple),
  705: () => line(`M1,${H - 1}L${W - 1},1`, C.purple, 0.35),
  706: () => ring(cx(), cy(), 6.35, C.purple, 0.35) + ring(cx(), cy(), 4.35, C.purple, 0.35), // ø 6.0 and 4.0 centre to centre
  707: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 0.35, dash(2, 0.5)),
  708: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 0.7),
  709: () => { let d = ""; for (let s = -H; s < W + H; s += 0.8 * Math.SQRT2) d += `M${n(s)},${Y0}L${n(s + H)},${n(Y1())}M${n(s + H)},${Y0}L${n(s)},${n(Y1())}`;
    return `<clipPath id="isom-709"><rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}"/></clipPath><g clip-path="url(#isom-709)">${line(d, C.purple, 0.25)}</g>`
      // hatching 0.25 wide, 0.8 apart at 45°; its outline 0.25: solid (marked continuously, top) or dashed 3.0 / 0.5 (bottom)
      + line(`M${X0},${Y0}H${n(X1())}`, C.purple, 0.25) + line(`M${X0},${n(Y1())}H${n(X1())}`, C.purple, 0.25, dash(3, 0.5)); },
  // two lines 0.35 curving outwards, 3.0 long, at least 0.6 apart inside
  710: () => line(`M${cx() - 0.75},${cy() - 1.5}Q${cx() - 0.2},${cy()} ${cx() - 0.75},${cy() + 1.5}M${cx() + 0.75},${cy() - 1.5}Q${cx() + 0.2},${cy()} ${cx() + 0.75},${cy() + 1.5}`, C.purple, 0.35),
  // crosses of strokes 3.0 long, 0.35 wide, 4.0-6.0 apart, over a wide road
  711: () => fillp(`M0.5,${cy() - 0.22}H${W - 0.5}V${cy() + 0.22}H0.5Z`, C.brown50) + line(straight(cy() - 0.22) + straight(cy() + 0.22), C.black, 0.14)
    + along(5, 2.5, 0.8, W - 0.8).map((x) => cross(x, cy(), 3 / Math.SQRT2, C.purple, 0.35)).join(""),
  712: () => fillp(`M${cx() - 0.67},${cy() - 2}H${cx() + 0.67}V${cy() - 0.67}H${cx() + 2}V${cy() + 0.67}H${cx() + 0.67}V${cy() + 2}H${cx() - 0.67}V${cy() + 0.67}H${cx() - 2}V${cy() - 0.67}H${cx() - 0.67}Z`, C.purple),
  // a cup 3.5 wide and 3.5 high outside, its foot 2.1 wide, lines 0.4: the rim an ellipse 3.5 × 1.1 outside
  713: () => { const ye = cy() - 1.75 + 0.55, yb = ye + 2.75;
    return line(`M${cx() - 1.55},${n(ye)}L${cx() - 0.92},${n(yb - 0.3)}Q${cx() - 0.85},${n(yb)} ${cx()},${n(yb)}Q${cx() + 0.85},${n(yb)} ${cx() + 0.92},${n(yb - 0.3)}L${cx() + 1.55},${n(ye)}`, C.purple, 0.4, ' stroke-linejoin="round"')
      + `<ellipse cx="${cx()}" cy="${n(ye)}" rx="1.55" ry="0.35" fill="none" stroke="${C.purple}" stroke-width="0.4"/>`; },
};

/** The groups, as the specification orders them: their key (`ms.g.<key>` names it), colours and symbols. */
export const GROUPS = [
  { key: "land", colours: ["brown"], codes: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115] },
  { key: "rock", colours: ["black", "grey30"], codes: [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215] },
  { key: "water", colours: ["blue"], codes: [301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313] },
  { key: "veg", colours: ["yellow", "paper", "green"], codes: [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 412, 413, 414, 415, 416, 417, 418, 419] },
  { key: "man", colours: ["black", "brown50", "grey65"], codes: [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532] },
  { key: "tech", colours: ["black"], codes: [601, 602, 603] },
  { key: "course", colours: ["purple"], codes: [701, 702, 703, 704, 705, 706, 707, 708, 709, 710, 711, 712, 713] },
];
/** The symbols that shall not be crossed or entered (the specification's own words): tagged on the page. */
export const FORBIDDEN = new Set([520, 708, 709, 711]);
/** A colour's swatch value (`GROUPS[].colours`). */
export const colour = (k) => C[k] || SC[k];

// ---- sprint maps: ISSprOM 2019-2 (owner, 2026-10-31), revision 6 of January 2024 — its own symbols and dimensions (mm at
// 1:4000), read from its drawings; thick black lines are what may not be crossed ------------------------------------------
const SC = { brown30: "#f3dbc4", brown50s: "#e9c3a2", brownDark: "#ddb48f", blue30: "#b3e3f6", grey35: "#b5b5b5", grey50: "#9a9a9a", grey50dot: "#7d7d7d",
  darkGreen: "#1f6b35", purple50: "#e7a6d1" };
/** A star of five spokes from the centre (prominent water feature). */
const star5 = (d, col, w) => line([0, 72, 144, 216, 288].map((a) => { const r = (a * Math.PI) / 180; return `M${cx()},${cy()}L${n(cx() + Math.sin(r) * d / 2)},${n(cy() - Math.cos(r) * d / 2)}`; }).join(""), col, w, ' stroke-linecap="round"');
/** A V (pit, waterhole, rocky pit) `w` wide and `h` high. */
const vee = (w, h, col, lw) => line(`M${P([[cx() - w / 2, cy() - h / 2], [cx(), cy() + h / 2], [cx() + w / 2, cy() - h / 2]])}`, col, lw);
/** Half dots under a straight line at height y (a wall or earth wall seen from one side: the half dot on the lower side). */
const halfDots = (xs, y, d, col) => xs.map((x) => `<path d="M${n(x - d / 2)},${n(y)}A${d / 2},${d / 2} 0 0 0 ${n(x + d / 2)},${n(y)}Z" fill="${col}"/>`).join("");
const chevrons = (xs, y, s, col, w) => xs.map((x) => line(`M${n(x - s)},${n(y - s)}L${n(x)},${n(y)}L${n(x - s)},${n(y + s)}`, col, w)).join("");
const rect = (x0, y0, x1, y1, col, edge = "", ew = 0.1) => fillp(`M${n(x0)},${n(y0)}H${n(x1)}V${n(y1)}H${n(x0)}Z`, col, edge, ew);
const dashedLines = (cc, w, col, d, g, shift) => { let o = ""; for (let j = 0, y = Y0 + cc / 2; y < Y1(); j++, y += cc) o += line(`M${X0},${n(y)}L${n(X1())},${n(y)}`, col, w, `${dash(d, g)} stroke-dashoffset="${j % 2 ? shift : 0}"`); return o; };

/** The part of the segment a-b inside the box [x0, x1] × [y0, y1] (Liang-Barsky), or null. */
function spClipSeg([ax, ay], [bx, by], x0, y0, x1, y1) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[ax + t0 * dx, ay + t0 * dy], [ax + t1 * dx, ay + t1 * dy]];
}
/** Content clipped to a box; `id` unique to the symbol (a symbol drawn twice on a page defines it twice, identically). */
const spClip = (id, x0, y0, x1, y1, inner) => `<clipPath id="${id}"><rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}"/></clipPath><g clip-path="url(#${id})">${inner}</g>`;
/** Parallel lines `w` wide at `deg` degrees (0 = horizontal, counter-clockwise), `cc` apart centre to centre across their
 *  direction, filling the box and cut by its edges (`id` for the clip; `phase` shifts them by a share of `cc`). */
function spHatch(id, x0, y0, x1, y1, deg, cc, w, col, extra = "", phase = 0.5) {
  const a = (deg * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a), nx = -uy, ny = ux;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0);
  let d = "";
  for (let k = Math.floor(-R / cc) - 1; k <= R / cc + 1; k++) {
    const o = (k + phase) * cc, px = mx + nx * o, py = my + ny * o;
    const s = spClipSeg([px - ux * R, py - uy * R], [px + ux * R, py + uy * R], x0 - w, y0 - w, x1 + w, y1 + w);
    if (s) d += `M${P(s)}`;
  }
  return d ? spClip(id, x0, y0, x1, y1, line(d, col, w, ` stroke-linecap="butt"${extra}`)) : "";
}
/** Dots on a square grid of `s` mm turned 45° (ISSprOM's screens: « ø d, 45°, s (CC) »), inside the box. */
function spScreen45(x0, y0, x1, y1, s, d, col) {
  let o = ""; const h = s / Math.SQRT2;
  for (let j = 0, y = y0 + d / 2 + 0.02; y <= y1 - d / 2 + 1e-6; j++, y += h)
    for (let x = x0 + d / 2 + 0.02 + (j % 2 ? h : 0); x <= x1 - d / 2 + 1e-6; x += 2 * h) o += dot(x, y, d, col);
  return o;
}
/** Dots on a square grid of `s` mm (not turned), inside the box. */
function spScreenSq(x0, y0, x1, y1, s, d, col) {
  let o = "";
  for (let y = y0 + s / 2; y <= y1 - d / 2 + 1e-6; y += s) for (let x = x0 + s / 2; x <= x1 - d / 2 + 1e-6; x += s) o += dot(x, y, d, col);
  return o;
}
/** `count` points at random over the box for dots of diameter d, never closer than `gap` mm edge to edge (none touch):
 *  dart throwing from a fixed seed. */
function spScatter(count, d, gap, seed, x0 = X0 + 0.2, y0 = Y0 + 0.2, x1 = X1() - 0.2, y1 = Y1() - 0.2) {
  const out = []; let s = seed * 9301 + 49297;
  count = Math.round(count * areaK); // as many a mm² in a control circle's square as in a swatch
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let tries = 0; out.length < count && tries < count * 400; tries++) {
    const p = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)];
    if (out.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= d + gap)) out.push(p);
  }
  return out;
}
/** Ticks of a line at height y, `len` long from the line's centre, `w` wide, leaving it at `deg` degrees from the line's
 *  direction (90 = square, 60 = slanting forward), downward (side 1) or upward (-1). */
const spTicks = (xs, y, len, w, col, side = 1, deg = 90) => {
  const a = (deg * Math.PI) / 180;
  return line(xs.map((x) => `M${n(x)},${n(y)}L${n(x + Math.cos(a) * len)},${n(y + side * Math.sin(a) * len)}`).join(""), col, w, ' stroke-linecap="butt"');
};
/** A V drawn to its outer dimensions (112, 203, 303: 1.1 × 1.25 mm OM, line 0.25), its arms cut level at the top. */
function spVee(w, h, lw, col, x = cx(), y = cy(), rot = 0) {
  const al = Math.atan2(w / 2, h), t = lw / Math.cos(al), yi = h - lw / Math.sin(al);
  const pts = [[-w / 2, 0], [-w / 2 + t, 0], [0, yi], [w / 2 - t, 0], [w / 2, 0], [0, h]].map(([u, v]) => [u, v - h / 2]);
  const c = Math.cos(rot), s = Math.sin(rot);
  return fillp(`M${P(pts.map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]))}Z`, col);
}
/** An equilateral triangle of side s (outer), pointing up, its centroid at (x, y): solid, or an outline `lw` wide inside. */
function spEqui(x, y, s, col, lw = 0) {
  const tri = (k) => [[x - k / 2, y + (k * Math.sqrt(3)) / 6], [x + k / 2, y + (k * Math.sqrt(3)) / 6], [x, y - (k * Math.sqrt(3)) / 3]];
  if (!lw) return fillp(`M${P(tri(s))}Z`, col);
  return `<path d="M${P(tri(s))}ZM${P(tri(s - 2 * Math.sqrt(3) * lw))}Z" fill="${col}" fill-rule="evenodd"/>`;
}
/** One block of a boulder field (208): sides 0.96 (base), 0.6 and 0.72 mm, times `k`, turned by `rot`. */
function spBlock(x, y, rot, col, k = 1) {
  const ax = 0.3975, ay = -0.4495, gx = (0.96 + ax) / 3, gy = ay / 3;
  const c = Math.cos(rot), s = Math.sin(rot);
  return fillp(`M${P([[0, 0], [0.96, 0], [ax, ay]].map(([u, v]) => [(u - gx) * k, (v - gy) * k]).map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]))}Z`, col);
}
/** Half dots (diameter d) under a line of width lw at height y, their flat side `inset` mm above the line's lower edge (the
 *  exact definitions: 105.2 0.11, 513.2 0.09). */
const spHalfDots = (xs, y, d, lw, inset, col) => { const yc = y + lw / 2 - inset;
  return xs.map((x) => `<path d="M${n(x - d / 2)},${n(yc)}A${d / 2},${d / 2} 0 0 0 ${n(x + d / 2)},${n(yc)}Z" fill="${col}"/>`).join(""); };
/** A cross in an `s` mm square (outer), its arms `w` wide on the diagonals and cut level with the square's sides (the exact
 *  definitions of 419 and 531). */
const spCross = (id, s, w, col, x = cx(), y = cy()) => { const h = s / 2;
  return spClip(id, x - h, y - h, x + h, y + h, line(`M${n(x - s)},${n(y - s)}L${n(x + s)},${n(y + s)}M${n(x - s)},${n(y + s)}L${n(x + s)},${n(y - s)}`, col, w)); };

const SP = {
  // 1 landforms
  101: () => line(wave(), C.brown, 0.21),
  102: () => line(wave(), C.brown, 0.3),
  103: () => line(wave(), C.brown, 0.15, dash(3, 0.3)),
  // exact definition: line 0.27, tags 0.21 every 0.75, 0.75 long from the line's centre, the first at the line's end
  104: () => { const y = 1.1; return line(straight(y, 0.6, W - 0.6), C.brown, 0.27) + spTicks(along(0.75, 0.105, 0.6, W - 0.6), y, 0.75, 0.21, C.brown); },
  "105.1": () => line(straight(), C.brown, 0.27) + along(3.75, 1.2).map((x) => dot(x, cy(), 0.7, C.brown)).join(""),
  // exact definition: line 0.27, half dots ø 0.7 every 1.9 mm on the lower side, their flat side 0.11 above the line's edge
  "105.2": () => line(straight(), C.brown, 0.27) + spHalfDots(along(1.9, 0.6), cy(), 0.7, 0.27, 0.11, C.brown),
  107: () => {
    const pts = [], m = 24;
    for (let i = 0; i <= m; i++) { const u = i / m, x = 0.6 + u * (W - 1.2), y = cy() + 0.3 * Math.sin(u * Math.PI * 1.6); pts.push([x, y, 0.04 + 0.15 * Math.sin(u * Math.PI)]); }
    return fillp(`M${P([...pts.map(([x, y, h]) => [x, y - h]), ...pts.reverse().map(([x, y, h]) => [x, y + h])])}Z`, C.brown);
  },
  108: () => line(wave(), C.brown, 0.37, ` stroke-linecap="round"${dash(0.001, 0.6)}`),
  109: () => dot(cx(), cy(), 0.75, C.brown),
  110: () => `<ellipse cx="${cx()}" cy="${cy()}" rx="0.6" ry="0.3" fill="${C.brown}" transform="rotate(-25 ${cx()} ${cy()})"/>`,
  // a semicircle 1.2 mm across (OM), 0.6 deep (OM), line 0.25
  111: () => line(`M${cx() - 0.475},${cy() - 0.3}A0.475,0.475 0 0 0 ${cx() + 0.475},${cy() - 0.3}`, C.brown, 0.25),
  // a V 1.1 × 1.25 mm (OM), line 0.25
  112: () => spVee(1.1, 1.25, 0.25, C.brown),
  // dots ø 0.3 at random, touching nothing and forming no line
  113: () => spScatter(16, 0.3, 0.15, 113).map(([x, y]) => dot(x, y, 0.3, C.brown)).join(""),
  // an equilateral triangle 1.35 mm a side (OM), line 0.25
  115: () => spEqui(cx(), cy(), 1.35, C.brown, 0.25),
  // 2 rock and boulders
  // exact definition: line 0.50; tags 0.18 every 0.75, 0.75 long from the line's centre
  201: () => { const y = 1.0; return line(straight(y, 0.6, W - 0.6), C.black, 0.5) + spTicks(along(0.75, 0.09, 0.6, W - 0.6), y, 0.75, 0.18, C.black); },
  // line 0.30: a small vertical rock face without tags, its ends rounded (left), or with tags 0.18 every 0.75, 0.75 long (right)
  202: () => { const y = 1.2; return line(straight(y, 0.6, 2.6), C.black, 0.3, ' stroke-linecap="round"') + line(straight(y, 3.4, W - 0.6), C.black, 0.3) + spTicks(along(0.75, 0.09, 3.4, W - 0.6), y, 0.75, 0.18, C.black); },
  // a V 1.1 × 1.25 mm (OM), line 0.25: north-oriented (left), or pointing into a cave (right)
  203: () => spVee(1.1, 1.25, 0.25, C.black, cx() - 1.2) + spVee(1.1, 1.25, 0.25, C.black, cx() + 1.2, cy(), -0.9),
  204: () => dot(cx(), cy(), 0.6, C.black),
  205: () => dot(cx(), cy(), 0.9, C.black),
  206: () => fillp(`M${P([[cx() - 1, cy() - 0.2], [cx() - 0.35, cy() - 0.95], [cx() + 0.7, cy() - 0.7], [cx() + 1.05, cy() + 0.3], [cx() + 0.2, cy() + 0.95], [cx() - 0.8, cy() + 0.6]])}Z`, C.black),
  // equilateral, 1.2 mm a side; up to 120 % (1.44) to tell neighbouring clusters of different boulders apart
  207: () => spEqui(cx() - 0.9, cy(), 1.2, C.black) + spEqui(cx() + 0.9, cy(), 1.44, C.black),
  // blocks 0.96 × 0.72 × 0.6 placed and turned at random, some at 120 %
  208: () => spScatter(9, 0.96, 0.15, 208).map(([x, y], i) => spBlock(x, y, i * 2.39, C.black, i % 4 === 3 ? 1.2 : 1)).join(""),
  // dots ø 0.25 at random, forming no line
  210: () => spScatter(12, 0.25, 0.15, 210).map(([x, y]) => dot(x, y, 0.25, C.black)).join(""),
  // yellow 50 %, black dots ø 0.18 every 0.5 mm at 45°
  213: () => area(C.yellow50) + spScreen45(X0, Y0, X1(), Y1(), 0.5, 0.18, C.black),
  214: () => area(SC.grey35),
  // 3 water and marsh
  301: () => area(C.blue, C.black, 0.18),
  302: () => area(SC.blue30, C.blue, 0.18),
  // a V 1.1 × 1.25 mm (OM), line 0.25
  303: () => spVee(1.1, 1.25, 0.25, C.blue),
  305: () => line(wave(), C.blue, 0.21),
  306: () => line(wave(), C.blue, 0.21, dash(1.87, 0.37)),
  // blue lines 0.25 every 0.5 mm, a black outline 0.18
  307: () => spHatch("spc-307", X0, Y0, X1(), Y1(), 0, 0.5, 0.25, C.blue) + `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="none" stroke="${C.black}" stroke-width="0.18"/>`,
  // blue lines 0.12 every 0.38 mm
  308: () => spHatch("spc-308", X0, Y0, X1(), Y1(), 0, 0.38, 0.12, C.blue),
  309: () => line(wave(), C.blue, 0.37, ` stroke-linecap="round"${dash(0.001, 0.6)}`),
  310: () => dashedLines(0.38, 0.12, C.blue, 1, 0.35, 0.67),
  // a square 0.9 × 0.9 mm (OM), line 0.25
  311: () => `<rect x="${n(cx() - 0.325)}" y="${n(cy() - 0.325)}" width="0.65" height="0.65" fill="none" stroke="${C.blue}" stroke-width="0.25"/>`,
  // the semicircle of 111 (1.2 × 0.6 mm OM, line 0.25), open toward the outflow: the stream it feeds, as drawn
  312: () => line(`M${n(cx() - 1.3)},${n(cy() - 0.475)}A0.475,0.475 0 0 0 ${n(cx() - 1.3)},${n(cy() + 0.475)}`, C.blue, 0.25)
    + line(`M${n(cx() - 1.3)},${cy()}C${cx()},${cy() - 0.6} ${cx() + 1},${cy() + 0.5} ${W - 0.6},${cy()}`, C.blue, 0.21),
  // five arms 72° apart in a 1.2 mm circle, line 0.25
  313: () => line([0, 72, 144, 216, 288].map((a) => { const r = (a * Math.PI) / 180; return `M${cx()},${cy()}L${n(cx() + Math.sin(r) * 0.59)},${n(cy() - Math.cos(r) * 0.59)}`; }).join(""), C.blue, 0.25, ' stroke-linecap="butt"'),
  // 4 vegetation
  401: () => area(C.yellow),
  // yellow with holes ø 0.6 every 0.75 mm at 45°: green 60 % (scattered bushes, left) or white (scattered trees, right)
  402: () => area(C.yellow) + spScreen45(X0, Y0, cx(), Y1(), 0.75, 0.6, C.green60) + spScreen45(cx(), Y0, X1(), Y1(), 0.75, 0.6, C.paper),
  403: () => area(C.yellow50),
  // yellow 50 % with holes ø 0.7 every 1.0 mm at 45°, green 60 % (left) or white (right)
  404: () => area(C.yellow50) + spScreen45(X0, Y0, cx(), Y1(), 1, 0.7, C.green60) + spScreen45(cx(), Y0, X1(), Y1(), 1, 0.7, C.paper),
  405: () => area(C.paper, "#b8b8b8", 0.06),
  // green 30 %; where running is better one way, white stripes 0.4 wide every 1.5 mm (on the right part, as drawn)
  406: () => area(C.green30) + spHatch("spc-406", cx(), Y0, X1(), Y1(), -15, 1.5, 0.4, C.paper),
  // green lines 0.12 every 0.84 mm
  407: () => spHatch("spc-407", X0, Y0, X1(), Y1(), 90, 0.84, 0.12, C.green),
  // green 60 %; stripes 0.4 every 1.5 mm, white or green 30 %
  408: () => area(C.green60) + spHatch("spc-408a", cx(), Y0, X1(), Y1(), -15, 3, 0.4, C.paper) + spHatch("spc-408b", cx(), Y0, X1(), Y1(), -15, 3, 0.4, C.green30, "", 0),
  // green lines 0.14 every 0.42 mm
  409: () => spHatch("spc-409", X0, Y0, X1(), Y1(), 90, 0.42, 0.14, C.green),
  // green; stripes 0.4 every 1.5 mm, white, green 30 % or green 60 %
  410: () => area(C.green) + spHatch("spc-410a", cx(), Y0, X1(), Y1(), -15, 4.5, 0.4, C.paper) + spHatch("spc-410b", cx(), Y0, X1(), Y1(), -15, 4.5, 0.4, C.green30, "", 0.5 + 1 / 3)
    + spHatch("spc-410c", cx(), Y0, X1(), Y1(), -15, 4.5, 0.4, C.green60, "", 0.5 - 1 / 3),
  411: () => area(SC.darkGreen),
  // yellow, black dots ø 0.2 every 0.8 mm
  412: () => area(C.yellow) + spScreenSq(X0, Y0, X1(), Y1(), 0.8, 0.2, C.black),
  // green dots ø 0.68 every 1.2 mm, on yellow 50 % (left) or yellow (right)
  413: () => rect(X0, Y0, cx(), Y1(), C.yellow50) + rect(cx(), Y0, X1(), Y1(), C.yellow) + spScreenSq(X0, Y0, cx(), Y1(), 1.2, 0.68, C.green) + spScreenSq(cx(), Y0, X1(), Y1(), 1.2, 0.68, C.green),
  // green dashes 0.3 wide, 2.0 long, 0.9 apart, lines 1.3 mm apart and staggered; on yellow 50 % (left) or yellow (right)
  414: () => { const o = rect(X0, Y0, cx(), Y1(), C.yellow50) + rect(cx(), Y0, X1(), Y1(), C.yellow), d = ["", ""];
    for (let j = 0, x = X0 + 0.45; x < X1() - 0.15; j++, x += 1.3) d[j % 2] += `M${n(x)},${Y0}V${n(Y1())}`;
    return o + spClip("spc-414", X0, Y0, X1(), Y1(), line(d[0], C.green, 0.3, ` stroke-linecap="butt"${dash(2, 0.9)}`) + line(d[1], C.green, 0.3, ` stroke-linecap="butt"${dash(2, 0.9)} stroke-dashoffset="1.45"`)); },
  // revision 6: line 0.15
  415: () => rect(X0, Y0, X1(), cy(), C.yellow) + line(straight(cy(), X0, X1()), C.black, 0.15),
  416: () => line(straight(), C.black, 0.25, ` stroke-linecap="round"${dash(0.001, 0.6)}`),
  417: () => ring(cx(), cy(), 1.2, C.green, 0.25),
  418: () => dot(cx(), cy(), 0.8, C.green) + dot(cx(), cy(), 0.2, C.paper),
  // a cross in a 1.2 mm square, line 0.25
  419: () => spCross("spc-419", 1.2, 0.25, C.green),
  // 5 man-made features
  // brown 30 % for light traffic (above), 50 % for heavy traffic (below), bordered by 501.1 (0.1)
  501: () => rect(X0, 0.55, X1(), 1.35, SC.brown30) + rect(X0, 1.65, X1(), 2.45, SC.brown50s) + line(straight(0.55, X0, X1()) + straight(1.35, X0, X1()) + straight(1.65, X0, X1()) + straight(2.45, X0, X1()), C.black, 0.1),
  "501.1": () => area(SC.brown30) + line(straight(cy(), X0, X1()), C.black, 0.1),
  "501.2": () => area(SC.brown30) + line(straight(cy(), X0, X1()), C.black, 0.1, dash(0.7, 0.2)),
  // brown 30 % (50 %) with white holes ø 0.6 every 0.75 mm at 45°
  "501.3": () => area(SC.brown30) + spScreen45(X0, Y0, X1(), Y1(), 0.75, 0.6, C.paper),
  505: () => fillp(`M0.5,${cy() - 0.25}H${W - 0.5}V${cy() + 0.25}H0.5Z`, SC.brown30) + line(straight(cy() - 0.25) + straight(cy() + 0.25), C.black, 0.12, dash(2, 0.25)),
  506: () => line(wave(cy(), 0.25), C.black, 0.27, dash(1.5, 0.37)),
  507: () => line(wave(cy(), 0.25), C.black, 0.27, dash(1.5, 0.37, 1.5, 1.5)),
  508: () => line(wave(cy(), 0.25), C.black, 0.21, dash(4.5, 0.75)),
  "509.1": () => line(straight(), C.black, 0.35) + line(straight(), C.paper, 0.1, dash(1, 1.5)),
  // revision 6: two black lines 0.08, 0.3 mm across (OM)
  "509.2": () => line(straight(cy() - 0.11) + straight(cy() + 0.11), C.black, 0.08),
  // line 0.14; at each pylon a bar 0.14 standing 0.3 mm out on each side
  510: () => line(straight(), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${n(cy() - 0.37)}V${n(cy() + 0.37)}`, C.black, 0.14)).join(""),
  // two lines 0.14 at least 1.5 mm apart; bars 0.2 standing 0.3 out; a pylon's footprint 0.8 × 0.8 (OM), line 0.2
  511: () => line(straight(cy() - 0.75) + straight(cy() + 0.75), C.black, 0.14) + [1.6, 5.2].map((x) => line(`M${x},${n(cy() - 1.12)}V${n(cy() + 1.12)}`, C.black, 0.2)).join("")
    + `<rect x="${n(1.6 - 0.3)}" y="${n(cy() - 0.3)}" width="0.6" height="0.6" fill="none" stroke="${C.black}" stroke-width="0.2"/>`,
  // a row of triangles 0.7 mm a side (solid) on the bridge's edges, their points toward the lower level; the lower way's
  // black edges stop 0.15 mm short of them (as the specification draws it: a way under a crossing road)
  "512.1": () => { const tw = 0.7, th = tw * Math.sqrt(3) / 2, yt = cy() - 0.5, yb = cy() + 0.5, xs = [-2, -1, 0, 1, 2].map((k) => cx() + k * tw);
    const stop = th * (1 - 0.1 / (tw / 2)) + 0.15;
    return rect(cx() - 0.8, 0, cx() + 0.8, H, SC.brown30) + rect(X0, yt, X1(), yb, SC.brown30) + line(straight(yt, X0, X1()) + straight(yb, X0, X1()), C.black, 0.1)
      + line(`M${n(cx() - 0.8)},0V${n(yt - stop)}M${n(cx() + 0.8)},0V${n(yt - stop)}M${n(cx() - 0.8)},${H}V${n(yb + stop)}M${n(cx() + 0.8)},${H}V${n(yb + stop)}`, C.black, 0.1)
      + xs.map((x) => fillp(`M${P([[x - tw / 2, yt], [x + tw / 2, yt], [x, yt - th]])}Z`, C.black) + fillp(`M${P([[x - tw / 2, yb], [x + tw / 2, yb], [x, yb + th]])}Z`, C.black)).join(""); },
  // square dots 0.2 × 0.2 mm, 0.25 apart (here a passage's two sides)
  "512.2": () => line(straight(cy() - 0.5, X0, X1()) + straight(cy() + 0.5, X0, X1()), C.black, 0.2, ` stroke-linecap="butt"${dash(0.2, 0.25)}`),
  // white stripes 0.3 wide every 0.6 mm at 45° over the area's own colour (here a paved area), between 512.2's lines
  "512.3": () => area(SC.brown30) + spHatch("spc-5123", cx() - 0.9, Y0, cx() + 0.9, Y1(), 45, 0.6, 0.3, C.paper)
    + line(`M${n(cx() - 0.9)},${Y0}V${n(Y1())}M${n(cx() + 0.9)},${Y0}V${n(Y1())}`, C.black, 0.2, ` stroke-linecap="butt"${dash(0.2, 0.25)}`),
  "513.1": () => line(straight(), C.black, 0.21) + along(3.75, 1.2).map((x) => dot(x, cy(), 0.6, C.black)).join(""),
  // exact definition: line 0.21, half dots ø 0.6 every 1.9 mm on the lower side, their flat side 0.09 above the line's edge
  "513.2": () => line(straight(), C.black, 0.21) + spHalfDots(along(1.9, 0.6), cy(), 0.6, 0.21, 0.09, C.black),
  // at least 0.4 mm
  515: () => line(straight(), C.black, 0.4),
  // exact definition: line 0.21; tags 0.14, 0.75 long from the line's centre, at 60° to it, every 3.75 mm
  516: () => line(straight(), C.black, 0.21) + spTicks(along(3.75, 0.6), cy(), 0.75, 0.14, C.black, 1, 60),
  // line 0.4; tags in pairs 0.9 mm apart, every 3.75 mm
  518: () => line(straight(), C.black, 0.4) + spTicks(along(3.75, 0.6).flatMap((x) => [x, x + 0.9]).filter((x) => x < W - 0.5), cy(), 0.75, 0.14, C.black, 1, 60),
  // a gap of 1.0 mm (IM) between two bars 0.25 wide and 1.4 long, here in an impassable fence (518)
  519: () => { const g = 0.5 + 0.125;
    return line(`M0.5,${cy()}H${n(cx() - g)}M${n(cx() + g)},${cy()}H${W - 0.5}`, C.black, 0.4) + spTicks([0.9, 1.8, n(cx() + 1.1), n(cx() + 2)], cy(), 0.75, 0.14, C.black, 1, 60)
      + line(`M${n(cx() - g)},${n(cy() - 0.7)}V${n(cy() + 0.7)}M${n(cx() + g)},${n(cy() - 0.7)}V${n(cy() + 0.7)}`, C.black, 0.25, ' stroke-linecap="butt"'); },
  520: () => area(C.olive, C.black, 0.1),
  521: () => rect(cx() - 1.6, cy() - 0.9, cx() + 1.6, cy() + 0.9, SC.grey50, C.black, 0.14),
  522: () => rect(cx() - 1.6, cy() - 0.8, cx() + 1.6, cy() + 0.8, C.grey20, C.black, 0.1),
  // pillars under a canopy, in their own shape, at least 0.5 × 0.5 mm
  "522.1": () => rect(cx() - 1.6, cy() - 0.8, cx() + 1.6, cy() + 0.8, C.grey20, C.black, 0.1) + rect(cx() - 0.25, cy() - 0.25, cx() + 0.25, cy() + 0.25, C.black)
    + rect(cx() - 1.6, cy() + 0.3, cx() - 1.1, cy() + 0.8, C.black) + rect(cx() + 1.1, cy() - 0.8, cx() + 1.6, cy() - 0.3, C.black),
  // exact definition: ø 1.2, its cross 2.1 × 2.1, line 0.25
  524: () => dot(cx(), cy(), 1.2, C.black) + line(`M${cx() - 1.05},${cy()}H${cx() + 1.05}M${cx()},${cy() - 1.05}V${cy() + 1.05}`, C.black, 0.25, ' stroke-linecap="butt"'),
  // a T 1.5 × 1.5 mm (OM), line 0.22
  525: () => line(`M${cx() - 0.75},${n(cy() - 0.64)}H${cx() + 0.75}M${cx()},${n(cy() - 0.64)}V${cy() + 0.75}`, C.black, 0.22, ' stroke-linecap="butt"'),
  526: () => ring(cx(), cy(), 1, C.black, 0.22) + dot(cx(), cy(), 0.2, C.black),
  // exact definition: a stem 1.5 high, arms 0.87 long at 60° from it, 1.5 across, line 0.22
  527: () => { const t = cy() - 0.64, dx = 0.87 * Math.sin(Math.PI / 3), dy = 0.87 * Math.cos(Math.PI / 3);
    return line(`M${n(cx() - dx)},${n(t + dy)}L${cx()},${n(t)}L${n(cx() + dx)},${n(t + dy)}M${cx()},${n(t)}V${cy() + 0.75}`, C.black, 0.22, ' stroke-linecap="butt"'); },
  // exact definition: line 0.21, chevrons of arms 0.75 at 45°, 0.14 wide, every 3.75 mm
  528: () => line(straight(), C.black, 0.21) + chevrons(along(3.75, 1.6), cy(), 0.53, C.black, 0.14),
  529: () => line(straight(), C.black, 0.4) + chevrons(along(3.75, 1.4).flatMap((x) => [x, x + 0.9]).filter((x) => x < W - 0.5), cy(), 0.53, C.black, 0.14),
  530: () => ring(cx(), cy(), 1, C.black, 0.22),
  // a cross in a 1.2 mm square, line 0.22
  531: () => spCross("spc-531", 1.2, 0.22, C.black),
  // the steps drawn simplified: an outline 0.1 and steps 0.1 (as drawn, about 0.47 mm apart); at least 0.4 mm wide (IM)
  532: () => { const x0 = cx() - 1.41, x1 = cx() + 1.41, y0 = cy() - 0.83, y1 = cy() + 0.83; let d = "";
    for (let x = x0 + 0.47; x < x1 - 0.1; x += 0.47) d += `M${n(x)},${n(y0)}V${n(y1)}`;
    return `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" fill="none" stroke="${C.black}" stroke-width="0.1"/>` + line(d, C.black, 0.1, ' stroke-linecap="butt"'); },
  // black 50 % dots ø 0.55 every 0.75 mm at 45°
  533: () => spScreen45(X0, Y0, X1(), Y1(), 0.75, 0.55, SC.grey50),
  // 6 technical symbols
  601: () => line(`M${cx() - 1.5},${Y0}V${n(Y1())}`, C.black, 0.14) + line(`M${cx() + 1.5},${Y0}V${n(Y1())}`, C.blue, 0.18),
};
const SP_COURSE = {
  // an equilateral triangle 7.0 mm a side, line 0.35 (placed in the frame by its height, its centre being the start)
  701: () => line(`M${P([[cx() - 3.5, cy() + 2.86], [cx() + 3.5, cy() + 2.86], [cx(), cy() - 3.2]])}Z`, C.purple, 0.35, ' stroke-linejoin="miter"'),
  702: () => line(`M${cx() - 3},${cy() - 1.25}V${cy() + 1.25}`, C.purple, 0.6) + line(`M${cx() - 2.7},${cy()}H${W - 0.8}`, C.purple, 0.35, dash(2, 0.5)),
  // ø 6.0 mm centre to centre of the line, line 0.35
  703: () => ring(cx(), cy(), 6.35, C.purple, 0.35),
  704: () => digits(cx(), cy(), "8", 4, C.purple),
  705: () => line(`M1,${H - 1}L${W - 1},1`, C.purple, 0.35),
  // two circles ø 5.0 and 7.0 mm centre to centre of the line, line 0.35
  706: () => ring(cx(), cy(), 7.35, C.purple, 0.35) + ring(cx(), cy(), 5.35, C.purple, 0.35),
  707: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 0.35, dash(2, 0.5)),
  708: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 1),
  // revision 6: crossed lines 0.2 every 1.2 mm at 45°; a border 0.4 where the boundary is marked: solid where it is marked
  // continuously, dashed (3.0, gaps 0.5) where it is marked intermittently, none where it is not marked
  709: () => { const x0 = X0, y0 = Y0, x1 = X1(), y1 = Y1(), xm = x0 + (x1 - x0) * 0.55;
    return spHatch("spc-709a", x0, y0, x1, y1, 45, 1.2, 0.2, C.purple) + spHatch("spc-709b", x0, y0, x1, y1, -45, 1.2, 0.2, C.purple)
      + line(`M${n(xm)},${n(y0)}H${n(x0)}V${n(y1)}`, C.purple, 0.4, ' stroke-linecap="butt" stroke-linejoin="miter"')
      + line(`M${n(x0)},${n(y1)}H${n(xm + 3)}`, C.purple, 0.4, ` stroke-linecap="butt"${dash(3, 0.5)}`); },
  // revision 6: two lines 0.5 wide and 4.5 mm long (OM), 1.0 mm apart (IM), bent away from each other; here crossing an
  // uncrossable boundary (708)
  "710.1": () => line(`M${cx()},0V${H}`, C.purple, 1, ' stroke-linecap="butt"')
    + line(`M${n(cx() - 2.25)},${n(cy() - 1.1)}Q${cx()},${n(cy() - 0.4)} ${n(cx() + 2.25)},${n(cy() - 1.1)}M${n(cx() - 2.25)},${n(cy() + 1.1)}Q${cx()},${n(cy() + 0.4)} ${n(cx() + 2.25)},${n(cy() + 1.1)}`, C.purple, 0.5, ' stroke-linecap="butt"'),
  "710.2": () => line(`M2,${cy() - 1.5}L3,${cy() - 0.75}H${W - 3}L${W - 2},${cy() - 1.5}M2,${cy() + 1.5}L3,${cy() + 0.75}H${W - 3}L${W - 2},${cy() + 1.5}`, C.purple, 0.35),
  714: () => fillp(`M${cx() - 3},${cy() - 2}H${cx() + 3}V${cy() + 0.2}H${cx()}V${cy() + 2}H${cx() - 3}Z`, SC.purple50, C.purple, 0.1),
  // a circle ø 6.0 mm (centre to centre of the line) and the triangle inside it, pointing to the next control, line 0.35
  715: () => ring(cx(), cy(), 6.35, C.purple, 0.35) + line(`M${P([[cx() - 2.598, cy() + 1.5], [cx() + 2.598, cy() + 1.5], [cx(), cy() - 3]])}Z`, C.purple, 0.35, ' stroke-linejoin="miter"'),
};

/** The sprint map's groups (ISSprOM 2019-2, revision 6). */
export const GROUPS_SPRINT = [
  { key: "land", colours: ["brown"], codes: ["101", "102", "103", "104", "105.1", "105.2", "107", "108", "109", "110", "111", "112", "113", "115"] },
  { key: "rock", colours: ["black", "grey30"], codes: ["201", "202", "203", "204", "205", "206", "207", "208", "210", "213", "214"] },
  { key: "water", colours: ["blue"], codes: ["301", "302", "303", "305", "306", "307", "308", "309", "310", "311", "312", "313"] },
  { key: "veg", colours: ["yellow", "paper", "green"], codes: ["401", "402", "403", "404", "405", "406", "407", "408", "409", "410", "411", "412", "413", "414", "415", "416", "417", "418", "419"] },
  { key: "man", colours: ["black", "brown30", "grey50"], codes: ["501", "501.1", "501.2", "501.3", "505", "506", "507", "508", "509.1", "509.2", "510", "511", "512.1", "512.2", "512.3",
    "513.1", "513.2", "515", "516", "518", "519", "520", "521", "522", "522.1", "524", "525", "526", "527", "528", "529", "530", "531", "532", "533"] },
  { key: "tech", colours: ["black"], codes: ["601"] },
  { key: "course", colours: ["purple"], codes: ["701", "702", "703", "704", "705", "706", "707", "708", "709", "710.1", "710.2", "714", "715"] },
];
/** What a sprint map says may not be crossed or entered (ISSprOM 2019-2's own words). */
export const FORBIDDEN_SPRINT = new Set(["301", "307", "411", "515", "518", "520", "521", "708", "709"]);
/** The sprint map's own symbols, which a forest map (ISOM 2017-2) does not have. */
export const SPRINT_ONLY = new Set(["105.2", "411", "501.1", "501.2", "501.3", "509.2", "512.2", "512.3", "513.2", "522.1", "533", "710.2", "714", "715"]);

// ---- a control's feature on the map (« Définitions de postes », column D; owner, 2026-11-04: « a Colline would show contour
// lines that draw a colline »): the feature drawn with the map symbol in question — its line widths, tags, fills and
// patterns as above, the specification's —, in the shape the feature has on a map, the control circle at its centre. A
// feature the symbol alone shows (a boulder, a path, a fence) is the symbol as above. Coordinates in circle radii from the
// centre (y down, north up, downhill to the south).
let sceneR = 2.5, sceneN = 0;
const at = (x, y) => [cx() + x * sceneR, cy() + y * sceneR];
/** A smooth curve through points (Catmull-Rom), as a dense polyline in mm. */
function curve(pts, closed = false, k = 10) {
  const q = pts.map(([x, y]) => at(x, y)), m = q.length;
  const p = (i) => (closed ? q[((i % m) + m) % m] : q[Math.max(0, Math.min(m - 1, i))]);
  const out = [];
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  if (!closed) out.push(q[m - 1]);
  return out;
}
const pathOf = (pts, closed = false) => `M${P(pts)}${closed ? "Z" : ""}`;
/** A closed outline round (x, y), radii rx, ry, wobbling a little (fixed by its seed). */
const blob = (x, y, rx, ry, seed = 1, k = 9, wob = 0.08) => curve(Array.from({ length: k }, (_, i) => {
  const a = (i / k) * Math.PI * 2, f = 1 + wob * Math.sin(seed * 7.3 + i * 2.1) * Math.cos(seed * 3.1 + i * 1.3);
  return [x + Math.cos(a) * rx * f, y + Math.sin(a) * ry * f];
}), true);
/** Ticks along a polyline every `step` mm, `len` long from its centre line, `w` wide, on its right (side 1: south of a line
 *  running east) or its left. */
function tagsAlong(pts, step, len, w, col, side = 1, start = step / 2) {
  let d = "", carry = start;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1e-9) continue;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    let s = carry;
    for (; s <= L; s += step) { const x = x0 + ux * s, y = y0 + uy * s; d += `M${n(x)},${n(y)}L${n(x - uy * len * side)},${n(y + ux * len * side)}`; }
    carry = s - L;
  }
  return d ? line(d, col, w, ' stroke-linecap="butt"') : "";
}
/** One tick at the point of the polyline nearest to (x, y) (in radii), on its right or left. */
function tagNear(pts, x, y, len, w, col, side = 1) {
  const [tx, ty] = at(x, y);
  let best = 1;
  pts.forEach((q, i) => { if (i && i < pts.length - 1 && Math.hypot(q[0] - tx, q[1] - ty) < Math.hypot(pts[best][0] - tx, pts[best][1] - ty)) best = i; });
  const a = pts[best - 1], b = pts[best + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, [px, py] = pts[best];
  return line(`M${n(px)},${n(py)}L${n(px - uy * len * side)},${n(py + ux * len * side)}`, col, w, ' stroke-linecap="butt"');
}
/** The line symbols the scenes draw along their own shapes: contours (colour, width, dashes), slope lines (width, length
 *  from the contour's centre), and the tagged lines (line, tags, their spacing and length from the line's centre). */
const LS = {
  forest: { 101: [C.brown, 0.14], 102: [C.brown, 0.25], 103: [C.brown, 0.1, dash(2, 0.2)], slope: [0.14, 0.47],
    104: [C.brown, 0.18, 0.14, 0.5, 0.49], 201: [C.black, 0.35, 0.12, 0.5, 0.575], 202: [C.black, 0.25, 0.12, 0.5, 0.525],
    415: [C.black, 0.14], 416: [C.black, 0.22, ` stroke-linecap="round"${dash(0.001, 0.45)}`], 505: [C.black, 0.25, dash(2, 0.25)] },
  sprint: { 101: [C.brown, 0.21], 102: [C.brown, 0.3], 103: [C.brown, 0.15, dash(3, 0.3)], slope: [0.21, 0.86],
    104: [C.brown, 0.27, 0.21, 0.75, 0.75], 201: [C.black, 0.5, 0.18, 0.75, 0.75], 202: [C.black, 0.3, 0.18, 0.75, 0.75],
    415: [C.black, 0.15], 416: [C.black, 0.25, ` stroke-linecap="round"${dash(0.001, 0.6)}`], 505: [C.black, 0.35, dash(2, 0.3)] },
};
/** The outlines areas have where they end (the bank of water, an uncrossable marsh's border, a paved area's edge). */
const EDGE = { forest: { 301: [C.black, 0.18], 302: [C.blue, 0.1], 307: [C.black, 0.18], 501: [C.black, 0.14] },
  sprint: { 301: [C.black, 0.18], 302: [C.blue, 0.18], 307: [C.black, 0.18], 501: [C.black, 0.1] } };
const CONTOURS = new Set(["101", "102", "103"]);
/** The green screens without the stripes their swatches add for a better direction of running (a thicket is one green). */
const PLAIN = { 406: () => area(C.green30), 408: () => area(C.green60), 410: () => area(C.green) };

/** Everything a scene needs: the symbol drawn as a line along a polyline, an area cut to a shape. */
function sceneKit(sprint) {
  const ls = LS[sprint ? "sprint" : "forest"], edge = EDGE[sprint ? "sprint" : "forest"], draws = sprint ? SP : S;
  const stroke = (code, pts, closed = false) => { const [col, w, extra = ""] = ls[code];
    return line(pathOf(pts, closed), col, w, ` stroke-linejoin="round"${extra}`); };
  const tagged = (code, pts, side = 1) => { const [col, w, tw, step, len] = ls[code];
    return line(pathOf(pts), col, w, ' stroke-linejoin="round"') + tagsAlong(pts, step, len, tw, col, side, step / 2); };
  const slope = (pts, x, y, side = 1) => tagNear(pts, x, y, ls.slope[1], ls.slope[0], C.brown, side);
  /** The area symbol `code` as above, cut to `shape` (polylines in mm; even-odd, so a second one is a hole), with the edge
   *  it has when `edged`. */
  const areaIn = (code, shapes, edged = true) => {
    const draw = PLAIN[code] || draws[code];
    if (!draw) return "";
    const id = `isc${++sceneN}`, d = shapes.map((s) => pathOf(s, true)).join("");
    areaK = ((W - 0.8) * (H - 0.8)) / (6.2 * 2.2);
    const body = draw();
    areaK = 1;
    const e = edged && edge[code];
    return `<clipPath id="${id}"><path d="${d}" clip-rule="evenodd"/></clipPath><g clip-path="url(#${id})">${body}</g>`
      + (e ? shapes.map((s) => line(pathOf(s, true), e[0], e[1], ' stroke-linejoin="round"')).join("") : "");
  };
  const full = (code) => areaIn(code, [[[0, 0], [W, 0], [W, H], [0, H]]], false);
  /** A band `h` radii wide along a curve, as a closed shape. */
  const band = (pts, h) => {
    const q = curve(pts), up = [], down = [];
    q.forEach((p, i) => { const a = q[Math.max(0, i - 1)], b = q[Math.min(q.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, o = (h / 2) * sceneR; up.push([p[0] + nx * o, p[1] + ny * o]); down.unshift([p[0] - nx * o, p[1] - ny * o]); });
    return [...up, ...down];
  };
  const poly = (pts) => pts.map(([x, y]) => at(x, y));
  return { ls, stroke, tagged, slope, areaIn, full, band, poly, has: (code) => !!draws[code] };
}

// contours across the square, bent down (a spur, rounded) or up (a re-entrant, sharper) at the middle
const bent = (y0, d, up = false) => { const s = up ? -1 : 1, k = up ? 0.35 : 0.6;
  return [[-1.7, y0], [-1, y0 + s * 0.08 * d], [-k, y0 + s * 0.55 * d], [0, y0 + s * d], [k, y0 + s * 0.55 * d], [1, y0 + s * 0.08 * d], [1.7, y0]]; };
/** A landform drawn with contours: the feature's own line in the symbol in question (contour, index contour or form line),
 *  the others ordinary contours. */
function contoured(code, k, lines) {
  if (!CONTOURS.has(code)) return null;
  return lines.map(({ pts, closed, main, slope }) => {
    const style = main ? code : "101";
    return k.stroke(style, pts, closed) + (slope ? k.slope(pts, slope[0], slope[1], slope[2] ?? 1) : "");
  }).join("");
}
/** Each feature's scene, by ISCD number: (map symbol, kit) → SVG, or null to show the symbol itself. */
const SCENE = {
  // terrace: a level shelf on a slope, the contour pushed out round it
  "1.1": (c, k) => contoured(c, k, [
    { pts: curve([[-1.7, -1.05], [-0.6, -1.1], [0.6, -1], [1.7, -1.05]]) },
    { pts: curve([[-1.7, -0.6], [-0.8, -0.58], [-0.62, -0.25], [-0.5, 0.28], [0, 0.36], [0.5, 0.28], [0.62, -0.25], [0.8, -0.58], [1.7, -0.6]]), main: true, slope: [0, 0.36] },
    { pts: curve([[-1.7, 0.62], [-0.5, 0.7], [0.6, 0.66], [1.7, 0.6]]) }]),
  "1.2": (c, k) => contoured(c, k, [{ pts: curve(bent(-1.25, 0.55)) }, { pts: curve(bent(-0.55, 0.62)), main: true }, { pts: curve(bent(0.25, 0.7)) }]),
  "1.3": (c, k) => contoured(c, k, [{ pts: curve(bent(1.25, 0.55, true)) }, { pts: curve(bent(0.55, 0.62, true)), main: true, slope: [0, -0.07] }, { pts: curve(bent(-0.25, 0.7, true)) }]),
  "1.4": (c, k) => (c === "104" ? k.tagged("104", curve([[-1.7, -0.12], [-0.6, 0.06], [0.4, -0.08], [1.7, 0.05]])) : null),
  // quarry: a bank round a pit open to the south, its tags inside
  "1.5": (c, k) => (c === "104" ? k.tagged("104", curve([[-0.78, 1.6], [-0.85, 0.1], [-0.45, -0.7], [0.45, -0.7], [0.85, 0.1], [0.78, 1.6]])) : null),
  "1.9": (c, k) => contoured(c, k, [{ pts: blob(0, 0, 1.04, 0.86, 2), closed: true, main: c === "102" }, { pts: blob(0.05, 0, 0.62, 0.46, 3), closed: true, main: c !== "102" }]),
  // saddle: the low point between two hills, one contour round both
  "1.11": (c, k) => contoured(c, k, [
    { pts: blob(-1.02, 0, 0.42, 0.32, 1), closed: true, main: c === "103" }, { pts: blob(1.02, 0, 0.42, 0.32, 2), closed: true, main: c === "103" },
    { pts: curve([[0, -0.32], [0.7, -0.68], [1.4, -0.6], [1.75, 0], [1.4, 0.62], [0.7, 0.68], [0, 0.32], [-0.7, 0.68], [-1.4, 0.62], [-1.75, 0], [-1.4, -0.6], [-0.7, -0.68]], true), closed: true, main: c !== "103" }]),
  // depression: a closed contour with its slope lines inside
  "1.12": (c, k) => { const ring = blob(0, 0, 0.78, 0.6, 4);
    return CONTOURS.has(c) ? contoured(c, k, [{ pts: ring, closed: true, main: true, slope: [0, -0.6] }]) + k.slope(ring, 0, 0.6) : null; },
  // pit, cave: the sprint map's second form of 203 (pointing into a cave) left beside its first
  "1.14": (c, k, sprint) => (sprint && c === "203" ? spVee(1.1, 1.25, 0.25, C.black) : null),
  "2.3": (c, k, sprint) => (sprint && c === "203" ? spVee(1.1, 1.25, 0.25, C.black) : null),
  // a boulder cluster: one (the sprint swatch shows a second, larger, beside it)
  "2.6": (c, k, sprint) => (sprint && c === "207" ? spEqui(cx(), cy(), 1.2, C.black) : null),
  // a narrow passage between two rock faces, their tags toward it
  "2.9": (c, k) => (c === "201" || c === "202" ? k.tagged(c, curve([[-0.48, -1.7], [-0.42, -0.6], [-0.5, 0.4], [-0.44, 1.7]]), -1)
    + k.tagged(c, curve([[0.48, 1.7], [0.43, 0.5], [0.5, -0.5], [0.44, -1.7]]), -1) : null),
  "3.1": (c, k) => (c === "301" ? k.areaIn(c, [blob(1.05, 1.0, 1.75, 1.55, 2)]) : null),
  "3.2": (c, k) => (c === "301" || c === "302" ? k.areaIn(c, [blob(0, 0, 0.5, 0.36, 3)]) : null),
  "3.4": (c, k) => (c === "301" ? (() => { const b = k.band([[-1.7, -0.45], [-0.5, -0.05], [0.5, 0.05], [1.7, 0.4]], 0.42); return k.areaIn(c, [b], false)
    + line(pathOf(b.slice(0, b.length / 2)), C.black, 0.18) + line(pathOf(b.slice(b.length / 2)), C.black, 0.18); })() : null),
  "3.7": (c, k) => (["307", "308", "310"].includes(c) ? k.areaIn(c, [blob(0, 0, 1.2, 0.9, 5)]) : null),
  // firm ground: an island in the marsh
  "3.8": (c, k) => (["307", "308", "310"].includes(c) ? k.areaIn(c, [k.poly([[-2, -2], [2, -2], [2, 2], [-2, 2]]), blob(0, 0, 0.52, 0.38, 5)], false) : null),
  // spring: at the centre, its stream flowing away
  "3.10": (c, k, sprint) => (sprint && c === "312" ? `<g transform="translate(1.5 0)">${SP[312]()}</g>` : null),
  // forest corner: the wood (white forest on open land, or a green on white forest) reaching a corner at the circle's centre
  "4.3": (c, k) => (k.has(c) ? (c === "405" ? k.full("401") : "") + k.areaIn(c, [k.poly([[-2, -2], [0.08, -2], [0.04, -0.5], [0, 0], [-0.5, 0.05], [-2, 0.02]])]) : null),
  "4.4": (c, k) => (c === "401" || c === "403" ? k.areaIn(c, [blob(0, 0, 0.62, 0.48, 1)]) : null),
  "4.5": (c, k) => (["406", "408", "410", "411"].includes(c) ? k.areaIn(c, [blob(0, 0, 0.66, 0.5, 3)]) : null),
  "4.6": (c, k) => (c === "410" || c === "411" ? k.areaIn(c, [k.band([[-1.7, 0.3], [-0.5, 0.04], [0.5, -0.04], [1.7, -0.3]], 0.3)]) : null),
  // vegetation boundary: open land to the north, forest to the south, the boundary between them
  "4.7": (c, k) => { if (c !== "415" && c !== "416") return null; const b = curve([[-1.7, -0.1], [-0.6, 0.06], [0.5, -0.05], [1.7, 0.08]]);
    return k.areaIn("401", [[...b, at(1.7, -2), at(-1.7, -2)]], false) + k.stroke(c, b); },
  // copse: a small wood in open land
  "4.8": (c, k) => (["405", "406", "408", "410"].includes(c) ? k.full("401") + k.areaIn(c, [blob(0, 0, 0.62, 0.48, 4)]) : null),
  // ride: a narrow clearing through the forest
  "5.3": (c, k) => (c === "401" || c === "403" ? k.areaIn(c, [k.band([[-1.7, 0.28], [-0.5, 0.05], [0.5, -0.05], [1.7, -0.28]], 0.2)]) : null),
  // building: one, at the centre (the forest swatch shows its two forms side by side)
  "5.11": (c, k, sprint) => (!sprint && c === "521" ? rect(cx() - 0.7, cy() - 0.5, cx() + 0.7, cy() + 0.5, C.black) : null),
  // power line pylon: the line, the pylon at the centre
  "5.6": (c, k, sprint) => {
    if (c === "510") return line(`M${X0},${cy()}H${n(X1())}`, C.black, 0.14) + line(`M${cx()},${n(cy() - 0.37)}V${n(cy() + 0.37)}`, C.black, 0.14);
    if (c !== "511") return null;
    const g = sprint ? 0.75 : 0.2, b = g + (sprint ? 0.37 : 0.37);
    return line(`M${X0},${n(cy() - g)}H${n(X1())}M${X0},${n(cy() + g)}H${n(X1())}`, C.black, 0.14) + line(`M${cx()},${n(cy() - b)}V${n(cy() + b)}`, C.black, 0.2)
      + (sprint ? `<rect x="${n(cx() - 0.3)}" y="${n(cy() - 0.3)}" width="0.6" height="0.6" fill="${C.paper}" stroke="${C.black}" stroke-width="0.2"/>` : "");
  },
};
/** A feature's scene for a map symbol, its body for a square `side` mm wide, or "" when the symbol alone shows it. */
function sceneOf(ref, code, sprint, side) {
  const scene = SCENE[ref];
  if (!scene) return "";
  W = H = side;
  sceneR = sprint ? 3 : 2.5;
  const body = scene(String(code), sceneKit(sprint), sprint);
  if (!body) return "";
  const id = `isc${++sceneN}`;
  return `<clipPath id="${id}"><rect x="0.5" y="0.5" width="${n(side - 1)}" height="${n(side - 1)}"/></clipPath><g clip-path="url(#${id})">${body}</g>`;
}

/** A symbol's swatch as SVG markup, `width` pixels wide: the map's symbols at 18 px a mm, the course's (much larger) at 7.6
 *  (sprint's at 7), from the forest map's specification or, with `sprint`, the sprint map's. */
export function isomSvg(code, width = 126, cls = "ms-sw", sprint = false) {
  const course = parseFloat(code) >= 700;
  [W, H] = course ? (sprint ? [18, 7.71] : [16.5, 7.07]) : [7, 3];
  const draw = (course ? (sprint ? SP_COURSE : COURSE) : (sprint ? SP : S))[code];
  if (!draw) return "";
  const w = width, h = Math.round((H * width) / W);
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" width="${w}" height="${h}" aria-hidden="true"><rect width="${W}" height="${H}" fill="${C.paper}"/>${ownIds(draw())}</svg>`;
}
/** A map symbol as a control would show it (for ISCD number `ref`: the feature drawn with it, `SCENE`): drawn as above, at the map's scale, in a square a little larger than the control
 *  circle (703: ø 5.0 mm on a forest map, 6.0 on a sprint map), the circle over it at its own size, `width` pixels wide. */
export function isomInCircle(code, width = 64, cls = "ms-sw", sprint = false, ref = "") {
  const draw = (sprint ? SP : S)[code];
  if (!draw || parseFloat(code) >= 700) return "";
  const side = sprint ? 8.4 : 7.4, circle = (sprint ? SP_COURSE : COURSE)[703];
  // the feature in its own shape (a hill's closed contours, a forest corner), else the symbol as its swatch shows it
  const scene = ref ? ownIds(sceneOf(ref, code, sprint, side)) : "";
  if (scene) { W = H = side; return `<svg class="${cls}" viewBox="0 0 ${side} ${side}" width="${width}" height="${width}" aria-hidden="true"><rect width="${side}" height="${side}" fill="${C.paper}"/>${scene}${circle()}</svg>`; }
  // an area fills the square; a point or a line is drawn in its swatch's band, centred
  const area = (sprint ? AREA_SPRINT : AREA).has(String(code));
  let body;
  if (area) { W = H = side; areaK = ((W - 0.8) * (H - 0.8)) / (6.2 * 2.2); body = ownIds(draw()); areaK = 1; }
  else { W = side; H = 3; body = `<g transform="translate(0 ${n((side - 3) / 2 + ((sprint ? LIFT_SPRINT : LIFT)[code] || 0))})">${ownIds(draw())}</g>`; W = H = side; }
  return `<svg class="${cls}" viewBox="0 0 ${side} ${side}" width="${width}" height="${width}" aria-hidden="true"><rect width="${side}" height="${side}" fill="${C.paper}"/>${body}${circle()}</svg>`;
}
/** The areas (drawn over the whole square), forest and sprint. */
const AREA = new Set(["113", "114", "208", "209", "210", "211", "212", "213", "214", "301", "302", "307", "308", "310", "401", "402", "403", "404", "405",
  "406", "407", "408", "409", "410", "412", "413", "414", "501", "520"]);
const AREA_SPRINT = new Set(["113", "208", "210", "213", "214", "301", "302", "307", "308", "310", "401", "402", "403", "404", "405", "406", "407", "408", "409",
  "410", "411", "412", "413", "414", "501", "501.1", "501.2", "501.3", "520", "533"]);
/** The swatches whose line is drawn above the band's middle: moved down so that it runs through the circle's centre. */
const LIFT = { 104: 0.3, 201: 0.3, 202: 0.55 }, LIFT_SPRINT = { 104: 0.4, 201: 0.5, 202: 0.3 };
// Clip paths and patterns get ids of their own in each drawing: the same symbol drawn twice on a page, in frames of different
// sizes, would otherwise take the first one's.
let drawn = 0;
function ownIds(svg) {
  const k = ++drawn;
  return svg.replace(/\bid="([^"]+)"/g, `id="$1-${k}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${k})`);
}
