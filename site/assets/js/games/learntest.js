// « Apprendre › Test » and the game « Quel poste ? » (owner, 2026-11-10, after a club's quiz « définitions carte course
// d'orientation »: 28 questions, a feature named, four map extracts with a control circle, 20 s each). A feature is named (or
// shown by its control description symbols, or both) and four control circles are drawn on the map: which one is on it?
// Nothing of the quiz itself is used — no photo, no map extract: the circles are drawn by Ozimut from the specifications
// (isom.js `isomInCircle`, ISOM 2017-2 at 1:15 000, the feature in its own shape where it has one), the symbols are the
// IOF's (Purple Pen's, cdsymbol.js). From the quiz come its 28 features and, for each, the three wrong answers its author
// chose (« Facile »: those of another question, mapped feature by feature; the nine pictures that were no other question's
// answer read as the nearest feature — several boulders as « Gros rocher », small brown rings as « Petite dépression », a
// green cross as « Souche »). « Aléatoire »: three other features of the 28 at random, never one shown by the same symbols.
// The quiz's « face/paroi rocheuse (petite falaise) », a second rock face, is here the impassable cliff (201), and its
// « zone rocheuse » the boulder field (208).

import { html } from "../util.js";
import { t } from "../i18n.js";
import { isomInCircle } from "../isom.js";
import { loadSymbols, symbol } from "../tracer/symbols.js";
import { cdSymbolSvg } from "../cdsymbol.js";
import { grid, framed } from "./common.js";
import { shuffle } from "./rng.js";
import { LETTERS } from "./quiz.js";

await loadSymbols();

/** The features: key (names `lt.q.<key>`), the description symbols that say it (Purple Pen's ids: column D, then E or G),
 *  the map symbol (ISOM 2017-2) and its scene (isom.js SCENE, by ISCD number; the symbol's first by default), and the
 *  quiz's three wrong answers (« Facile »), in its order. */
export const BANK = [
  { k: "stump", sym: ["4.10"], code: "419", easy: ["earthBank", "cairn", "pathCross"] },
  { k: "boulder", sym: ["2.4"], code: "205", easy: ["depression", "knoll", "roughOpen"] },
  { k: "roughOpen", sym: ["4.4"], code: "403", easy: ["bigTree", "pit", "reentrant"] },
  { k: "pathBend", sym: ["5.2", "11.7"], code: "505", scene: "5.2bend", easy: ["smallDep", "pathCross", "cliff"] },
  { k: "rockFace", sym: ["2.1"], code: "202", easy: ["boulder", "smallDep", "boulderField"] },
  { k: "smallDep", sym: ["1.13"], code: "111", easy: ["spur", "fence", "earthWall"] },
  { k: "earthWall", sym: ["1.6"], code: "105", easy: ["pathCross", "hill", "smallDep"] },
  { k: "bigTree", sym: ["4.9"], code: "417", easy: ["stump", "vegBoundary", "ruin"] },
  { k: "road", sym: ["5.1"], code: "502", easy: ["pathCross", "knoll", "pathJunction"] },
  { k: "boulderCluster", sym: ["2.6"], code: "207", easy: ["impFence", "ruin", "boulder"] },
  { k: "pathCross", sym: ["5.2", "10.1"], code: "505", scene: "5.2cross", easy: ["fence", "pathJunction", "road"] },
  { k: "pit", sym: ["1.14"], code: "112", easy: ["stump", "smallDep", "knoll"] },
  { k: "knoll", sym: ["1.10"], code: "109", easy: ["boulder", "roughOpen", "earthBank"] },
  { k: "depression", sym: ["1.12"], code: "101", easy: ["knoll", "vegBoundary", "hill"] },
  { k: "ruin", sym: ["5.13"], code: "523", easy: ["impFence", "cairn", "pathBend"] },
  { k: "reentrant", sym: ["1.3"], code: "101", easy: ["earthBank", "smallDep", "boulderField"] },
  { k: "boulderField", sym: ["2.5"], code: "208", easy: ["depression", "stump", "cliff"] },
  { k: "cliff", sym: ["2.1"], code: "201", easy: ["boulderField", "depression", "fence"] },
  { k: "fence", sym: ["5.9"], code: "516", easy: ["earthWall", "pathCross", "cairn"] },
  { k: "spur", sym: ["1.2"], code: "101", easy: ["depression", "earthBank", "roughOpen"] },
  { k: "impFence", sym: ["5.9"], code: "518", easy: ["earthWall", "pathCross", "pit"] },
  { k: "vegBoundary", sym: ["4.7"], code: "416", easy: ["fence", "bigTree", "impFence"] },
  { k: "cairn", sym: ["5.17"], code: "526", easy: ["bigTree", "stump", "cliff"] },
  { k: "thicket", sym: ["4.5"], code: "410", easy: ["ditch", "vegBoundary", "roughOpen"] },
  { k: "ditch", sym: ["3.5"], code: "306", easy: ["spur", "fence", "pathBend"] },
  { k: "pathJunction", sym: ["5.2", "10.2"], code: "505", scene: "5.2junction", easy: ["pathCross", "pathBend", "fence"] },
  { k: "hill", sym: ["1.9"], code: "101", easy: ["smallDep", "knoll", "depression"] },
  { k: "earthBank", sym: ["1.4"], code: "104", easy: ["spur", "cairn", "rockFace"] },
];
const BY = Object.fromEntries(BANK.map((f) => [f.k, f]));
export const MAX = BANK.length;
/** The question's wording: the feature's name, its symbols, or both. */
export const ASK = ["name", "sym", "both"];
export const LIMITS = [10, 15, 20, 30, 45, 60];

const nameOf = (f) => t(`lt.q.${f.k}`);
const sig = (f) => f.sym.join("+");
/** A feature's control circle drawn on the map, `w` px wide. */
const circle = (f, w) => isomInCircle(f.code, w, "lt-map", false, f.scene || f.sym[0]);
/** Its description symbols, side by side as on a sheet. */
const symbols = (f, size = 56) => html`<span class="lt-syms" role="img" aria-label="${t("lt.symbols")}">${f.sym.map((id) => {
  const s = symbol(id);
  return s ? html`<span class="lt-cell">${cdSymbolSvg(s, size, "lt-sym")}</span>` : "";
})}</span>`;

/**
 * The test's spec for the games' engine (games/quiz.js runGame): `count` features at random, each answered among four whose
 * wrong ones are the quiz's (`modes[i]` "easy") or drawn at random ("random"), `limit` seconds each, worded by `ask`.
 */
export function testSpec({ count = 10, modes = [], limit = 20, ask = "name", key = "learntest" } = {}) {
  count = Math.max(1, Math.min(MAX, count | 0));
  let order = [];
  return {
    key, count, limit, scoring: "count",
    intro: html`<p>${t("lt.rules", { n: count, s: limit })}</p><p class="muted">${t("lt.rules.how")}</p>`,
    make(i, r) {
      if (i === 0) order = shuffle(r, BANK.slice()).slice(0, count);
      const f = order[i], mode = modes[i] === "random" ? "random" : "easy";
      const wrong = mode === "easy" ? f.easy.map((k) => BY[k])
        : shuffle(r, BANK.filter((g) => g !== f && sig(g) !== sig(f))).slice(0, 3);
      const opts = shuffle(r, [f, ...wrong]);
      const answer = LETTERS[opts.indexOf(f)];
      const label = (l) => `${l} · ${nameOf(opts[LETTERS.indexOf(l)])}`;
      return {
        options: LETTERS.slice(0, 4), answer,
        text: ask === "sym" ? t("lt.symQ") : nameOf(f),
        answerText: label(answer), choiceText: label,
        render(stage) {
          if (ask !== "name") stage.insertAdjacentHTML("beforeend", html`<div class="lt-ask">${symbols(f)}</div>`);
          const box = (g, k) => { const d = document.createElement("div"); d.className = "lt-pic"; d.innerHTML = circle(g, 220); return framed(d, LETTERS[k], `g-pick-${LETTERS[k]}`); };
          grid(stage, opts.map(box), 2).classList.add("lt-grid");
          stage.dataset.mode = mode;
        },
        solution(stage, choice) {
          // each circle named, the right one framed, a wrong choice marked
          opts.forEach((g, k) => {
            const fr = stage.querySelector(`.g-pick-${LETTERS[k]}`);
            if (!fr) return;
            fr.querySelector(".g-caption").textContent = label(LETTERS[k]);
            if (g === f) fr.classList.add("g-right");
            else if (choice === LETTERS[k]) fr.classList.add("g-wrong");
          });
        },
      };
    },
  };
}

/** « Jeux » (games.js): ten features, 20 s each, the quiz's wrong answers (« easy ») or random ones. */
export function spec(level = "easy") {
  const mode = level === "random" ? "random" : "easy";
  return testSpec({ count: 10, limit: 20, modes: Array(10).fill(mode), key: `learntest-${mode}` });
}
