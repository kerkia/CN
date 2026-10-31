// « Choix d'itinéraire »: a leg in the forest with three or four routes drawn; which is the fastest? The routes are
// the cheapest way, the cheapest ways kept off it, and the straight line; their times come from the ground and the climb.

import { t } from "../i18n.js";
import { forestMap, drawPath, drawMap, COL } from "./mapgen.js";
import { costGrid, dijkstra, routeCost } from "./path.js";
import { mapCanvas, framed, drawCourse, leg, windowOf } from "./common.js";
import { int, shuffle } from "./rng.js";
import { LETTERS } from "./quiz.js";

const SPEED = 2.9;
const ROUTE_COL = ["#d81b60", "#1e88e5", "#43a047", "#fb8c00"];

/** The largest distance from a point of `a` to the polyline `b`. */
function apart(a, b) {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) {
      const [x1, y1] = b[i - 1], [x2, y2] = b[i], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy || 1e-9;
      const u = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / L));
      best = Math.min(best, Math.hypot(p[0] - x1 - u * dx, p[1] - y1 - u * dy));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}
/** Points every `step` along a polyline. */
function resample(pts, step = 8) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
  }
  return out;
}

export function spec() {
  return {
    key: "forestroute", count: 5, scoring: "quantised",
    intro: t("g.forestroute.rules"),
    make(i, r) {
      let map, routes = null, L;
      for (let tries = 0; !routes; tries++) {
        map = forestMap(int(r, 0, 2 ** 31), { paths: 4, relief: 26 });
        const g = costGrid(map, map.raster, { cell: 3, climb: 8, descent: 1.5 });
        L = leg(r, map, 200, 300, 40);
        if (!L) continue;
        const [S, C] = L;
        const found = [];
        // the nodes within 35 m of a route found cost 2.2 more: the next route keeps off it (a mask, not a distance per node)
        const near = new Float32Array(g.gw * g.gh), R = 35 / g.cell;
        const keepOff = (pts) => {
          for (const [px, py] of pts) {
            const ci = px / g.cell - 0.5, cj = py / g.cell - 0.5;
            for (let j = Math.max(0, Math.ceil(cj - R)); j <= Math.min(g.gh - 1, Math.floor(cj + R)); j++)
              for (let i = Math.max(0, Math.ceil(ci - R)); i <= Math.min(g.gw - 1, Math.floor(ci + R)); i++)
                if ((i - ci) ** 2 + (j - cj) ** 2 < R * R) near[j * g.gw + i] = 2.2;
          }
        };
        for (let k = 0; k < 3; k++) {
          const res = dijkstra(g, S, C, { pull: false, extra: found.length ? near : null });
          if (!res) break;
          const pts = resample(res.simple, 6);
          if (found.some((f) => apart(pts, f) < 25)) break;
          found.push(pts);
          keepOff(pts);
        }
        if (found.length < 2) continue;
        const straight = resample([S, C], 6);
        if (found.every((f) => apart(straight, f) > 25)) found.push(straight);
        const scored = found.map((pts) => ({ pts, cost: routeCost(map, pts) }));
        const costs = scored.map((x) => x.cost).sort((a, b) => a - b);
        if (costs[1] / costs[0] < 1.05) continue;
        routes = shuffle(r, scored).slice(0, 4);
      }
      const times = routes.map((x) => (1000 * x.cost) / SPEED);
      const best = times.indexOf(Math.min(...times));
      const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
      const [cx, cy, size] = windowOf(routes.flatMap((x) => x.pts), 30, 220);
      const draw = (ctx, view, o, { solution = false } = {}) => {
        routes.forEach((x, k) => drawPath(ctx, x.pts, view, { ...o, color: ROUTE_COL[k], lineWidth: solution && k === best ? 4 : 2.2, alpha: solution && k !== best ? 0.35 : 0.9 }));
        drawCourse(ctx, L, view, { ...o, numbers: false, finish: false });
        ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
        ctx.font = `bold ${12 / view.scale}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        routes.forEach((x, k) => {
          const p = x.pts[Math.floor(x.pts.length * (0.35 + 0.1 * k))];
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p[0], p[1], 8 / view.scale, 0, 7); ctx.fill();
          ctx.fillStyle = ROUTE_COL[k]; ctx.fillText(LETTERS[k], p[0], p[1] + 0.5 / view.scale);
        });
        ctx.restore();
      };
      return {
        options: LETTERS.slice(0, routes.length), answer: LETTERS[best],
        info: routes.map((x, k) => `${LETTERS[k]} : ${fmt(times[k])}`).join(" · "),
        render(stage) {
          const [c, ctx, view, o] = mapCanvas(map, cx, cy, size, 440);
          draw(ctx, view, o);
          stage.append(framed(c, t("g.forestroute.map")));
        },
        solution(stage) {
          const c = stage.querySelector("canvas"), ctx = c.getContext("2d"), view = { x: cx - size / 2, y: cy - size / 2, scale: 440 / size };
          const o = { w: 440, h: 440 };
          ctx.clearRect(0, 0, 440, 440);
          drawMap(ctx, map, view, o);
          draw(ctx, view, o, { solution: true });
        },
      };
    },
  };
}
export { COL };
