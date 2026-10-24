// The route choices' worker (trace/routechoice.js): the map read once, then the legs asked one by one, off the page's thread.
// Messages { id, op, ... } answered { id, ok, ... }: init (the image's bytes, its size, the metres of a pixel step) or layers (a
// vector map's, drawn by trace/vectorroutes.js), dem (the ground's heights), settings, leg (two map points), line (a runner's
// route), picture (the terrain as read).

import { classify, cells, costs, context, legRoutes, lineRoute, picture, DEFAULTS } from "./routechoice.js";
import { heightAt } from "./terrain.js";

let G = null, h = null, em = null, mpc = 1, cs = 1, W = 0, H = 0, settings = { ...DEFAULTS }, X = null;

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
  G = cells(px, W, H, cs);
  rebuild();
  const counts = new Array(13).fill(0);
  for (const c of G.cls) counts[c]++;
  return { cs, mpc, nx: G.nx, ny: G.ny, lw: px.lw, ms: px.ms, counts };
}
function rebuild() { if (G) X = context(G, costs(G, settings, mpc), h, em, settings); }

const ops = {
  init({ rgba, w, h: hh, J }) {
    const mpp = start(w, hh, J);
    return finish(classify(new Uint8ClampedArray(rgba), W, H, mpp));
  },
  /** A vector map's layers, drawn on the page (trace/vectorroutes.js): no colours to read. */
  layers({ area, path, blue, block, hand, w, h: hh, J }) {
    start(w, hh, J);
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
  settings({ s }) { settings = { ...DEFAULTS, ...s, speeds: { ...DEFAULTS.speeds, ...(s.speeds || {}) } }; rebuild(); return {}; },
  leg({ a, b }) { return { routes: X ? legRoutes(X, a, b) : null }; },
  line({ pts }) { return { route: X ? lineRoute(X, pts) : null }; },
  picture() { return { rgba: picture(X), nx: G.nx, ny: G.ny, cs }; },
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
