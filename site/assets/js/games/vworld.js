// « Virtually »'s 3D world (games/virtually.js): a race package (functions/api/virtual: heights, ground classes, vegetation
// densities, the ground's colours, the LiDAR's trees, rocks, walls and features, made offline from the OCAD map, the worldwide
// relief and a national LiDAR where there is one) turned into a forest streamed around the runner, 64 m a chunk.
// World frame: the map's paper frame in metres, x to the map's right, z to its bottom; the map's north is -z.

const CH = 64;                     // chunk size (m)
const NEAR = 250;                  // chunks within this distance of the runner are built
const FAR = NEAR + 2 * CH;         // and dropped beyond this one

/** A seeded generator (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A PNG's pixels, exact (no colour management). */
async function pixels(blob) {
  const bm = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height;
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bm, 0, 0);
  return { w: bm.width, h: bm.height, d: g.getImageData(0, 0, bm.width, bm.height).data };
}

/** The race package's files: { race, h, cls, veg, groundImg, feats, trees, ocd }. onFile(name) as each arrives. */
export async function loadRace(base, onFile = () => {}) {
  const get = async (f, kind) => {
    const r = await fetch(base + f, { credentials: "same-origin" });
    if (!r.ok) throw Object.assign(new Error(`${f}: ${r.status}`), { status: r.status });
    const v = kind === "json" ? await r.json() : kind === "buf" ? await r.arrayBuffer() : await r.blob();
    onFile(f);
    return v;
  };
  const race = await get("race.json", "json");
  const [hb, cb, vb, gb, feats, trees, ocd] = await Promise.all([get("h.png"), get("cls.png"), get("veg.png"), get("ground.jpg"),
    get("feats.json", "json"), race.lidarTrees ? get("trees.bin", "buf") : null, get("map.ocd", "buf")]);
  const [hp, cp, vp] = await Promise.all([pixels(hb), pixels(cb), pixels(vb)]);
  const W = race.W, H = race.H, n = W * H, h = new Float32Array(n), cls = new Uint8Array(n), veg = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    h[i] = race.base + (hp.d[i * 4] * 256 + hp.d[i * 4 + 1]) / 100;
    cls[i] = cp.d[i * 4];
    veg[i * 3] = vp.d[i * 4]; veg[i * 3 + 1] = vp.d[i * 4 + 1]; veg[i * 3 + 2] = vp.d[i * 4 + 2];
  }
  const groundImg = await createImageBitmap(gb);
  // a sprint race's town (games/vtown.js: buildings, walls, street furniture), when the package has one
  let town = null;
  if (race.town) { const V = await import("./vtown.js"); town = { ...(await V.loadTown(base, race.town, onFile)), Town: V.Town }; }
  return { race, W, H, h, cls, veg, groundImg, feats, trees: trees ? new DataView(trees) : null, ocd: new Uint8Array(ocd), town };
}

export class World {
  constructor(THREE, data, scene, renderer) {
    this.T = THREE; this.d = data; this.scene = scene;
    const { race, W, H } = data;
    this.W = W; this.H = H; this.race = race;
    this.speedOf = Float32Array.from(race.speed);
    this.C = Object.fromEntries(race.classes.map((n, i) => [n, i]));
    const B = race.biome || {};
    this.B = B;
    const col = (c) => new THREE.Color(c);
    this.leaf = (B.leaf || ["#5d7d3a"]).map(col); this.pine = (B.coniferLeaf || ["#33532d"]).map(col);
    this.bushC = (B.bush || ["#4f6a33"]).map(col); this.lowC = (B.low || ["#7a7a48"]).map(col); this.rockC = (B.rock || ["#9a968e"]).map(col);
    this.trunk = col(B.trunk || "#6e665c"); this.trunk2 = col(B.trunk2 || B.trunk || "#6e665c");
    this.chunks = new Map();
    this.queue = [];
    this.trunks = new Map();                       // 8 m cell -> [[x, z, r]]
    this.makeMaterials(renderer);
    this.bucketFeatures();
    this.town = data.town ? new data.town.Town(THREE, this, data.town) : null;
  }

  // ---- the ground's values ---------------------------------------------------------------------------------------------------
  hRaw(i, j) { const { W, H } = this; i = i < 0 ? 0 : i >= H ? H - 1 : i; j = j < 0 ? 0 : j >= W ? W - 1 : j; return this.d.h[i * W + j]; }
  heightAt(x, z) {
    const fx = x - 0.5, fz = z - 0.5, j = Math.floor(fx), i = Math.floor(fz), a = fx - j, b = fz - i;
    return this.hRaw(i, j) * (1 - a) * (1 - b) + this.hRaw(i, j + 1) * a * (1 - b) + this.hRaw(i + 1, j) * (1 - a) * b + this.hRaw(i + 1, j + 1) * a * b;
  }
  classAt(x, z) {
    const j = Math.floor(x), i = Math.floor(z);
    if (i < 0 || j < 0 || i >= this.H || j >= this.W) return this.C.outside;
    return this.d.cls[i * this.W + j];
  }
  /** The terrain's speed factor (0: impassable). */
  terrainSpeed(x, z) { return this.speedOf[this.classAt(x, z)] || 0; }
  className(x, z) { return this.race.classes[this.classAt(x, z)]; }
  /** Is a body of radius r at (x, z) against a trunk or a large rock? */
  hits(x, z, r = 0.3) {
    if (this.town?.hits(x, z, r)) return true;
    const ci = Math.floor(x / 8), cj = Math.floor(z / 8);
    for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) {
      const list = this.trunks.get(`${a},${b}`);
      if (list) for (const [tx, tz, tr] of list) if ((tx - x) ** 2 + (tz - z) ** 2 < (tr + r) ** 2) return true;
    }
    return false;
  }

  // ---- materials and shapes -----------------------------------------------------------------------------------------------
  makeMaterials(renderer) {
    const T = this.T, { W, H } = this;
    const tex = new T.Texture(this.d.groundImg); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    const det = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"), im = g.createImageData(256, 256), r = rng(9);
      for (let k = 0; k < 256 * 256; k++) { const v = 150 + r() * 105; im.data[k * 4] = im.data[k * 4 + 1] = im.data[k * 4 + 2] = v; im.data[k * 4 + 3] = 255; }
      g.putImageData(im, 0, 0); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; return t;
    })();
    this.groundMat = new T.MeshLambertMaterial({ map: tex });
    this.groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.detail = { value: det }; sh.uniforms.rep = { value: new T.Vector2(W / 3, H / 3) };
      sh.fragmentShader = "uniform sampler2D detail; uniform vec2 rep;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        "#include <map_fragment>\n diffuseColor.rgb *= 0.8 + 0.4 * texture2D(detail, vMapUv * rep).r * texture2D(detail, vMapUv * rep * 0.27).r * 1.1;");
    };
    const lam = () => new T.MeshLambertMaterial({ color: 0xffffff });
    const merge = (parts) => {
      const pos = [], nor = [], uv = [], idx = []; let base = 0;
      for (const g of parts) {
        const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
        for (let k = 0; k < p.count; k++) { pos.push(p.getX(k), p.getY(k), p.getZ(k)); nor.push(n.getX(k), n.getY(k), n.getZ(k)); uv.push(u ? u.getX(k) : 0, u ? u.getY(k) : 0); }
        if (g.index) for (let k = 0; k < g.index.count; k++) idx.push(g.index.getX(k) + base); else for (let k = 0; k < p.count; k++) idx.push(k + base);
        base += p.count;
      }
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
    };
    const lobe = (r, x, y, z) => new T.IcosahedronGeometry(r, 1).translate(x, y, z);
    const euc = this.B.crown === "eucalypt";
    const crown = euc ? merge([lobe(0.48, 0.2, 0.3, 0), lobe(0.42, -0.45, 0.05, 0.2), lobe(0.4, 0.5, -0.2, -0.3), lobe(0.36, -0.05, -0.3, 0.45)])
      : merge([lobe(0.62, 0, 0.15, 0), lobe(0.5, 0.45, -0.2, 0.1), lobe(0.48, -0.4, -0.15, 0.25), lobe(0.46, 0.05, -0.25, -0.45), lobe(0.42, -0.1, 0.55, 0.05)]);
    const pine = merge([new T.ConeGeometry(0.8, 1.0, 7).translate(0, 0.0, 0), new T.ConeGeometry(0.62, 0.8, 7).translate(0, 0.35, 0), new T.ConeGeometry(0.42, 0.6, 7).translate(0, 0.7, 0)]);
    const sprite = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), r = rng(5);
      for (let f = 0; f < 11; f++) {
        const a = -1.25 + f * 0.25 + (r() - 0.5) * 0.2, L = 60 + r() * 60;
        g.strokeStyle = `rgb(${215 + r() * 40 | 0},${215 + r() * 40 | 0},${200 + r() * 40 | 0})`; g.lineWidth = 2.2;
        let x = 64, y = 128;
        for (let s = 0; s < 12; s++) {
          const nx = x + Math.sin(a) * L / 12 * (1 + s * 0.06), ny = y - Math.cos(a) * L / 12;
          g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
          const w = (12 - s) * 1.1; g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(a) * w, ny + Math.sin(a) * w - 3); g.moveTo(nx, ny); g.lineTo(nx - Math.cos(a) * w, ny - Math.sin(a) * w - 3); g.stroke();
          x = nx; y = ny;
        }
      }
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
    })();
    const cross = merge([0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => new T.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY(a)));
    const rock = (seed) => {
      const g = new T.IcosahedronGeometry(0.5, 1), p = g.attributes.position, r = rng(seed), off = new Map();
      for (let k = 0; k < p.count; k++) {
        const key = `${p.getX(k).toFixed(3)},${p.getY(k).toFixed(3)},${p.getZ(k).toFixed(3)}`;
        if (!off.has(key)) off.set(key, 0.72 + r() * 0.55);
        const f = off.get(key); p.setXYZ(k, p.getX(k) * f, Math.max(p.getY(k) * f, -0.25) + 0.25, p.getZ(k) * f);
      }
      g.computeVertexNormals(); return g;
    };
    this.K = {
      trunk: { geo: new T.CylinderGeometry(0.1, 0.18, 1, 6).translate(0, 0.5, 0), mat: lam(), shadow: true },
      crown: { geo: crown, mat: lam(), shadow: true },
      pine: { geo: pine, mat: lam(), shadow: true },
      bush: { geo: merge([lobe(0.7, 0, 0.55, 0), lobe(0.5, 0.45, 0.4, 0.1), lobe(0.5, -0.4, 0.4, -0.2)]), mat: lam(), shadow: true },
      low: { geo: cross, mat: new T.MeshLambertMaterial({ map: sprite, alphaTest: 0.45, side: T.DoubleSide }), shadow: false },
      rock0: { geo: rock(7), mat: lam(), shadow: true }, rock1: { geo: rock(91), mat: lam(), shadow: true }, rock2: { geo: rock(1234), mat: lam(), shadow: true },
      box: { geo: new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat: lam(), shadow: true },
    };
    this.wallMat = new T.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: T.DoubleSide });
    this.waterMat = new T.MeshPhongMaterial({ color: 0x3d5d6a, shininess: 90, specular: 0x8899aa, transparent: true, opacity: 0.88 });
  }

  // ---- what the package lists, by chunk ---------------------------------------------------------------------------------------
  bucketFeatures() {
    const by = (x, z) => `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
    this.fb = new Map();
    const put = (k, kind, v) => { let b = this.fb.get(k); if (!b) this.fb.set(k, (b = { rocks: [], walls: [], points: [], trees: [] })); b[kind].push(v); };
    for (const r of this.d.feats.rocks || []) put(by(r[0], r[1]), "rocks", r);
    for (const w of this.d.feats.walls || []) {
      const p = w.pts;
      for (let k = 0; k < p.length - 1; k++) put(by((p[k][0] + p[k + 1][0]) / 2, (p[k][1] + p[k + 1][1]) / 2), "walls", [p[k], p[k + 1], w.kind, w.h]);
    }
    for (const p of this.d.feats.points || []) put(by(p.x, p.z), "points", p);
    const t = this.d.trees;
    if (t) for (let o = 0; o + 6 <= t.byteLength; o += 6) {
      const x = t.getUint16(o, true) / 10, z = t.getUint16(o + 2, true) / 10;
      put(by(x, z), "trees", [x, z, t.getUint8(o + 4) / 4, t.getUint8(o + 5) / 10]);
    }
  }

  // ---- chunks -------------------------------------------------------------------------------------------------------------
  /** Build the chunks around (x, z) and drop the far ones; at most `budget` new chunks a call. */
  update(x, z, budget = 2) {
    const ci = Math.floor(x / CH), cj = Math.floor(z / CH), r = Math.ceil(NEAR / CH);
    const want = [];
    for (let a = ci - r; a <= ci + r; a++) for (let b = cj - r; b <= cj + r; b++) {
      if (a < 0 || b < 0 || a * CH >= this.W || b * CH >= this.H) continue;
      const d = Math.hypot((a + 0.5) * CH - x, (b + 0.5) * CH - z);
      if (d <= NEAR + CH * 0.71 && !this.chunks.has(`${a},${b}`)) want.push([d, a, b]);
    }
    want.sort((p, q) => p[0] - q[0]);
    // the nearest missing chunk is always built, even on a slow frame, once it is within 140 m (the runner could reach its edge)
    if (!budget && want.length && want[0][0] < 140) budget = 1;
    for (const [, a, b] of want.slice(0, budget)) this.build(a, b);
    for (const [k, c] of this.chunks) {
      const d = Math.hypot(c.userData.cx - x, c.userData.cz - z);
      if (d > FAR) { this.drop(k); continue; }
      // only the chunks near the runner cast shadows (the shadow's box is 100 m): half the draw calls
      const near = d < 90;
      if (c.userData.near !== near) { c.userData.near = near; c.traverse((o) => { if (o.userData.shadow) o.castShadow = near; }); }
    }
    return want.length;
  }
  drop(k) {
    const c = this.chunks.get(k); if (!c) return;
    c.traverse((o) => { if (o.isMesh && o.geometry && !Object.values(this.K).some((K) => K.geo === o.geometry)) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose?.(); });
    this.scene.remove(c); this.chunks.delete(k);
    for (const key of c.userData.cells || []) this.trunks.delete(key);
  }
  build(a, b) {
    const T = this.T, k = `${a},${b}`, x0 = a * CH, z0 = b * CH, x1 = Math.min(x0 + CH, this.W), z1 = Math.min(z0 + CH, this.H);
    const g = new T.Group(); g.userData = { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, cells: [] };
    // ground
    const nx = Math.round(x1 - x0) + 1, nz = Math.round(z1 - z0) + 1;
    const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = [];
    for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) {
      const x = x0 + j, z = z0 + i, q = i * nx + j, y = this.heightAt(x, z);
      pos[q * 3] = x; pos[q * 3 + 1] = y; pos[q * 3 + 2] = z;
      const ex = this.heightAt(x - 1, z) - this.heightAt(x + 1, z), ez = this.heightAt(x, z - 1) - this.heightAt(x, z + 1), l = Math.hypot(ex, 2, ez);
      nor[q * 3] = ex / l; nor[q * 3 + 1] = 2 / l; nor[q * 3 + 2] = ez / l;
      uv[q * 2] = x / this.W; uv[q * 2 + 1] = 1 - z / this.H;
    }
    for (let i = 0; i < nz - 1; i++) for (let j = 0; j < nx - 1; j++) { const q = i * nx + j; idx.push(q, q + nx, q + 1, q + 1, q + nx, q + nx + 1); }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3)); geo.setAttribute("normal", new T.BufferAttribute(nor, 3)); geo.setAttribute("uv", new T.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const ground = new T.Mesh(geo, this.groundMat); ground.receiveShadow = true; g.add(ground);
    // water: a surface over the open water's cells
    const water = [];
    const wc = new Set([this.C.water, this.C.shallow, this.C.marsh_x].filter((v) => v != null));
    for (let i = z0; i < z1; i++) for (let j = x0; j < x1; j++) if (wc.has(this.d.cls[i * this.W + j])) water.push([j, i]);
    if (water.length) {
      const hs = water.map(([j, i]) => this.d.h[i * this.W + j]).sort((p, q) => p - q), lvl = hs[Math.floor(hs.length * 0.3)] + 0.12;
      const wp = [], wi = [];
      for (const [j, i] of water) { const v = wp.length / 3; wp.push(j, lvl, i, j + 1, lvl, i, j, lvl, i + 1, j + 1, lvl, i + 1); wi.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
      const wg = new T.BufferGeometry(); wg.setAttribute("position", new T.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
      g.add(new T.Mesh(wg, this.waterMat));
    }
    // vegetation from the densities (the map's, or the LiDAR's undergrowth), trees from the LiDAR when the package has them
    const r = rng((a * 73856093) ^ (b * 19349663) ^ 0x5eed);
    const inst = { trunk: [], crown: [], pine: [], bush: [], low: [], rock0: [], rock1: [], rock2: [], box: [] };
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const [TK, BK, LK] = this.race.vegK;
    const conifer = this.B.conifer || 0, euc = this.B.crown === "eucalypt";
    const addTree = (x, z, h, cr) => {
      const y = this.heightAt(x, z), rot = r() * 6.283, isPine = r() < conifer;
      if (isPine) {
        inst.trunk.push([x, y - 0.2, z, 1 + h * 0.012, h * 0.75, 1 + h * 0.012, rot, this.trunk2]);
        inst.pine.push([x, y + h * 0.3, z, cr * 0.95, h * 0.7, cr * 0.95, rot, pick(this.pine)]);
      } else {
        const tc = euc && r() < 0.7 ? this.trunk : this.trunk2;
        inst.trunk.push([x, y - 0.2, z, 1 + h * 0.014, h * 0.66, 1 + h * 0.014, rot, tc]);
        const leaf = pick(this.leaf).clone();
        if (this.B.leafDry && r() < this.B.leafDry) leaf.lerp(new T.Color(0xa08a5a), 0.45);
        inst.crown.push([x, y + h * 0.7, z, cr * (euc ? 1.3 : 1.1), h * (euc ? 0.26 : 0.3), cr * (euc ? 1.3 : 1.1), rot, leaf]);
      }
      this.trunk_(g, x, z, 0.12 + h * 0.008);
    };
    const B_ = this.fb.get(k) || { rocks: [], walls: [], points: [], trees: [] };
    for (const [x, z, h, cr] of B_.trees) addTree(x, z, h, cr);
    for (let i = z0; i < z1; i += 2) for (let j = x0; j < x1; j += 2) {
      const q = (i * this.W + j) * 3, td = this.d.veg[q] / TK * 4;
      if (td > 0 && r() < td) { const h = 12 + r() * 12; addTree(j + r() * 2, i + r() * 2, h, Math.min(5.5, 0.9 + 0.13 * h) * (0.8 + r() * 0.4)); }
    }
    for (let i = z0; i < z1; i++) for (let j = x0; j < x1; j++) {
      const q = (i * this.W + j) * 3, bd = this.d.veg[q + 1] / BK, ld = this.d.veg[q + 2] / LK;
      if (bd > 0 && r() < bd) { const x = j + r(), z = i + r(), s = 0.7 + r() * 0.9; inst.bush.push([x, this.heightAt(x, z) - 0.1, z, s, (0.9 + r() * 1.1) * 0.7, s, r() * 6.28, pick(this.bushC)]); }
      let n = ld; while (n > 0) { if (r() < n) { const x = j + r(), z = i + r(), s = 0.5 + r() * 0.6; inst.low.push([x, this.heightAt(x, z) - 0.05, z, s * 1.4, (0.35 + r() * 0.45) * 1.2, s * 1.4, r() * 6.28, pick(this.lowC)]); } n -= 1; }
    }
    for (const [x, z, s, h, rot, sink, solid] of B_.rocks) {
      let y = Infinity; for (const [dx, dz] of [[0, 0], [s / 2, 0], [-s / 2, 0], [0, s / 2], [0, -s / 2]]) y = Math.min(y, this.heightAt(x + dx, z + dz));
      inst[pick(["rock0", "rock1", "rock2"])].push([x, y - sink, z, s, h * 1.3, s * (0.8 + r() * 0.4), rot, pick(this.rockC)]);
      if (solid) this.trunk_(g, x, z, s * 0.42);
    }
    for (const p of B_.points) {
      const y = this.heightAt(p.x, p.z);
      if (p.k === "bigtree" || p.k === "orchard") addTree(p.x, p.z, p.k === "bigtree" ? 24 : 7, p.k === "bigtree" ? 6 : 2.5);
      else if (p.k === "vegspec") inst.bush.push([p.x, y - 0.1, p.z, 1.2, 1.1, 1.2, 0, this.bushC[0]]);
      else if (p.k === "tower") { inst.box.push([p.x, y, p.z, 1.6, 6, 1.6, 0, new T.Color(0x7a6a58)]); this.trunk_(g, p.x, p.z, 1); }
      else if (p.k === "smallbuilding") { inst.box.push([p.x, y - 0.2, p.z, 4, 3, 4, (p.a || 0) * Math.PI / 180, new T.Color(0x9a8e80)]); this.trunk_(g, p.x, p.z, 2); }
      else if (p.k === "manmade") inst.box.push([p.x, y, p.z, 0.5, 1.2, 0.5, 0, new T.Color(0x8a8278)]);
    }
    const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
    for (const [kind, list] of Object.entries(inst)) {
      if (!list.length) continue;
      const K = this.K[kind], im = new T.InstancedMesh(K.geo, K.mat, list.length);
      list.forEach(([x, y, z, sx, sy, sz, rot, c], i) => { Q.setFromAxisAngle(UP, rot); im.setMatrixAt(i, M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz))); im.setColorAt(i, c); });
      im.castShadow = false; im.userData.shadow = K.shadow; im.receiveShadow = kind !== "low"; im.computeBoundingSphere();
      g.add(im);
    }
    // walls, fences, cliffs: vertical strips along the map's lines
    if (B_.walls.length) {
      const wp = [], wcol = [], wi = [];
      const CO = { cliff: [0.62, 0.6, 0.56], rockface: [0.6, 0.58, 0.54], stonewall: [0.55, 0.54, 0.5], fence: [0.45, 0.38, 0.3], bank: [0.42, 0.36, 0.26] };
      for (const [[ax, az], [bx, bz], kind, hh] of B_.walls) {
        if (kind === "powerline" || kind === "bank") continue;
        const ya = this.heightAt(ax, az), yb = this.heightAt(bx, bz), v = wp.length / 3, c = CO[kind] || [0.5, 0.5, 0.5];
        const h = kind === "fence" ? Math.min(hh, 1.4) : hh;
        wp.push(ax, ya - 0.4, az, bx, yb - 0.4, bz, ax, ya + h, az, bx, yb + h, bz);
        for (let q = 0; q < 4; q++) wcol.push(...c);
        wi.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
      if (wp.length) {
        const wg = new T.BufferGeometry(); wg.setAttribute("position", new T.Float32BufferAttribute(wp, 3)); wg.setAttribute("color", new T.Float32BufferAttribute(wcol, 3));
        wg.setIndex(wi); wg.computeVertexNormals();
        const m = new T.Mesh(wg, this.wallMat); m.receiveShadow = true; m.userData.shadow = true; g.add(m);
      }
    }
    this.town?.buildChunk(g, a, b);
    this.scene.add(g); this.chunks.set(k, g);
  }
  /** A trunk (or a large rock) for the collisions, kept with its chunk. */
  trunk_(g, x, z, r) {
    const key = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
    let l = this.trunks.get(key); if (!l) { this.trunks.set(key, (l = [])); g.userData.cells.push(key); }
    l.push([x, z, r]);
  }

  // ---- the course's flags -----------------------------------------------------------------------------------------------------
  /** Flags at the controls, the start's triangle, the finish's banner; flag(i) gives control i's group. */
  addCourse(course) {
    const T = this.T;
    const tex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 64); g.fillStyle = "#f26b1d"; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 64); g.lineTo(0, 64); g.fill();
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
    })();
    const plate = (code) => {
      const c = document.createElement("canvas"); c.width = 64; c.height = 32; const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, 64, 32); g.fillStyle = "#111"; g.font = "bold 24px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(code, 32, 17);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return new T.MeshBasicMaterial({ map: t, side: T.DoubleSide });
    };
    this.flags = [];
    for (const c of course) {
      const g = new T.Group(), y = this.heightAt(c.x, c.z);
      g.position.set(c.x, y, c.z);
      if (c.kind === "start") {
        const tri = new T.Mesh(new T.CircleGeometry(0.45, 3), new T.MeshLambertMaterial({ color: 0xb5179e, side: T.DoubleSide }));
        tri.position.y = 1.4; tri.rotation.z = Math.PI / 2;
        const post = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1.5, 5), new T.MeshLambertMaterial({ color: 0xdddddd })); post.position.y = 0.75;
        g.add(tri, post);
      } else {
        const mat = new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide, emissive: 0x000000 });
        const prism = new T.Mesh(new T.CylinderGeometry(0.21, 0.21, 0.3, 3, 1, true), mat); prism.position.y = 0.75;
        const stake = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 1.0, 5), new T.MeshLambertMaterial({ color: 0xdddddd })); stake.position.y = 0.5;
        g.add(prism, stake);
        if (c.kind === "finish") {
          const pole = (dx) => { const p = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 2.6, 6), new T.MeshLambertMaterial({ color: 0xeeeeee })); p.position.set(dx, 1.3, 0); return p; };
          const ban = new T.Mesh(new T.PlaneGeometry(3, 0.5), new T.MeshLambertMaterial({ map: tex, side: T.DoubleSide })); ban.position.set(0, 2.45, 0);
          g.add(pole(-1.5), pole(1.5), ban);
        } else {
          const pl = new T.Mesh(new T.PlaneGeometry(0.16, 0.08), plate(c.code)); pl.position.set(0, 0.45, 0.02); g.add(pl);
          const pl2 = pl.clone(); pl2.rotation.y = Math.PI; pl2.position.z = -0.02; g.add(pl2);
        }
        // the cue: a light column and a ring, shown near the flag
        const beam = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 30, 16, 1, true), new T.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
        beam.position.y = 15; beam.visible = false;
        const ring = new T.Mesh(new T.RingGeometry(1.6, 2.0, 40), new T.MeshBasicMaterial({ color: 0xff8a2b, transparent: true, opacity: 0, depthWrite: false, side: T.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ring.visible = false;
        g.add(beam, ring);
        g.userData = { mat, beam, ring };
      }
      g.traverse((o) => { if (o.isMesh && o.material?.map !== undefined) o.castShadow = true; });
      this.scene.add(g); this.flags.push(g);
    }
  }
  /** Control i's cue at strength s (0: none, 1: within reach), t the clock (s) for the pulse. */
  cue(i, s, t) {
    const u = this.flags[i]?.userData; if (!u?.mat) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);
    u.mat.emissive.setRGB(s * (0.55 + 0.45 * pulse), s * (0.25 + 0.2 * pulse), 0);
    u.beam.visible = u.ring.visible = s > 0;
    u.beam.material.opacity = 0.18 * s * (0.6 + 0.4 * pulse);
    u.ring.material.opacity = 0.85 * s;
    u.ring.scale.setScalar(1 + 0.15 * pulse);
  }
}

/** The runner: a simple figure whose legs and arms swing with the speed. */
export function runnerFigure(T, shirtColor = 0x1f6fd1) {
  const g = new T.Group();
  const shirt = new T.MeshLambertMaterial({ color: shirtColor }), skin = new T.MeshLambertMaterial({ color: 0xd9a07a }), dark = new T.MeshLambertMaterial({ color: 0x222831 });
  const body = new T.Mesh(new T.CapsuleGeometry(0.17, 0.5, 4, 8), shirt); body.position.y = 1.18;
  const head = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), skin); head.position.y = 1.62;
  const legG = new T.CapsuleGeometry(0.07, 0.65, 3, 6).translate(0, -0.42, 0);
  const legL = new T.Mesh(legG, dark), legR = new T.Mesh(legG, dark); legL.position.set(0.09, 0.92, 0); legR.position.set(-0.09, 0.92, 0);
  const armG = new T.CapsuleGeometry(0.05, 0.45, 3, 6).translate(0, -0.3, 0);
  const armL = new T.Mesh(armG, shirt), armR = new T.Mesh(armG, shirt); armL.position.set(0.23, 1.42, 0); armR.position.set(-0.23, 1.42, 0);
  g.add(body, head, legL, legR, armL, armR);
  g.traverse((o) => (o.castShadow = true));
  let ph = 0;
  g.userData.animate = (speed, dt) => {
    ph += dt * (1.2 + speed * 0.55) * Math.PI * 2 * (speed > 0.05 ? 1 : 0);
    const sw = Math.min(1, speed / 3) * 0.75;
    legL.rotation.x = Math.sin(ph) * sw; legR.rotation.x = -Math.sin(ph) * sw; armL.rotation.x = -Math.sin(ph) * sw * 0.8; armR.rotation.x = Math.sin(ph) * sw * 0.8;
    body.position.y = 1.18 + Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, speed);
  };
  return g;
}
