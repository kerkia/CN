// « Tracé rapide » (after Ben Brown's Rapid Route, MIT): two points on a sprint map or in a maze; draw the shortest
// route between them, by taps (straight segments) or by dragging. Right when the route crosses nothing and is
// within 4 % of the shortest; half a mark when it took more than 30 s.

import { html, $ } from "../util.js";
import { t } from "../i18n.js";
import { sprintMap, mazeMap, drawPath, clearLine, length, COL } from "./mapgen.js";
import { costGrid, dijkstra } from "./path.js";
import { mapCanvas, freePoint, windowOf, drawCourse } from "./common.js";
import { int, pick } from "./rng.js";
import { canvasPoint } from "./quiz.js";

/** A leg worth drawing: {map, S, F, best} */
function makeLeg(r, mode) {
  for (;;) {
    if (mode === "maze") {
      const n = pick(r, [7, 8, 9, 10, 12]);
      const map = mazeMap(int(r, 0, 2 ** 31), n);
      const g = costGrid(map, map.raster, { cell: 2, climb: 0, descent: 0 });
      const cell = (x, y) => [(x + 0.5) * map.cw, (y + 0.5) * map.ch];
      const S = cell(int(r, 0, n - 1), int(r, 0, n - 1));
      let best = null, F = null;
      for (let k = 0; k < 8; k++) {                      // the farthest of a few candidates
        const p = cell(int(r, 0, n - 1), int(r, 0, n - 1));
        const res = dijkstra(g, S, p);
        if (res && (!best || res.length > best.length)) { best = res; F = p; }
      }
      if (best && best.length > 2.5 * Math.hypot(F[0] - S[0], F[1] - S[1])) return { map, S, F, best };
      continue;
    }
    const map = sprintMap(int(r, 0, 2 ** 31));
    const g = costGrid(map, map.raster, { cell: 2, climb: 0, descent: 0 });
    for (let k = 0; k < 20; k++) {
      const S = freePoint(r, map, { margin: 40 });
      const F = S && freePoint(r, map, { margin: 40, away: 200, from: [S] });
      if (!S || !F || Math.hypot(F[0] - S[0], F[1] - S[1]) > 330) continue;
      const best = dijkstra(g, S, F);
      if (best && best.length > 1.22 * Math.hypot(F[0] - S[0], F[1] - S[1])) return { map, S, F, best };
    }
  }
}

export function spec(mode = "sprint") {
  return {
    key: `rapid-${mode}`, count: 5, scoring: "rapid",
    intro: t("g.rapid.rules"),
    make(i, r) {
      const { map, S, F, best } = makeLeg(r, mode);
      const [cx, cy, size] = mode === "maze" ? [map.w / 2, map.h / 2, map.w] : windowOf(best.simple, 45, 260);
      const PX = 520;
      let path = [S], done = false, crossed = false;
      return {
        answer: null, labels: {},
        render(stage, api) {
          const [c, ctx, view, o] = mapCanvas(map, cx, cy, size, PX, { contours: false });
          const base = ctx.getImageData(0, 0, c.width, c.height);
          const redraw = () => {
            ctx.putImageData(base, 0, 0);
            drawPath(ctx, path, view, { ...o, color: COL.course, lineWidth: 2.4, alpha: 0.9 });
            drawCourse(ctx, [S, F], view, { ...o, numbers: false, lines: false, radius: 7 });
          };
          redraw();
          stage.append(c);
          const bar = document.createElement("div"); bar.className = "row g-tools";
          bar.innerHTML = html`<span class="muted">${t("g.rapid.hint")}</span><span class="spacer"></span><button class="btn btn-sm" type="button" id="g-reset">${t("g.rapid.reset")}</button>`;
          stage.append(bar);
          $("#g-reset", bar).addEventListener("click", () => { if (!done) { path = [S]; crossed = false; redraw(); } });
          const add = (p) => {
            if (done) return;
            const last = path[path.length - 1];
            if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2.5 / view.scale * 2) return;
            if (!clearLine(map, last, p)) crossed = true;
            path.push(p);
            if (Math.hypot(p[0] - F[0], p[1] - F[1]) < 9) { path.push(F); finish(); }
            redraw();
          };
          const toMap = (e) => { const [x, y] = canvasPoint(c, e); return [view.x + x / view.scale, view.y + y / view.scale]; };
          let down = false;
          c.addEventListener("pointerdown", (e) => { down = true; c.setPointerCapture(e.pointerId); add(toMap(e)); e.preventDefault(); });
          c.addEventListener("pointermove", (e) => { if (down) add(toMap(e)); });
          c.addEventListener("pointerup", () => { down = false; });
          c.addEventListener("pointercancel", () => { down = false; });
          const finish = () => {
            done = true;
            const L = length(path), ratio = L / best.length;
            const ok = !crossed && ratio <= 1.04;
            api.done({ ok, choice: crossed ? t("g.rapid.crossed") : ratio <= 1.04 ? t("g.rapid.shortest") : t("g.rapid.longer", { pct: Math.round((ratio - 1) * 100) }) });
          };
          this._view = view; this._ctx = ctx; this._o = o;
        },
        solution() { drawPath(this._ctx, best.simple, this._view, { ...this._o, color: "#1a5cff", lineWidth: 2.6, alpha: 0.85 }); },
        get info() { return `${t("g.rapid.best")} ${Math.round(best.length)} m · ${t("g.rapid.yours")} ${Math.round(length(path))} m`; },
      };
    },
  };
}
