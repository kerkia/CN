// « Courbes de niveau »: a map window with a purple line X → Y; which of four height profiles is the line's?

import { t } from "../i18n.js";
import { forestMap, drawPath, COL } from "./mapgen.js";
import { profile } from "./terrain.js";
import { mapCanvas, framed, grid, drawProfile } from "./common.js";
import { int, range, shuffle, newSeed } from "./rng.js";
import { LETTERS } from "./quiz.js";

const rms = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length); };
/** A profile without its mean: shapes compare, not heights. */
const centred = (p) => { const m = p.reduce((s, x) => s + x, 0) / p.length; return p.map((x) => x - m); };

export function spec() {
  return {
    key: "contour", count: 5, scoring: "time60",
    intro: t("g.contour.rules"),
    make(i, r) {
      const map = forestMap(int(r, 0, 2 ** 31), { relief: range(r, 28, 40), features: 1, paths: 2 });
      const line = () => {
        const a = [range(r, 60, map.w - 60), range(r, 60, map.h - 60)], ang = range(r, 0, Math.PI * 2), d = range(r, 90, 140);
        const b = [a[0] + Math.cos(ang) * d, a[1] + Math.sin(ang) * d];
        if (b[0] < 40 || b[1] < 40 || b[0] > map.w - 40 || b[1] > map.h - 40) return null;
        return [a, b, profile(map.field, a[0], a[1], b[0], b[1], 60)];
      };
      let main = null;
      while (!main) main = line();
      const [A, B, prof] = main;
      // decoys: other lines of the same map whose shape differs clearly from the right one and from each other
      const decoys = [];
      for (let k = 0; k < 400 && decoys.length < 3; k++) {
        const l = line();
        if (!l) continue;
        const c = centred(l[2]);
        if (rms(c, centred(prof)) < 5) continue;
        if (decoys.some((d) => rms(c, centred(d[2])) < 4)) continue;
        decoys.push(l);
      }
      while (decoys.length < 3) decoys.push([A, B, prof.map((v, j) => v + 12 * Math.sin((j / 60) * Math.PI * (decoys.length + 1))).reverse()]);
      const all = shuffle(r, [prof, ...decoys.map((d) => d[2])]);
      const answer = LETTERS[all.indexOf(prof)];
      const lo = Math.min(...all.flat()) - 2, hi = Math.max(...all.flat()) + 2;
      return {
        options: LETTERS.slice(0, 4), answer,
        render(stage) {
          const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
          const [c, ctx, view, o] = mapCanvas(map, mid[0], mid[1], 230, 380);
          drawPath(ctx, [A, B], view, { ...o, color: COL.course, lineWidth: 2.2, alpha: 0.9 });
          ctx.save(); ctx.scale(view.scale, view.scale); ctx.translate(-view.x, -view.y);
          ctx.fillStyle = COL.course; ctx.font = "bold 11px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          const ux = (B[0] - A[0]) / Math.hypot(B[0] - A[0], B[1] - A[1]), uy = (B[1] - A[1]) / Math.hypot(B[0] - A[0], B[1] - A[1]);
          ctx.fillText("X", A[0] - ux * 9, A[1] - uy * 9); ctx.fillText("Y", B[0] + ux * 9, B[1] + uy * 9);
          ctx.restore();
          stage.append(framed(c, t("g.contour.map")));
          grid(stage, all.map((p, k) => framed(drawProfile(p, { lo, hi }), LETTERS[k], `g-pick-${LETTERS[k]}`)), 2);
        },
        solution(stage) { stage.querySelector(`.g-pick-${answer}`)?.classList.add("g-right"); },
      };
    },
  };
}
export { newSeed };
