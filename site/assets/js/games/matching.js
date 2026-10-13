// « Cartes identiques »: four windows of a map that look the same; two are, the two others each differ by one feature.

import { t } from "../i18n.js";
import { forestMap, COL } from "./mapgen.js";
import { mapCanvas, framed, grid } from "./common.js";
import { int, range, pick, shuffle } from "./rng.js";
import { LETTERS } from "./quiz.js";

const SWAP = { boulder: "knoll", knoll: "boulder", pit: "depression", depression: "pit", tree: "boulder", cliff: "boulder" };

/** One alteration of the point features inside the window: {points, mark: [x, y]}. */
export function alter(r, map, win, forbid = []) {
  const [cx, cy, size] = win, m = size * 0.1;
  const inWin = (p) => Math.abs(p.x - cx) < size / 2 - m && Math.abs(p.y - cy) < size / 2 - m;
  const cands = map.points.filter((p) => inWin(p) && !forbid.includes(p));
  const kind = pick(r, cands.length ? ["remove", "move", "swap", "add"] : ["add"]);
  const pts = map.points.slice();
  if (kind === "add") {
    const x = range(r, cx - size / 2 + m, cx + size / 2 - m), y = range(r, cy - size / 2 + m, cy + size / 2 - m);
    const p = { type: pick(r, ["boulder", "knoll", "pit", "tree"]), x, y };
    return { points: pts.concat([p]), mark: [x, y], kind, feature: p };
  }
  const p = pick(r, cands), i = pts.indexOf(p);
  if (kind === "remove") pts.splice(i, 1);
  else if (kind === "move") { const a = range(r, 0, 7), d = range(r, 12, 18); pts[i] = { ...p, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d }; }
  else pts[i] = { ...p, type: SWAP[p.type] || "boulder" };
  return { points: pts, mark: [p.x, p.y], kind, feature: p };
}

export function spec() {
  return {
    key: "matching", count: 5, scoring: "count", multi: 2,
    intro: t("g.matching.rules"),
    make(i, r) {
      const map = forestMap(int(r, 0, 2 ** 31), { features: 2, paths: 2, relief: 22 });
      const win = [range(r, 110, map.w - 110), range(r, 110, map.h - 110), 170];
      const a1 = alter(r, map, win), a2 = alter(r, map, win, [a1.feature]);
      const variants = shuffle(r, [{ map }, { map }, { map: { ...map, points: a1.points }, mark: a1.mark }, { map: { ...map, points: a2.points }, mark: a2.mark }]);
      const answer = variants.map((v, k) => (v.mark ? null : LETTERS[k])).filter(Boolean);
      return {
        options: LETTERS.slice(0, 4), answer,
        render(stage) {
          grid(stage, variants.map((v, k) => { const [c] = mapCanvas(v.map, win[0], win[1], win[2], 260); return framed(c, LETTERS[k], `g-pick-${LETTERS[k]}`); }), 2);
        },
        solution(stage) {
          answer.forEach((l) => stage.querySelector(`.g-pick-${l}`)?.classList.add("g-right"));
          variants.forEach((v, k) => {
            if (!v.mark) return;
            const c = stage.querySelector(`.g-pick-${LETTERS[k]} canvas`), ctx = c.getContext("2d");
            const s = 260 / win[2];
            ctx.strokeStyle = COL.course; ctx.lineWidth = 2.5; ctx.beginPath();
            ctx.arc((v.mark[0] - (win[0] - win[2] / 2)) * s, (v.mark[1] - (win[1] - win[2] / 2)) * s, 16, 0, 7); ctx.stroke();
          });
        },
      };
    },
  };
}
