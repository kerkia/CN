// Administration (the administrator only), in tabs. « Comptes »: every account, duplicates by licence
// flagged, rights, disable / re-enable / delete, and the administrator's own e-mail at each new account.
// « Inscrits » (2026-10-15): the registered and active accounts (a visit in the last 21 days), today and day by day.
// « Utilisation »: how much the site is used over any period — visits, page views, active days, per account
// and per page. « Démo » (2026-10-18): the demo accounts — read-only, tied to no licence, for a set time — made for a
// federation, a league or a club that wants to see the site. The server enforces the role; this page only reads and acts.

import { html, raw, $, $$, normalise, fmt, fmtDate } from "../util.js";
import { t, LANGS, LANG_NAMES } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { tile, seg, chartCard, bindChartCard, legend, setLede } from "../ui.js";
import { columnChart, timeChart, css } from "../charts.js";
import { link, replaceQuery } from "../app.js";

const PRESETS = ["7", "30", "90", "365", "all"];
const isoDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });     // YYYY-MM-DD, Paris
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ACTIVE_DAYS = 21;         // « active »: used the site at least once in the last 21 days (owner, 2026-10-15)
const parisDay = (iso) => isoDay(new Date(iso));
const spanDays = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400e3) + 1;

/** The label of a page counted by api/track. */
function pageName(k) {
  const NAMES = { overview: "nav.overview", ranking: "nav.ranking", runner: "nav.runner", compare: "nav.compare", clubs: "nav.clubs",
    club: "ad.pg.club", clubcompare: "ad.pg.clubcompare", courses: "nav.courses", agenda: "nav.agenda", methods: "nav.methods",
    settings: "st.link", contact: "ct.title", admin: "ad.title", provisional: "prov.title", splits: "spl.title",
    deposit: "dep.title", live: "lv.title", relays: "rl.title", analysis: "nav.analysis.long", games: "nav.games", vma: "nav.vma",
    analysisPerso: "nav.analysisPerso.long", analysisClub: "nav.analysisClub.long", analysisRace: "nav.analysisRace.long",
    orgRace: "sh.org.race.title", orgTraining: "sh.org.club.title", orgResults: "or.title", orgStarts: "os.title", orgDirect: "nav.orgDirect", ask: "nav.ask", orgTracer: "nav.orgTracer", categories: "cg.title", needCountry: "cty.need.title" };
  if (k.startsWith("network:")) {
    const v = k.slice(8);
    return v === "ego" || v === "leaders" ? t(`nw.mode.${v}`) : `${t("nav.network")} · ${t(`nw.mode.${v}`)}`;
  }
  return NAMES[k] ? t(NAMES[k]) : k;
}

export async function render(main, { query = {} } = {}) {
  const r = await fetch("api/admin/users", { credentials: "same-origin", cache: "no-store" });
  if (r.status === 401) { window.dispatchEvent(new Event("cnx:unauthorised")); return null; }
  if (!r.ok) {
    main.innerHTML = html`<div class="notice">${t("ad.forbidden")}</div>`;
    return { title: t("ad.title") };
  }
  let { users, duplicates, queued, me } = await r.json();
  let tab = { inscrits: "members", utilisation: "usage", depots: "uploads", sites: "sites", anonymises: "anon", demo: "demo" }[query.onglet] || "accounts";

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ad.title")}</h1><p class="lede" id="page-lede"></p></div>
      <div class="row" style="gap:8px"><div id="ad-tabs"></div></div></div>
    <div data-panel="accounts" hidden>
      <div class="tiles tiles-compact" id="ad-tiles" style="margin-bottom:14px"></div>
      <div class="filters">
        <label class="field"><span>${t("ad.search")}</span><input type="search" id="ad-q" style="width:260px"></label>
        <label class="check" style="align-self:flex-end;height:34px;align-items:center"><input type="checkbox" id="ad-dups"><span>${t("ad.onlyDups")}</span></label>
        <label class="check" style="align-self:flex-end;height:34px;align-items:center;margin-left:auto"><input type="checkbox" id="ad-signup"
          ${raw(me?.signupAlert ? "checked" : "")}><span>${t("ad.signupAlert")}</span></label>
      </div>
      <section class="card"><div class="table-wrap" id="ad-table"></div></section>
    </div>
    <div data-panel="members" hidden>
      <div class="filters"><label class="check" style="height:34px;align-items:center"><input type="checkbox" id="m-noadmins" checked>
        <span>${t("ad.u.noAdmins")}</span></label></div>
      <div class="tiles" id="m-tiles" style="margin-bottom:16px"></div>
      ${chartCard({ id: "m-chart", title: t("ad.m.chart"), hint: t("ad.m.chart.hint", { n: ACTIVE_DAYS }) })}
      <p class="muted" id="m-note" style="font-size:12.5px;margin:10px 2px 0"></p>
    </div>
    <div data-panel="usage" hidden>
      <div class="filters" id="u-filters"></div>
      <div class="tiles" id="u-tiles" style="margin-bottom:16px"></div>
      ${chartCard({ id: "u-chart", title: t("ad.u.chart"), hint: t("ad.u.chart.hint"), short: true })}
      <div class="grid grid-main-side" style="margin-top:16px;align-items:start">
        <section class="card"><div class="card-head"><div><h2>${t("ad.u.byUser")}</h2><div class="hint">${t("ad.u.byUser.hint")}</div></div></div>
          <div class="table-wrap" id="u-users"></div></section>
        <section class="card"><div class="card-head"><h2>${t("ad.u.byPage")}</h2></div><div class="table-wrap" id="u-pages"></div></section>
      </div>
      <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("ad.u.def")}</p>
    </div>
    <div data-panel="sites" hidden>
      <p class="muted" style="margin:0 2px 12px">${t("ad.st.lede")}</p>
      <section class="card"><div class="table-wrap" id="st-list"></div></section>
    </div>
    <div data-panel="anon" hidden>
      <p class="muted" style="margin:0 2px 12px">${t("ad.an.lede")}</p>
      <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${t("ad.an.add")}</h2></div>
        <div class="card-body">
          <div class="filters" style="margin:0 0 10px;padding:0;border:0;background:none">
            <label class="field"><span>${t("ad.an.search")}</span><input type="search" id="an-q" style="width:260px" autocomplete="off"></label>
            <label class="field"><span>${t("ad.an.note")}</span><input type="text" id="an-note" maxlength="200" style="width:300px"></label>
          </div>
          <div id="an-found"></div>
          <p class="muted" id="an-msg" style="font-size:12.5px;margin:8px 0 0"></p>
        </div></section>
      <section class="card"><div class="card-head"><h2 id="an-title">${t("ad.an.list")}</h2></div><div class="table-wrap" id="an-list"></div></section>
    </div>
    <div data-panel="demo" hidden>
      <p class="muted" style="margin:0 2px 12px">${t("ad.dm.lede")}</p>
      <section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${t("ad.dm.new")}</h2></div>
        <div class="card-body">
          <form id="dm-form" class="filters" style="margin:0;padding:0;border:0;background:none;align-items:flex-end">
            <label class="field"><span>${t("ad.dm.label")}</span><input id="dm-label" required maxlength="80" style="width:240px"
              placeholder="${t("ad.dm.label.ph")}"></label>
            <label class="field"><span>${t("ad.dm.email")}</span><input id="dm-email" type="email" maxlength="120" style="width:240px"
              placeholder="${t("ad.dm.email.ph")}"></label>
            <label class="field"><span>${t("ad.dm.days")}</span><input id="dm-days" type="number" min="1" max="365" value="30" style="width:90px"></label>
            <label class="field"><span>${t("st.lang")}</span><select id="dm-lang">${LANGS.map((l) => html`<option value="${l}">${LANG_NAMES[l]}</option>`)}</select></label>
            <button class="btn btn-primary" type="submit">${t("ad.dm.create")}</button>
          </form>
          <div id="dm-made" style="margin-top:12px"></div>
        </div></section>
      <section class="card"><div class="card-head"><h2>${t("ad.dm.list")}</h2></div><div class="table-wrap" id="dm-list"></div></section>
    </div>
    <div data-panel="uploads" hidden>
      <p class="muted" style="margin:0 2px 12px">${t("ad.up.lede")}</p>
      <section class="card"><div class="table-wrap" id="up-list"></div></section>
    </div>`;

  function showTab() {
    $("#ad-tabs").innerHTML = seg("adtab", [["accounts", t("ad.tab.accounts")], ["members", t("ad.tab.members")], ["usage", t("ad.tab.usage")], ["uploads", t("ad.tab.uploads")],
      ["sites", t("ad.tab.sites")], ["anon", t("ad.tab.anon")], ["demo", t("ad.tab.demo")]], tab);
    $$('[data-seg="adtab"]').forEach((b) => b.addEventListener("click", () => { tab = b.dataset.value; showTab(); }));
    $$("[data-panel]", main).forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    setLede(t(`ad.lede.${tab}`));       // the head says what the tab shows (one line: the tabs' own paragraphs say more)
    if (tab === "usage") saveUsage(); else replaceQuery({ members: { onglet: "inscrits" }, uploads: { onglet: "depots" }, sites: { onglet: "sites" }, anon: { onglet: "anonymises" }, demo: { onglet: "demo" } }[tab] || {});   // the address keeps the usage filters
    if (tab === "usage" && !usageStarted) { usageStarted = true; startUsage(); }
    if (tab === "members") drawMembers();
    if (tab === "uploads") drawUploads();
    if (tab === "sites") drawSites();
    if (tab === "anon") drawAnon();
    if (tab === "demo") drawDemo();
  }

  // « Démo »: the demo accounts. A password is shown once, when made or renewed: to be sent with the address and the site's link
  let demoBound = false;
  function showMade(email, password) {
    const text = t("ad.dm.message", { site: location.origin, email, password });
    $("#dm-made").innerHTML = html`<div class="notice ok" style="white-space:pre-line">${text}</div>
      <div class="row" style="gap:8px;margin-top:8px"><button type="button" class="btn btn-sm" id="dm-copy">${t("ad.dm.copy")}</button>
        <span class="muted" style="font-size:12.5px">${t("ad.dm.once")}</span></div>`;
    $("#dm-copy").addEventListener("click", (e) => navigator.clipboard?.writeText(text).then(() => { e.target.textContent = t("ad.dm.copied"); }));
  }
  async function drawDemo() {
    if (!demoBound) {
      demoBound = true;
      $("#dm-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const res = await auth.api("api/admin/demo", { label: $("#dm-label").value, email: $("#dm-email").value || undefined,
          days: Number($("#dm-days").value), lang: $("#dm-lang").value });
        if (!res.ok) {
          $("#dm-made").innerHTML = html`<div class="notice">${t(res.data?.error === "exists" ? "ad.dm.err.exists" : res.data?.error === "email" ? "ad.dm.err.email" : "ac.err.generic")}</div>`;
          return;
        }
        e.target.reset();
        showMade(res.data.account.email, res.data.password);
        drawDemo();
      });
    }
    const box = $("#dm-list");
    const r = await fetch("api/admin/demo", { credentials: "same-origin", cache: "no-store" });
    const { accounts = [], today = "" } = r.ok ? await r.json() : {};
    box.innerHTML = accounts.length ? html`<table class="data compact"><thead><tr><th>${t("ad.dm.label")}</th><th>${t("ad.dm.email")}</th>
      <th>${t("ad.dm.until")}</th><th>${t("ad.dm.last")}</th><th></th></tr></thead>
      <tbody>${accounts.map((a) => {
        const over = a.until < today, off = a.status !== "active";
        return html`<tr>
          <td>${a.label}</td><td style="font-size:12.5px">${a.email}</td>
          <td class="num">${fmtDate(a.until)} ${over ? html`<span class="tag">${t("ad.dm.expired")}</span>` : off ? html`<span class="tag">${t("ad.dm.off")}</span>` : ""}</td>
          <td class="num" style="font-size:12.5px">${a.lastLogin ? fmtDate(a.lastLogin.slice(0, 10), "short") : "—"}</td>
          <td><div class="row" style="gap:6px;flex-wrap:wrap">
            <button type="button" class="btn btn-sm" data-dm="extend" data-id="${a.id}">${t("ad.dm.extend")}</button>
            <button type="button" class="btn btn-sm" data-dm="password" data-id="${a.id}" data-email="${a.email}">${t("ad.dm.password")}</button>
            <button type="button" class="btn btn-sm" data-dm="${off ? "enable" : "disable"}" data-id="${a.id}">${t(off ? "ad.dm.enable" : "ad.dm.disable")}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-dm="delete" data-id="${a.id}" style="color:var(--bad)">${t("ad.dm.delete")}</button>
          </div></td></tr>`;
      })}</tbody></table>` : html`<div class="empty">${t("ad.dm.none")}</div>`;
    $$("[data-dm]", box).forEach((btn) => btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id), act = btn.dataset.dm;
      if (act === "delete" && !confirm(t("ad.dm.confirm"))) return;
      btn.disabled = true;
      const res = act === "extend" || act === "password" ? await auth.api("api/admin/demo", { id, action: act, days: 30 })
        : await auth.api("api/admin/user", { id, action: act });
      if (res.ok && act === "password") showMade(btn.dataset.email, res.data.password);
      drawDemo();
    }));
  }

  // « Sites »: the organisers' sites to follow up with — robots.txt forbids what the collection reads all the same, or
  // the site actively refuses robots (never worked around) — from site/data/prov/blocked.json (administrators only)
  async function drawSites() {
    const box = $("#st-list");
    const r = await fetch("data/prov/blocked.json", { credentials: "same-origin", cache: "no-store" });
    const sites = r.ok && (r.headers.get("content-type") || "").includes("json") ? (await r.json()).sites : [];
    const day = (iso) => (iso ? fmtDate(iso.slice(0, 10), "short") : "—");
    const race = (c) => (c.name
      ? html`<div><a href="#/resultats?course=${encodeURIComponent(c.key)}">${c.name}</a> <span class="muted">${fmtDate(c.date, "short")}</span></div>`
      : html`<div class="muted">${c.key}</div>`);
    box.innerHTML = sites.length ? html`<table class="data compact"><thead><tr><th>${t("ad.st.site")}</th><th>${t("ad.st.kind")}</th>
      <th>${t("ad.st.races")}</th><th class="r">${t("ad.st.hits")}</th><th>${t("ad.st.seen")}</th></tr></thead>
      <tbody>${sites.map((x) => html`<tr>
        <td style="white-space:normal;max-width:260px"><a href="https://${x.host}/" target="_blank" rel="noopener">${x.host}</a>
          <div class="muted" style="font-size:12px;overflow-wrap:anywhere">${x.example || ""}</div></td>
        <td style="white-space:normal;min-width:150px"><span class="tag">${t(`ad.st.kind.${x.kind}`)}</span>
          <div class="muted" style="font-size:12px">${t(`ad.st.kind.${x.kind}.hint`)}</div></td>
        <td style="white-space:normal;max-width:300px;font-size:12.5px">${x.races.length ? html`${x.races.slice(0, 5).map(race)}
          ${x.races.length > 5 ? html`<details><summary class="muted">${t("ad.st.more", { n: x.races.length - 5 })}</summary>
            ${x.races.slice(5).map(race)}</details>` : ""}` : html`<span class="muted">—</span>`}</td>
        <td class="r num">${fmt(x.hits)}</td>
        <td class="num" style="font-size:12.5px">${day(x.first)} → ${day(x.last)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("ad.st.none")}</div>`;
  }

  // « Dépôts »: the results files uploaded on « Récemment » (api/admin/uploads), each one removable
  async function drawUploads() {
    const box = $("#up-list");
    const r = await fetch("api/admin/uploads", { credentials: "same-origin", cache: "no-store" });
    const list = r.ok ? (await r.json()).uploads : [];
    const raceOf = (u) => {
      if (u.race_key) return html`<a href="#/resultats?course=${encodeURIComponent(u.race_key)}">${u.race}</a>`;
      let n = {};
      try { n = JSON.parse(u.race); } catch (e) { /* a label */ }
      return html`${n.name || u.race} <span class="muted">(${n.date ? fmtDate(n.date, "short") : ""} · ${t("ad.up.added")})</span>`;
    };
    box.innerHTML = list.length ? html`<table class="data compact"><thead><tr><th>${t("ad.up.when")}</th><th>${t("ad.up.race")}</th>
      <th>${t("ad.up.file")}</th><th>${t("ad.up.who")}</th><th></th></tr></thead>
      <tbody>${list.map((u) => html`<tr${raw(u.status === "removed" ? ' style="opacity:.55"' : "")}>
        <td class="num">${fmtDate(u.created_at.slice(0, 10), "short")} ${u.created_at.slice(11, 16)}</td>
        <td style="white-space:normal;max-width:320px">${raceOf(u)}</td>
        <td style="white-space:normal;max-width:260px">${u.filename} <span class="muted">· ${fmt(Math.max(1, Math.round(u.size / 1024)))} Ko</span></td>
        <td style="white-space:normal">${u.email ? html`${u.first_name} ${u.last_name}<div class="muted" style="font-size:12px">${u.email} · ${u.licence}</div>` : "—"}</td>
        <td>${u.status === "removed" ? html`<span class="tag">${t("ad.up.removed")}</span>`
          : html`<button type="button" class="btn btn-sm" data-up-remove="${u.id}">${t("ad.up.remove")}</button>`}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("ad.up.none")}</div>`;
    $$("[data-up-remove]", box).forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(t("ad.up.confirm"))) return;
      b.disabled = true;
      await auth.api("api/admin/uploads", { id: Number(b.dataset.upRemove) });
      drawUploads();
    }));
  }
  let usageStarted = false;

  // « Anonymisés »: the licensees whose name and licence the published site replaces by a pseudonym (on request: not to be
  // shown, a minor's representative, erasure of results data), from api/admin/anonymized (R2, privacy/anonymized.json);
  // the next run of the update rebuilds the site with the list (privacy.py). Reversible: « Rétablir ».
  let anonList = null;
  const anonAs = (p) => `${t("ad.an.label")} ${Number(p.pseudo) - 90000000}`;
  async function anonCall(method, body) {
    const r = await fetch("api/admin/anonymized", { method, credentials: "same-origin", cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    let j = null;
    try { j = await r.json(); } catch (e) { /* none */ }
    return { ok: r.ok, status: r.status, data: j };
  }
  async function drawAnon() {
    if (!anonList) {
      const r = await anonCall("GET");
      anonList = r.ok ? r.data : null;
    }
    const people = anonList?.people || [];
    $("#an-title").textContent = people.length ? t("ad.an.count", { n: fmt(people.length) }) : t("ad.an.list");
    $("#an-list").innerHTML = !anonList ? html`<div class="empty">${t("ad.an.error")}</div>`
      : people.length ? html`<table class="data compact"><thead><tr><th>${t("ad.an.col.name")}</th><th>${t("ad.an.col.lic")}</th>
          <th>${t("ad.an.col.as")}</th><th>${t("ad.an.col.since")}</th><th>${t("ad.an.col.note")}</th><th></th></tr></thead>
        <tbody>${[...people].reverse().map((p) => html`<tr><td>${p.name}</td><td class="num">${p.lic}</td><td>${anonAs(p)}</td>
          <td class="num">${fmtDate(p.since, "short")}</td><td style="white-space:normal;max-width:300px">${p.note || ""}</td>
          <td class="r"><button type="button" class="btn btn-sm" data-an-restore="${p.lic}">${t("ad.an.restore")}</button></td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("ad.an.none")}</div>`;
    $$("[data-an-restore]").forEach((b) => b.addEventListener("click", async () => {
      const p = people.find((x) => String(x.lic) === b.dataset.anRestore);
      if (!p || !confirm(t("ad.an.restoreConfirm", { name: p.name }))) return;
      b.disabled = true;
      const r = await anonCall("DELETE", { lic: p.lic });
      if (r.ok) anonList = r.data;
      $("#an-msg").textContent = r.ok ? t("ad.an.pending") : t("ad.an.error");
      drawAnon();
    }));
    drawAnonFound();
  }
  // the runners matching the search (name or licence), each with its button; a licence absent from the data can be typed
  function drawAnonFound() {
    const q = normalise($("#an-q").value.trim()), box = $("#an-found");
    if (!q || q.length < 2) { box.innerHTML = ""; return; }
    const listed = new Set((anonList?.people || []).map((p) => String(p.lic)));
    const found = data.runners().list.filter((r) => !data.isAnon(r.lic) && (String(r.lic) === q || normalise(r.nom).includes(q))).slice(0, 8);
    const digits = /^\d{1,7}$/.test(q);
    box.innerHTML = html`${found.length ? html`<div class="table-wrap"><table class="data compact"><tbody>${found.map((r) => html`<tr>
        <td>${r.nom}</td><td class="num">${r.lic}</td><td>${data.clubName(r.club)}</td><td class="num">${fmtDate(r.last, "short")}</td>
        <td class="r">${listed.has(String(r.lic)) ? html`<span class="tag">${t("ad.an.already")}</span>`
          : html`<button type="button" class="btn btn-sm btn-primary" data-an-add="${r.lic}">${t("ad.an.do")}</button>`}</td></tr>`)}</tbody></table></div>`
      : html`<div class="muted" style="font-size:13px">${t("ad.an.noMatch")}</div>`}
      <div class="filters" style="margin:10px 0 0;padding:0;border:0;background:none">
        <span class="muted" style="font-size:12.5px;align-self:center">${t("ad.an.manual")}</span>
        <label class="field"><span>${t("ad.an.col.lic")}</span><input type="text" id="an-lic" inputmode="numeric" maxlength="7" style="width:100px" value="${digits ? q : ""}"></label>
        <label class="field"><span>${t("ad.an.col.name")}</span><input type="text" id="an-name" maxlength="80" style="width:220px"></label>
        <button type="button" class="btn btn-sm" id="an-manual" style="align-self:flex-end">${t("ad.an.do")}</button>
      </div>`;
    const add = async (lic, name) => {
      if (!confirm(t("ad.an.confirm", { name }))) return;
      const r = await anonCall("POST", { lic, name, note: $("#an-note").value });
      if (r.ok) { anonList = r.data; $("#an-q").value = ""; $("#an-note").value = ""; }
      $("#an-msg").textContent = r.ok ? t("ad.an.pending") : r.status === 409 ? t("ad.an.already") : t("ad.an.error");
      drawAnon();
    };
    $$("[data-an-add]", box).forEach((b) => b.addEventListener("click", () => {
      const r = data.runner(b.dataset.anAdd);
      if (r) add(String(r.lic), r.nom);
    }));
    $("#an-manual").addEventListener("click", () => {
      const lic = $("#an-lic").value.trim(), name = $("#an-name").value.trim();
      if (!/^\d{1,7}$/.test(lic) || !name) { $("#an-msg").textContent = t("ad.an.manualHelp"); return; }
      add(lic, name);
    });
  }
  $("#an-q").addEventListener("input", drawAnonFound);

  // « Inscrits »: registered accounts (confirmed, not disabled, by sign-up day) and active ones (seen on at least one day
  // of the last 21) from api/admin/members, day by day since the first account. An account deleted leaves no trace.
  let members = null, mNoAdmins = true;
  bindChartCard(main, "m-chart");
  $("#m-noadmins").addEventListener("change", (e) => { mNoAdmins = e.target.checked; drawMembers(); });
  async function drawMembers() {
    if (!members) {
      const r = await fetch("api/admin/members", { credentials: "same-origin", cache: "no-store" });
      members = r.ok ? await r.json() : { error: true };
    }
    if (members.error) { $("#m-tiles").innerHTML = html`<div class="notice">${t("ad.u.error")}</div>`; return; }
    const keep = members.users.filter((u) => !(mNoAdmins && u.admin));
    const ids = new Set(keep.map((u) => u.id));
    const today = isoDay(new Date());
    const counted = keep.filter((u) => u.verified && u.status !== "disabled");
    const start = counted.length ? counted.map((u) => parisDay(u.created)).sort()[0] : today;
    const n = spanDays(start, today), idx = (d) => spanDays(start, d) - 1;
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));
    // registered: confirmed accounts by the day they signed up
    const fresh = new Array(n).fill(0);
    for (const u of counted) fresh[Math.max(0, idx(parisDay(u.created)))]++;
    const reg = [];
    fresh.reduce((s, x, i) => (reg[i] = s + x), 0);
    // active: an account counts from each day it was seen to 20 days later; its spans merged, then summed day by day
    const delta = new Array(n + 1).fill(0), byUser = new Map();
    for (const [uid, d] of members.seen) if (ids.has(uid)) { if (!byUser.has(uid)) byUser.set(uid, []); byUser.get(uid).push(idx(d)); }
    for (const list of byUser.values()) {
      let a = null, b = null;
      for (const i of list.sort((x, y) => x - y)) {
        if (a != null && i <= b + 1) { b = Math.max(b, i + ACTIVE_DAYS - 1); continue; }
        if (a != null) { delta[Math.max(0, a)]++; delta[Math.min(n, b + 1)]--; }
        a = i; b = i + ACTIVE_DAYS - 1;
      }
      if (a != null) { delta[Math.max(0, a)]++; delta[Math.min(n, b + 1)]--; }
    }
    const act = [];
    delta.slice(0, n).reduce((s, x, i) => (act[i] = s + x), 0);
    const tracked = members.first || today;                  // visits are counted since this day
    const fullFrom = addDays(tracked, ACTIVE_DAYS - 1);       // the first day whose window is wholly tracked
    const activeAt = (i) => (days[i] < tracked ? null : act[i]);
    const last = n - 1, since = addDays(today, -(ACTIVE_DAYS - 1));
    const newRecent = counted.filter((u) => parisDay(u.created) >= since).length;
    const pending = keep.filter((u) => !u.verified).length, disabled = keep.filter((u) => u.verified && u.status === "disabled").length;
    const pct = reg[last] ? Math.round((100 * act[last]) / reg[last]) : null;
    $("#m-tiles").innerHTML = html`
      ${tile(t("ad.m.registered"), fmt(reg[last] || 0), [pending ? t("ad.m.pending", { n: fmt(pending) }) : "", disabled ? t("ad.m.disabled", { n: fmt(disabled) }) : ""].filter(Boolean).join(" · "))}
      ${tile(t("ad.m.active", { n: ACTIVE_DAYS }), fmt(act[last] || 0), pct != null ? t("ad.m.share", { p: fmt(pct) }) : "")}
      ${tile(t("ad.m.new", { n: ACTIVE_DAYS }), fmt(newRecent), t("ad.m.since", { d: fmtDate(since, "short") }))}`;
    $("#m-note").textContent = today < fullFrom
      ? t("ad.m.partial", { d: fmtDate(tracked), full: fmtDate(fullFrom), n: ACTIVE_DAYS })
      : t("ad.m.def", { n: ACTIVE_DAYS });
    const cReg = css("--s1"), cAct = css("--s2");
    $("#m-chart-legend").innerHTML = legend([{ color: cReg, label: t("ad.m.registered") }, { color: cAct, label: t("ad.m.active", { n: ACTIVE_DAYS }) }]);
    timeChart($("#m-chart"), {
      yName: t("ad.m.accounts"), yMin: 0, zoom: n > 120 ? undefined : false,
      series: [
        { name: t("ad.m.registered"), color: cReg, step: true, data: days.map((d, i) => [d, reg[i]]) },
        { name: t("ad.m.active", { n: ACTIVE_DAYS }), color: cAct, data: days.map((d, i) => [d, activeAt(i)]).filter((p) => p[1] != null) },
      ],
    });
    $("#m-chart-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th class="r">${t("ad.m.registered")}</th>
      <th class="r">${t("ad.m.newDay")}</th><th class="r">${t("ad.m.active", { n: ACTIVE_DAYS })}</th></tr></thead>
      <tbody>${days.map((d, i) => i).reverse().map((i) => html`<tr><td class="num">${fmtDate(days[i])}</td><td class="r num">${fmt(reg[i])}</td>
        <td class="r num">${fresh[i] ? fmt(fresh[i]) : ""}</td><td class="r num">${activeAt(i) == null ? "—" : fmt(activeAt(i))}</td></tr>`)}</tbody></table>`;
  }

  // ======================================================================================================
  // Comptes
  // ======================================================================================================
  let q = "", onlyDups = false;
  const dupSet = () => new Set(duplicates);
  const status = (u) => (u.status === "disabled" ? t("ad.st.disabled") : u.email_verified ? t("ad.st.active") : t("ad.st.unverified"));

  function draw() {
    const dups = dupSet();
    $("#ad-tiles").innerHTML = html`
      ${tile(t("ad.accounts"), fmt(users.length))}
      ${tile(t("ad.confirmed"), fmt(users.filter((u) => u.email_verified).length))}
      ${tile(t("ad.dups"), fmt(dups.size))}
      ${tile(t("ad.queue"), fmt(queued))}`;
    const qn = normalise(q);
    const rows = users.filter((u) => (!onlyDups || (dups.has(u.licence) && u.email_verified))
      && (!qn || normalise(`${u.email} ${u.first_name} ${u.last_name} ${u.licence}`).includes(qn)));
    $("#ad-table").innerHTML = rows.length ? html`<table class="data compact"><thead><tr>
      <th>${t("ad.col.email")}</th><th>${t("ad.col.name")}</th><th>${t("ad.col.lic")}</th><th>${t("ad.col.status")}</th>
      <th>${t("ad.col.created")}</th><th>${t("ad.col.login")}</th><th>${t("ad.col.notify")}</th>
      <th title="${t("ad.col.alerts.hint")}">${t("ad.col.alerts")}</th>
      <th>${t("ad.col.actions")}</th></tr></thead>
      <tbody>${rows.map((u) => html`<tr>
        <td>${u.email}</td>
        <td><a href="${link.runner(u.licence)}">${u.display_name}</a><div class="muted" style="font-size:12px">${u.first_name} ${u.last_name}</div></td>
        <td class="num">${u.licence}${dups.has(u.licence) && u.email_verified ? html` <span class="tag" style="color:var(--bad)">${t("ad.dup")}</span>` : ""}</td>
        <td>${status(u)}</td>
        <td class="num">${fmtDate(u.created_at.slice(0, 10), "short")}</td>
        <td class="num">${u.last_login ? fmtDate(u.last_login.slice(0, 10), "short") : "—"}</td>
        <td>${u.notify ? "✓" : ""}</td>
        <td class="c"><input type="checkbox" data-right="alerts" data-id="${u.id}" ${u.alerts_allowed ? "checked" : ""} aria-label="${t("ad.col.alerts")}">
          ${u.agenda_alert || u.deadline_alert ? html`<div class="muted" style="font-size:11.5px">${[u.agenda_alert ? t("ad.alert.new") : "", u.deadline_alert ? t("ad.alert.deadline") : ""].filter(Boolean).join(" · ")}</div>` : ""}</td>
        <td><div class="row" style="gap:6px;flex-wrap:nowrap">
          <button type="button" class="btn btn-sm" data-act="${u.status === "disabled" ? "enable" : "disable"}" data-id="${u.id}">${u.status === "disabled" ? t("ad.enable") : t("ad.disable")}</button>
          <button type="button" class="btn btn-sm" data-act="delete" data-id="${u.id}" style="color:var(--bad)">${t("ad.delete")}</button>
        </div></td></tr>`)}</tbody></table>` : html`<div class="empty">${t("ad.none")}</div>`;
    $$("[data-act]", $("#ad-table")).forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.act === "delete" && !confirm(t("ad.delete.confirm"))) return;
      b.disabled = true;
      const res = await auth.api("api/admin/user", { id: Number(b.dataset.id), action: b.dataset.act });
      if (!res.ok) { b.disabled = false; return; }
      const fresh = await (await fetch("api/admin/users", { credentials: "same-origin", cache: "no-store" })).json();
      ({ users, duplicates, queued } = fresh);
      draw();
    }));
    // the right to the agenda alerts by e-mail, saved at each click
    $$("[data-right]", $("#ad-table")).forEach((box) => box.addEventListener("change", async () => {
      box.disabled = true;
      const res = await auth.api("api/admin/user", { id: Number(box.dataset.id), action: "right", right: box.dataset.right, on: box.checked });
      box.disabled = false;
      if (!res.ok) { box.checked = !box.checked; return; }
      const u = users.find((x) => x.id === Number(box.dataset.id));
      if (u) u.alerts_allowed = box.checked ? 1 : 0;
    }));
  }
  $("#ad-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
  $("#ad-dups").addEventListener("change", (e) => { onlyDups = e.target.checked; draw(); });
  // the administrator's own e-mail at each new account, saved at once
  $("#ad-signup").addEventListener("change", async (e) => {
    const box = e.target;
    box.disabled = true;
    const res = await auth.api("api/admin/prefs", { signupAlert: box.checked });
    box.disabled = false;
    if (!res.ok) box.checked = !box.checked;
  });
  draw();

  // ======================================================================================================
  // Utilisation
  // ======================================================================================================
  const today = isoDay(new Date());
  let preset = PRESETS.includes(query.per) ? query.per : "30";
  let to = /^\d{4}-\d{2}-\d{2}$/.test(query.au || "") ? query.au : today;
  let from = /^\d{4}-\d{2}-\d{2}$/.test(query.du || "") ? query.du : preset === "all" ? "" : addDays(to, 1 - Number(preset));
  if (query.du || query.au) preset = "";
  let account = query.compte || "", noAdmins = query.admins !== "1";
  let usage = null;

  async function loadUsage() {
    const qs = new URLSearchParams({ ...(from ? { from } : {}), to });
    const res = await fetch(`api/admin/usage?${qs}`, { credentials: "same-origin", cache: "no-store" });
    usage = res.ok ? await res.json() : null;
  }
  function saveUsage() {
    replaceQuery({ onglet: "utilisation", per: preset && preset !== "30" ? preset : null, du: preset ? null : from || null,
      au: preset ? null : to, compte: account || null, admins: noAdmins ? null : "1" });
  }

  function drawUsageFilters() {
    const accounts = (usage?.users || []).filter((u) => !noAdmins || !u.admin)
      .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "fr"));
    if (account && !accounts.some((u) => String(u.user_id) === account)) account = "";
    $("#u-filters").innerHTML = html`
      <div class="field"><span>${t("ad.u.period")}</span>${seg("uper", PRESETS.map((p) => [p, t(`ad.u.per.${p}`)]), preset)}</div>
      <label class="field"><span>${t("ad.u.from")}</span><input type="date" id="u-from" value="${from || usage?.first || ""}" max="${today}"></label>
      <label class="field"><span>${t("ad.u.to")}</span><input type="date" id="u-to" value="${to}" max="${today}"></label>
      <label class="field"><span>${t("ad.u.account")}</span><select id="u-account" style="max-width:280px">
        <option value="">${t("ad.u.allAccounts")}</option>
        ${accounts.map((u) => html`<option value="${u.user_id}" ${raw(String(u.user_id) === account ? "selected" : "")}>${u.display_name || t("ad.u.deleted")}</option>`)}</select></label>
      <label class="check" style="align-self:flex-end;height:34px;align-items:center"><input type="checkbox" id="u-noadmins" ${raw(noAdmins ? "checked" : "")}>
        <span>${t("ad.u.noAdmins")}</span></label>`;
    $$('[data-seg="uper"]').forEach((b) => b.addEventListener("click", async () => {
      preset = b.dataset.value;
      to = today;
      from = preset === "all" ? "" : addDays(to, 1 - Number(preset));
      await reload();
    }));
    const dates = async () => {
      const f = $("#u-from").value, tt = $("#u-to").value;
      if (!tt || (f && f > tt)) return;
      preset = ""; from = f; to = tt;
      await reload();
    };
    $("#u-from").addEventListener("change", dates);
    $("#u-to").addEventListener("change", dates);
    $("#u-account").addEventListener("change", (e) => { account = e.target.value; saveUsage(); drawUsage(); });
    $("#u-noadmins").addEventListener("change", (e) => { noAdmins = e.target.checked; saveUsage(); drawUsageFilters(); drawUsage(); });
  }
  async function reload() { await loadUsage(); saveUsage(); drawUsageFilters(); drawUsage(); }

  function drawUsage() {
    if (!usage) { $("#u-tiles").innerHTML = html`<div class="notice">${t("ad.u.error")}</div>`; return; }
    const admins = new Set(usage.users.filter((u) => u.admin).map((u) => u.user_id));
    const keep = (uid) => (!noAdmins || !admins.has(uid)) && (!account || String(uid) === account);
    const days = usage.days.filter((d) => keep(d.user_id));
    const pages = usage.pages.filter((p) => keep(p.user_id));
    const people = usage.users.filter((u) => keep(u.user_id));
    const visits = days.reduce((n, d) => n + d.visits, 0), views = days.reduce((n, d) => n + d.views, 0);
    const start = from || usage.first || to;
    const span = spanDays(start, to);

    $("#u-tiles").innerHTML = html`
      ${tile(t("ad.u.active"), fmt(people.length), `${fmtDate(start, "short")} – ${fmtDate(to, "short")}`)}
      ${tile(t("ad.u.visits"), fmt(visits), `${fmt(visits / span, 1)} ${t("ad.u.perDay")}`)}
      ${tile(t("ad.u.views"), fmt(views), `${fmt(views / span, 1)} ${t("ad.u.perDay")}`)}
      ${tile(t("ad.u.viewsPerVisit"), visits ? fmt(views / visits, 1) : "—")}`;

    // the chart: by day up to 3 months, by week up to 2 years, by month beyond
    const unit = span <= 92 ? "day" : span <= 730 ? "week" : "month";
    const bucketOf = (iso) => {
      if (unit === "day") return iso;
      if (unit === "month") return iso.slice(0, 7);
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));                // the Monday of its week
      return d.toISOString().slice(0, 10);
    };
    const buckets = [];
    for (let d = start; d <= to; d = addDays(d, 1)) { const b = bucketOf(d); if (buckets[buckets.length - 1] !== b) buckets.push(b); }
    const agg = new Map(buckets.map((b) => [b, { views: 0, visits: 0, users: new Set() }]));
    for (const d of days) {
      const a = agg.get(bucketOf(d.day));
      if (!a) continue;
      a.views += d.views; a.visits += d.visits;
      if (d.views || d.visits) a.users.add(d.user_id);
    }
    const label = (b) => (unit === "month" ? fmtDate(`${b}-01`, "month") : unit === "week" ? `${t("ad.u.weekOf")} ${fmtDate(b, "short")}` : fmtDate(b, "short"));
    const series = [
      { name: t("ad.u.views"), color: css("--s1"), data: buckets.map((b) => agg.get(b).views) },
      { name: t("ad.u.visits"), color: css("--s3"), data: buckets.map((b) => agg.get(b).visits) },
      { name: t("ad.u.active"), color: css("--s2"), data: buckets.map((b) => agg.get(b).users.size) },
    ];
    $("#u-chart-legend").innerHTML = legend(series.map((s) => ({ label: s.name, color: s.color })));
    $("#u-chart-title").textContent = `${t("ad.u.chart")} · ${t(`ad.u.unit.${unit}`)}`;
    columnChart($("#u-chart"), { categories: buckets.map(label), series });
    $("#u-chart-table").innerHTML = html`<table class="data compact"><thead><tr><th>${t(`ad.u.unit.${unit}`)}</th>
      ${series.map((s) => html`<th class="r">${s.name}</th>`)}</tr></thead>
      <tbody>${[...buckets].reverse().map((b, i, all) => html`<tr><td>${label(b)}</td>${series.map((s) => html`<td class="r num">${fmt(s.data[all.length - 1 - i])}</td>`)}</tr>`)}</tbody></table>`;

    // per account: visits, views, active days, last activity, the page they open most
    const per = new Map(people.map((u) => [u.user_id, { ...u, visits: 0, views: 0, top: null }]));
    for (const d of days) { const p = per.get(d.user_id); if (p) { p.visits += d.visits; p.views += d.views; } }
    const topOf = new Map();
    for (const p of pages) {
      if (p.page === "_visit") continue;
      const cur = topOf.get(p.user_id);
      if (!cur || p.views > cur.views) topOf.set(p.user_id, p);
    }
    const rowsU = [...per.values()].sort((a, b) => b.views - a.views || b.visits - a.visits);
    $("#u-users").innerHTML = rowsU.length ? html`<table class="data compact"><thead><tr><th>${t("ad.col.name")}</th>
      <th class="r">${t("ad.u.visits")}</th><th class="r">${t("ad.u.views")}</th><th class="r">${t("ad.u.days")}</th>
      <th>${t("ad.u.last")}</th><th>${t("ad.u.top")}</th></tr></thead>
      <tbody>${rowsU.map((u) => html`<tr data-uid="${u.user_id}" style="cursor:pointer" title="${t("ad.u.pick")}">
        <td>${u.display_name || t("ad.u.deleted")}${u.admin ? html` <span class="tag">${t("ad.u.admin")}</span>` : ""}
          <div class="muted" style="font-size:12px">${u.email || ""}</div></td>
        <td class="r num">${fmt(u.visits)}</td><td class="r num">${fmt(u.views)}</td><td class="r num">${fmt(u.days)}</td>
        <td class="num">${fmtDate(u.last, "short")}</td><td>${topOf.has(u.user_id) ? pageName(topOf.get(u.user_id).page) : "—"}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("ad.u.none")}</div>`;
    $$("[data-uid]", $("#u-users")).forEach((tr) => tr.addEventListener("click", () => {
      account = account === tr.dataset.uid ? "" : tr.dataset.uid;
      saveUsage(); drawUsageFilters(); drawUsage();
    }));

    // per page: views, accounts, share of the views
    const byPage = new Map();
    for (const p of pages) {
      if (p.page === "_visit") continue;
      const a = byPage.get(p.page) || { views: 0, users: new Set() };
      a.views += p.views; a.users.add(p.user_id);
      byPage.set(p.page, a);
    }
    const rowsP = [...byPage].sort((a, b) => b[1].views - a[1].views);
    const top = rowsP[0]?.[1].views || 1;
    $("#u-pages").innerHTML = rowsP.length ? html`<table class="data compact"><thead><tr><th>${t("ad.u.page")}</th>
      <th class="r">${t("ad.u.views")}</th><th class="r">%</th><th class="r">${t("ad.u.accounts")}</th></tr></thead>
      <tbody>${rowsP.map(([k, a]) => html`<tr><td>${pageName(k)}
          <div style="height:4px;border-radius:2px;background:var(--s1);opacity:.55;margin-top:4px;width:${(100 * a.views) / top}%"></div></td>
        <td class="r num">${fmt(a.views)}</td><td class="r num">${fmt((100 * a.views) / (views || 1), 1)}</td>
        <td class="r num">${fmt(a.users.size)}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t("ad.u.none")}</div>`;
  }

  async function startUsage() {
    bindChartCard(main, "u-chart");
    await loadUsage();
    drawUsageFilters();
    drawUsage();
  }

  showTab();
  return { title: t("ad.title") };
}
