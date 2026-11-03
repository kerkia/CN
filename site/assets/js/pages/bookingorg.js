// « Orga › Horaires › Réservation des horaires » (#/orga-horaires?course=<key>&resa=1, owner 2026-11-03): a competition's
// organisers open its start times to booking (pages/booking.js, #/horaire?course=), in place of a Google Sheet. 1. the
// settings — the circuits (first and last start, interval), the gap between two runners of a club (any circuit), the
// closing time, how many runners an account books, the card number asked or not, a note —, draft / open / closed; 2. a
// sheet or file already filled in, imported (its circuits proposed when none are set, its runners booked as the organisers'
// entries); 3. the bookings, changed, cancelled (the booker told: « Mes horaires réservés »), added by hand; 4. the start list:
// published at the closing (and again after a change), or now, and the files for the timing software (CSV, IOF XML, O Checklist).

import { html, raw, $, $$, fmt, fmtDate, addDays } from "../util.js";
import { t, tn, loadArea } from "../i18n.js";
import { call, hm, parseHm, parseStep, fmtStep, slotsOf, clubLabel, clubList, runnerForm, bindRunnerForm, takenMap, clashes } from "../bookingcore.js";
import { sheetTabs } from "../sheettabs.js";
import { parse as readStarts } from "../localstart.js";
import { oChecklist, saveOChecklist } from "../startchecks.js";

await loadArea("booking");

const uid = () => `c${Math.random().toString(36).slice(2, 8)}`;
const save = (name, text, type) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const slug = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const xml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** `race`: { key, e: { name, date, place, org, reg } } from Orga › Horaires' list (one's club's, or declared). */
export async function renderBooking(main, race) {
  const key = race.key, e = race.e;
  main.innerHTML = html`<div class="empty">${t("bk.loading")}</div>`;
  let r = await call("GET", `/${encodeURIComponent(key)}`);
  if (!r.ok && r.status !== 404) {
    main.innerHTML = html`<div class="card"><div class="empty">${t(r.status === 503 ? "bk.err.notReady" : "bk.err.load")}</div></div>`;
    return { title: t("bk.org.title") };
  }
  const st = { ev: r.ok ? r.data.event : null, bookings: r.ok ? r.data.bookings : [], circuit: null, moving: null, adding: false };
  // settings being edited (not saved yet)
  const close0 = `${addDays(e.date, -3)}T23:59`;
  const cfg = st.ev ? { circuits: st.ev.circuits.map((c) => ({ ...c })), gap: st.ev.gap, max: st.ev.max, close: st.ev.close || "", card: !!st.ev.card,
    note: st.ev.note || "", blocked: st.ev.blocked || {}, status: st.ev.status }
    : { circuits: [], gap: 240, max: 10, close: close0, card: false, note: "", blocked: {}, status: "draft" };
  const share = `${location.origin}${location.pathname}#/horaire?course=${encodeURIComponent(key)}`;

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("bk.org.title")}</h1>
      <p class="lede meta"><span>${e.name}</span><span>${fmtDate(e.date)}</span>${e.place ? html`<span>${e.place}</span>` : ""}</p></div>
      <div class="page-actions"><a class="btn btn-sm" href="#/orga-horaires?course=${encodeURIComponent(key)}">${t("bk.org.backDeposit")}</a></div></div>
    <p class="muted" style="margin:0 2px 14px">${t("bk.org.lede")}</p>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("bk.org.s1")}</h2><div class="hint" id="bo-state"></div></div></div>
      <div class="card-body" id="bo-settings"></div></section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("bk.org.s2")}</h2><div class="hint">${t("bk.org.s2.hint")}</div></div></div>
      <div class="card-body" id="bo-import"></div></section>
    <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("bk.org.s3")}</h2><div class="hint" id="bo-count"></div></div>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>${t("col.circuit")}</span><select id="bo-circuit"></select></label></div>
      <div class="card-body" id="bo-add"></div><div class="table-wrap" id="bo-table"></div></section>
    <section class="card"><div class="card-head"><div><h2>${t("bk.org.s4")}</h2><div class="hint" id="bo-pub-hint"></div></div></div>
      <div class="card-body" id="bo-publish"></div></section>`;

  // ---- 1. settings ----
  function drawSettings() {
    const saved = !!st.ev;
    $("#bo-state").innerHTML = saved ? html`${t(`bk.st.${st.ev.status}`)}${st.ev.status !== "draft" ? html` · <a href="#/horaire?course=${encodeURIComponent(key)}">${t("bk.org.see")}</a>` : ""}`
      : t("bk.org.new");
    const [cd, ch] = (cfg.close || "").split("T");
    const regNames = (e.reg?.circuits || []).map((c) => c[0]).filter(Boolean);
    $("#bo-settings").innerHTML = html`
      <div class="bo-status" role="radiogroup" aria-label="${t("bk.org.status")}">${["draft", "open", "closed"].map((s) => html`<label class="check">
        <input type="radio" name="bo-status" value="${s}" ${cfg.status === s ? "checked" : ""}> <b>${t(`bk.st.${s}`)}</b> <span class="muted">${t(`bk.org.st.${s}`)}</span></label>`)}</div>
      <div class="filters bo-fields">
        <label class="field"><span>${t("bk.org.close")}</span><span class="row" style="gap:6px"><input type="date" id="bo-close-d" value="${cd || ""}" max="${e.date}">
          <input type="time" id="bo-close-h" value="${ch || "23:59"}"></span></label>
        <label class="field"><span>${t("bk.org.gap")}</span><input id="bo-gap" value="${fmtStep(cfg.gap)}" style="width:80px" inputmode="decimal"></label>
        <label class="field"><span>${t("bk.org.max")}</span><input id="bo-max" type="number" min="1" max="30" value="${cfg.max}" style="width:80px"></label>
        <label class="check" style="align-self:flex-end"><input type="checkbox" id="bo-card" ${cfg.card ? "checked" : ""}> ${t("bk.org.card")}</label>
      </div>
      <label class="field" style="margin:4px 0 14px"><span>${t("bk.org.note")}</span><textarea id="bo-note" rows="2" maxlength="600" placeholder="${t("bk.org.note.ph")}">${cfg.note}</textarea></label>
      <h3 class="bo-h">${t("bk.org.circuits")}</h3>
      <div class="table-wrap"><table class="data compact bo-circuits"><thead><tr><th>${t("bk.org.c.name")}</th><th>${t("bk.org.c.first")}</th><th>${t("bk.org.c.last")}</th>
        <th>${t("bk.org.c.step")}</th><th class="r">${t("bk.org.c.slots")}</th><th class="r">${t("bk.org.c.booked")}</th><th></th></tr></thead>
        <tbody>${cfg.circuits.map((c, i) => {
          const n = st.bookings.filter((b) => b.c === c.id).length;
          return html`<tr data-i="${i}"><td><input data-f="name" value="${c.name}" maxlength="60" style="width:180px"></td>
            <td><input data-f="first" value="${hm(c.first)}" style="width:70px"></td><td><input data-f="last" value="${hm(c.last)}" style="width:70px"></td>
            <td><input data-f="step" value="${fmtStep(c.step)}" style="width:60px"></td>
            <td class="r num">${fmt(c.step ? Math.floor((c.last - c.first) / c.step) + 1 : 0)}</td><td class="r num">${fmt(n)}</td>
            <td class="r">${n ? "" : html`<button type="button" class="icon-btn" data-del="${i}" title="${t("bk.org.c.del")}" aria-label="${t("bk.org.c.del")}">✕</button>`}</td></tr>`;
        })}</tbody></table></div>
      <p class="muted bk-small">${t("bk.org.c.hint")}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0 14px"><button type="button" class="btn btn-sm" id="bo-c-add">+ ${t("bk.org.c.add")}</button>
        ${regNames.length ? html`<button type="button" class="btn btn-sm" id="bo-c-reg">${t("bk.org.c.reg", { n: regNames.length })}</button>` : ""}</div>
      <div id="bo-s-err"></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
        <button type="button" class="btn btn-primary" id="bo-save">${t("bk.org.save")}</button>
        ${saved ? html`<button type="button" class="btn" id="bo-drop">${t("bk.org.drop")}</button>` : ""}</div>
      ${saved && st.ev.status !== "draft" ? html`<div class="notice info" style="margin-top:14px">${t("bk.org.share")}
        <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap"><input readonly value="${share}" id="bo-link" style="flex:1;min-width:240px">
        <button type="button" class="btn btn-sm" id="bo-copy">${t("bk.org.copy")}</button></div></div>` : ""}`;
    const regBtn = $("#bo-c-reg");
    if (regBtn) regBtn.onclick = () => {
      const last = cfg.circuits.at(-1);
      for (const name of regNames) if (!cfg.circuits.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        cfg.circuits.push({ id: uid(), name, first: last?.first ?? 9 * 3600 + 1800, last: last?.last ?? 12 * 3600, step: last?.step ?? 120 });
      }
      drawSettings();
    };
  }
  function readSettings() {
    const err = (m) => { $("#bo-s-err").innerHTML = html`<div class="notice" style="margin-bottom:10px">${m}</div>`; return null; };
    $("#bo-s-err").innerHTML = "";
    const gap = parseStep($("#bo-gap").value), max = Number($("#bo-max").value);
    if (gap == null || gap > 3600) return err(t("bk.org.err.gap"));
    if (!(max >= 1 && max <= 30)) return err(t("bk.org.err.max"));
    const d = $("#bo-close-d").value, h = $("#bo-close-h").value || "23:59";
    const circuits = [];
    for (const tr of $$(".bo-circuits tbody tr")) {
      const c = cfg.circuits[Number(tr.dataset.i)], v = (f) => $(`[data-f=${f}]`, tr).value;
      const name = v("name").trim(), first = parseHm(v("first")), last = parseHm(v("last")), step = parseStep(v("step"));
      if (!name || first == null || last == null || !step || step < 10 || last < first) return err(t("bk.org.err.circuit", { name: name || "?" }));
      if ((last - first) / step + 1 > 400) return err(t("bk.org.err.many", { name }));
      circuits.push({ id: c.id, name, first, last, step });
    }
    if (!circuits.length) return err(t("bk.org.err.none"));
    if (new Set(circuits.map((c) => c.name.toLowerCase())).size < circuits.length) return err(t("bk.org.err.twice"));
    return { circuits, gap, max, close: d ? `${d}T${h}` : "", card: $("#bo-card").checked, note: $("#bo-note").value.trim(), blocked: cfg.blocked,
      status: $("input[name=bo-status]:checked")?.value || "draft" };
  }
  // the table's edits kept before it is drawn again (a row added or removed), even half typed
  const keepEdits = () => {
    for (const tr of $$(".bo-circuits tbody tr")) {
      const c = cfg.circuits[Number(tr.dataset.i)], v = (f) => $(`[data-f=${f}]`, tr).value;
      c.name = v("name").trim();
      c.first = parseHm(v("first")) ?? c.first; c.last = parseHm(v("last")) ?? c.last; c.step = parseStep(v("step")) || c.step;
    }
  };
  $("#bo-settings").addEventListener("click", async (ev) => {
    if (ev.target.id === "bo-c-add") {
      keepEdits();
      const last = cfg.circuits.at(-1);
      cfg.circuits.push({ id: uid(), name: "", first: last?.first ?? 9 * 3600 + 1800, last: last?.last ?? 12 * 3600, step: last?.step ?? 120 });
      drawSettings();
      $$(".bo-circuits [data-f=name]").at(-1)?.focus();
    } else if (ev.target.closest("[data-del]")) {
      keepEdits();
      cfg.circuits.splice(Number(ev.target.closest("[data-del]").dataset.del), 1);
      drawSettings();
    } else if (ev.target.id === "bo-save") {
      const x = readSettings();
      if (!x) return;
      const { status, ...config } = x;
      ev.target.disabled = true;
      const y = await call("PUT", `/${encodeURIComponent(key)}/config`, { config, status });
      ev.target.disabled = false;
      if (!y.ok) {
        $("#bo-s-err").innerHTML = html`<div class="notice">${t(y.data.error === "circuit in use" ? "bk.org.err.inUse" : y.data.error === "past" ? "bk.org.err.past"
          : y.status === 403 ? "os.notMine" : "bk.err.save")}</div>`;
        return;
      }
      Object.assign(cfg, x);
      await reload();
      if (imported) took(imported);          // a sheet read before the first save: its import now possible
      $("#bo-s-err").innerHTML = html`<div class="notice ok" style="margin-bottom:10px">${t("bk.org.saved")}</div>`;
    } else if (ev.target.id === "bo-drop") {
      if (!confirm(tn("bk.org.drop.confirm", st.bookings.length, { n: st.bookings.length }))) return;
      const y = await call("DELETE", `/${encodeURIComponent(key)}/config`);
      if (y.ok) { st.ev = null; st.bookings = []; Object.assign(cfg, { status: "draft" }); drawAll(); }
    } else if (ev.target.id === "bo-copy") {
      navigator.clipboard?.writeText(share).then(() => { ev.target.textContent = t("bk.org.copied"); }).catch(() => $("#bo-link").select());
    }
  });

  // ---- 2. import ----
  let imported = null;
  function drawImport() {
    $("#bo-import").innerHTML = html`<div class="filters" style="margin:0;padding:0;border:0;background:none;gap:10px;flex-wrap:wrap">
        <label class="field" style="flex:1;min-width:240px"><span>${t("os.sheet")}</span><input type="url" id="bo-sheet" placeholder="https://docs.google.com/spreadsheets/d/…"></label>
        <button type="button" class="btn btn-sm" id="bo-sheet-read" style="align-self:flex-end">${t("os.sheet.read")}</button>
        <label class="btn btn-sm" style="align-self:flex-end">${t("bk.org.i.file")}<input type="file" id="bo-file" accept=".xml,.csv,.txt,.html,.htm,.pdf" hidden></label></div>
      <div id="bo-i-res" style="margin-top:10px"></div>`;
  }
  const iErr = (m) => { $("#bo-i-res").innerHTML = html`<div class="notice">${m}</div>`; };
  async function took(read) {
    if (!read?.classes?.length) return iErr(t("os.err.read"));
    imported = read;
    const n = read.classes.reduce((a, k) => a + k.runners.length, 0);
    const known = (k) => cfg.circuits.find((c) => c.name.toLowerCase() === k.name.toLowerCase());
    const missing = read.classes.filter((k) => !known(k));
    $("#bo-i-res").innerHTML = html`<div class="notice info">${t("bk.org.i.read", { n: fmt(n), c: read.classes.length })}
      <ul style="margin:6px 0 0;padding-left:18px">${read.classes.map((k) => html`<li>${k.name} · ${tn("bk.org.i.runners", k.runners.length, { n: k.runners.length })}${known(k) ? "" : html` <span class="tag">${t("bk.org.i.newCircuit")}</span>`}</li>`)}</ul></div>
      ${missing.length ? html`<p class="muted bk-small">${t("bk.org.i.circuits")}</p>` : ""}
      <div class="row" style="gap:8px;margin-top:8px"><button type="button" class="btn btn-sm btn-primary" id="bo-i-go" ${st.ev ? "" : "disabled"}>${t("bk.org.i.go", { n: fmt(n) })}</button>
        ${missing.length ? html`<button type="button" class="btn btn-sm" id="bo-i-circ">${tn("bk.org.i.addCircuits", missing.length, { n: missing.length })}</button>` : ""}</div>
      ${st.ev ? "" : html`<p class="muted bk-small">${t("bk.org.i.saveFirst")}</p>`}`;
  }
  /**
   * The circuits from the starts read: each circuit's interval (the greatest common divisor of its gaps, capped at 2 minutes;
   * a circuit with one runner takes the others' most common one), over one window for all — from the earliest start read to
   * the latest, each circuit kept on its own minute (Balise 77: the odd minutes for one, the even for the next).
   */
  function inferredAll(classes) {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const starts = classes.map((k) => [...new Set(k.runners.map((r) => r.start_s).filter((x) => x != null).map(Math.round))].sort((a, b) => a - b));
    const steps = starts.map((s) => {
      let g = 0;
      for (let i = 1; i < s.length; i++) g = gcd(g, s[i] - s[i - 1]);
      return g >= 30 ? Math.min(g, 120) : 0;
    });
    const common = Object.entries(steps.filter(Boolean).reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
    const all = starts.flat(), lo = Math.min(...all), hi = Math.max(...all);
    return classes.map((k, i) => {
      const s = starts[i];
      let step = steps[i] || Number(common?.[0]) || 60;
      if (s.length > 1 && (s.at(-1) - s[0]) % step) step = 60;
      const at = s[0] ?? lo, first = at - Math.floor((at - lo) / step) * step, last = at + Math.floor((hi - at) / step) * step;
      return { id: uid(), name: k.name, first, last: Math.max(last, first + step), step };
    });
  }
  /** "Dorian BENOIT" -> first, last: the words in capitals are the last name, else the last word. */
  function split(name) {
    const w = String(name || "").trim().split(/\s+/);
    const caps = (x) => x === x.toUpperCase() && /[A-ZÀ-Þ]/.test(x);
    const i = w.findIndex(caps);
    if (i > 0 && w.slice(i).every(caps)) return { first: w.slice(0, i).join(" "), last: w.slice(i).join(" ") };
    if (i === 0 && w.length > 1 && !caps(w.at(-1))) {
      const j = w.findIndex((x) => !caps(x));
      return { first: w.slice(j).join(" "), last: w.slice(0, j).join(" ") };
    }
    return w.length > 1 ? { first: w.slice(0, -1).join(" "), last: w.at(-1) } : { first: w[0] || "?", last: "?" };
  }
  $("#bo-import").addEventListener("click", async (ev) => {
    if (ev.target.id === "bo-sheet-read") {
      const url = $("#bo-sheet").value.trim();
      if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(url)) return iErr(t("os.sheet.bad"));
      ev.target.disabled = true;
      const got = await sheetTabs(url);
      ev.target.disabled = false;
      if (got.error) return iErr(got.error === "not shared" ? t("os.sheet.private") : got.error === "too many" ? t("up.err.many") : got.error === "read" ? t("os.err.read") : t("os.sheet.fail"));
      return took(got.read);
    }
    if (ev.target.id === "bo-i-circ") {
      keepEdits();
      const missing = imported.classes.filter((k) => !cfg.circuits.some((c) => c.name.toLowerCase() === k.name.toLowerCase()));
      cfg.circuits.push(...inferredAll(missing));
      drawSettings(); took(imported);
      $("#bo-settings").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (ev.target.id === "bo-i-go") {
      const byName = new Map(st.ev.circuits.map((c) => [c.name.toLowerCase(), c.id]));
      // France's clubs written by their number: their names from the federation's list
      const ffco = new Map(((await clubList("FR")) || []).map((c) => [c.code, c.name]));
      const add = [], skipped = [];
      for (const k of imported.classes) {
        const cid = byName.get(k.name.toLowerCase());
        for (const r of k.runners) {
          if (!cid || r.start_s == null) { skipped.push(r.name); continue; }
          const { first, last } = split(r.name), club = String(r.club || "").trim();
          add.push({ circuit: cid, start: Math.round(r.start_s), first_name: first, last_name: last, card: r.card || "",
            ...(!club ? {} : /^\d{3,4}$/.test(club) ? { club_country: "FR", club_code: club.padStart(4, "0"), club_name: ffco.get(club.padStart(4, "0")) || "" }
              : { club_country: st.ev.country || "FR", club_name: club }) });
        }
      }
      ev.target.disabled = true;
      const y = await call("POST", `/${encodeURIComponent(key)}/org`, { add, force: true });
      ev.target.disabled = false;
      const res = y.data.results || [];
      const ok = res.filter((x) => x.ok).length, taken = res.filter((x) => x.error === "taken" || x.error === "twice").length;
      const bad = res.length - ok - taken + skipped.length;
      $("#bo-i-res").innerHTML = html`<div class="notice ${ok ? "ok" : ""}">${t("bk.org.i.done", { ok: fmt(ok), taken: fmt(taken), bad: fmt(bad) })}</div>`;
      await reload();
    }
  });
  $("#bo-import").addEventListener("change", async (ev) => {
    if (ev.target.id !== "bo-file" || !ev.target.files[0]) return;
    const f = ev.target.files[0];
    took(await readStarts(new Uint8Array(await f.arrayBuffer()), f.name).catch(() => null));
  });

  // ---- 3. the bookings ----
  function drawBookings() {
    if (!st.ev) {
      $("#bo-count").textContent = ""; $("#bo-add").innerHTML = html`<div class="empty">${t("bk.org.saveFirst")}</div>`; $("#bo-table").innerHTML = "";
      $("#bo-circuit").innerHTML = "";
      return;
    }
    const ev = st.ev;
    $("#bo-count").textContent = tn("bk.org.count", st.bookings.length, { n: fmt(st.bookings.length), all: fmt(ev.circuits.reduce((a, c) => a + slotsOf(c).length, 0)) });
    if (!ev.circuits.some((c) => c.id === st.circuit)) st.circuit = ev.circuits[0]?.id;
    $("#bo-circuit").innerHTML = ev.circuits.map((c) => html`<option value="${c.id}" ${c.id === st.circuit ? "selected" : ""}>${c.name} (${st.bookings.filter((b) => b.c === c.id).length})</option>`).join("");
    const known = st.bookings.map((b) => ({ cc: b.cc, name: b.club }));
    $("#bo-add").innerHTML = st.adding ? html`${raw(runnerForm("bo-new", {}, { card: true }))}
        <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">${raw(slotPicker("bo-new", st.circuit, null))}
          <button type="button" class="btn btn-sm btn-primary" id="bo-add-save">${t("bk.org.add")}</button><button type="button" class="btn btn-sm" id="bo-add-stop">${t("bk.back")}</button></div>
        <div id="bo-add-err"></div>`
      : html`<button type="button" class="btn btn-sm" id="bo-add-open">+ ${t("bk.org.addHand")}</button>`;
    if (st.adding) st.form = bindRunnerForm($("#bo-new"), { known });
    const c = ev.circuits.find((x) => x.id === st.circuit);
    const tk = takenMap(st.bookings);
    const rows = slotsOf(c).map((s) => {
      const b = tk.get(`${c.id}|${s}`), blocked = (ev.blocked?.[c.id] || []).includes(s);
      if (!b) return html`<tr class="${blocked ? "bk-blocked" : "bk-free"}"><td class="r num">${hm(s)}</td><td class="muted" colspan="4">${t(blocked ? "bk.blocked" : "bk.free")}</td>
        <td class="r"><button type="button" class="btn btn-sm" data-block="${s}">${t(blocked ? "bk.org.unblock" : "bk.org.block")}</button></td></tr>`;
      const clash = clashes(st.bookings, b.ck, s, ev.gap, b.id);
      if (st.moving === b.id) {
        return html`<tr class="bk-mine"><td class="r num">${hm(s)}</td><td colspan="4"><b>${b.n}</b>
          <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:6px">${raw(slotPicker("bo-mv", b.c, b))}
          <label class="check"><input type="checkbox" id="bo-mv-force"> ${t("bk.org.force")}</label>
          <button type="button" class="btn btn-sm btn-primary" data-mvsave="${b.id}">${t("bk.save")}</button><button type="button" class="btn btn-sm" data-mvstop="1">${t("bk.back")}</button></div></td><td></td></tr>`;
      }
      return html`<tr><td class="r num">${hm(s)}</td><td>${b.n}${clash ? html` <span class="tag tag-warn">${t("bk.clash")}</span>` : ""}</td>
        <td class="muted">${clubLabel({ club_country: b.cc, club_name: b.club, club_code: b.code }, ev.country)}</td><td class="num">${b.card || ""}</td>
        <td>${b.byOrg ? html`<span class="tag">${t("bk.org.byOrg")}</span>` : ""}</td>
        <td class="r" style="white-space:nowrap"><button type="button" class="btn btn-sm" data-mv="${b.id}">${t("bk.org.move")}</button>
          <button type="button" class="btn btn-sm" data-rm="${b.id}">${t("bk.cancel")}</button></td></tr>`;
    }).join("");
    $("#bo-table").innerHTML = html`<table class="data compact" data-freeze="1" data-freeze-phone="1"><thead><tr><th class="r">${t("bk.col.start")}</th><th>${t("bk.col.runner")}</th>
      <th>${t("rk.col.club")}</th><th>${t("os.c.card")}</th><th></th><th></th></tr></thead><tbody>${raw(rows)}</tbody></table>`;
  }
  /** A circuit and a start, every start of the circuit with the free ones first marked (the organisers may place anyone). */
  function slotPicker(id, cid, b) {
    const ev = st.ev, tk = takenMap(st.bookings), c = ev.circuits.find((x) => x.id === cid) || ev.circuits[0];
    return html`<label class="field"><span>${t("col.circuit")}</span><select id="${id}-c">${ev.circuits.map((x) => html`<option value="${x.id}" ${x.id === c.id ? "selected" : ""}>${x.name}</option>`)}</select></label>
      <label class="field"><span>${t("bk.col.start")}</span><select id="${id}-s">${slotsOf(c).filter((s) => !tk.has(`${c.id}|${s}`) || (b && b.c === c.id && b.s === s))
        .map((s) => html`<option value="${s}" ${b && b.c === c.id && b.s === s ? "selected" : ""}>${hm(s)}</option>`)}</select></label>`;
  }
  const evPath = () => `/${encodeURIComponent(key)}`;
  $("#bo-circuit").addEventListener("change", (ev) => { st.circuit = ev.target.value; st.moving = null; drawBookings(); });
  $("#bo-add").addEventListener("change", (ev) => {
    if (ev.target.id === "bo-new-c") drawPickerOnly("bo-new", ev.target.value, null);
  });
  function drawPickerOnly(id, cid, b) {
    const old = $(`#${id}-s`);
    if (!old) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = slotPicker(id, cid, b);
    old.replaceWith($(`#${id}-s`, tmp));
  }
  $("#bo-add").addEventListener("click", async (ev) => {
    if (ev.target.id === "bo-add-open") { st.adding = true; drawBookings(); st.form?.focus(); return; }
    if (ev.target.id === "bo-add-stop") { st.adding = false; drawBookings(); return; }
    if (ev.target.id !== "bo-add-save") return;
    const f = st.form.read();
    if (!f) return;
    const circuit = $("#bo-new-c").value, start = Number($("#bo-new-s").value);
    const y = await call("POST", `${evPath()}/org`, { add: [{ ...f, circuit, start }], force: true });
    const res = y.data.results?.[0];
    if (!y.ok || !res?.ok) { $("#bo-add-err").innerHTML = html`<div class="notice">${t({ taken: "bk.err.taken", twice: "bk.err.twice", slot: "bk.err.slot" }[res?.error] || "bk.err.save")}</div>`; return; }
    st.adding = false; st.circuit = circuit;
    await reload();
  });
  $("#bo-table").addEventListener("change", (ev) => { if (ev.target.id === "bo-mv-c") drawPickerOnly("bo-mv", ev.target.value, st.bookings.find((b) => b.id === st.moving)); });
  $("#bo-table").addEventListener("click", async (ev) => {
    const q = (a) => ev.target.closest(`[${a}]`);
    if (q("data-mv")) { st.moving = Number(q("data-mv").dataset.mv); drawBookings(); return; }
    if (q("data-mvstop")) { st.moving = null; drawBookings(); return; }
    if (q("data-mvsave")) {
      const id = Number(q("data-mvsave").dataset.mvsave);
      const y = await call("PATCH", `${evPath()}/${id}`, { circuit: $("#bo-mv-c").value, start: Number($("#bo-mv-s").value), force: $("#bo-mv-force").checked });
      if (!y.ok) return alert(t({ taken: "bk.err.taken", club: "bk.org.err.clubGap", slot: "bk.err.slot" }[y.data.error] || "bk.err.save"));
      st.moving = null;
      return reload();
    }
    if (q("data-rm")) {
      const b = st.bookings.find((x) => x.id === Number(q("data-rm").dataset.rm));
      if (!confirm(t(b.byOrg ? "bk.cancel.confirm" : "bk.org.rm.confirm", { name: b.n, time: hm(b.s) }))) return;
      await call("DELETE", `${evPath()}/${b.id}`);
      return reload();
    }
    if (q("data-block")) {
      const s = Number(q("data-block").dataset.block), list = new Set(st.ev.blocked?.[st.circuit] || []);
      if (list.has(s)) list.delete(s); else list.add(s);
      const blocked = { ...(st.ev.blocked || {}), [st.circuit]: [...list] };
      const { circuits, gap, max, close, card, note } = st.ev;
      const y = await call("PUT", `${evPath()}/config`, { config: { circuits, gap, max, close, card, note, blocked }, status: st.ev.status });
      if (y.ok) { cfg.blocked = blocked; await reload(); }
    }
  });

  // ---- 4. the start list ----
  /** The bookings as a start list of localstart's shape (startchecks.oChecklist reads it). */
  const asList = () => ({ by: "circuit", classes: st.ev.circuits.map((c) => ({ name: c.name, runners: st.bookings.filter((b) => b.c === c.id)
    .map((b) => ({ name: b.n, club: b.cc === "FR" && b.code ? b.code : b.club, clubName: b.club, start_s: b.s, card: b.card || null, category: null })) })), nostart: [] });
  function iofXml() {
    const ev = st.ev, now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    // the race's day in Paris for France's competitions (its offset that day), local time elsewhere
    const off = ev.country === "FR" ? (() => {
      const d = new Date(`${ev.date}T12:00:00Z`), p = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const m = Math.round((p - new Date(d.toLocaleString("en-US", { timeZone: "UTC" }))) / 60000);
      return `${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
    })() : "";
    const tm = (s) => `${ev.date}T${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}${off}`;
    const cls = ev.circuits.map((c) => {
      const rs = st.bookings.filter((b) => b.c === c.id).sort((a, b) => a.s - b.s);
      return `  <ClassStart>\n    <Class><Name>${xml(c.name)}</Name></Class>\n    <Course><Name>${xml(c.name)}</Name></Course>\n${rs.map((b) => `    <PersonStart>
      <Person>${b.lic ? `<Id type="FFCO">${xml(b.lic)}</Id>` : ""}<Name><Family>${xml(b.last || b.n)}</Family><Given>${xml(b.first || "")}</Given></Name></Person>
${b.club || b.code ? `      <Organisation>${b.code ? `<Id>${xml(b.code)}</Id>` : ""}<Name>${xml(b.club || b.code)}</Name></Organisation>\n` : ""}      <Start><StartTime>${tm(b.s)}</StartTime>${b.card ? `<ControlCard>${xml(b.card)}</ControlCard>` : ""}</Start>
    </PersonStart>\n`).join("")}  </ClassStart>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<StartList xmlns="http://www.orienteering.org/datastandard/3.0" iofVersion="3.0" createTime="${now}" creator="Ozimut">
  <Event><Name>${xml(ev.name)}</Name><StartTime><Date>${ev.date}</Date></StartTime></Event>
${cls}
</StartList>
`;
  }
  // the separator the heading's language writes (« ; » in French, German and Spanish, « , » in English)
  function csv() {
    const head = t("bk.org.csvHead"), sep = head.includes(";") ? ";" : ",";
    const f = (v) => { const s = String(v ?? ""); return s.includes(sep) || /["\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = st.bookings.slice().sort((a, b) => a.s - b.s).map((b) => [hm(b.s), b.last || "", b.first || "", b.club || "", b.code || "", st.ev.circuits.find((c) => c.id === b.c)?.name, b.card || "", b.lic || ""].map(f).join(sep));
    return `﻿${[head, ...rows].join("\r\n")}\r\n`;
  }
  function drawPublish() {
    const box = $("#bo-publish");
    if (!st.ev) { box.innerHTML = html`<div class="empty">${t("bk.org.saveFirst")}</div>`; $("#bo-pub-hint").textContent = ""; return; }
    const ev = st.ev;
    $("#bo-pub-hint").textContent = ev.published ? t("bk.org.pub.last", { date: fmtDate(ev.published.slice(0, 10)), time: ev.published.slice(11, 16) }) : t("bk.org.pub.never");
    box.innerHTML = html`<p class="muted" style="margin-top:0">${t("bk.org.pub.how")}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary" id="bo-pub" ${st.bookings.length ? "" : "disabled"}>${t("bk.org.pub.now")}</button>
        <button type="button" class="btn btn-sm" id="bo-csv" ${st.bookings.length ? "" : "disabled"}>${t("bk.org.dl.csv")}</button>
        <button type="button" class="btn btn-sm" id="bo-xml" ${st.bookings.length ? "" : "disabled"}>${t("bk.org.dl.xml")}</button>
        <button type="button" class="btn btn-sm" id="bo-oc" ${st.bookings.length ? "" : "disabled"}>${t("os.oc.dl")}</button></div>
      <div id="bo-pub-msg" style="margin-top:10px"></div>`;
  }
  $("#bo-publish").addEventListener("click", async (ev) => {
    const name = slug(e.name) || "depart";
    if (ev.target.id === "bo-csv") return save(`horaires-${name}.csv`, csv(), "text/csv;charset=utf-8");
    if (ev.target.id === "bo-xml") return save(`startlist-${name}.xml`, iofXml(), "application/xml");
    if (ev.target.id === "bo-oc") return saveOChecklist(e.name, oChecklist(asList(), { cls: "list", club: (r) => r.clubName || r.club || "" }));
    if (ev.target.id === "bo-pub") {
      ev.target.disabled = true;
      const y = await call("POST", `${evPath()}/publish`);
      ev.target.disabled = false;
      $("#bo-pub-msg").innerHTML = html`<div class="notice ${y.ok ? "ok" : ""}">${y.ok ? t(y.data.soon ? "os.done.soon" : "os.done.later") : t(y.data.error === "too many" ? "up.err.many" : "bk.err.save")}</div>`;
      if (y.ok) await reload(false);
    }
  });

  async function reload(all = true) {
    const y = await call("GET", `/${encodeURIComponent(key)}`);
    if (y.ok) { st.ev = y.data.event; st.bookings = y.data.bookings; }
    if (all) drawAll(); else drawPublish();
  }
  function drawAll() { drawSettings(); drawBookings(); drawPublish(); }
  drawImport();
  drawAll();
  return { title: `${t("bk.org.title")} · ${e.name}` };
}
