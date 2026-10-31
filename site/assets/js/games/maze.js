// « Labyrinthe » (after Laby by Jarkko Ryyppö): a course through a hedge maze seen from inside. Arrows (or the
// buttons) to turn and step, the map on demand — without your position on it. The time counts. On a touch screen
// (owner, 2026-10-31: « not usable on a phone »): a taller view, the buttons as a pad, and the view itself answers a tap —
// its left or right side turns, its middle steps forward, a swipe down steps back.

import { html, $, $$ } from "../util.js";
import { t } from "../i18n.js";
import { mazeMap, drawMap, COL } from "./mapgen.js";
import { makeCanvas } from "./quiz.js";
import { int, shuffle } from "./rng.js";

const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];          // N E S W in cell units (north = -y)

// a hedge's height against the lens (the view of 480 × 300 px as first drawn), so that a taller view shows more sky and
// ground rather than taller hedges
const WALL = 0.476;

/** Whether one can leave cell (x, y) by side d. */
const openSide = (map, x, y, d) => map.open.has(`${x},${y},${d}`);

/** The first-person view of the maze from cell (px, py) (+0.5) facing f. */
function drawView(ctx, map, W, H, px, py, f, controls, target) {
  const n = map.n;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#8fc1ea"); g.addColorStop(0.5, "#dbe8f3"); g.addColorStop(0.5, "#7d9a5c"); g.addColorStop(1, "#4f6b3a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const fov = 1.1, focal = (W / 2) / Math.tan(fov / 2);
  const ax = Math.atan2(D[f][1], D[f][0]);
  const zbuf = new Float32Array(W);
  for (let col = 0; col < W; col++) {
    const a = ax + Math.atan((col - W / 2) / focal), rx = Math.cos(a), ry = Math.sin(a);
    let cx = Math.floor(px), cy = Math.floor(py);
    const sx = rx > 0 ? 1 : -1, sy = ry > 0 ? 1 : -1;
    let tx = rx !== 0 ? ((sx > 0 ? cx + 1 - px : px - cx) / Math.abs(rx)) : Infinity, ty = ry !== 0 ? ((sy > 0 ? cy + 1 - py : py - cy) / Math.abs(ry)) : Infinity;
    const dx = Math.abs(1 / rx), dy = Math.abs(1 / ry);
    let dist = 0, side = 0, steps = 0;
    for (;;) {
      if (tx < ty) { if (!openSide(map, cx, cy, sx > 0 ? 1 : 3)) { dist = tx; side = 0; break; } cx += sx; tx += dx; }
      else { if (!openSide(map, cx, cy, sy > 0 ? 2 : 0)) { dist = ty; side = 1; break; } cy += sy; ty += dy; }
      if (++steps > 4 * n) { dist = tx; break; }
    }
    const perp = dist * Math.cos(a - ax);
    zbuf[col] = perp;
    const hgt = Math.min(H * 3, (focal * WALL) / Math.max(0.05, perp));
    const shade = (side ? 0.72 : 0.9) * Math.max(0.35, 1 - perp / (n * 1.6));
    ctx.fillStyle = `rgb(${Math.round(58 * shade)},${Math.round(120 * shade)},${Math.round(52 * shade)})`;
    ctx.fillRect(col, H / 2 - hgt / 2, 1, hgt);
    ctx.fillStyle = `rgba(0,0,0,${(side ? 0.15 : 0.05).toFixed(2)})`;
    ctx.fillRect(col, H / 2 - hgt / 2, 1, hgt);
  }
  // the flags of the controls (the next one bright, the others faint), where they are in sight
  const fx = D[f][0], fy = D[f][1], rxv = -fy, ryv = fx;
  controls.forEach(([cx, cy], k) => {
    const ox = cx + 0.5 - px, oy = cy + 0.5 - py, z = ox * fx + oy * fy, lat = ox * rxv + oy * ryv;
    if (z < 0.25) return;
    const sxp = W / 2 + (lat * focal) / z, size = (focal / z) * 0.35, base = H / 2 + (focal / z) * 0.5 * WALL;
    if (sxp < -size || sxp > W + size) return;
    const c0 = Math.max(0, Math.floor(sxp - size / 2)), c1 = Math.min(W - 1, Math.ceil(sxp + size / 2));
    let seen = false;
    for (let col = c0; col <= c1; col++) if (zbuf[col] > z) { seen = true; break; }
    if (!seen) return;
    ctx.save();
    ctx.beginPath();
    for (let col = c0; col <= c1; col++) if (zbuf[col] > z) ctx.rect(col, 0, 1, H);
    ctx.clip();
    const alpha = k === target ? 1 : 0.45;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#8a7a66"; ctx.fillRect(sxp - 1, base - size * 1.6, 2, size * 1.6);
    ctx.fillStyle = "#fff"; ctx.fillRect(sxp - size / 2, base - size * 1.6, size, size);
    ctx.fillStyle = "#ff6a00"; ctx.beginPath(); ctx.moveTo(sxp - size / 2, base - size * 0.6); ctx.lineTo(sxp + size / 2, base - size * 0.6); ctx.lineTo(sxp + size / 2, base - size * 1.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#111"; ctx.font = `bold ${Math.max(9, size * 0.5)}px system-ui, sans-serif`; ctx.textAlign = "center";
    ctx.fillText(String(k + 1), sxp, base - size * 1.7);
    ctx.restore();
  });
  // the compass: north
  ctx.save();
  ctx.translate(W - 34, H - 34);
  ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fill();
  ctx.rotate(-ax - Math.PI / 2);
  ctx.fillStyle = "#d32f2f"; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#333"; ctx.beginPath(); ctx.moveTo(0, 18); ctx.lineTo(6, -2); ctx.lineTo(-6, -2); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "bold 12px system-ui, sans-serif"; ctx.textAlign = "left";
  ctx.fillText("N", W - 40, H - 58);
}

export function spec(level = "small") {
  const n = level === "small" ? 6 : level === "large" ? 12 : 9;
  return {
    key: `maze-${level}`, count: 3, scoring: "time",
    intro: t("g.maze.rules"),
    make(i, r) {
      const map = mazeMap(int(r, 0, 2 ** 31), n);
      const cells = shuffle(r, Array.from({ length: n * n }, (_, k) => [k % n, Math.floor(k / n)]));
      const course = cells.slice(0, level === "small" ? 4 : 5);      // start, controls, finish
      return {
        answer: null,
        render(stage, api) {
          // a narrow screen gets a view nearly as tall as wide (a phone held upright)
          const narrow = matchMedia("(max-width: 600px)").matches;
          const W = narrow ? 360 : 480, H = narrow ? 400 : 300;
          const [c, ctx] = makeCanvas(W, H, W);
          c.classList.add("g-maze-view");
          stage.append(c);
          const bar = document.createElement("div"); bar.className = "g-pad";
          bar.innerHTML = html`<div class="g-pad-row"><span class="g-target" id="g-target"></span></div>
            <div class="g-dpad">
            <button class="btn" data-k="up" type="button" aria-label="${t("g.maze.forward")}" title="${t("g.maze.forward")}">▲</button>
            <button class="btn" data-k="left" type="button" aria-label="${t("g.maze.left")}" title="${t("g.maze.left")}">⟲</button>
            <button class="btn g-dpad-map" data-k="map" type="button" aria-pressed="false">${t("g.maze.map")}</button>
            <button class="btn" data-k="right" type="button" aria-label="${t("g.maze.right")}" title="${t("g.maze.right")}">⟳</button>
            <button class="btn" data-k="down" type="button" aria-label="${t("g.maze.back")}" title="${t("g.maze.back")}">▼</button></div>
            <p class="muted g-maze-touch">${t("g.maze.touch")}</p>`;
          stage.append(bar);
          let [px, py] = course[0], f = 0, next = 1, showMap = false, done = false;
          while (f < 3 && !openSide(map, px, py, f)) f++;          // the start facing an open way, not a hedge
          const controls = course.slice(1);
          const status = () => { $("#g-target", bar).textContent = next < course.length ? (next === course.length - 1 ? t("g.maze.toFinish") : t("g.maze.toControl", { n: next })) : ""; };
          const draw = () => {
            if (showMap) {
              // the map as large as the view allows
              const S = Math.min(W, H) - 8, view = { x: 0, y: 0, scale: S / map.h };
              ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
              ctx.save(); ctx.translate((W - S) / 2, (H - S) / 2);
              drawMap(ctx, map, view, { w: S, h: S, contours: false });
              const pts = course.map(([x, y]) => [(x + 0.5) * map.cw, (y + 0.5) * map.ch]);
              ctx.save(); ctx.scale(view.scale, view.scale);
              ctx.strokeStyle = COL.course; ctx.fillStyle = COL.course; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
              pts.forEach(([x, y], k) => {
                ctx.beginPath();
                if (k === 0) { const R = 16; for (let q = 0; q < 3; q++) { const th = -Math.PI / 2 + (q * 2 * Math.PI) / 3; ctx.lineTo(x + R * Math.cos(th), y + R * Math.sin(th)); } ctx.closePath(); ctx.stroke(); }
                else { ctx.arc(x, y, 14, 0, 7); ctx.stroke(); if (k === pts.length - 1) { ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke(); } else { ctx.font = "bold 20px system-ui, sans-serif"; ctx.fillText(String(k), x + 14, y - 12); } }
              });
              ctx.restore(); ctx.restore();
            } else drawView(ctx, map, W, H, px + 0.5, py + 0.5, f, controls, next - 1);
          };
          const act = (k) => {
            if (done) return;
            if (k === "map") { showMap = !showMap; $('[data-k="map"]', bar).setAttribute("aria-pressed", String(showMap)); draw(); return; }
            if (showMap) return;
            if (k === "left") f = (f + 3) % 4;
            else if (k === "right") f = (f + 1) % 4;
            else {
              const d = k === "up" ? f : (f + 2) % 4;
              if (openSide(map, px, py, d)) { px += D[d][0]; py += D[d][1]; }
            }
            const [tx, ty] = course[next];
            if (px === tx && py === ty) {
              next++;
              if (next === course.length) { done = true; draw(); api.done({ ok: true, choice: t("g.maze.finished") }); return; }
            }
            status(); draw();
          };
          $$("button[data-k]", bar).forEach((b) => b.addEventListener("click", () => act(b.dataset.k)));
          // the view answers a touch: a tap on its left or right third turns, in its middle steps forward (or leaves the map);
          // a swipe down steps back, a swipe sideways turns
          let p0 = null;
          c.addEventListener("pointerdown", (e) => { p0 = [e.clientX, e.clientY]; e.preventDefault(); });
          c.addEventListener("pointerup", (e) => {
            if (!p0) return;
            const dx = e.clientX - p0[0], dy = e.clientY - p0[1], box = c.getBoundingClientRect();
            p0 = null;
            if (showMap) { act("map"); return; }
            if (Math.hypot(dx, dy) > 30) { act(Math.abs(dy) > Math.abs(dx) ? (dy > 0 ? "down" : "up") : dx < 0 ? "right" : "left"); return; }
            const x = (e.clientX - box.left) / box.width;
            act(x < 0.3 ? "left" : x > 0.7 ? "right" : "up");
          });
          c.addEventListener("pointercancel", () => { p0 = null; });
          const keys = (e) => {
            const k = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "map" }[e.key];
            if (!k) return;
            e.preventDefault(); act(k);
          };
          window.addEventListener("keydown", keys);
          api.onCleanup(() => window.removeEventListener("keydown", keys));
          status(); draw();
        },
      };
    },
  };
}
