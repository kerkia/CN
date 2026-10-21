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
  const parts = path.split("/").filter(Boolean).slice(1);          // #/direct/<race>/<class>
  return parts[0] && /^\d+$/.test(parts[0]) ? race(main, parts[0], parts[1] ? decodeURIComponent(parts[1]) : null) : list(main, query);
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
      ${order.map(([c, k]) => html`<button type="button" class="chip" data-lv-country="${c}">${countryName(c)} <span class="muted">${k}</span></button>`)}`;
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

// the latest punches: the filter kept on the device (all, one's club's runners, the course shown, hidden)
const PASS_VIEW = "~passages";                    // the picker's entry that shows them as a list in place of a course
const passPref = { get: () => { try { return localStorage.getItem("ocn.live.pass") || "all"; } catch (e) { return "all"; } },
  set: (v) => { try { localStorage.setItem("ocn.live.pass", v); } catch (e) { /* this visit only */ } } };
// a class named as a category (« H21 », « D16 », « M45 »): its runners' category says nothing more
const CAT_CLASS = /^\s*[HDMW]\s?\d{2}/i;

async function race(main, id, wanted) {
  const st = { info: null, classes: [], cls: wanted === PASS_VIEW ? null : wanted, view: wanted === PASS_VIEW ? "pass" : "cls",
    data: null, justIn: new Map(), pass: [], seen: new Set(), counts: {}, ws: null, up: false, tries: 0, gone: false, cn: {}, terrain: null,
    pf: passPref.get() };
  // the page (owner, 2026-10-21: compact on a phone, one scrollbar): the race's name, organiser and day on the left, the
  // status and the ranking's button on the right, two lines; the latest punches on one line that scrolls sideways (or as a
  // list, the picker's first entry); the course picker with each course's finishers; the table, every runner on two lines
  main.innerHTML = html`<div class="lv-head"><div class="lv-hl"><h1 id="lv-title">…</h1><div class="lv-sub" id="lv-sub"></div></div>
      <div class="lv-hr"><span class="lv-status" id="lv-status">${t("lv.connecting")}</span><span id="lv-method"></span></div></div>
    <div class="lv-layout">
      <aside class="lv-side"><div class="lv-list" id="lv-chips"></div></aside>
      <div class="lv-main">
        <div id="lv-pass"></div>
        <label class="lv-pick"><select id="lv-sel" aria-label="${t("prov.circuit")}"></select></label>
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
  // one's club's runners, by name (the punches carry no club): France's data only
  const mine = myClub();
  const mates = mine ? new Set(data.runners().list.filter((r) => data.clubParts(r.club).code === mine).map((r) => nameKey(r.nom))) : null;
  if (st.pf === "club" && !mates) st.pf = "all";
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
   *  holding a CN (FFCO: the arithmetic mean over the fastest ⌈2N/3⌉; the Top: its Fit's rule in the discipline —
   *  geometric, the whole field in forest), score = circuit value ÷ time; null below 3 such finishers. key: the CN
   *  that values the circuit. */
  function scores(finishers, key, terrain) {
    const held = finishers.filter((x) => x.cnv[key] && x.time > 0);
    if (held.length < 3) return () => null;
    const m = store.get().method;
    const p = m === "official" ? {} : cn.paramsFor(data.meta(), VALUER[m], terrain);
    const cv = cn.circuitValue(held.map((x) => [x.cnv[key], x.time]), { ...p, min_ranked: 3 });
    return (x) => (cv != null && x.time > 0 ? Math.round(cv / x.time) : null);
  }

  function connect() {
    if (st.gone) return;
    const ws = new WebSocket(`${(LIVE || location.origin).replace(/^http/, "ws")}/ws/${id}`);
    st.ws = ws;
    ws.onopen = () => { st.up = true; st.tries = 0; st.heard = Date.now(); if (st.cls) ws.send(JSON.stringify({ sub: st.cls })); status(); };
    ws.onmessage = (e) => { st.heard = Date.now(); if (e.data !== "pong") on(JSON.parse(e.data)); };
    ws.onclose = () => {
      st.up = false; status();
      if (!st.gone && !document.hidden) setTimeout(connect, [1000, 2000, 5000, 10000, 30000][Math.min(st.tries++, 4)]);
    };
  }
  // heartbeat: a « ping » every 25 s, answered by the relay without waking it; nothing heard for a minute (a phone's
  // connection dead without a word: network change, sleep) — drop it and connect again
  function heartbeat() {
    const ws = st.ws;
    if (!ws || ws.readyState !== 1) return;
    if (Date.now() - (st.pinged || 0) > 25000) { st.pinged = Date.now(); try { ws.send("ping"); } catch (e) { /* closing */ } }
    if (Date.now() - (st.heard || Date.now()) > 65000) { ws.onclose = null; ws.close(); st.up = false; status(); connect(); }
  }
  // the punches the relay sends (its last 30) added up over the visit, the newest first
  function addPass(items) {
    const fresh = (items || []).filter((p) => { const k = p.slice(0, 4).join("|"); return !st.seen.has(k) && st.seen.add(k); });
    st.pass = [...fresh, ...st.pass].slice(0, 300);
  }
  function on(m) {
    if (m.t === "hello") {
      st.info = m.info; st.classes = m.classes; st.counts = m.counts || st.counts;
      $("#lv-title").textContent = m.info?.name || id;
      $("#lv-sub").textContent = [m.info?.organizer, m.info?.date && fmtDate(m.info.date)].filter(Boolean).join(" · ");
      if (m.pass) addPass(m.pass);
      // no class asked for: the one of the latest arrival, else the first
      const latest = st.pass.map((x) => x[2]).find((c) => st.classes.includes(c));
      if (!st.cls || !st.classes.includes(st.cls)) pick(latest || st.classes[0], true);
      chips(); ticker();
      if (!st.classes.length) $("#lv-rows").innerHTML = html`<div class="empty">${t("lv.noClasses")}</div>`;
    } else if (m.t === "classes") { st.classes = m.classes; if (!st.cls) pick(st.classes[0], true); chips(); }
    else if (m.t === "counts") { st.counts = m.counts || {}; chips(); }
    else if (m.t === "class" && m.c === st.cls) {
      if (st.data) {
        const before = new Set(st.data.rows.filter((r) => r[3] != null && r[4] === 0).map((r) => `${r[1]}|${r[2]}`));
        for (const r of m.rows) if (r[3] != null && r[4] === 0 && !before.has(`${r[1]}|${r[2]}`)) st.justIn.set(`${r[1]}|${r[2]}`, Date.now());
      }
      st.data = m; rows();
    } else if (m.t === "pass") { addPass(m.items); ticker(); status(); }
  }
  const address = () => history.replaceState(null, "", `#/direct/${id}/${encodeURIComponent(st.view === "pass" ? PASS_VIEW : st.cls || "")}`);
  // a course chosen (keep: the punches' list stays shown, the course behind it — the one its filter « this course » means)
  function pick(c, keep) {
    if (!c) return;
    if (!keep) st.view = "cls";
    if (c !== st.cls) {
      st.cls = c; st.data = null; st.justIn.clear();
      if (st.ws?.readyState === 1) st.ws.send(JSON.stringify({ sub: c }));
    }
    replaceQuery({});
    address();
    chips(); ticker();
    if (st.view === "cls") { if (st.data) rows(); else $("#lv-rows").innerHTML = html`<div class="empty">${t("lv.loading")}</div>`; }
  }
  function showPass() { st.view = "pass"; address(); chips(); ticker(); }
  const countTxt = (c) => { const n = st.counts[c]; return n ? `${n[0]}/${n[1]}` : ""; };
  function chips() {
    const passOn = st.view === "pass";
    $("#lv-chips").innerHTML = html`<button type="button" class="lv-item lv-item-pass${passOn ? " on" : ""}" aria-pressed="${passOn}" data-lv-view="pass">${t("lv.passView")}</button>
      <div class="lv-side-title">${t("prov.circuit")} <span class="muted" title="${t("lv.count.hint")}">${t("lv.count.head")}</span></div>
      ${st.classes.map((c) => { const on = !passOn && c === st.cls; return html`<button type="button" class="lv-item${on ? " on" : ""}" aria-pressed="${on}" data-c="${c}">
        <span>${fmtCat(c)}</span><span class="lv-cnt">${countTxt(c)}</span></button>`; })}`;
    $("#lv-sel").innerHTML = html`<option value="${PASS_VIEW}" ${raw(passOn ? "selected" : "")}>${t("lv.passView")}</option>
      <optgroup label="${t("prov.circuit")} · ${t("lv.count.head")}">${st.classes.map((c) => html`<option value="${c}" ${raw(!passOn && c === st.cls ? "selected" : "")}>${fmtCat(c)}${countTxt(c) ? ` · ${countTxt(c)}` : ""}</option>`)}</optgroup>`;
    $("#lv-chips .on")?.scrollIntoView({ block: "nearest" });
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
  // the punches the filter keeps
  const kept = () => st.pass.filter(([, name, cls]) => st.pf === "all" || (st.pf === "club" ? mates?.has(nameKey(name)) : st.pf === "cls" ? cls === st.cls : false));
  const ctlOf = (ctl, ctlName) => (ctl === 1000 ? t("lv.finish") : ctlName || ctl);
  const filterSel = () => html`<select class="lv-pf" id="lv-pf" aria-label="${t("lv.pf.label")}" title="${t("lv.pf.label")}">
    ${[["all", t("lv.pf.all")], ...(mates ? [["club", t("lv.pf.club")]] : []), ...(st.cls ? [["cls", t("lv.pf.cls", { c: fmtCat(st.cls) })]] : []),
      ...(st.view === "pass" ? [] : [["off", t("lv.pf.off")]])].map(([v, l]) => html`<option value="${v}" ${raw(v === st.pf ? "selected" : "")}>${l}</option>`)}</select>`;
  function ticker() {
    const el = $("#lv-pass");
    if (!el) return;
    if (st.view === "pass") { el.innerHTML = ""; passList(); return; }
    if (!st.pass.length) { el.innerHTML = ""; return; }
    const items = st.pf === "off" ? [] : kept().slice(0, 30);
    el.innerHTML = html`<div class="lv-pass">${filterSel()}
      ${st.pf === "off" ? "" : html`<div class="lv-strip">${items.length ? items.map(([at, name, cls, ctl, ctlName, time]) => html`<button type="button" class="lv-pi" data-c="${cls}"
        title="${at}"><b>${name}</b> · ${fmtCat(cls)} · ${ctlOf(ctl, ctlName)} ${time}</button>`) : html`<span class="muted">${t("lv.pf.none")}</span>`}</div>
      <button type="button" class="btn btn-sm lv-pexp" data-lv-view="pass" title="${t("lv.passView.tip")}" aria-label="${t("lv.passView.tip")}">▾</button>`}</div>`;
  }
  // the punches as a list, in place of a course's results (the picker's first entry, or ▾ beside the line)
  function passList() {
    if (st.pf === "off") st.pf = "all";
    const items = kept();
    $("#lv-rows").innerHTML = html`<div class="lv-plhead"><label>${t("lv.pf.label")} ${filterSel()}</label><span class="muted">${t("lv.passList.hint")}</span></div>
      ${items.length ? html`<table class="data compact lv-table lv-plist"><thead><tr><th>${t("lv.at")}</th><th>${t("prov.name")}</th><th>${t("prov.circuit")}</th>
        <th>${t("lv.ctl")}</th><th class="r">${t("prov.time")}</th></tr></thead><tbody>
        ${items.map(([at, name, cls, ctl, ctlName, time]) => html`<tr class="lv-prow" data-c="${cls}"><td class="num muted">${String(at || "").replace(/^(\d+:\d\d):\d\d$/, "$1")}</td>
          <td><b>${name}</b></td><td>${fmtCat(cls)}</td><td>${ctlOf(ctl, ctlName)}</td><td class="r num">${time}</td></tr>`)}</tbody></table>`
        : html`<div class="empty">${t("lv.pf.none")}</div>`}`;
  }

  async function rows() {
    const d = st.data;
    if (!d || st.view !== "cls") return;
    st.terrain = terrainOf(st.info?.name || "", st.cls);
    const cn = await cnFor(st.terrain);
    if (st.view !== "cls" || d !== st.data) return;
    const now = nowAt(st.info);
    const ctl = d.controls || [];
    const enriched = d.rows.map((r) => {
      const me = who(r[1], r[2]);
      const get = (k) => (me ? cn[k].get(me.lic) ?? null : null);
      return { r, me, time: r[4] === 0 && r[3] != null ? r[3] / 100 : null, cn: get("shown"), cnv: { v: get("valuer") } };
    });
    // the score each finisher's time earns, estimated on the class's finishers (its circuit's when it is one)
    const fin = enriched.filter((x) => x.time);
    const score = scores(fin, "v", st.terrain);
    for (const x of fin) x.score = score(x);
    // the place each runner's CN predicts, among those of the class who hold one
    const ranked = enriched.filter((x) => x.cn != null).sort((a, b) => b.cn - a.cn);
    ranked.forEach((x, i) => { x.expected = i + 1; });
    const kind = (x) => {
      const [, , , result, status, , , start] = x.r;
      return status === 0 && result != null ? "fin" : STATUS[status] ? "out" : start != null && start <= now ? "run" : "wait";
    };
    const groups = { fin: [], run: [], out: [], wait: [] };
    for (const x of enriched) groups[kind(x)].push(x);
    groups.fin.sort((a, b) => (a.r[0] ?? 1e9) - (b.r[0] ?? 1e9));
    groups.run.sort((a, b) => (a.r[7] ?? 0) - (b.r[7] ?? 0));
    groups.wait.sort((a, b) => (b.cn ?? -1) - (a.cn ?? -1));
    // the runner's category when the class does not say it (a course: « Circuit A »), from their latest race in the data
    const withCat = !CAT_CLASS.test(st.cls) && enriched.some((x) => x.me?.cat);
    const two = (a, b) => html`<div>${a}</div>${b ? html`<div class="lv-2">${b}</div>` : ""}`;
    const line = (x, k) => {
      const [place, name, club, result, status, timeplus, , start, splits] = x.r;
      const just = k === "fin" && Date.now() - (st.justIn.get(`${name}|${club}`) || 0) < JUST_IN_MS;
      let time = "", sub = "";
      if (k === "fin") { time = html`<b>${hs(result)}</b>`; sub = timeplus ? `+${hs(timeplus)}` : ""; }
      else if (k === "run") {
        const last = splits ? splits.map((s, i) => (s ? [i, s] : null)).filter(Boolean).pop() : null;
        time = html`<span class="muted" data-start="${start}">${hs(now - start)}</span>`;
        if (last) sub = t("lv.atControl", { c: ctl[last[0]]?.[1] || "", p: last[1][1] ?? "–", d: last[1][2] ? `+${hs(last[1][2])}` : "+0:00" });
      } else if (k === "wait") time = html`<span class="muted">${start != null ? hs(start).replace(/^(\d+):(\d\d):\d\d$/, "$1:$2") : ""}</span>`;
      else time = html`<span class="muted">${ST_LABEL[STATUS[status]]}</span>`;
      return html`<tr${raw(just ? ` class="lv-just" title="${t("lv.justIn")}"` : "")}>
        <td class="r num"><b>${k === "fin" ? place ?? "" : ""}</b>${withCat && x.me?.cat ? html`<div class="lv-2 lv-m">${fmtCat(x.me.cat)}</div>` : ""}</td>
        <td class="lv-n"><div class="lv-clamp">${x.me ? html`<a href="${link.runner(x.me.lic)}">${name}</a>` : name}</div></td>
        <td class="lv-c"><div class="lv-clamp">${club}</div></td>
        ${withCat ? html`<td class="lv-cat lv-d">${x.me?.cat ? fmtCat(x.me.cat) : ""}</td>` : ""}
        <td class="r num lv-t">${two(time, sub)}</td>
        ${FR ? html`<td class="r num">${two(x.cn != null ? fmt(x.cn) : html`<span class="muted">—</span>`, x.expected ? String(x.expected) : "")}</td>
        <td class="r num lv-sc">${x.score != null ? scoreCell(x.score, x.cn) : ""}</td>` : ""}</tr>`;
    };
    const cols = 4 + (withCat ? 1 : 0) + (FR ? 2 : 0);
    const block = (k) => (groups[k].length ? html`<tr class="lv-sec"><td colspan="${cols}">${t(`lv.${k}`)} <span class="muted">${groups[k].length}</span></td></tr>
      ${groups[k].map((x) => line(x, k))}` : "");
    const m = store.get().method;
    $("#lv-rows").innerHTML = d.rows.length ? html`<table class="data compact lv-table"><thead><tr><th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th>
      <th>${t("prov.club")}</th>${withCat ? html`<th class="lv-d" title="${t("prov.catCn")}">${t("prov.cat")}</th>` : ""}<th class="r">${subHead(t("prov.time"), t("lv.behind"))}</th>
      ${FR ? html`<th class="r" title="${cnLabel(m)} — ${m === "official" ? `${t("lv.cnJ15.hint")} — ` : ""}${t("lv.expected.hint")}">${subHead(t(`cn.${m}.S`), t("lv.expected"))}</th>
      <th class="r" title="${scoreLabel(m)} — ${t("lv.score.hint")}">${subHead(t("lv.score"), t("lv.gap"))}</th>` : ""}</tr></thead>
      <tbody>${block("fin")}${block("run")}${block("wait")}${block("out")}</tbody></table>`
      : html`<div class="empty">${t("lv.empty")}</div>`;
  }

  main.addEventListener("click", (e) => {
    const m = e.target.closest("[data-lv-method]");
    if (m) { store.setMethod(m.dataset.lvMethod); methodBtn(); rows(); return; }
    if (e.target.closest("[data-lv-view]")) { showPass(); window.scrollTo({ top: 0 }); return; }
    if (e.target.closest("a, select")) return;
    const b = e.target.closest("[data-c]"); if (b) pick(b.dataset.c);
  });
  main.addEventListener("change", (e) => {
    if (e.target.id === "lv-sel") { if (e.target.value === PASS_VIEW) showPass(); else pick(e.target.value); }
    else if (e.target.id === "lv-pf") { st.pf = e.target.value; passPref.set(st.pf); ticker(); }
  });
  const tick = setInterval(() => {
    if (!main.isConnected) { cleanup(); return; }
    status();
    heartbeat();
    const now = nowAt(st.info);
    $$("[data-start]", main).forEach((el) => { el.textContent = hs(now - Number(el.dataset.start)); });
  }, 1000);
  const vis = () => { if (!document.hidden && (!st.ws || st.ws.readyState > 1)) connect(); };
  document.addEventListener("visibilitychange", vis);
  function cleanup() {
    st.gone = true; clearInterval(tick);
    document.removeEventListener("visibilitychange", vis);
    st.ws?.close();
  }
  connect();
  return { title: t("lv.title"), cleanup };
}
