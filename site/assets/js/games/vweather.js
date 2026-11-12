// Pixel's race conditions (owner, 2026-11-12: « weather, decided by the creator », « night-O too: at night orienteers use a
// headlamp, which reduces visibility on the sides and far »): an event's `env` { weather, time, lamp } — clear | overcast | rain |
// fog | snow, day | dusk | night, a night's headlamp normal | strong — laid over the scene World.atmosphere made (games/vworld.js):
// the sky, the haze and the lights; no sun shadows under a grey sky or at night (cheaper too); rain or snow falling round the
// camera (points moved by their shader alone: nothing a frame on the CPU); the ground darker when wet, white where it faces up
// when snowy (the ground shader's own pass); at night a lamp on the runner's head (a spot light, its cone soft at the sides, its
// light falling with the square of the distance, the haze black beyond it) and the control flags' retroreflective tape catching
// it — a flag in the beam shines from far off, as real ones do, unless the ground hides it. The map panel is drawn apart (2D):
// it stays readable. The built-in maps are played on a clear day (no env).

export const WEATHERS = ["clear", "overcast", "rain", "fog", "snow"];
export const TIMES = ["day", "dusk", "night"];
export const LAMPS = ["normal", "strong"];

/** An event's conditions, anything unknown taken as a clear day (the server's cleanEnv). */
export function envOf(e) {
  const pick = (v, list) => (list.includes(v) ? v : list[0]);
  return { weather: pick(e?.weather, WEATHERS), time: pick(e?.time, TIMES), lamp: pick(e?.lamp, LAMPS) };
}
export const plain = (e) => { const v = envOf(e); return v.weather === "clear" && v.time === "day"; };
/** The conditions in words (t: the catalogue's), « Pluie · Nuit, frontale puissante »; "" for a clear day. */
export function envText(t, e) {
  const v = envOf(e);
  if (plain(v)) return "";
  const parts = [];
  if (v.weather !== "clear") parts.push(t(`vt.env.w.${v.weather}`));
  if (v.time === "night") parts.push(t(`vt.env.night.${v.lamp}`));
  else if (v.time === "dusk") parts.push(t("vt.env.t.dusk"));
  return parts.join(" · ");
}

// the weathers over the clear day's scene: the haze's and the zenith's colours, the haze's density (× the biome's), the sun's and
// the sky's light (×), the sun's shadows, the impostors' light (the far trees were rendered in sunlight)
const W = {
  clear: { haze: null, zenith: null, fog: 1, sun: 1, hemi: 1, shadow: true, far: 1 },
  overcast: { haze: "#b4babf", zenith: "#a3abb2", fog: 1.45, sun: 0.22, hemi: 1.12, far: 0.78 },
  rain: { haze: "#959ea3", zenith: "#89929a", fog: 2.4, sun: 0.12, hemi: 0.88, far: 0.6, wet: 1, fall: "rain" },
  fog: { haze: "#c1c7ca", zenith: "#c1c7ca", fogMin: 0.03, sun: 0.18, hemi: 1.0, far: 0.7 },
  snow: { haze: "#d2d8dd", zenith: "#b8c1c9", fog: 1.9, sun: 0.25, hemi: 1.18, far: 0.85, snow: 1, fall: "snow" },
};
// the lamp: its strength (cd), its cone (rad), the haze's density round it (the light's reach), the flags' glow's reach (m)
const LAMP = { normal: { cd: 320, angle: 0.48, fog: 0.026, reach: 60 }, strong: { cd: 650, angle: 0.56, fog: 0.018, reach: 95 } };

const isPhone = () => matchMedia("(hover: none) and (pointer: coarse)").matches || innerWidth < 700;

/** Rain or snow: points in a box round the camera, fixed in the world, falling by their shader. */
function falling(T, kind, phone) {
  const snow = kind === "snow";
  const n = snow ? (phone ? 2200 : 6000) : (phone ? 3000 : 9000);
  const box = snow ? 36 : 30, hgt = snow ? 16 : 20;
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); rnd[i] = Math.random(); }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("aRnd", new T.BufferAttribute(rnd, 1));
  const mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new T.Vector3() }, uBox: { value: new T.Vector3(box, hgt, box) },
      uSpeed: { value: snow ? 1.1 : 9 }, uSize: { value: snow ? 0.07 : 0.55 }, uPx: { value: 500 }, uSway: { value: snow ? 0.6 : 0.05 },
      uColor: { value: new T.Color(snow ? "#ffffff" : "#c9d4dc") }, uAlpha: { value: snow ? 0.9 : 0.42 }, uSnow: { value: snow ? 1 : 0 } },
    vertexShader: `attribute float aRnd; uniform float uTime, uSpeed, uSize, uPx, uSway; uniform vec3 uCam, uBox; varying float vA;
      void main() {
        vec3 o = mod(position * uBox - vec3(uCam.x, uCam.y + uTime * uSpeed * (0.8 + 0.4 * aRnd), uCam.z), uBox) - uBox * 0.5;
        o.x += sin(uTime * 0.9 + aRnd * 6.283) * uSway; o.z += cos(uTime * 0.7 + aRnd * 9.0) * uSway;
        vec4 mv = modelViewMatrix * vec4(uCam + o, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = max(0.2, -mv.z);
        gl_PointSize = clamp(uSize * uPx / d, 1.0, 64.0);
        vA = smoothstep(uBox.x * 0.5, uBox.x * 0.3, length(o.xz)) * smoothstep(0.4, 1.6, d);
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha, uSnow; varying float vA;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float a = uSnow > 0.5 ? smoothstep(0.5, 0.15, length(p)) : smoothstep(0.06, 0.0, abs(p.x)) * smoothstep(0.5, 0.2, abs(p.y));   // i18n-ignore (GLSL)
        if (a * vA < 0.01) discard;
        gl_FragColor = vec4(uColor, a * vA * uAlpha);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new T.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 2;
  return pts;
}

/**
 * Lay the conditions over the scene. ctx { scene, renderer, world, sun, camera }. Returns { update(now, x, y, z, yaw, pitch) },
 * to be called each frame after the sun is placed; null for a clear day.
 */
export function applyEnv(T, env, { scene, renderer, world, sun, camera }) {
  const E = envOf(env);
  if (plain(E)) return null;
  const phone = isPhone();
  const w = W[E.weather], night = E.time === "night", dusk = E.time === "dusk", lamp = LAMP[E.lamp];
  let hemi = null;
  scene.traverse((o) => { if (o.isHemisphereLight) hemi = o; });
  const fog = scene.fog, sky = world.skyMesh?.material?.uniforms;
  const haze = fog.color.clone(), zenith = sky ? sky.cZ.value.clone() : haze.clone();
  if (w.haze) haze.lerp(new T.Color(w.haze), 0.85);
  if (w.zenith) zenith.set(w.zenith);
  let density = Math.max(fog.density * (w.fog || 1), w.fogMin || 0);
  let sunI = sun.intensity * w.sun, hemiI = (hemi?.intensity || 1.5) * w.hemi, far = w.far, exposure = renderer.toneMappingExposure;
  let sunDir = null;
  sun.castShadow = !!w.shadow && !night;
  if (dusk) {
    const base = world.sunDir || new T.Vector3(-0.5, 0.6, 0.6);
    sunDir = new T.Vector3(base.x, 0, base.z).normalize().multiplyScalar(0.985).setY(0.1).normalize();
    sun.color.set("#ffb27a"); sunI *= 0.55;
    if (hemi) { hemi.color.set("#a9b6d6"); hemi.groundColor.set("#4a3c30"); }
    hemiI *= 0.55; far *= 0.55;
    haze.lerp(new T.Color(E.weather === "clear" ? "#d6a78a" : "#7d7b7e"), E.weather === "clear" ? 0.5 : 0.45);
    zenith.lerp(new T.Color("#3e5179"), 0.7);
  }
  if (night) {
    haze.set(E.weather === "fog" ? "#0c0f13" : E.weather === "snow" ? "#0d1115" : "#06080c");
    zenith.set("#020306");
    density = E.weather === "fog" ? 0.05 : lamp.fog * (E.weather === "rain" ? 1.3 : E.weather === "snow" ? 1.15 : 1);
    sun.color.set("#8fa3c8"); sunI = 0.04;                         // the moon's faint light: silhouettes, no shadows
    if (hemi) { hemi.color.set("#3a4660"); hemi.groundColor.set("#0d0d10"); }
    hemiI = 0.07; far = 0.02; exposure = 1.15;
  }
  fog.color.copy(haze); fog.density = density; scene.background = haze;
  if (sky) { sky.cH.value.copy(haze); sky.cZ.value.copy(zenith); if (w.zenith || night) sky.sunDir.value.set(0, -1, 0); else if (sunDir) sky.sunDir.value.copy(sunDir); }
  sun.intensity = sunI; if (hemi) hemi.intensity = hemiI;
  renderer.toneMappingExposure = exposure;
  // the far trees, rendered once in sunlight: as dim as the scene
  for (const k of ["farLeaf", "farPine", "farPine2"]) world.K[k]?.mat.color.setScalar(far);
  // snow: the grass and the ferns under it
  if (w.snow) for (const k of ["grass", "low"]) if (world.K[k]) world.K[k].mat.visible = false;
  // the ground: wet (darker) or snowy (white where it faces up, less on the paths)
  if (w.wet || w.snow) {
    const gm = world.groundMat, before = gm.onBeforeCompile;
    gm.onBeforeCompile = (sh, r) => {
      before?.(sh, r);
      sh.uniforms.uWet = { value: w.wet ? 1 : 0 }; sh.uniforms.uSnow = { value: w.snow ? 1 : 0 };
      sh.vertexShader = "varying float vUp;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vUp = normalize(mat3(modelMatrix) * objectNormal).y;");
      sh.fragmentShader = "uniform float uWet, uSnow; varying float vUp;\n" + sh.fragmentShader.replace("#include <color_fragment>",
        `{ float nz = texture2D(litter, vMapUv * rep * 0.043 + 0.27).g;
           diffuseColor.rgb *= mix(1.0, 0.76, uWet);
           float s = uSnow * smoothstep(0.5, 0.82, vUp) * (1.0 - 0.6 * vGm.x) * clamp(0.55 + 0.9 * nz, 0.0, 1.0);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), s); }
         #include <color_fragment>`);
    };
    gm.customProgramCacheKey = () => `vt-env-${w.wet ? 1 : 0}${w.snow ? 1 : 0}`;
    gm.needsUpdate = true;
  }
  // rain or snow
  const fall = w.fall ? falling(T, w.fall, phone) : null;
  if (fall) {
    if (night) { fall.material.uniforms.uAlpha.value *= 0.45; fall.material.uniforms.uColor.value.multiplyScalar(0.5); }
    scene.add(fall);
  }
  // the night: the headlamp, the flags' reflective tape, the code plates no longer lit by themselves
  let spot = null, glow = [];
  if (night) {
    spot = new T.SpotLight(0xfff1dc, lamp.cd, 0, lamp.angle, 0.6, 2);
    spot.castShadow = false;
    scene.add(spot, spot.target);
    // a soft halo round a lit flag, kept a few pixels wide however far: a spark seen from far off, as tape in a lamp's beam
    const hc = document.createElement("canvas"); hc.width = hc.height = 64;
    const hg = hc.getContext("2d"), grad = hg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,250,235,1)"); grad.addColorStop(0.35, "rgba(255,226,170,0.6)"); grad.addColorStop(1, "rgba(255,200,120,0)");
    hg.fillStyle = grad; hg.fillRect(0, 0, 64, 64);
    const haloTex = new T.CanvasTexture(hc); haloTex.colorSpace = T.SRGBColorSpace;
    (world.flags || []).forEach((g, i) => {
      if (!i) return;                                              // the start's triangle
      const u = g.userData || {};
      g.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === u.mat) {
          const m = new T.Mesh(o.geometry, new T.MeshBasicMaterial({ map: u.mat.map, transparent: true, opacity: 0, blending: T.AdditiveBlending,
            depthWrite: false, fog: false, side: T.DoubleSide }));
          m.position.copy(o.position); m.rotation.copy(o.rotation); m.scale.copy(o.scale).multiplyScalar(1.02);
          m.renderOrder = 3; g.add(m);
          const h = new T.Sprite(new T.SpriteMaterial({ map: haloTex, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
          h.position.set(o.position.x, o.position.y, o.position.z); h.renderOrder = 4; h.visible = false; g.add(h);
          glow.push({ g, m, h });
        } else if (o.material?.isMeshBasicMaterial && o.material !== u.beam?.material && o.material !== u.ring?.material) o.material.color.setScalar(0.06);
      });
    });
  }
  const dir = new T.Vector3(), v = new T.Vector3();
  let tick = 0;
  /** A flag at (fx, fy, fz) seen from the head (hx, hy, hz): is the ground in the way? */
  const clear = (hx, hy, hz, fx, fy, fz) => {
    for (let k = 1; k < 8; k++) {
      const f = k / 8, x = hx + (fx - hx) * f, z = hz + (fz - hz) * f, y = hy + (fy - hy) * f;
      if (world.heightAt(x, z) > y + 0.25) return false;          // a rise between: the ground, not its unevenness
    }
    return true;
  };
  return {
    env: E, phone,
    update(now, x, y, z, yaw, pitch) {
      if (sunDir) { sun.position.set(x + sunDir.x * 120, y + sunDir.y * 120, z + sunDir.z * 120); sun.target.position.set(x, y, z); }
      if (fall) {
        const u = fall.material.uniforms;
        u.uTime.value = now / 1000; u.uCam.value.copy(camera.position);
        u.uPx.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      }
      if (!spot) return;
      // the lamp on the head, aimed where the runner looks, a little down
      const hx = x, hy = y + 1.75, hz = z, fx = Math.sin(yaw), fz = -Math.cos(yaw);
      spot.position.set(hx + fx * 0.15, hy, hz + fz * 0.15);
      spot.target.position.set(hx + fx * 14, hy - 1.4 + Math.tan(pitch) * 14, hz + fz * 14);
      dir.copy(spot.target.position).sub(spot.position).normalize();
      if (tick++ % 3) return;                                        // the flags' glow: every third frame
      const c0 = Math.cos(lamp.angle * 1.9), c1 = Math.cos(lamp.angle * 0.7);
      for (const { g, m, h } of glow) {
        v.set(g.position.x, g.position.y + 0.75, g.position.z).sub(spot.position);
        const d = v.length(); v.divideScalar(d || 1);
        let s = 0;
        if (d < 180) {
          const a = v.dot(dir), cone = a <= c0 ? 0 : a >= c1 ? 1 : (a - c0) / (c1 - c0);
          s = cone * Math.min(1, 1.25 / (1 + (d / lamp.reach) ** 2));
          if (s > 0.02 && !clear(hx, hy, hz, g.position.x, g.position.y + 0.75, g.position.z)) s = 0;
        }
        m.material.opacity = s; m.visible = s > 0.02;
        h.material.opacity = Math.min(1, s * 1.4); h.visible = m.visible; h.scale.setScalar(0.8 + d * 0.03);
      }
    },
  };
}
