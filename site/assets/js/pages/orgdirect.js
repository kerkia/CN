// « Organisation › Direct » (#/orga-direct; every account since 2026-10-15, owner): an organiser feeds « En direct »
// from their timing software, without liveresultat. MeOS posts its online results itself (2026-10-22: MOP, to
// /api/live/mop with the race's number and MeOS password, both shown in card 2; nothing to keep open). Else the software
// exports its result list to a file every few seconds;
// this page, open on the arena PC in Chrome or Edge (the File System Access API keeps the file: it is chosen once), re-reads
// it, reads it here — IOF XML 3.0 with its own reader below, which keeps the runners still out and their split times; the
// OE / MeOS HTML lists with localparse.js — and sends only the classes that changed (functions/api/live/push.js, then the
// race's object on Ozimut's live relay, live/ (Worker « ocn-live »), which pushes them to the pages watching). Nothing is declared beforehand:
// the classes, their controls and runners come from the file, and a class that appears is added. A timer in a small
// Worker paces the reads (a hidden tab's own timers are slowed to once a minute); the file's handle is kept in IndexedDB,
// so a reload asks one click to read it again. A broadcast is fed by the account that opened it (or an administrator):
// the page lists one's own broadcasts only (all of them to administrators).
// A broadcast tied to a competition of one's club (2026-10-23: the agenda's, from yesterday to a week ahead, or one declared
// outside France) is also published in « Résultats »: the live relay saves it every couple of minutes and the results runs
// read it (ffco_scraper/prov/sources/broadcast.py) — its results, split times and start list stay after the race.

import { html, raw, $, $$, fmtDate, addDays } from "../util.js";
import { t, has, lang, locale } from "../i18n.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { parseBytes } from "../localparse.js";
import * as declare from "../declare.js";
import * as tracking from "../tracking.js";
import { betaNotice, betaTag, betaNote } from "../beta.js";
import { seg } from "../ui.js";

const PREF = "ocn.direct";                        // the broadcast chosen and the interval, on this computer
const LIVE_STATUS = { ok: 0, finished: 0, missingpunch: 3, mispunch: 3, disqualified: 4, didnotfinish: 2, sportingwithdrawal: 2,
  overtime: 5, didnotstart: 1, didnotenter: 1, cancelled: 1, notcompeting: 12 };            // IOF XML -> liveresultat's codes
const LOCAL_STATUS = { ok: 0, mp: 3, dsq: 4, dnf: 2, ot: 5, dns: 1, nc: 12 };               // localparse -> liveresultat's
const OUT = 9;                                    // still out (or not started yet): « En direct » tells them by the start time
const INTERVALS = [10, 15, 30, 60];
const orgCode = (org) => { const m = /^\s*(\d{3,4})\b/.exec(String(org || "")); return m ? m[1].padStart(4, "0") : null; };

const pref = {
  get: () => { try { return JSON.parse(localStorage.getItem(PREF) || "{}"); } catch (e) { return {}; } },
  set: (v) => { try { localStorage.setItem(PREF, JSON.stringify({ ...pref.get(), ...v })); } catch (e) { /* this visit only */ } },
};
// the file's handle, kept between visits (IndexedDB stores it; the browser asks again before it is read)
const handles = (() => {
  let db = null;
  const open = () => (db ||= new Promise((ok, ko) => {
    const r = indexedDB.open("ocn-direct", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("h");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  }));
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((ok, ko) => {
      const tx = d.transaction("h", mode), req = fn(tx.objectStore("h"));
      tx.oncomplete = () => ok(req?.result);
      tx.onerror = () => ko(tx.error);
    });
  };
  return {
    get: async (k) => { try { return await run("readonly", (s) => s.get(k)); } catch (e) { return null; } },
    set: async (k, v) => { try { await run("readwrite", (s) => s.put(v, k)); } catch (e) { /* not kept */ } },
  };
})();

// ---- the file -> the classes ---------------------------------------------------------------------------------------
const kids = (el, n) => (el ? [...el.children].filter((c) => c.localName === n) : []);
const child = (el, ...path) => { for (const n of path) { if (!el) return null; el = kids(el, n)[0] || null; } return el; };
const txt = (el, ...path) => { const e = path.length ? child(el, ...path) : el; return e?.textContent ? e.textContent.replace(/\s+/g, " ").trim() : ""; };
const secs = (s) => (/^\d+(?:\.\d+)?$/.test(s || "") ? Number(s) : null);
const clock = (s) => { const m = (s || "").match(/(?:T|^)(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; };

/** An IOF XML 3.0 result list, as it stands during the race: every runner, those still out included. */
function iofLive(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const root = xml.documentElement;
  if (!root || root.localName !== "ResultList" || xml.getElementsByTagName("parsererror").length) return null;
  const ev = child(root, "Event");
  const classes = kids(root, "ClassResult").map((cr) => ({
    name: txt(cr, "Class", "Name") || txt(cr, "Class", "ShortName") || "?",
    runners: kids(cr, "PersonResult").map((pr) => {
      const person = child(pr, "Person");
      const name = [txt(person, "Name", "Given"), txt(person, "Name", "Family")].filter(Boolean).join(" ");
      if (!name) return null;
      const org = child(pr, "Organisation");
      const res = child(pr, "Result");
      const st = txt(res, "Status").toLowerCase();
      const time = secs(txt(res, "Time"));
      let status = st in LIVE_STATUS ? LIVE_STATUS[st] : OUT;
      if (status === 0 && time == null) status = OUT;
      const pos = Number(txt(res, "Position"));
      return { name, club: txt(org, "Name") || txt(org, "ShortName"), status, time_s: status === 0 ? time : null,
        place: status === 0 && pos > 0 ? pos : null, start_s: clock(txt(res, "StartTime")),
        punches: kids(res, "SplitTime").filter((s) => (s.getAttribute("status") || "").toLowerCase() !== "additional")
          .map((s) => [txt(s, "ControlCode"), (s.getAttribute("status") || "").toLowerCase() === "missing" ? null : secs(txt(s, "Time"))])
          .filter(([c]) => c) };
    }).filter(Boolean),
  })).filter((k) => k.runners.length);
  return { title: txt(ev, "Name"), date: (txt(ev, "StartTime", "Date") || "").slice(0, 10) || null, classes, iof: true };
}
/** A document of localparse.js (the HTML lists of OE and MeOS: the finishers and those out of the race). */
const fromLocal = (d) => ({
  title: d.title, date: d.date, iof: false,
  classes: d.classes.map((k) => ({ name: k.name, runners: k.runners.map((r) => ({ name: r.name, club: r.club || "",
    status: LOCAL_STATUS[r.status] ?? 12, time_s: r.status === "ok" ? r.time_s : null, place: r.place, start_s: r.start_s,
    punches: k.controls ? k.controls.map((c, i) => [c, r.splits?.[i] ?? null]) : [] })) })),
});
/** The punches in a class's control order (a code met again later in the course counts at its later place). */
function aligned(codes, punches) {
  const out = [];
  let j = 0;
  for (const c of codes) {
    let k = j;
    while (k < punches.length && punches[k][0] !== c) k++;
    if (k < punches.length) { out.push(punches[k][1]); j = k + 1; } else out.push(null);
  }
  return out;
}
/** The classes in liveresultat's compact form, as « En direct » shows them: rows of [place, name, club, result,
 *  status, timeplus, progress, start, splits] in hundredths of a second, splits as [time, place, timeplus] per control. */
function toLive(classes) {
  const out = {}, order = [];
  for (const k of classes) {
    let name = k.name;
    while (out[name]) name += " ";
    // the controls: the course of the runner with the most split times, among the finishers first
    const withP = k.runners.filter((r) => r.punches?.length);
    const ref = [...withP].sort((a, b) => (a.status === 0) - (b.status === 0) || a.punches.length - b.punches.length).pop();
    const codes = ref ? ref.punches.map(([c]) => c) : [];
    const al = k.runners.map((r) => (codes.length && r.punches?.length ? aligned(codes, r.punches) : null));
    const per = codes.map((_, i) => al.map((a, j) => (a?.[i] != null ? [a[i], j] : null)).filter(Boolean).sort((x, y) => x[0] - y[0]));
    const split = (j, i) => {
      const t = al[j]?.[i];
      if (t == null) return null;
      return [Math.round(t * 100), per[i].findIndex((x) => x[1] === j) + 1, Math.round((t - per[i][0][0]) * 100)];
    };
    const fin = k.runners.map((r, j) => [r, j]).filter(([r]) => r.status === 0 && r.time_s != null).sort((a, b) => a[0].time_s - b[0].time_s);
    const best = fin[0]?.[0].time_s;
    const places = new Map();
    let lastT = null, lastP = 0;
    fin.forEach(([r, j], i) => { const p = r.place ?? (r.time_s === lastT ? lastP : i + 1); lastT = r.time_s; lastP = p; places.set(j, p); });
    out[name] = {
      controls: codes.map((c, i) => [String(c), String(i + 1)]),          // « En direct » writes « Poste 2 »
      rows: k.runners.map((r, j) => {
        const done = r.status === 0 && r.time_s != null;
        return [places.get(j) ?? null, r.name, r.club || "", done ? Math.round(r.time_s * 100) : null, r.status,
          done && best != null ? Math.round((r.time_s - best) * 100) : null, null, r.start_s != null ? Math.round(r.start_s * 100) : null,
          codes.length ? codes.map((_, i) => split(j, i)) : null];
      }),
    };
    order.push(name);
  }
  return { order, classes: out };
}

// ---- the page --------------------------------------------------------------------------------------------------------
// (exported for checks in the browser's console)
export { iofLive, toLive };

export async function render(main) {
  const me = auth.session();
  const canPick = typeof window.showOpenFilePicker === "function";
  const today = new Date().toLocaleDateString("sv-SE");
  const text = await import(`../content/orgdirect.${lang()}.js`);
  const st = { id: pref.get().id || null, every: pref.get().every || 15, handle: null, running: false, sent: new Map(), order: "",
    seen: null, reads: 0, pushes: 0, last: null, lastPush: null, error: null, stats: null, info: null, viewers: null, busy: false,
    via: pref.get().via || null };

  // three steps, each card one of them (owner, 2026-10-25: the MeOS and the file instructions were one block, read as one):
  // 1. the race, 2. how the results are sent — MeOS or an exported file, the way chosen alone shown —, 3. « Résultats » after
  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("od.title")} ${raw(betaTag())}</h1>
      <p class="lede">${t("od.lede")}</p></div></div>
    ${raw(betaNote("direct"))}
    ${raw(text.overview)}
    <section class="card"><div class="card-head"><div><h2>${t("od.race")}</h2><div class="hint">${t("od.race.hint")}</div></div></div>
      <div class="card-body" id="od-race"><div class="empty">${t("misc.loading")}</div></div></section>
    <section class="card"><div class="card-head"><div><h2>${t("od.send")}</h2><div class="hint">${t("od.send.hint")}</div></div></div>
      <div class="card-body">
        <div class="field od-via"><span>${t("od.via")}</span>${raw(seg("odvia", [["meos", t("od.via.meos")], ["file", t("od.via.file")]], st.via))}</div>
        <p class="muted" data-via="" style="margin-bottom:0">${t("od.via.none")}</p>
        <div data-via="meos" hidden>${raw(text.meos)}<h3>${t("od.meos.values")}</h3><div id="od-meos"></div></div>
        <div data-via="file" hidden>${raw(text.file)}<h3>${t("od.file.box")}</h3><div id="od-file"></div></div>
        <p class="muted od-common">${raw(text.common)}</p>
      </div></section>
    <section class="card"><div class="card-head"><div><h2>${t("od.after")}</h2><div class="hint">${t("od.after.hint")}</div></div></div>
      <div class="card-body"><div id="od-after"></div>${raw(text.after)}</div></section>
    <section class="card"><div class="card-head"><div><h2>${t("trk.org.title")}</h2><div class="hint">${t("trk.org.hint")}</div></div></div>
      <div class="card-body" id="od-trk"><div class="empty">${t("misc.loading")}</div></div></section>
    <style>
      .od-overview { margin: 0 0 14px; padding: 10px 14px 10px 34px; border: 1px solid var(--line); border-radius: 10px; line-height: 1.55; max-width: 920px }
      .od-overview li { margin: 2px 0 }
      .od-via { margin-bottom: 4px }
      .od-via .seg button { font-size: 14px; padding: 6px 14px }
      @media (max-width: 560px) { .od-via .seg { display: flex; flex-direction: column; overflow: visible } .od-via .seg button { white-space: normal; text-align: left } }
      [data-via] { margin-top: 12px; padding-top: 4px }
      [data-via] h3 { margin: 16px 0 6px; font-size: 15px }
      .od-what { margin: 6px 0 0; max-width: 920px; line-height: 1.55 }
      .od-tip { margin: 8px 0 0; font-size: 13px; color: var(--muted) }
      .od-common { margin: 16px 0 0; font-size: 12.5px; max-width: 920px }
      .od-meos { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 12px; align-items: center; max-width: 720px }
      .od-meos code { font-size: 14px; padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px; user-select: all; overflow-wrap: anywhere }
      .od-meos .od-val { display: flex; gap: 8px; align-items: center; flex-wrap: wrap }
      @media (max-width: 560px) { .od-meos { grid-template-columns: minmax(0, 1fr) } }
      #od-after:not(:empty) { margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line) }
      .od-steps { margin: 0; padding-left: 22px; line-height: 1.55 }
      .od-steps li { margin: 4px 0 }
      .od-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 12px }
      .od-grid > div { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px }
      .od-grid b { display: block; font-size: 18px }
      .od-log { font-size: 12.5px; margin-top: 10px }
    </style>`;
  betaNotice("direct");                                  // beta.js (owner, 2026-10-16): little tested yet

  // ---- 2's choice: MeOS or a file — the one chosen last on this computer, else MeOS when it already sent to the race
  function showVia() {
    const v = st.via || (current()?.mopAt ? "meos" : null);
    $$("[data-seg='odvia']", main).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.value === v)));
    $$("[data-via]", main).forEach((p) => { p.hidden = p.dataset.via !== (v || ""); });
  }
  $$("[data-seg='odvia']", main).forEach((x) => x.addEventListener("click", () => { st.via = x.dataset.value; pref.set({ via: st.via }); showVia(); }));

  // ---- 1. the race --------------------------------------------------------------------------------------------------
  let list = [];
  async function loadList() {
    try { list = (await (await fetch("/api/live/broadcasts", { credentials: "same-origin" })).json()).broadcasts || []; } catch (e) { list = []; }
    list = list.filter((b) => b.mine || me?.admin);
  }
  // the competitions a GPS tracking link may be given to (the last card): the same, from a week ago to three months ahead
  let agenda = [], comps = [], tcomps = [];
  try {
    const a = await data.agenda();
    const lo = new Date(Date.now() - 86400e3).toLocaleDateString("sv-SE"), hi = new Date(Date.now() + 2 * 86400e3).toLocaleDateString("sv-SE");
    agenda = (a?.events || []).filter((e) => e.date >= lo && e.date <= hi);
    // the competitions a broadcast may be tied to: the club's of France's agenda (an administrator's: all), from yesterday
    // to a week ahead — the server checks the account is one of their organisers (functions/api/live/broadcasts.js)
    if ((data.loadedCountry() || "FR") === "FR") {
      const club = auth.myClub(), hi7 = addDays(today, 7);
      comps = (a?.events || []).filter((e) => e.kind === "c" && e.id && !e.cancelled && e.date >= lo && e.date <= hi7
        && (me?.admin || (club && orgCode(e.org) === club))).map((e) => ({ key: `a${e.id}`, name: e.name, date: e.date, org: e.org || "" }));
      tcomps = (a?.events || []).filter((e) => e.kind === "c" && e.id && !e.cancelled && e.date >= addDays(today, -7) && e.date <= addDays(today, 90)
        && (me?.admin || (club && orgCode(e.org) === club))).map((e) => ({ key: `a${e.id}`, name: e.name, date: e.date, org: e.org || "" }));
    }
  } catch (e) { /* free entry only */ }
  try {
    const lo = addDays(today, -1), hi7 = addDays(today, 7);
    const mine = (await declare.load()).competitions.filter((d) => d.status !== "removed")
      .map((d) => ({ key: d.key, name: d.name, date: d.date, org: d.club || "" }));
    comps.push(...mine.filter((d) => d.date >= lo && d.date <= hi7));
    tcomps.push(...mine.filter((d) => d.date >= addDays(today, -7) && d.date <= addDays(today, 90)));
  } catch (e) { /* none declared */ }
  comps.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
  tcomps.sort((x, y) => x.date.localeCompare(y.date) || x.name.localeCompare(y.name));
  const compLabel = (c) => `${fmtDate(c.date)} · ${c.name}${c.org ? ` · ${c.org}` : ""}`;
  const errWord = (e) => (e === "not organiser" ? t("od.notOrganiser") : e);
  const current = () => list.find((b) => b.id === st.id) || null;
  function drawRace() {
    const b = current();
    $("#od-race").innerHTML = html`
      ${list.length ? html`<label class="field" style="max-width:520px"><span>${t("od.existing")}</span>
        <select id="od-pick"><option value="">${t("od.newRace")}</option>
          ${list.map((x) => html`<option value="${x.id}" ${raw(x.id === st.id ? "selected" : "")}>${x.name} · ${fmtDate(x.date)}${x.organizer ? ` · ${x.organizer}` : ""}</option>`)}
        </select></label>` : ""}
      ${b ? html`<p style="margin:10px 0 0"><b>${b.name}</b> · ${fmtDate(b.date)}${b.organizer ? ` · ${b.organizer}` : ""}<br>
          <span class="muted">${t("od.lastSent", { t: b.last ? new Date(b.last).toLocaleString(locale()) : t("od.never") })}</span>
          ${t("od.watch")} <b>${t("od.liveLink", { name: b.name })}</b>.</p>`
      : html`<div class="filters" style="margin-top:10px">
          <label class="field"><span>${t("od.comp")}</span><select id="od-comp" style="max-width:420px">
            <option value="">${t("od.comp.none")}</option>
            ${comps.map((c) => html`<option value="${c.key}">${compLabel(c)}</option>`)}</select></label>
        </div>
        <div class="muted" style="font-size:12.5px">${comps.length ? t("od.comp.hint") : t("od.comp.empty")}</div>
        <div class="filters" style="margin-top:10px">
          <label class="field"><span>${t("od.name")}</span><input id="od-name" list="od-agenda" style="width:300px" placeholder="${t("od.namePh")}"></label>
          <datalist id="od-agenda">${agenda.map((e) => html`<option value="${e.name}">${fmtDate(e.date)} · ${e.org || ""}</option>`)}</datalist>
          <label class="field"><span>${t("od.date")}</span><input id="od-date" type="date" value="${today}"></label>
          <label class="field"><span>${t("od.org")}</span><input id="od-org" style="width:220px" placeholder="Club"></label>
          <button type="button" class="btn btn-primary" id="od-create">${t("od.create")}</button>
        </div><div class="muted" id="od-race-msg" style="font-size:12.5px"></div>`}`;
    $("#od-pick")?.addEventListener("change", (e) => { stop(); st.id = e.target.value ? Number(e.target.value) : null; st.sent.clear(); st.order = "";
      st.handle = null; pref.set({ id: st.id }); drawRace(); restoreHandle(); });
    // a competition chosen: its name, day and organiser, as the agenda gives them
    $("#od-comp")?.addEventListener("change", (e) => {
      const c = comps.find((x) => x.key === e.target.value);
      for (const id of ["#od-name", "#od-date", "#od-org"]) $(id).disabled = !!c;
      if (c) { $("#od-name").value = c.name; $("#od-date").value = c.date; $("#od-org").value = c.org; }
    });
    $("#od-name")?.addEventListener("change", (e) => {
      const ev = agenda.find((x) => x.name === e.target.value);
      if (ev) { $("#od-date").value = ev.date; if (!$("#od-org").value) $("#od-org").value = ev.org || ""; }
    });
    $("#od-create")?.addEventListener("click", async () => {
      const name = $("#od-name").value.trim(), date = $("#od-date").value, organizer = $("#od-org").value.trim();
      const race = $("#od-comp")?.value || null;
      if (!race && (!name || !date)) { $("#od-race-msg").textContent = t("od.needName"); return; }
      const r = await fetch("/api/live/broadcasts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(race ? { race, organizer } : { name, date, organizer }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) { $("#od-race-msg").textContent = t("od.createFailed", { e: errWord(d.error || r.status) }); return; }
      st.id = d.id; pref.set({ id: st.id });
      await loadList(); drawRace(); drawFile();
    });
    drawMeos();
    drawFile();
    drawAfter();
    showVia();
  }

  // ---- 3. after the race: the broadcast tied to a competition is published in « Résultats »
  function drawAfter(msg = "") {
    const el = $("#od-after"), b = current();
    if (!b) { el.innerHTML = html`<p class="muted" style="margin:0">${t("od.pickRace")}</p>`; return; }
    // a broadcast's competition, even one gone from the choices (its day past)
    const choices = b.race && !comps.some((c) => c.key === b.race) ? [{ key: b.race, name: b.name, date: b.date, org: b.organizer || "" }, ...comps] : comps;
    el.innerHTML = html`
      <p style="margin:0">${b.race ? html`${t("od.linked")}`
        : html`<span class="muted">${t("od.linked.none")}</span>`}</p>
      <div class="filters">
        <label class="field"><span>${t("od.comp")}</span><select id="od-relink" style="max-width:420px">
          <option value="">${t("od.comp.none")}</option>
          ${choices.map((c) => html`<option value="${c.key}" ${raw(c.key === b.race ? "selected" : "")}>${compLabel(c)}</option>`)}</select></label>
        <button type="button" class="btn btn-sm" id="od-relink-go" disabled>${t("od.link")}</button>
        ${b.race ? html`<button type="button" class="btn btn-sm" id="od-publish">${t("od.publish")}</button>` : ""}
      </div>
      <div class="muted" id="od-link-msg" style="font-size:12.5px">${msg}</div>`;
    $("#od-relink").addEventListener("change", (e) => { $("#od-relink-go").disabled = (e.target.value || null) === (b.race || null); });
    $("#od-relink-go").addEventListener("click", async () => {
      const r = await fetch("/api/live/broadcasts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "link", id: b.id, race: $("#od-relink").value || null }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { $("#od-link-msg").textContent = t("od.link.failed", { e: errWord(d.error || r.status) }); return; }
      await loadList(); drawRace();
      drawAfter(d.race ? t("od.link.ok") : t("od.link.off"));
    });
    $("#od-publish")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const r = await fetch("/api/live/broadcasts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "publish", id: b.id }) });
      const d = await r.json().catch(() => ({}));
      e.target.disabled = false;
      $("#od-link-msg").textContent = !r.ok ? t("od.publish.failed", { e: errWord(d.error || r.status) })
        : !d.saved ? t("od.publish.empty") : d.run ? t("od.publish.ok") : t("od.publish.queued");
    });
  }

  // ---- 2. MeOS's online results: MeOS posts to /api/live/mop itself (functions/api/live/mop.js), with the race's number and
  // its MeOS password; this card gives them, and says when MeOS last sent something (the list is read again every 15 s)
  function drawMeos() {
    const el = $("#od-meos"), b = current();
    if (!b) { el.innerHTML = html`<div class="muted">${t("od.pickRace")}</div>`; return; }
    const copy = (v) => html`<button type="button" class="btn btn-sm" data-copy="${v}">${t("od.meos.copy")}</button>`;
    const url = `${location.origin}/api/live/mop`;
    el.innerHTML = html`<div class="od-meos">
        <span class="muted">${t("od.meos.url")}</span><span class="od-val"><code>${url}</code>${copy(url)}</span>
        <span class="muted">${t("od.meos.comp")}</span><span class="od-val"><code>${b.id}</code>${copy(String(b.id))}</span>
        <span class="muted">${t("od.meos.pwd")}</span><span class="od-val">${b.mop ? html`<code>${b.mop}</code>${copy(b.mop)}` : ""}
          <button type="button" class="btn btn-sm" id="od-mopkey">${b.mop ? t("od.meos.newPwd") : t("od.meos.makePwd")}</button></span>
      </div>
      <p class="muted od-log" id="od-meos-status"></p>`;
    meosStatus();
    $$("[data-copy]", el).forEach((x) => x.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(x.dataset.copy); x.textContent = t("od.meos.copied"); setTimeout(() => { x.textContent = t("od.meos.copy"); }, 1500); }
      catch (e) { /* the value can be selected by hand */ }
    }));
    $("#od-mopkey").addEventListener("click", async () => {
      if (b.mop && !confirm(t("od.meos.newPwdConfirm"))) return;
      const r = await fetch("/api/live/broadcasts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "mopkey", id: b.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.mop) { $("#od-meos-status").textContent = t("od.meos.failed", { e: d.error || r.status }); return; }
      b.mop = d.mop;
      drawMeos();
    });
  }
  function meosStatus() {
    const el = $("#od-meos-status"), b = current();
    if (!el || !b) return;
    el.textContent = b.mopAt ? t("od.meos.last", { t: `${Math.max(0, Math.round((Date.now() - b.mopAt) / 1000))} s`, n: b.mopRunners ?? 0 })
      : t("od.meos.none");
  }

  // ---- 2. the file and the reads -------------------------------------------------------------------------------------
  const ticker = new Worker(URL.createObjectURL(new Blob(["let h;onmessage=(e)=>{clearInterval(h);if(e.data>0)h=setInterval(()=>postMessage(1),e.data)};"],
    { type: "text/javascript" })));
  ticker.onmessage = () => { if (st.running) readOnce(); };
  function stop() { st.running = false; ticker.postMessage(0); }
  async function start() {
    if (!st.handle || !st.id) return;
    try {
      if ((await st.handle.queryPermission?.({ mode: "read" })) !== "granted" && (await st.handle.requestPermission?.({ mode: "read" })) !== "granted") {
        st.error = t("od.noPermission"); drawFile(); return;
      }
    } catch (e) { /* older browsers: the read below says */ }
    st.running = true; st.error = null;
    ticker.postMessage(st.every * 1000);
    drawFile();
    readOnce();
  }
  async function restoreHandle() {
    if (!st.id || !canPick) return;
    st.handle = (await handles.get(`h:${st.id}`)) || null;
    drawFile();
  }
  async function readOnce() {
    if (st.busy || !st.running) return;
    st.busy = true;
    try {
      const file = await st.handle.getFile();
      st.reads++; st.last = Date.now();
      const sig = `${file.lastModified}|${file.size}`;
      if (sig === st.seen) { st.busy = false; drawStatus(); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const head = new TextDecoder("latin1").decode(bytes.subarray(0, 600)).toLowerCase();
      let doc = null;
      if (head.includes("<resultlist")) doc = iofLive(new TextDecoder("utf-8").decode(bytes));
      else { const d = parseBytes(bytes, file.name); if (d) doc = fromLocal(d); }
      // unreadable: perhaps caught while the software writes it — read again at the next tick
      if (!doc || !doc.classes.length) { st.error = t("od.unreadable"); st.busy = false; drawStatus(); return; }
      const live = toLive(doc.classes);
      const b = current();
      const info = { name: b?.name || doc.title || t("od.raceFallback"), organizer: b?.organizer || "", date: b?.date || doc.date || today };
      const changed = {};
      for (const n of live.order) { const s = JSON.stringify(live.classes[n]); if (st.sent.get(n) !== s) changed[n] = live.classes[n]; }
      const order = JSON.stringify(live.order);
      st.stats = {
        classes: live.order.length,
        runners: doc.classes.reduce((s, k) => s + k.runners.length, 0),
        finished: doc.classes.reduce((s, k) => s + k.runners.filter((r) => r.status === 0 && r.time_s != null).length, 0),
        out: doc.classes.reduce((s, k) => s + k.runners.filter((r) => r.status === OUT).length, 0),
        iof: doc.iof,
      };
      if (Object.keys(changed).length || order !== st.order) {
        const r = await fetch(`/api/live/push?id=${st.id}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ info, order: live.order, classes: changed }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || t("od.refused", { status: r.status }));
        for (const n of Object.keys(changed)) st.sent.set(n, JSON.stringify(changed[n]));
        st.order = order; st.pushes++; st.lastPush = Date.now(); st.viewers = d.viewers ?? null; st.lastChanged = Object.keys(changed).length;
      }
      st.seen = sig; st.error = null;
    } catch (e) {
      st.error = t("od.error", { e: e.message || e });
    }
    st.busy = false;
    drawStatus();
  }
  function drawFile() {
    const el = $("#od-file");
    if (!st.id) { el.innerHTML = html`<div class="muted">${t("od.pickRace")}</div>`; return; }
    if (!canPick) {
      el.innerHTML = html`<div class="empty">${t("od.noApi")}</div>`;
      return;
    }
    el.innerHTML = html`<div class="filters">
        <button type="button" class="btn" id="od-choose">${st.handle ? t("od.chooseOther") : t("od.choose")}</button>
        <label class="field"><span>${t("od.every")}</span><select id="od-every">${INTERVALS.map((s) => html`<option value="${s}" ${raw(s === st.every ? "selected" : "")}>${t("od.seconds", { n: s })}</option>`)}</select></label>
        ${st.running ? html`<button type="button" class="btn" id="od-stop">${t("od.stop")}</button>`
          : html`<button type="button" class="btn btn-primary" id="od-start" ${raw(st.handle ? "" : "disabled")}>${st.reads ? t("od.resume") : t("od.start")}</button>`}
      </div>
      <div id="od-status"></div>`;
    $("#od-choose").addEventListener("click", async () => {
      try {
        const [h] = await window.showOpenFilePicker({ multiple: false, types: [{ description: t("od.fileType"),
          accept: { "text/xml": [".xml"], "text/html": [".html", ".htm"] } }], excludeAcceptAllOption: false });
        stop(); st.handle = h; st.seen = null; st.sent.clear(); st.order = "";
        await handles.set(`h:${st.id}`, h);
        drawFile();
      } catch (e) { /* the choice was cancelled */ }
    });
    $("#od-every").addEventListener("change", (e) => { st.every = Number(e.target.value); pref.set({ every: st.every }); if (st.running) ticker.postMessage(st.every * 1000); });
    $("#od-start")?.addEventListener("click", start);
    $("#od-stop")?.addEventListener("click", () => { stop(); drawFile(); });
    drawStatus();
  }
  function drawStatus() {
    const el = $("#od-status");
    if (!el) return;
    const s = st.stats, ago = (t) => (t ? `${Math.round((Date.now() - t) / 1000)} s` : "—");
    el.innerHTML = html`
      ${st.handle ? html`<p style="margin:10px 0 0">${t("od.fileLine")} <b>${st.handle.name}</b>${st.running ? html` · <span style="color:var(--good)">${t("od.running")}</span>`
        : html` · <span class="muted">${t("od.stopped")}</span>`}</p>` : ""}
      ${s ? html`<div class="od-grid">
        <div><span class="muted">${t("od.s.classes")}</span><b>${s.classes}</b></div>
        <div><span class="muted">${t("od.s.runners")}</span><b>${s.runners}</b></div>
        <div><span class="muted">${t("od.s.finished")}</span><b>${s.finished}</b></div>
        <div><span class="muted">${t("od.s.out")}</span><b>${s.iof ? s.out : "—"}</b></div>
        <div><span class="muted">${t("od.s.lastRead")}</span><b>${ago(st.last)}</b></div>
        <div><span class="muted">${t("od.s.lastSent")}</span><b>${ago(st.lastPush)}</b></div>
        <div><span class="muted">${t("od.s.viewers")}</span><b>${st.viewers ?? "—"}</b></div>
      </div>
      ${!s.iof ? html`<p class="muted od-log">${t("od.htmlNote")}</p>` : ""}` : ""}
      ${st.error ? html`<p class="od-log" style="color:var(--bad)">${st.error}</p>` : ""}`;
  }

  // ---- and a GPS tracking run by another service (Loggator, GPSSeuranta, TracTrac…): its link, shown on Agenda, Résultats
  // and En direct (functions/api/tracking.js; Ozimut reads no position)
  async function drawTrack(msg = "", fresh = false) {
    const links = await tracking.links({ fresh });
    const set = tcomps.filter((c) => links.has(c.key));
    $("#od-trk").innerHTML = !tcomps.length ? html`<div class="muted">${t("trk.org.empty")}</div>` : html`
      ${set.length ? html`<div class="table-wrap" style="margin-bottom:12px"><table class="data compact"><tbody>${set.map((c) => html`<tr>
        <td class="nowrap">${fmtDate(c.date)}</td><td>${c.name}</td>
        <td style="max-width:320px;overflow-wrap:anywhere"><a href="${links.get(c.key).url}" target="_blank" rel="noopener">${tracking.serviceOf(links.get(c.key).url)} ↗</a></td>
        <td class="r"><button type="button" class="btn btn-sm" data-trk-del="${c.key}">${t("trk.org.remove")}</button></td></tr>`)}</tbody></table></div>` : ""}
      <div class="filters">
        <label class="field"><span>${t("od.comp")}</span><select id="od-trk-comp" style="max-width:420px">
          ${tcomps.map((c) => html`<option value="${c.key}">${compLabel(c)}${links.has(c.key) ? " ✓" : ""}</option>`)}</select></label>
        <label class="field"><span>${t("trk.org.url")}</span><input id="od-trk-url" type="url" inputmode="url" style="width:340px" placeholder="https://www.loggator.com/…"></label>
        <button type="button" class="btn btn-primary" id="od-trk-save">${t("trk.org.save")}</button>
      </div>
      <div class="muted" style="font-size:12.5px">${t("trk.org.note")}</div>
      <div class="muted" id="od-trk-msg" style="font-size:12.5px">${msg}</div>`;
    const fill = () => { const l = links.get($("#od-trk-comp")?.value); if ($("#od-trk-url")) $("#od-trk-url").value = l?.url || ""; };
    fill();
    $("#od-trk-comp")?.addEventListener("change", fill);
    const call = async (method, body) => {
      const r = await fetch("/api/tracking", { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      const k = `trk.err.${String(d.error || "").replace(/\s+/g, "_")}`;
      return r.ok ? null : has(k) ? t(k) : t("trk.err.other", { e: d.error || r.status });
    };
    $("#od-trk-save")?.addEventListener("click", async (e) => {
      const url = $("#od-trk-url").value.trim();
      if (!/^https:\/\/\S+$/i.test(url)) { $("#od-trk-msg").textContent = t("trk.err.bad_url"); return; }
      e.target.disabled = true;
      const err = await call("POST", { race: $("#od-trk-comp").value, url });
      e.target.disabled = false;
      if (err) { $("#od-trk-msg").textContent = err; return; }
      drawTrack(t("trk.org.saved"), true);
    });
    $$("[data-trk-del]", $("#od-trk")).forEach((x) => x.addEventListener("click", async () => {
      const err = await call("DELETE", { race: x.dataset.trkDel });
      drawTrack(err || t("trk.org.removed"), true);
    }));
  }

  await loadList();
  if (st.id && !list.some((b) => b.id === st.id)) st.id = null;
  drawTrack();
  drawRace();
  await restoreHandle();
  let n = 0;
  const tick = setInterval(async () => {
    if (!main.isConnected) { clearInterval(tick); stop(); ticker.terminate(); return; }
    if (st.running) drawStatus();
    // MeOS's last message: the broadcasts read again every 15 s while one is chosen
    if (st.id && ++n % 3 === 0 && !document.hidden) { await loadList(); meosStatus(); } else meosStatus();
  }, 5000);
  return { title: t("nav.orgDirect") };
}
