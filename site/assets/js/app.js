// Application shell: router (with the login gate), header (navigation,
// discipline selector, search, the logged-in user, the number of runners being compared).

import { html, raw, $, $$, esc, fmt, fmtDate, normalise, displayName, nameParts, debounce, fmtCat } from "./util.js";
import { t, lang, setLang, OPEN, LANGS, LANG_NAMES, setDefaults } from "./i18n.js";
import * as store from "./store.js";
import * as data from "./data.js";
import { disposeAll } from "./charts.js";
import { methodSwitch, cnWords } from "./ui.js";
import * as auth from "./auth.js";
import * as bridge from "./bridge.js";
import * as pwa from "./pwa.js";
import * as country from "./country.js";
import { watchTables } from "./fit.js";

export const SITE = "Ozimut";

const PAGES = {
  ranking: () => import("./pages/ranking.js"),
  categories: () => import("./pages/categories.js"),   // « Catégories »: each class's CN spread and its standouts (2026-10-18)
  runner: () => import("./pages/runner.js"),
  compare: () => import("./pages/compare.js"),
  clubs: () => import("./pages/clubs.js"),
  club: () => import("./pages/clubs.js"),           // a club's page: a view of the Clubs page (owner, 2026-10-14)
  overview: () => import("./pages/overview.js"),
  methods: () => import("./pages/methods.js"),
  clubcompare: () => import("./pages/clubs.js"),      // a view of the Clubs page
  network: () => import("./pages/network.js"),
  courses: () => import("./pages/courses.js"),
  agenda: () => import("./pages/agenda.js"),
  account: () => import("./pages/account.js"),      // public: sign-up, confirmation, password reset, privacy
  settings: () => import("./pages/settings.js"),
  contact: () => import("./pages/contact.js"),
  admin: () => import("./pages/admin.js"),
  provisional: () => import("./pages/provisional.js"),   // « Résultats »: the organisers' results of the last 60 days
  splits: () => import("./pages/splits.js"),        // « Analyse de course »: the races with split times, then one's analysis (2026-10-23)
  live: () => import("./pages/live.js"),           // « En direct »: live results
  deposit: () => import("./pages/deposit.js"),     // « Déposer »: a results file read in the browser, then published
  analysis: () => import("./pages/analysis.js"),   // « Analyse solo » (Courses): a GPS trace on one's map, a race's
  analysisPerso: () => import("./pages/analysis.js"),   // « Analyse solo » (Entrainement): the same page, no race
  analysisClub: () => import("./pages/shared.js"),      // « Analyse club » (Entrainement): an organiser's circuits, the runners' traces compared
  analysisRace: () => import("./pages/shared.js"),      // « Analyse multi » (Courses): the same for a race of « Résultats »
  // « Organisation » (2026-10-15): the organisers' pages — a competition's multi analysis, a training event's, the results
  orgRace: () => import("./pages/shared.js"),
  orgTraining: () => import("./pages/shared.js"),
  orgResults: () => import("./pages/orgresults.js"),
  orgStarts: () => import("./pages/orgstarts.js"),    // « Horaires »: an organiser publishes a coming race's start list (2026-10-18)
  orgDirect: () => import("./pages/orgdirect.js"),    // « Direct »: an organiser feeds « En direct » from their timing software
  orgTracer: () => import("./pages/tracer.js"),
  hub: () => import("./pages/hub.js"),             // the modules page: where one lands, the logo's address (2026-10-30)
  orgaOff: () => import("./pages/hub.js"),         // an Orga page to an account that has not turned the module on, or on a phone
  needCountry: () => import("./pages/needcountry.js"),   // a page of France's data, to an account without France (2026-10-20)       // « Tracer »: course setting in the browser, Purple Pen's way (2026-10-15)
  relays: () => import("./pages/clubs.js"),        // « Relais »: the relay simulator, a view of the Clubs page
  relayHistory: () => import("./pages/relayhistory.js"),   // « Relais nationaux »: the CFC's and the CNE's history (2026-10-26)
  games: () => import("./pages/games.js"),         // « Jeux »: training games on generated maps
  vma: () => import("./pages/vma.js"),
  descriptions: () => import("./pages/descriptions.js"),   // « Définitions de postes » (Coach): the IOF symbols (2026-10-30)             // « VMA »: the tests, a demi-Cooper / Cooper calculator, the apps (« Entrainement »)
  ask: () => import("./pages/ask.js"),             // « IA »: a question answered by a query an AI writes and the browser runs
};

// Pages without the runner search of the header: it leads away from what they show.
// Pages with the runner search, at the right end of their tab row (owner, 2026-10-12): where picking a runner leads
// somewhere (the Classement scrolls to them); the other pages have none.
const SEARCH_IN_TABS = new Set(["runner", "ranking", "compare"]);
// Lean pages (owner, 2026-10-12): where the title only repeats the menu, the page starts with its tabs; its text is the
// tooltip of its name in the second row (NAV_HINT), its buttons go to the right of the tab row. The runner's, a club's
// or a race's name stays as a title, and the pages outside the menu keep theirs.
const NAV_HINT = { runner: "rn.lede.nav", ranking: "rk.lede", categories: "cg.lede", relayHistory: "rh.lede", courses: "cs.lede", compare: "cp.lede", clubs: "cl.lede", network: "nw.lede.nav",
  agenda: "ag.lede.nav", provisional: "prov.lede", live: "lv.lede", splits: "ra.lede", analysis: "an.lede", games: "g.lede", vma: "vma.lede",
  analysisPerso: "an.perso.lede", analysisClub: "sh.club.lede", analysisRace: "sh.race.lede",
  orgRace: "sh.org.race.lede", orgTraining: "sh.org.club.lede", orgResults: "or.lede", orgStarts: "os.hint", orgTracer: "nav.orgTracer.hint" };
// the tools still in beta (beta.js; owner, 2026-10-16): a small « bêta » after their name in the menus
// The pages of a country's ranked data (owner, 2026-10-20; by country since 2026-10-22): the rankings and everything they
// hold, and « IA ». They show the site's country's (data.js reads its folder); an account that may not read it (France:
// not a member) or a country the site does not rank yet gets « needCountry » instead (the login gate refuses the data
// anyway: _middleware.js `needs`).
const FR_ROUTES = new Set(["runner", "ranking", "categories", "courses", "compare", "clubs", "club", "clubcompare", "relays", "network",
  "relayHistory", "ask"]);
// the ranking pages a public copy serves (data.js): the runner, the ranking, the races (owner, 2026-10-30)
const PUBLIC_STATS = new Set(["runner", "ranking", "courses"]);
/** May the account open the site's country's ranking pages? */
const ranksHere = () => country.ranks() && auth.sees(country.current());
/** Where a signed-in account or a visitor without one lands: the modules page (owner, 2026-10-30; the agenda from 2026-10-21). */
const homeOf = () => "#/modules";
// The pages a visitor without an account may open (owner, 2026-10-30): those of public data — Arena, Coach but « Analyse
// multi » (a trace is shared by an account), Stats' runner, ranking and races over the period the federation publishes
// openly — and the pages outside the modules (the home page, the documentation, the rules, « Nous écrire »).
const GUEST_ROUTES = new Set(["overview", "account", "hub", "methods", "contact", "agenda", "provisional", "live", "splits",
  "analysis", "analysisPerso", "descriptions", "games", "vma", "runner", "ranking", "courses", "needCountry"]);
const BETA_ROUTES = new Set(["analysisClub", "analysisRace", "orgRace", "orgTraining", "orgDirect", "orgTracer"]);
const betaMark = (k) => (BETA_ROUTES.has(k) ? raw(`<sup class="nav-beta" title="${t("beta.mark.tip")}">${t("beta.mark")}</sup>`) : "");
const isLean = (r) => ["ranking", "categories", "relayHistory", "courses", "compare", "clubs", "club", "clubcompare", "relays", "network", "agenda", "analysis", "analysisPerso", "games", "vma"].includes(r.route)
  || (r.route === "provisional" && !r.query.course) || (r.route === "splits" && !r.query.course) || (r.route === "live" && !r.arg) || ((r.route === "analysisClub" || r.route === "analysisRace") && !r.query.id)
  || ((r.route === "orgRace" || r.route === "orgTraining") && !r.query.id) || r.route === "orgResults" || (r.route === "orgStarts" && !r.query.course);
// Réseau views that count every discipline together by default (all but the leaders, who are
// ranked by a CN): there the switch also offers "Toutes", and its choice lives in the address
// (?t=For|Spr|VTT|Ski, none = all). Around one runner = a runner in the address, or the last one seen.
const ALL_TERRAIN_VIEWS = new Set(["stats", "territoires", "ages", "activite"]);     // ages, activite: old links to stats
const allowsAllTerrains = (r) => r.route === "network" && ALL_TERRAIN_VIEWS.has(r.query.vue);
/** The discipline of such a view: "For", "Spr", "VTT", "Ski", or "" for all of them. */
export const viewTerrain = (query) => (store.TERRAINS.includes(query.t) ? query.t : "");

function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  const parts = path.split("/").filter(Boolean);
  const [head, arg] = parts;
  const route =
    !head ? "overview"
    : head === "classement" ? "ranking"
    : head === "categories" ? "categories"
    : head === "coureur" ? "runner"
    : head === "progression" ? "runner"        // merged into the runner page
    : head === "comparer" ? "compare"
    : head === "course" ? "courses"          // old competition links open the Courses tab
    : head === "courses" ? "courses"
    : head === "agenda" ? "agenda"
    : head === "clubs" ? "clubs"
    : head === "club" ? "club"
    : head === "apercu" ? "overview"
    : head === "documentation" || head === "methodes" ? "methods"   // (« methodes » until 2026-10-24: old links)
    : head === "comparer-clubs" ? "clubcompare"
    : head === "reseau" ? "network"
    : head === "compte" ? "account"
    : head === "reglages" ? "settings"
    : head === "contact" ? "contact"
    : head === "admin" ? "admin"
    : head === "resultats" || head === "recemment" || head === "provisoires" ? "provisional"     // #/recemment, #/provisoires: old addresses
    : head === "analyse-course" || head === "temps-inter" ? "splits"     // « Analyse de course » (« Temps intermédiaires » until 2026-10-23)
    : head === "direct" ? "live"
    : head === "deposer" ? "deposit"
    : head === "analyse" ? "analysis"
    : head === "analyse-solo" || head === "analyse-perso" ? "analysisPerso"     // « Analyse solo » (« Analyse perso » until 2026-10-15)
    : head === "orga-competitions" ? "orgRace" : head === "orga-entrainements" ? "orgTraining" : head === "orga-resultats" ? "orgResults" : head === "orga-horaires" ? "orgStarts" : head === "orga-direct" ? "orgDirect" : head === "orga-tracer" ? "orgTracer"
    : head === "analyse-club" ? "analysisClub"
    : head === "analyse-competition" ? "analysisRace"
    : head === "relais" ? "relays"
    : head === "relais-nationaux" ? "relayHistory"
    : head === "jeux" ? "games"
    : head === "vma" ? "vma"
    : head === "ia" ? "ask"
    : head === "modules" ? "hub"
    : head === "definitions" ? "descriptions"
    : "overview";
  return { route, arg: arg ? decodeURIComponent(arg) : null, query, path };
}

export const link = {
  home: () => "#/",
  ranking: (q) => "#/classement" + qstr(q),
  // a runner of the loaded country (their number in its files); the address names the country: #/coureur/fr1234567
  runner: (lic, q) => (lic ? `#/coureur/${encodeURIComponent(data.parseId(lic) && /^[a-z]{2}\d/i.test(lic) ? lic : data.fullId(lic))}` : "#/coureur") + qstr(q),
  compare: () => "#/comparer",
  /** A race in the Courses tab; q may add circ, mode, r, club. */
  course: (id, q) => "#/courses" + qstr({ id, t: data.comp(id)?.terrain, ...q }),   // t: the race's discipline
  courses: (q) => "#/courses" + qstr(q),
  club: (code) => `#/club/${encodeURIComponent(code)}`,
  clubs: () => "#/clubs",
  clubCompare: () => "#/comparer-clubs",
  relays: (q) => "#/relais" + qstr(q),
  progression: (lic, q) => link.runner(lic, q),
  // a runner's network: the « Réseau » tab of their page; without a runner, the best runners' network
  network: (lic, q) => (lic ? link.runner(lic, { ...q, onglet: "reseau" }) : "#/reseau" + qstr({ ...q, vue: "meilleurs" })),
  networkLeaders: (q) => "#/reseau" + qstr({ ...q, vue: "meilleurs" }),
  territories: (q) => "#/reseau" + qstr({ ...q, vue: "territoires" }),
  stats: (q) => "#/reseau" + qstr({ ...q, vue: "stats" }),
  ages: (q) => "#/reseau" + qstr({ ...q, vue: "ages" }),
};
function qstr(q) {
  if (!q) return "";
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "")).toString();
  return s ? "?" + s : "";
}

/** Update the URL's query for the current page without re-rendering it. */
let silent = false;
export function replaceQuery(q) {
  const { path, query } = parseHash();
  // the tab shown (ui.pageTabs: ?onglet=) stays unless the page says otherwise; so does a page opened alone (fullwin: ?fen=1)
  if (query.onglet && q && !("onglet" in q)) q = { ...q, onglet: query.onglet };
  if (query.fen && q && !("fen" in q)) q = { ...q, fen: query.fen };
  const next = "#" + (path || "/") + qstr(q);
  if (location.hash !== next) {
    silent = true;
    history.replaceState(null, "", next);
    silent = false;
  }
}

// ---- the discipline -------------------------------------------------------
/**
 * The discipline selector, drawn by each page among its filters. One choice for the whole site
 * (store.terrain), except in the views that also offer "Toutes", where it lives in the address.
 */
export function terrainField() {
  const r = parseHash(), all = allowsAllTerrains(r);
  const v = all ? viewTerrain(r.query) || "all" : store.get().terrain;
  return html`<label class="field"><span>${t("f.terrain")}</span>
    <select id="terrain-select" class="terrain-select" aria-label="${t("f.terrain")}">
      ${all ? html`<option value="all" ${raw(v === "all" ? "selected" : "")}>${t("f.all")}</option>` : ""}
      ${store.TERRAINS.map((x) => html`<option value="${x}" ${raw(v === x ? "selected" : "")}>${t(`terrain.${x}`)}</option>`)}
    </select></label>`;
}
/** The same choice as buttons, for a section's head (at its right, as the runner's « Historique des courses »). */
export function terrainSeg() {
  const r = parseHash(), all = allowsAllTerrains(r);
  const v = all ? viewTerrain(r.query) || "all" : store.get().terrain;
  return html`<div class="seg" role="group" aria-label="${t("f.terrain")}">${[...(all ? [["all", t("f.all")]] : []),
    ...store.TERRAINS.map((x) => [x, t(`terrain.${x}`)])].map(([x, label]) => html`<button type="button" data-terrain-pick="${x}"
      aria-pressed="${x === v}">${label}</button>`)}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-terrain-pick]");
  if (b) pickTerrain(b.dataset.terrainPick);
});
// changing it re-renders the current page
document.addEventListener("change", (e) => {
  if (e.target.id === "terrain-select") pickTerrain(e.target.value);
});
function pickTerrain(v) {
  const now = parseHash(), { query } = now;
  if (store.TERRAINS.includes(v)) store.set({ terrain: v });
  if (allowsAllTerrains(now)) replaceQuery({ ...query, t: v === "all" ? null : v });
  else if (query.t) { delete query.t; replaceQuery(query); }
  route_();
}

// ---- header -------------------------------------------------------------
let menusBound = false;
// The themes, from the lightest to the darkest (owner, 2026-10-13): the ground of each and one colour of its own
// (Jour the forest green, Clairière the open-land yellow, Forêt a light green, Sous-bois the contour brown, Nuit the
// water blue), for the swatches of the menu; the tokens are in app.css. index.html applies the saved one before the
// first paint.
const THEMES = [["light", "#f9f9f7", "#2f8a3e"], ["clearing", "#f6efd4", "#e0a92e"], ["forest", "#dcefcd", "#23793a"],
  ["undergrowth", "#0b1d10", "#d38d58"], ["dark", "#0d0d0d", "#55b5e8"]];

function themeMenu() {
  const cur = document.documentElement.dataset.theme || "light";
  return html`<div class="nav-group theme-menu" data-group="theme">
    <button class="icon-btn nav-top" type="button" id="theme-btn" aria-expanded="false" aria-haspopup="menu" title="${t("theme.toggle")}" aria-label="${t("theme.toggle")}">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    </button>
    <div class="nav-menu" role="menu">${THEMES.map(([k, ground, mark]) => html`<button type="button" role="menuitemradio" aria-checked="${String(k === cur)}" data-theme-pick="${k}"><i class="swatch" style="background: linear-gradient(135deg, ${ground} 58%, ${mark} 58%)"></i>${t("theme." + k)}</button>`)}</div>
  </div>`;
}

/** The language, beside the theme for everyone (owner, 2026-10-18: the home page and the registration included): the
 *  current one's code, a menu of each language in its own name. A choice is kept on this device and, signed in, on the
 *  account (its e-mails follow), then the page is drawn again in it. */
function langMenu() {
  return html`<div class="nav-group lang-menu" data-group="lang">
    <button class="icon-btn nav-top" type="button" id="lang-btn" aria-expanded="false" aria-haspopup="menu" title="${t("st.lang")}" aria-label="${t("st.lang")}">
      <span class="tool-label" aria-hidden="true">${t("st.lang")}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>
      <span class="lang-code">${lang().toUpperCase()}</span>
    </button>
    <div class="nav-menu" role="menu">${LANGS.map((l) => html`<button type="button" role="menuitemradio" aria-checked="${String(l === lang())}" data-lang-pick="${l}" lang="${l}">${LANG_NAMES[l]}</button>`)}</div>
  </div>`;
}

/** The relief behind the second row (owner, 2026-10-13, as on the study's page): a few hills, their contour lines
 *  drawn by marching squares in the map's brown, an index contour every fifth line. Redrawn when the bar is, and on resize. */
function drawContours(retry = 2) {
  const c = $("#contours");
  if (!c) return;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) {                 // not laid out yet: once more on the next frame
    if (retry) requestAnimationFrame(() => drawContours(retry - 1));
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const R = Math.max(200, w * 0.15);
  // hills: x (share of the width), y (share of the height; most sit above or below the row, whose band crosses their
  // flanks), radius (share of R), height
  const hills = [[0.05, 1.5, 1.0, 1.0], [0.2, -0.5, 0.8, 0.85], [0.37, 1.4, 1.1, 0.9], [0.52, -0.3, 0.9, 0.75],
    [0.68, 1.6, 0.9, 1.0], [0.84, -0.5, 0.85, 0.9], [0.97, 1.2, 0.7, 0.8], [0.3, 0.5, 0.45, 0.3], [0.76, 0.5, 0.4, 0.25]];
  const f = (x, y) => {
    let v = 0;
    for (const [hx, hy, r, a] of hills) {
      const dx = (x - hx * w) / (r * R), dy = (y - hy * h) / (r * R * 0.5);
      v += a * Math.exp(-(dx * dx + dy * dy));
    }
    return v + 0.02 * Math.sin(x / 43) * Math.cos(y / 17);
  };
  const st = 4, nx = Math.ceil(w / st) + 1, ny = Math.ceil(h / st) + 1;
  const V = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = f(i * st, j * st);
    V[j * nx + i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const SEG = { 1: [["L", "B"]], 2: [["B", "R"]], 3: [["L", "R"]], 4: [["T", "R"]], 5: [["T", "R"], ["L", "B"]], 6: [["T", "B"]], 7: [["T", "L"]],
    8: [["T", "L"]], 9: [["T", "B"]], 10: [["T", "L"], ["R", "B"]], 11: [["T", "R"]], 12: [["L", "R"]], 13: [["R", "B"]], 14: [["L", "B"]] };
  const lines = Math.max(6, Math.round(h / 6)), step = (hi - lo) / (lines + 1);
  const col = getComputedStyle(document.documentElement).getPropertyValue("--contour").trim();
  for (let n = 1; n <= lines; n++) {
    const L = lo + n * step;
    g.beginPath();
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = V[j * nx + i], b = V[j * nx + i + 1], cc = V[(j + 1) * nx + i + 1], d = V[(j + 1) * nx + i];
      const segs = SEG[(a > L ? 8 : 0) | (b > L ? 4 : 0) | (cc > L ? 2 : 0) | (d > L ? 1 : 0)];
      if (!segs) continue;
      const x0 = i * st, y0 = j * st;
      const P = { T: [x0 + st * (L - a) / (b - a), y0], R: [x0 + st, y0 + st * (L - b) / (cc - b)],
        B: [x0 + st * (L - d) / (cc - d), y0 + st], L: [x0, y0 + st * (L - a) / (d - a)] };
      for (const [p, q] of segs) { g.moveTo(P[p][0], P[p][1]); g.lineTo(P[q][0], P[q][1]); }
    }
    g.strokeStyle = col;
    g.globalAlpha = n % 5 === 0 ? 0.68 : 0.45;
    g.lineWidth = n % 5 === 0 ? 1.7 : 1;
    g.stroke();
  }
  g.globalAlpha = 1;
}
let contoursBound = false;

/** The menu entry a route belongs to; a page shown in another's place (the join-France page) keeps that page's (r.from). */
function menuKey(r) {
  const at = r.from || r.route;
  return at === "course" ? "courses" : at === "club" || at === "clubcompare" || at === "relays" ? "clubs"
    : at === "splits" && r.query?.course === "fichier" ? "orgResults"          // a file under deposit: the organisers'
    : at === "provisional" || at === "splits" ? "agenda"                       // Arena's competitions page and a race's
    : at === "analysis" ? "analysisPerso" : at === "analysisRace" ? "analysisClub"   // Coach's analyses: one page each, two tabs
    : at;
}

/** The site's country chosen (the header's menu, a page's « Choisir un autre pays »): the page drawn again for it. */
function pickCountry(cc) {
  if (!cc || cc === country.current()) return;
  country.pick(cc);
  lastRoute = null;             // a page that follows its address (the Agenda) is built again, not just told its query
  // a runner named in the address is the other country's: the runner page opens on this country's own (store.useCountry)
  if (parseHash().route === "runner" && parseHash().arg) history.replaceState(null, "", "#/coureur");
  data.useCountry(country.current()).then(() => { renderFooter(); route_(); });
}
// ---- the modules (owner, 2026-10-30) ----------------------------------------------------------------------------------
// Ozimut is four modules — Arena (the competitions: coming, live, run), Stats (the rankings and their analyses), Coach
// (training: the GPS analyses, the control descriptions, the games, the VMA) and Orga (the organisers' tools) —, each with
// its own menu in the bar. The modules page (#/modules, pages/hub.js) is where one lands, signed in or not, and the logo
// leads back to it: a module's pages never lead into another module's (an e-mail's or a notification's link goes straight
// to its page).
export const MODULES = ["arena", "stats", "coach", "orga"];
/** A phone (the same test as index.html's default theme): the Orga module is for computers. */
export const isPhone = () => matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
/** May this visitor open the Orga module here? A signed-in account that turned it on (Réglages, the modules page), not on a phone. */
export const orgaOpen = () => !!auth.session()?.orga && !isPhone();
/** Each module's menu: [key, address, label]; the key is the route's (menuKey). */
export function moduleMenus() {
  const me = auth.session();
  return {
    // the competitions (the Agenda and « Résultats » as one page's two tabs, a race's results and analysis), and « En direct »
    arena: [["agenda", "#/agenda", t("nav.arena.comps")], ["live", "#/direct", t("nav.live")]],
    stats: [
      // one's own page, in France's data (the runner page of one's licence)
      ...(me?.lic && country.current() === "FR" && ranksHere() ? [["me", link.runner(`fr${me.lic}`), t("auth.myPage")]] : []),
      ...[["runner", "#/coureur", t("nav.runner")], ["ranking", "#/classement", t("nav.ranking")], ["categories", "#/categories", t("nav.categories")],
        ["courses", "#/courses", t("nav.coursesCn")], ["compare", "#/comparer", t("nav.compare")], ["clubs", "#/clubs", t("nav.clubs")],
        ["relayHistory", "#/relais-nationaux", t("nav.relayHistory")], ["network", "#/reseau", t("nav.network")],
        // « IA » (2026-10-15): France's tables only (/api/ask is France's, _middleware.js FR_API)
        ...(country.current() === "FR" ? [["ask", "#/ia", t("nav.ask")]] : []),
      // without the country's data (no account, or the country not joined): the pages its public copy serves
      ].filter(([k]) => auth.sees(country.current()) || PUBLIC_STATS.has(k)),
    ],
    // the two analyses each one page, its tabs a competition or a training (coachtabs.js); « Analyse multi » needs an account
    coach: [["analysisPerso", "#/analyse-solo", t("nav.analysisPerso")], ...(me ? [["analysisClub", "#/analyse-competition", t("nav.analysisClub")]] : []),
      ["descriptions", "#/definitions", t("nav.descriptions")], ["games", "#/jeux", t("nav.games")], ["vma", "#/vma", t("nav.vma")]],
    orga: [["orgRace", "#/orga-competitions", t("nav.orgRace")], ["orgTraining", "#/orga-entrainements", t("nav.orgTraining")],
      ["orgResults", "#/orga-resultats", t("nav.orgResults")], ["orgStarts", "#/orga-horaires", t("nav.orgStarts")],
      ["orgDirect", "#/orga-direct", t("nav.orgDirect")], ["orgTracer", "#/orga-tracer", t("nav.orgTracer")]],
  };
}
// the routes outside the menus, by module (a view of a page in the menu, an address of before)
const ROUTE_MODULE = { club: "stats", clubcompare: "stats", relays: "stats", ask: "stats", deposit: "orga" };
/** The module a page belongs to, or null (the modules page, the documentation, the settings…). */
export function moduleOf(r) {
  const k = menuKey(r);
  const menus = moduleMenus();
  for (const m of MODULES) if (menus[m].some(([key]) => key === k)) return m;
  return ROUTE_MODULE[r.from || r.route] || null;
}
/** The module last opened in this tab: the pages that belong to none (Réglages, Documentation…) keep its menu. */
function lastModule(m) {
  try {
    if (m) sessionStorage.setItem("ocn.module", m);
    return sessionStorage.getItem("ocn.module") || null;
  } catch (e) { return m || null; }
}

function renderHeader(r) {
  const { route } = r;
  const me = auth.session(), visitor = me || auth.guest();
  const fr = country.ranks();         // the site's country's rankings (its public copy included): the method switch
  // the module shown: the page's, else the one last opened (a page of no module: Réglages, Documentation…); none on the
  // modules page and the home page
  const own = visitor && route !== "orgaOff" ? moduleOf(r) : null;
  const mod = own ? lastModule(own) : visitor && !["hub", "overview", "account", "orgaOff"].includes(route) ? lastModule() : null;
  // the home page (no visitor yet): its sections — the four modules, who sees what — in the bar (owner, 2026-10-30)
  const items = mod ? moduleMenus()[mod] : !visitor && route === "overview"
    ? [...MODULES.map((m) => [`home-${m}`, `#/?s=${m}`, t(`mod.${m}`)]), ["home-features", "#/?s=features", t("tour.feat.eyebrow")]] : [];
  const current = menuKey(r) === "runner" && me?.lic && [me.lic, `fr${me.lic}`].includes(r.arg) ? "me" : menuKey(r);
  document.body.dataset.group = mod || "";
  const caret = raw(`<svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  const navLink = ([k, href, text]) => html`<a class="nav-link" href="${href}" ${raw(k === current ? 'aria-current="page"' : "")} title="${NAV_HINT[k] ? t(NAV_HINT[k]) : ""}">${text}${betaMark(k)}</a>`;

  $("#topbar").innerHTML = html`<div class="topbar-inner${visitor ? "" : " guest"}">
    ${items.length ? html`<button class="icon-btn menu-btn" type="button" aria-label="Menu" id="menu-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>` : ""}
    <a class="brand" href="${visitor ? homeOf() : "#/"}" title="${visitor ? t("mod.back") : ""}">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <!-- a compass bezel, the control flag's two quarters as its needle on a bearing of 45° (owner, 2026-10-19) -->
        <path d="M16 8 L24 16 L16 16 Z" fill="#e8641c"/><path d="M8 16 L16 24 L16 16 Z" fill="currentColor"/><circle cx="16" cy="16" r="13.7" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16 3.4 V5.6 M28.6 16 H26.4 M16 28.6 V26.4 M3.4 16 H5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="brand-name"><span class="brand-o">O</span>zimut</span>${mod ? html`<span class="brand-mod">${t(`mod.${mod}`)}</span>` : ""}
    </a>
    ${items.length ? html`<nav class="nav mod-nav" id="nav" aria-label="${t(`mod.${mod}`)}">${items.map(navLink)}</nav>` : ""}
    <div class="topbar-tools">
      ${visitor ? country.menu() : ""}
      ${OPEN || me?.admin ? langMenu() : ""}
      ${themeMenu()}
      ${me ? html`
      <div class="nav-group user-menu" data-group="me">
        <button type="button" class="nav-top user-btn" aria-expanded="false" aria-label="${t("auth.menu")}"
          ${raw(["methods", "settings", "contact", "admin"].includes(route) ? 'aria-current="true"' : "")}>
          <span class="user-name">${(({ first, last }) => html`<span>${first}</span>${last ? html`<span>${last}</span>` : ""}`)(nameParts(me.nom))}</span>
          <svg class="user-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>${caret}</button>
        <div class="nav-menu">
          <a href="${homeOf()}" ${raw(route === "hub" ? 'aria-current="page"' : "")}>${t("mod.pick")}</a>
          <a href="#/documentation" ${raw(route === "methods" ? 'aria-current="page"' : "")}>${t("nav.docs")}</a>
          <a href="#/reglages" ${raw(route === "settings" ? 'aria-current="page"' : "")}>${t("st.link")}</a>
          ${me.demo ? "" : html`<button type="button" id="install-btn" ${raw(pwa.installState() === "ready" ? "" : "hidden")}>${t("pwa.menu")}</button>`}
          <a href="#/contact?${new URLSearchParams({ from: location.hash || "#/" })}" ${raw(route === "contact" ? 'aria-current="page"' : "")}>${t("ct.link.menu")}</a>
          ${me.admin ? html`<a href="#/admin" ${raw(route === "admin" ? 'aria-current="page"' : "")}>${t("admin.link")}</a>` : ""}
          <button type="button" id="logout-btn">${t("auth.logout")}</button>
        </div>
      </div>` : visitor ? html`<a class="btn btn-sm btn-primary guest-login" href="#/?s=login">${t("hub.login")}</a>`
        // signed out: sign in, create an account, or enter without one (owner, 2026-10-30)
        : html`<div class="home-ways"><a class="btn btn-sm" href="#/?s=login">${t("hub.login")}</a>
          <a class="btn btn-sm home-way-reg" href="#/compte/inscription">${t("hub.register")}</a>
          <button type="button" class="btn btn-sm btn-primary" data-guest-enter="">${t("hub.guest.enter")}</button></div>`}
    </div>
  </div>
  ${visitor && (mod || route === "hub") ? html`<div class="subbar"><canvas class="contours" id="contours" aria-hidden="true"></canvas><div class="subbar-inner">
      <p class="mod-tag">${mod ? html`<b>${t(`mod.${mod}`)}</b> · ${t(`mod.${mod}.tag`)}` : t("hub.lede.short")}</p>
      ${mod !== "stats" || !fr || store.available().length < 2 || route === "needCountry" ? "" : methodSwitch()}
    </div></div>` : ""}`;
  // a demo account (admin page, « Démo »): said on every page, with its last day
  if (me?.demo) $("#topbar").insertAdjacentHTML("beforeend", html`<div class="demo-strip">${t("demo.strip", { date: fmtDate(me.demo, "long") })}</div>`);
  $("#menu-btn")?.addEventListener("click", () => $("#nav").classList.toggle("open"));
  // the method: one for the whole site; a switch redraws the page (a ?m= in the address follows)
  const pickMethod = (m) => {
    store.setMethod(m);
    const q = parseHash().query;
    if (q.m) replaceQuery({ ...q, m: store.get().method });
    redraw();
  };
  $$("[data-method-pick]").forEach((b) => b.addEventListener("click", () => pickMethod(b.dataset.methodPick)));
  $("#method-pick")?.addEventListener("change", (e) => pickMethod(e.target.value));
  // the drop-down menus: one open at a time, closed by a click elsewhere, Escape or a choice
  const closeMenus = (except) => $$(".nav-group.open").forEach((g) => {
    if (g === except) return;
    g.classList.remove("open");
    $(".nav-top", g).setAttribute("aria-expanded", "false");
  });
  $$(".nav-group > button.nav-top").forEach((b) => b.addEventListener("click", () => {
    const g = b.parentElement, open = !g.classList.contains("open");
    closeMenus(g);
    g.classList.toggle("open", open);
    b.setAttribute("aria-expanded", String(open));
    if (open) $(".nav-menu a", g)?.focus({ preventScroll: true });
  }));
  $$(".nav-menu a, .mod-nav a").forEach((a) => a.addEventListener("click", () => { closeMenus(); $("#nav")?.classList.remove("open"); }));
  if (!menusBound) {
    menusBound = true;
    document.addEventListener("click", (e) => { if (!e.target.closest(".nav-group")) closeMenus(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const g = $(".nav-group.open");
      closeMenus();
      if (g) $(".nav-top", g).focus();
    });
  }
  $$("[data-theme-pick]").forEach((b) => b.addEventListener("click", () => {
    const next = b.dataset.themePick;
    closeMenus();
    if (next === document.documentElement.dataset.theme) return;
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cnx.theme", next); } catch (e) {}
    // the menu marks the new one itself: a page that follows its own address (the Agenda, the landing page) is not redrawn
    // by route_, header included (2026-10-24: on a phone the menu kept marking Nuit, the default there)
    $$("[data-theme-pick]").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.themePick === next)));
    route_();                     // charts read colours at render time
  }));
  drawContours();
  if (!contoursBound) {
    contoursBound = true;
    let tm;
    window.addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(drawContours, 120); });
  }
  // the language: kept on this device and on the account (its e-mails follow), then the page drawn again
  $$("[data-lang-pick]").forEach((b) => b.addEventListener("click", () => {
    const l = b.dataset.langPick;
    closeMenus();
    if (l === lang()) return;
    if (me) auth.api("api/account/settings", { lang: l }).catch(() => {}).finally(() => setLang(l));
    else setLang(l);
  }));
  // the site's country (country.js): the page drawn again for it
  $$("[data-country-pick]").forEach((b) => b.addEventListener("click", () => { closeMenus(); pickCountry(b.dataset.countryPick); }));
  // the installable app (pwa.js): the item shows once the browser offers to install
  $("#install-btn")?.addEventListener("click", () => { closeMenus(); pwa.install(); });
  $("#logout-btn")?.addEventListener("click", async () => {
    await auth.logout();
    data.dropPrivate();
    store.set({ lastRunner: null, compare: [], clubs: [] });
    location.hash = "#/";
    route_();
  });
  if (!me) return;

}

/** The runner search at the right end of the page's tab row (the bar and the search share its bottom line). */
/** The page's tab row, made a .tabs-row (the tabs, then things at its right) — null when the page has no tabs. */
function tabsRow(main) {
  const bar = $(".page-tabs", main);
  if (!bar) return null;
  if (bar.parentElement.classList.contains("tabs-row")) return bar.parentElement;
  const row = document.createElement("div");
  row.className = "tabs-row";
  bar.replaceWith(row);
  row.append(bar);
  return row;
}
/** A lean page: no title line; its buttons at the right of the tab row, else alone on a slim row. */
function leanHead(main) {
  const head = $(".page-head", main);
  if (!head) return;
  const [titleBox, ...actions] = [...head.children];
  titleBox?.remove();
  const row = actions.length ? tabsRow(main) : null;
  if (row) {
    const box = document.createElement("div");
    box.className = "tabs-actions";
    box.append(...actions);
    row.insertBefore(box, $(".search", row));
  }
  if (!head.children.length) head.remove(); else head.classList.add("lean");
}

function placeSearch(main) {
  const row = auth.session() ? tabsRow(main) : null;
  if (!row || $(".search", row)) return;
  row.insertAdjacentHTML("beforeend", html`<div class="search">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="search-input" type="search" autocomplete="off" placeholder="${t("search.placeholder")}" aria-label="${t("search.placeholder")}">
    <div class="search-results hidden" id="search-results" role="listbox"></div></div>`);
  bindSearch();
}

function bindSearch() {
  const input = $("#search-input"), box = $("#search-results");
  let items = [], active = -1;
  const all = data.runners().list;
  const run = debounce(() => {
    const q = normalise(input.value.trim());
    if (q.length < 2) { box.classList.add("hidden"); return; }
    const terms = q.split(/\s+/);
    items = all.filter((r) => {
      const n = normalise(r.nom);
      return terms.every((w) => n.includes(w)) || r.lic === q;
    }).sort((a, b) => b.n - a.n).slice(0, 12);
    active = -1;
    box.innerHTML = items.length ? html`${items.map((r, i) => html`<a href="${link.runner(r.lic)}" role="option" data-i="${i}" data-lic="${r.lic}">
        <span>${displayName(r.nom)}<div class="sub">${fmtCat(r.cat)} · ${data.clubName(r.club)}</div></span>
        <span class="sub num">${fmt(r.n)} ${t("rn.races")}</span></a>`)}`
      : html`<div class="empty">${t("search.none")}</div>`;
    box.classList.remove("hidden");
  }, 120);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    const links = $$("a", box);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, Math.min(links.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      links.forEach((l, i) => l.classList.toggle("active", i === active));
    } else if (e.key === "Enter" && links[Math.max(0, active)]) {
      const a = links[Math.max(0, active)];
      // the page may handle the choice itself (the Classement scrolls to the runner)
      if (!current?.onRunnerPick?.(a.dataset.lic)) location.hash = a.getAttribute("href");
      box.classList.add("hidden");
      input.blur();
    } else if (e.key === "Escape") {
      box.classList.add("hidden");
    }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) box.classList.add("hidden"); });
  box.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-lic]");
    if (a && current?.onRunnerPick?.(a.dataset.lic)) e.preventDefault();      // handled by the page: do not navigate
    box.classList.add("hidden");
    input.value = "";
  });
}

function renderFooter() {
  const c = data.meta()?.counts;           // the site's country's figures (none for a country it does not rank)
  // the site's independence and its sources are said in the rules, not on every page (owner, 2026-10-20)
  $("#footer").innerHTML = html`<div class="footer-inner">
    <span><a href="#/compte/confidentialite">${t("footer.rules")}</a></span>
    ${c ? html`<span class="num">${fmt(c.runners)} ${t("ov.runners").toLowerCase()} · ${fmt(c.competitions)} ${t("ov.comps").toLowerCase()} · ${fmt(c.results)} ${t("ov.results").toLowerCase()}</span>` : ""}
  </div>`;
}

// ---- a new version of the site ----------------------------------------------
// The pages' modules stay in memory for the whole visit: a tab left open keeps the old code after a deploy (owner,
// 2026-10-15: a fixed analysis still showed the old result). The deploy publishes a fingerprint of the code
// (assets/build.txt, update.write_build_stamp); at a change of page, at most once a minute, a different one reloads
// the page — never in the middle of a page's work.
let build = null, buildAt = 0;
async function codeChanged() {
  if (Date.now() - buildAt < 60e3) return false;
  buildAt = Date.now();
  try {
    const r = await fetch("/assets/build.txt", { cache: "no-store" });
    const v = r.ok ? (await r.text()).trim() : "";
    if (!/^[0-9a-f]{8,40}$/.test(v)) return false;                 // none (local server) or not the file
    if (build == null) { build = v; return false; }
    return v !== build;
  } catch (e) { return false; }
}

// ---- routing ---------------------------------------------------------------
let current = null;
let lastRoute = null;
let token = 0;
async function route_() {
  if (silent) return;
  if (await codeChanged()) { location.reload(); return; }
  let r = parseHash();
  // a page that follows its own address (the Agenda: list <-> details) is not rebuilt for a change of query
  if (current?.onQuery && lastRoute === r.route) { current.onQuery(r.query); return; }
  const my = ++token;
  // the gate: logged out, only the home (login) page exists; the page asked for (a link in an e-mail…) opens after the login.
  // A visitor without an account (« Entrer sans compte », auth.guest) has the pages of public data (GUEST_ROUTES); any
  // other page leads to the modules page
  const me = auth.session(), guest = !me && auth.guest();
  if (!me && !guest && !["overview", "account"].includes(r.route)) {
    try { sessionStorage.setItem("ocn.after", location.hash); } catch (e) {}
    history.replaceState(null, "", "#/");
    r.route = "overview"; r.arg = null; r.query = {};
  }
  if (guest && !GUEST_ROUTES.has(r.route)) {
    history.replaceState(null, "", homeOf());
    r = parseHash();
  }
  // logged in, the home page leads to the modules page (homeOf)
  if (me && r.route === "overview") {
    history.replaceState(null, "", homeOf(me));
    r = parseHash();
  }
  // a runner named by their id (#/coureur/es10000123): their country becomes the site's; a bare number is France's (2026-10-22)
  if (r.route === "runner" && r.arg) {
    const id = data.parseId(r.arg);
    if (id && id.cc !== country.current() && country.withData().includes(id.cc)) {
      country.pick(id.cc);
      await data.useCountry(id.cc);
      renderFooter();
    }
    if (id && id.cc === country.current()) r = { ...r, arg: id.n };
  }
  if ((me || guest) && !data.isPrivateLoaded()) {
    // only a session the server refuses (401, data.getJson) signs out; anything else is shown as a failed load. (Every
    // visitor reads the runners: the country's own file, or its public copy, data.setPublicRule.)
    try { await data.bootPrivate({ open: true }); } catch (e) {
      if (/HTTP 401/.test(e.message)) return signedOut();
      $("#main").innerHTML = html`<div class="card"><div class="empty">${t("err.load")}<br><span class="muted">${String(e.message || e)}</span></div></div>`;
      return;
    }
    if (me) {
      await auth.refresh();                   // rights granted or withdrawn since the login
      if (my !== token) return;
      movedNotice();
    }
  }
  // a country's ranking pages: all of them to those who see its data; to the others, from its public copy, the runner, the
  // ranking and the races only (the federation's open seasons: data.setPublicRule); else the page that says why
  if ((me || guest) && FR_ROUTES.has(r.route) && (!country.ranks() || (r.route === "ask" && country.current() !== "FR")
    || (!auth.sees(country.current()) && !PUBLIC_STATS.has(r.route)))) r = { ...r, route: "needCountry", from: r.route };
  // a link may carry the method (?m=official|top6w): it becomes the site's
  if (r.query.m) store.setMethod(r.query.m, { quiet: true });
  // « Déposer » is the organisers' alone, under « Organisation › Résultats » (owner, 2026-10-15): the old address leads there
  // the Documentation's address is « #/documentation » since 2026-10-24: an old « #/methodes » link shows the new one
  if (r.route === "methods" && /^#\/methodes\b/.test(location.hash)) {
    history.replaceState(null, "", location.hash.replace(/^#\/methodes/, "#/documentation"));
    r = parseHash();
  }
  // « Analyse de course »'s list of before (2026-10-30): the past competitions, which list the races with split times
  if (r.route === "splits" && !r.query.course) {
    history.replaceState(null, "", "#/resultats");
    r = parseHash();
  }
  if (r.route === "deposit") {
    history.replaceState(null, "", `#/orga-resultats${r.query.course ? `?course=${encodeURIComponent(r.query.course)}` : ""}`);
    r = parseHash();
  }
  // the Orga module: an account that turned it on, on a computer (owner, 2026-10-30); else a page that says how
  if (moduleOf(r) === "orga" && !orgaOpen()) r = { ...r, route: "orgaOff", from: r.route };
  // every page for every account (owner, 2026-10-15): « En direct », « Entrainement », the analyses and « Organisation »
  // were for the administrators (or the « live » right) until then
  // a shared link may carry the discipline (?t=For|Spr): it sets the site-wide switch
  if (store.TERRAINS.includes(r.query.t) && r.query.t !== store.get().terrain) store.set({ terrain: r.query.t });
  renderHeader(r);
  current?.cleanup?.();
  disposeAll();
  const main = $("#main");
  const quiet = inPlace;                 // a redraw in place (a switch of method): no loading screen, no jump to the top
  inPlace = false;
  if (!quiet) main.innerHTML = html`<div class="boot"><div class="spinner"></div><p>${t("misc.loading")}</p></div>`;
  try {
    const mod = await PAGES[r.route]();
    if (my !== token) return;
    current = (await mod.render(main, r)) || null;
    if (SEARCH_IN_TABS.has(r.route)) placeSearch(main);
    if (isLean(r)) leanHead(main);
    lastRoute = r.route;
    track(r);
    document.title = (current?.title ? current.title + " — " : "") + SITE;
  } catch (e) {
    console.error(e);
    main.innerHTML = html`<div class="card"><div class="empty">${t("err.load")}<br><span class="muted">${String(e.message || e)}</span></div></div>`;
  }
  if (!quiet && !location.hash.includes("?")) window.scrollTo(0, 0);
}

/** Redraws the page for another method without moving anything (owner, 2026-10-12): no loading screen, the page keeps
 *  its height while it redraws, and the window's and the inner panes' scroll positions (the races' list, the tables)
 *  are put back, again once the parts drawn later have settled. */
let inPlace = false;
/** Another runner (or another choice) on the same page without moving (owner, 2026-10-13): the address changes, the page
 *  redraws in place — same tab, same scroll positions. */
export async function goInPlace(href) {
  if (!href || location.hash === href) return;
  history.pushState(null, "", href);
  await redraw();
}
const SCROLLERS = ".tree, .table-scroll, .table-wrap, .scroll-box";
async function redraw() {
  const main = $("#main"), y = window.scrollY;
  const inner = $$(SCROLLERS, main).map((el) => el.scrollTop);
  main.style.minHeight = `${main.offsetHeight}px`;
  inPlace = true;
  await route_();
  const restore = () => {
    $$(SCROLLERS, main).forEach((el, i) => { if (inner[i]) el.scrollTop = inner[i]; });
    window.scrollTo(0, y);
  };
  restore();
  requestAnimationFrame(restore);
  setTimeout(restore, 300);
  setTimeout(() => { restore(); main.style.minHeight = ""; }, 900);
}

// ---- usage: one page view of a logged-in account (admin page, « Utilisation ») ---------------------
/** The page counted: the route, and for Réseau its view. */
function pageKey(r) {
  if (r.route !== "network") return r.route;
  const v = r.query.vue;
  return `network:${r.arg ? "ego" : v === "meilleurs" ? "leaders" : v === "territoires" ? "territories"
    : ["stats", "ages", "activite"].includes(v) ? "stats" : store.get().lastRunner ? "ego" : "leaders"}`;
}
function track(r) {
  if (!auth.session()) return;
  let visit = false;                                     // the first page of a browser session opens a visit
  try { visit = !sessionStorage.getItem("ocn.visit"); sessionStorage.setItem("ocn.visit", "1"); } catch (e) {}
  fetch("api/track", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
    keepalive: true, body: JSON.stringify({ page: pageKey(r), visit }) }).catch(() => {});
}

/** « Entrer sans compte » (owner, 2026-10-30): a visit without an account, on the modules page or a module's first page. */
export async function enterAsGuest(mod = "") {
  auth.setGuest(true);
  await data.reloadCountry();                   // the public copies now (data.setPublicRule)
  location.hash = MODULES.includes(mod) && mod !== "orga" ? moduleMenus()[mod][0][1] : homeOf();
}
/** Leave a visit without an account: back to the home page. */
export async function leaveGuest() {
  auth.setGuest(false);
  await data.reloadCountry();
  location.hash = "#/";
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-guest-enter]");
  if (b) { e.preventDefault(); enterAsGuest(b.dataset.guestEnter); }
});

/** The server no longer accepts the session (expired, secret rotated…). */
function signedOut() {
  auth.forget();
  data.dropPrivate();
  history.replaceState(null, "", "#/");
  route_();
}
window.addEventListener("cnx:unauthorised", () => { if (auth.session()) signedOut(); });

/** Called by the login page once the credentials are accepted: land on one's own page. */
export async function signedIn(s) {
  await data.reloadCountry();                 // the full files now, or the public copy (data.setPublicRule)
  await data.bootPrivate({ open: true });
  if (s.lic && data.loadedCountry() === "FR") store.set({ lastRunner: s.lic });
  let next = null;
  try { next = sessionStorage.getItem("ocn.after"); sessionStorage.removeItem("ocn.after"); } catch (e) {}
  // the page asked for before the login, else the modules page (homeOf)
  location.hash = next && next.startsWith("#/") && next !== "#/" ? next : homeOf(s);
  pushBoot();
  movedNotice();
}
/** The window about the move to ozimut.com, once to each account that existed before it (moved.js). */
const movedNotice = () => { if (auth.session()?.movedNotice) setTimeout(() => import("./moved.js").then((m) => m.maybe()).catch(() => {}), 1200); };
/** Push notifications on this device (push.js): renewed, or offered, a few seconds into a signed-in visit. */
const pushBoot = () => setTimeout(() => { if (auth.session()?.email && !auth.session()?.demo) import("./push.js").then((p) => p.boot()).catch(() => {}); }, 4000);

// the words for the value of the method shown, in any text that names it without its caller giving them (« indices Ozimut »)
setDefaults(() => cnWords(store.get().method));

// a selection made in another tab shows up here too
window.addEventListener("storage", (e) => { if (e.key === "cnx.state") store.reload(); });

async function start() {
  // the move to ozimut.com (bridge.js): the old address sends each visitor on, the new one takes in those arriving
  if ((await bridge.arrive()) || (await bridge.leave())) return;
  watchTables();                                   // tables that scroll fit in the window
  pwa.boot();                                      // the service worker, the manifest's language, files opened with the app
  // ECharts is loaded with `defer`; module scripts run after it, but guard anyway.
  if (!window.echarts) await new Promise((res) => window.addEventListener("load", res, { once: true }));
  // a visitor without an account, or an account that has not joined a country, reads its public copy (data.js)
  data.setPublicRule((cc) => (!!auth.session() || auth.guest()) && data.site()?.countries?.[cc]?.access === "members" && !auth.sees(cc));
  await data.bootPublic();
  renderFooter();
  codeChanged();                                   // the version this visit runs
  window.addEventListener("hashchange", route_);
  window.addEventListener("ocn:install", () => { const b = $("#install-btn"); if (b) b.hidden = pwa.installState() !== "ready"; });
  // a page's own « Choisir un autre pays » (country.hint)
  window.addEventListener("ocn:country", (e) => pickCountry(e.detail));
  // the countries « En direct » carries join the header's menu (country.noteLive)
  window.addEventListener("ocn:countries", () => { if (auth.session()) renderHeader(parseHash()); });
  route_();
  if (auth.session()) country.refreshLive();
  pushBoot();
}
start().catch((e) => {
  console.error(e);
  $("#main").innerHTML = html`<div class="card"><div class="empty">${t("err.load")}<br>${esc(e.message)}</div></div>`;
});
