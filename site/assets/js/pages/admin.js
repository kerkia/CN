// Administration (the administrator only), in two tabs. « Comptes »: every account, duplicates by licence
// flagged, rights, disable / re-enable / delete, and the administrator's own e-mail at each new account.
// « Utilisation »: how much the site is used over any period — visits, page views, active days, per account
// and per page. The server enforces the role; this page only reads and acts.

import { html, raw, $, $$, normalise, fmt, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as auth from "../auth.js";
import { tile, seg, chartCard, bindChartCard, legend } from "../ui.js";
import { columnChart, css } from "../charts.js";
import { link, replaceQuery } from "../app.js";

const PRESETS = ["7", "30", "90", "365", "all"];
const isoDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });     // YYYY-MM-DD, Paris
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const spanDays = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400e3) + 1;

/** The label of a page counted by api/track. */
function pageName(k) {
  const NAMES = { overview: "nav.overview", ranking: "nav.ranking", runner: "nav.runner", compare: "nav.compare", clubs: "nav.clubs",
    club: "ad.pg.club", clubcompare: "ad.pg.clubcompare", courses: "nav.courses", agenda: "nav.agenda", methods: "nav.methods",
    settings: "st.link", contact: "ct.title", admin: "ad.title", provisional: "prov.title", splits: "spl.title",
    deposit: "dep.title" };
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
  let tab = { utilisation: "usage", depots: "uploads", sites: "sites" }[query.onglet] || "accounts";

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("ad.title")}</h1><p class="lede">${t("ad.lede")}</p></div>
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
    <div data-panel="uploads" hidden>
      <p class="muted" style="margin:0 2px 12px">${t("ad.up.lede")}</p>
      <section class="card"><div class="table-wrap" id="up-list"></div></section>
    </div>`;

  function showTab() {
    $("#ad-tabs").innerHTML = seg("adtab", [["accounts", t("ad.tab.accounts")], ["usage", t("ad.tab.usage")], ["uploads", t("ad.tab.uploads")],
      ["sites", t("ad.tab.sites")]], tab);
    $$('[data-seg="adtab"]').forEach((b) => b.addEventListener("click", () => { tab = b.dataset.value; showTab(); }));
    $$("[data-panel]", main).forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    if (tab === "usage") saveUsage(); else replaceQuery({ uploads: { onglet: "depots" }, sites: { onglet: "sites" } }[tab] || {});   // the address keeps the usage filters
    if (tab === "usage" && !usageStarted) { usageStarted = true; startUsage(); }
    if (tab === "uploads") drawUploads();
    if (tab === "sites") drawSites();
  }

  // « Sites »: the organisers' sites to follow up with — robots.txt forbids what the collection reads all the same, or
  // the site actively refuses robots (never worked around) — from site/data/prov/blocked.json (administrators only)
  async function drawSites() {
    const box = $("#st-list");
    const r = await fetch("data/prov/blocked.json", { credentials: "same-origin", cache: "no-store" });
    const sites = r.ok && (r.headers.get("content-type") || "").includes("json") ? (await r.json()).sites : [];
    const day = (iso) => (iso ? fmtDate(iso.slice(0, 10), "short") : "—");
    const race = (c) => (c.name
      ? html`<div><a href="#/recemment?course=${encodeURIComponent(c.key)}">${c.name}</a> <span class="muted">${fmtDate(c.date, "short")}</span></div>`
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
      if (u.race_key) return html`<a href="#/recemment?course=${encodeURIComponent(u.race_key)}">${u.race}</a>`;
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
      <th title="${t("ad.col.analyst.hint")}">${t("ad.col.analyst")}</th><th title="${t("ad.col.alerts.hint")}">${t("ad.col.alerts")}</th>
      <th>${t("ad.col.actions")}</th></tr></thead>
      <tbody>${rows.map((u) => html`<tr>
        <td>${u.email}</td>
        <td><a href="${link.runner(u.licence)}">${u.display_name}</a><div class="muted" style="font-size:12px">${u.first_name} ${u.last_name}</div></td>
        <td class="num">${u.licence}${dups.has(u.licence) && u.email_verified ? html` <span class="tag" style="color:var(--bad)">${t("ad.dup")}</span>` : ""}</td>
        <td>${status(u)}</td>
        <td class="num">${fmtDate(u.created_at.slice(0, 10), "short")}</td>
        <td class="num">${u.last_login ? fmtDate(u.last_login.slice(0, 10), "short") : "—"}</td>
        <td>${u.notify ? "✓" : ""}</td>
        <td class="c"><input type="checkbox" data-right="analyst" data-id="${u.id}" ${u.analyst ? "checked" : ""} aria-label="${t("ad.col.analyst")}"></td>
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
    // rights: the analysis methods, the agenda alerts — saved at each click
    $$("[data-right]", $("#ad-table")).forEach((box) => box.addEventListener("change", async () => {
      box.disabled = true;
      const res = await auth.api("api/admin/user", { id: Number(box.dataset.id), action: "right", right: box.dataset.right, on: box.checked });
      box.disabled = false;
      if (!res.ok) { box.checked = !box.checked; return; }
      const u = users.find((x) => x.id === Number(box.dataset.id));
      if (u) u[box.dataset.right === "analyst" ? "analyst" : "alerts_allowed"] = box.checked ? 1 : 0;
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
