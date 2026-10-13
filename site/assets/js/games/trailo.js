// « Trail'O »: a drawn photo with flags A to F on features; the map shows a control circle; which flag is on it?
// Z when none is. Ranked by time, 30 s per wrong answer.

import { t } from "../i18n.js";
import { forestMap, COL, passable, typeAt, T } from "./mapgen.js";
import { renderScene } from "./scene.js";
import { mapCanvas, framed, freePoint } from "./common.js";
import { int, range, pick } from "./rng.js";
import { LETTERS } from "./quiz.js";

export function spec() {
  return {
    key: "trailo", count: 5, scoring: "penalty",
    intro: t("g.trailo.rules"),
    make(i, r) {
      let map, V, heading, feats;
      for (;;) {
        map = forestMap(int(r, 0, 2 ** 31), { features: 1, paths: 2, relief: 18 });
        V = freePoint(r, map, { margin: 70 });
        if (!V || typeAt(map, V[0], V[1]) >= T.green2) continue;        // the viewpoint on runnable or open ground
        heading = range(r, 0, Math.PI * 2);
        const fx = Math.sin(heading), fy = -Math.cos(heading), rx = Math.cos(heading), ry = Math.sin(heading);
        const n = int(r, 4, 6) + 1;                 // one feature more than the flags: it may be the control (Z)
        feats = [];
        for (let k = 0; k < 60 && feats.length < n; k++) {
          const z = range(r, 14, 42), lat = range(r, -0.5, 0.5) * z;
          const x = V[0] + fx * z + rx * lat, y = V[1] + fy * z + ry * lat;
          if (!passable(map, x, y) || typeAt(map, x, y) >= T.green2) continue;
          if (feats.some((f) => Math.hypot(f.x - x, f.y - y) < 6 || Math.abs(Math.atan2(f.lat, f.z) - Math.atan2(lat, z)) < 0.07)) continue;
          feats.push({ type: pick(r, ["boulder", "boulder", "tree", "boulder"]), big: r() < 0.5, x, y, z, lat });
        }
        if (feats.length === n) break;
      }
      // the map now carries these features; the flags on all but one, lettered from the left
      map.points = map.points.filter((p) => !feats.some((f) => Math.hypot(f.x - p.x, f.y - p.y) < 14)).concat(feats.map(({ type, big, x, y }) => ({ type, big, x, y })));
      const bare = pick(r, feats);
      const flagged = feats.filter((f) => f !== bare).sort((a, b) => Math.atan2(a.lat, a.z) - Math.atan2(b.lat, b.z));
      flagged.forEach((f, k) => (f.letter = LETTERS[k]));
      const control = r() < 1 / 6 ? bare : pick(r, flagged);
      const answer = control.letter || "Z";
      return {
        options: [...flagged.map((f) => f.letter), "Z"], answer,
        render(stage) {
          const c = document.createElement("canvas"); c.className = "g-photo g-photo-wide";
          renderScene(c, map, { x: V[0], y: V[1], heading }, { flags: flagged.map((f) => ({ x: f.x, y: f.y, letter: f.letter })), W: 560, H: 300, fov: 1.25 });
          stage.append(framed(c, t("g.trailo.photo")));
          const mid = [V[0] + Math.sin(heading) * 22, V[1] - Math.cos(heading) * 22];
          const [m, ctx, view, o] = mapCanvas(map, mid[0], mid[1], 110, 300);
          ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
          ctx.strokeStyle = COL.course; ctx.fillStyle = COL.course; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(control.x, control.y, 5, 0, 7); ctx.stroke();
          // the decision point and the direction of view
          const ux = Math.sin(heading), uy = -Math.cos(heading);
          ctx.beginPath(); ctx.moveTo(V[0] + ux * 3, V[1] + uy * 3); ctx.lineTo(V[0] - ux * 2.5 - uy * 2.2, V[1] - uy * 2.5 + ux * 2.2); ctx.lineTo(V[0] - ux * 2.5 + uy * 2.2, V[1] - uy * 2.5 - ux * 2.2); ctx.closePath(); ctx.fill();
          ctx.setLineDash([2, 2]); ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.moveTo(V[0], V[1]); ctx.lineTo(V[0] + ux * 48, V[1] + uy * 48); ctx.stroke();
          ctx.restore();
          stage.append(framed(m, t("g.trailo.map")));
          void o;
        },
      };
    },
  };
}
