// « En direct » (#/direct[/<race>[/<class>]], every account): the races liveresultat shows,
// then one race live, from Ozimut's live relay (live/, Worker « ocn-live »: one reader per race, changes pushed over a WebSocket),
// reached through this site's Functions (/api/live/list, /ws/<race>). What it adds: each runner recognised
// (name + club) and linked to their page, their CN (Top and official) in the race's discipline, and the place their
// CN predicts. Times are liveresultat's hundredths of a second.
import { html, raw, $, $$, fmt, fmtDate, normalise, fmtCat } from "../util.js";
import { t, lang, locale } from "../i18n.js";
import * as data from "../data.js";
import * as cn from "../cn.js";
import { nameKey, sees, session, myClub } from "../auth.js";
import { methodShort, scoreCell, subHead, cnLabel, scoreLabel } from "../ui.js";
import * as store from "../store.js";
import { link, replaceQuery } from "../app.js";
import * as country from "../country.js";
import { flag } from "../vendor.js";

// the list (/api/live/list) and the live connections (/ws/<race>), on this site; a developer may point them at another
// server (localStorage « ocn.liveBase »)
const devBase = (() => { try { return localStorage.getItem("ocn.liveBase"); } catch (e) { return null; } })();
export const LIVE = devBase || "";               // this site
const STATUS = { 1: "dns", 2: "dnf", 3: "mp", 4: "dsq", 5: "ot", 11: "dns", 12: "nc" };
const ST_LABEL = { dns: t("status.dns"), dnf: t("status.abandon"), mp: t("status.pm"), dsq: t("status.disqualifie"), ot: t("status.hors_delai"), nc: t("status.nc") };
// the CN that values a method's circuits (Top: the Fit of the same mean; official: itself)
const VALUER = { official: "official", top6w: "fair", fair: "fair" };
const JUST_IN_MS = 90000;

export async function render(main, { path = "", query = {} } = {}) {
  const parts = path.split("/").filter(Boolean).slice(1);          // #/direct/<race>/<class> | ~club/<club> | ~passages/<all|mine>
  const dec = (s) => (s ? decodeURIComponent(s) : null);
  return parts[0] && /^\d+$/.test(parts[0]) ? race(main, parts[0], dec(parts[1]), dec(parts[2])) : list(main, query);
}

// ---- the races ----------------------------------------------------------------------------------------------------
// the site's country's races (country.js, the header's menu; owner, 2026-10-21: the page's own « Pays » field repeated it),
// the other countries racing live beside the search (under the list on a phone), each a click to make it the site's country
// (owner, 2026-10-21: no « all countries » toggle); a search looks in every country
const countryName = (() => {
  let dn = null;
  try { dn = new Intl.DisplayNames([lang()], { type: "region" }); } catch (e) { /* codes then */ }
  return (c) => (c === "?" ? t("lv.country.unknown") : dn?.of(c) || c);
})();

async function list(main, query) {
  let q = query.q || "";
  const cur = country.current();
  main.innerHTML = html`<div class="page-head"><div><h1>${t("lv.title")}</h1><p class="lede">${t("lv.lede")}</p></div></div>
    <div class="filters lv-filters"><label class="field"><span>${t("prov.search")}</span><input type="search" id="lv-q" value="${q}" style="width:240px"></label>
      <div class="lv-else lv-else-top" data-lv-else></div></div>
    <div id="lv-org"></div>
    <section class="card"><div class="table-wrap" id="lv-list"><div class="empty">${t("lv.loading")}</div></div></section>
    <div class="lv-else lv-else-end" data-lv-else></div>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("lv.source")}</p>`;
  let comps = [];
  try { comps = (await (await fetch(`${LIVE}/api/live/list`, { cache: "no-cache" })).json()).comps; } catch (e) { /* shown empty */ }
  // the races organisers feed from their timing software (« Organisation › Direct »), of the last 3 days: those that sent
  // something, and one's own before their first send (every one to administrators)
  {
    try {
      const own = ((await (await fetch("/api/live/broadcasts", { credentials: "same-origin" })).json()).broadcasts || [])
        .filter((b) => b.date >= new Date(Date.now() - 3 * 86400e3).toLocaleDateString("sv-SE") && (b.last || b.mine || session()?.admin));
      if (own.length) $("#lv-org").innerHTML = html`<section class="card"><div class="card-head"><div><h2>${t("lv.org.title")}</h2>
        <div class="hint">${t("lv.org.hint")}</div></div></div>
        <div class="table-wrap"><table class="data compact"><tbody>${own.map((b) => html`<tr><td>${fmtDate(b.date)}</td>
          <td><a href="#/direct/${b.id}">${b.name}</a></td><td class="muted">${b.organizer || ""}</td>
          <td class="muted">${b.last ? t("lv.org.last", { t: new Date(b.last).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) }) : t("lv.org.none")}</td></tr>`)}</tbody></table></div></section>`;
    } catch (e) { /* none shown */ }
  }
  const today = new Date().toLocaleDateString("sv-SE");
  // the other countries racing live, the most races first
  const counts = new Map();
  for (const c of comps) if ((c[5] || "?") !== cur) counts.set(c[5] || "?", (counts.get(c[5] || "?") || 0) + 1);
  const order = [...counts].filter(([c]) => c !== "?").sort((a, b) => b[1] - a[1]);
  const draw = () => {
    replaceQuery({ q: q || null });
    const n = normalise(q);
    const kept = comps.filter((c) => (n ? normalise(`${c[1]} ${c[2]}`).includes(n) : (c[5] || "?") === cur))
      .sort((a, b) => (a[3] === today ? -1 : b[3] === today ? 1 : 0) || Math.abs(Date.parse(a[3]) - Date.parse(today)) - Math.abs(Date.parse(b[3]) - Date.parse(today)));
    $("#lv-list").innerHTML = kept.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("lv.org")}</th></tr></thead>
      <tbody>${kept.map(([id, name, org, date, , cc]) => html`<tr${raw(date === today ? ' class="selected"' : "")}><td class="num">${fmtDate(date, "short")}</td>
        <td><a href="#/direct/${id}">${name}</a></td><td style="font-size:12.5px">${org}${(cc || "?") !== cur ? html` <span class="muted">· ${countryName(cc || "?")}</span>` : ""}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t(!comps.length ? "lv.unavailable" : !n ? "lv.noneCountry" : "lv.none", { c: countryName(cur) })}</div>`;
    const other = !order.length ? "" : html`<span class="muted">${t("lv.elsewhere")}</span>
      ${order.map(([c, k]) => html`<button type="button" class="chip lv-cc" data-lv-country="${c}"><img class="lv-flag" src="${flag(c)}" alt="" width="16" height="12"
        loading="lazy" decoding="async">${countryName(c)} <span class="muted">${k}</span></button>`)}`;
    $$("[data-lv-else]", main).forEach((el) => { el.innerHTML = other; });
  };
  draw();
  $("#lv-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lv-country]");
    if (b) { country.pick(b.dataset.lvCountry); location.reload(); }   // the site's country, everywhere
  });
  return { title: t("lv.title") };
}

// ---- one race -------------------------------------------------------------------------------------------------------
const hs = (h) => {
  if (h == null) return "";
  const s = Math.floor(h / 100);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function nowAt(info) {
  const tz = info?.timezone || "Europe/Stockholm";
  let p;
  try { p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); }
  catch (e) { p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date()); }
  const v = (k) => Number(p.find((x) => x.type === k)?.value || 0);
  return ((v("hour") * 3600 + v("minute") * 60 + v("second")) + (info?.timezone ? 0 : (info?.timediff || 0) * 3600)) * 100;
}
/** The race's discipline, from its name and the class: sprint, VTT, ski, else forest. */
const terrainOf = (name, cls) => {
  const s = normalise(`${name} ${cls}`);
  return /\b(vtt|mtbo|mtb)\b/.test(s) ? "VTT" : /\bski\b/.test(s) ? "Ski" : /sprint/.test(s) ? "Spr" : "For";
};

// The views of a race (owner, 2026-10-22): a course; a club's runners across the courses (one's own club by default) or
// everyone still out; the latest punches (everyone's or one's club's), as a table. Three selectors side by side, the one in
// use marked; one search for a runner (opens their course, the row marked and scrolled to the middle) or a club.
const PASS_VIEW = "~passages", CLUB_VIEW = "~club";
// a class named as a category (« H21 », « D16 », « M45 »): its runners' category says nothing more
const CAT_CLASS = /^\s*[HDMW]\s?\d{2}/i;
const clubKey = (s) => normalise(String(s || "")).replace(/[^a-z0-9]+/g, " ").trim();
// a time of day (hundredths since midnight) as 10:34, with its seconds when it has some
const tod = (h) => {
  if (h == null || h < 0) return "";
  const s = Math.floor(h / 100) % 86400;
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}${s % 60 ? `:${String(s % 60).padStart(2, "0")}` : ""}`;
};
// the control symbols: a circle for a radio control, the double circle for the finish
const RADIO_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const FINISH_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

async function race(main, id, wanted, arg) {
  const st = { info: null, classes: [], counts: {}, all: new Map(), cn: {}, view: "cls", cls: null, club: "mine", pf: "all",
    sub: null, pass: [], seen: new Set(), justIn: new Map(), mark: null, markScroll: false, ws: null, up: false, tries: 0, gone: false };
  if (wanted === PASS_VIEW) { st.view = "pass"; st.pf = arg === "mine" ? "mine" : "all"; }
  else if (wanted === CLUB_VIEW) { st.view = "club"; st.club = arg || "mine"; }
  else st.cls = wanted;
  main.innerHTML = html`<div class="lv-head"><div class="lv-hl"><h1 id="lv-title">…</h1><div class="lv-sub" id="lv-sub"></div></div>
      <div class="lv-hr"><span class="lv-status" id="lv-status">${t("lv.connecting")}</span><span id="lv-method"></span></div></div>
    <div class="lv-layout">
      <aside class="lv-side"><div class="lv-list" id="lv-chips"></div></aside>
      <div class="lv-main">
        <div id="lv-pass"></div>
        <div class="lv-picks" id="lv-picks"></div>
        <div class="lv-find"><input type="search" id="lv-find" autocomplete="off" placeholder="${t("lv.find")}" aria-label="${t("lv.find.label")}">
          <div class="lv-find-list" id="lv-find-list" hidden></div></div>
        <div class="lv-note muted" id="lv-note" hidden></div>
        <section class="card lv-card"><div class="table-wrap" id="lv-rows"><div class="empty">${t("lv.loading")}</div></div></section>
      </div>
    </div>`;

  // runners of this site by name, to recognise them: [runner…] per name key
  await data.bootPrivate({ fr: sees("FR") });
  const byName = new Map();
  for (const r of data.runners().list) {
    const k = nameKey(r.nom);
    (byName.get(k) || byName.set(k, []).get(k)).push(r);
  }
  const who = (name, club) => {
    const c = byName.get(nameKey(name));
    if (!c) return null;
    if (c.length === 1) return c[0];
    const code = String(club || "").match(/\b(\d{4})/)?.[1];
    return c.find((r) => code && String(r.club || "").startsWith(code)) || null;
  };
  // one's club: France's runners of one's club (by name; the punches carry no club), and the club names the race writes
  // for them; else the club typed in one's countries
  const mine = myClub();
  const mates = mine ? new Set(data.runners().list.filter((r) => data.clubParts(r.club).code === mine).map((r) => nameKey(r.nom))) : new Set();
  const myKeys = new Set((session()?.countries || []).map((c) => clubKey(c.club)).filter(Boolean));
  const hasClub = () => !!mine || myKeys.size > 0;
  const isMine = (x) => (mine && x.me && data.clubParts(x.me.club).code === mine) || myKeys.has(clubKey(x.r[2]));
  // the CNs shown and used: the official one 15 days before the race (as FFCO uses it; the monthly snapshot before
  // that day), today's Top, and the strength (Fit) one at J-15 that values the circuit for the Top score
  // without France (owner, 2026-10-20): the race as liveresultat gives it, no CN, score or expected place
  const FR = sees("FR");
  // the method: one button naming the ranking shown, a click shows the other (the header's switch is not drawn here)
  function methodBtn() {
    const el = $("#lv-method");
    if (!el || !FR) return;
    const ms = store.available(), cur = store.get().method, next = ms[(ms.indexOf(cur) + 1) % ms.length];
    el.innerHTML = ms.length < 2 ? "" : html`<button type="button" class="btn btn-sm lv-mbtn" data-lv-method="${next}"
      title="${t("lv.method.tip", { m: methodShort(next) })}"><span class="lv-wide">${t("msw.label")} </span>${methodShort(cur)} <span aria-hidden="true">⇄</span></button>`;
  }
  methodBtn();
  async function cnFor(terrain) {
    if (!FR) return { shown: new Map(), valuer: new Map(), monthJ15: null };
    const m = store.get().method, k = `${terrain}|${m}`;
    if (st.cn[k]) return st.cn[k];
    const day = st.info?.date || new Date().toISOString().slice(0, 10);
    const j15 = new Date(Date.parse(day) - 15 * 86400e3).toISOString().slice(0, 10);
    const mJ15 = data.meta().months.filter((x) => x <= j15).pop() || data.latestMonth();
    const [shown, valuer] = await Promise.all([data.cnAt(m, terrain, m === "official" ? mJ15 : data.latestMonth()), data.cnAt(VALUER[m], terrain, mJ15)]);
    st.cn[k] = { shown, valuer, monthJ15: mJ15 };
    return st.cn[k];
  }
  /** A class's estimated race scores: circuit value = the method's mean of CN × time over its sample of the finishers
   *  holding a CN (FFCO: the arithmetic mean over the fastest ⌈2N/3⌉; the Top: its Fit's rule in the discipline),
   *  score = circuit value ÷ time; null below 3 such finishers. key: the CN that values the circuit. */
  function scores(finishers, key, terrain) {
    const held = finishers.filter((x) => x.cnv[key] && x.time > 0);
    if (held.length < 3) return () => null;
    const m = store.get().method;
    const p = m === "official" ? {} : cn.paramsFor(data.meta(), VALUER[m], terrain);
    const cv = cn.circuitValue(held.map((x) => [x.cnv[key], x.time]), { ...p, min_ranked: 3 });
    return (x) => (cv != null && x.time > 0 ? Math.round(cv / x.time) : null);
  }
  // a class's runners with what Ozimut adds: the runner recognised, their CN, the score their time earns, the place their
  // CN predicts (kept per class data and method)
  const enriched = new WeakMap();
  async function enrich(cls) {
    const d = st.all.get(cls);
    if (!d) return null;
    const m = store.get().method, hit = enriched.get(d);
    if (hit && hit.m === m) return hit.rows;
    const terrain = terrainOf(st.info?.name || "", cls);
    const c = await cnFor(terrain);
    const rows = d.rows.map((r) => {
      const me = who(r[1], r[2]);
      const get = (k) => (me ? c[k].get(me.lic) ?? null : null);
      return { r, cls, d, me, key: `${r[1]}|${r[2]}`, time: r[4] === 0 && r[3] != null ? r[3] / 100 : null, cn: get("shown"), cnv: { v: get("valuer") } };
    });
    const fin = rows.filter((x) => x.time), score = scores(fin, "v", terrain);
    for (const x of fin) x.score = score(x);
    rows.filter((x) => x.cn != null).sort((a, b) => b.cn - a.cn).forEach((x, i) => { x.expected = i + 1; });
    for (const x of rows) if (mine && x.me && data.clubParts(x.me.club).code === mine && x.r[2]) myKeys.add(clubKey(x.r[2]));
    enriched.set(d, { m, rows });
    return rows;
  }
  const kindOf = (x, now) => {
    const [, , , result, status, , , start] = x.r;
    // liveresultat's own word first (9: started, 10: entered, not started), then the start time against the clock
    return status === 0 && result != null ? "fin" : STATUS[status] ? "out" : status === 9 ? "run" : status === 10 ? "wait"
      : start != null && start <= now ? "run" : "wait";
  };

  // ---- the connection: one subscription, a course or the whole race ----
  const wantSub = () => (st.view === "cls" && !st.wantAll ? st.cls : "*");
  function subscribe() {
    const s = wantSub();
    if (!s || s === st.sub || st.ws?.readyState !== 1) return;
    st.sub = s;
    st.ws.send(JSON.stringify({ sub: s }));
  }
  function connect() {
    if (st.gone) return;
    const ws = new WebSocket(`${(LIVE || location.origin).replace(/^http/, "ws")}/ws/${id}`);
    st.ws = ws;
    ws.onopen = () => { st.up = true; st.tries = 0; st.heard = Date.now(); st.sub = null; subscribe(); status(); };
    ws.onmessage = (e) => { st.heard = Date.now(); if (e.data !== "pong") on(JSON.parse(e.data)); };
    ws.onclose = () => {
      st.up = false; st.sub = null; status();
      if (!st.gone && !document.hidden) setTimeout(connect, [1000, 2000, 5000, 10000, 30000][Math.min(st.tries++, 4)]);
    };
  }
  // heartbeat: a « ping » every 25 s, answered by the relay without waking it; nothing heard for a minute (a phone's
  // connection dead without a word: network change, sleep) — drop it and connect again
  function heartbeat() {
    const ws = st.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - (st.pinged || 0) > 25000) { st.pinged = Date.now(); try { ws.send("ping"); } catch (e) { /* closing */ } }
    if (Date.now() - (st.heard || Date.now()) > 65000) { ws.onclose = null; ws.close(); st.up = false; st.sub = null; status(); connect(); }
  }
  // the punches the relay sends (its last 30) added up over the visit, the newest first
  function addPass(items) {
    const fresh = (items || []).filter((p) => { const k = p.slice(0, 4).join("|"); return !st.seen.has(k) && st.seen.add(k); });
    st.pass = [...fresh, ...st.pass].slice(0, 300);
  }
  let later = null;
  const soon = () => { clearTimeout(later); later = setTimeout(draw, 120); };
  function on(m) {
    if (m.t === "hello") {
      st.info = m.info; st.classes = m.classes; st.counts = m.counts || st.counts;
      $("#lv-title").textContent = m.info?.name || id;
      $("#lv-sub").textContent = [m.info?.organizer, m.info?.date && fmtDate(m.info.date)].filter(Boolean).join(" · ");
      if (m.pass) addPass(m.pass);
      // no class asked for: the one of the latest arrival, else the first
      if (!st.cls || !st.classes.includes(st.cls)) st.cls = st.pass.map((x) => x[2]).find((c) => st.classes.includes(c)) || st.classes[0] || null;
      address(); subscribe(); draw();
    } else if (m.t === "classes") { st.classes = m.classes; if (!st.cls) st.cls = st.classes[0] || null; subscribe(); soon(); }
    else if (m.t === "counts") { st.counts = m.counts || {}; pickers(); }
    else if (m.t === "class" && !m.missing) {
      const prev = st.all.get(m.c);
      if (prev) {
        const before = new Set(prev.rows.filter((r) => r[3] != null && r[4] === 0).map((r) => `${r[1]}|${r[2]}`));
        for (const r of m.rows) if (r[3] != null && r[4] === 0 && !before.has(`${r[1]}|${r[2]}`)) st.justIn.set(`${r[1]}|${r[2]}`, Date.now());
      }
      st.all.set(m.c, m);
      if (st.view !== "cls" || m.c === st.cls) soon();
      if (st.finding) findList();
    } else if (m.t === "pass") { addPass(m.items); ticker(); status(); if (st.view === "pass") soon(); }
  }
  function address() {
    const tail = st.view === "pass" ? `${PASS_VIEW}/${st.pf}` : st.view === "club" ? `${CLUB_VIEW}/${encodeURIComponent(st.club)}` : encodeURIComponent(st.cls || "");
    replaceQuery({});
    history.replaceState(null, "", `#/direct/${id}/${tail}`);
  }
  // a view chosen: a course, a club (or everyone still out), the punches
  function show(view, v) {
    st.view = view;
    if (view === "cls") st.cls = v; else if (view === "club") st.club = v; else st.pf = v;
    st.wantAll = false;
    address(); subscribe(); draw();
  }

  // ---- what is drawn ----
  const countTxt = (c) => { const n = st.counts[c]; return n ? `${n[0]}/${n[1]}` : ""; };
  /** The clubs of the race (from the classes held), the most runners first: [[key, name, n]]. */
  function clubs() {
    const by = new Map();
    for (const d of st.all.values()) for (const r of d.rows) {
      const k = clubKey(r[2]);
      if (!k) continue;
      const e = by.get(k) || by.set(k, [k, r[2], 0]).get(k);
      e[2]++;
    }
    return [...by.values()].sort((a, b) => a[1].localeCompare(b[1], lang()));
  }
  function pickers() {
    const ph = (on, k) => (on ? "" : html`<option value="" selected>${t(k)}</option>`);
    const club = st.view === "club" ? st.club : null, cs = clubs();
    const picks = html`<label class="lv-pk lv-pk-c${st.view === "cls" ? " on" : ""}"><select id="lv-sel" aria-label="${t("prov.circuit")}">${ph(st.view === "cls", "lv.sel.circuit")}
        ${st.classes.map((c) => html`<option value="${c}" ${raw(st.view === "cls" && c === st.cls ? "selected" : "")}>${fmtCat(c)}${countTxt(c) ? ` · ${countTxt(c)}` : ""}</option>`)}</select></label>
      <label class="lv-pk${st.view === "club" ? " on" : ""}"><select id="lv-club" aria-label="${t("lv.sel.club")}">${ph(st.view === "club", "lv.sel.club")}
        ${hasClub() ? html`<option value="mine" ${raw(club === "mine" ? "selected" : "")}>${t("lv.club.mine")}</option>` : ""}
        <option value="run" ${raw(club === "run" ? "selected" : "")}>${t("lv.club.run")}</option>
        ${cs.length ? html`<optgroup label="${t("lv.sel.clubs")}">${cs.map(([k, n, c]) => html`<option value="${k}" ${raw(club === k ? "selected" : "")}>${n} (${c})</option>`)}</optgroup>` : ""}</select></label>
      <label class="lv-pk${st.view === "pass" ? " on" : ""}"><select id="lv-pf" aria-label="${t("lv.passView")}">${ph(st.view === "pass", "lv.passView")}
        <option value="all" ${raw(st.view === "pass" && st.pf === "all" ? "selected" : "")}>${t("lv.pass.all")}</option>
        ${hasClub() ? html`<option value="mine" ${raw(st.view === "pass" && st.pf === "mine" ? "selected" : "")}>${t("lv.pass.mine")}</option>` : ""}</select></label>`;
    // redrawn only when it changed, and never while one of them is open (owner, 2026-10-22: a selector opened on the phone
    // was replaced by the next update — counts, a class read — and the choice made in it was lost)
    const el = $("#lv-picks");
    if (picks !== st.picksHtml && !el.contains(document.activeElement)) { el.innerHTML = picks; st.picksHtml = picks; }
    else if (picks !== st.picksHtml) st.picksLate = true;
    const side = html`<div class="lv-side-title">${t("prov.circuit")} <span class="muted" title="${t("lv.count.hint")}">${t("lv.count.head")}</span></div>
      ${st.classes.map((c) => { const on = st.view === "cls" && c === st.cls; return html`<button type="button" class="lv-item${on ? " on" : ""}" aria-pressed="${on}" data-c="${c}">
        <span>${fmtCat(c)}</span><span class="lv-cnt">${countTxt(c)}</span></button>`; })}`;
    if (side !== st.sideHtml) { $("#lv-chips").innerHTML = side; st.sideHtml = side; $("#lv-chips .on")?.scrollIntoView({ block: "nearest" }); }
  }
  function status() {
    const el = $("#lv-status");
    if (!el) return;                                     // (the page was left: the socket's close lands here)
    if (!st.up) { el.className = "lv-status"; el.textContent = st.info ? t("lv.offline") : t("lv.connecting"); return; }
    const p = st.pass[0]?.[0]?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    let age = p ? nowAt(st.info) / 100 - (Number(p[1]) * 3600 + Number(p[2]) * 60 + Number(p[3])) : null;
    if (age != null && (age < -60 || age > 12 * 3600)) age = null;
    const live = age != null && age < 300;
    el.className = `lv-status${live ? " live" : ""}`;
    el.textContent = live ? t("lv.on") : age != null ? t("lv.idle", { m: Math.round(age / 60) }) : t("lv.on");
  }
  const ctlOf = (ctl, ctlName) => (ctl === 1000 ? t("lv.ev.finish") : t("lv.ev.radio", { c: ctlName || ctl }));
  // the latest punches on one line, scrolling sideways; ▾ opens them as a table
  function ticker() {
    const el = $("#lv-pass");
    if (!el) return;
    if (st.view === "pass" || !st.pass.length) { el.innerHTML = ""; return; }
    el.innerHTML = html`<div class="lv-pass"><div class="lv-strip">${st.pass.slice(0, 30).map(([at, name, cls, ctl, ctlName, time]) => html`<button type="button" class="lv-pi"
      data-go="${cls}" data-name="${name}" title="${at}"><b>${name}</b> · ${fmtCat(cls)} · ${ctlOf(ctl, ctlName)} ${time}</button>`)}</div>
      <button type="button" class="btn btn-sm lv-pexp" data-lv-view="pass" title="${t("lv.passView.tip")}" aria-label="${t("lv.passView.tip")}">▾</button></div>`;
  }
  function note() {
    const el = $("#lv-note"), held = st.classes.filter((c) => st.all.has(c)).length;
    const show = st.view !== "cls" && held < st.classes.length;
    el.hidden = !show;
    if (show) el.textContent = t("lv.loadingAll", { n: held, total: st.classes.length });
  }

  let drawing = 0;
  async function draw() {
    const my = ++drawing;
    pickers(); ticker(); note();
    let out;
    if (st.view === "cls") out = await courseTable();
    else if (st.view === "club") out = await clubTable();
    else out = await passTable();
    if (my !== drawing || out == null) return;
    $("#lv-rows").innerHTML = out;
    if (st.mark && st.markScroll) {
      const tr = [...$$("tr[data-k]", main)].find((x) => x.dataset.k === st.mark);
      if (tr) { st.markScroll = false; tr.scrollIntoView({ block: "center" }); }
    }
  }

  // one runner's line: place, name, [course,] [club,] [category,] start, time and gap, CN and expected place, score and gap
  function line(x, k, now, o) {
    const [place, name, club, result, status, timeplus, , start, splits] = x.r;
    const just = k === "fin" && Date.now() - (st.justIn.get(x.key) || 0) < JUST_IN_MS;
    const ctl = x.d.controls || [];
    let time = "", sub = "";
    if (k === "fin") { time = html`<b>${hs(result)}</b>`; sub = timeplus ? `+${hs(timeplus)}` : ""; }
    else if (k === "run") {
      const last = splits ? splits.map((s, i) => (s ? [i, s] : null)).filter(Boolean).pop() : null;
      time = html`<span class="muted" data-start="${start}">${now >= start ? hs(now - start) : ""}</span>`;
      if (last) sub = t("lv.atControl", { c: ctl[last[0]]?.[1] || "", p: last[1][1] ?? "–", d: last[1][2] ? `+${hs(last[1][2])}` : "+0:00" });
    } else if (k === "out") time = html`<span class="muted">${ST_LABEL[STATUS[status]]}</span>`;
    const two = (a, b) => html`<div>${a}</div>${b ? html`<div class="lv-2">${b}</div>` : ""}`;
    const cls = [just ? "lv-just" : "", st.mark === x.key ? "lv-mark" : ""].filter(Boolean).join(" ");
    return html`<tr data-k="${x.key}"${raw(cls ? ` class="${cls}"` : "")}${raw(just ? ` title="${t("lv.justIn")}"` : "")}>
      <td class="r num"><b>${k === "fin" ? place ?? "" : ""}</b>${o.cat && x.me?.cat ? html`<div class="lv-2 lv-m">${fmtCat(x.me.cat)}</div>` : ""}</td>
      <td class="lv-n"><div class="lv-clamp">${x.me ? html`<a href="${link.runner(x.me.lic)}">${name}</a>` : name}</div></td>
      ${o.course ? html`<td class="lv-c"><button type="button" class="lv-link" data-c="${x.cls}">${fmtCat(x.cls)}</button></td>` : ""}
      ${o.club ? html`<td class="lv-c"><div class="lv-clamp">${club}</div></td>` : ""}
      ${o.cat ? html`<td class="lv-cat lv-d">${x.me?.cat ? fmtCat(x.me.cat) : ""}</td>` : ""}
      <td class="r num lv-st">${tod(start)}</td>
      <td class="r num lv-t">${two(time, sub)}</td>
      ${FR ? html`<td class="r num">${two(x.cn != null ? fmt(x.cn) : html`<span class="muted">—</span>`, x.expected ? String(x.expected) : "")}</td>
      <td class="r num lv-sc">${x.score != null ? scoreCell(x.score, x.cn) : ""}</td>` : ""}</tr>`;
  }
  function table(groups, now, o) {
    const m = store.get().method;
    const cols = 4 + (o.course ? 1 : 0) + (o.club ? 1 : 0) + (o.cat ? 1 : 0) + (FR ? 2 : 0);
    const block = (k) => (groups[k]?.length ? html`<tr class="lv-sec"><td colspan="${cols}">${t(`lv.${k}`)} <span class="muted">${groups[k].length}</span></td></tr>
      ${groups[k].map((x) => line(x, k, now, o))}` : "");
    return html`<table class="data compact lv-table"><thead><tr><th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th>
      ${o.course ? html`<th>${t("prov.circuit")}</th>` : ""}${o.club ? html`<th>${t("prov.club")}</th>` : ""}
      ${o.cat ? html`<th class="lv-d" title="${t("prov.catCn")}">${t("prov.cat")}</th>` : ""}<th class="r">${t("lv.start")}</th>
      <th class="r">${subHead(t("prov.time"), t("lv.behind"))}</th>
      ${FR ? html`<th class="r" title="${cnLabel(m)} — ${m === "official" ? `${t("lv.cnJ15.hint")} — ` : ""}${t("lv.expected.hint")}">${subHead(t(`cn.${m}.S`), t("lv.expected"))}</th>
      <th class="r" title="${scoreLabel(m)} — ${t("lv.score.hint")}">${subHead(t("lv.score"), t("lv.gap"))}</th>` : ""}</tr></thead>
      <tbody>${block("fin")}${block("run")}${block("wait")}${block("out")}</tbody></table>`;
  }
  const grouped = (rows, now) => {
    const g = { fin: [], run: [], out: [], wait: [] };
    for (const x of rows) g[kindOf(x, now)].push(x);
    return g;
  };
  async function courseTable() {
    if (!st.cls) return html`<div class="empty">${t(st.classes.length ? "lv.loading" : "lv.noClasses")}</div>`;
    const rows = await enrich(st.cls);
    if (!rows) return html`<div class="empty">${t("lv.loading")}</div>`;
    if (!rows.length) return html`<div class="empty">${t("lv.empty")}</div>`;
    const now = nowAt(st.info), g = grouped(rows, now);
    g.fin.sort((a, b) => (a.r[0] ?? 1e9) - (b.r[0] ?? 1e9));
    g.run.sort((a, b) => (a.r[7] ?? 0) - (b.r[7] ?? 0));
    g.wait.sort((a, b) => (a.r[7] ?? 1e9) - (b.r[7] ?? 1e9));
    // the runner's category when the class does not say it (a course: « Circuit A »), from their latest race in the data
    return table(g, now, { club: true, cat: !CAT_CLASS.test(st.cls) && rows.some((x) => x.me?.cat) });
  }
  // the classes held, enriched, in the race's order
  async function everyone() {
    const out = [];
    for (const c of st.classes) { const rows = await enrich(c); if (rows) out.push(...rows); }
    return out;
  }
  async function clubTable() {
    const all = await everyone(), now = nowAt(st.info), order = new Map(st.classes.map((c, i) => [c, i]));
    const pick = st.club === "run" ? (x) => kindOf(x, now) === "run" : st.club === "mine" ? isMine : (x) => clubKey(x.r[2]) === st.club;
    const rows = all.filter(pick);
    if (!rows.length) return st.all.size < st.classes.length ? html`<div class="empty">${t("lv.loading")}</div>`
      : html`<div class="empty">${t(st.club === "run" ? "lv.run.none" : "lv.club.none")}</div>`;
    const g = grouped(rows, now), byClass = (a, b) => order.get(a.cls) - order.get(b.cls);
    g.fin.sort((a, b) => byClass(a, b) || (a.r[0] ?? 1e9) - (b.r[0] ?? 1e9));
    g.run.sort((a, b) => (a.r[7] ?? 0) - (b.r[7] ?? 0));
    g.wait.sort((a, b) => (a.r[7] ?? 1e9) - (b.r[7] ?? 1e9));
    g.out.sort(byClass);
    return table(g, now, { course: true, club: st.club === "run" || st.club === "mine" && !mine, cat: rows.some((x) => x.me?.cat) });
  }
  // the punches as a table: time of day, what (radio control or finish), runner and club, course and category, the time
  // there and the gap, the place there, the start — from the course's results when they are held (the whole race is watched)
  async function passTable() {
    const all = await everyone(), byKey = new Map();
    for (const x of all) byKey.set(`${x.cls}|${x.r[1]}`, x);
    const items = st.pass.map((p) => ({ p, x: byKey.get(`${p[2]}|${p[1]}`) }))
      .filter(({ p, x }) => st.pf === "all" || (x ? isMine(x) : mates.has(nameKey(p[1]))));
    if (!items.length) return html`<div class="empty">${t("lv.pf.none")}</div>`;
    return html`<table class="data compact lv-table lv-ptable"><thead><tr><th>${t("lv.at")}</th><th>${t("lv.ev")}</th><th>${t("prov.name")}</th>
      <th>${t("prov.circuit")}</th><th class="r">${subHead(t("prov.time"), t("lv.behind"))}</th><th class="r">${t("prov.place")}</th><th class="r">${t("lv.start")}</th></tr></thead>
      <tbody>${items.map(({ p: [at, name, cls, ctl, ctlName, time], x }) => {
        let place = "", gap = "";
        if (x && ctl === 1000 && x.r[4] === 0) { place = x.r[0] ?? ""; gap = x.r[5] ? `+${hs(x.r[5])}` : ""; }
        else if (x && ctl !== 1000) {
          const i = (x.d.controls || []).findIndex(([code]) => String(code) === String(ctl)), s = i >= 0 ? x.r[8]?.[i] : null;
          if (s) { place = s[1] ?? ""; gap = s[2] ? `+${hs(s[2])}` : s[1] === 1 ? "+0:00" : ""; }
        }
        return html`<tr class="lv-prow" data-go="${cls}" data-name="${name}">
          <td class="num muted">${String(at || "").replace(/^(\d+:\d\d):\d\d$/, "$1")}</td>
          <td><span class="lv-ev ${ctl === 1000 ? "lv-ev-fin" : "lv-ev-radio"}">${raw(ctl === 1000 ? FINISH_ICON : RADIO_ICON)} ${ctlOf(ctl, ctlName)}</span></td>
          <td class="lv-n"><div class="lv-clamp"><b>${name}</b></div>${x?.r[2] ? html`<div class="lv-2">${x.r[2]}</div>` : ""}</td>
          <td class="lv-c"><div>${fmtCat(cls)}</div>${x?.me?.cat && !CAT_CLASS.test(cls) ? html`<div class="lv-2">${fmtCat(x.me.cat)}</div>` : ""}</td>
          <td class="r num"><div><b>${time}</b></div>${gap ? html`<div class="lv-2">${gap}</div>` : ""}</td>
          <td class="r num">${place}</td><td class="r num">${x ? tod(x.r[7]) : ""}</td></tr>`;
      })}</tbody></table>`;
  }

  // ---- the search: a runner (their course, the row marked and scrolled to the middle) or a club ----
  function findList() {
    const el = $("#lv-find-list"), q = normalise($("#lv-find").value.trim());
    if (!q) { el.hidden = true; return; }
    const cs = clubs().filter(([k, n]) => normalise(n).includes(q) || k.includes(q)).slice(0, 4);
    const rs = [];
    for (const c of st.classes) for (const r of st.all.get(c)?.rows || []) if (normalise(r[1]).includes(q) && rs.length < 12) rs.push([c, r]);
    const held = st.classes.filter((c) => st.all.has(c)).length;
    el.innerHTML = html`${cs.length ? html`<div class="lv-find-head">${t("lv.find.clubs")}</div>${cs.map(([k, n, c]) => html`<button type="button" class="lv-find-item" data-club="${k}">
        <b>${n}</b> <span class="muted">${c}</span></button>`)}` : ""}
      ${rs.length ? html`<div class="lv-find-head">${t("lv.find.runners")}</div>${rs.map(([c, r]) => html`<button type="button" class="lv-find-item" data-go="${c}" data-name="${r[1]}">
        <b>${r[1]}</b> <span class="muted">${r[2]} · ${fmtCat(c)}</span></button>`)}` : ""}
      ${!cs.length && !rs.length ? html`<div class="lv-find-empty muted">${t("lv.find.none")}</div>` : ""}
      ${held < st.classes.length ? html`<div class="lv-find-empty muted">${t("lv.loadingAll", { n: held, total: st.classes.length })}</div>` : ""}`;
    el.hidden = false;
  }
  function goRunner(cls, name) {
    const r = st.all.get(cls)?.rows.find((x) => x[1] === name);
    st.mark = r ? `${r[1]}|${r[2]}` : null; st.markScroll = !!r;
    show("cls", cls);
  }
  const closeFind = () => { st.finding = false; $("#lv-find-list").hidden = true; };

  main.addEventListener("click", (e) => {
    const m = e.target.closest("[data-lv-method]");
    if (m) { store.setMethod(m.dataset.lvMethod); methodBtn(); draw(); return; }
    if (e.target.closest("[data-lv-view]")) { show("pass", "all"); window.scrollTo({ top: 0 }); return; }
    const fc = e.target.closest("[data-club]");
    if (fc) { closeFind(); $("#lv-find").value = ""; show("club", fc.dataset.club); return; }
    const go = e.target.closest("[data-go]");
    if (go && !e.target.closest("a")) { closeFind(); $("#lv-find").value = ""; goRunner(go.dataset.go, go.dataset.name); return; }
    if (e.target.closest("a, select, input")) return;
    const b = e.target.closest("[data-c]"); if (b) { st.mark = null; show("cls", b.dataset.c); }
  });
  main.addEventListener("change", (e) => {
    const v = e.target.value;
    if (e.target.closest("#lv-picks")) e.target.blur();              // (its redraw waits while it has the focus)
    if (!v) return;
    if (e.target.id === "lv-sel") { st.mark = null; show("cls", v); }
    else if (e.target.id === "lv-club") show("club", v);
    else if (e.target.id === "lv-pf") show("pass", v);
  });
  // the club list and the search need every course: the whole race is watched from then on
  main.addEventListener("focusin", (e) => {
    if (e.target.id === "lv-club" || e.target.id === "lv-find") { st.wantAll = true; subscribe(); }
    if (e.target.id === "lv-find") { st.finding = true; findList(); }
  });
  main.addEventListener("focusout", (e) => {
    if (e.target.closest?.("#lv-picks")) setTimeout(() => { if (st.picksLate && !$("#lv-picks").contains(document.activeElement)) { st.picksLate = false; pickers(); } }, 0);
  });
  main.addEventListener("pointerdown", (e) => { if (e.target.closest("#lv-club, #lv-find")) { st.wantAll = true; subscribe(); } });
  main.addEventListener("input", (e) => { if (e.target.id === "lv-find") { st.wantAll = true; subscribe(); st.finding = true; findList(); } });
  main.addEventListener("keydown", (e) => {
    if (e.target.id !== "lv-find") return;
    if (e.key === "Escape") { closeFind(); e.target.blur(); }
    else if (e.key === "Enter") { e.preventDefault(); $("#lv-find-list .lv-find-item")?.click(); }
  });
  const away = (e) => { if (!e.target.closest(".lv-find")) closeFind(); };
  document.addEventListener("pointerdown", away);
  const tick = setInterval(() => {
    if (!main.isConnected) { cleanup(); return; }
    status();
    heartbeat();
    const now = nowAt(st.info);
    $$("[data-start]", main).forEach((el) => { const s = Number(el.dataset.start); el.textContent = now >= s ? hs(now - s) : ""; });
  }, 1000);
  const vis = () => { if (!document.hidden && (!st.ws || st.ws.readyState > 1)) connect(); };
  document.addEventListener("visibilitychange", vis);
  function cleanup() {
    st.gone = true; clearInterval(tick); clearTimeout(later);
    document.removeEventListener("visibilitychange", vis);
    document.removeEventListener("pointerdown", away);
    st.ws?.close();
  }
  connect();
  return { title: t("lv.title"), cleanup };
}
