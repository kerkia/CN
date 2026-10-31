// « Choix de parcours » (the knockout sprint's course choice): three variants of a short course on a sprint map,
// the same start and finish; which is the shortest to run? 20 s to look at the map, then 5 s to decide.
// Also « Variante la plus rapide » (the relay's forking): the same on a forest map, the score being the time
// taken to decide plus the time to run the variant chosen.

import { t } from "../i18n.js";
import { sprintMap, forestMap, drawPath } from "./mapgen.js";
import { costGrid, dijkstra } from "./path.js";
import { mapCanvas, framed, grid, freePoint, windowOf, drawCourse } from "./common.js";
import { int } from "./rng.js";

const SPEED = { sprint: 4.2, forest: 2.9 };     // m/s on flat-equivalent metres

/** Three variants {pts, legs (paths), cost, length} or null when the map does not allow a clear one. */
function variants(r, map, kind) {
  const g = costGrid(map, map.raster, kind === "sprint" ? { cell: 2, climb: 0, descent: 0 } : { cell: 3, climb: 8, descent: 1.5 });
  const pull = kind === "sprint";
  for (let tries = 0; tries < 12; tries++) {
    const start = freePoint(r, map, { margin: 60 });
    if (!start) return null;
    const pts = [start];
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) { const p = freePoint(r, map, { margin: 40, away: 70, from: pts }); if (!p || Math.hypot(p[0] - start[0], p[1] - start[1]) > 230) ok = false; else pts.push(p); }
    if (!ok) continue;
    const [S, C1, , F] = [pts[0], pts[1], pts[2], pts[3]];
    const forks = [];
    for (let k = 0; k < 3; k++) { const p = freePoint(r, map, { margin: 40, away: 45, from: [...pts, ...forks] }); if (!p || Math.hypot(p[0] - start[0], p[1] - start[1]) > 230) { ok = false; break; } forks.push(p); }
    if (!ok) continue;
    const first = dijkstra(g, S, C1, { pull });            // the same first leg for the three
    if (!first) continue;
    const V = forks.map((C2) => {
      const course = [S, C1, C2, F];
      const legs = [first];
      for (let k = 2; k < course.length; k++) { const res = dijkstra(g, course[k - 1], course[k], { pull }); if (!res) return null; legs.push(res); }
      const cost = legs.reduce((s, l) => s + l.cost, 0);
      return { pts: course, legs, cost, length: legs.reduce((s, l) => s + l.length, 0) };
    });
    if (V.some((v) => !v)) continue;
    const sorted = V.map((v) => v.cost).sort((a, b) => a - b);
    if (sorted[1] / sorted[0] < 1.05) continue;              // a clear answer
    return V;
  }
  return null;
}

function makeSpec(kind) {
  return {
    key: kind === "sprint" ? "coursechoice" : "gaffle", count: 5,
    scoring: kind === "sprint" ? "count" : "added",
    viewTime: kind === "sprint" ? 20 : 0, chooseTime: 5,
    intro: t(kind === "sprint" ? "g.coursechoice.rules" : "g.gaffle.rules"),
    make(i, r) {
      let map, V = null;
      while (!V) {
        map = kind === "sprint" ? sprintMap(int(r, 0, 2 ** 31)) : forestMap(int(r, 0, 2 ** 31), { paths: 3, relief: 24 });
        V = variants(r, map, kind);
      }
      const times = V.map((v) => Math.round((1000 * v.cost) / SPEED[kind]));
      const best = times.indexOf(Math.min(...times));
      const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
      const info = V.map((v, k) => `${k + 1} : ${Math.round(v.length)} m${kind === "forest" ? ` (${fmt(times[k])})` : ""}`).join(" · ");
      const [cx, cy, size] = windowOf(V.flatMap((v) => v.pts), 35, 200);
      return {
        options: ["1", "2", "3"], answer: String(best + 1), times, info,
        render(stage) {
          grid(stage, V.map((v, k) => { const [c, ctx, view, o] = mapCanvas(map, cx, cy, size, 300); drawCourse(ctx, v.pts, view, o); return framed(c, String(k + 1), `g-pick-${k + 1}`); }), 3);
        },
        solution(stage) {
          V.forEach((v, k) => {
            const c = stage.querySelector(`.g-pick-${k + 1} canvas`), ctx = c.getContext("2d"), view = { x: cx - size / 2, y: cy - size / 2, scale: 300 / size };
            for (const l of v.legs) drawPath(ctx, l.simple, view, { w: 300, h: 300, color: k === best ? "#1a5cff" : "#777", lineWidth: 2 });
          });
        },
      };
    },
  };
}

export const spec = () => makeSpec("sprint");
export const gaffleSpec = () => makeSpec("forest");
