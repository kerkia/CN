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

// ---- the symbols, by number ------------------------------------------------------------------------------------------
const S = {
  // 1 landforms (brown)
  101: () => line(wave(), C.brown, 0.14),
  102: () => line(wave(), C.brown, 0.25),
  103: () => line(wave(), C.brown, 0.14, dash(2.5, 0.25)),
  104: () => { const y = 1.5; return line(straight(y, 0.8, W - 0.8), C.brown, 0.18) + tagsAt(along(0.5, 0.25, 0.8, W - 0.8), y, 0.9, 0.14, C.brown); },
  105: () => line(straight(), C.brown, 0.18) + along(2, 1).map((x) => dot(x, cy(), 0.45, C.brown)).join(""),
  106: () => line(straight(), C.brown, 0.18, dash(1.65, 0.35)) + along(2, 0.825).map((x) => dot(x, cy(), 0.45, C.brown)).join(""),
  107: () => { // a tapered line, widest in the middle
    const pts = [], m = 24;
    for (let i = 0; i <= m; i++) { const u = i / m, x = 0.8 + u * (W - 1.6), y = cy() + 0.35 * Math.sin(u * Math.PI * 1.6); pts.push([x, y, 0.04 + 0.14 * Math.sin(u * Math.PI)]); }
    return fillp(`M${P([...pts.map(([x, y, h]) => [x, y - h]), ...pts.reverse().map(([x, y, h]) => [x, y + h])])}Z`, C.brown);
  },
  108: () => line(wave(), C.brown, 0.25, ` stroke-linecap="round"${dash(0.001, 0.45)}`),
  109: () => dot(cx(), cy(), 0.5, C.brown),
  110: () => `<ellipse cx="${cx()}" cy="${cy()}" rx="0.4" ry="0.2" fill="${C.brown}" transform="rotate(-25 ${cx()} ${cy()})"/>`,
  111: () => line(`M${cx() - 0.31},${cy() - 0.15}A0.31,0.31 0 0 0 ${cx() + 0.31},${cy() - 0.15}`, C.brown, 0.18),
  112: () => line(`M${P([[cx() - 0.35, cy() - 0.4], [cx(), cy() + 0.4], [cx() + 0.35, cy() - 0.4]])}`, C.brown, 0.18),
  113: () => spread(2.6, 1).map(([x, y]) => dot(x, y, 0.2, C.brown)).join(""),
  114: () => spread(7, 2, 0.15).map(([x, y]) => dot(x, y, 0.2, C.brown)).join(""),
  115: () => line(`M${P([[cx() - 0.42, cy() + 0.32], [cx(), cy() - 0.4], [cx() + 0.42, cy() + 0.32]])}Z`, C.brown, 0.18),
  // 2 rock and boulders (black, grey)
  201: () => { const y = 1.4; return line(straight(y, 0.8, W - 0.8), C.black, 0.35) + tagsAt(along(0.5, 0.25, 0.8, W - 0.8), y, 0.6, 0.12, C.black); },
  202: () => { const y = 1.5; return line(straight(y, 0.8, W - 0.8), C.black, 0.25, ' stroke-linecap="round"') + tagsAt(along(0.5, 0.25, 0.8, W - 0.8), y, 0.4, 0.12, C.black); },
  203: () => line(`M${P([[cx() - 0.35, cy() - 0.4], [cx(), cy() + 0.4], [cx() + 0.35, cy() - 0.4]])}`, C.black, 0.16),
  204: () => dot(cx(), cy(), 0.4, C.black),
  205: () => dot(cx(), cy(), 0.6, C.black),
  206: () => fillp(`M${P([[cx() - 0.9, cy() - 0.2], [cx() - 0.3, cy() - 0.85], [cx() + 0.6, cy() - 0.6], [cx() + 0.95, cy() + 0.3], [cx() + 0.2, cy() + 0.85], [cx() - 0.7, cy() + 0.55]])}Z`, C.black),
  207: () => fillp(`M${P([[cx() - 0.4, cy() + 0.23], [cx() + 0.4, cy() + 0.23], [cx(), cy() - 0.46]])}Z`, C.black),
  208: () => spread(0.55, 3, 0.4).map(([x, y], i) => tri(x, y, 0.8, i * 2.39, C.black)).join(""),
  209: () => spread(1.5, 4, 0.3).map(([x, y], i) => tri(x, y, 0.8, i * 2.39, C.black)).join(""),
  210: () => spread(1.6, 5).map(([x, y]) => dot(x, y, 0.2, C.black)).join(""),
  211: () => spread(3.4, 6).map(([x, y]) => dot(x, y, 0.2, C.black)).join(""),
  212: () => spread(7, 7, 0.15).map(([x, y]) => dot(x, y, 0.2, C.black)).join(""),
  213: () => area(C.yellow50) + grid45(0.64, 0.16, C.black),
  214: () => area(C.grey30),
  215: () => line(straight(cy() - 0.1, 0.8, W - 0.8) + straight(cy() + 0.1, 0.8, W - 0.8), C.black, 0.1),
  // 3 water and marsh (blue)
  301: () => area(C.blue, C.black, 0.18),
  302: () => area(C.blue50, C.blue, 0.1),
  303: () => line(`M${P([[cx() - 0.35, cy() - 0.4], [cx(), cy() + 0.4], [cx() + 0.35, cy() - 0.4]])}`, C.blue, 0.18),
  304: () => line(wave(), C.blue, 0.3),
  305: () => line(wave(), C.blue, 0.18),
  306: () => line(wave(), C.blue, 0.18, dash(1.25, 0.25)),
  307: () => area(C.paper) + lines(0.5, 0.25, C.blue) + `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="none" stroke="${C.black}" stroke-width="0.18"/>`,
  308: () => lines(0.3, 0.1, C.blue),
  309: () => line(wave(), C.blue, 0.25, ` stroke-linecap="round"${dash(0.001, 0.45)}`),
  310: () => { let o = ""; for (let j = 0, y = Y0 + 0.15; y < Y1(); j++, y += 0.3) o += line(`M${X0},${n(y)}L${n(X1())},${n(y)}`, C.blue, 0.1, `${dash(0.9, 0.25)} stroke-dashoffset="${j % 2 ? 0.55 : 0}"`); return o; },
  311: () => `<rect x="${cx() - 0.31}" y="${cy() - 0.31}" width="0.62" height="0.62" fill="none" stroke="${C.blue}" stroke-width="0.18"/>`,
  312: () => line(`M${cx() - 1.6},${cy() - 0.45}A0.36,0.36 0 0 0 ${cx() - 1.6},${cy() + 0.27}`, C.blue, 0.18)
    + line(`M${cx() - 1.6},${cy() - 0.09}C${cx()},${cy() - 0.6} ${cx() + 1},${cy() + 0.5} ${W - 0.6},${cy()}`, C.blue, 0.18),
  313: () => star5(0.9, C.blue, 0.16),
  // 4 vegetation (yellow, green)
  401: () => area(C.yellow),
  402: () => area(C.yellow) + grid45(0.7, 0.4, C.paper),
  403: () => area(C.yellow50),
  404: () => area(C.yellow50) + grid45(0.8, 0.5, C.paper),
  405: () => area(C.paper, "#b8b8b8", 0.06),
  406: () => area(C.green30),
  407: () => area(C.paper) + lines(0.84, 0.12, C.green, true),
  408: () => area(C.green60),
  409: () => area(C.paper) + lines(0.42, 0.14, C.green, true),
  410: () => area(C.green),
  412: () => { let o = area(C.yellow); for (let y = Y0 + 0.4; y < Y1(); y += 0.8) for (let x = X0 + 0.4; x < X1(); x += 0.8) o += dot(x, y, 0.2, C.black); return o; },
  413: () => { let o = area(C.yellow); for (let y = Y0 + 0.4; y < Y1(); y += 0.8) for (let x = X0 + 0.4; x < X1(); x += 0.8) o += dot(x, y, 0.45, C.green); return o; },
  414: () => area(C.yellow) + lines(0.85, 0.2, C.green, true, dash(1.3, 0.2)),
  415: () => area(C.yellow).replace(/height="[\d.]+"/, `height="${n(cy() - Y0)}"`) + line(straight(cy(), X0, X1()), C.black, 0.14),
  416: () => line(straight(), C.black, 0.22, ` stroke-linecap="round"${dash(0.001, 0.45)}`),
  417: () => ring(cx(), cy(), 0.9, C.green, 0.18),
  418: () => dot(cx(), cy(), 0.6, C.green),
  419: () => cross(cx(), cy(), 0.75, C.green, 0.18),
  // 5 man-made features (black, brown, grey)
  501: () => area(C.brown50, C.black, 0.14),
  502: () => fillp(`M0.5,${cy() - 0.37}H${W - 0.5}V${cy() + 0.37}H0.5Z`, C.brown50) + line(straight(cy() - 0.37) + straight(cy() + 0.37), C.black, 0.14),
  503: () => line(wave(cy(), 0.25), C.black, 0.35),
  504: () => line(wave(cy(), 0.25), C.black, 0.35, dash(3, 0.25)),
  505: () => line(wave(cy(), 0.25), C.black, 0.25, dash(2, 0.25)),
  506: () => line(wave(cy(), 0.25), C.black, 0.18, dash(1, 0.25)),
  507: () => line(wave(cy(), 0.25), C.black, 0.18, dash(0.8, 0.25, 0.8, 1)),
  508: () => line(wave(cy(), 0.25), C.black, 0.14, dash(2, 0.25)),
  509: () => line(straight(), C.black, 0.35) + line(straight(), C.paper, 0.1, dash(1, 1.5)),
  510: () => line(straight(), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${cy() - 0.3}V${cy() + 0.3}`, C.black, 0.14)).join(""),
  511: () => line(straight(cy() - 0.2) + straight(cy() + 0.2), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${cy() - 0.45}V${cy() + 0.45}`, C.black, 0.14)).join(""),
  512: () => line(straight(), C.black, 0.25, dash(2, 0.25)) + line(`M${cx() - 1.1},${cy() - 0.75}L${cx() - 0.85},${cy() - 0.45}H${cx() + 0.85}L${cx() + 1.1},${cy() - 0.75}`
    + `M${cx() - 1.1},${cy() + 0.75}L${cx() - 0.85},${cy() + 0.45}H${cx() + 0.85}L${cx() + 1.1},${cy() + 0.75}`, C.black, 0.18),
  513: () => line(straight(), C.black, 0.14) + along(2, 1).map((x) => dot(x, cy(), 0.4, C.black)).join(""),
  514: () => line(straight(), C.black, 0.14, dash(1.65, 0.35)) + along(2, 0.825).map((x) => dot(x, cy(), 0.4, C.black)).join(""),
  515: () => line(straight(), C.black, 0.25) + along(3, 1.1).flatMap((x) => [dot(x, cy(), 0.6, C.black), dot(x + 0.8, cy(), 0.6, C.black)]).join(""),
  516: () => line(straight(), C.black, 0.14) + tagsAt(along(2, 1), cy(), 0.4, 0.14, C.black, -1, 60),
  517: () => line(straight(), C.black, 0.14, dash(1.65, 0.35)) + tagsAt(along(2, 1.1), cy(), 0.4, 0.14, C.black, -1, 60),
  518: () => line(straight(), C.black, 0.25) + tagsAt(along(2.5, 0.9).flatMap((x) => [x, x + 0.6]).filter((x) => x < W - 0.5), cy(), 0.4, 0.14, C.black, -1, 60),
  519: () => line(straight(), C.black, 0.14) + tagsAt(along(2, 1).filter((x) => Math.abs(x - cx()) > 0.6), cy(), 0.4, 0.14, C.black, -1, 60)
    + line(`M${cx() - 0.3},${cy() - 0.5}V${cy() + 0.5}M${cx() + 0.3},${cy() - 0.5}V${cy() + 0.5}`, C.black, 0.18),
  520: () => area(C.olive, C.black, 0.18),
  521: () => fillp(`M${cx() - 1.6},${cy() - 1}H${cx() + 1.6}V${cy() + 1}H${cx() - 1.6}Z`, C.grey65, C.black, 0.2),
  522: () => fillp(`M${cx() - 1.6},${cy() - 0.8}H${cx() + 1.6}V${cy() + 0.8}H${cx() - 1.6}Z`, C.grey20, C.black, 0.1),
  523: () => line(`M${cx() - 1.2},${cy() - 0.8}H${cx() + 1.2}V${cy() + 0.8}H${cx() - 1.2}Z`, C.black, 0.16, dash(0.5, 0.25)),
  524: () => dot(cx(), cy(), 0.8, C.black) + line(`M${cx() - 0.7},${cy()}H${cx() + 0.7}M${cx()},${cy() - 0.7}V${cy() + 0.7}`, C.black, 0.16),
  525: () => line(`M${cx() - 0.5},${cy() - 0.42}H${cx() + 0.5}M${cx()},${cy() - 0.42}V${cy() + 0.5}`, C.black, 0.16),
  526: () => ring(cx(), cy(), 0.8, C.black, 0.14),
  527: () => line(`M${cx() - 0.3},${cy() - 0.12}L${cx()},${cy() - 0.45}L${cx() + 0.3},${cy() - 0.12}M${cx()},${cy() - 0.45}V${cy() + 0.45}`, C.black, 0.16),
  528: () => line(straight(), C.black, 0.14) + along(2, 1).map((x) => line(`M${n(x - 0.28)},${cy() - 0.28}L${n(x)},${cy()}L${n(x - 0.28)},${cy() + 0.28}`, C.black, 0.14)).join(""),
  529: () => line(straight(), C.black, 0.25) + along(2, 1).flatMap((x) => [x, x + 0.6]).map((x) => line(`M${n(x - 0.28)},${cy() - 0.28}L${n(x)},${cy()}L${n(x - 0.28)},${cy() + 0.28}`, C.black, 0.14)).join(""),
  530: () => ring(cx(), cy(), 0.8, C.black, 0.16),
  531: () => cross(cx(), cy(), 0.66, C.black, 0.16),
  532: () => { const x0 = cx() - 1.8, x1 = cx() + 1.8, y0 = cy() - 0.3, y1 = cy() + 0.3; let d = `M${x0},${y0}H${x1}M${x0},${y1}H${x1}`; for (let x = x0; x <= x1 + 1e-6; x += 0.25) d += `M${n(x)},${y0}V${y1}`; return line(d, C.black, 0.1); },
  // 6 technical symbols
  601: () => line(`M${cx() - 2},${Y0}V${n(Y1())}M${cx() + 2},${Y0}V${n(Y1())}`, C.black, 0.1) + line(`M${cx()},${Y0}V${n(Y1())}`, C.blue, 0.18),
  602: () => line(`M${cx() - 1.1},${cy()}H${cx() + 1.1}M${cx()},${cy() - 1.1}V${cy() + 1.1}`, C.black, 0.1),
  603: () => dot(cx() - 1.3, cy() + 0.15, 0.3, C.black) + text(cx() + 0.1, cy() + 0.55, "219", 1.5, C.black),
};
// 7 course planning symbols (purple): drawn in a larger frame, so smaller (they are much larger than the map's symbols)
const COURSE = {
  701: () => line(`M${P([[cx() - 3, cy() + 1.732], [cx() + 3, cy() + 1.732], [cx(), cy() - 3.464]])}Z`, C.purple, 0.35, ' stroke-linejoin="miter"'),
  702: () => line(`M${cx() - 2.5},${cy() - 1.25}V${cy() + 1.25}`, C.purple, 0.6) + line(`M${cx() - 2.2},${cy()}H${W - 0.8}`, C.purple, 0.35, dash(2, 0.5)),
  703: () => ring(cx(), cy(), 5, C.purple, 0.35),
  704: () => text(cx(), cy() + 1.45, "8", 4, C.purple),
  705: () => line(`M1,${H - 1}L${W - 1},1`, C.purple, 0.35),
  706: () => ring(cx(), cy(), 6, C.purple, 0.35) + ring(cx(), cy(), 4, C.purple, 0.35),
  707: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 0.35, dash(2, 0.5)),
  708: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 0.7),
  709: () => { let d = ""; for (let s = -H; s < W + H; s += 0.8 * Math.SQRT2) d += `M${n(s)},${Y0}L${n(s + H)},${n(Y1())}M${n(s + H)},${Y0}L${n(s)},${n(Y1())}`;
    return `<clipPath id="isom-709"><rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}"/></clipPath><g clip-path="url(#isom-709)">${line(d, C.purple, 0.25)}</g>`
      + `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="none" stroke="${C.purple}" stroke-width="0.25"/>`; },
  710: () => line(`M${cx() - 0.75},${cy() - 1.5}Q${cx() - 0.15},${cy()} ${cx() - 0.75},${cy() + 1.5}M${cx() + 0.75},${cy() - 1.5}Q${cx() + 0.15},${cy()} ${cx() + 0.75},${cy() + 1.5}`, C.purple, 0.35),
  711: () => line(straight(), C.black, 0.25, dash(2, 0.25)) + along(4.5, 2.25, 0.8, W - 0.8).map((x) => cross(x, cy(), 1.1, C.purple, 0.35)).join(""),
  712: () => fillp(`M${cx() - 0.67},${cy() - 2}H${cx() + 0.67}V${cy() - 0.67}H${cx() + 2}V${cy() + 0.67}H${cx() + 0.67}V${cy() + 2}H${cx() - 0.67}V${cy() + 0.67}H${cx() - 2}V${cy() - 0.67}H${cx() - 0.67}Z`, C.purple),
  713: () => line(`M${cx() - 1.55},${cy() - 1.55}L${cx() - 0.85},${cy() + 1.55}H${cx() + 0.85}L${cx() + 1.55},${cy() - 1.55}Z`, C.purple, 0.4, ' stroke-linejoin="round"')
    + `<ellipse cx="${cx()}" cy="${cy() - 1.55}" rx="1.55" ry="0.35" fill="none" stroke="${C.purple}" stroke-width="0.3"/>`,
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
const SC = { brown30: "#f3dbc4", brownDark: "#ddb48f", blue30: "#b3e3f6", grey35: "#b5b5b5", grey50: "#9a9a9a", grey50dot: "#7d7d7d",
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

const SP = {
  // 1 landforms
  101: () => line(wave(), C.brown, 0.21),
  102: () => line(wave(), C.brown, 0.3),
  103: () => line(wave(), C.brown, 0.15, dash(3, 0.3)),
  104: () => { const y = 1.1; return line(straight(y, 0.6, W - 0.6), C.brown, 0.27) + tagsAt(along(0.75, 0.37, 0.6, W - 0.6), y, 0.9, 0.21, C.brown); },
  "105.1": () => line(straight(), C.brown, 0.27) + along(3.75, 1.2).map((x) => dot(x, cy(), 0.7, C.brown)).join(""),
  "105.2": () => line(straight(), C.brown, 0.27) + halfDots(along(1.9, 0.6), cy(), 0.7, C.brown),
  107: () => {
    const pts = [], m = 24;
    for (let i = 0; i <= m; i++) { const u = i / m, x = 0.6 + u * (W - 1.2), y = cy() + 0.3 * Math.sin(u * Math.PI * 1.6); pts.push([x, y, 0.04 + 0.15 * Math.sin(u * Math.PI)]); }
    return fillp(`M${P([...pts.map(([x, y, h]) => [x, y - h]), ...pts.reverse().map(([x, y, h]) => [x, y + h])])}Z`, C.brown);
  },
  108: () => line(wave(), C.brown, 0.37, ` stroke-linecap="round"${dash(0.001, 0.6)}`),
  109: () => dot(cx(), cy(), 0.75, C.brown),
  110: () => `<ellipse cx="${cx()}" cy="${cy()}" rx="0.6" ry="0.3" fill="${C.brown}" transform="rotate(-25 ${cx()} ${cy()})"/>`,
  111: () => line(`M${cx() - 0.48},${cy() - 0.2}A0.48,0.48 0 0 0 ${cx() + 0.48},${cy() - 0.2}`, C.brown, 0.25),
  112: () => vee(1.1, 1.25, C.brown, 0.25),
  113: () => spread(2.2, 1, 0.2).map(([x, y]) => dot(x, y, 0.3, C.brown)).join(""),
  115: () => line(`M${P([[cx() - 0.6, cy() + 0.45], [cx(), cy() - 0.55], [cx() + 0.6, cy() + 0.45]])}Z`, C.brown, 0.25),
  // 2 rock and boulders
  201: () => { const y = 1.0; return line(straight(y, 0.6, W - 0.6), C.black, 0.5) + tagsAt(along(0.75, 0.37, 0.6, W - 0.6), y, 0.9, 0.18, C.black); },
  202: () => { const y = 1.2; return line(straight(y, 0.6, W - 0.6), C.black, 0.3, ' stroke-linecap="round"') + tagsAt(along(0.75, 0.37, 0.6, W - 0.6), y, 0.75, 0.18, C.black); },
  203: () => vee(1.1, 1.25, C.black, 0.25),
  204: () => dot(cx(), cy(), 0.6, C.black),
  205: () => dot(cx(), cy(), 0.9, C.black),
  206: () => fillp(`M${P([[cx() - 1, cy() - 0.2], [cx() - 0.35, cy() - 0.95], [cx() + 0.7, cy() - 0.7], [cx() + 1.05, cy() + 0.3], [cx() + 0.2, cy() + 0.95], [cx() - 0.8, cy() + 0.6]])}Z`, C.black),
  207: () => fillp(`M${P([[cx() - 0.6, cy() + 0.35], [cx() + 0.6, cy() + 0.35], [cx(), cy() - 0.69]])}Z`, C.black),
  208: () => spread(0.9, 3, 0.3).map(([x, y], i) => tri(x, y, 0.96, i * 2.39, C.black)).join(""),
  210: () => spread(3, 5, 0.2).map(([x, y]) => dot(x, y, 0.25, C.black)).join(""),
  213: () => area(C.yellow50) + grid45(0.5, 0.18, C.black),
  214: () => area(SC.grey35),
  // 3 water and marsh
  301: () => area(C.blue, C.black, 0.18),
  302: () => area(SC.blue30, C.blue, 0.18),
  303: () => vee(1.1, 1.25, C.blue, 0.25),
  305: () => line(wave(), C.blue, 0.21),
  306: () => line(wave(), C.blue, 0.21, dash(1.87, 0.37)),
  307: () => area(C.paper) + lines(0.5, 0.25, C.blue) + `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="none" stroke="${C.black}" stroke-width="0.18"/>`,
  308: () => lines(0.38, 0.12, C.blue),
  309: () => line(wave(), C.blue, 0.37, ` stroke-linecap="round"${dash(0.001, 0.6)}`),
  310: () => dashedLines(0.38, 0.12, C.blue, 1, 0.35, 0.67),
  311: () => `<rect x="${cx() - 0.33}" y="${cy() - 0.33}" width="0.66" height="0.66" fill="none" stroke="${C.blue}" stroke-width="0.25"/>`,
  312: () => line(`M${cx() - 1.6},${cy() - 0.55}A0.42,0.42 0 0 0 ${cx() - 1.6},${cy() + 0.29}`, C.blue, 0.25)
    + line(`M${cx() - 1.6},${cy() - 0.13}C${cx()},${cy() - 0.6} ${cx() + 1},${cy() + 0.5} ${W - 0.6},${cy()}`, C.blue, 0.21),
  313: () => star5(1.2, C.blue, 0.25),
  // 4 vegetation
  401: () => area(C.yellow),
  402: () => area(C.yellow) + grid45(0.75, 0.6, C.paper),
  403: () => area(C.yellow50),
  404: () => area(C.yellow50) + grid45(1, 0.7, C.paper),
  405: () => area(C.paper, "#b8b8b8", 0.06),
  406: () => area(C.green30),
  407: () => area(C.paper) + lines(0.84, 0.12, C.green, true),
  408: () => area(C.green60),
  409: () => area(C.paper) + lines(0.42, 0.14, C.green, true),
  410: () => area(C.green),
  411: () => area(SC.darkGreen),
  412: () => { let o = area(C.yellow); for (let y = Y0 + 0.4; y < Y1(); y += 0.8) for (let x = X0 + 0.4; x < X1(); x += 0.8) o += dot(x, y, 0.2, C.black); return o; },
  413: () => { let o = area(C.yellow); for (let y = Y0 + 0.5; y < Y1(); y += 1.2) for (let x = X0 + 0.5; x < X1(); x += 1.2) o += dot(x, y, 0.68, C.green); return o; },
  414: () => area(C.yellow) + lines(0.9, 0.3, C.green, true, dash(1.3, 0.7)),
  415: () => area(C.yellow).replace(/height="[\d.]+"/, `height="${n(cy() - Y0)}"`) + line(straight(cy(), X0, X1()), C.black, 0.15),
  416: () => line(straight(), C.black, 0.25, ` stroke-linecap="round"${dash(0.001, 0.6)}`),
  417: () => ring(cx(), cy(), 1.2, C.green, 0.25),
  418: () => dot(cx(), cy(), 0.8, C.green) + dot(cx(), cy(), 0.2, C.paper),
  419: () => cross(cx(), cy(), 0.85, C.green, 0.25),
  // 5 man-made features
  501: () => area(SC.brown30, C.black, 0.1),
  "501.1": () => area(SC.brown30) + line(straight(cy(), X0, X1()), C.black, 0.1),
  "501.2": () => area(SC.brown30) + line(straight(cy(), X0, X1()), C.black, 0.1, dash(0.7, 0.2)),
  "501.3": () => area(SC.brown30) + grid45(0.75, 0.6, C.paper),
  505: () => fillp(`M0.5,${cy() - 0.25}H${W - 0.5}V${cy() + 0.25}H0.5Z`, SC.brown30) + line(straight(cy() - 0.25) + straight(cy() + 0.25), C.black, 0.12, dash(2, 0.25)),
  506: () => line(wave(cy(), 0.25), C.black, 0.27, dash(1.5, 0.37)),
  507: () => line(wave(cy(), 0.25), C.black, 0.27, dash(1.5, 0.37, 1.5, 1.5)),
  508: () => line(wave(cy(), 0.25), C.black, 0.21, dash(4.5, 0.75)),
  "509.1": () => line(straight(), C.black, 0.35) + line(straight(), C.paper, 0.1, dash(1, 1.5)),
  "509.2": () => line(straight(cy() - 0.15) + straight(cy() + 0.15), SC.grey50dot, 0.08),
  510: () => line(straight(), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${cy() - 0.3}V${cy() + 0.3}`, C.black, 0.14)).join(""),
  511: () => line(straight(cy() - 0.4) + straight(cy() + 0.4), C.black, 0.14) + along(3.6, 1.2).map((x) => line(`M${n(x)},${cy() - 0.6}V${cy() + 0.6}`, C.black, 0.14)).join(""),
  "512.1": () => rect(X0, cy() - 0.55, X1(), cy() + 0.55, SC.brown30) + line(straight(cy() - 0.55, X0, X1()) + straight(cy() + 0.55, X0, X1()), C.black, 0.1)
    + rect(cx() - 0.7, Y0, cx() + 0.7, Y1(), SC.brown30) + line(`M${cx() - 1},${Y0 + 0.1}L${cx() - 0.7},${Y0 + 0.4}V${n(Y1() - 0.4)}L${cx() - 1},${n(Y1() - 0.1)}`
    + `M${cx() + 1},${Y0 + 0.1}L${cx() + 0.7},${Y0 + 0.4}V${n(Y1() - 0.4)}L${cx() + 1},${n(Y1() - 0.1)}`, C.black, 0.15),
  "512.2": () => rect(X0, cy() - 0.5, X1(), cy() + 0.5, SC.brown30) + line(straight(cy() - 0.5, X0, X1()) + straight(cy() + 0.5, X0, X1()), C.black, 0.2, ` stroke-linecap="round"${dash(0.001, 0.45)}`),
  "512.3": () => { let d = ""; for (let s = -H; s < W + H; s += 0.6 * Math.SQRT2) d += `M${n(s)},${Y0}L${n(s + H)},${n(Y1())}`;
    return area(SC.brown30) + `<clipPath id="issprom-5123"><rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}"/></clipPath><g clip-path="url(#issprom-5123)">${line(d, SC.brownDark, 0.25)}</g>`; },
  "513.1": () => line(straight(), C.black, 0.21) + along(3.75, 1.2).map((x) => dot(x, cy(), 0.6, C.black)).join(""),
  "513.2": () => line(straight(), C.black, 0.21) + halfDots(along(1.9, 0.6), cy(), 0.6, C.black),
  515: () => line(straight(), C.black, 0.45),
  516: () => line(straight(), C.black, 0.21) + tagsAt(along(3.75, 1.2), cy(), 0.75, 0.14, C.black, -1, 60),
  518: () => line(straight(), C.black, 0.45) + tagsAt(along(3.75, 1.2).flatMap((x) => [x, x + 0.9]).filter((x) => x < W - 0.5), cy(), 0.75, 0.14, C.black, -1, 60),
  519: () => line(`M0.5,${cy()}H${cx() - 0.5}M${cx() + 0.5},${cy()}H${W - 0.5}`, C.black, 0.45) + line(`M${cx() - 0.5},${cy() - 0.5}V${cy() + 0.5}M${cx() + 0.5},${cy() - 0.5}V${cy() + 0.5}`, C.black, 0.25),
  520: () => area(C.olive, C.black, 0.1),
  521: () => rect(cx() - 1.6, cy() - 0.9, cx() + 1.6, cy() + 0.9, SC.grey50, C.black, 0.14),
  522: () => rect(cx() - 1.6, cy() - 0.8, cx() + 1.6, cy() + 0.8, C.grey20, C.black, 0.1),
  "522.1": () => rect(cx() - 1.6, cy() - 0.8, cx() + 1.6, cy() + 0.8, C.grey20, C.black, 0.1) + rect(cx() - 0.25, cy() - 0.25, cx() + 0.25, cy() + 0.25, C.black),
  524: () => dot(cx(), cy(), 1.2, C.black) + line(`M${cx() - 1.05},${cy()}H${cx() + 1.05}M${cx()},${cy() - 1.05}V${cy() + 1.05}`, C.black, 0.25),
  525: () => line(`M${cx() - 0.75},${cy() - 0.65}H${cx() + 0.75}M${cx()},${cy() - 0.65}V${cy() + 0.75}`, C.black, 0.22),
  526: () => ring(cx(), cy(), 1, C.black, 0.22) + dot(cx(), cy(), 0.2, C.black),
  527: () => line(`M${cx() - 0.45},${cy() - 0.2}L${cx()},${cy() - 0.75}L${cx() + 0.45},${cy() - 0.2}M${cx()},${cy() - 0.75}V${cy() + 0.75}`, C.black, 0.22),
  528: () => line(straight(), C.black, 0.14) + chevrons(along(3.75, 1.6), cy(), 0.53, C.black, 0.14),
  529: () => line(straight(), C.black, 0.4) + chevrons(along(3.75, 1.4).flatMap((x) => [x, x + 0.9]).filter((x) => x < W - 0.5), cy(), 0.53, C.black, 0.14),
  530: () => ring(cx(), cy(), 1, C.black, 0.22),
  531: () => cross(cx(), cy(), 0.85, C.black, 0.22),
  532: () => { const x0 = cx() - 1.8, x1 = cx() + 1.8, y0 = cy() - 0.35, y1 = cy() + 0.35; let d = `M${x0},${y0}H${x1}M${x0},${y1}H${x1}`; for (let x = x0; x <= x1 + 1e-6; x += 0.3) d += `M${n(x)},${y0}V${y1}`; return line(d, C.black, 0.1); },
  533: () => grid45(0.75, 0.55, SC.grey50dot),
  // 6 technical symbols
  601: () => line(`M${cx() - 1.5},${Y0}V${n(Y1())}`, C.black, 0.14) + line(`M${cx() + 1.5},${Y0}V${n(Y1())}`, C.blue, 0.18),
};
const SP_COURSE = {
  701: () => line(`M${P([[cx() - 3.5, cy() + 2.02], [cx() + 3.5, cy() + 2.02], [cx(), cy() - 4.04]])}Z`, C.purple, 0.35, ' stroke-linejoin="miter"'),
  702: () => line(`M${cx() - 3},${cy() - 1.25}V${cy() + 1.25}`, C.purple, 0.6) + line(`M${cx() - 2.7},${cy()}H${W - 0.8}`, C.purple, 0.35, dash(2, 0.5)),
  703: () => ring(cx(), cy(), 6, C.purple, 0.35),
  704: () => text(cx(), cy() + 1.45, "8", 4, C.purple),
  705: () => line(`M1,${H - 1}L${W - 1},1`, C.purple, 0.35),
  706: () => ring(cx(), cy(), 7, C.purple, 0.35) + ring(cx(), cy(), 5, C.purple, 0.35),
  707: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 0.35, dash(2, 0.5)),
  708: () => line(straight(cy(), 0.8, W - 0.8), C.purple, 1),
  709: () => { let d = ""; for (let s = -H; s < W + H; s += 1.2 * Math.SQRT2) d += `M${n(s)},${Y0}L${n(s + H)},${n(Y1())}M${n(s + H)},${Y0}L${n(s)},${n(Y1())}`;
    return `<clipPath id="issprom-709"><rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}"/></clipPath><g clip-path="url(#issprom-709)">${line(d, C.purple, 0.2)}</g>`
      + `<rect x="${X0}" y="${Y0}" width="${n(X1() - X0)}" height="${n(Y1() - Y0)}" fill="none" stroke="${C.purple}" stroke-width="0.5"/>`; },
  "710.1": () => line(straight(cy(), 0.8, W - 0.8), C.black, 0.45) + line(`M${cx() - 0.9},${cy() - 2.2}Q${cx() - 0.35},${cy()} ${cx() - 0.9},${cy() + 2.2}M${cx() + 0.9},${cy() - 2.2}Q${cx() + 0.35},${cy()} ${cx() + 0.9},${cy() + 2.2}`, C.purple, 0.35),
  "710.2": () => line(`M2,${cy() - 1.5}L3,${cy() - 0.75}H${W - 3}L${W - 2},${cy() - 1.5}M2,${cy() + 1.5}L3,${cy() + 0.75}H${W - 3}L${W - 2},${cy() + 1.5}`, C.purple, 0.35),
  714: () => fillp(`M${cx() - 3},${cy() - 2}H${cx() + 3}V${cy() + 0.2}H${cx()}V${cy() + 2}H${cx() - 3}Z`, SC.purple50, C.purple, 0.1),
  715: () => ring(cx(), cy(), 6, C.purple, 0.35) + line(`M${P([[cx() - 1.9, cy() + 1.1], [cx() + 1.9, cy() + 1.1], [cx(), cy() - 2.2]])}Z`, C.purple, 0.35, ' stroke-linejoin="miter"'),
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
export const SPRINT_ONLY = new Set(["105.2", "501.1", "501.2", "501.3", "509.2", "512.2", "512.3", "513.2", "522.1", "533", "710.2", "714", "715"]);

/** A symbol's swatch as SVG markup, `width` pixels wide: the map's symbols at 18 px a mm, the course's (much larger) at 7.6
 *  (sprint's at 7), from the forest map's specification or, with `sprint`, the sprint map's. */
export function isomSvg(code, width = 126, cls = "ms-sw", sprint = false) {
  const course = parseFloat(code) >= 700;
  [W, H] = course ? (sprint ? [18, 7.71] : [16.5, 7.07]) : [7, 3];
  const draw = (course ? (sprint ? SP_COURSE : COURSE) : (sprint ? SP : S))[code];
  if (!draw) return "";
  const w = width, h = Math.round((H * width) / W);
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" width="${w}" height="${h}" aria-hidden="true"><rect width="${W}" height="${H}" fill="${C.paper}"/>${draw()}</svg>`;
}
