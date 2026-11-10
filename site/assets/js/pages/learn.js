// « Apprendre » (Coach; owner, 2026-11-10): « Définitions de postes » and « Symboles de carte » as one page, three views —
// the two pages of before (descriptions.js, mapkey.js, drawn in place with their own tabs Forêt / Sprint) and a test
// (games/learntest.js): a feature named, four control circles on the map, which one is it? The test's settings are the
// user's: how many questions, the time to answer each, what the question shows (the name, the description symbols, both),
// and for each question whether its wrong answers are the quiz's own (« Facile ») or drawn at random (« Aléatoire »); kept
// in the browser (`ocn.learn.test`). The view in the address (?vue=definitions|symboles|test; #/definitions and #/symboles,
// the addresses of before, open theirs).

import { html, raw, $, $$ } from "../util.js";
import { t } from "../i18n.js";

const VIEWS = ["definitions", "symboles", "test"];
const KEY = "ocn.learn.test";

async function view(el, v, query) {
  // a fresh box each time: the views bind their listeners to the element they are given
  const box = document.createElement("div");
  el.replaceChildren(box);
  if (v === "symboles") return (await import("./mapkey.js")).render(box, { query, embedded: true });
  if (v === "test") return testView(box);
  return (await import("./descriptions.js")).render(box, { query, embedded: true });
}

export async function render(main, { query = {}, path = "" }) {
  const head = path.split("/").filter(Boolean)[0];
  let v = VIEWS.includes(query.vue) ? query.vue : head === "symboles" ? "symboles" : "definitions";
  const label = (k) => (k === "definitions" ? t("nav.descriptions") : k === "symboles" ? t("nav.mapkey") : t("lt.tab"));
  const href = (k) => (k === "definitions" ? "#/apprendre" : `#/apprendre?vue=${k}`);
  // the address of before becomes the page's own
  if (head !== "apprendre") history.replaceState(null, "", `${href(v)}${query.onglet ? `${v === "definitions" ? "?" : "&"}onglet=${encodeURIComponent(query.onglet)}` : ""}`);
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.learn")}</h1><p class="lede">${t("lt.lede")}</p></div></div>
    <nav class="page-tabs learn-tabs" role="tablist">${VIEWS.map((k) => html`<button type="button" role="tab" data-lview="${k}" aria-selected="${k === v}">${label(k)}</button>`)}</nav>
    <div id="learn-view"></div>`;
  const el = $("#learn-view", main);
  let shown = await view(el, v, query);
  $$("[data-lview]", main).forEach((b) => b.addEventListener("click", async () => {
    const k = b.dataset.lview;
    if (k === v) return;
    v = k;
    $$("[data-lview]", main).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    shown?.cleanup?.();
    history.pushState(null, "", href(k));
    shown = await view(el, k, {});
  }));
  return { title: t("nav.learn"), cleanup: () => shown?.cleanup?.() };
}

/** The settings kept: {count, limit, show, modes}. */
function load(T) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { /* none kept */ }
  const count = Math.max(1, Math.min(T.MAX, Number(s.count) || 10));
  const modes = Array.from({ length: T.MAX }, (_, i) => (s.modes?.[i] === "random" ? "random" : "easy"));
  // what a question shows: the photo by default (owner, 2026-11-10)
  const show = Array.isArray(s.show) ? T.SHOW.filter((x) => s.show.includes(x)) : [];
  return { count, limit: T.LIMITS.includes(Number(s.limit)) ? Number(s.limit) : 20, show: show.length ? show : ["photo"], modes };
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* not kept then */ } }

async function testView(box) {
  box.innerHTML = html`<div class="boot"><div class="spinner"></div></div>`;
  const [T, { runGame }] = await Promise.all([import("../games/learntest.js"), import("../games/quiz.js")]);
  const s = load(T);
  box.innerHTML = html`
    <p class="lede learn-lede">${t("lt.test.lede")}</p>
    <section class="card lt-set">
      <div class="card-head"><div><h2>${t("lt.set")}</h2><div class="hint">${t("lt.set.hint")}</div></div></div>
      <div class="filters lt-fields">
        <label class="field"><span>${t("lt.count")}</span><input type="number" id="lt-count" min="1" max="${T.MAX}" step="1" value="${s.count}" inputmode="numeric"></label>
        <label class="field"><span>${t("lt.limit")}</span><select id="lt-limit">${T.LIMITS.map((x) => html`<option value="${x}" ${raw(x === s.limit ? "selected" : "")}>${t("lt.seconds", { n: x })}</option>`)}</select></label>
        <fieldset class="field lt-show"><legend>${t("lt.ask")}</legend><span class="lt-checks">${T.SHOW.map((x) => html`<label class="check"><input type="checkbox" data-show="${x}" ${raw(s.show.includes(x) ? "checked" : "")}> ${t(`lt.ask.${x}`)}</label>`)}</span></fieldset>
      </div>
      <p class="muted lt-modes-hint">${t("lt.show.hint", { n: T.PHOTO_KEYS.length, m: T.MAX })}</p>
      <div class="lt-modes-head"><b>${t("lt.modes")}</b>
        <span class="lt-all"><button type="button" class="btn btn-sm" data-all="easy">${t("lt.all.easy")}</button>
          <button type="button" class="btn btn-sm" data-all="random">${t("lt.all.random")}</button>
          <button type="button" class="btn btn-sm" data-all="mix">${t("lt.all.mix")}</button></span></div>
      <p class="muted lt-modes-hint">${t("lt.modes.hint")}</p>
      <ol class="lt-modes" id="lt-modes"></ol>
    </section>
    <div class="g-root card lt-game"><div class="card-body" id="lt-game"></div></div>
    ${T.creditsHtml()}`;
  let game = null;
  // the settings and the lede while a run is under way: out of sight, « Arrêter le test » on the puzzle's line brings them
  // back (owner, 2026-11-10)
  const onState = (st) => {
    const run = st === "play";
    $(".lt-set", box).hidden = run;
    $(".learn-lede", box).hidden = run;
  };
  const drawModes = () => {
    $("#lt-modes", box).innerHTML = s.modes.slice(0, s.count).map((m, i) => html`<li><span class="lt-qn">${t("lt.q", { n: i + 1 })}</span>
      <span class="seg lt-seg" role="group">${["easy", "random"].map((x) => html`<button type="button" data-q="${i}" data-mode="${x}" aria-pressed="${m === x}">${t(`lt.mode.${x}`)}</button>`)}</span></li>`).join("");
  };
  const restart = () => {
    save(s);
    game?.stop();
    game = runGame($("#lt-game", box), T.testSpec({ count: s.count, limit: s.limit, show: s.show, modes: s.modes.slice(0, s.count),
      key: `learntest:${s.count}:${s.limit}:${s.show.join("+")}`, onState, onStop: () => restart() }));
  };
  drawModes();
  restart();
  $("#lt-count", box).addEventListener("change", (e) => {
    s.count = Math.max(1, Math.min(T.MAX, Math.round(Number(e.target.value)) || 10));
    e.target.value = s.count;
    drawModes(); restart();
  });
  $("#lt-limit", box).addEventListener("change", (e) => { s.limit = Number(e.target.value); restart(); });
  $$("[data-show]", box).forEach((c) => c.addEventListener("change", () => {
    const on = $$("[data-show]", box).filter((x) => x.checked).map((x) => x.dataset.show);
    if (!on.length) { c.checked = true; return; }          // one at least
    s.show = on; restart();
  }));
  $("#lt-modes", box).addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    s.modes[+b.dataset.q] = b.dataset.mode;
    $$(`[data-q="${b.dataset.q}"]`, box).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    restart();
  });
  $$("[data-all]", box).forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.all;
    s.modes = s.modes.map(() => (k === "mix" ? (Math.random() < 0.5 ? "easy" : "random") : k));
    drawModes(); restart();
  }));
  return { title: t("nav.learn"), cleanup: () => game?.stop() };
}
