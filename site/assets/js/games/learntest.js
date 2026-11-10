// « Apprendre › Test » and the game « Quel poste ? » (owner, 2026-11-10, after a club's quiz « définitions carte course
// d'orientation »: 28 questions, a feature named, four map extracts with a control circle, 20 s each). A feature is shown — its
// photo (by default), its name, its control description symbols, any of them — and four control circles are drawn on the
// map: which one is on it? None of the quiz's pictures is used — no photo, no map extract: the circles are drawn by Ozimut from the specifications
// (isom.js `isomInCircle`, ISOM 2017-2 at 1:15 000, the feature in its own shape where it has one), the symbols are the
// IOF's (Purple Pen's, cdsymbol.js). From the quiz come its 28 features and, for each, the three wrong answers its author
// chose (« Facile »: those of another question, mapped feature by feature; the nine pictures that were no other question's
// answer read as the nearest feature — several boulders as « Gros rocher », small brown rings as « Petite dépression », a
// green cross as « Souche »). « Aléatoire »: three other features of the 28 at random, never one shown by the same symbols.
// The photos of the terrain (owner, 2026-11-10: « the whole point »): the quiz's own photos are not used — two carry stock
// agencies' watermarks (Dreamstime, iStock), one a photographer's signature, the others no source —, but freely licensed
// ones from Wikimedia Commons, one a feature where an unambiguous one was found — the feature at a control's scale, nothing
// else of the list in the frame (owner, 2026-11-10: a « petite colline » that was a big wooded hill behind a vegetation
// boundary): 20 of 28, none for the boulder cluster (many boulders too close to map one by one: those found showed two or three
// big ones, each a boulder of its own), the earth wall (a linear bank: those found showed their ditch, or a hedge), re-entrant, spur, small hill,
// path crossing, thicket and earth bank —, each credited under it (author, licence; the file's page, whose name gives the answer away, after the
// answer); one by its author, with his permission: Emmanuel Roiné's « zone rocheuse », the quiz's own. Replace one by dropping site/assets/learn/<key>.webp and changing its credit in learnphotos.js.
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
import { PHOTOS } from "./learnphotos.js";
export { PHOTOS };

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
/** What a question shows (owner, 2026-11-10: the photo of the terrain the most interesting, so chosen by default): any of a
 *  photo of the feature, its name, its description symbols. A feature without a photo shows its name instead. */
export const SHOW = ["photo", "name", "sym"];
export const LIMITS = [10, 15, 20, 30, 45, 60];
/** The features with a photo (games/learnphotos.js: Wikimedia Commons, free licences, credited under the photo). */
export const PHOTO_KEYS = BANK.filter((f) => PHOTOS[f.k]).map((f) => f.k);

const nameOf = (f) => t(`lt.q.${f.k}`);
const sig = (f) => f.sym.join("+");
/** A feature's control circle drawn on the map, `w` px wide. */
const circle = (f, w) => isomInCircle(f.code, w, "lt-map", false, f.scene || f.sym[0]);
/** Its description symbols, side by side as on a sheet. */
const symbols = (f, size = 56) => html`<span class="lt-syms" role="img" aria-label="${t("lt.symbols")}">${f.sym.map((id) => {
  const s = symbol(id);
  return s ? html`<span class="lt-cell">${cdSymbolSvg(s, size, "lt-sym")}</span>` : "";
})}</span>`;
/** A photo's credit (author, licence, Wikimedia Commons; `page`: with the link to the file, whose name gives the answer
 *  away — after the answer only). */
export const credit = (ph, page = true) => ph.permission
  ? html`<span class="lt-credit">${t("lt.credit", { a: ph.author })} · ${t("lt.credit.perm")}</span>`
  : html`<span class="lt-credit">${t("lt.credit", { a: ph.author })} ·
  <a href="${ph.licenceUrl}" target="_blank" rel="noopener">${ph.licence}</a> ·
  ${page ? html`<a href="${ph.page}" target="_blank" rel="noopener">Wikimedia Commons</a>` : "Wikimedia Commons"} · ${t("lt.credit.cut")}</span>`;
/** A feature's photo (its credit in the list under the game, `creditsHtml`: owner, 2026-11-10, not under each photo). */
const photo = (f) => { const ph = PHOTOS[f.k];
  return html`<figure class="lt-photo"><img src="/assets/learn/${f.k}.webp" width="${ph.w}" height="${ph.h}" alt="${t("lt.photo.alt")}" decoding="async"></figure>`; };
/** Every photo's credit, a folded list (under the test in « Apprendre » and under the game in « Jeux »). */
export const creditsHtml = () => html`<details class="lt-credits"><summary>${t("lt.credits")}</summary><p class="muted">${t("lt.credits.hint")}</p>
  <ul>${PHOTO_KEYS.map((k) => html`<li><b>${t(`lt.q.${k}`)}</b> — ${credit(PHOTOS[k])}</li>`)}</ul></details>`;

/**
 * The test's spec for the games' engine (games/quiz.js runGame): `count` features at random (those with a photo first when
 * photos are shown), each answered among four whose wrong ones are the quiz's (`modes[i]` "easy") or drawn at random
 * ("random"), `limit` seconds each, showing `show` (SHOW). `onState`: the engine's (the page hides its settings).
 */
export function testSpec({ count = 10, modes = [], limit = 20, show = ["photo"], key = "learntest", onState, onStop } = {}) {
  count = Math.max(1, Math.min(MAX, count | 0));
  show = SHOW.filter((x) => show.includes(x));
  if (!show.length) show = ["photo"];
  let order = [];
  return {
    key, count, limit, scoring: "count", onState, pickOnly: true, scrollOnPlay: true,
    topAction: onStop ? { label: t("lt.stop"), onClick: onStop } : null,
    intro: html`<p>${t("lt.rules", { n: count, s: limit })}</p><p class="muted">${t("lt.rules.how")}</p>`,
    make(i, r) {
      if (i === 0) {
        const all = shuffle(r, BANK.slice());
        order = (show.includes("photo") ? [...all.filter((f) => PHOTOS[f.k]), ...all.filter((f) => !PHOTOS[f.k])] : all).slice(0, count);
        order = shuffle(r, order);
      }
      const f = order[i], mode = modes[i] === "random" ? "random" : "easy";
      const wrong = mode === "easy" ? f.easy.map((k) => BY[k])
        : shuffle(r, BANK.filter((g) => g !== f && sig(g) !== sig(f))).slice(0, 3);
      const opts = shuffle(r, [f, ...wrong]);
      const answer = LETTERS[opts.indexOf(f)];
      // the pictures alone answer (owner, 2026-11-10: no letters): the result and the summary say the features' names
      const labels = Object.fromEntries(opts.map((g, k) => [LETTERS[k], nameOf(g)]));
      // what this question shows: the choice, a missing photo replaced by the name
      const withPhoto = show.includes("photo") && !!PHOTOS[f.k];
      const withName = show.includes("name") || (show.includes("photo") && !withPhoto) ;
      const withSym = show.includes("sym");
      const puzzle = {
        options: LETTERS.slice(0, 4), answer,
        text: withName ? nameOf(f) : "", labels,
        render(stage) {
          if (withPhoto || withSym) stage.insertAdjacentHTML("beforeend", html`<div class="lt-ask">${withPhoto ? photo(f) : ""}${withSym ? symbols(f) : ""}</div>`);
          const box = (g, k) => { const d = document.createElement("div"); d.className = "lt-pic"; d.innerHTML = circle(g, 100); return framed(d, "", `g-pick-${LETTERS[k]}`); };
          grid(stage, opts.map(box), 4).classList.add("lt-grid");
          stage.dataset.mode = mode;
        },
        solution(stage, choice, ok) {
          // the right circle framed, a wrong choice marked, each named by its tooltip; the names in the result's line, not over
          // the circles (owner, 2026-11-10: the whole question on a laptop's screen)
          opts.forEach((g, k) => {
            const fr = stage.querySelector(`.g-pick-${LETTERS[k]}`);
            if (!fr) return;
            fr.title = labels[LETTERS[k]];
            if (g === f) fr.classList.add("g-right");
            else if (choice === LETTERS[k]) fr.classList.add("g-wrong");
          });
          puzzle.info = ok ? nameOf(f) : labels[choice] ? t("lt.yours", { a: labels[choice] }) : "";
        },
      };
      return puzzle;
    },
  };
}

/** « Jeux » (games.js): ten features, 20 s each, shown by their photo, the quiz's wrong answers (« easy ») or random ones. */
export function spec(level = "easy") {
  const mode = level === "random" ? "random" : "easy";
  return testSpec({ count: 10, limit: 20, modes: Array(10).fill(mode), key: `learntest-${mode}` });
}
