// « En direct » (#/direct[/<race>[/<class>]], for the accounts with the « live » right): the races liveresultat shows,
// then one race live, from O'Cap's live server (ocap/worker: one reader per race, changes pushed over a WebSocket) —
// so the live traffic never goes through this site's login gate. What only this site adds: each runner recognised
// (name + club) and linked to their page, their CN (Top and official) in the race's discipline, and the place their
// CN predicts. Times are liveresultat's hundredths of a second.
import { html, raw, $, $$, fmt, fmtDate, normalise } from "../util.js";
import { t } from "../i18n.js";
import * as data from "../data.js";
import { nameKey } from "../auth.js";
import { methodShort } from "../ui.js";
import { link, replaceQuery } from "../app.js";

// O'Cap: its list (/api/live/list) and live connections (/ws/<race>); a developer may point it at a local O'Cap
// (localStorage « ocn.liveBase »)
const devBase = (() => { try { return localStorage.getItem("ocn.liveBase"); } catch (e) { return null; } })();
export const LIVE = devBase || "https://ocap.pages.dev";
const STATUS = { 1: "dns", 2: "dnf", 3: "mp", 4: "dsq", 5: "ot", 11: "dns", 12: "nc" };
const ST_LABEL = { dns: "Non partant", dnf: "Abandon", mp: "PM", dsq: "Disq.", ot: "Hors délai", nc: "NC" };
const METHODS = ["top6w2", "official"];
const JUST_IN_MS = 90000;

export async function render(main, { path = "", query = {} } = {}) {
  const parts = path.split("/").filter(Boolean).slice(1);          // #/direct/<race>/<class>
  return parts[0] && /^\d+$/.test(parts[0]) ? race(main, parts[0], parts[1] ? decodeURIComponent(parts[1]) : null) : list(main, query);
}

// ---- the races ----------------------------------------------------------------------------------------------------
async function list(main, query) {
  let q = query.q || "";
  main.innerHTML = html`<div class="page-head"><div><h1>${t("lv.title")}</h1><p class="lede">${t("lv.lede")}</p></div></div>
    <div class="filters"><label class="field"><span>${t("prov.search")}</span><input type="search" id="lv-q" value="${q}" style="width:240px"></label></div>
    <section class="card"><div class="table-wrap" id="lv-list"><div class="empty">${t("lv.loading")}</div></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("lv.source")}</p>`;
  let comps = [];
  try { comps = (await (await fetch(`${LIVE}/api/live/list`, { cache: "no-cache" })).json()).comps; } catch (e) { /* shown empty */ }
  const today = new Date().toLocaleDateString("sv-SE");
  const draw = () => {
    replaceQuery({ q: q || null });
    const n = normalise(q);
    const kept = comps.filter((c) => !n || normalise(`${c[1]} ${c[2]}`).includes(n))
      .sort((a, b) => (a[3] === today ? -1 : b[3] === today ? 1 : 0) || Math.abs(Date.parse(a[3]) - Date.parse(today)) - Math.abs(Date.parse(b[3]) - Date.parse(today)));
    $("#lv-list").innerHTML = kept.length ? html`<table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("prov.race")}</th><th>${t("lv.org")}</th></tr></thead>
      <tbody>${kept.map(([id, name, org, date]) => html`<tr${raw(date === today ? ' class="selected"' : "")}><td class="num">${fmtDate(date, "short")}</td>
        <td><a href="#/direct/${id}">${name}</a></td><td style="font-size:12.5px">${org}</td></tr>`)}</tbody></table>`
      : html`<div class="empty">${t(comps.length ? "lv.none" : "lv.unavailable")}</div>`;
  };
  draw();
  $("#lv-q").addEventListener("input", (e) => { q = e.target.value; draw(); });
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

async function race(main, id, wanted) {
  const st = { info: null, classes: [], cls: wanted, data: null, justIn: new Map(), pass: [], ws: null, up: false, tries: 0, gone: false, cn: {}, terrain: null };
  main.innerHTML = html`<div class="crumbs"><a href="#/direct">${t("lv.title")}</a><span>›</span><span id="lv-name">…</span></div>
    <div class="page-head"><div><h1 id="lv-title">…</h1><p class="lede" id="lv-sub"></p></div><div class="lv-status" id="lv-status">${t("lv.connecting")}</div></div>
    <div class="lv-layout">
      <aside class="lv-side"><div class="lv-side-title">${t("prov.circuit")}</div><div class="lv-list" id="lv-chips"></div></aside>
      <div class="lv-main">
        <label class="field lv-pick"><span>${t("prov.circuit")}</span><select id="lv-sel"></select></label>
        <div id="lv-pass"></div>
        <section class="card"><div class="card-head"><div><h2 id="lv-class"></h2><div class="hint">${t("lv.hint")}</div></div></div>
          <div class="table-wrap" id="lv-rows"><div class="empty">${t("lv.loading")}</div></div></section>
      </div>
    </div>`;

  // runners of this site by name, to recognise them: [runner…] per name key
  await data.bootPrivate();
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
  async function cnFor(terrain) {
    if (st.cn[terrain]) return st.cn[terrain];
    const m = data.latestMonth();
    st.cn[terrain] = Object.fromEntries(await Promise.all(METHODS.map(async (x) => [x, await data.cnAt(x, terrain, m)])));
    return st.cn[terrain];
  }

  function connect() {
    if (st.gone) return;
    const ws = new WebSocket(`${LIVE.replace(/^http/, "ws")}/ws/${id}`);
    st.ws = ws;
    ws.onopen = () => { st.up = true; st.tries = 0; if (st.cls) ws.send(JSON.stringify({ sub: st.cls })); status(); };
    ws.onmessage = (e) => on(JSON.parse(e.data));
    ws.onclose = () => {
      st.up = false; status();
      if (!st.gone && !document.hidden) setTimeout(connect, [1000, 2000, 5000, 10000, 30000][Math.min(st.tries++, 4)]);
    };
  }
  function on(m) {
    if (m.t === "hello") {
      st.info = m.info; st.classes = m.classes;
      $("#lv-title").textContent = $("#lv-name").textContent = m.info?.name || id;
      $("#lv-sub").textContent = [m.info?.organizer, m.info?.date && fmtDate(m.info.date)].filter(Boolean).join(" · ");
      if (!st.cls || !st.classes.includes(st.cls)) pick(st.classes[0]);
      chips();
      if (!st.classes.length) $("#lv-rows").innerHTML = html`<div class="empty">${t("lv.noClasses")}</div>`;
    } else if (m.t === "classes") { st.classes = m.classes; if (!st.cls) pick(st.classes[0]); chips(); }
    else if (m.t === "class" && m.c === st.cls) {
      if (st.data) {
        const before = new Set(st.data.rows.filter((r) => r[3] != null && r[4] === 0).map((r) => `${r[1]}|${r[2]}`));
        for (const r of m.rows) if (r[3] != null && r[4] === 0 && !before.has(`${r[1]}|${r[2]}`)) st.justIn.set(`${r[1]}|${r[2]}`, Date.now());
      }
      st.data = m; rows();
    } else if (m.t === "pass") { st.pass = m.items; ticker(); status(); }
  }
  function pick(c) {
    if (!c) return;
    st.cls = c; st.data = null; st.justIn.clear();
    replaceQuery({});
    history.replaceState(null, "", `#/direct/${id}/${encodeURIComponent(c)}`);
    $("#lv-rows").innerHTML = html`<div class="empty">${t("lv.loading")}</div>`;
    if (st.ws?.readyState === 1) st.ws.send(JSON.stringify({ sub: c }));
    chips();
  }
  function chips() {
    $("#lv-chips").innerHTML = html`${st.classes.map((c) => html`<button type="button" class="lv-item${c === st.cls ? " on" : ""}" aria-pressed="${c === st.cls}" data-c="${c}">${c}</button>`)}`;
    $("#lv-sel").innerHTML = html`${st.classes.map((c) => html`<option value="${c}" ${raw(c === st.cls ? "selected" : "")}>${c}</option>`)}`;
    $("#lv-chips .on")?.scrollIntoView({ block: "nearest" });
  }
  function status() {
    const el = $("#lv-status");
    if (!st.up) { el.className = "lv-status"; el.textContent = st.info ? t("lv.offline") : t("lv.connecting"); return; }
    const p = st.pass[0]?.[0]?.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
    let age = p ? nowAt(st.info) / 100 - (Number(p[1]) * 3600 + Number(p[2]) * 60 + Number(p[3])) : null;
    if (age != null && (age < -60 || age > 12 * 3600)) age = null;
    const live = age != null && age < 300;
    el.className = `lv-status${live ? " live" : ""}`;
    el.textContent = live ? `${t("lv.on")} · ${t("lv.ago", { s: Math.max(0, Math.round(age)) })}` : age != null ? t("lv.idle", { m: Math.round(age / 60) }) : t("lv.on");
  }
  function ticker() {
    const items = st.pass.slice(0, 4);
    $("#lv-pass").innerHTML = items.length ? html`<div class="lv-pass"><span class="muted">${t("lv.last")}</span>
      ${items.map(([at, name, cls, ctl, ctlName, time]) => html`<button type="button" class="chip" data-c="${cls}"><b>${name}</b> · ${cls} · ${ctl === 1000 ? t("lv.finish") : ctlName || ctl} ${time}</button>`)}</div>` : "";
  }

  async function rows() {
    const d = st.data;
    if (!d) return;
    st.terrain = terrainOf(st.info?.name || "", st.cls);
    const cn = await cnFor(st.terrain);
    const now = nowAt(st.info);
    const ctl = d.controls || [];
    const enriched = d.rows.map((r) => {
      const me = who(r[1], r[2]);
      return { r, me, cn: Object.fromEntries(METHODS.map((m) => [m, me ? cn[m].get(me.lic) ?? null : null])) };
    });
    // the place each runner's CN (Top) predicts, among those of the class who hold one
    const ranked = enriched.filter((x) => x.cn.top6w2 != null).sort((a, b) => b.cn.top6w2 - a.cn.top6w2);
    ranked.forEach((x, i) => { x.expected = i + 1; });
    const kind = (x) => {
      const [, , , result, status, , , start] = x.r;
      return status === 0 && result != null ? "fin" : STATUS[status] ? "out" : start != null && start <= now ? "run" : "wait";
    };
    const groups = { fin: [], run: [], out: [], wait: [] };
    for (const x of enriched) groups[kind(x)].push(x);
    groups.fin.sort((a, b) => (a.r[0] ?? 1e9) - (b.r[0] ?? 1e9));
    groups.run.sort((a, b) => (a.r[7] ?? 0) - (b.r[7] ?? 0));
    groups.wait.sort((a, b) => (b.cn.top6w2 ?? -1) - (a.cn.top6w2 ?? -1));
    const line = (x, k) => {
      const [place, name, club, result, status, timeplus, , start, splits] = x.r;
      const just = k === "fin" && Date.now() - (st.justIn.get(`${name}|${club}`) || 0) < JUST_IN_MS;
      let time = "", sub = "";
      if (k === "fin") time = html`<b>${hs(result)}</b>`;
      else if (k === "run") {
        const last = splits ? splits.map((s, i) => (s ? [i, s] : null)).filter(Boolean).pop() : null;
        time = html`<span class="muted" data-start="${start}">${hs(now - start)}</span>`;
        if (last) sub = t("lv.atControl", { c: ctl[last[0]]?.[1] || "", p: last[1][1] ?? "–", d: last[1][2] ? `+${hs(last[1][2])}` : "+0:00" });
      } else if (k === "wait") time = html`<span class="muted">${start != null ? hs(start).replace(/^(\d+):(\d\d):\d\d$/, "$1:$2") : ""}</span>`;
      else time = html`<span class="muted">${ST_LABEL[STATUS[status]]}</span>`;
      return html`<tr${raw(just ? ' class="lv-just"' : "")}>
        <td class="r num"><b>${k === "fin" ? place ?? "" : ""}</b></td>
        <td>${x.me ? html`<a href="${link.runner(x.me.lic)}">${name}</a>` : name}${just ? html` <span class="tag" style="color:var(--good)">${t("lv.justIn")}</span>` : ""}
          <div class="muted lv-m" style="font-size:12px">${club}</div>
          ${sub ? html`<div class="muted" style="font-size:12px">${sub}</div>` : ""}</td>
        <td class="lv-d" style="font-size:12.5px">${club}</td>
        ${METHODS.map((m, i) => html`<td class="r num${i ? " lv-d" : ""}">${x.cn[m] != null ? fmt(x.cn[m]) : html`<span class="muted">—</span>`}</td>`)}
        <td class="r num">${x.expected ?? ""}</td>
        <td class="r num">${time}${k === "fin" && timeplus ? html`<div class="muted lv-m" style="font-size:12px">+${hs(timeplus)}</div>` : ""}</td>
        <td class="r num lv-d">${k === "fin" && timeplus ? `+${hs(timeplus)}` : ""}</td></tr>`;
    };
    const block = (k) => (groups[k].length ? html`<tr class="lv-sec"><td colspan="${6 + METHODS.length}">${t(`lv.${k}`)} <span class="muted">${groups[k].length}</span></td></tr>
      ${groups[k].map((x) => line(x, k))}` : "");
    $("#lv-class").textContent = `${st.cls} · ${t("lv.terrain")} ${t(`terrain.${st.terrain}`)}`;
    $("#lv-rows").innerHTML = d.rows.length ? html`<table class="data compact lv-table"><thead><tr><th class="r">${t("prov.place")}</th><th>${t("prov.name")}</th>
      <th class="lv-d">${t("prov.club")}</th>${METHODS.map((m, i) => html`<th class="r${i ? " lv-d" : ""}">CN ${methodShort(m)}</th>`)}<th class="r" title="${t("lv.expected.hint")}">${t("lv.expected")}</th>
      <th class="r">${t("prov.time")}</th><th class="r lv-d">${t("lv.behind")}</th></tr></thead>
      <tbody>${block("fin")}${block("run")}${block("wait")}${block("out")}</tbody></table>`
      : html`<div class="empty">${t("lv.empty")}</div>`;
  }

  main.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) pick(b.dataset.c); });
  main.addEventListener("change", (e) => { if (e.target.id === "lv-sel") pick(e.target.value); });
  const tick = setInterval(() => {
    if (!main.isConnected) { cleanup(); return; }
    status();
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
