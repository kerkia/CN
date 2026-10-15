// « Organisation › Direct » (#/orga-direct; every account since 2026-10-15, owner): an organiser feeds « En direct »
// from their timing software, without liveresultat. The software exports its result list to a file every few seconds;
// this page, open on the arena PC in Chrome or Edge (the File System Access API keeps the file: it is chosen once), re-reads
// it, reads it here — IOF XML 3.0 with its own reader below, which keeps the runners still out and their split times; the
// OE / MeOS HTML lists with localparse.js — and sends only the classes that changed (functions/api/live/push.js, then the
// race's object on the live server, ocap/worker, which pushes them to the pages watching). Nothing is declared beforehand:
// the classes, their controls and runners come from the file, and a class that appears is added. A timer in a small
// Worker paces the reads (a hidden tab's own timers are slowed to once a minute); the file's handle is kept in IndexedDB,
// so a reload asks one click to read it again. A broadcast is fed by the account that opened it (or an administrator):
// the page lists one's own broadcasts only (all of them to administrators).

import { html, raw, $, fmtDate } from "../util.js";
import * as auth from "../auth.js";
import * as data from "../data.js";
import { parseBytes } from "../localparse.js";

const PREF = "ocn.direct";                        // the broadcast chosen and the interval, on this computer
const LIVE_STATUS = { ok: 0, finished: 0, missingpunch: 3, mispunch: 3, disqualified: 4, didnotfinish: 2, sportingwithdrawal: 2,
  overtime: 5, didnotstart: 1, didnotenter: 1, cancelled: 1, notcompeting: 12 };            // IOF XML -> liveresultat's codes
const LOCAL_STATUS = { ok: 0, mp: 3, dsq: 4, dnf: 2, ot: 5, dns: 1, nc: 12 };               // localparse -> liveresultat's
const OUT = 9;                                    // still out (or not started yet): « En direct » tells them by the start time
const INTERVALS = [10, 15, 30, 60];

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
const STEPS = html`
  <h3 style="margin:0 0 6px">Avant la course</h3>
  <ol class="od-steps">
    <li>Dans votre logiciel de chronométrage, programmez un <b>export automatique de la liste des résultats</b> vers un fichier,
      toutes les 15 à 30 secondes, toujours au même endroit et sous le même nom.
      <ul>
        <li>Le format conseillé est l'<b>IOF XML 3.0</b> (liste de résultats) : il contient les heures de départ, les temps
          intermédiaires et les coureurs encore en course.</li>
        <li>Les listes de résultats HTML de MeOS et d'OE (SportSoftware) sont aussi lues, mais elles ne montrent que les coureurs
          arrivés ou sortis de course.</li>
        <li>Si votre logiciel ne sait pas exporter à intervalle régulier, exportez le fichier à la main de temps en temps, sous le même
          nom : la page reprend chaque nouvelle version.</li>
      </ul></li>
    <li>Faites un essai la veille, avec le fichier d'une course passée ou de la course en préparation.</li>
  </ol>
  <h3 style="margin:14px 0 6px">Le jour de la course</h3>
  <ol class="od-steps" start="3">
    <li>Sur l'ordinateur de l'arène, relié à internet, ouvrez cette page dans <b>Chrome ou Edge</b>. Firefox et Safari ne permettent
      pas à une page de relire un fichier toute seule.</li>
    <li>Connectez-vous à O'CN avec le compte qui crée la diffusion : seul ce compte peut ensuite l'alimenter. Vous pouvez la
      créer la veille, d'ici ou d'un autre ordinateur.</li>
    <li>Choisissez la course ci-dessous, ou créez-la : son nom, sa date et l'organisateur suffisent.</li>
    <li>Choisissez le fichier exporté, <b>une seule fois</b>. Le navigateur demande l'autorisation de le lire.</li>
    <li>Cliquez sur « Démarrer ». La page relit le fichier toute seule, toutes les 15 secondes par défaut, et n'envoie que ce qui a
      changé.</li>
    <li>Laissez la page ouverte, de préférence dans sa propre fenêtre, et l'ordinateur allumé, sans mise en veille. Si la page est
      rechargée, un clic sur « Reprendre » suffit.</li>
  </ol>
  <h3 style="margin:14px 0 6px">Ce qu'il n'y a pas à faire</h3>
  <ul class="od-steps">
    <li>Les circuits, les catégories, les postes et les coureurs n'ont pas à être déclarés : ils viennent du fichier, et un circuit qui
      apparaît en cours de course est ajouté.</li>
    <li>Les coureurs sont reconnus par leur nom et leur club, et reliés à leur page sur O'CN.</li>
  </ul>
  <p style="margin:12px 0 0">Les spectateurs suivent la course dans <b>Courses › En direct</b> : le lien apparaît plus bas une fois la
    course choisie.</p>`;

// (exported for checks in the browser's console)
export { iofLive, toLive };

export async function render(main) {
  const me = auth.session();
  const canPick = typeof window.showOpenFilePicker === "function";
  const today = new Date().toLocaleDateString("sv-SE");
  const st = { id: pref.get().id || null, every: pref.get().every || 15, handle: null, running: false, sent: new Map(), order: "",
    seen: null, reads: 0, pushes: 0, last: null, lastPush: null, error: null, stats: null, info: null, viewers: null, busy: false };

  main.innerHTML = html`
    <div class="page-head"><div><h1>Diffuser en direct</h1>
      <p class="lede">Depuis le logiciel de chronométrage, sans liveresultat : le fichier de résultats exporté pendant la course est relu
        ici et diffusé dans « En direct ».</p></div></div>
    <section class="card"><div class="card-head"><h2>Comment ça marche</h2></div><div class="card-body">${STEPS}</div></section>
    <section class="card"><div class="card-head"><div><h2>1. La course</h2><div class="hint">Une diffusion par course ; on peut la reprendre plus tard.</div></div></div>
      <div class="card-body" id="od-race"><div class="empty">Chargement…</div></div></section>
    <section class="card"><div class="card-head"><div><h2>2. Le fichier exporté</h2><div class="hint">Choisi une fois, relu tout seul.</div></div></div>
      <div class="card-body" id="od-file"></div></section>
    <style>
      .od-steps { margin: 0; padding-left: 22px; line-height: 1.55 }
      .od-steps li { margin: 4px 0 }
      .od-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 12px }
      .od-grid > div { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px }
      .od-grid b { display: block; font-size: 18px }
      .od-log { font-size: 12.5px; margin-top: 10px }
    </style>`;

  // ---- 1. the race --------------------------------------------------------------------------------------------------
  let list = [];
  async function loadList() {
    try { list = (await (await fetch("/api/live/broadcasts", { credentials: "same-origin" })).json()).broadcasts || []; } catch (e) { list = []; }
    list = list.filter((b) => b.mine || me?.admin);
  }
  let agenda = [];
  try {
    const a = await data.agenda();
    const lo = new Date(Date.now() - 86400e3).toLocaleDateString("sv-SE"), hi = new Date(Date.now() + 2 * 86400e3).toLocaleDateString("sv-SE");
    agenda = (a?.events || []).filter((e) => e.date >= lo && e.date <= hi);
  } catch (e) { /* free entry only */ }
  const current = () => list.find((b) => b.id === st.id) || null;
  function drawRace() {
    const b = current();
    $("#od-race").innerHTML = html`
      ${list.length ? html`<label class="field" style="max-width:520px"><span>Diffusions existantes</span>
        <select id="od-pick"><option value="">— nouvelle course —</option>
          ${list.map((x) => html`<option value="${x.id}" ${raw(x.id === st.id ? "selected" : "")}>${x.name} · ${fmtDate(x.date)}${x.organizer ? ` · ${x.organizer}` : ""}</option>`)}
        </select></label>` : ""}
      ${b ? html`<p style="margin:10px 0 0"><b>${b.name}</b> · ${fmtDate(b.date)}${b.organizer ? ` · ${b.organizer}` : ""}<br>
          <span class="muted">Dernier envoi : ${b.last ? new Date(b.last).toLocaleString("fr-FR") : "aucun"}.</span>
          Les spectateurs la suivent ici : <a href="#/direct/${b.id}">En direct › ${b.name}</a>.</p>`
      : html`<div class="filters" style="margin-top:10px">
          <label class="field"><span>Nom de la course</span><input id="od-name" list="od-agenda" style="width:300px" placeholder="Régionale de …"></label>
          <datalist id="od-agenda">${agenda.map((e) => html`<option value="${e.name}">${fmtDate(e.date)} · ${e.org || ""}</option>`)}</datalist>
          <label class="field"><span>Date</span><input id="od-date" type="date" value="${today}"></label>
          <label class="field"><span>Organisateur</span><input id="od-org" style="width:220px" placeholder="Club"></label>
          <button type="button" class="btn btn-primary" id="od-create">Créer la diffusion</button>
        </div><div class="muted" id="od-race-msg" style="font-size:12.5px"></div>`}`;
    $("#od-pick")?.addEventListener("change", (e) => { stop(); st.id = e.target.value ? Number(e.target.value) : null; st.sent.clear(); st.order = "";
      st.handle = null; pref.set({ id: st.id }); drawRace(); restoreHandle(); });
    $("#od-name")?.addEventListener("change", (e) => {
      const ev = agenda.find((x) => x.name === e.target.value);
      if (ev) { $("#od-date").value = ev.date; if (!$("#od-org").value) $("#od-org").value = ev.org || ""; }
    });
    $("#od-create")?.addEventListener("click", async () => {
      const name = $("#od-name").value.trim(), date = $("#od-date").value, organizer = $("#od-org").value.trim();
      if (!name || !date) { $("#od-race-msg").textContent = "Le nom et la date sont nécessaires."; return; }
      const r = await fetch("/api/live/broadcasts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, date, organizer }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) { $("#od-race-msg").textContent = `La diffusion n'a pas pu être créée (${d.error || r.status}).`; return; }
      st.id = d.id; pref.set({ id: st.id });
      await loadList(); drawRace(); drawFile();
    });
    drawFile();
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
        st.error = "Le navigateur n'a pas donné l'autorisation de lire le fichier."; drawFile(); return;
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
      if (!doc || !doc.classes.length) { st.error = "Le fichier n'a pas pu être lu cette fois (en cours d'écriture ?) : nouvel essai au prochain tour."; st.busy = false; drawStatus(); return; }
      const live = toLive(doc.classes);
      const b = current();
      const info = { name: b?.name || doc.title || "Course", organizer: b?.organizer || "", date: b?.date || doc.date || today };
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
        if (!r.ok) throw new Error(d.error || `envoi refusé (${r.status})`);
        for (const n of Object.keys(changed)) st.sent.set(n, JSON.stringify(changed[n]));
        st.order = order; st.pushes++; st.lastPush = Date.now(); st.viewers = d.viewers ?? null; st.lastChanged = Object.keys(changed).length;
      }
      st.seen = sig; st.error = null;
    } catch (e) {
      st.error = `Erreur : ${e.message || e}. Nouvel essai au prochain tour.`;
    }
    st.busy = false;
    drawStatus();
  }
  function drawFile() {
    const el = $("#od-file");
    if (!st.id) { el.innerHTML = html`<div class="muted">Choisissez ou créez d'abord la course.</div>`; return; }
    if (!canPick) {
      el.innerHTML = html`<div class="empty">Ce navigateur ne permet pas de relire un fichier tout seul. Ouvrez cette page dans Chrome ou Edge.</div>`;
      return;
    }
    el.innerHTML = html`<div class="filters">
        <button type="button" class="btn" id="od-choose">${st.handle ? "Choisir un autre fichier" : "Choisir le fichier exporté"}</button>
        <label class="field"><span>Relire toutes les</span><select id="od-every">${INTERVALS.map((s) => html`<option value="${s}" ${raw(s === st.every ? "selected" : "")}>${s} secondes</option>`)}</select></label>
        ${st.running ? html`<button type="button" class="btn" id="od-stop">Arrêter</button>`
          : html`<button type="button" class="btn btn-primary" id="od-start" ${raw(st.handle ? "" : "disabled")}>${st.reads ? "Reprendre" : st.handle && !st.pushes ? "Démarrer" : "Démarrer"}</button>`}
      </div>
      <div id="od-status"></div>`;
    $("#od-choose").addEventListener("click", async () => {
      try {
        const [h] = await window.showOpenFilePicker({ multiple: false, types: [{ description: "Résultats (IOF XML, HTML)",
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
      ${st.handle ? html`<p style="margin:10px 0 0">Fichier : <b>${st.handle.name}</b>${st.running ? html` · <span style="color:var(--good)">● diffusion en cours</span>`
        : html` · <span class="muted">arrêtée</span>`}</p>` : ""}
      ${s ? html`<div class="od-grid">
        <div><span class="muted">Circuits</span><b>${s.classes}</b></div>
        <div><span class="muted">Coureurs</span><b>${s.runners}</b></div>
        <div><span class="muted">Arrivés</span><b>${s.finished}</b></div>
        <div><span class="muted">En course ou pas encore partis</span><b>${s.iof ? s.out : "—"}</b></div>
        <div><span class="muted">Dernière lecture</span><b>${ago(st.last)}</b></div>
        <div><span class="muted">Dernier envoi</span><b>${ago(st.lastPush)}</b></div>
        <div><span class="muted">Spectateurs connectés</span><b>${st.viewers ?? "—"}</b></div>
      </div>
      ${!s.iof ? html`<p class="muted od-log">Liste HTML : seuls les coureurs arrivés ou sortis de course apparaissent. L'IOF XML 3.0 montre aussi ceux qui
        sont en course.</p>` : ""}` : ""}
      ${st.error ? html`<p class="od-log" style="color:var(--bad)">${st.error}</p>` : ""}`;
  }

  await loadList();
  if (st.id && !list.some((b) => b.id === st.id)) st.id = null;
  drawRace();
  await restoreHandle();
  const tick = setInterval(() => { if (!main.isConnected) { clearInterval(tick); stop(); ticker.terminate(); } else if (st.running) drawStatus(); }, 5000);
  return { title: "Direct" };
}
