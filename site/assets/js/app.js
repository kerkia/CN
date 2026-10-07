// Application shell: router (with the login gate), header (navigation,
// discipline selector, search, the logged-in user, the number of runners being compared).

import { html, raw, $, $$, esc, fmt, normalise, displayName, debounce } from "./util.js";
import { t } from "./i18n.js";
import * as store from "./store.js";
import * as data from "./data.js";
import { disposeAll } from "./charts.js";
import * as auth from "./auth.js";

export const SITE = "O'CN";

const PAGES = {
  ranking: () => import("./pages/ranking.js"),
  runner: () => import("./pages/runner.js"),
  compare: () => import("./pages/compare.js"),
  clubs: () => import("./pages/clubs.js"),
  club: () => import("./pages/club.js"),
  overview: () => import("./pages/overview.js"),
  methods: () => import("./pages/methods.js"),
  clubcompare: () => import("./pages/clubcompare.js"),
  network: () => import("./pages/network.js"),
  courses: () => import("./pages/courses.js"),
  agenda: () => import("./pages/agenda.js"),
  account: () => import("./pages/account.js"),      // public: sign-up, confirmation, password reset, privacy
  settings: () => import("./pages/settings.js"),
  contact: () => import("./pages/contact.js"),
  admin: () => import("./pages/admin.js"),
};

// Pages without the runner search of the header: it leads away from what they show.
const NO_SEARCH = new Set(["courses", "clubs", "club", "clubcompare", "methods", "agenda", "contact", "settings", "admin"]);
// Réseau views that count every discipline together by default (all but the leaders, who are
// ranked by a CN): there the switch also offers "Toutes", and its choice lives in the address
// (?t=For|Spr|VTT|Ski, none = all). Around one runner = a runner in the address, or the last one seen.
const ALL_TERRAIN_VIEWS = new Set(["stats", "territoires", "ages", "activite"]);     // ages, activite: old links to stats
const allowsAllTerrains = (r) => r.route === "network"
  && (!!r.arg || ALL_TERRAIN_VIEWS.has(r.query.vue) || (r.query.vue !== "meilleurs" && !!store.get().lastRunner));
/** The discipline of such a view: "For", "Spr", "VTT", "Ski", or "" for all of them. */
export const viewTerrain = (query) => (store.TERRAINS.includes(query.t) ? query.t : "");

function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  const parts = path.split("/").filter(Boolean);
  const [head, arg] = parts;
  const route =
    !head ? "overview"
    : head === "classement" ? "ranking"
    : head === "coureur" ? "runner"
    : head === "progression" ? "runner"        // merged into the runner page
    : head === "comparer" ? "compare"
    : head === "course" ? "courses"          // old competition links open the Courses tab
    : head === "courses" ? "courses"
    : head === "agenda" ? "agenda"
    : head === "clubs" ? "clubs"
    : head === "club" ? "club"
    : head === "apercu" ? "overview"
    : head === "methodes" ? "methods"
    : head === "comparer-clubs" ? "clubcompare"
    : head === "reseau" ? "network"
    : head === "compte" ? "account"
    : head === "reglages" ? "settings"
    : head === "contact" ? "contact"
    : head === "admin" ? "admin"
    : "overview";
  return { route, arg: arg ? decodeURIComponent(arg) : null, query, path };
}

export const link = {
  home: () => "#/",
  ranking: (q) => "#/classement" + qstr(q),
  runner: (lic, q) => (lic ? `#/coureur/${encodeURIComponent(lic)}` : "#/coureur") + qstr(q),
  compare: () => "#/comparer",
  /** A race in the Courses tab; q may add circ, mode, r, club. */
  course: (id, q) => "#/courses" + qstr({ id, t: data.comp(id)?.terrain, ...q }),   // t: the race's discipline
  courses: (q) => "#/courses" + qstr(q),
  club: (code) => `#/club/${encodeURIComponent(code)}`,
  clubs: () => "#/clubs",
  clubCompare: () => "#/comparer-clubs",
  progression: (lic, q) => link.runner(lic, q),
  network: (lic, q) => (lic ? `#/reseau/${encodeURIComponent(lic)}` : "#/reseau") + qstr(q),
  networkLeaders: (q) => "#/reseau" + qstr({ ...q, vue: "meilleurs" }),
  territories: (q) => "#/reseau" + qstr({ ...q, vue: "territoires" }),
  stats: (q) => "#/reseau" + qstr({ ...q, vue: "stats" }),
};
function qstr(q) {
  if (!q) return "";
  const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "")).toString();
  return s ? "?" + s : "";
}

/** Update the URL's query for the current page without re-rendering it. */
let silent = false;
export function replaceQuery(q) {
  const { path } = parseHash();
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
// changing it re-renders the current page
document.addEventListener("change", (e) => {
  if (e.target.id !== "terrain-select") return;
  const v = e.target.value, now = parseHash(), { query } = now;
  if (store.TERRAINS.includes(v)) store.set({ terrain: v });
  if (allowsAllTerrains(now)) replaceQuery({ ...query, t: v === "all" ? null : v });
  else if (query.t) { delete query.t; replaceQuery(query); }
  route_();
});

// ---- header -------------------------------------------------------------
function renderHeader(r) {
  const { route } = r;
  const me = auth.session();
  // logged in, the home page (the login page) is not needed: the brand leads to one's own page
  const nav = me ? [
    ["runner", "#/coureur", t("nav.runner")],
    ["ranking", "#/classement", t("nav.ranking")],
    ["courses", "#/courses", t("nav.courses")],
    ["compare", "#/comparer", t("nav.compare")],
    ["clubs", "#/clubs", t("nav.clubs")],
    ["network", "#/reseau", t("nav.network")],
    ["methods", "#/methodes", t("nav.methods")],
    ["agenda", "#/agenda", t("nav.agenda")],
  ] : [
    ["overview", "#/", t("auth.title")],
    ["agenda", "#/agenda", t("nav.agenda")],
  ];
  const current = route === "course" ? "courses" : route === "club" || route === "clubcompare" ? "clubs" : route;
  // the bar under the navigation: the runner search, where it helps (the discipline is among each page's filters)
  const showSearch = !NO_SEARCH.has(route);
  $("#topbar").innerHTML = html`<div class="topbar-inner">
    <button class="icon-btn menu-btn" type="button" aria-label="Menu" id="menu-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <a class="brand" href="${me ? link.runner(me.lic) : "#/"}">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0d366b"/>
        <path d="M16 5 L27 16 L16 27 L5 16 Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="M16 5 L27 16 L16 16 Z" fill="#eb6834"/><path d="M5 16 L16 27 L16 16 Z" fill="#fff"/>
      </svg>
      <span class="brand-name">${SITE}<small>${t("brand.sub")}</small></span>
    </a>
    <nav class="nav" id="nav" aria-label="Navigation">
      ${nav.map(([k, href, label]) => html`<a href="${href}" ${raw(k === current ? 'aria-current="page"' : "")}>${label}${
        k === "compare" ? html`<span class="nav-count" id="nav-cmp" hidden></span>` : ""}</a>`)}
    </nav>
    <div class="topbar-tools">
      ${me ? html`
      <button class="icon-btn" type="button" id="theme-btn" title="${t("theme.toggle")}" aria-label="${t("theme.toggle")}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
      <div class="user-chip">
        <a href="${link.runner(me.lic)}" class="user-name" title="${t("auth.myPage")}">${displayName(me.nom)}</a>
        <div class="user-links">
          ${me.admin ? html`<a href="#/admin">${t("admin.link")}</a>` : ""}
          <a href="#/reglages">${t("st.link")}</a>
          <a href="#/contact?${new URLSearchParams({ from: location.hash || "#/" })}">${t("ct.link.menu")}</a>
          <button type="button" id="logout-btn">${t("auth.logout")}</button>
        </div>
      </div>` : html`
      <button class="icon-btn" type="button" id="theme-btn" title="${t("theme.toggle")}" aria-label="${t("theme.toggle")}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>`}
    </div>
  </div>
  ${me && showSearch ? html`<div class="subbar"><div class="subbar-inner">
      ${html`<div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="search-input" type="search" autocomplete="off" placeholder="${t("search.placeholder")}" aria-label="${t("search.placeholder")}">
        <div class="search-results hidden" id="search-results" role="listbox"></div>
      </div>`}
    </div></div>` : ""}`;
  $("#menu-btn").addEventListener("click", () => $("#nav").classList.toggle("open"));
  $("#theme-btn").addEventListener("click", () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cnx.theme", next); } catch (e) {}
    route_();                     // charts read colours at render time
  });
  $("#logout-btn")?.addEventListener("click", async () => {
    await auth.logout();
    data.dropPrivate();
    store.set({ lastRunner: null, compare: [], clubs: [] });
    location.hash = "#/";
    route_();
  });
  if (!me) return;
  if (showSearch) bindSearch();
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
        <span>${displayName(r.nom)}<div class="sub">${r.cat || ""} · ${data.clubName(r.club)}</div></span>
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
  const m = data.meta();
  $("#footer").innerHTML = html`<div class="footer-inner">
    <span>${SITE} — ${t("footer.disclaimer")}</span>
    <span class="num">${fmt(m.counts.runners)} ${t("ov.runners").toLowerCase()} · ${fmt(m.counts.competitions)} ${t("ov.comps").toLowerCase()} · ${fmt(m.counts.results)} ${t("ov.results").toLowerCase()} —
      <a href="https://cn.ffcorientation.fr/" target="_blank" rel="noopener">${t("footer.official")}</a></span>
  </div>`;
}

// ---- the runners being compared: their number next to « Comparer » ------------------
function renderCompareCount() {
  const el = $("#nav-cmp");
  if (!el) return;
  const n = store.get().compare.length;
  el.textContent = n ? String(n) : "";
  el.hidden = !n;
  el.title = n ? `${n} ${t("cp.count")}` : "";
}

// ---- routing ---------------------------------------------------------------
let current = null;
let lastRoute = null;
let token = 0;
async function route_() {
  if (silent) return;
  let r = parseHash();
  // a page that follows its own address (the Agenda: list <-> details) is not rebuilt for a change of query
  if (current?.onQuery && lastRoute === r.route) { current.onQuery(r.query); return; }
  const my = ++token;
  // the gate: logged out, only the home (login) page exists
  const me = auth.session();
  if (!me && !["overview", "account", "agenda"].includes(r.route)) {
    history.replaceState(null, "", "#/");
    r.route = "overview"; r.arg = null; r.query = {};
  }
  // logged in, the home page leads to one's own page
  if (me && r.route === "overview") {
    history.replaceState(null, "", link.runner(me.lic));
    r = parseHash();
  }
  if (me && !data.isPrivateLoaded()) {
    try { await data.bootPrivate(); } catch (e) { return signedOut(); }
    await auth.refresh();                     // rights granted or withdrawn since the login
    if (my !== token) return;
  }
  // the analysis methods ("Juste") only for the accounts allowed to see them
  const who = auth.session();
  store.setAnalyst(!!who?.analyst);
  // a shared link may carry the discipline (?t=For|Spr): it sets the site-wide switch
  if (store.TERRAINS.includes(r.query.t) && r.query.t !== store.get().terrain) store.set({ terrain: r.query.t });
  renderHeader(r);
  renderCompareCount();
  current?.cleanup?.();
  disposeAll();
  const main = $("#main");
  main.innerHTML = html`<div class="boot"><div class="spinner"></div><p>${t("misc.loading")}</p></div>`;
  try {
    const mod = await PAGES[r.route]();
    if (my !== token) return;
    current = (await mod.render(main, r)) || null;
    lastRoute = r.route;
    document.title = (current?.title ? current.title + " — " : "") + SITE;
  } catch (e) {
    console.error(e);
    main.innerHTML = html`<div class="card"><div class="empty">${t("err.load")}<br><span class="muted">${String(e.message || e)}</span></div></div>`;
  }
  if (!location.hash.includes("?")) window.scrollTo(0, 0);
}

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
  await data.bootPrivate();
  store.set({ lastRunner: s.lic });
  location.hash = link.runner(s.lic);
}

store.subscribe(renderCompareCount);
// a selection made in another tab shows up here too
window.addEventListener("storage", (e) => { if (e.key === "cnx.state") store.reload(); });

async function start() {
  // ECharts is loaded with `defer`; module scripts run after it, but guard anyway.
  if (!window.echarts) await new Promise((res) => window.addEventListener("load", res, { once: true }));
  await data.bootPublic();
  renderFooter();
  window.addEventListener("hashchange", route_);
  route_();
}
start().catch((e) => {
  console.error(e);
  $("#main").innerHTML = html`<div class="card"><div class="empty">${t("err.load")}<br>${esc(e.message)}</div></div>`;
});
