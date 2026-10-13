// « Mémoire photo »: a map window with a control and the direction of approach, to remember; then four drawn
// « photos » of control sites: which one is the control just seen? No way back to the map.

import { t } from "../i18n.js";
import { forestMap, COL, passable, typeAt, T } from "./mapgen.js";
import { renderScene, cameraTowards } from "./scene.js";
import { mapCanvas, framed, grid } from "./common.js";
import { int, range, shuffle, pick } from "./rng.js";
import { LETTERS } from "./quiz.js";

const SITE_TYPES = ["boulder", "knoll", "cliff", "tree", "pit", "depression"];

/** Four control sites of distinct kinds, far apart, each with a direction one can approach it from. */
function sites(r, map) {
  const byType = SITE_TYPES.map((ty) => shuffle(r, map.points.filter((p) => p.type === ty && p.x > 50 && p.y > 50 && p.x < map.w - 50 && p.y < map.h - 50)));
  const out = [];
  for (const list of shuffle(r, byType)) {
    for (const p of list) {
      if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 70)) continue;
      // the approach: 24 m before the control, on passable ground
      let cam = null;
      for (let k = 0; k < 16 && !cam; k++) {
        const heading = range(r, 0, Math.PI * 2), c = cameraTowards(p.x, p.y, heading, 24);
        if (c.x < 5 || c.y < 5 || c.x > map.w - 5 || c.y > map.h - 5 || !passable(map, c.x, c.y)) continue;
        // a clear view: runnable or open ground between the camera and the control
        let clear = true;
        for (let s = 0; s <= 6; s++) { const ty = typeAt(map, c.x + (p.x - c.x) * s / 6, c.y + (p.y - c.y) * s / 6); if (ty >= T.green2 && ty < T.paved) clear = false; }
        if (clear) cam = c;
      }
      if (!cam) continue;
      out.push({ ...p, cam });
      break;
    }
    if (out.length === 4) break;
  }
  return out.length === 4 ? out : null;
}

export function spec() {
  return {
    key: "photomemory", count: 4, scoring: "count", memoriseLabel: t("g.photo.see"),
    intro: t("g.photo.rules"),
    make(i, r) {
      let map, S = null;
      while (!S) { map = forestMap(int(r, 0, 2 ** 31), { features: 2, paths: 3, relief: 24 }); S = sites(r, map); }
      const target = pick(r, S);
      const order = shuffle(r, S);
      const answer = LETTERS[order.indexOf(target)];
      return {
        options: LETTERS.slice(0, 4), answer,
        memorise(stage) {
          const [c, ctx, view, o] = mapCanvas(map, target.x, target.y, 150, 380);
          // the control circle and the approach arrow
          ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
          ctx.strokeStyle = COL.course; ctx.fillStyle = COL.course; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(target.x, target.y, 8, 0, 7); ctx.stroke();
          const { x, y, heading } = target.cam, ux = Math.sin(heading), uy = -Math.cos(heading);
          const ax = x - ux * 20, ay = y - uy * 20, bx = target.x - ux * 10, by = target.y - uy * 10;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - ux * 5 - uy * 3, by - uy * 5 + ux * 3); ctx.lineTo(bx - ux * 5 + uy * 3, by - uy * 5 - ux * 3); ctx.closePath(); ctx.fill();
          ctx.restore();
          stage.append(framed(c, t("g.photo.map")));
          void o;
        },
        render(stage) {
          grid(stage, order.map((s, k) => {
            const c = document.createElement("canvas"); c.className = "g-photo";
            renderScene(c, map, s.cam, { flags: [{ x: s.x, y: s.y }], W: 360, H: 230 });
            return framed(c, LETTERS[k], `g-pick-${LETTERS[k]}`);
          }), 2);
        },
        solution(stage) { stage.querySelector(`.g-pick-${answer}`)?.classList.add("g-right"); },
      };
    },
  };
}
