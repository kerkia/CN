// « Cherchez l'erreur »: two windows of the same map; what has changed on the right one? Multiple choice.

import { t } from "../i18n.js";
import { forestMap, COL, inside } from "./mapgen.js";
import { mapCanvas, framed, grid } from "./common.js";
import { int, range, pick, shuffle } from "./rng.js";

const TYPES = ["boulder", "knoll", "pit", "depression", "tree", "cliff", "green", "marsh", "open", "path"];
const names = () => ({ boulder: t("g.f.boulder"), knoll: t("g.f.knoll"), pit: t("g.f.pit"), depression: t("g.f.depression"), tree: t("g.f.tree"), cliff: t("g.f.cliff"),
  green: t("g.f.green"), marsh: t("g.f.marsh"), open: t("g.f.open"), path: t("g.f.path") });

export function spec() {
  return {
    key: "spot", count: 6, scoring: "count",
    intro: t("g.spot.rules"),
    make(i, r) {
      const map = forestMap(int(r, 0, 2 ** 31), { features: 2, paths: 3, relief: 22 });
      const size = 200, cx = range(r, 110, map.w - 110), cy = range(r, 110, map.h - 110), m = 18;
      const inWin = (x, y) => Math.abs(x - cx) < size / 2 - m && Math.abs(y - cy) < size / 2 - m;
      const centroid = (poly) => [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
      const kind = pick(r, ["missing", "missing", "new", "count", "area"]);
      let right = { ...map }, answer, text, options, marks = [];
      const N = names();
      if (kind === "count") {
        const rocks = map.points.filter((p) => p.type === "boulder" && inWin(p.x, p.y));
        const k = Math.min(rocks.length, int(r, 1, 4));
        if (k >= 1) {
          const gone = shuffle(r, rocks).slice(0, k);
          right = { ...map, points: map.points.filter((p) => !gone.includes(p)) };
          marks = gone.map((p) => [p.x, p.y]);
          answer = String(k); options = ["1", "2", "3", "4"]; text = t("g.spot.q.count");
        }
      }
      if (kind === "area" || (kind === "count" && !answer)) {
        const areas = map.areas.filter((a) => { const c = centroid(a.poly); return inWin(c[0], c[1]) && a.type !== "water"; });
        if (areas.length) {
          const a = pick(r, areas), ty = a.type.startsWith("green") ? "green" : a.type === "rough" ? "open" : a.type;
          right = { ...map, areas: map.areas.filter((x) => x !== a) };
          marks = [centroid(a.poly)];
          answer = ty; text = t("g.spot.q.missing");
          options = shuffle(r, [ty, ...shuffle(r, TYPES.filter((x) => x !== ty)).slice(0, 3)]);
        }
      }
      if (!answer && kind !== "new") {
        const cands = map.points.filter((p) => inWin(p.x, p.y));
        const paths = map.lines.filter((l) => l.pts.some((q) => inWin(q[0], q[1])));
        if (cands.length && (!paths.length || r() < 0.8)) {
          const p = pick(r, cands);
          right = { ...map, points: map.points.filter((x) => x !== p) };
          marks = [[p.x, p.y]]; answer = p.type; text = t("g.spot.q.missing");
        } else if (paths.length) {
          const l = pick(r, paths);
          right = { ...map, lines: map.lines.filter((x) => x !== l) };
          marks = [l.pts.find((q) => inWin(q[0], q[1]))]; answer = "path"; text = t("g.spot.q.missing");
        }
      }
      if (!answer) {                              // something new
        const x = range(r, cx - size / 2 + m, cx + size / 2 - m), y = range(r, cy - size / 2 + m, cy + size / 2 - m);
        const ty = pick(r, ["boulder", "knoll", "pit", "tree", "depression"]);
        right = { ...map, points: map.points.concat([{ type: ty, x, y }]) };
        marks = [[x, y]]; answer = ty; text = t("g.spot.q.new");
      }
      if (!options) options = shuffle(r, [answer, ...shuffle(r, TYPES.filter((x) => x !== answer)).slice(0, 3)]);
      return {
        options, labels: N, answer, text,
        render(stage) {
          grid(stage, [framed(mapCanvas(map, cx, cy, size, 300)[0], t("g.spot.left")), framed(mapCanvas(right, cx, cy, size, 300)[0], t("g.spot.right"), "g-pick-R")], 2);
        },
        solution(stage) {
          const c = stage.querySelector(".g-pick-R canvas"), ctx = c.getContext("2d"), s = 300 / size;
          ctx.strokeStyle = COL.course; ctx.lineWidth = 2.5;
          for (const [x, y] of marks) { ctx.beginPath(); ctx.arc((x - (cx - size / 2)) * s, (y - (cy - size / 2)) * s, 16, 0, 7); ctx.stroke(); }
        },
      };
    },
  };
}
export { inside };
