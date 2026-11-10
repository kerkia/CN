// « Apprendre » (Coach; owner, 2026-11-10): « Définitions de postes » and « Symboles de carte » as one page, three views —
// the two pages of before (descriptions.js, mapkey.js, drawn in place with their own tabs Forêt / Sprint) and a test
// (games/learntest.js): a feature named, four control circles on the map, which one is it? The test's settings are the
// user's: how many questions, the time to answer each, what the question shows (the name, the description symbols, both),
// and for each question whether its wrong answers are the quiz's own (« Facile ») or drawn at random (« Aléatoire »); kept
// in the browser (`ocn.learn.test`). The view in the address (?vue=definitions|symboles|test; #/definitions and #/symboles,
// the addresses of before, open theirs).

import { html, raw, $, $$ } from "../util.js";
import { t, loadArea } from "../i18n.js";

const VIEWS = ["definitions", "symboles", "test"];
const KEY = "ocn.learn.test.v3";

/** The modules and data a view needs, asked for all at once (owner, 2026-11-10: the page took seconds, blank under its
 *  tabs — its files came one after the other, each found only once the one before was read: eight round trips). */
function warm(v) {
  // the symbols' file preloaded (it is read only once symbols.js has run, after the Tracer's catalogue), that catalogue asked now
  if (!document.querySelector('link[data-learn-pre]')) {
    document.head.insertAdjacentHTML("beforeend", '<link rel="preload" href="assets/tracer/symbols.json" as="fetch" crossorigin="anonymous" data-learn-pre>');
  }
  const common = () => [loadArea("tracer"), import("../tracer/lang.js"), import("../tracer/symbols.js").then((m) => m.loadSymbols()),
    import("../iscd.js"), import("../isom.js"), import("../cdsymbol.js")];
  const jobs = v === "symboles" ? [import("./mapkey.js"), import("../isom.js")]
    : v === "test" ? [...common(), import("../games/learntest.js"), import("../games/quiz.js"), import("../games/common.js"),
      import("../games/learnphotos.js")]
    : [...common(), import("./descriptions.js"), import("../tracer/textify.js")];
  jobs.forEach((p) => p.catch(() => {}));
}

async function view(el, v, query) {
  // a fresh box each time: the views bind their listeners to the element they are given; the spinner until it is drawn
  const box = document.createElement("div");
  box.innerHTML = html`<div class="boot"><div class="spinner"></div><p>${t("misc.loading")}</p></div>`;
  el.replaceChildren(box);
  warm(v);
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
  // the other views' files fetched once this one is drawn, so that a tab opens at once
  let shown = await view(el, v, query);
  setTimeout(() => VIEWS.filter((k) => k !== v).forEach(warm), 300);
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

/** The settings kept: {count, limit, show} (« ocn.learn.test.v2 » since the defaults became 20 questions of 10 s, owner,
 *  2026-11-10; the per-question choice of easy or random answers gone with them: every question is drawn at random; « .v3 »
 *  since the photo and the name are shown by default, the same day). */
function load(T) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { /* none kept */ }
  const count = Math.max(1, Math.min(T.MAX, Number(s.count) || T.DEFAULTS.count));
  const show = Array.isArray(s.show) ? T.SHOW.filter((x) => s.show.includes(x)) : [];
  return { count, limit: T.LIMITS.includes(Number(s.limit)) ? Number(s.limit) : T.DEFAULTS.limit, show: show.length ? show : T.DEFAULTS.show };
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* not kept then */ } }

async function testView(box) {
  box.innerHTML = html`<div class="boot"><div class="spinner"></div></div>`;
  const [T, { runGame }] = await Promise.all([import("../games/learntest.js"), import("../games/quiz.js")]);
  const s = load(T);
  // « Commencer », its rules and « Palmarès » first, the settings under them (owner, 2026-11-10)
  box.innerHTML = html`
    <div class="g-root card lt-game"><div class="card-body" id="lt-game"></div></div>
    <section class="card lt-set">
      <div class="card-head"><div><h2>${t("lt.set")}</h2></div></div>
      <div class="filters lt-fields">
        <label class="field"><span>${t("lt.count")}</span><input type="number" id="lt-count" min="1" max="${T.MAX}" step="1" value="${s.count}" inputmode="numeric"></label>
        <label class="field"><span>${t("lt.limit")}</span><select id="lt-limit">${T.LIMITS.map((x) => html`<option value="${x}" ${raw(x === s.limit ? "selected" : "")}>${t("lt.seconds", { n: x })}</option>`)}</select></label>
        <fieldset class="field lt-show"><legend>${t("lt.ask")}</legend><span class="lt-checks">${T.SHOW.map((x) => html`<label class="check"><input type="checkbox" data-show="${x}" ${raw(s.show.includes(x) ? "checked" : "")}> ${t(`lt.ask.${x}`)}</label>`)}</span></fieldset>
      </div>
      <p class="muted lt-modes-hint">${t("lt.show.hint", { n: T.PHOTO_KEYS.length, m: T.MAX })}</p>
    </section>
    ${T.creditsHtml()}`;
  let game = null;
  // the settings while a run is under way: out of sight, « Arrêter le test » on the puzzle's line brings them back
  const onState = (st) => { $(".lt-set", box).hidden = st === "play"; };
  const restart = () => {
    save(s);
    game?.stop();
    game = runGame($("#lt-game", box), T.testSpec({ count: s.count, limit: s.limit, show: s.show, mode: "groups",
      onState, onStop: () => restart() }));
  };
  restart();
  $("#lt-count", box).addEventListener("change", (e) => {
    s.count = Math.max(1, Math.min(T.MAX, Math.round(Number(e.target.value)) || T.DEFAULTS.count));
    e.target.value = s.count;
    restart();
  });
  $("#lt-limit", box).addEventListener("change", (e) => { s.limit = Number(e.target.value); restart(); });
  $$("[data-show]", box).forEach((c) => c.addEventListener("change", () => {
    const on = $$("[data-show]", box).filter((x) => x.checked).map((x) => x.dataset.show);
    if (!on.length) { c.checked = true; return; }          // one at least
    s.show = on; restart();
  }));
  return { title: t("nav.learn"), cleanup: () => game?.stop() };
}
