// Reading the course printed on the map — the purple overprint: the control circles, the finish's double circle, the
// start triangle, the leg lines — by image analysis in the browser, nothing sent anywhere.
// 1. A purple mask over the image (read at 1800 px at most, smaller when its lines come out wider than 3 px): the
//    pixels whose hue runs from violet to magenta and that are saturated. The overprint stays purple over yellow and green; over black it is lost, which the ring
//    scores tolerate.
// 2. Circles by a Hough vote: every purple pixel votes, at 24 angles, for the centres at each of 20 radii, on a grid
//    of 4 px; the peaks are refined at full resolution by the share of the ring that is purple (72 samples, a pixel of
//    tolerance), and a ring must be hollow inside and clear outside — a small circle laid on a thick line would pass
//    otherwise; radii below 2.5 line widths are not tried. The control radius r* is the radius the good circles share;
//    the finish is the larger circle concentric with one of them.
// 3. The leg lines: a purple pixel through which a straight purple run of 2.2 r* passes (12 directions) is a line
//    pixel — the run need not be centred on it, so the lines' ends count. A control is a circle a line reaches; a
//    circle of the right size that no line reaches (a digit's loop, a logo) is dropped when enough are reached. With
//    the rings and lines removed, the purple blobs of the triangle's size are scored against an equilateral triangle
//    (orientation, size and centre searched), as are the circles' centres (the start is often drawn in the finish):
//    the best one is the start.
// Positions come back in the image's own pixels.

const RADII = [6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 19, 21, 23, 26, 29, 32, 36, 40, 45, 50];
const ANGLES = 24, STRIDE = 4;

export async function detectCourse(image, { maxSide = 1800, debug = false } = {}) {
  const W = image.width, H = image.height;
  let s = Math.min(1, maxSide / Math.max(W, H)), w, h, full, lw;
  const read = () => {
    w = Math.max(1, Math.round(W * s)); h = Math.max(1, Math.round(H * s));
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0, w, h);
    full = purpleMask(g.getImageData(0, 0, w, h).data, w, h);
    lw = lineWidth(full, w, h);
  };
  read();
  // the reading is made for an overprint line about 3 px wide (its tolerances are in pixels): a sharper image — a
  // phone's photo of the whole map, 4000 px — is read smaller, else the title's letters come out as rings (2026-10-14)
  if (lw > 3) { s *= 3 / lw; read(); }
  // thick purple — a title, the class names, a logo — is not the course: keep what is thinner than three line widths
  const mask = thinOnly(full, w, h, Math.max(1, Math.round(1.5 * lw)));
  const dil = dilate(mask, w, h);
  const { circles, rStar, found } = findCircles(mask, dil, w, h, lw);
  let controls = [], finish = null, start = null, startCands = null;
  if (rStar) {
    controls = circles.filter((c) => c.r >= 0.75 * rStar && c.r <= 1.25 * rStar);
    // the finish: the larger circle concentric with a control-sized one (or alone, if clearly a ring)
    for (const o of circles.filter((c) => c.r > 1.25 * rStar && c.r <= 1.8 * rStar).sort((a, b) => b.score - a.score)) {
      const inner = controls.find((c) => Math.hypot(c.x - o.x, c.y - o.y) < 0.35 * rStar);
      if (inner || (o.score >= 0.8 && o.raw >= 0.5)) {
        finish = { x: inner ? (o.x + inner.x) / 2 : o.x, y: inner ? (o.y + inner.y) / 2 : o.y, r1: inner ? inner.r : null, r2: o.r, score: o.score };
        if (inner) controls = controls.filter((c) => c !== inner);
        break;
      }
    }
    const lines = markLines(mask, dil, w, h, rStar, 2.2);
    const longLines = markLines(mask, dil, w, h, rStar, 2.9);              // a triangle's side (2.1 r*) must survive
    // a control circle never overlaps the finish's circles or the start triangle: what is found there is their own
    const nearSymbol = (c) => (finish && Math.hypot(c.x - finish.x, c.y - finish.y) < 1.2 * rStar);
    controls = controls.filter((c) => !nearSymbol(c));
    // a control is where the leg lines go: a circle of the right size that no line reaches (the loop of a digit, a
    // logo) is dropped when enough circles are reached — the lines end at the circles' edges, in a thin ring around
    for (const c of controls) c.touch = ringTouch(lines, w, h, c.x, c.y, c.r);
    const oneEnd = lw * (Math.max(6, 0.5 * rStar) - 2);                  // the line pixels one leg's end leaves in the ring
    // a perfect ring is a control whatever its lines look like (a photo breaks them); a lesser one needs a line
    const reached = controls.filter((c) => c.touch >= Math.max(3, 0.2 * oneEnd) || (c.score >= 0.75 && c.raw >= 0.5));
    if (reached.length >= 3) controls = reached;
    start = findStart(mask, dil, longLines, lines, circles, w, h, rStar, [...controls, ...(finish ? [finish] : [])], debug ? (startCands = []) : null);
    if (start) controls = controls.filter((c) => Math.hypot(c.x - start.x, c.y - start.y) >= 1.2 * rStar);
  }
  const back = (p) => (p ? { ...p, x: p.x / s, y: p.y / s, r: p.r != null ? p.r / s : undefined } : null);
  /** A ring of the control's size near an image point (within `radius` px): the best one, with its scores, or null.
   *  For the page: once the trace is laid, its sharp turns say where to look for rings the first pass missed. */
  const probe = (X, Y, radius) => {
    if (!rStar) return null;
    const x0 = X * s, y0 = Y * s, R = Math.max(4, radius * s);
    let best = null;
    for (let r = Math.max(4, Math.round(rStar) - 2); r <= Math.round(rStar) + 2; r++) {
      for (let y = Math.round(y0 - R); y <= y0 + R; y += 2) for (let x = Math.round(x0 - R); x <= x0 + R; x += 2) {
        const sc = ringScore(dil, w, h, x, y, r, 48);
        if (!best || sc > best.score) best = { x, y, r, score: sc };
      }
    }
    if (!best) return null;
    const c = refineCircle(mask, dil, w, h, best.x, best.y, best.r);
    return c ? { ...back(c) } : null;
  };
  return { W, H, s, r: rStar ? rStar / s : null, controls: controls.map(back), probe,
    finish: finish && { ...back(finish), r1: finish.r1 == null ? null : finish.r1 / s, r2: finish.r2 / s },
    start: start && { ...back(start), R: start.R / s }, nCircles: circles.length, lw,
    found: debug ? found.map(back) : undefined, startCands: debug && startCands ? startCands.map(back) : undefined };
}

/** The purple pixels: hue from violet to pink with green the weakest channel — saturated when light; when dark (the
 *  magenta ink photographed in poor light comes out a dark plum), red and blue both clearly above green, which black
 *  lines, brown contours and blue water never give. */
function purpleMask(d, w, h) {
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < m.length; i++, p += 4) {
    const r = d[p], gg = d[p + 1], b = d[p + 2];
    const max = r > b ? (r > gg ? r : gg) : (b > gg ? b : gg), min = r < b ? (r < gg ? r : gg) : (b < gg ? b : gg);
    if (max < 40 || gg !== min || max === min) continue;                  // black, grey, or green not the weakest
    const span = max - min;
    const hue = max === r ? 360 - (60 * (b - gg)) / span : 240 + (60 * (r - gg)) / span;
    if (hue < 255 || hue > 345) continue;
    if (max >= 60 && span >= 0.3 * max) m[i] = 1;                          // the overprint as printed
    else if (max <= 150 && r - gg >= 12 && b - gg >= 6 && r - gg >= 0.2 * max) m[i] = 1;    // dark plum on a photo
  }
  return m;
}
function dilate(m, w, h) {
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) d[Y * w + X] = 1;
    }
  }
  return d;
}
/** The share of N points of the ring (x, y, r) that are purple (a pixel of tolerance). */
function ringScore(dil, w, h, x, y, r, N) {
  let hit = 0;
  for (let k = 0; k < N; k++) {
    const a = (2 * Math.PI * k) / N, X = Math.round(x + r * Math.cos(a)), Y = Math.round(y + r * Math.sin(a));
    if (X >= 0 && Y >= 0 && X < w && Y < h && dil[Y * w + X]) hit++;
  }
  return hit / N;
}
function refineCircle(mask, dil, w, h, x0, y0, r0) {
  // the tolerant score (a pixel of tolerance) says whether this is a ring; the strict one (the raw mask) pins its
  // radius and centre, so that two concentric rings (the finish) do not blur into one of a radius between theirs
  const all = [];
  let bestTol = 0;
  for (let r = Math.max(4, r0 - 2); r <= r0 + 2; r++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const tol = ringScore(dil, w, h, x0 + dx, y0 + dy, r, 72);
    all.push([tol, x0 + dx, y0 + dy, r]);
    if (tol > bestTol) bestTol = tol;
  }
  if (bestTol < 0.5) return null;
  const plateau = all.filter((a) => a[0] >= bestTol - 0.03).map((a) => [...a, ringScore(mask, w, h, a[1], a[2], a[3], 72)]);
  const bestRaw = Math.max(...plateau.map((a) => a[4]));
  const top = plateau.filter((a) => a[4] >= bestRaw - 0.1);
  const c = { x: top.reduce((s, a) => s + a[1], 0) / top.length, y: top.reduce((s, a) => s + a[2], 0) / top.length, r: top.reduce((s, a) => s + a[3], 0) / top.length, score: bestTol, raw: bestRaw };
  c.inner = ringScore(dil, w, h, c.x, c.y, Math.max(2, c.r * 0.55), 36);
  c.outer = ringScore(dil, w, h, c.x, c.y, c.r * 1.45, 48);
  return c;
}
/** The overprint's line width: the lower quartile, over the purple pixels, of the shorter straight run through
 *  each (the median would follow a big title or a thick class name, not the course's lines). */
function lineWidth(mask, w, h) {
  const runs = [];
  for (let i = 0; i < mask.length; i += 7) {
    if (!mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    let a = x, b = x, c = y, d = y;
    while (a > 0 && mask[i - (x - a) - 1]) a--;
    while (b < w - 1 && mask[i + (b - x) + 1]) b++;
    while (c > 0 && mask[i - (y - c) * w - w]) c--;
    while (d < h - 1 && mask[i + (d - y) * w + w]) d++;
    runs.push(Math.min(b - a + 1, d - c + 1));
  }
  if (!runs.length) return 2;
  runs.sort((p, q) => p - q);
  return Math.max(1, runs[Math.floor(runs.length / 4)]);
}
/** The pixels of the mask thinner than 2k + 1: the mask less its opening by a (2k + 1) square. */
function thinOnly(m, w, h, k) {
  const er = new Uint8Array(w * h), out = m.slice();
  for (let y = k; y < h - k; y++) for (let x = k; x < w - k; x++) {
    if (!m[y * w + x]) continue;
    let all = true;
    for (let dy = -k; dy <= k && all; dy++) for (let dx = -k; dx <= k; dx++) if (!m[(y + dy) * w + x + dx]) { all = false; break; }
    if (all) er[y * w + x] = 1;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!er[y * w + x]) continue;
    for (let dy = -k - 1; dy <= k + 1; dy++) for (let dx = -k - 1; dx <= k + 1; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 0;
    }
  }
  return out;
}
function findCircles(mask, dil, w, h, lw) {
  const px = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) px.push(i);
  if (!px.length) return { circles: [], rStar: null, found: [] };
  const step = Math.max(1, Math.ceil(px.length / 250000));            // a purple-tinted photo: a sample of its pixels
  const cw = Math.ceil(w / STRIDE), ch = Math.ceil(h / STRIDE), acc = new Uint16Array(cw * ch);
  const found = [];
  for (const r of RADII) {
    if (r * 2 > Math.min(w, h)) break;
    if (r < 2.5 * lw) continue;                                      // a circle this small lies within a line
    acc.fill(0);
    const dx = new Int16Array(ANGLES), dy = new Int16Array(ANGLES);
    for (let a = 0; a < ANGLES; a++) { dx[a] = Math.round(r * Math.cos((2 * Math.PI * a) / ANGLES)); dy[a] = Math.round(r * Math.sin((2 * Math.PI * a) / ANGLES)); }
    for (let k = 0; k < px.length; k += step) {
      const i = px[k], x = i % w, y = (i - x) / w;
      for (let a = 0; a < ANGLES; a++) {
        const cx = x + dx[a], cy = y + dy[a];
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        acc[((cy / STRIDE) | 0) * cw + ((cx / STRIDE) | 0)]++;
      }
    }
    let top = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i] > top) top = acc[i];
    const floor = Math.max(4, top * 0.08), cands = [];
    for (let cy = 1; cy < ch - 1; cy++) for (let cx = 1; cx < cw - 1; cx++) {
      const k = cy * cw + cx, v = acc[k];
      if (v < floor) continue;
      if (v < acc[k - 1] || v < acc[k + 1] || v < acc[k - cw] || v < acc[k + cw] || v < acc[k - cw - 1] || v < acc[k - cw + 1] || v < acc[k + cw - 1] || v < acc[k + cw + 1]) continue;
      cands.push([v, cx, cy]);
    }
    cands.sort((a, b) => b[0] - a[0]);
    for (const [, cx, cy] of cands.slice(0, 160)) {
      const c = refineCircle(mask, dil, w, h, cx * STRIDE + STRIDE / 2, cy * STRIDE + STRIDE / 2, r);
      if (c && c.score >= 0.55 && c.raw >= 0.3) found.push(c);
    }
  }
  // a ring: hollow inside and clear outside; those give the control radius r*. Then, of a control's size or the
  // finish's, a nearly complete ring whatever sits inside it (a start triangle drawn in the finish's circles, the
  // finish's inner circle) — never a small circle, which a thick purple patch would fill
  // a ring: nearly complete with a pixel of tolerance (a photo blurs the line), or crisp though partly hidden —
  // a small circle where a line meets a ring scores 0.6 to 0.7 tolerant and less raw; hollow inside, clear outside
  const strict = (c) => ((c.score >= 0.8 && c.raw >= 0.3) || (c.score >= 0.55 && c.raw >= 0.5)) && c.inner <= 0.3 && c.outer <= 0.4;
  const kept = suppress(found.filter(strict));
  const rStar = controlRadius(kept);
  if (!rStar) return { circles: kept, rStar, found };
  const more = found.filter((c) => !strict(c) && c.score >= 0.85 && c.raw >= 0.6 && c.outer <= 0.6 && c.inner <= 0.75 && c.r >= 0.75 * rStar && c.r <= 1.8 * rStar);
  return { circles: suppress([...kept, ...more]), rStar, found };
}
/** One circle per place: the best-scoring of those within 0.6 r of each other with radii within 15 % (the finish's
 *  two circles differ by 35 %). */
function suppress(found) {
  const kept = [];
  for (const c of [...found].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => Math.hypot(k.x - c.x, k.y - c.y) < 0.6 * Math.max(k.r, c.r) && Math.abs(k.r - c.r) <= 0.15 * Math.max(k.r, c.r))) kept.push(c);
  }
  return kept;
}
/** The radius the good circles share: the densest window of radii (± 30 %), weighted by the circles' scores. */
function controlRadius(circles) {
  if (!circles.length) return null;
  const cs = [...circles].sort((a, b) => a.r - b.r);
  let best = null;
  for (let i = 0; i < cs.length; i++) {
    let j = i, sum = 0;
    while (j < cs.length && cs[j].r <= cs[i].r * 1.3) sum += cs[j++].score;
    if (!best || sum > best.sum) best = { sum, i, j };
  }
  const win = cs.slice(best.i, best.j);
  return win[Math.floor((win.length - 1) / 2)].r;
}
/** The leg lines' pixels: those a straight purple run of 2.2 r* passes through, in one of 12 directions (the run
 *  need not be centred on the pixel: the lines' ends count; a ring's longest chord and a triangle's side are shorter). */
function markLines(mask, dil, w, h, rStar, times = 2.2) {
  const need = Math.max(12, Math.round(times * rStar)), N = 12, lines = new Uint8Array(w * h), cs = [], sn = [];
  for (let d = 0; d < N; d++) { cs.push(Math.cos((Math.PI * d) / N)); sn.push(Math.sin((Math.PI * d) / N)); }
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && dil[y * w + x];
  const run = (x, y, d, sign, max) => {
    let n = 0;
    for (let k = 1; k <= max; k++) { if (!at(Math.round(x + sign * k * cs[d]), Math.round(y + sign * k * sn[d]))) break; n++; }
    return n;
  };
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    for (let d = 0; d < N; d++) {
      const n1 = run(x, y, d, 1, need);
      if (n1 + 1 + run(x, y, d, -1, need - n1) >= need) { lines[i] = 1; break; }
    }
  }
  return lines;
}
/** The line pixels in the ring from r + 2 to r + 0.5 r around a circle: the leg lines' ends. */
function ringTouch(lines, w, h, cx, cy, r) {
  let n = 0;
  const R = r + Math.max(6, 0.5 * r);
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r + 2 && d <= R && lines[y * w + x]) n++;
    }
  }
  return n;
}
/** The start: among the purple blobs left once rings and lines are gone, the one that best matches a triangle. */
function findStart(mask, dil, longLines, lines, circles, w, h, rStar, centres = [], debugList = null) {
  const res = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) res[i] = mask[i] && !longLines[i] ? 1 : 0;
  for (const c of circles) {
    const band = Math.max(3, 0.3 * c.r), R = c.r + band;
    for (let y = Math.max(0, Math.floor(c.y - R)); y <= Math.min(h - 1, Math.ceil(c.y + R)); y++) {
      for (let x = Math.max(0, Math.floor(c.x - R)); x <= Math.min(w - 1, Math.ceil(c.x + R)); x++) {
        if (Math.abs(Math.hypot(x - c.x, y - c.y) - c.r) <= band) res[y * w + x] = 0;
      }
    }
  }
  const seen = new Uint8Array(w * h), stack = [];
  const minB = 1.2 * rStar, maxB = 3.6 * rStar;
  // a triangle a leg line leaves counts for more than a stray one (the control descriptions' own start symbol)
  const rate = (tri) => { tri.touch = ringTouch(lines, w, h, tri.x, tri.y, tri.R); return { ...tri, rank: tri.score + (tri.touch >= 3 ? 0.25 : 0) }; };
  let best = null;
  for (let i0 = 0; i0 < res.length; i0++) {
    if (!res[i0] || seen[i0]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0;
    stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w;
      cnt++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X;
        if (res[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < minB || bh < minB || bw > maxB || bh > maxB || cnt < 2 * rStar) continue;
    let tri = triangleAt(dil, w, h, (x0 + x1) / 2, (y0 + y1) / 2, rStar);
    if (tri) { tri = rate(tri); if (debugList) debugList.push({ ...tri, bw, bh, cnt }); if (!best || tri.rank > best.rank) best = tri; }
  }
  // the start drawn in the finish's circles, or on a control: its sides are cut by the rings above, so try the centres
  for (const c of centres) {
    let tri = triangleAt(dil, w, h, c.x, c.y, rStar);
    if (tri) { tri = rate(tri); if (!best || tri.rank > best.rank) best = tri; }
  }
  return best && best.score >= 0.62 ? best : null;
}
function triangleAt(dil, w, h, cx0, cy0, rStar) {
  let best = null;
  for (const k of [1.0, 1.15, 1.3, 1.45]) {
    const R = k * rStar;
    for (let th = 0; th < 120; th += 4) for (const [ox, oy] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]]) {
      const cx = cx0 + ox, cy = cy0 + oy;
      const V = [0, 1, 2].map((m) => { const a = ((th + 120 * m) * Math.PI) / 180; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
      let hit = 0, tot = 0;
      for (let m = 0; m < 3; m++) {
        const A = V[m], B = V[(m + 1) % 3];
        for (let q = 0; q < 20; q++) {
          const f = (q + 0.5) / 20, x = Math.round(A[0] + f * (B[0] - A[0])), y = Math.round(A[1] + f * (B[1] - A[1]));
          tot++;
          if (x >= 0 && y >= 0 && x < w && y < h && dil[y * w + x]) hit++;
        }
      }
      const score = hit / tot;
      if (!best || score > best.score) best = { x: cx, y: cy, R, ang: (th * Math.PI) / 180, score };
    }
  }
  if (best && ringScore(dil, w, h, best.x, best.y, best.R * 0.3, 24) > 0.5) return null;      // not hollow
  return best;
}
