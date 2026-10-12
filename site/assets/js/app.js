// Application shell: router (with the login gate), header (navigation,
// discipline selector, search, the logged-in user, the number of runners being compared).

import { html, raw, $, $$, esc, fmt, normalise, displayName, nameParts, debounce } from "./util.js";
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
  provisional: () => import("./pages/provisional.js"),   // « Résultats »: the organisers' results of the last 60 days
  splits: () => import("./pages/splits.js"),
  live: () => import("./pages/live.js"),           // « En direct »: live results (accounts with the « live » right)
  deposit: () => import("./pages/deposit.js"),     // « Déposer »: a results file read in the browser, then published
  relays: () => import("./pages/relays.js"),       // « Relais »: the relay simulator, from Clubs
};

// Pages without the runner search of the header: it leads away from what they show.
const NO_SEARCH = new Set(["courses", "clubs", "club", "clubcompare", "methods", "agenda", "contact", "settings", "admin", "provisional", "splits"]);
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
    : head === "resultats" || head === "recemment" || head === "provisoires" ? "provisional"     // #/recemment, #/provisoires: old addresses
    : head === "temps-inter" ? "splits"
    : head === "direct" ? "live"
    : head === "deposer" ? "deposit"
    : head === "relais" ? "relays"
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
  relays: (q) => "#/relais" + qstr(q),
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
  const { path, query } = parseHash();
  // the tab shown (ui.pageTabs: ?onglet=) stays unless the page says otherwise
  if (query.onglet && q && !("onglet" in q)) q = { ...q, onglet: query.onglet };
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
let menusBound = false;
function renderHeader(r) {
  const { route } = r;
  const me = auth.session();
  // logged in, the home page (the login page) is not needed: the brand leads to one's own page
  // two groups (owner, 2026-10-12): the national ranking's analyses, and the races — coming, run, live. The bar shows
  // the groups, the row under it the current group's pages (and the runner search); the documentation, settings,
  // contact and logout are under one's name
  const groups = me ? [
    ["cn", t("nav.g.cn"), [
      ["runner", "#/coureur", t("nav.runner")],
      ["ranking", "#/classement", t("nav.ranking")],
      ["courses", "#/courses", t("nav.coursesCn")],
      ["compare", "#/comparer", t("nav.compare")],
      ["clubs", "#/clubs", t("nav.clubs")],
      ["network", "#/reseau", t("nav.network")],
    ]],
    ["races", t("nav.g.races"), [
      ["agenda", "#/agenda", t("nav.agenda")],
      ["provisional", "#/resultats", t("nav.recent")],
      ...(me.live ? [["live", "#/direct", t("nav.live")]] : []),
    ]],
  ] : [];                                     // logged out, the home page (the login) is the whole site
  const current = route === "course" ? "courses" : route === "club" || route === "clubcompare" || route === "relays" ? "clubs"
    : route === "splits" || route === "deposit" ? "provisional" : route;
  const group = groups.find(([, , items]) => items.some(([k]) => k === current));
  // a group's tab leads back to the page last seen in it
  const lastIn = (g, items) => { try { return localStorage.getItem(`ocn.nav.${g}`) || items[0][1]; } catch (e) { return items[0][1]; } };
  if (group) { try { localStorage.setItem(`ocn.nav.${group[0]}`, location.hash || group[2][0][1]); } catch (e) {} }
  const caret = raw(`<svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  // the bar under the navigation: the runner search, where it helps (the discipline is among each page's filters)
  const showSearch = !NO_SEARCH.has(route);
  $("#topbar").innerHTML = html`<div class="topbar-inner${me ? "" : " guest"}">
    ${me ? html`<button class="icon-btn menu-btn" type="button" aria-label="Menu" id="menu-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>` : ""}
    <a class="brand" href="${me ? link.runner(me.lic) : "#/"}">
      <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0d366b"/>
        <path d="M16 5 L27 16 L16 27 L5 16 Z" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
        <path d="M16 5 L27 16 L16 16 Z" fill="#eb6834"/><path d="M5 16 L16 27 L16 16 Z" fill="#fff"/>
      </svg>
      <span class="brand-name">${SITE}</span>
    </a>
    <nav class="nav" id="nav" aria-label="Navigation">
      ${groups.map(([g, label, items]) => html`<div class="nav-group" data-group="${g}">
        <a class="nav-top" href="${lastIn(g, items)}" ${raw(group?.[0] === g ? 'aria-current="true"' : "")}>${label}${
          g === "cn" ? html`<span class="nav-count" id="nav-cmp-top" hidden></span>` : ""}</a>
        <div class="nav-menu">${items.map(([k, href, text]) => html`<a href="${href}" ${raw(k === current ? 'aria-current="page"' : "")}>${text}${
          k === "compare" ? html`<span class="nav-count" id="nav-cmp" hidden></span>` : ""}</a>`)}</div>
      </div>`)}
    </nav>
    <div class="topbar-tools">
      ${me ? html`
      <button class="icon-btn" type="button" id="theme-btn" title="${t("theme.toggle")}" aria-label="${t("theme.toggle")}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
      <div class="nav-group user-menu" data-group="me">
        <button type="button" class="nav-top user-btn" aria-expanded="false" aria-label="${t("auth.menu")}"
          ${raw(["methods", "settings", "contact", "admin"].includes(route) ? 'aria-current="true"' : "")}>
          <span class="user-name">${(({ first, last }) => html`<span>${first}</span>${last ? html`<span>${last}</span>` : ""}`)(nameParts(me.nom))}</span>
          <svg class="user-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>${caret}</button>
        <div class="nav-menu">
          <a href="${link.runner(me.lic)}" ${raw(route === "runner" && parseHash().arg === me.lic ? 'aria-current="page"' : "")}>${t("auth.myPage")}</a>
          <a href="#/methodes" ${raw(route === "methods" ? 'aria-current="page"' : "")}>${t("nav.docs")}</a>
          <a href="#/reglages" ${raw(route === "settings" ? 'aria-current="page"' : "")}>${t("st.link")}</a>
          <a href="#/contact?${new URLSearchParams({ from: location.hash || "#/" })}" ${raw(route === "contact" ? 'aria-current="page"' : "")}>${t("ct.link.menu")}</a>
          ${me.admin ? html`<a href="#/admin" ${raw(route === "admin" ? 'aria-current="page"' : "")}>${t("admin.link")}</a>` : ""}
          <button type="button" id="logout-btn">${t("auth.logout")}</button>
        </div>
      </div>` : html`
      <button class="icon-btn" type="button" id="theme-btn" title="${t("theme.toggle")}" aria-label="${t("theme.toggle")}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>`}
    </div>
  </div>
  ${me && (group || showSearch) ? html`<div class="subbar"><div class="subbar-inner">
      ${group ? html`<nav class="subnav" aria-label="${group[1]}">${group[2].map(([k, href, text]) => html`<a href="${href}" ${raw(k === current ? 'aria-current="page"' : "")}>${text}${
        k === "compare" ? html`<span class="nav-count" id="nav-cmp-sub" hidden></span>` : ""}</a>`)}</nav>` : ""}
      ${showSearch ? html`<div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="search-input" type="search" autocomplete="off" placeholder="${t("search.placeholder")}" aria-label="${t("search.placeholder")}">
        <div class="search-results hidden" id="search-results" role="listbox"></div>
      </div>` : ""}
    </div></div>` : ""}`;
  $("#menu-btn")?.addEventListener("click", () => $("#nav").classList.toggle("open"));
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
  $$(".nav-menu a").forEach((a) => a.addEventListener("click", () => { closeMenus(); $("#nav")?.classList.remove("open"); }));
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
  const [before, after] = t("footer.disclaimer").split("{site}");      // the source, as a link
  $("#footer").innerHTML = html`<div class="footer-inner">
    <span>${SITE} — ${before}<a href="https://cn.ffcorientation.fr/" target="_blank" rel="noopener">cn.ffcorientation.fr</a>${after}
      <a href="#/compte/confidentialite">${t("footer.rules")}</a></span>
    <span class="num">${fmt(m.counts.runners)} ${t("ov.runners").toLowerCase()} · ${fmt(m.counts.competitions)} ${t("ov.comps").toLowerCase()} · ${fmt(m.counts.results)} ${t("ov.results").toLowerCase()}</span>
  </div>`;
}

// ---- the runners being compared: their number next to « Comparer » ------------------
function renderCompareCount() {
  const n = store.get().compare.length;
  // next to « Comparer », and on its group's button (the menu is closed)
  for (const el of [$("#nav-cmp"), $("#nav-cmp-top"), $("#nav-cmp-sub")]) {
    if (!el) continue;
    el.textContent = n ? String(n) : "";
    el.hidden = !n;
    el.title = n ? `${n} ${t("cp.count")}` : "";
  }
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
  // the gate: logged out, only the home (login) page exists; the page asked for (a link in an e-mail…) opens after the login
  const me = auth.session();
  if (!me && !["overview", "account"].includes(r.route)) {
    try { sessionStorage.setItem("ocn.after", location.hash); } catch (e) {}
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
  // « En direct » only for the accounts allowed to see it
  if (r.route === "live" && !who?.live) {
    history.replaceState(null, "", "#/resultats");
    r = parseHash();
  }
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
    track(r);
    document.title = (current?.title ? current.title + " — " : "") + SITE;
  } catch (e) {
    console.error(e);
    main.innerHTML = html`<div class="card"><div class="empty">${t("err.load")}<br><span class="muted">${String(e.message || e)}</span></div></div>`;
  }
  if (!location.hash.includes("?")) window.scrollTo(0, 0);
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
  let next = null;
  try { next = sessionStorage.getItem("ocn.after"); sessionStorage.removeItem("ocn.after"); } catch (e) {}
  location.hash = next && next.startsWith("#/") && next !== "#/" ? next : link.runner(s.lic);
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
