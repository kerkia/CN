// « Analyse solo »'s 3D view (prototype, 2026-10-24): the map draped over the ground's heights (trace/terrain.js), the trace
// laid on it, the runner moving with the 2D playback's clock. three.js (vendored, loaded only when the view opens).
// - The ground: one vertex per node of the height grid (≤ 320 a side), the map image as its texture, reduced to what the
//   device takes (4096 px on phones and small screens). A soft light from the north-west shades the relief.
// - The trace: a ribbon a few metres wide lying on the ground (its heights from the grid, not from the watch's altitude),
//   coloured as in 2D (one colour, or by pace); the part run so far, the tail thicker, the part to come faint or hidden.
// - The camera: an orbit around a point (drag to turn, right-drag or Shift-drag or two fingers to move, wheel or pinch to
//   zoom), or, with « Suivre », a chase camera behind the runner, turning with their heading.
// - The vertical exaggeration: × 1 to × 3, the ground and the trace stretched together.
// Everything is drawn on demand (the clock moved, the camera moved, a setting changed): nothing runs while nothing changes.

import { THREE as THREE_URL } from "../vendor.js";
import { heightAt } from "./terrain.js";
import { posAt, indexAt } from "./track.js";

let threeP = null;
const loadThree = () => (threeP ||= import(THREE_URL).catch((e) => { threeP = null; throw e; }));
const PI = Math.PI;

/** The map image reduced to at most `max` pixels a side, as a canvas (the 3D view's texture only; the 2D keeps the image). */
function textureCanvas(image, max) {
  const k = Math.min(1, max / Math.max(image.width, image.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(image.width * k)); c.height = Math.max(1, Math.round(image.height * k));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(image, 0, 0, c.width, c.height);
  return c;
}

/**
 * The view in `host` (an empty, positioned element it fills). o: { image, W, H, grid, toM(px, py) → [mx, my], toPx(mx, my)
 * → [px, py], track, i0, i1 (the race's first and last points), now() → the trace's time (s), onUserMove() (the user moved
 * the camera by hand: « Suivre » goes off) }. Returns the controller, or throws when WebGL is not available.
 */
export async function open3d(host, o) {
  const THREE = await loadThree();
  const { image, W, H, toM, toPx, track } = o;
  let grid = o.grid;
  const canvas = document.createElement("canvas");
  canvas.className = "an-3d-canvas";
  host.appendChild(canvas);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }); }
  catch (e) { canvas.remove(); throw new Error("webgl"); }
  const small = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 900;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 60000);
  let dirty = true, lastS = null, raf = 0, lastFrame = performance.now(), live = true;

  // ---- the frame: metres around the map's centre, y up; x east, z south (the trace's own metres)
  const [cx, cy] = toM(W / 2, H / 2);
  let zBase = 0;
  const world = new THREE.Group();                       // what the exaggeration stretches
  scene.add(world);
  let ex = 1;

  // ---- light: the map's colours on flat ground, the slopes facing north-west lighter (physical units: × π)
  scene.add(new THREE.AmbientLight(0xffffff, 0.72 * PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.42 * PI);
  sun.position.set(-1, 1.4, -1);
  scene.add(sun);

  // ---- the ground
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, small || (navigator.deviceMemory || 8) < 8 ? 4096 : 8192);
  const texCanvas = textureCanvas(image, maxTex);
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const groundMat = new THREE.MeshLambertMaterial({ map: texture });
  let ground = null;
  function buildGround() {
    const { nx, ny, z } = grid;
    zBase = Infinity;
    for (const v of z) zBase = Math.min(zBase, v);
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, [mx, my] = toM((i / (nx - 1)) * W, (j / (ny - 1)) * H);
      pos[3 * k] = mx - cx; pos[3 * k + 1] = z[k] - zBase; pos[3 * k + 2] = my - cy;
      uv[2 * k] = i / (nx - 1); uv[2 * k + 1] = 1 - j / (ny - 1);
    }
    let q = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    if (ground) { world.remove(ground); ground.geometry.dispose(); }
    ground = new THREE.Mesh(g, groundMat);
    world.add(ground);
  }
  buildGround();
  const span = Math.hypot(...[0, 1].map((a) => toM(W, H)[a] - toM(0, 0)[a]));

  // ---- the trace: ribbons over the race's points
  const i0 = Math.max(0, o.i0), i1 = Math.min(track.n - 1, o.i1), np = i1 - i0 + 1;
  const P = new Float32Array(np * 3);                      // the points: x, height, z
  const groundH = (mx, my) => heightAt(grid, W, H, ...toPx(mx, my)) - zBase;
  function placePoints() { for (let k = 0; k < np; k++) { const i = i0 + k; P[3 * k] = track.x[i] - cx; P[3 * k + 1] = groundH(track.x[i], track.y[i]); P[3 * k + 2] = track.y[i] - cy; } }
  placePoints();
  const BASE_W = Math.max(0.8, Math.min(3, span / 1200));   // metres of ribbon at the 2D's « normal » width
  const ribbonMat = (opacity, units) => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: units });
  const colours = new Float32Array(np * 2 * 3);
  const colourAttr = new THREE.BufferAttribute(colours, 3);
  const index = (() => { const idx = new Uint32Array(Math.max(0, np - 1) * 6); for (let k = 0; k < np - 1; k++) { const a = 2 * k; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], 6 * k); } return new THREE.BufferAttribute(idx, 1); })();
  function ribbon(widthM, lift) {
    const pos = new Float32Array(np * 2 * 3);
    let dx = 1, dz = 0;
    for (let k = 0; k < np; k++) {
      const a = Math.max(0, k - 2), b = Math.min(np - 1, k + 2);
      const ex_ = P[3 * b] - P[3 * a], ez = P[3 * b + 2] - P[3 * a + 2], l = Math.hypot(ex_, ez);
      if (l > 0.05) { dx = ex_ / l; dz = ez / l; }
      // each edge on its own ground: a ribbon held level across a steep slope sank into it on the uphill side
      const nx = -dz * widthM / 2, nz = dx * widthM / 2, x = P[3 * k], z = P[3 * k + 2];
      pos.set([x + nx, groundH(x + nx + cx, z + nz + cy) + lift, z + nz, x - nx, groundH(x - nx + cx, z - nz + cy) + lift, z - nz], 6 * k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", colourAttr);
    g.setIndex(index);
    return g;
  }
  let style = { width: 2.4, future: "hide", colourKey: "", alpha: 1 };
  const runMesh = new THREE.Mesh(undefined, ribbonMat(1, -4)), tailMesh = new THREE.Mesh(undefined, ribbonMat(1, -8)), futureMesh = new THREE.Mesh(undefined, ribbonMat(0.45, -2));
  tailMesh.renderOrder = 2; runMesh.renderOrder = 1;
  world.add(futureMesh, runMesh, tailMesh);
  function buildRibbons() {
    const w = BASE_W * (style.width / 1.6);
    for (const [m, ww, lift] of [[runMesh, w, 0.9], [tailMesh, w * 1.7, 1.0], [futureMesh, w * 0.8, 0.8]]) { m.geometry?.dispose(); m.geometry = ribbon(ww, lift); }
  }
  buildRibbons();

  // ---- the runner: an orange disc ringed white, the same size on screen at any distance, seen through the hills
  const runner = new THREE.Group();
  const dot = (r, c) => new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true }));
  runner.add(dot(1.4, 0xffffff), dot(1, 0xe8641c));
  runner.children[1].renderOrder = 11; runner.children[0].renderOrder = 10;
  const stickGeom = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  const stick = new THREE.Line(stickGeom, new THREE.LineBasicMaterial({ color: 0xe8641c }));
  scene.add(runner, stick);

  // ---- the camera: an orbit (target, distance, azimuth from the south, polar angle from the vertical)
  const cam = { target: new THREE.Vector3(), dist: span * 0.8, az: 0, pol: 0.95 };
  let follow = false, heading = null;
  function placeCamera() {
    cam.pol = Math.max(0.05, Math.min(1.48, cam.pol));
    cam.dist = Math.max(15, Math.min(span * 4, cam.dist));
    const s = Math.sin(cam.pol);
    camera.position.set(cam.target.x + cam.dist * s * Math.sin(cam.az), cam.target.y + cam.dist * Math.cos(cam.pol), cam.target.z + cam.dist * s * Math.cos(cam.az));
    // never inside a hill: a camera low behind the runner went under the slope behind them
    const clear = groundH(camera.position.x + cx, camera.position.z + cy) * ex + Math.max(6, cam.dist * 0.06);
    if (camera.position.y < clear) camera.position.y = clear;
    camera.near = Math.max(0.5, cam.dist / 400); camera.far = span * 12 + cam.dist * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(cam.target);
  }
  /** The camera on a box of the trace's metres [x0, y0, x1, y1]. */
  function frame(b) {
    const mx = (b[0] + b[2]) / 2, my = (b[1] + b[3]) / 2, r = Math.max(60, Math.hypot(b[2] - b[0], b[3] - b[1]) / 2);
    cam.target.set(mx - cx, groundH(mx, my) * ex, my - cy);
    cam.dist = (r * 1.15) / Math.tan((camera.fov * PI) / 360) / Math.max(0.6, Math.min(1, camera.aspect));
    placeCamera();
  }
  function fitTrace() {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = i0; i <= i1; i++) b = [Math.min(b[0], track.x[i]), Math.min(b[1], track.y[i]), Math.max(b[2], track.x[i]), Math.max(b[3], track.y[i])];
    if (b[2] > b[0]) frame(b);
    dirty = true;
  }
  function fitMap() { const a = toM(0, 0), b = toM(W, H), c = toM(W, 0), d = toM(0, H); frame([Math.min(a[0], b[0], c[0], d[0]), Math.min(a[1], b[1], c[1], d[1]), Math.max(a[0], b[0], c[0], d[0]), Math.max(a[1], b[1], c[1], d[1])]); dirty = true; }

  // ---- pointer: turn, move, zoom
  const pointers = new Map();
  let gesture = null;
  const userMoved = () => { if (follow) { follow = false; o.onUserMove?.(); } };
  canvas.style.touchAction = "none";
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    gesture = pointers.size === 2 ? { kind: "two", ...two() } : { kind: pan ? "pan" : "turn", x: e.clientX, y: e.clientY };
  });
  const two = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, dist: cam.dist }; };
  function pan(dx, dy) {
    const k = (2 * cam.dist * Math.tan((camera.fov * PI) / 360)) / Math.max(1, canvas.clientHeight);
    const ca = Math.cos(cam.az), sa = Math.sin(cam.az);
    cam.target.x += (-dx * ca - dy * sa) * k; cam.target.z += (dx * sa - dy * ca) * k;
  }
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (gesture.kind === "two" && pointers.size === 2) {
      const g2 = two();
      cam.dist = (gesture.dist * gesture.d) / Math.max(10, g2.d);
      pan(g2.mx - gesture.mx, g2.my - gesture.my); gesture.mx = g2.mx; gesture.my = g2.my;
      userMoved();
    } else if (gesture.kind !== "two") {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      gesture.x = e.clientX; gesture.y = e.clientY;
      if (gesture.kind === "pan") { pan(dx, dy); userMoved(); }
      else { cam.az -= dx * 0.006; cam.pol -= dy * 0.005; if (follow && Math.abs(dx) > 2) userMoved(); }
    }
    placeCamera(); dirty = true;
  });
  const up = (e) => { pointers.delete(e.pointerId); gesture = pointers.size === 1 ? { kind: "turn", x: [...pointers.values()][0][0], y: [...pointers.values()][0][1] } : null; };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.0012); placeCamera(); dirty = true; }, { passive: false });

  // ---- size, theme
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; placeCamera(); dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  function theme() {
    const bg = getComputedStyle(document.body).backgroundColor || "#e9e6dc";
    try { scene.background = new THREE.Color(bg.replace(/rgba?\(([^)]+)\)/, (m, a) => `rgb(${a.split(",").slice(0, 3).join(",")})`)); } catch (e) { scene.background = new THREE.Color("#e9e6dc"); }
    dirty = true;
  }
  theme();

  // ---- the clock and the drawing
  const frames = [];                                       // the last frames' durations (ms between renders, render's own cost)
  let tailS = 60;
  function update(s) {
    const iNow = Math.max(i0, Math.min(i1, indexAt(track, s))), kNow = iNow - i0;
    const kTail = tailS ? Math.max(0, indexAt(track, s - tailS) - i0) : 0;
    runMesh.geometry.setDrawRange(0, 6 * kNow);
    tailMesh.geometry.setDrawRange(6 * kTail, 6 * Math.max(0, kNow - kTail));
    futureMesh.visible = style.future === "faint";
    futureMesh.geometry.setDrawRange(6 * kNow, 6 * Math.max(0, np - 1 - kNow));
    const [mx, my] = posAt(track, s), y = groundH(mx, my) * ex;
    const rs = camera.position.distanceTo(new THREE.Vector3(mx - cx, y, my - cy)) * 0.0105;
    runner.position.set(mx - cx, y + rs * 1.6, my - cy); runner.scale.setScalar(rs);
    stickGeom.attributes.position.array.set([mx - cx, y, my - cy, mx - cx, y + rs * 1.6, my - cy]); stickGeom.attributes.position.needsUpdate = true;
    return [mx, my, y];
  }
  function chase(s, dtReal) {
    const [mx, my, y] = update(s);
    const [ax, ay] = posAt(track, s - 8), hx = mx - ax, hy = my - ay;
    if (Math.hypot(hx, hy) > 4) heading = Math.atan2(-hx, -hy);
    cam.target.set(mx - cx, y, my - cy);
    if (heading != null) {
      let d = heading - cam.az;
      while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI;
      cam.az += d * (1 - Math.exp(-dtReal / 900));
      if (Math.abs(d) > 0.002) dirty = true;
    }
    placeCamera();
  }
  function loop() {
    if (!live) return;
    raf = requestAnimationFrame(loop);
    const nowMs = performance.now(), dt = nowMs - lastFrame;
    const s = o.now();
    if (s !== lastS || dirty) {
      if (follow) chase(s, Math.min(200, dt)); else { if (s !== lastS) update(s); placeCamera(); }
      const r0 = performance.now();
      renderer.render(scene, camera);
      frames.push([dt, performance.now() - r0]); if (frames.length > 120) frames.shift();
      lastS = s; dirty = false; lastFrame = nowMs;
    } else lastFrame = nowMs;
  }
  resize(); fitTrace(); update(o.now()); loop();

  return {
    canvas,
    /** The 2D's display settings: colour of each point (i → css), width factor, the part to come, the tail (s), opacity. */
    setStyle({ colourOf, colourKey, width, future, tail, mapAlpha }) {
      if (colourKey !== style.colourKey) {
        const c = new THREE.Color();
        for (let k = 0; k < np; k++) { c.set(colourOf(i0 + k)); colours.set([c.r, c.g, c.b, c.r, c.g, c.b], 6 * k); }
        colourAttr.needsUpdate = true; style.colourKey = colourKey; dirty = true;
      }
      if (width !== style.width) { style.width = width; buildRibbons(); dirty = true; }
      if (future !== style.future || tail !== tailS) { style.future = future; tailS = tail; dirty = true; }
      const a = (mapAlpha ?? 100) / 100;
      if (groundMat.opacity !== a) { groundMat.opacity = a; groundMat.transparent = a < 1; groundMat.needsUpdate = true; dirty = true; }
    },
    setFollow(on) {
      if (on && !follow) { cam.dist = Math.max(50, Math.min(cam.dist, 160)); cam.pol = Math.min(cam.pol, 1.1); heading = null; }
      follow = !!on; dirty = true;
    },
    setExaggeration(k) {
      cam.target.y *= k / ex; ex = k; world.scale.y = k;
      placeCamera(); dirty = true;
    },
    /** Another height grid (the map's contour lines added, or taken out): the ground and the trace laid again. */
    setGrid(g) { grid = g; buildGround(); placePoints(); buildRibbons(); dirty = true; },
    zoom(f) { cam.dist /= f; placeCamera(); dirty = true; },
    fitTrace, fitMap, theme,
    redraw() { dirty = true; },
    stats() {
      const n = frames.length, gaps = frames.slice(1).map((f) => f[0]).sort((a, b) => a - b), cost = frames.map((f) => f[1]).sort((a, b) => a - b);
      const med = (v) => (v.length ? v[Math.floor(v.length / 2)] : null);
      return { frames: n, fps: med(gaps) ? Math.round(1000 / med(gaps)) : null, renderMs: med(cost), groundVertices: grid.nx * grid.ny, traceVertices: np * 2 * 3, texture: [texCanvas.width, texCanvas.height], pixelRatio: renderer.getPixelRatio(), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      live = false; cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((m) => { m.geometry?.dispose?.(); m.material?.dispose?.(); });
      texture.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    },
  };
}
