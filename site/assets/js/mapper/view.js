// Cartographier's map view: three canvases stacked — the backgrounds (images, PDF pages, terrain shading under the map), the
// map in tiles, the overlay (selection, handles, the shape being drawn, GPS, comments). The map is drawn in tiles of 256 device
// pixels per zoom level (levels √2 apart), cached and drawn again only where an edit touched them; a tile is drawn from the
// objects the document's index finds there, colour by colour as OCAD layers them (tracer/vmap/map.js VMap.draw), so a forest map
// of ten thousand objects pans without redrawing. Missing tiles show a coarser one scaled until they are ready (a few each
// frame, the centre first). Map mm, y up; the view: its centre (cx, cy) in mm, k device pixels per mm, an optional rotation.

import { CanvasTarget } from "../tracer/vmap/target.js";
import { Matrix } from "../tracer/vmap/geom.js";

const TILE = 256, MAX_TILES = 360, BUDGET_MS = 12;
const levelOf = (k) => Math.ceil(2 * Math.log2(k));
const kOf = (L) => 2 ** (L / 2);

export class View {
  constructor(host, live, { onView } = {}) {
    this.host = host; this.live = live; this.onView = onView || (() => {});
    host.classList.add("mp-view");
    this.cv = ["bg", "map", "ov"].map((n) => { const c = document.createElement("canvas"); c.className = `mp-cv mp-cv-${n}`; host.appendChild(c); return c; });
    [this.bgCv, this.mapCv, this.ovCv] = this.cv;
    this.cx = 0; this.cy = 0; this.k = 4; this.rot = 0; this.dpr = 1;
    this.tiles = new Map(); this.queue = []; this.frame = 0; this.gen = 0;
    this.backgrounds = [];                                  // [{ image, toMap: [a, b, c, d, e, f] (pixel → mm), opacity, visible }]
    this.mapOpacity = 1; this.hiddenColors = new Set(); this.overprint = false;
    this.drawOverlay = null;                                // (g, view) => {} : the tools' drawing
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }
  destroy() { this.ro.disconnect(); cancelAnimationFrame(this.frame); this.tiles.clear(); }
  setLive(live) { this.live = live; this.clearTiles(); }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.W = Math.max(1, Math.round(r.width * this.dpr)); this.H = Math.max(1, Math.round(r.height * this.dpr));
    for (const c of this.cv) { c.width = this.W; c.height = this.H; c.style.width = `${r.width}px`; c.style.height = `${r.height}px`; }
    this.request();
  }

  // ---- coordinates ------------------------------------------------------------------------------------------------------
  /** The matrix from map mm to device pixels. */
  matrix() {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), k = this.k;
    // screen = R(rot) · (p − centre) · k, y flipped, about the canvas centre
    return new Matrix(k * c, -k * s, -k * s, -k * c, this.W / 2 - k * c * this.cx + k * s * this.cy, this.H / 2 + k * s * this.cx + k * c * this.cy);
  }
  toScreen(x, y) { const m = this.matrix(); return [m.x(x, y) / this.dpr, m.y(x, y) / this.dpr]; }
  /** Map mm under a point of the page (client coordinates). */
  toMap(clientX, clientY) {
    const r = this.host.getBoundingClientRect();
    const px = (clientX - r.left) * this.dpr - this.W / 2, py = -((clientY - r.top) * this.dpr - this.H / 2);
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
    return [this.cx + (px * c - py * s) / this.k, this.cy + (px * s + py * c) / this.k];
  }
  /** mm per CSS pixel. */
  get mmPerPx() { return this.dpr / this.k; }
  visibleRect() {
    const pts = [[0, 0], [this.W, 0], [0, this.H], [this.W, this.H]].map(([x, y]) => {
      const px = x - this.W / 2, py = -(y - this.H / 2), c = Math.cos(-this.rot), s = Math.sin(-this.rot);
      return [this.cx + (px * c - py * s) / this.k, this.cy + (px * s + py * c) / this.k];
    });
    return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  }
  fit(b, margin = 0.05) {
    if (!b) return;
    const w = Math.max(1, b[2] - b[0]), h = Math.max(1, b[3] - b[1]);
    this.cx = (b[0] + b[2]) / 2; this.cy = (b[1] + b[3]) / 2;
    this.k = Math.max(0.02, Math.min(400, Math.min(this.W / w, this.H / h) * (1 - 2 * margin)));
    this.changedView();
  }
  zoomAt(f, clientX, clientY) {
    const [x, y] = clientX == null ? [this.cx, this.cy] : this.toMap(clientX, clientY);
    const k = Math.max(0.02, Math.min(400, this.k * f));
    f = k / this.k;
    this.cx = x + (this.cx - x) / f; this.cy = y + (this.cy - y) / f; this.k = k;
    this.changedView();
  }
  panPx(dx, dy) {
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot), px = -dx * this.dpr, py = dy * this.dpr;
    this.cx += (px * c - py * s) / this.k; this.cy += (px * s + py * c) / this.k;
    this.changedView();
  }
  centreOn(x, y) { this.cx = x; this.cy = y; this.changedView(); }
  changedView() { this.request(); this.onView(this); }

  // ---- tiles ------------------------------------------------------------------------------------------------------------
  clearTiles() { this.tiles.clear(); this.gen++; this.request(); }
  /** The map changed inside `box` (mm): its tiles are drawn again. */
  invalidate(box) {
    if (!box) { this.clearTiles(); return; }
    for (const [key, t] of this.tiles) if (t.rect[0] <= box[2] && t.rect[2] >= box[0] && t.rect[1] <= box[3] && t.rect[3] >= box[1]) t.stale = true;
    this.request();
  }
  request() { if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); }); }
  overlay() { this.drawOv(); }
  tileRect(L, i, j) { const s = TILE / kOf(L); return [i * s, j * s, (i + 1) * s, (j + 1) * s]; }
  renderTile(L, i, j) {
    const key = `${L}:${i}:${j}`, rect = this.tileRect(L, i, j), k = kOf(L);
    const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(TILE, TILE) : Object.assign(document.createElement("canvas"), { width: TILE, height: TILE });
    const g = c.getContext("2d");
    const base = new Matrix(k, 0, 0, -k, -rect[0] * k, rect[3] * k);
    const tg = new CanvasTarget(g, base, { minRes: 1 / k });
    // an object that cannot be drawn must not leave a hole (owner, 2026-11-12: white bands across a LiDAR import, zoomed in):
    // the tile keeps what was drawn, and the error is said once
    let failed = false;
    try { drawRect(this.live, tg, rect, { minRes: 1 / k, hide: this.hiddenColors, overprint: this.overprint }); tg.flush?.(); }
    catch (e) { failed = true; if (!this.drawError) { this.drawError = true; console.error("map tile", e); } }
    const t = { canvas: c, rect, L, i, j, used: performance.now(), stale: false, failed };
    this.tiles.set(key, t);
    if (this.tiles.size > MAX_TILES) {
      const old = [...this.tiles.values()].sort((a, b) => a.used - b.used).slice(0, this.tiles.size - MAX_TILES);
      for (const o of old) this.tiles.delete(`${o.L}:${o.i}:${o.j}`);
    }
    return t;
  }
  draw() {
    const t0 = performance.now();
    this.drawBg();
    const g = this.mapCv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (!this.live) { this.drawOv(); return; }
    const L = levelOf(this.k), kL = kOf(L), S = TILE / kL;
    const r = this.visibleRect();
    const i0 = Math.floor(r[0] / S), i1 = Math.floor(r[2] / S), j0 = Math.floor(r[1] / S), j1 = Math.floor(r[3] / S);
    const m = this.matrix();
    g.globalAlpha = this.mapOpacity;
    g.imageSmoothingEnabled = true;
    const want = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = `${L}:${i}:${j}`, t = this.tiles.get(key);
      if (t) { t.used = t0; this.blit(g, m, t); if (t.stale) want.push([i, j]); continue; }
      // until this one is drawn, the tiles of other levels that cover it: a finer level first (zooming out), else a coarser
      // one (zooming in); those used are kept from eviction, so a slow drawing never shows white in their place
      this.standIn(g, m, L, i, j, t0);
      want.push([i, j]);
    }
    // draw what is missing, the centre first, within the frame's budget
    const ci = (i0 + i1) / 2, cj = (j0 + j1) / 2;
    want.sort((a, b) => Math.hypot(a[0] - ci, a[1] - cj) - Math.hypot(b[0] - ci, b[1] - cj));
    let more = false;
    for (const [i, j] of want) {
      if (performance.now() - t0 > BUDGET_MS) { more = true; break; }
      this.blit(g, m, this.renderTile(L, i, j));
    }
    g.globalAlpha = 1;
    this.drawOv();
    if (more) this.request();
  }
  /** Tiles of other levels drawn in place of tile (L, i, j): the finer level's (one or two levels down: all it has of the
   *  rectangle), then the nearest coarser tile. */
  standIn(g, m, L, i, j, now) {
    const rect = this.tileRect(L, i, j);
    for (let down = 1; down <= 2; down++) {
      const Lf = L + down, Sf = TILE / kOf(Lf);
      const i0 = Math.floor(rect[0] / Sf), i1 = Math.ceil(rect[2] / Sf) - 1, j0 = Math.floor(rect[1] / Sf), j1 = Math.ceil(rect[3] / Sf) - 1;
      const found = [];
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const tf = this.tiles.get(`${Lf}:${a}:${b}`); if (tf) found.push(tf); }
      if (found.length === (i1 - i0 + 1) * (j1 - j0 + 1)) {
        for (const tf of found) {
          tf.used = now;
          const r = [Math.max(rect[0], tf.rect[0]), Math.max(rect[1], tf.rect[1]), Math.min(rect[2], tf.rect[2]), Math.min(rect[3], tf.rect[3])];
          if (r[2] > r[0] && r[3] > r[1]) this.blit(g, m, tf, r);
        }
        return;
      }
    }
    const S = TILE / kOf(L);
    for (let up = 1; up <= 8; up++) {
      const Lc = L - up, Sc = TILE / kOf(Lc), ic = Math.floor((i + 0.5) * S / Sc), jc = Math.floor((j + 0.5) * S / Sc);
      const tc = this.tiles.get(`${Lc}:${ic}:${jc}`);
      if (tc) { tc.used = now; this.blit(g, m, tc, rect); return; }
    }
  }
  /** A tile drawn on the view (clipped to `clip`, mm, when a coarser tile stands in for a finer one). */
  blit(g, m, t, clip = null) {
    const r = clip || t.rect, k = TILE / (t.rect[2] - t.rect[0]);
    const sx = (r[0] - t.rect[0]) * k, sy = (t.rect[3] - r[3]) * k, sw = (r[2] - r[0]) * k, sh = (r[3] - r[1]) * k;
    g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    // the tile's pixels to mm: x = r[0] + px / k, y = r[3] − py / k
    g.transform(1 / k, 0, 0, -1 / k, r[0], r[3]);
    g.drawImage(t.canvas, sx, sy, sw, sh, 0, 0, sw + 0.5, sh + 0.5);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  drawBg() {
    const g = this.bgCv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#fff"; g.fillRect(0, 0, this.W, this.H);
    const m = this.matrix();
    for (const b of this.backgrounds) {
      if (!b.visible || !b.image) continue;
      g.globalAlpha = b.opacity ?? 1;
      const [a, bb, c, d, e, f] = b.toMap;
      g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      g.transform(a, bb, c, d, e, f);
      try { g.drawImage(b.image, 0, 0); } catch (err) { /* not decoded yet */ }
    }
    g.globalAlpha = 1; g.setTransform(1, 0, 0, 1, 0, 0);
  }
  drawOv() {
    const g = this.ovCv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    if (this.drawOverlay) { g.save(); try { this.drawOverlay(g, this); } finally { g.restore(); } }
  }
  /** Draw a part of the map at a resolution on any canvas (exports, thumbnails). */
  render(rect, W, H, opts = {}) {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    if (opts.white !== false) { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); }
    const k = W / (rect[2] - rect[0]);
    const tg = new CanvasTarget(g, new Matrix(k, 0, 0, -k, -rect[0] * k, rect[3] * k), { minRes: 1 / k });
    drawRect(this.live, tg, rect, { minRes: 1 / k, hide: this.hiddenColors, ...opts });
    tg.flush?.();
    return c;
  }
}

/** The part of a live map in `rect` (mm) drawn on a graphics target (tracer/vmap/target.js), colour by colour as OCAD layers
 *  them, from the objects the index finds there (VMap.draw draws from every object). print: the helper symbols (900 and up: a
 *  « boundary to confirm », OpenStreetMap's objects) left out, as on any printed map. */
export function drawRect(live, g, rect, { minRes = 0.05, hide = null, overprint = false, print = false } = {}) {
  const map = live.map, ro = { minRes, metric: map.metric, view: rect, skip: null };
  const groups = new Map();
  const add = (s) => { if (!s || s.visible === false || (print && s.__rec?.sym >= 900000) || !s.bbox || !(s.bbox[0] <= rect[2] && s.bbox[2] >= rect[0] && s.bbox[1] <= rect[3] && s.bbox[3] >= rect[1])) return; let l = groups.get(s.def); if (!l) groups.set(s.def, (l = [])); l.push(s); };
  for (const o of live.near(rect)) add(o.inst);
  for (const b of live.layoutImages || []) add(b);
  for (const l of groups.values()) l.sort((a, b) => (a.__rec?.ord ?? 0) - (b.__rec?.ord ?? 0));
  const layer = (c, blend) => {
    let any = false;
    for (const d of map.symdefs) {
      const list = groups.get(d);
      if (!list || !d.visible || !d.hasColor(c)) continue;
      const items = d.sortSymbols ? list.slice().sort((a, b) => a.order - b.order) : list;
      for (const s of items) {
        if (blend && !any) g.blend(true);
        any = true;
        try { s.draw(g, c, ro); } catch (e) { /* a broken object does not stop the map */ }
      }
    }
    g.flush?.();
    if (blend && any) g.blend(false);
  };
  layer(map.imageColor, false);
  for (const c of map.colors) if (!hide?.has(c.id)) layer(c, overprint && c.overprint);
  layer(map.layoutColor, false);
}
