// The route choices' worker (trace/routechoice.js): the map read once, then the legs asked one by one, off the page's thread.
// Messages { id, op, ... } answered { id, ok, ... }, and while the map is read { id, progress } (0-1): init (the image's bytes,
// its size, the metres of a pixel step, the map's kind) or layers (a vector map's, drawn by trace/vectorroutes.js), dem (the
// ground's heights), settings (the map read again when its kind changes: the thickness test's width), leg (two map points),
// decision (the leg's decision map), line (a runner's route), picture (the terrain as read), controls (the course's controls:
// the overprint near them is theirs).

import { classify, cells, costs, context, legSearch, lineRoute, matchRoute, picture, decisionPicture, releaseAround, DEFAULTS } from "./routechoice.js";
import { heightAt } from "./terrain.js";

let G = null, h = null, em = null, mpc = 1, cs = 1, W = 0, H = 0, settings = { ...DEFAULTS }, X = null;
let image = null, mppRead = 1, kindRead = "forest", facts = null, ctrlPts = [];
const decisions = new Map();                         // the last legs' decision maps, by their points

/** The grid's size and the metres of a pixel step (J's columns): the cell size, about 1.5 m, 4 million cells at most. */
function start(w, hh, J) {
  W = w; H = hh;
  const mpp = Math.sqrt(Math.abs(J[0][0] * J[1][1] - J[0][1] * J[1][0]));
  cs = Math.max(1, Math.round(1.5 / mpp));
  while ((W / cs) * (H / cs) > 4e6) cs++;
  em = [[J[0][0] * cs, J[1][0] * cs], [J[0][1] * cs, J[1][1] * cs]];
  mpc = Math.min(Math.hypot(...em[0]), Math.hypot(...em[1]));
  h = null;
  return mpp;
}
function finish(px) {
  const hOld = h;
  G = cells(px, W, H, cs);
  G.release = releaseAround(G, em, ctrlPts);
  h = hOld && hOld.length === G.nx * G.ny ? hOld : null;
  rebuild();
  const counts = new Array(13).fill(0), paths = [0, 0, 0, 0];
  for (const c of G.cls) counts[c]++;
  for (const v of G.path) paths[v]++;
  facts = { cs, mpc, nx: G.nx, ny: G.ny, lw: px.lw, ms: px.ms, counts, paths, north: px.northLines?.length || 0, chains: px.lines?.chains || 0, kind: kindRead };
  return facts;
}
function rebuild() { decisions.clear(); if (G) X = context(G, costs(G, settings, mpc), h, em, settings); }
function read(id) {
  return finish(classify(image, W, H, mppRead, { map: kindRead }, (f) => postMessage({ id, progress: f })));
}

const ops = {
  init({ id, rgba, w, h: hh, J, map }) {
    mppRead = start(w, hh, J);
    image = new Uint8ClampedArray(rgba);
    kindRead = map === "sprint" ? "sprint" : "forest";
    return read(id);
  },
  /** A vector map's layers, drawn on the page (trace/vectorroutes.js): no colours to read. */
  layers({ area, path, blue, block, hand, w, h: hh, J }) {
    start(w, hh, J);
    image = null;
    const t0 = Date.now();
    return { ...finish({ area: new Uint8Array(area), path: new Uint8Array(path), blue: new Uint8Array(blue), block: new Uint8Array(block), hand: new Uint8Array(hand), lw: 0, ms: 0 }), ms: Date.now() - t0, vector: true };
  },
  dem({ grid }) {
    if (!G) return {};
    h = new Float32Array(G.nx * G.ny);
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) h[j * G.nx + i] = heightAt(grid, W, H, (i + 0.5) * cs, (j + 0.5) * cs);
    rebuild();
    return {};
  },
  settings({ id, s }) {
    settings = { ...DEFAULTS, ...s, speeds: { ...DEFAULTS.speeds, ...(s.speeds || {}) } };
    const kind = settings.map === "sprint" ? "sprint" : "forest";
    if (image && kind !== kindRead) { kindRead = kind; return { reread: true, facts: read(id) }; }
    rebuild();
    return {};
  },
  leg({ a, b }) {
    if (!X) return { routes: null };
    const r = legSearch(X, a, b);
    decisions.set(`${a}|${b}`, r.dec);
    while (decisions.size > 12) decisions.delete(decisions.keys().next().value);
    return { routes: r.routes };
  },
  decision({ a, b }) {
    if (!X) return { rgba: null };
    let dec = decisions.get(`${a}|${b}`);
    if (!dec) { dec = legSearch(X, a, b).dec; decisions.set(`${a}|${b}`, dec); }
    if (!dec) return { rgba: null };
    return { rgba: decisionPicture(dec, settings.extra ?? DEFAULTS.extra), i0: dec.i0, j0: dec.j0, rw: dec.rw, rh: dec.rh, cs };
  },
  line({ pts }) { return { route: X ? lineRoute(X, pts) : null }; },
  match({ a, b, pts, tol, routes }) { return { route: X ? matchRoute(X, a, b, pts, tol, routes) : null }; },
  picture() { return { rgba: picture(X), nx: G.nx, ny: G.ny, cs }; },
  controls({ pts }) { ctrlPts = pts || []; if (G) { G.release = releaseAround(G, em, ctrlPts); rebuild(); } return {}; },
};

self.onmessage = (e) => {
  const m = e.data;
  try {
    const out = ops[m.op](m);
    postMessage({ id: m.id, ok: true, ...out }, out.rgba ? [out.rgba.buffer] : []);
  } catch (err) {
    postMessage({ id: m.id, ok: false, error: String(err?.stack || err) });
  }
};
