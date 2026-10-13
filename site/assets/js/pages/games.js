// « Jeux »: training games on generated maps, one tab each (after the games catalogued by O'Mate: Ben Brown's
// orienteering games and Rapid Route, Laby's maze). Nothing leaves the browser: the maps, the relief and the drawn
// photos are made here, from a seed. Administrators only for now (2026-10-13).

import { html, $, $$ } from "../util.js";
import { t } from "../i18n.js";
import { pageTabs, tabFrom, bindPageTabs } from "../ui.js";
import { runGame } from "../games/quiz.js";

// key, module, export name, levels [[key, label key]] (a level restarts the game with another spec)
const GAMES = [
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
];

export async function render(main, { query }) {
  const tabs = GAMES.map(([k]) => [k, t(`g.${k}.tab`)]);
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
      const spec = mod[name](level ?? levels?.[0]?.[0]);
      running.set(k, runGame(root, spec));
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
  bindPageTabs(main, tabs, tab, (k) => { if (!running.has(k)) start(k, $(`[data-panel="${k}"] .g-levels [aria-pressed="true"]`, main)?.dataset.level); });
  return { title: t("nav.games"), cleanup: () => running.forEach((g) => g.stop()) };
}
