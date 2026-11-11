// i18n-ignore-file (no text of the interface here: shaders and geometry)
// « Virtually »'s towns, for sprint races (vworld.js hands each chunk to it): the buildings of a race package's town.json /
// town.bin (made offline by tools/virtually/town_3d.py from IGN's BD TOPO footprints and LiDAR HD roofs), their façades drawn by
// a shader (floors, windows, shutters, doors, shop fronts, a church's stone), the roofs' tiles, walls, fences and hedges at the
// heights the LiDAR measured, street furniture from OpenStreetMap. The town also stops the runner: buildings, impassable walls,
// fences and hedges by their outlines (more exactly than the 1 m ground classes, which it opens for that).
// World frame as vworld.js: the map's paper frame in metres, x right, z down.

const CELL = 8;                     // m: the collision index's cells

/** The town's files: { meta, arrays } (typed arrays over town.bin, named as town.json lists them). */
export async function loadTown(base, town, onFile = () => {}) {
  const get = async (f, kind) => {
    const r = await fetch(base + f, { credentials: "same-origin" });
    if (!r.ok) throw Object.assign(new Error(`${f}: ${r.status}`), { status: r.status });
    const v = kind === "json" ? await r.json() : await r.arrayBuffer();
    onFile(f);
    return v;
  };
  const [meta, bin] = await Promise.all([get(town.file, "json"), get(town.bin, "buf")]);
  const T = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array }, arrays = {};
  for (const [k, [tp, off, n]] of Object.entries(meta.arrays)) arrays[k] = new T[tp](bin, off, n);
  return { meta, arrays };
}

const NOISE = /* glsl */`
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y); }
`;

export class Town {
  constructor(T, world, data) {
    this.T = T; this.w = world; this.m = data.meta; this.a = data.arrays;
    // the outlines stop the runner: the ground classes under them run as paving would
    const C = world.C, sp = world.speedOf;
    for (const k of ["building", "block"]) if (C[k] != null) sp[C[k]] = sp[C.paved] || 1;
    this.index();
    this.materials();
    this.props = new Map();
    for (const p of this.m.props || []) { const k = `${Math.floor(p[1] / 64)},${Math.floor(p[2] / 64)}`; (this.props.get(k) || this.props.set(k, []).get(k)).push(p); }
    this.wallsBy = new Map();
    for (const w of this.m.walls || []) {
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const [a, b] = [w.pts[i], w.pts[i + 1]], k = `${Math.floor((a[0] + b[0]) / 128)},${Math.floor((a[1] + b[1]) / 128)}`;
        (this.wallsBy.get(k) || this.wallsBy.set(k, []).get(k)).push([a, b, w.kind, w.h, w.imp]);
      }
    }
  }

  // ---- collisions -----------------------------------------------------------------------------------------------------------
  index() {
    this.cells = new Map();
    const put = (x0, z0, x1, z1, item) => {
      for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) for (let b = Math.floor(z0 / CELL); b <= Math.floor(z1 / CELL); b++) {
        const k = a * 65536 + b; let l = this.cells.get(k); if (!l) this.cells.set(k, (l = [])); l.push(item);
      }
    };
    for (const ring of this.m.foot || []) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of ring) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
      put(x0 - 1, z0 - 1, x1 + 1, z1 + 1, { ring });
    }
    for (const w of this.m.walls || []) {
      if (!w.imp) continue;
      const t = w.kind === "hedge" ? 0.45 : w.kind === "fence" ? 0.08 : 0.16;
      for (let i = 0; i + 1 < w.pts.length; i++) {
        const [a, b] = [w.pts[i], w.pts[i + 1]];
        put(Math.min(a[0], b[0]) - 1, Math.min(a[1], b[1]) - 1, Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1, { seg: [a[0], a[1], b[0], b[1]], t });
      }
    }
    for (const p of this.m.props || []) {
      const r = PROP_R[p[0]]; if (!r) continue;
      put(p[1] - r, p[2] - r, p[1] + r, p[2] + r, { dot: [p[1], p[2], r] });
    }
  }
  /** Is a body of radius r at (x, z) inside a building or against an impassable wall, fence, hedge or post? */
  hits(x, z, r = 0.3) {
    const l = this.cells.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
    if (!l) return false;
    for (const it of l) {
      if (it.ring) {
        const g = it.ring; let inside = false;
        for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
          const [xi, zi] = g[i], [xj, zj] = g[j];
          if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
          if (segDist(x, z, xi, zi, xj, zj) < r) return true;
        }
        if (inside) return true;
      } else if (it.seg) { if (segDist(x, z, ...it.seg) < r + it.t) return true; }
      else if ((it.dot[0] - x) ** 2 + (it.dot[1] - z) ** 2 < (it.dot[2] + r) ** 2) return true;
    }
    return false;
  }
  /** How far along from (ax, az) to (bx, bz) a camera may go before a building (0-1): the third-person camera stays outside. */
  clear(ax, az, bx, bz) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4);
    for (let i = 1; i <= n; i++) { const t = i / n; if (this.hits(ax + (bx - ax) * t, az + (bz - az) * t, 0.25)) return Math.max(0, (i - 1) / n); }
    return 1;
  }

  // ---- materials ----------------------------------------------------------------------------------------------------------
  materials() {
    const T = this.T;
    // façades: u along the wall's side (m), v above the building's base (m); seg = (side's length, eave, floor height, seed)
    this.facade = new T.MeshLambertMaterial({ vertexColors: true });
    this.facade.onBeforeCompile = (sh) => {
      sh.vertexShader = "attribute vec2 aUv; attribute vec4 aSeg; attribute float aSty; varying vec2 vF; varying vec4 vS; varying float vSty;\n" +
        sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vF = aUv; vS = aSeg; vSty = aSty;");
      sh.fragmentShader = "varying vec2 vF; varying vec4 vS; varying float vSty;\n" + NOISE + sh.fragmentShader.replace("#include <color_fragment>", FACADE);
    };
    this.roof = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.roof.onBeforeCompile = (sh) => {
      sh.vertexShader = "attribute float aKind; varying vec3 vWP; varying float vKind;\n" +
        sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vKind = aKind;");
      sh.fragmentShader = "varying vec3 vWP; varying float vKind;\n" + NOISE + sh.fragmentShader.replace("#include <color_fragment>", ROOF);
    };
    this.solid = new T.MeshLambertMaterial({ vertexColors: true });
    // a fence's wire mesh: a canvas grid, its holes cut by alphaTest
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    g.strokeStyle = "#fff"; g.lineWidth = 3; for (let k = 0; k <= 64; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 64); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(64, k); g.stroke(); }
    const tex = new T.CanvasTexture(c); tex.wrapS = tex.wrapT = T.RepeatWrapping;
    this.mesh = new T.MeshLambertMaterial({ color: 0x3d4a3c, map: tex, alphaTest: 0.5, side: T.DoubleSide, transparent: false });
    this.propGeo = propGeometries(T);
  }

  // ---- a chunk ---------------------------------------------------------------------------------------------------------------
  /** The town's part of chunk (a, b), added to the chunk's group g. */
  buildChunk(g, a, b) {
    const T = this.T, e = this.m.chunks[`${a},${b}`], A = this.a;
    if (e?.r) {
      const [v0, nv, i0, ni] = e.r, geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(A.rpos.subarray(v0 * 3, (v0 + nv) * 3), 3));
      const col = A.rcol.subarray(v0 * 4, (v0 + nv) * 4), rgb = new Uint8Array(nv * 3), kind = new Float32Array(nv);
      for (let k = 0; k < nv; k++) { rgb[k * 3] = col[k * 4]; rgb[k * 3 + 1] = col[k * 4 + 1]; rgb[k * 3 + 2] = col[k * 4 + 2]; kind[k] = col[k * 4 + 3]; }
      geo.setAttribute("color", new T.BufferAttribute(rgb, 3, true)); geo.setAttribute("aKind", new T.BufferAttribute(kind, 1));
      geo.setIndex(new T.BufferAttribute(A.ridx.subarray(i0, i0 + ni), 1)); geo.computeVertexNormals();
      const m = new T.Mesh(geo, this.roof); m.receiveShadow = true; m.userData.shadow = true; g.add(m);
    }
    if (e?.w) {
      const [v0, nv, i0, ni] = e.w, geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(A.wpos.subarray(v0 * 3, (v0 + nv) * 3), 3));
      geo.setAttribute("aUv", new T.BufferAttribute(A.wuv.subarray(v0 * 2, (v0 + nv) * 2), 2));
      geo.setAttribute("aSeg", new T.BufferAttribute(A.wseg.subarray(v0 * 4, (v0 + nv) * 4), 4));
      const col = A.wcol.subarray(v0 * 4, (v0 + nv) * 4), rgb = new Uint8Array(nv * 3), sty = new Float32Array(nv);
      for (let k = 0; k < nv; k++) { rgb[k * 3] = col[k * 4]; rgb[k * 3 + 1] = col[k * 4 + 1]; rgb[k * 3 + 2] = col[k * 4 + 2]; sty[k] = col[k * 4 + 3]; }
      geo.setAttribute("color", new T.BufferAttribute(rgb, 3, true)); geo.setAttribute("aSty", new T.BufferAttribute(sty, 1));
      geo.setIndex(new T.BufferAttribute(A.widx.subarray(i0, i0 + ni), 1)); geo.computeVertexNormals();
      const m = new T.Mesh(geo, this.facade); m.receiveShadow = true; m.userData.shadow = true; g.add(m);
    }
    this.lines(g, a, b);
    this.furniture(g, a, b);
  }

  /** Walls, hedges (boxes along their lines) and fences (posts and a wire mesh). */
  lines(g, a, b) {
    const list = this.wallsBy.get(`${a},${b}`); if (!list) return;
    const T = this.T, w = this.w, P = [], N = [], C = [], fp = [], fu = [];
    const box = (ax, az, bx, bz, th, y0a, y0b, h, c, jitter = 0) => {
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) return;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz * th / 2, nz = ux * th / 2;
      const q = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]];
      const y0 = [y0a, y0b, y0b, y0a], y1 = y0.map((v) => v + h);
      const face = (i, j, n) => { // a side from corner i to j
        P.push(q[i][0], y0[i], q[i][1], q[j][0], y0[j], q[j][1], q[j][0], y1[j], q[j][1], q[i][0], y0[i], q[i][1], q[j][0], y1[j], q[j][1], q[i][0], y1[i], q[i][1]);
        for (let k = 0; k < 6; k++) { N.push(...n); const s = 1 + (Math.random() - 0.5) * jitter; C.push(c[0] * s, c[1] * s, c[2] * s); }
      };
      face(0, 1, [-uz, 0, ux]); face(2, 3, [uz, 0, -ux]); face(1, 2, [ux, 0, uz]); face(3, 0, [-ux, 0, -uz]);
      // the top
      P.push(q[0][0], y1[0], q[0][1], q[2][0], y1[2], q[2][1], q[1][0], y1[1], q[1][1], q[0][0], y1[0], q[0][1], q[3][0], y1[3], q[3][1], q[2][0], y1[2], q[2][1]);
      for (let k = 0; k < 6; k++) { N.push(0, 1, 0); C.push(c[0] * 0.92, c[1] * 0.92, c[2] * 0.92); }
    };
    const col = { wall: [0.72, 0.68, 0.6], hedge: [0.2, 0.33, 0.14], fence: [0.24, 0.29, 0.24] };
    for (const [p, q, kind, h] of list) {
      const ya = w.heightAt(p[0], p[1]), yb = w.heightAt(q[0], q[1]);
      if (kind === "fence") {
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), hh = Math.min(2.2, Math.max(1, h));
        for (let s = 0; s <= L; s += 2.5) { const t = L ? s / L : 0, x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t, y = ya + (yb - ya) * t; box(x - 0.03, z - 0.03, x + 0.03, z + 0.03, 0.06, y - 0.1, y - 0.1, hh + 0.1, col.fence); }
        fp.push(p[0], ya, p[1], q[0], yb, q[1], q[0], yb + hh, q[1], p[0], ya, p[1], q[0], yb + hh, q[1], p[0], ya + hh, p[1]);
        fu.push(0, 0, L / 0.6, 0, L / 0.6, hh / 0.6, 0, 0, L / 0.6, hh / 0.6, 0, hh / 0.6);
      } else if (kind === "steps") {                                    // a stairway: treads 0.3 m deep, each a block at its ground's height
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(L / 0.32));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, xa = p[0] + (q[0] - p[0]) * t0, za = p[1] + (q[1] - p[1]) * t0, xb = p[0] + (q[0] - p[0]) * t1, zb = p[1] + (q[1] - p[1]) * t1;
          const y = Math.max(w.heightAt(xa, za), w.heightAt(xb, zb)) + 0.04;
          box(xa, za, xb, zb, 2.2, y - 0.6, y - 0.6, 0.6, k % 2 ? [0.62, 0.6, 0.57] : [0.66, 0.64, 0.61]);
        }
      } else if (kind === "hedge") box(p[0], p[1], q[0], q[1], 0.9, ya - 0.1, yb - 0.1, Math.min(3, Math.max(0.8, h)), col.hedge, 0.35);
      else box(p[0], p[1], q[0], q[1], 0.3, ya - 0.2, yb - 0.2, Math.min(4, Math.max(0.5, h)) + 0.2, col.wall, 0.08);
    }
    if (P.length) {
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(P, 3));
      geo.setAttribute("normal", new T.Float32BufferAttribute(N, 3)); geo.setAttribute("color", new T.Float32BufferAttribute(C, 3));
      const m = new T.Mesh(geo, this.solid); m.receiveShadow = true; m.userData.shadow = true; g.add(m);
    }
    if (fp.length) {
      const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(fp, 3)); geo.setAttribute("uv", new T.Float32BufferAttribute(fu, 2));
      geo.computeVertexNormals();
      const m = new T.Mesh(geo, this.mesh); m.userData.shadow = true; g.add(m);
    }
  }

  furniture(g, a, b) {
    const list = this.props.get(`${a},${b}`); if (!list) return;
    const T = this.T, by = {};
    for (const p of list) (by[p[0]] ||= []).push(p);
    const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(1, 1, 1), V = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
    for (const [k, l] of Object.entries(by)) {
      const geo = this.propGeo[k]; if (!geo) continue;
      const im = new T.InstancedMesh(geo, this.solid, l.length);
      l.forEach(([, x, z, ang], i) => { Q.setFromAxisAngle(UP, (-ang * Math.PI) / 180); im.setMatrixAt(i, M.compose(V.set(x, this.w.heightAt(x, z), z), Q, S)); });
      im.userData.shadow = true; im.receiveShadow = true; im.computeBoundingSphere(); g.add(im);
    }
  }
}

const PROP_R = { lamp: 0.12, bollard: 0.12, bin: 0.25, postbox: 0.3, column: 0.6, fountain: 1.2, memorial: 0.7, signals: 0.1, cabinet: 0.35, phone: 0.4 };

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/** The street furniture's shapes, each a geometry with its parts' colours. */
function propGeometries(T) {
  const part = (geo, c, x = 0, y = 0, z = 0) => { geo.translate(x, y, z); const n = geo.attributes.position.count, cc = new Float32Array(n * 3); for (let i = 0; i < n; i++) cc.set(c, i * 3); geo.setAttribute("color", new T.BufferAttribute(cc, 3)); return geo.toNonIndexed ? geo.index ? geo.toNonIndexed() : geo : geo; };
  const merge = (parts) => {
    const P = [], N = [], C = [];
    for (const g of parts) { const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array; P.push(...p); N.push(...n); C.push(...c); }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new T.Float32BufferAttribute(N, 3)); g.setAttribute("color", new T.Float32BufferAttribute(C, 3)); return g;
  };
  const cyl = (r0, r1, h, s = 8) => new T.CylinderGeometry(r0, r1, h, s), bx = (w, h, d) => new T.BoxGeometry(w, h, d);
  const dark = [0.18, 0.2, 0.22], green = [0.14, 0.26, 0.2], stone = [0.68, 0.65, 0.6], wood = [0.45, 0.32, 0.2];
  return {
    lamp: merge([part(cyl(0.05, 0.08, 4.6), dark, 0, 2.3), part(bx(0.12, 0.08, 0.9), dark, 0, 4.55, 0.4), part(bx(0.3, 0.12, 0.45), [0.85, 0.85, 0.8], 0, 4.5, 0.8)]),
    bench: merge([part(bx(1.7, 0.06, 0.45), wood, 0, 0.45), part(bx(1.7, 0.4, 0.05), wood, 0, 0.75, -0.22), part(bx(0.06, 0.45, 0.45), dark, -0.75, 0.22), part(bx(0.06, 0.45, 0.45), dark, 0.75, 0.22)]),
    bin: merge([part(cyl(0.22, 0.2, 0.9, 10), green, 0, 0.45)]),
    bollard: merge([part(cyl(0.08, 0.09, 0.9, 8), [0.3, 0.3, 0.32], 0, 0.45)]),
    postbox: merge([part(bx(0.45, 0.6, 0.35), [0.95, 0.78, 0.1], 0, 1.0), part(cyl(0.04, 0.04, 0.7, 6), dark, 0, 0.35)]),
    bikes: merge([0, 1, 2, 3].map((i) => part(bx(0.04, 0.8, 0.7), [0.6, 0.62, 0.64], i * 0.8 - 1.2, 0.4))),
    fountain: merge([part(cyl(1.1, 1.2, 0.6, 16), stone, 0, 0.3), part(cyl(0.15, 0.2, 1.4, 8), stone, 0, 0.7), part(cyl(0.95, 0.95, 0.05, 16), [0.28, 0.4, 0.46], 0, 0.58)]),
    memorial: merge([part(bx(1.2, 0.5, 1.2), stone, 0, 0.25), part(bx(0.6, 2.2, 0.6), stone, 0, 1.6)]),
    signals: merge([part(cyl(0.05, 0.05, 3.2), dark, 0, 1.6), part(bx(0.3, 0.9, 0.25), dark, 0, 2.8)]),
    busstop: merge([part(bx(3, 0.08, 1.4), [0.5, 0.52, 0.55], 0, 2.4), part(bx(0.06, 2.4, 0.06), dark, -1.45, 1.2, 0.65), part(bx(0.06, 2.4, 0.06), dark, 1.45, 1.2, 0.65), part(bx(3, 0.05, 0.4), wood, 0, 0.5, -0.5)]),
    cabinet: merge([part(bx(0.8, 1.3, 0.35), [0.62, 0.64, 0.6], 0, 0.65)]),
    column: merge([part(cyl(0.55, 0.6, 3.0, 14), [0.12, 0.3, 0.2], 0, 1.5), part(cyl(0.7, 0.55, 0.4, 14), [0.12, 0.3, 0.2], 0, 3.2)]),
    phone: merge([part(bx(0.8, 2.2, 0.8), [0.5, 0.55, 0.6], 0, 1.1)]),
    recycling: merge([part(bx(1.4, 1.6, 1.4), [0.25, 0.42, 0.25], 0, 0.8)]),
    tap: merge([part(cyl(0.1, 0.12, 1.0, 8), [0.2, 0.35, 0.3], 0, 0.5)]),
  };
}

// the façade: floors, bays, windows with frames and shutters, doors on the ground floor, a shop front, a church's stone
const FACADE = /* glsl */`
#include <color_fragment>
{
  float L = vS.x, eave = vS.y, fh = vS.z, seed = vS.w, u = vF.x, v = vF.y;
  int code = int(vSty + 0.5), sty = code - 10 * (code / 10), mat = code / 10;   // the building's kind, its walls' material
  vec3 c = diffuseColor.rgb;
  c *= 0.9 + 0.1 * tNoise(vec2(u, v) * 3.0 + seed * 50.0) + 0.05 * tNoise(vec2(u, v) * 0.4 + seed * 9.0);
  if (mat == 1) { // stone: courses 0.4 m, blocks staggered
    float r = floor(v / 0.4), f = fract(v / 0.4), g = fract(u / 0.7 + 0.5 * mod(r, 2.0));
    c *= (f < 0.06 || g < 0.04) ? 0.78 : 0.95 + 0.1 * tHash(vec2(r, floor(u / 0.7 + 0.5 * mod(r, 2.0))));
  } else if (mat == 2) { // meulière: rough brown millstone in light mortar
    float n = tNoise(vec2(u, v) * 3.2 + seed * 7.0) + 0.5 * tNoise(vec2(u, v) * 7.0);
    c = n < 0.62 ? vec3(0.78, 0.74, 0.66) : c * (0.75 + 0.4 * tNoise(vec2(u, v) * 11.0));
  } else if (mat == 3) { // brick: 0.075 m courses, stretchers staggered
    float r = floor(v / 0.075), f = fract(v / 0.075), g = fract(u / 0.23 + 0.5 * mod(r, 2.0));
    c = (f < 0.15 || g < 0.05) ? vec3(0.72, 0.7, 0.66) : c * (0.85 + 0.3 * tHash(vec2(r, floor(u / 0.23 + 0.5 * mod(r, 2.0)))));
  } else if (mat == 4) c *= 0.85 + 0.15 * step(0.08, fract(u / 0.15));  // wood: boards
  if (v < 0.4) c *= 0.72;                                            // the plinth (below the ground's median: the basement)
  bool walled = fh > 0.0 && L > 2.0 && v < eave - 0.25;
  float nb = max(1.0, floor(L / 2.8)), bw = L / nb, bi = floor(u / bw), du = (fract(u / bw) - 0.5) * bw;
  float fl = floor(v / max(fh, 0.1)), fv = v - fl * fh;
  float hw = 0.48 + 0.18 * tHash(vec2(seed, 3.0));                   // the window's half width
  vec3 shut = mix(vec3(0.9, 0.9, 0.86), mix(vec3(0.42, 0.52, 0.6), vec3(0.36, 0.48, 0.34), step(0.5, tHash(vec2(seed, 7.0)))), step(0.3, tHash(vec2(seed, 5.0))));
  bool shutters = tHash(vec2(seed, 11.0)) > 0.35 && sty == 0;
  if (walled && v > 0.0) {
    bool shop = sty == 1 && fl < 0.5;
    bool door = fl < 0.5 && !shop && bi == floor(nb * tHash(vec2(seed, 13.0)));
    if (shop) {
      if (fv > 0.25 && fv < fh - 0.45 && abs(du) < bw * 0.46) c = mix(vec3(0.12, 0.15, 0.17), vec3(0.35, 0.42, 0.48), smoothstep(0.25, fh, fv)) * (abs(du) > bw * 0.43 ? 0.5 : 1.0);
      else if (fv > fh - 0.45 && fv < fh - 0.15) c = mix(vec3(0.25, 0.22, 0.2), shut, 0.6);   // the sign's band
    } else if (door) {
      if (abs(du) < 0.55 && fv < 2.2) c = abs(du) > 0.48 || fv > 2.12 ? vec3(0.85) : mix(vec3(0.32, 0.22, 0.14), shut, 0.5) * (0.9 + 0.1 * step(0.5, fract(fv / 0.55)));
    } else if (sty == 3 || sty == 4) {                                // sport halls, workshops: a band of windows
      if (fv > 1.2 && fv < fh - 0.4) c = mix(vec3(0.2, 0.25, 0.3), vec3(0.45, 0.52, 0.58), fract(u / 1.2) * 0.4) * (fract(u / 1.2) < 0.05 ? 0.4 : 1.0);
    } else if (sty != 5) {
      float sill = fl < 0.5 ? 0.9 : 0.85, top = min(fh - 0.35, sill + (fl < 0.5 ? 1.35 : 1.45));
      bool inW = abs(du) < hw && fv > sill && fv < top;
      bool frame = abs(du) < hw + 0.07 && fv > sill - 0.1 && fv < top + 0.07;
      if (inW) {
        vec3 glass = mix(vec3(0.1, 0.13, 0.16), vec3(0.42, 0.5, 0.58), smoothstep(sill, top, fv) * 0.6 + 0.2 * tHash(vec2(bi, fl + seed)));
        bool bar = abs(du) < 0.03 || abs(fv - (sill + top) * 0.5 - 0.15) < 0.025;
        c = bar ? vec3(0.9) : glass;
      } else if (frame) c = fv < sill - 0.02 ? c * 0.7 : vec3(0.92, 0.91, 0.88);
      else if (shutters && abs(du) > hw + 0.07 && abs(du) < 2.0 * hw + 0.07 && fv > sill && fv < top) c = shut * (0.85 + 0.15 * step(0.5, fract(fv / 0.12)));
    }
  } else if (sty == 2 && v > 2.0 && L > 3.0) {                       // a church: tall arched windows
    float b2 = max(1.0, floor(L / 4.5)), w2 = L / b2, d2 = (fract(u / w2) - 0.5) * w2;
    float topA = min(eave, 9.0) - 1.0, r = 0.55;
    if (abs(d2) < r && v > 2.5 && (v < topA || length(vec2(d2, v - topA)) < r)) c = vec3(0.18, 0.2, 0.26) + 0.15 * tHash(vec2(floor(d2 * 4.0), floor(v * 3.0)));
  }
  diffuseColor.rgb = c;
}`;

// the roofs: tiles in rows along the eaves (rows at constant height) on pitched planes, gravel on flat ones
const ROOF = /* glsl */`
#include <color_fragment>
{
  vec3 wn = normalize(cross(dFdx(vWP), dFdy(vWP))); if (wn.y < 0.0) wn = -wn;
  vec3 c = diffuseColor.rgb;
  float isFlat = mod(vKind, 2.0), rm = floor(vKind / 2.0 + 0.01);        // flat or pitched; 0 tiles, 1 slates, 2 zinc
  if (isFlat < 0.5 && wn.y < 0.97 && rm > 1.5) {                          // zinc: standing seams down the slope
    vec2 dir = normalize(vec2(-wn.z, wn.x) + 1e-5);
    c *= 0.92 + 0.12 * step(0.06, fract(dot(vWP.xz, dir) / 0.5));
  } else if (isFlat < 0.5 && wn.y < 0.97) {
    float rh = rm > 0.5 ? 0.12 : 0.26, cw = rm > 0.5 ? 0.3 : 0.24;  // slates are smaller and flatter than tiles
    float row = vWP.y / rh, fr = fract(row);
    vec2 dir = normalize(vec2(-wn.z, wn.x) + 1e-5);
    float s = dot(vWP.xz, dir) / cw + 0.5 * mod(floor(row), 2.0);
    c *= 0.72 + 0.28 * smoothstep(0.0, 0.18, fr);
    c *= 0.9 + 0.1 * step(0.07, fract(s));
    c *= 0.9 + 0.2 * tHash(vec2(floor(row), floor(s)));
  } else c *= 0.88 + 0.2 * tNoise(vWP.xz * 4.0) * tNoise(vWP.xz * 0.7);
  diffuseColor.rgb = c;
}`;
