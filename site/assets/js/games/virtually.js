// « Virtually » (Coach › Virtually's Training tab, pages/virtually.js; a tab of « Jeux » on 2026-11-10; administrators only for
// now): a virtual race in a 3D forest built from a real
// orienteering map — after Catching Features and Virtual-O. The runner is seen from behind (or through their own eyes), the
// orienteering map with the course is in the bottom left corner with the compass beside it (owner, 2026-11-11), the runner's
// position hidden unless « Ma position » is pressed (10 s shown, 20 s added to the time), the game's speed and the pause at
// the top right; the flags
// stand at the controls, lit up when within reach, punched with the space bar in the course's order; the finish gives the
// time, the splits and the route run drawn on the map. Each race is a package made offline (work's racebuild.py: the OCAD
// map, the worldwide relief, a national LiDAR where there is one) served by functions/api/virtual to administrators.
import { html, $ } from "../util.js";
import { t, tn, loadArea, lang } from "../i18n.js";
import { THREE as THREE_URL } from "../vendor.js";
import { loadRace, World, runnerFigure } from "./vworld.js";
import { loadAvatar } from "./vavatar.js";

await loadArea("virtually");

const BASE = "/api/virtual/";
const RUN = 3.7;                    // m/s on flat open ground (about 4:30 a km)
// the race's clock runs twice as fast as the wall clock at « ×1 » (owner, 2026-11-11: the real pace, seen on a screen, looked like
// walking; « ×2 » then four times): the times stay a runner's real times, only the play is shorter
const PLAY = 2;
const REACH = 6;                    // m: a control within reach (its cue, the punch)
const PURPLE = "rgba(181, 23, 158, 0.9)";
const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };
const num = (v, d = 1) => v.toLocaleString(lang(), { minimumFractionDigits: d, maximumFractionDigits: d });

/** A map's course: race.json's `courses` (six levels, tools/virtually/course.py), or the single `course` of before. */
export const coursesOf = (race) => race.courses || (race.course ? [{ id: "course", ...race.course }] : []);

/**
 * Mount the game for map `raceId` in `root` (Coach › Virtually's Training tab); returns { stop }.
 * opts: course (its id), title (the course's name as the page writes it), onFinish(run) once the finish is punched —
 * run { course, t (the race time, « Ma position »'s penalties included), sp (cumulative splits, s, the same), d (m run),
 * route [[t, x, z]] (the clock's time) } —, onNav("results" | "analysis") the finish card's buttons; base the package's address
 * when it is not a built-in map's (an event's: /api/virtual/events/<id>/pkg/).
 */
export function mount(root, raceId, opts = {}) {
  let stopped = false, raf = 0, cleanup = [];
  root.innerHTML = html`<div class="vt-load"><div class="spinner"></div><p id="vt-msg">${t("vt.loading")}</p></div>`;
  const say = (k, v) => { const m = $("#vt-msg", root); if (m) m.textContent = t(k, v); };
  (async () => {
    try {
      const [THREE, data] = await Promise.all([import(THREE_URL), loadRace(opts.base || `${BASE}${raceId}/`)]);
      if (stopped) return;
      say("vt.drawingMap");
      const mapImg = await drawMap(data);
      if (stopped) return;
      cleanup = start(root, THREE, data, mapImg, raceId);
    } catch (e) {
      console.error(e);
      root.innerHTML = html`<div class="empty">${t(e.status === 404 ? "vt.noData" : e.status === 403 ? "vt.forbidden" : "vt.error")}<br><span class="muted">${String(e.message || e)}</span></div>`;
    }
  })();
  return { stop: () => { stopped = true; cancelAnimationFrame(raf); cleanup.forEach((f) => f()); } };

  // ---- the game ----------------------------------------------------------------------------------------------------------
  function start(root, T, data, mapImg, raceId) {
    const race = data.race, cs = coursesOf(race), C0 = cs.find((c) => c.id === opts.course) || cs[0];
    race.course = { ...C0, name: opts.title || C0.name || race.id };
    const course = race.course.controls, nC = course.length - 2;
    root.innerHTML = html`<div class="vt" tabindex="0">
      <canvas class="vt-view"></canvas>
      <div class="vt-hud"><b>${race.course.name}</b><span id="vt-time">0:00</span><span id="vt-pen" hidden></span><span id="vt-next"></span></div>
      <div class="vt-cue" id="vt-cue" hidden></div>
      <div class="vt-toast" id="vt-toast" hidden></div>
      <div class="vt-topbar">
        <button type="button" class="btn" id="vt-pos" title="${t("vt.pos.tip")}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg><span class="vt-lbl" id="vt-poslbl">${t("vt.pos.btn")}</span></button>
        <button type="button" class="btn" id="vt-speed" title="${t("vt.speed.tip")}">×1</button>
        <button type="button" class="btn" id="vt-pause" title="${t("vt.pause.tip")}" aria-label="${t("vt.pause")}"><span aria-hidden="true">❚❚</span><span class="vt-lbl">${t("vt.pause")}</span></button>
        <button type="button" class="btn" id="vt-full" title="${t("vt.full")}" aria-label="${t("vt.full")}">⤢</button>
      </div>
      <canvas class="vt-compass" width="180" height="180" title="${t("vt.compass")}"></canvas>
      <div class="vt-map" data-size="small">
        <canvas class="vt-mapc"></canvas>
        <div class="vt-mapbar">
          <button type="button" data-z="1.5" title="${t("vt.map.zoomIn")}">+</button><button type="button" data-z="0.67" title="${t("vt.map.zoomOut")}">−</button>
          <button type="button" id="vt-mnext" title="${t("vt.map.next")}">◎</button><button type="button" id="vt-msize" title="${t("vt.map.size")}">⤢</button>
          <button type="button" id="vt-morient" class="vt-morient"></button>
        </div>
        <div class="vt-desc" id="vt-desc"></div>
      </div>
      <div class="vt-pad" id="vt-pad">
        <button type="button" data-k="ArrowLeft">◀</button><button type="button" data-k="ArrowUp">▲</button><button type="button" data-k="ArrowRight">▶</button>
        <button type="button" data-k="Space" class="vt-padpunch">${t("vt.punchBtn")}</button><button type="button" data-k="ArrowDown">▼</button><button type="button" data-k="KeyM">${t("vt.mapBtn")}</button>
      </div>
      <div class="vt-over" id="vt-over"></div>
    </div>`;
    const box = $(".vt", root), view = $(".vt-view", root), comp = $(".vt-compass", root), mapEl = $(".vt-map", root), mapC = $(".vt-mapc", root);
    // ---- renderer and scene ----
    const renderer = new T.WebGLRenderer({ canvas: view, antialias: true });
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
    const scene = new T.Scene(), B = race.biome || {};
    const fogC = new T.Color(B.fog || "#cfd6da");
    scene.background = new T.Color(B.sky || "#c8d6e2"); scene.fog = new T.Fog(fogC, 30, 220);
    const camera = new T.PerspectiveCamera(65, 1, 0.2, 320);
    scene.add(new T.HemisphereLight(0xe8eef4, 0x6a5a42, 1.85));
    const sun = new T.DirectionalLight(0xfff3e0, 1.45); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 240 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6; scene.add(sun, sun.target);
    const SUN = new T.Vector3(...(B.sun || [-0.5, 0.6, 0.6])).normalize();
    const world = new World(T, data, scene, renderer);
    world.addCourse(course);
    // the runner in the avatar's costume for the race's discipline: a sprint map (ISSprOM, or 1:5000 and larger) the sprint's
    const sprint = /ISSprOM/i.test(race.std || "") || (race.scale && race.scale <= 5000);
    const me = runnerFigure(T, opts.avatar || loadAvatar(sprint ? "sprint" : "forest")); scene.add(me);
    // ---- the runner's state ----
    const st = { phase: "ready", t: 0, x: course[0].x, z: course[0].z, yaw: 0, pitch: -0.08, next: 1, splits: [], track: [], dist: 0,
      view: "third", speedX: 1, maxSpeedX: 1, speed: 0, lastTrack: -1, msgUntil: 0,
      posLeft: 0, posN: 0, pen: 0, legPen: [] };       // « Ma position »: seconds still shown (real time), presses, penalty seconds, per leg
    const total = () => st.t + st.pen;                // the race time: the clock and the penalties
    const keys = new Set();
    const resize = () => { const w = box.clientWidth, h = box.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); drawMapPanel(); };
    const ro = new ResizeObserver(resize); ro.observe(box);
    // ---- the map panel ----
    const ppm = mapImg.ppm, mPer = ppm / race.k;                    // map canvas px per world metre
    const mv = { cx: course[0].x * mPer, cy: course[0].z * mPer, zoom: 1, drag: null, ang: 0 };
    // the map's orientation (owner, 2026-11-11): north up, the leg being run up, or the way the runner faces up; kept in this browser
    const ORIENTS = ["north", "leg", "run"];
    let orient = "north";
    try { const o = localStorage.getItem("ocn.vt.orient"); if (ORIENTS.includes(o)) orient = o; } catch (e) { /* none kept */ }
    /** The canvas's turn (radians, clockwise on screen) that puts the chosen direction up; north up at the finish. */
    const mapAngle = () => {
      if (orient === "north" || st.phase === "done") return 0;
      if (orient === "run") return -st.yaw;
      const a = course[Math.max(0, Math.min(st.next, course.length - 1) - 1)], b = course[Math.min(st.next, course.length - 1)];
      return a === b ? 0 : -Math.atan2(b.x - a.x, -(b.z - a.z));
    };
    /** A shift on the screen (px) as a shift on the map's canvas (its px), the turn undone. */
    const unturn = (dx, dy) => { const c = Math.cos(-mv.ang), s = Math.sin(-mv.ang); return [(dx * c - dy * s) / mv.zoom, (dx * s + dy * c) / mv.zoom]; };
    const fitZoom = (metres) => { mv.zoom = Math.max(0.05, mapEl.clientWidth / (metres * mPer)); };
    function drawMapPanel() {
      const w = mapEl.clientWidth, h = mapEl.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
      if (!w || !h) return;
      if (mapC.width !== Math.round(w * dpr)) { mapC.width = Math.round(w * dpr); mapC.height = Math.round(h * dpr); }
      const g = mapC.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
      mv.ang = mapAngle();
      g.save(); g.translate(w / 2, h / 2); g.rotate(mv.ang); g.scale(mv.zoom, mv.zoom); g.translate(-mv.cx, -mv.cy);
      g.imageSmoothingQuality = "high"; g.drawImage(mapImg.canvas, 0, 0);
      overprint(g);
      if (st.phase === "done") {
        g.strokeStyle = "rgba(220, 30, 30, 0.9)"; g.lineWidth = 2.2 / mv.zoom; g.beginPath();
        st.track.forEach(([, x, z], i) => (i ? g.lineTo(x * mPer, z * mPer) : g.moveTo(x * mPer, z * mPer))); g.stroke();
      }
      if ((st.posLeft > 0 && st.phase === "run") || st.phase === "done") {
        g.fillStyle = "#e01e1e"; g.beginPath(); g.arc(st.x * mPer, st.z * mPer, 5 / mv.zoom, 0, 7); g.fill();
        g.strokeStyle = "#e01e1e"; g.lineWidth = 2 / mv.zoom; g.beginPath(); g.moveTo(st.x * mPer, st.z * mPer);
        g.lineTo((st.x + Math.sin(st.yaw) * 40) * mPer, (st.z - Math.cos(st.yaw) * 40) * mPer); g.stroke();
      }
      g.restore();
      if (mv.ang) {                                                    // a north arrow when the map is turned
        g.save(); g.translate(20, 22); g.rotate(mv.ang);
        g.fillStyle = "rgba(255, 255, 255, 0.85)"; g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill();
        g.fillStyle = "#1f3b8a"; g.beginPath(); g.moveTo(0, -11); g.lineTo(5, 3); g.lineTo(0, 0); g.lineTo(-5, 3); g.closePath(); g.fill();
        g.rotate(-mv.ang); g.font = "bold 10px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(t("vt.card.N"), -Math.sin(mv.ang) * 6.5, Math.cos(mv.ang) * 6.5);
        g.restore();
      }
    }
    function overprint(g) { drawOverprint(g, course, mPer, ppm); }
    function describe() {
      $("#vt-desc", root).innerHTML = html`<table><tbody>${course.slice(1, -1).map((c, i) => html`<tr class="${i + 1 < st.next ? "done" : i + 1 === st.next ? "cur" : ""}"><td>${i + 1}</td><td>${c.code}</td><td>${c.feature ? t(`vt.f.${c.feature}`) : ""}</td></tr>`)}</tbody></table>`;
    }
    describe();
    // sizes: small and large in the bottom left corner, the compass beside it (app.css), hidden, and « full » at the finish
    const mapSize = (s) => { mapEl.dataset.size = s; box.dataset.map = s; requestAnimationFrame(drawMapPanel); };
    $$$(root, ".vt-mapbar [data-z]").forEach((b) => b.addEventListener("click", () => { mv.zoom *= +b.dataset.z; drawMapPanel(); }));
    $("#vt-mnext", root).addEventListener("click", () => { const c = course[Math.min(st.next, course.length - 1)]; mv.cx = c.x * mPer; mv.cy = c.z * mPer; drawMapPanel(); });
    $("#vt-msize", root).addEventListener("click", () => { const big = st.phase === "done" ? "full" : "large"; mapSize(mapEl.dataset.size === big ? "small" : big); });
    mapC.addEventListener("pointerdown", (e) => { mv.drag = [e.clientX, e.clientY, mv.cx, mv.cy]; mapC.setPointerCapture(e.pointerId); });
    mapC.addEventListener("pointermove", (e) => { if (!mv.drag) return; const [dx, dy] = unturn(e.clientX - mv.drag[0], e.clientY - mv.drag[1]); mv.cx = mv.drag[2] - dx; mv.cy = mv.drag[3] - dy; drawMapPanel(); });
    mapC.addEventListener("pointerup", () => (mv.drag = null));
    mapC.addEventListener("wheel", (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2, rc = mapC.getBoundingClientRect();
      const px = e.clientX - rc.left - rc.width / 2, py = e.clientY - rc.top - rc.height / 2;
      const [ux, uy] = unturn(px, py); mv.cx += ux - ux / f; mv.cy += uy - uy / f; mv.zoom *= f; drawMapPanel(); }, { passive: false });
    // the orientation's button: its icon and tooltip say the current choice; a click (or O) takes the next
    const orientBtn = $("#vt-morient", root);
    const ORIENT_ICON = {
      north: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3 17 15 12 12 7 15Z" fill="currentColor"/><text x="12" y="22.5" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor">N</text></svg>',
      leg: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="#f06ad8" stroke-width="2.2"><circle cx="12" cy="19" r="3.2"/><circle cx="12" cy="5" r="3.2"/><path d="M12 15.6V8.4"/></svg>',
      run: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3 18 19 12 15 6 19Z" fill="#ff5a4a"/></svg>',
    };
    const showOrient = () => {
      orientBtn.innerHTML = ORIENT_ICON[orient];
      orientBtn.title = t(`vt.map.orient.${orient}`); orientBtn.setAttribute("aria-label", orientBtn.title);
    };
    const nextOrient = () => {
      orient = ORIENTS[(ORIENTS.indexOf(orient) + 1) % ORIENTS.length];
      try { localStorage.setItem("ocn.vt.orient", orient); } catch (e) { /* kept for the visit */ }
      showOrient(); drawMapPanel(); toast(t(`vt.map.orient.set.${orient}`)); box.focus();
    };
    orientBtn.addEventListener("click", nextOrient);
    showOrient();
    // ---- the compass ----
    function drawCompass() {
      const g = comp.getContext("2d"), s = comp.width, c = s / 2, R = s * 0.42;
      g.clearRect(0, 0, s, s);
      g.fillStyle = "rgba(190, 220, 240, 0.35)"; g.strokeStyle = "rgba(20, 40, 60, 0.6)"; g.lineWidth = 2;
      g.beginPath(); g.roundRect(c - R * 0.55, 4, R * 1.1, s - 8, 12); g.fill(); g.stroke();                   // the baseplate
      g.strokeStyle = "rgba(200, 30, 30, 0.9)"; g.lineWidth = 3; g.beginPath(); g.moveTo(c, 6); g.lineTo(c, c - R - 2); g.stroke();   // direction of travel
      g.save(); g.translate(c, c); g.rotate(-st.yaw);                                                             // the dial turns with the world
      g.fillStyle = "rgba(255, 255, 255, 0.88)"; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill(); g.strokeStyle = "#333"; g.lineWidth = 1.5; g.stroke();
      for (let d = 0; d < 360; d += 10) {
        const a = (d * Math.PI) / 180, l = d % 90 === 0 ? 10 : d % 30 === 0 ? 7 : 4;
        g.beginPath(); g.moveTo(Math.sin(a) * R, -Math.cos(a) * R); g.lineTo(Math.sin(a) * (R - l), -Math.cos(a) * (R - l)); g.stroke();
      }
      g.fillStyle = "#222"; g.font = "bold 14px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
      [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([l, d]) => { const a = (d * Math.PI) / 180; g.fillText(t(`vt.card.${l}`), Math.sin(a) * (R - 20), -Math.cos(a) * (R - 20)); });
      g.strokeStyle = "rgba(200, 30, 30, 0.5)"; g.lineWidth = 1; for (const dx of [-8, 8]) { g.beginPath(); g.moveTo(dx, -R + 14); g.lineTo(dx, R - 14); g.stroke(); }  // north lines
      g.fillStyle = "#d21f1f"; g.beginPath(); g.moveTo(0, -R + 12); g.lineTo(7, 0); g.lineTo(-7, 0); g.fill();                     // the needle: red end north
      g.fillStyle = "#f4f4f4"; g.strokeStyle = "#555"; g.beginPath(); g.moveTo(0, R - 12); g.lineTo(7, 0); g.lineTo(-7, 0); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = "#111"; g.font = "bold 13px Arial"; g.textAlign = "center";
      g.fillText(`${Math.round((((st.yaw * 180) / Math.PI) % 360 + 360) % 360)}°`, c, s - 12);
    }
    // ---- input ----
    const GAMEKEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ShiftLeft", "ShiftRight", "Space"]);
    const onKey = (e) => {
      if (!box.isConnected || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName)) return;
      if (e.type === "keydown") {
        if (e.code === "Escape" && st.phase === "run") { pause(); return; }
        if (st.phase === "run" && GAMEKEYS.has(e.code)) e.preventDefault();
        if (e.repeat) return;
        if (e.code === "Space" && st.phase === "run") punch();
        else if (e.code === "KeyM") mapSize(mapEl.dataset.size === "small" ? "large" : mapEl.dataset.size === "large" ? "hidden" : "small");
        else if (e.code === "KeyO") nextOrient();
        else if (e.code === "KeyV") st.view = st.view === "third" ? "first" : "third";
        keys.add(e.code);
      } else keys.delete(e.code);
    };
    addEventListener("keydown", onKey); addEventListener("keyup", onKey);
    const onBlur = () => keys.clear(); addEventListener("blur", onBlur);
    const onVis = () => { if (document.hidden && st.phase === "run") pause(); };
    document.addEventListener("visibilitychange", onVis);
    let look = null;
    view.addEventListener("pointerdown", (e) => { look = [e.clientX, e.clientY, st.yaw, st.pitch]; view.setPointerCapture(e.pointerId); box.focus(); });
    view.addEventListener("pointermove", (e) => { if (!look) return; st.yaw = look[2] + (e.clientX - look[0]) * 0.006; st.pitch = Math.max(-0.7, Math.min(0.5, look[3] - (e.clientY - look[1]) * 0.004)); });
    view.addEventListener("pointerup", () => (look = null));
    $$$(root, "#vt-pad button").forEach((b) => {
      const k = b.dataset.k;
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); if (k === "Space") punch(); else if (k === "KeyM") mapSize(mapEl.dataset.size === "small" ? "large" : "small"); else keys.add(k); });
      for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, () => keys.delete(k));
    });
    $("#vt-pause", root).addEventListener("click", () => (st.phase === "run" ? pause() : null));
    $("#vt-full", root).addEventListener("click", () => { (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen?.())?.catch?.(() => {}); box.focus(); });
    // the game's speed, changed during the race (the start screen's choice until 2026-11-11): ×1, ×2
    const SPEEDS = [1, 2];
    const speedBtn = $("#vt-speed", root);
    const showSpeed = () => { speedBtn.textContent = `×${st.speedX}`; speedBtn.classList.toggle("on", st.speedX > 1); };
    speedBtn.addEventListener("click", () => {
      st.speedX = SPEEDS[(SPEEDS.indexOf(st.speedX) + 1) % SPEEDS.length];
      if (st.phase === "run") st.maxSpeedX = Math.max(st.maxSpeedX, st.speedX);
      showSpeed(); toast(t("vt.speed.set", { x: st.speedX })); box.focus();
    });
    // « Ma position »: the runner shown on the map for POS_S seconds of play, POS_PEN seconds added to the race time
    const POS_S = 10, POS_PEN = 20;
    const posBtn = $("#vt-pos", root), posLbl = $("#vt-poslbl", root);
    let posShown = -1;
    const showPosBtn = () => {
      const s = Math.ceil(st.posLeft);
      if (s === posShown) return;
      posShown = s; posBtn.classList.toggle("on", s > 0); posBtn.disabled = s > 0;
      posLbl.textContent = s > 0 ? t("vt.pos.left", { s }) : t("vt.pos.btn");
    };
    posBtn.addEventListener("click", () => {
      box.focus();
      if (st.phase !== "run" || st.posLeft > 0) return;
      st.posLeft = POS_S; st.posN++; st.pen += POS_PEN; st.legPen[st.next - 1] = (st.legPen[st.next - 1] || 0) + POS_PEN;
      if (mapEl.dataset.size === "hidden") mapSize("small");
      const c = [st.x * mPer, st.z * mPer], w = mapEl.clientWidth / 2, h = mapEl.clientHeight / 2;
      const ox = (c[0] - mv.cx) * mv.zoom, oy = (c[1] - mv.cy) * mv.zoom, a = mapAngle();
      const sx = ox * Math.cos(a) - oy * Math.sin(a), sy = ox * Math.sin(a) + oy * Math.cos(a);
      if (Math.abs(sx) > w * 0.8 || Math.abs(sy) > h * 0.8) { mv.cx = c[0]; mv.cy = c[1]; }   // brought into view
      showPosBtn(); drawMapPanel(); toast(t("vt.pos.used"), false);
    });
    // ---- messages and overlays ----
    const toast = (msg, ok = true) => { const e = $("#vt-toast", root); e.textContent = msg; e.className = `vt-toast ${ok ? "ok" : "bad"}`; e.hidden = false; st.msgUntil = performance.now() + 2600; };
    const over = (h) => { const o = $("#vt-over", root); o.innerHTML = h; o.hidden = !h; };
    function startScreen() {
      over(html`<div class="vt-card"><h2>${race.course.name}</h2>
        <p>${t("vt.info", { n: nC, km: num(race.course.length / 1000), scale: race.scale.toLocaleString(lang()) })}</p>
        <p class="muted">${t(`vt.src.${race.source}`, { authors: (race.photoAuthors || []).join(", ") || "—" })}</p>
        ${race.photoCredits?.length ? html`<details class="muted vt-photos"><summary>${t("vt.src.photos", { n: race.photoCredits.length })}</summary>
          <p>${race.photoCredits.map((c, i) => html`${i ? ", " : ""}<a href="${c.url}" target="_blank" rel="noopener">${c.id.slice(0, 8)}</a> (${c.author})`)}</p></details>` : ""}
        <ul class="vt-keys">${["move", "turn", "strafe", "walk", "look", "punch", "map", "orient", "view", "pause", "pos", "speed"].map((k) => html`<li>${t(`vt.keys.${k}`)}</li>`)}</ul>
        <div class="vt-btns"><button type="button" class="btn btn-primary" id="vt-go">${t("vt.go")}</button>
</div>
        <p class="muted vt-credit">${t("vt.credit", { std: race.std })}</p></div>`);
      $("#vt-go", root).addEventListener("click", () => {
        st.maxSpeedX = st.speedX;
        st.phase = "run"; over(""); box.focus(); toast(t("vt.started"));
      });
    }
    function pause() {
      st.phase = "pause"; keys.clear();
      over(html`<div class="vt-card"><h2>${t("vt.paused")}</h2><div class="vt-btns"><button type="button" class="btn btn-primary" id="vt-resume">${t("vt.resume")}</button>
        <button type="button" class="btn" id="vt-quit">${t("vt.quit")}</button></div></div>`);
      $("#vt-resume", root).addEventListener("click", () => { st.phase = "run"; over(""); box.focus(); });
      $("#vt-quit", root).addEventListener("click", () => { reset(); startScreen(); });
    }
    function reset() {
      Object.assign(st, { phase: "ready", t: 0, x: course[0].x, z: course[0].z, yaw: 0, next: 1, splits: [], track: [], dist: 0, lastTrack: -1,
        posLeft: 0, posN: 0, pen: 0, legPen: [] });
      showPosBtn(); showSpeed(); describe(); mapSize("small"); mv.cx = course[0].x * mPer; mv.cy = course[0].z * mPer; fitZoom(700); drawMapPanel();
    }
    function finished() {
      st.phase = "done"; keys.clear(); st.posLeft = 0; showPosBtn();
      const legs = st.splits.map((s, i) => [s - (i ? st.splits[i - 1] : 0), s]);   // the splits hold the race time, penalties included
      const straight = race.course.length, T = total();
      opts.onFinish?.({ course: C0.id, t: T, sp: st.splits.slice(), d: st.dist, route: st.track.concat([[st.t, st.x, st.z]]) });
      mapSize("full");
      const all = st.track.map(([, x, z]) => [x, z]).concat(course.map((c) => [c.x, c.z])); const xs = all.map((p) => p[0]), zs = all.map((p) => p[1]);
      mv.cx = ((Math.min(...xs) + Math.max(...xs)) / 2) * mPer; mv.cy = ((Math.min(...zs) + Math.max(...zs)) / 2) * mPer;
      fitZoom((Math.max(...xs) - Math.min(...xs)) * 1.25 + 100);
      $("#vt-over", root).classList.add("side");
      over(html`<div class="vt-card vt-done"><h2>${t("vt.done")}</h2>
        <p class="vt-big">${fmt(T)}</p>
        ${st.posN ? html`<p class="vt-penline">${tn("vt.pen.done", st.posN, { s: st.pen })}</p>` : ""}
        <p>${t("vt.dist", { run: num(st.dist / 1000, 2), course: num(straight / 1000, 2) })}</p>
        <table class="data"><thead><tr><th>${t("vt.col.leg")}</th><th>${t("vt.col.code")}</th><th>${t("vt.col.split")}</th><th>${t("vt.col.total")}</th>${st.posN ? html`<th>${t("vt.col.pen")}</th>` : ""}</tr></thead>
        <tbody>${legs.map(([leg, tot], i) => html`<tr><td>${i + 1 <= nC ? i + 1 : t("vt.finish")}</td><td>${course[i + 1].code || ""}</td><td>${fmt(leg)}</td><td>${fmt(tot)}</td>${st.posN ? html`<td>${st.legPen[i] ? `+${st.legPen[i]} s` : ""}</td>` : ""}</tr>`)}</tbody></table>
        <div class="vt-btns"><button type="button" class="btn btn-primary" id="vt-again">${t("vt.again")}</button>
          ${opts.onNav ? html`<button type="button" class="btn" id="vt-to-res">${t("vt.toResults")}</button><button type="button" class="btn" id="vt-to-an">${t("vt.toAnalysis")}</button>` : ""}</div>
        <p class="muted" id="vt-saved">${opts.onFinish ? t("vt.saving") : ""}</p></div>`);
      $("#vt-again", root).addEventListener("click", () => { $("#vt-over", root).classList.remove("side"); reset(); startScreen(); });
      $("#vt-to-res", root)?.addEventListener("click", () => opts.onNav("results"));
      $("#vt-to-an", root)?.addEventListener("click", () => opts.onNav("analysis"));
    }
    function nearest() {
      let best = null;
      course.forEach((c, i) => { if (i === 0) return; const d = Math.hypot(c.x - st.x, c.z - st.z); if (d < REACH && (!best || d < best.d)) best = { i, d }; });
      return best;
    }
    function punch() {
      const n = nearest(); if (!n) return;
      const c = course[n.i], last = course.length - 1;
      if (n.i === st.next) {
        st.splits.push(total()); st.next++; describe(); beep(n.i === last ? 2 : 1);
        if (n.i === last) { finished(); return; }
        toast(t("vt.punched", { n: n.i, code: c.code }));
      } else if (n.i === last) toast(t("vt.finishNotYet", { n: last - st.next }), false);
      else if (n.i < st.next) toast(t("vt.already", { code: c.code }), false);
      else toast(t("vt.wrong", { code: c.code, n: st.next }), false);
    }
    let actx = null;
    function beep(kind) {
      try {
        actx ||= new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = kind === 2 ? 1320 : 2200; g.gain.value = 0.08;
        o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + (kind === 2 ? 0.5 : 0.12));
      } catch (e) { /* no sound */ }
    }
    // ---- the loop ----
    let last = performance.now(), camPos = null, mapTick = 0;
    const step = (now) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const run = st.phase === "run", sdt = dt * (run ? st.speedX * PLAY : 1);
      if (run) {
        st.t += sdt;
        if (st.posLeft > 0) { st.posLeft = Math.max(0, st.posLeft - dt); showPosBtn(); if (!st.posLeft) drawMapPanel(); }
        const turn = (keys.has("ArrowLeft") || keys.has("KeyA") ? -1 : 0) + (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0);
        st.yaw += turn * 1.9 * dt;
        const fwd = (keys.has("ArrowUp") || keys.has("KeyW") ? 1 : 0) - (keys.has("ArrowDown") || keys.has("KeyS") ? 1 : 0);
        const side = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
        let v = 0;
        if (fwd || side) {
          const walk = keys.has("ShiftLeft") || keys.has("ShiftRight");
          const f = world.terrainSpeed(st.x, st.z) || 0.3;
          const dx0 = Math.sin(st.yaw) * fwd + Math.cos(st.yaw) * side, dz0 = -Math.cos(st.yaw) * fwd + Math.sin(st.yaw) * side, l = Math.hypot(dx0, dz0);
          const ahead = world.heightAt(st.x + (dx0 / l) * 2, st.z + (dz0 / l) * 2) - world.heightAt(st.x, st.z), grade = ahead / 2;
          const slope = grade > 0 ? 1 / (1 + 7 * grade) : 1 / (1 + 2.5 * Math.max(0, -grade - 0.12));
          v = RUN * f * slope * (walk ? 0.4 : 1) * (fwd < 0 ? 0.45 : 1) * (fwd === 0 ? 0.6 : 1);
          const d = v * sdt, nx = st.x + (dx0 / l) * d, nz = st.z + (dz0 / l) * d;
          const free = (x, z) => world.terrainSpeed(x, z) > 0 && !world.hits(x, z, 0.3);
          if (free(nx, nz)) { st.x = nx; st.z = nz; }
          else if (free(nx, st.z)) st.x = nx;
          else if (free(st.x, nz)) st.z = nz;
          else v = 0;
          st.dist += v * sdt;
        }
        st.speed = v;
        if (st.t - st.lastTrack >= 1) { st.track.push([st.t, st.x, st.z]); st.lastTrack = st.t; }
      }
      // the world around the runner
      world.update(st.x, st.z, dt < 0.03 ? 1 : 0);   // a chunk a frame at most, none when the frame was already slow
      const y = world.heightAt(st.x, st.z);
      me.position.set(st.x, y, st.z); me.rotation.y = -st.yaw + Math.PI; me.userData.animate(st.speed, sdt);
      me.visible = st.view === "third";
      const dx = Math.sin(st.yaw), dz = -Math.cos(st.yaw);
      let want;
      if (st.view === "first") want = new T.Vector3(st.x, y + 1.7, st.z);
      else { want = new T.Vector3(st.x - dx * 4.6, y + 2.5, st.z - dz * 4.6); want.y = Math.max(want.y, world.heightAt(want.x, want.z) + 1.2); }
      if (world.town && st.view === "third") { const f = world.town.clear(st.x, st.z, want.x, want.z); if (f < 1) { want.x = st.x + (want.x - st.x) * f; want.z = st.z + (want.z - st.z) * f; } }  // a town's walls: the camera stays in the street
      camPos = camPos && st.view === "third" ? camPos.lerp(want, Math.min(1, dt * 8)) : want.clone();
      camera.position.copy(camPos);
      const look = st.view === "first" ? 10 : 4;
      camera.lookAt(st.x + dx * look, y + (st.view === "first" ? 1.7 : 1.1) + Math.tan(st.pitch) * look, st.z + dz * look);
      sun.position.set(st.x + SUN.x * 120, y + SUN.y * 120, st.z + SUN.z * 120); sun.target.position.set(st.x, y, st.z);
      // the controls' cues
      const n = nearest();
      course.forEach((c, i) => { if (i) world.cue(i, n && n.i === i ? 1 : Math.hypot(c.x - st.x, c.z - st.z) < 15 ? 0.25 : 0, now / 1000); });
      const cueEl = $("#vt-cue", root);
      if (n && st.phase === "run") {
        const c = course[n.i];
        cueEl.textContent = n.i === course.length - 1 ? t("vt.cueFinish") : t("vt.cue", { code: c.code });
        cueEl.hidden = false;
      } else cueEl.hidden = true;
      if (st.msgUntil && now > st.msgUntil) { $("#vt-toast", root).hidden = true; st.msgUntil = 0; }
      renderer.render(scene, camera);
      drawCompass();
      $("#vt-time", root).textContent = fmt(total());
      const penEl = $("#vt-pen", root); penEl.hidden = !st.pen; if (st.pen) penEl.textContent = t("vt.pen.hud", { s: st.pen });
      $("#vt-next", root).textContent = st.next >= course.length - 1 ? `→ ${t("vt.finish")}` : `→ ${st.next} (${course[st.next].code})`;
      if (st.posLeft > 0 && run && (mapTick++ % 6 === 0)) drawMapPanel();
      else if (orient !== "north" && mapEl.dataset.size !== "hidden") {
        const d = mapAngle() - mv.ang;
        if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > 0.004) drawMapPanel();
      }
    };
    reset(); startScreen(); resize();
    window.vtDebug = { st, course, world };            // for support and scripted tests (the console)
    // build the chunks around the start before the first frame
    while (world.update(st.x, st.z, 6) > 0) { /* all near chunks */ }
    raf = requestAnimationFrame(step);
    return [() => { ro.disconnect(); removeEventListener("keydown", onKey); removeEventListener("keyup", onKey); removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis); if (document.fullscreenElement === box) document.exitFullscreen().catch(() => {});
      renderer.dispose(); renderer.forceContextLoss?.(); actx?.close?.(); }];
  }
}

const $$$ = (root, sel) => [...root.querySelectorAll(sel)];

/** The course's overprint on a map canvas: `mPer` canvas px per world metre, `mm` canvas px per map mm (start triangle,
 *  numbered circles, the legs, the finish's double circle). Shared with Coach › Virtually's analysis. */
export function drawOverprint(g, course, mPer, mm) {
  const r = 3 * mm, lw = 0.35 * mm;
  g.strokeStyle = PURPLE; g.fillStyle = PURPLE; g.lineWidth = lw; g.lineCap = "round";
  const P = course.map((c) => [c.x * mPer, c.z * mPer]);
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, ay] = P[i], [bx, by] = P[i + 1], L = Math.hypot(bx - ax, by - ay);
    const ra = (i === 0 ? 4 * mm : r) + 0.5 * mm, rb = (i + 1 === P.length - 1 ? 3.6 * mm : r) + 0.5 * mm;
    if (L <= ra + rb) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    g.beginPath(); g.moveTo(ax + ux * ra, ay + uy * ra); g.lineTo(bx - ux * rb, by - uy * rb); g.stroke();
  }
  P.forEach(([x, y], i) => {
    g.beginPath();
    if (i === 0) {
      const [nx, ny] = P[1], a = Math.atan2(ny - y, nx - x), s = 4 * mm;
      for (let k = 0; k < 3; k++) { const b = a + (k * 2 * Math.PI) / 3; k ? g.lineTo(x + Math.cos(b) * s, y + Math.sin(b) * s) : g.moveTo(x + Math.cos(b) * s, y + Math.sin(b) * s); }
      g.closePath(); g.stroke();
    } else if (i === P.length - 1) {
      g.arc(x, y, 2.4 * mm, 0, 7); g.stroke(); g.beginPath(); g.arc(x, y, 3.5 * mm, 0, 7); g.stroke();
    } else {
      g.arc(x, y, r, 0, 7); g.stroke();
      g.font = `${4 * mm}px Arial`; g.textBaseline = "middle"; g.fillText(String(i), x + r * 1.05, y - r * 1.05);
    }
  });
}

/** The orienteering map, drawn once from the OCAD file over the world's rectangle: { canvas, ppm }. The file's own course
 *  overprint (7xx symbols but the out-of-bounds 709) is left out; the game draws its course. */
export async function drawMap(data) {
  if (data.mapImage) {                     // the generated map (a race from the LiDAR alone): its image over the world, mapPx m a pixel
    const c = document.createElement("canvas"); c.width = data.mapImage.width; c.height = data.mapImage.height;
    c.getContext("2d").drawImage(data.mapImage, 0, 0);
    return { canvas: c, ppm: data.race.k / data.race.mapPx };
  }
  const [{ readOcad }, { CanvasTarget }, { Matrix }] = await Promise.all([import("../tracer/vmap/ocad.js"), import("../tracer/vmap/target.js"), import("../tracer/vmap/geom.js")]);
  const { map } = readOcad(data.ocd);
  await map.ready;
  const r = data.race, wmm = r.W / r.k, hmm = r.H / r.k;
  const ppm = Math.min(12, 9000 / Math.max(wmm, hmm));
  const c = document.createElement("canvas"); c.width = Math.round(wmm * ppm); c.height = Math.round(hmm * ppm);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  const [X0, Y1] = r.mm0, l = X0, top = Y1, b = Y1 - hmm, rr = X0 + wmm;
  const skip = new Set(map.symdefs.map((d) => d.id).filter((id) => { const n = parseInt(id, 10); return n >= 700 && n <= 799 && n !== 709; }));
  map.draw(new CanvasTarget(g, new Matrix(ppm, 0, 0, -ppm, -l * ppm, top * ppm)), [l, b, rr, top], { minRes: 1 / ppm, hideSyms: skip });
  return { canvas: c, ppm };
}
