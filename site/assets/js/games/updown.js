// « Montée ou descente ? »: a leg on a map; does it climb, descend, climb then descend, or descend then climb?

import { t } from "../i18n.js";
import { forestMap } from "./mapgen.js";
import { profile, moves } from "./terrain.js";
import { mapCanvas, framed, drawProfile, drawCourse, leg } from "./common.js";
import { int, range } from "./rng.js";

const KINDS = { up: ["up"], down: ["down"], updown: ["up", "down"], downup: ["down", "up"] };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function spec() {
  return {
    key: "updown", count: 6, scoring: "time60",
    intro: t("g.updown.rules"),
    make(i, r) {
      let map, L, prof, kind;
      for (let tries = 0; !kind; tries++) {
        if (tries % 40 === 0) map = forestMap(int(r, 0, 2 ** 31), { relief: range(r, 28, 42), features: 1, paths: 2 });
        L = leg(r, map, 90, 170, 40);
        if (!L) continue;
        prof = profile(map.field, L[0][0], L[0][1], L[1][0], L[1][1], 80);
        const m = moves(prof, 4);
        if (!same(m, moves(prof, 2.5))) continue;                 // a small wobble must not make it arguable
        kind = Object.keys(KINDS).find((k) => same(KINDS[k], m)) || null;
        if (kind && Math.max(...prof) - Math.min(...prof) < 10) kind = null;
      }
      const labels = { up: t("g.updown.up"), down: t("g.updown.down"), updown: t("g.updown.updown"), downup: t("g.updown.downup") };
      return {
        options: Object.keys(KINDS), labels, answer: kind,
        render(stage) {
          const mid = [(L[0][0] + L[1][0]) / 2, (L[0][1] + L[1][1]) / 2];
          const [c, ctx, view, o] = mapCanvas(map, mid[0], mid[1], 240, 380);
          drawCourse(ctx, L, view, { ...o, numbers: false, finish: false });
          stage.append(framed(c, t("g.updown.map")));
        },
        solution(stage) {
          const lo = Math.min(...prof) - 3, hi = Math.max(...prof) + 3;
          stage.append(framed(drawProfile(prof, { lo, hi, labels: ["▲", "◯"], w: 300, h: 110 }), t("g.updown.profile")));
        },
      };
    },
  };
}
