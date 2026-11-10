// « Jeux »: training games on generated maps, one tab each (after the games catalogued by O'Mate: Ben Brown's
// orienteering games and Rapid Route, Laby's maze). Nothing leaves the browser: the maps, the relief and the drawn
// photos are made here, from a seed. Administrators only for now (2026-10-13).

import { html, $, $$ } from "../util.js";
import { t } from "../i18n.js";
import { pageTabs, tabFrom, bindPageTabs } from "../ui.js";
import { runGame } from "../games/quiz.js";
import * as auth from "../auth.js";

// key, module, export name, levels [[key, label key]] (a level restarts the game with another spec)
const ALL = [
  ["rapid", "rapidroute.js", "spec", [["sprint", "g.rapid.sprint"], ["maze", "g.rapid.maze"]]],
  ["memory", "mapmemory.js", "spec", [["easy", "g.lvl.easy"], ["medium", "g.lvl.medium"], ["hard", "g.lvl.hard"]]],
  ["contour", "contour.js", "spec"],
  ["updown", "updown.js", "spec"],
  ["matching", "matching.js", "spec"],
  ["spot", "spot.js", "spec"],
  ["coursechoice", "coursechoice.js", "spec"],
  ["gaffle", "coursechoice.js", "gaffleSpec"],
  ["forestroute", "forestroute.js", "spec"],
  ["photo", "photomemory.js", "spec"],
  ["trailo", "trailo.js", "spec"],
  ["maze", "maze.js", "spec", [["small", "g.lvl.small"], ["medium", "g.lvl.medium"], ["large", "g.lvl.large"]]],
  // « Quel poste ? » (2026-11-10): « Apprendre »'s training, no settings; Débutant (the quiz's groups) and Avancé (drawn at random)
  ["learntest", "learntest.js", "spec", [["beginner", "g.lvl.beginner"], ["advanced", "g.lvl.advanced"]]],
  // « Virtually » (2026-11-10): a virtual race in a 3D forest made from a real map, one level a race; administrators only for now.
  // Its module has its own `mount` (not the quiz engine).
  ["virtually", "virtually.js", "spec", [["granites", "g.virtually.granites"], ["foley", "g.virtually.foley"]], () => !!auth.session()?.admin],
];

export async function render(main, { query }) {
  const GAMES = ALL.filter((g) => !g[4] || g[4]());
  const tabs = GAMES.map(([k]) => [k, t(`g.${k}.tab`)]);
  // the page opens on its games as tiles, one a game (owner, 2026-10-31: every game in sight at once; on a computer too the
  // same day); a tile opens its game (?onglet=), the browser's back button comes back here
  if (!tabs.some(([k]) => k === query.onglet)) {
    main.innerHTML = html`<div class="mod-tiles-page" data-mod="coach">
      <div class="mod-tiles-head"><p>${t("g.lede")}</p></div>
      <div class="mod-tiles g-tiles">${tabs.map(([k, label]) => html`<a class="mod-tile g-tile" href="#/jeux?onglet=${k}"><b>${label}</b><span>${t(`g.${k}.desc`)}</span></a>`)}</div>
    </div>`;
    return { title: t("nav.games") };
  }
  const tab = tabFrom(tabs, query);
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.games")}</h1><p class="lede">${t("g.lede")}</p></div></div>
    ${pageTabs(tabs, tab)}
    ${GAMES.map(([k, , , levels]) => html`<div data-panel="${k}" class="g-panel" hidden>
      <div class="g-head"><p class="g-desc">${t(`g.${k}.desc`)}</p>
        ${levels ? html`<div class="seg g-levels" role="group">${levels.map(([lk, lab], i) => html`<button type="button" data-level="${lk}" aria-pressed="${i === 0}">${t(lab)}</button>`)}</div>` : ""}</div>
      <div class="g-root card"><div class="card-body" data-game="${k}"></div></div>
    </div>`)}`;
  const running = new Map();                      // game key -> {stop}
  const start = async (k, level) => {
    const [, file, name, levels] = GAMES.find((g) => g[0] === k);
    const root = $(`[data-game="${k}"]`, main);
    running.get(k)?.stop();
    root.innerHTML = html`<div class="boot"><div class="spinner"></div></div>`;
    try {
      const mod = await import(`../games/${file}`);
      if (!root.isConnected) return;
      if (mod.mount) { running.set(k, mod.mount(root, level ?? levels?.[0]?.[0])); return; }   // a game of its own (Virtually)
      const spec = mod[name](level ?? levels?.[0]?.[0]);
      const lv = levels?.find(([lk]) => lk === (level ?? levels[0][0]));
      spec.palmTitle = lv ? `${t(`g.${k}.tab`)} · ${t(lv[1])}` : t(`g.${k}.tab`);
      // « Quel poste ? »: its line of rules and its levels hidden while a run is under way (owner, 2026-11-10: no time to read
      // them, and the question needs the room)
      if (k === "learntest") {
        const head = $(".g-head", root.closest(".g-panel")), was = spec.onState;
        spec.onState = (st, ...a) => { if (head) head.hidden = st === "play"; was?.(st, ...a); };
      }
      running.set(k, runGame(root, spec));
      // a game whose pictures need credits (« Quel poste ? »'s photos) lists them under it
      if (mod.creditsHtml && !$(".lt-credits", root.closest(".g-panel"))) root.closest(".g-root").insertAdjacentHTML("afterend", mod.creditsHtml());
    } catch (e) {
      console.error(e);
      root.innerHTML = html`<div class="empty">${t("err.load")}<br><span class="muted">${String(e.message || e)}</span></div>`;
    }
  };
  $$(".g-levels button", main).forEach((b) => b.addEventListener("click", () => {
    const panel = b.closest("[data-panel]"), k = panel.dataset.panel;
    $$("button", b.parentElement).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    start(k, b.dataset.level);
  }));
  // the game's tab in sight in the row of twelve (a phone shows three or four)
  $('.page-tabs [aria-selected="true"]', main)?.scrollIntoView({ inline: "center", block: "nearest" });
  bindPageTabs(main, tabs, tab, (k) => { if (!running.has(k)) start(k, $(`[data-panel="${k}"] .g-levels [aria-pressed="true"]`, main)?.dataset.level); });
  return { title: t("nav.games"), cleanup: () => running.forEach((g) => g.stop()) };
}
