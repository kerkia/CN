// The map's own contour lines added to the ground's heights (« Analyse solo »'s 3D view, an experiment of 2026-10-24).
// An orienteering map draws the relief every 5 m (2.5 m on some), with small features a 30 m model smooths away. Read from
// the map image:
// 1. a brown mask (ISOM's contour brown, hue ~26°: red the strongest channel, green about half of it, blue low); the light
//    brown of a sprint map's paved areas and yellow open land fall outside it, and what is thicker than three line widths
//    (fills, thick brown) is dropped, as course.js drops thick purple;
// 2. the pieces of line (8-connected), the small ones dropped (dots, label digits, noise); paths, text and other symbols
//    break the lines, so one contour is often several pieces;
// 3. each piece's level: the coarse model's height along it, in units of the interval, then adjusted so that neighbouring
//    pieces (crossed one after the other along the image's rows and columns) step by what the model says between them,
//    a step of one interval at most; the whole set shifted by the offset that best puts them on multiples of the interval
//    (a map's contours are not always at round heights), then rounded;
// 4. the surface: the model plus a correction that is exact on the lines and fades smoothly between them (a membrane solved
//    coarse to fine), so that the model's shape is kept between the lines and where the map has none.
// Everything runs in the browser on the image already read; nothing is sent.

// red the strongest, green about half of it, blue low and clearly under green (a map's dark reds — (160, 40, 40) — are not brown)
const BROWN = (r, g, b) => r >= 110 && r - b >= 80 && g >= 0.22 * r && g <= 0.64 * r && b <= 0.3 * r && g - b >= 0.15 * r;

/** The mask's pieces thinner than 2k + 1 (course.js's opening), then the 8-connected pieces of at least minPx pixels. */
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
function lineWidth(mask, w, h) {
  const runs = [];
  for (let i = 0; i < mask.length; i += 5) {
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
  return Math.max(1, runs[Math.floor(runs.length / 2)]);
}
function label(m, w, h, minPx, minExtent = 0) {
  const lab = new Int32Array(w * h).fill(-1), comps = [], stack = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const id = comps.length, px = [];
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop(); px.push(i);
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, j = Y * w + X;
        if (X >= 0 && Y >= 0 && X < w && Y < h && m[j] && lab[j] < 0) { lab[j] = id; stack.push(j); }
      }
    }
    comps.push(px);
  }
  // the small pieces out: the ids renumbered over what stays
  const keep = new Int32Array(comps.length).fill(-1), out = [];
  // a line is long: a blob of a few metres across (a knoll's dot, a digit) is not one
  const extent = (px) => { let x0 = w, x1 = 0, y0 = h, y1 = 0; for (const i of px) { const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return Math.hypot(x1 - x0, y1 - y0); };
  comps.forEach((px, id) => { if (px.length >= minPx && extent(px) >= minExtent) { keep[id] = out.length; out.push(px); } });
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0) lab[i] = keep[lab[i]];
  return { lab, comps: out };
}

/**
 * The contour lines read on the image at its own size, 2600 px a side at most (a reduction to a fixed size in metres lost
 * the lines of 1:5000 maps, 0.7 m wide).
 * Returns { w, h, k (working px per map px), lab (piece id per pixel, -1 none), comps (pixel lists), lw, mPerPx }.
 */
export function readContours(image, mPerMapPx, { maxSide = 2600 } = {}) {
  const k = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * k)), h = Math.max(1, Math.round(image.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(image, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, full = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < full.length; i++, p += 4) if (BROWN(d[p], d[p + 1], d[p + 2])) full[i] = 1;
  const lw = lineWidth(full, w, h);
  const thin = thinOnly(full, w, h, Math.max(1, Math.round(1.5 * lw)));
  const mPerPx = mPerMapPx / k;
  const { lab, comps } = label(thin, w, h, Math.max(12, Math.round(12 / mPerPx)), 12 / mPerPx);   // under ~12 m of line or across: out
  return { w, h, k, lab, comps, lw, mPerPx, brownPx: full.reduce((a, v) => a + v, 0) };
}

/** Each piece's mean line width (working px): the shorter of its horizontal and vertical runs, averaged. */
function pieceWidths(rc) {
  const { w, h, lab, comps } = rc;
  return comps.map((px, id) => {
    let s = 0, n = 0;
    const step = Math.max(1, Math.floor(px.length / 80));
    for (let q = 0; q < px.length; q += step) {
      const i = px[q], x = i % w, y = (i - x) / w;
      let a = x, b = x, c = y, d = y;
      while (a > 0 && lab[i - (x - a) - 1] === id) a--;
      while (b < w - 1 && lab[i + (b - x) + 1] === id) b++;
      while (c > 0 && lab[i - (y - c) * w - w] === id) c--;
      while (d < h - 1 && lab[i + (d - y) * w + w] === id) d++;
      s += Math.min(b - a + 1, d - c + 1); n++;
    }
    return n ? s / n : 0;
  });
}

/**
 * Each piece's level (metres), from the coarse model dem(x, y) (working pixels → metres) and the interval E. Two
 * neighbouring pieces — crossed one after the other along a row or a column, nothing between — are one interval apart, in
 * the direction the model rises, or at the same level where the model is flat between them (a crest, a valley, one line
 * broken in two). The index contours, drawn thicker, fall every fifth interval. Solved in two steps: the levels as real
 * numbers (Gauss-Seidel), put on whole intervals plus the offset that suits them best, then each piece's whole level chosen
 * in turn against its neighbours and the index rule until nothing changes. Returns { level, offset, pairs, index }.
 */
export function assignLevels(rc, dem, E, { prior = 0.2, snap = 0.4, useIndex = true, integer = true } = {}) {
  const { w, h, lab, comps, mPerPx } = rc, n = comps.length;
  const hc = new Float64Array(n), pc = new Float64Array(n);
  comps.forEach((px, id) => {
    const step = Math.max(1, Math.floor(px.length / 60)), hs = [];
    for (let q = 0; q < px.length; q += step) { const i = px[q], x = i % w; hs.push(dem(x, (i - x) / w)); }
    hs.sort((a, b) => a - b);
    hc[id] = hs[Math.floor(hs.length / 2)] / E;
    pc[id] = prior * Math.min(4, 0.2 + (px.length * mPerPx) / 400);   // the model's say: a long line's more
  });
  const pairs = new Map(), maxGap = 80 / mPerPx, stride = Math.max(2, Math.round(3 / mPerPx));
  const walk = (len, at, xy) => {
    let prev = -1, prevT = -1;
    for (let t = 0; t < len; t++) {
      const id = lab[at(t)];
      if (id < 0 || id === prev) { if (id === prev && id >= 0) prevT = t; continue; }
      if (prev >= 0 && t - prevT <= maxGap) {
        const [x0, y0] = xy(prevT), [x1, y1] = xy(t), dz = (dem(x1, y1) - dem(x0, y0)) / E;
        const key = prev < id ? `${prev},${id}` : `${id},${prev}`, s = prev < id ? 1 : -1;
        const p = pairs.get(key) || { a: Math.min(prev, id), b: Math.max(prev, id), sum: 0, n: 0 };
        p.sum += s * dz; p.n++;
        pairs.set(key, p);
      }
      prev = id; prevT = t;
    }
  };
  for (let y = 0; y < h; y += stride) walk(w, (t) => y * w + t, (t) => [t, y]);
  for (let x = 0; x < w; x += stride) walk(h, (t) => t * w + x, (t) => [x, t]);
  const nb = Array.from({ length: n }, () => []);
  let used = 0;
  for (const p of pairs.values()) {
    if (p.n < 2) continue;
    // the step in whole intervals as the model sees it: one line hidden between the two (a path along it where the row
    // crossed) makes it two; a model unsure of the side (a crest, a valley, a line broken in two) leaves it soft
    const dz = Math.max(-2, Math.min(2, p.sum / p.n)), t = Math.abs(dz) >= snap ? Math.sign(dz) * Math.max(1, Math.round(Math.abs(dz))) : dz, wt = Math.min(5, p.n / 2);
    nb[p.a].push([p.b, t, wt]); nb[p.b].push([p.a, -t, wt]); used++;
  }
  // 1. real-valued levels
  const lv = Float64Array.from(hc);
  for (let it = 0; it < 400; it++) for (let c = 0; c < n; c++) {
    let num = pc[c] * hc[c], den = pc[c];
    for (const [o, t, wt] of nb[c]) { num += wt * (lv[o] - t); den += wt; }        // t: the step from c to o
    lv[c] = num / den;
  }
  // the offset of the lines' heights from round multiples of E: read on the model's own heights along each line, not on
  // the solved levels (the steps' pull shifted them: 1.5 m on a perfect model, and bumps along every line)
  let off = 0, bestOff = Infinity;
  for (let o = 0; o < 1; o += 0.01) {
    let e = 0;
    for (let c = 0; c < n; c++) { const f = hc[c] - o - Math.round(hc[c] - o); e += comps[c].length * f * f; }
    if (e < bestOff) { bestOff = e; off = o; }
  }
  // the solved levels moved as a whole so that, on average, they sit where the model puts the lines
  let shift = 0, sw = 0;
  for (let c = 0; c < n; c++) { shift += comps[c].length * (hc[c] - lv[c]); sw += comps[c].length; }
  shift = sw ? shift / sw : 0;
  for (let c = 0; c < n; c++) lv[c] += shift;
  // the index contours: pieces markedly wider than the usual line (ISOM: 0.25 mm against 0.14)
  const wd = pieceWidths(rc), sorted = comps.map((px, c) => [wd[c], px.length]).sort((a, b) => a[0] - b[0]);
  let half = sorted.reduce((a, b) => a + b[1], 0) / 2, usual = sorted[0]?.[0] || 1;
  for (const [v, m] of sorted) { half -= m; if (half <= 0) { usual = v; break; } }
  const isIndex = wd.map((v) => useIndex && v >= 1.3 * usual && v >= usual + 0.6);
  // 2. whole levels, piece by piece (iterated conditional modes), with the index rule once its residue is known
  const k = Array.from(lv, (v) => Math.round(v - off));
  const mod5 = (v) => ((v % 5) + 5) % 5;
  let m = -1;
  for (let pass = 0; pass < (integer ? 30 : 0); pass++) {
    const votes = [0, 0, 0, 0, 0];
    for (let c = 0; c < n; c++) if (isIndex[c]) votes[mod5(k[c])] += comps[c].length;
    const best = votes.indexOf(Math.max(...votes));
    m = votes[best] > 0 ? best : -1;
    let changed = 0;
    for (let c = 0; c < n; c++) {
      let bestK = k[c], bestE = Infinity;
      for (let cand = k[c] - 2; cand <= k[c] + 2; cand++) {
        let e = pc[c] * (cand + off - hc[c]) ** 2;
        for (const [o, t, wt] of nb[c]) e += wt * (cand - k[o] + t) ** 2;
        if (m >= 0) { const on = mod5(cand) === m; if (on !== isIndex[c]) e += 1.5 * (pc[c] + 1); }
        if (e < bestE - 1e-9) { bestE = e; bestK = cand; }
      }
      if (bestK !== k[c]) { k[c] = bestK; changed++; }
    }
    if (!changed && pass > 2) break;
  }
  const level = Float64Array.from(k, (v) => (v + off) * E);
  return { level, offset: off * E, pairs: used, index: isIndex.filter(Boolean).length, indexResidue: m, widths: { usual, q: [0.1, 0.3, 0.5, 0.7, 0.8, 0.9].map((f) => sorted[Math.floor(f * (sorted.length - 1))]?.[0]) } };
}

/**
 * The surface: the model plus a correction exact on the lines, a membrane between them that fades back to the model
 * (λ) far from any line; solved on the working grid reduced to ~`cellM` metres, coarse to fine. Returns z(x, y) over
 * working pixels as { at(x, y), gw, gh, cell }.
 */
export function surface(rc, dem, level, { cellM = 2, lambda = 0.004 } = {}) {
  const { w, h, lab, mPerPx } = rc;
  const cell = Math.max(1, Math.round(cellM / mPerPx)), gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const fixed = new Uint8Array(gw * gh), val = new Float64Array(gw * gh), cnt = new Float64Array(gw * gh);
  for (let i = 0; i < lab.length; i++) {
    const id = lab[i];
    if (id < 0) continue;
    const x = i % w, y = (i - x) / w, k = Math.floor(y / cell) * gw + Math.floor(x / cell);
    val[k] += level[id] - dem(x, y); cnt[k]++;
  }
  for (let k = 0; k < val.length; k++) if (cnt[k]) { val[k] /= cnt[k]; fixed[k] = 1; }
  // coarse to fine: each level relaxed (Gauss-Seidel), its result the next one's start
  const solve = (W, H, F, V, init, iters) => {
    const r = init || new Float64Array(W * H);
    for (let k = 0; k < r.length; k++) if (F[k]) r[k] = V[k];
    for (let it = 0; it < iters; it++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (F[k]) continue;
      let s = 0, n = 0;
      if (x > 0) { s += r[k - 1]; n++; } if (x < W - 1) { s += r[k + 1]; n++; }
      if (y > 0) { s += r[k - W]; n++; } if (y < H - 1) { s += r[k + W]; n++; }
      r[k] = s / (n + lambda * n);
    }
    return r;
  };
  const levels = [];
  let W = gw, H = gh, F = fixed, V = val;
  levels.push([W, H, F, V]);
  while (Math.max(W, H) > 40) {
    const W2 = Math.ceil(W / 2), H2 = Math.ceil(H / 2), F2 = new Uint8Array(W2 * H2), V2 = new Float64Array(W2 * H2), C2 = new Float64Array(W2 * H2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (!F[k]) continue; const k2 = (y >> 1) * W2 + (x >> 1); V2[k2] += V[k]; C2[k2]++; }
    for (let k = 0; k < V2.length; k++) if (C2[k]) { V2[k] /= C2[k]; F2[k] = 1; }
    W = W2; H = H2; F = F2; V = V2;
    levels.push([W, H, F, V]);
  }
  let r = null;
  for (let l = levels.length - 1; l >= 0; l--) {
    const [Wl, Hl, Fl, Vl] = levels[l];
    let init = null;
    if (r) { const [Wp] = levels[l + 1]; init = new Float64Array(Wl * Hl); for (let y = 0; y < Hl; y++) for (let x = 0; x < Wl; x++) init[y * Wl + x] = r[(y >> 1) * Wp + (x >> 1)]; }
    r = solve(Wl, Hl, Fl, Vl, init, l === levels.length - 1 ? 400 : 60);
  }
  const at = (x, y) => {
    const gx = Math.max(0, Math.min(gw - 1.001, x / cell - 0.5)), gy = Math.max(0, Math.min(gh - 1.001, y / cell - 0.5));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, k = j * gw + i;
    const i1 = Math.min(gw - 1, i + 1), j1 = Math.min(gh - 1, j + 1);
    const c = (1 - fy) * ((1 - fx) * r[k] + fx * r[j * gw + i1]) + fy * ((1 - fx) * r[j1 * gw + i] + fx * r[j1 * gw + i1]);
    return dem(x, y) + c;
  };
  return { at, gw, gh, cell, fixedCells: fixed.reduce((a, v) => a + v, 0) };
}

/**
 * The 3D view's grid (nodes over the map's W × H pixels) refined by the map's contours: { z, nx, ny, step, source,
 * contours: { pieces, pairs, offset, interval, ms } }, or null when the map shows too few contour lines.
 */
export function refineGrid(image, grid, W, H, mPerMapPx, { interval = 5 } = {}) {
  const t0 = performance.now();
  const rc = readContours(image, mPerMapPx);
  if (rc.comps.length < 4) return null;
  const { nx, ny } = grid, k = rc.k;
  // the coarse model at a working pixel: the grid's nodes sit on the map's pixels
  const dem = (x, y) => {
    const gx = Math.max(0, Math.min(nx - 1.0001, ((x / k) / W) * (nx - 1))), gy = Math.max(0, Math.min(ny - 1.0001, ((y / k) / H) * (ny - 1)));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, q = j * nx + i, z = grid.z;
    return (1 - fy) * ((1 - fx) * z[q] + fx * z[q + 1]) + fy * ((1 - fx) * z[q + nx] + fx * z[q + nx + 1]);
  };
  const { level, offset, pairs } = assignLevels(rc, dem, interval);
  const s = surface(rc, dem, level);
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) z[j * nx + i] = s.at((i / (nx - 1)) * W * k, (j / (ny - 1)) * H * k);
  return { ...grid, z, contours: { pieces: rc.comps.length, pairs, offset, interval, lw: rc.lw, mPerPx: rc.mPerPx, ms: Math.round(performance.now() - t0) } };
}
