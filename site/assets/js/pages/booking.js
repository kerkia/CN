// « Réserver un horaire » (#/horaire, owner 2026-11-03): a competition's start times its organisers opened to booking (Orga ›
// Horaires › « Réservation des horaires »), in place of the Google Sheets clubs passed round. Everyone sees the grid — the
// runners' names and clubs —; an account books for its runners (« Mes coureurs »: itself, its family, anyone, licensed or
// not, of any club of any country, or none): one start each, `gap` apart within a club whatever the circuit, until the
// closing time; it changes or cancels its own until then. A message here confirms; the alert « Mes horaires réservés » tells of
// a start the organisers moved or cancelled, and reminds the day before. Without `course`: the bookings open now, and one's own.

import { html, raw, $, $$, fmt, fmtDate } from "../util.js";
import { t, tn, loadArea } from "../i18n.js";
import * as auth from "../auth.js";
import * as country from "../country.js";
import { call, hm, slotsOf, clubKey, clubLabel, runnerForm, bindRunnerForm, takenMap, clashes } from "../bookingcore.js";

await loadArea("booking");

const closeText = (close) => {
  if (!close) return "";
  const [d, h] = close.split("T");
  return t("bk.closeAt", { date: fmtDate(d, "long"), time: h });
};

export async function render(main, { query = {} } = {}) {
  if (!query.course) return listPage(main);
  return racePage(main, query.course, query);
}

// ---- the bookings open, and one's own ----------------------------------------------------------------------------
async function listPage(main) {
  main.innerHTML = html`<div class="page-head"><div><h1>${t("bk.title")}</h1><p class="lede">${t("bk.list.lede")}</p></div></div>
    <div id="bk-list"><div class="empty">${t("bk.loading")}</div></div>`;
  const r = await call("GET", "");
  const box = $("#bk-list");
  if (!r.ok) { box.innerHTML = html`<div class="card"><div class="empty">${t(r.status === 503 ? "bk.err.notReady" : "bk.err.load")}</div></div>`; return { title: t("bk.title") }; }
  const { events = [], mine = [] } = r.data;
  const evRow = (e) => html`<tr><td class="num">${fmtDate(e.date, "short")}</td>
    <td><a href="#/horaire?course=${encodeURIComponent(e.key)}">${e.name}</a>${e.place ? html` <span class="muted">· ${e.place}</span>` : ""}</td>
    <td>${e.country && e.country !== "FR" ? html`${raw(country.flagImg(e.country))} ` : ""}<span class="muted">${e.org || ""}</span></td>
    <td>${e.status === "open" ? html`<span class="tag tag-in">${t("bk.st.open")}</span> <span class="muted">${closeText(e.close)}</span>` : html`<span class="tag">${t("bk.st.closed")}</span>`}</td></tr>`;
  box.innerHTML = html`
    ${mine.length ? html`<section class="card" style="margin-bottom:16px"><div class="card-head"><h2>${t("bk.mine")}</h2></div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("bk.col.race")}</th><th>${t("bk.col.runner")}</th>
        <th>${t("col.circuit")}</th><th class="r">${t("bk.col.start")}</th></tr></thead>
      <tbody>${mine.map((b) => html`<tr><td class="num">${fmtDate(b.date, "short")}</td>
        <td><a href="#/horaire?course=${encodeURIComponent(b.race)}">${b.name}</a></td><td>${b.runner}</td><td>${b.circuit}</td>
        <td class="r num"><b>${hm(b.s)}</b></td></tr>`)}</tbody></table></div></section>` : ""}
    <section class="card"><div class="card-head"><h2>${t("bk.open")}</h2></div>
      ${events.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>${t("f.date")}</th><th>${t("bk.col.race")}</th>
        <th>${t("bk.col.org")}</th><th>${t("bk.col.status")}</th></tr></thead><tbody>${events.map(evRow)}</tbody></table></div>`
        : html`<div class="empty">${t("bk.none")}</div>`}</section>`;
  return { title: t("bk.title") };
}

// ---- one competition -----------------------------------------------------------------------------------------------
async function racePage(main, key, query) {
  const me = auth.session();
  main.innerHTML = html`<div class="empty">${t("bk.loading")}</div>`;
  const r = await call("GET", `/${encodeURIComponent(key)}`);
  if (!r.ok) {
    const org = r.data.organiser;
    main.innerHTML = html`<div class="card"><div class="empty">${t(r.status === 503 ? "bk.err.notReady" : r.status === 404 ? "bk.err.none" : "bk.err.load")}
      ${org ? html`<p><a class="btn btn-sm btn-primary" href="#/orga-horaires?course=${encodeURIComponent(key)}&resa=1">${t("bk.org.manage")}</a></p>` : ""}</div></div>`;
    return { title: t("bk.title") };
  }
  const st = { ev: r.data.event, bookings: r.data.bookings, organiser: r.data.organiser, runners: [], sel: new Map(), edit: null,
    circuit: query.c || r.data.event.circuits[0]?.id, free: false, active: null, adding: false, editing: null, msg: "" };
  const ev = st.ev;

  main.innerHTML = html`
    <div class="page-head"><div><h1>${ev.name}</h1>
      <p class="lede meta"><span>${fmtDate(ev.date)}</span>${ev.place ? html`<span>${ev.place}</span>` : ""}${ev.org ? html`<span>${ev.org}</span>` : ""}</p></div>
      ${st.organiser ? html`<div class="page-actions"><a class="btn btn-sm" href="#/orga-horaires?course=${encodeURIComponent(key)}&resa=1">${t("bk.org.manage")}</a></div>` : ""}</div>
    <div id="bk-status"></div>
    <div class="bk-layout">
      <section class="card bk-book" id="bk-book"></section>
      <section class="card bk-grid"><div class="card-head"><div><h2>${t("bk.grid")}</h2><div class="hint" id="bk-grid-hint"></div></div>
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><label class="field" style="flex-direction:row;align-items:center;gap:8px">
          <span>${t("col.circuit")}</span><select id="bk-circuit"></select></label>
          <label class="check"><input type="checkbox" id="bk-free"> ${t("bk.freeOnly")}</label></div></div>
        <div class="table-wrap" id="bk-table"></div></section>
    </div>`;

  const circuitOf = (id) => ev.circuits.find((c) => c.id === id);
  const taken = () => takenMap(st.bookings);
  const blocked = (c, s) => (ev.blocked?.[c] || []).includes(s);
  const rules = () => [t("bk.rule.step", { step: stepWords() }), ev.gap ? t("bk.rule.gap", { min: gapWords(ev.gap) }) : "",
    tn("bk.rule.max", ev.max, { n: ev.max })].filter(Boolean).join(" · ");
  const stepWords = () => [...new Set(ev.circuits.map((c) => c.step))].map(gapWords).join(" / ");
  function gapWords(s) { return s % 60 ? t("bk.secs", { s }) : tn("bk.mins", s / 60, { n: s / 60 }); }

  function drawStatus() {
    const box = $("#bk-status");
    // (a notice lays its children out in a row: one block inside)
    const state = ev.open ? html`<div class="notice info bk-state"><div><b>${t("bk.st.open")}</b>${ev.close ? html` · ${closeText(ev.close)}` : ""}<div class="muted">${rules()}</div></div></div>`
      : ev.status === "draft" ? html`<div class="notice"><div><b>${t("bk.st.draft")}</b> · ${t("bk.st.draft.hint")}</div></div>`
      : html`<div class="notice"><div><b>${t("bk.st.closed")}</b> · ${t("bk.st.closed.hint")}</div></div>`;
    box.innerHTML = html`${state}${ev.note ? html`<div class="notice bk-note"><div>${ev.note}</div></div>` : ""}${st.msg ? raw(st.msg) : ""}`;
  }

  // ---- the grid ----
  function drawGrid() {
    const sel = $("#bk-circuit");
    sel.innerHTML = ev.circuits.map((c) => {
      const n = st.bookings.filter((b) => b.c === c.id).length, all = slotsOf(c).length;
      return html`<option value="${c.id}" ${c.id === st.circuit ? "selected" : ""}>${c.name} (${n}/${all})</option>`;
    }).join("");
    const c = circuitOf(st.circuit) || ev.circuits[0];
    if (!c) { $("#bk-table").innerHTML = html`<div class="empty">${t("bk.noCircuit")}</div>`; return; }
    st.circuit = c.id;
    const tk = taken(), act = st.runners.find((x) => x.id === st.active);
    const ack = act ? clubKey(act) : "", mineBk = act ? bookingOf(act) : null;
    $("#bk-grid-hint").textContent = act && ev.open ? t("bk.grid.for", { name: `${act.first_name} ${act.last_name}` }) : t("bk.grid.hint");
    const rows = slotsOf(c).map((s) => {
      const b = tk.get(`${c.id}|${s}`);
      if (b) return st.free ? "" : html`<tr class="${b.mine ? "bk-mine" : ""}"><td class="r num">${hm(s)}</td><td>${b.n}${b.mine ? html` <span class="tag tag-in">${t("bk.yours")}</span>` : ""}</td>
        <td class="muted">${clubLabel({ club_country: b.cc, club_name: b.club, club_code: b.code }, ev.country)}</td><td></td></tr>`;
      if (blocked(c.id, s)) return st.free ? "" : html`<tr class="bk-blocked"><td class="r num">${hm(s)}</td><td class="muted" colspan="3">${t("bk.blocked")}</td></tr>`;
      const clash = me && ev.open && act && clashes(st.bookings, ack, s, ev.gap, mineBk?.id);
      const can = me && ev.open && act && !clash;
      return html`<tr class="bk-free"><td class="r num">${hm(s)}</td><td class="muted">${t("bk.free")}</td>
        <td>${clash ? html`<span class="tag tag-warn" title="${t("bk.clash.tip", { min: gapWords(ev.gap) })}">${t("bk.clash")}</span>` : ""}</td>
        <td class="r">${can ? html`<button type="button" class="btn btn-sm" data-take="${s}">${t(mineBk ? "bk.moveHere" : "bk.take")}</button>` : ""}</td></tr>`;
    }).join("");
    $("#bk-table").innerHTML = html`<table class="data compact bk-table" data-freeze="1" data-freeze-phone="1"><thead><tr><th class="r">${t("bk.col.start")}</th>
      <th>${t("bk.col.runner")}</th><th>${t("rk.col.club")}</th><th></th></tr></thead><tbody>${raw(rows)}</tbody></table>`;
  }
  $("#bk-circuit").addEventListener("change", (e) => { st.circuit = e.target.value; drawGrid(); });
  $("#bk-free").addEventListener("change", (e) => { st.free = e.target.checked; drawGrid(); });
  $("#bk-table").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-take]");
    if (!b) return;
    const act = st.runners.find((x) => x.id === st.active);
    if (!act) return;
    const s = Number(b.dataset.take), own = bookingOf(act);
    if (own) return move(own, st.circuit, s);
    st.sel.set(act.id, { circuit: st.circuit, start: s });
    drawBook();
    $("#bk-book").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---- booking ----
  const bookingOf = (r) => st.bookings.find((b) => b.mine && (r.licence ? b.lic === r.licence : `${b.first} ${b.last}`.toLowerCase() === `${r.first_name} ${r.last_name}`.toLowerCase()));
  /** The starts a runner may take on a circuit: free, not kept back, within the club rule (the form's other picks too). */
  function choices(r, cid) {
    const c = circuitOf(cid);
    if (!c) return [];
    const tk = taken(), ck = clubKey(r), own = bookingOf(r);
    const picked = [...st.sel].filter(([id]) => id !== r.id).map(([id, x]) => ({ ...x, ck: clubKey(st.runners.find((y) => y.id === id) || {}) }));
    return slotsOf(c).filter((s) => !tk.has(`${cid}|${s}`) && !blocked(cid, s) && !clashes(st.bookings, ck, s, ev.gap, own?.id)
      && !picked.some((p) => (p.circuit === cid && p.start === s) || (ck && ev.gap && p.ck === ck && Math.abs(p.start - s) < ev.gap)));
  }
  function drawBook() {
    const box = $("#bk-book");
    if (!me) {
      box.innerHTML = html`<div class="card-head"><h2>${t("bk.book")}</h2></div><div class="card-body">
        <p>${t(ev.open ? "bk.login.why" : "bk.login.closed")}</p>
        ${ev.open ? html`<p class="row" style="gap:8px"><a class="btn btn-primary" href="#/?s=login" data-after="1">${t("hub.login")}</a>
          <a class="btn" href="#/compte/inscription">${t("hub.register")}</a></p>` : ""}</div>`;
      return;
    }
    const known = st.bookings.map((b) => ({ cc: b.cc, name: b.club }));
    const runnerRow = (r) => {
      const own = bookingOf(r), sel = st.sel.get(r.id), editing = st.edit === own?.id;
      const c = sel ? circuitOf(sel.circuit) : null;
      let right = "";
      if (own && !editing) {
        right = html`<div class="bk-booked"><span class="tag tag-in">${circuitOf(own.c)?.name || own.c} · ${hm(own.s)}</span>
          ${ev.open ? html`<button type="button" class="btn btn-sm" data-edit="${own.id}">${t("bk.change")}</button>
          <button type="button" class="btn btn-sm" data-cancel="${own.id}">${t("bk.cancel")}</button>` : ""}</div>`;
      } else if ((sel || editing) && ev.open) {
        const cur = editing ? { circuit: sel?.circuit || own.c, start: sel?.start ?? own.s } : sel;
        const opts = choices(r, cur.circuit);
        if (editing && cur.circuit === own.c && !opts.includes(own.s)) opts.push(own.s);
        opts.sort((a, b) => a - b);
        right = html`<div class="bk-pick">
          <select data-circ="${r.id}" aria-label="${t("col.circuit")}">${ev.circuits.map((x) => html`<option value="${x.id}" ${x.id === cur.circuit ? "selected" : ""}>${x.name}</option>`)}</select>
          <select data-start="${r.id}" aria-label="${t("bk.col.start")}">${opts.length ? opts.map((s) => html`<option value="${s}" ${s === cur.start ? "selected" : ""}>${hm(s)}</option>`)
            : html`<option value="">${t("bk.noSlot")}</option>`}</select>
          ${ev.card && !r.card ? html`<input data-card="${r.id}" placeholder="${t("bk.f.card")}" inputmode="numeric" maxlength="10" style="width:110px">` : ""}
          ${editing ? html`<button type="button" class="btn btn-sm btn-primary" data-save="${own.id}">${t("bk.save")}</button>
            <button type="button" class="btn btn-sm" data-stop="1">${t("bk.back")}</button>` : ""}</div>`;
        if (!editing && c && !opts.includes(sel.start)) st.sel.set(r.id, { circuit: sel.circuit, start: opts[0] ?? null });
      }
      return html`<li class="bk-runner ${st.active === r.id ? "active" : ""}" data-runner="${r.id}">
        <label class="bk-who">${!own && ev.open ? html`<input type="checkbox" data-pick="${r.id}" ${sel ? "checked" : ""}>` : ""}
          <span><b>${r.first_name} ${r.last_name}</b>${r.self ? html` <span class="muted">(${t("bk.me")})</span>` : ""}
          <span class="muted bk-club">${clubLabel(r, ev.country)}${r.licence ? ` · ${r.licence}` : ""}</span></span></label>
        <div class="bk-side">${raw(right)}
          <button type="button" class="icon-btn" data-redit="${r.id}" title="${t("bk.r.edit")}" aria-label="${t("bk.r.edit")}">✎</button>
          ${!own ? html`<button type="button" class="icon-btn" data-rdel="${r.id}" title="${t("bk.r.del")}" aria-label="${t("bk.r.del")}">✕</button>` : ""}</div>
        ${st.editing === r.id ? html`<div class="bk-rform">${raw(runnerForm(`bk-rf-${r.id}`, r, { card: ev.card }))}
          <div class="row" style="gap:8px"><button type="button" class="btn btn-sm btn-primary" data-rsave="${r.id}">${t("bk.save")}</button>
          <button type="button" class="btn btn-sm" data-stop="1">${t("bk.back")}</button></div></div>` : ""}</li>`;
    };
    const n = st.sel.size;
    box.innerHTML = html`<div class="card-head"><div><h2>${t("bk.book")}</h2><div class="hint">${t(ev.open ? "bk.book.hint" : "bk.book.closed")}</div></div></div>
      <div class="card-body">
        <ul class="bk-runners">${raw(st.runners.map(runnerRow).join(""))}</ul>
        ${st.adding ? html`<div class="bk-rform">${raw(runnerForm("bk-new", {}, { card: ev.card }))}
          <div class="row" style="gap:8px"><button type="button" class="btn btn-sm btn-primary" id="bk-add-save">${t("bk.r.add")}</button>
          <button type="button" class="btn btn-sm" data-stop="1">${t("bk.back")}</button></div></div>`
          : html`<button type="button" class="btn btn-sm" id="bk-add">+ ${t("bk.r.new")}</button>
            <p class="muted bk-small">${t("bk.r.hint")}</p>`}
        ${ev.open ? html`<div class="row bk-go"><button type="button" class="btn btn-primary" id="bk-go" ${n ? "" : "disabled"}>${n ? tn("bk.go", n, { n }) : t("bk.go.none")}</button></div>` : ""}
      </div>`;
    if (st.adding) { const f = bindRunnerForm($("#bk-new"), { known }); f.focus(); st.form = f; }
    if (st.editing) st.form = bindRunnerForm($(`#bk-rf-${st.editing}`), { known });
  }
  const box = $("#bk-book");
  box.addEventListener("change", (e) => {
    const p = e.target.closest("[data-pick]"), c = e.target.closest("[data-circ]"), s = e.target.closest("[data-start]");
    if (p) {
      const id = Number(p.dataset.pick);
      if (p.checked) {
        const r = st.runners.find((x) => x.id === id), cid = st.circuit || ev.circuits[0]?.id;
        st.sel.set(id, { circuit: cid, start: choices(r, cid)[0] ?? null });
      } else st.sel.delete(id);
      st.active = id;
      drawBook(); drawGrid();
    } else if (c) {
      const id = Number(c.dataset.circ), r = st.runners.find((x) => x.id === id);
      st.sel.set(id, { circuit: c.value, start: choices(r, c.value)[0] ?? null });
      st.active = id; st.circuit = c.value;
      drawBook(); drawGrid();
    } else if (s) {
      const id = Number(s.dataset.start), cur = st.sel.get(id) || {};
      st.sel.set(id, { ...cur, circuit: cur.circuit || $(`[data-circ="${id}"]`, box)?.value, start: s.value === "" ? null : Number(s.value) });
      drawBook(); drawGrid();
    }
  });
  box.addEventListener("click", async (e) => {
    const q = (a) => e.target.closest(`[${a}]`);
    // signing in from here comes back here (app.js reads it after the login)
    if (q("data-after")) { try { sessionStorage.setItem("ocn.after", location.hash); } catch (x) { /* the modules page then */ } return; }
    const li = e.target.closest("[data-runner]");
    if (li && !q("data-rdel") && !q("data-redit") && Number(li.dataset.runner) !== st.active && !e.target.closest("select,input,button")) {
      st.active = Number(li.dataset.runner); drawBook(); drawGrid();
    }
    if (q("data-stop")) { st.adding = false; st.editing = null; if (st.edit) { st.sel.delete(st.active); st.edit = null; } drawBook(); return; }
    if (e.target.id === "bk-add") { st.adding = true; st.editing = null; drawBook(); return; }
    if (e.target.id === "bk-add-save") {
      const f = st.form.read();
      if (!f) return;
      const x = await call("POST", "/runners", f);
      if (!x.ok) return say(t(x.data.error === "too many" ? "bk.err.runners" : "bk.err.save"), true);
      st.runners.push(x.data.runner); st.adding = false; st.active = x.data.runner.id;
      const cid = st.circuit || ev.circuits[0]?.id;
      if (ev.open) st.sel.set(x.data.runner.id, { circuit: cid, start: choices(x.data.runner, cid)[0] ?? null });
      drawBook(); drawGrid();
      return;
    }
    if (q("data-redit")) { st.editing = Number(q("data-redit").dataset.redit); st.adding = false; drawBook(); return; }
    if (q("data-rsave")) {
      const id = Number(q("data-rsave").dataset.rsave), f = st.form.read();
      if (!f) return;
      const x = await call("PUT", `/runners/${id}`, f);
      if (!x.ok) return say(t("bk.err.save"), true);
      st.runners = st.runners.map((r) => (r.id === id ? x.data.runner : r)); st.editing = null;
      drawBook(); drawGrid();
      return;
    }
    if (q("data-rdel")) {
      const id = Number(q("data-rdel").dataset.rdel), r = st.runners.find((x) => x.id === id);
      if (!confirm(t("bk.r.del.confirm", { name: `${r.first_name} ${r.last_name}` }))) return;
      await call("DELETE", `/runners/${id}`);
      st.runners = st.runners.filter((x) => x.id !== id); st.sel.delete(id);
      drawBook(); drawGrid();
      return;
    }
    if (q("data-edit")) {
      const id = Number(q("data-edit").dataset.edit), own = st.bookings.find((b) => b.id === id);
      const r = st.runners.find((x) => bookingOf(x)?.id === id);
      st.edit = id; st.active = r?.id ?? null;
      if (r) st.sel.set(r.id, { circuit: own.c, start: own.s });
      st.circuit = own.c;
      drawBook(); drawGrid();
      return;
    }
    if (q("data-save")) {
      const id = Number(q("data-save").dataset.save), r = st.runners.find((x) => bookingOf(x)?.id === id), pick = r && st.sel.get(r.id);
      if (!pick || pick.start == null) return;
      st.sel.delete(r.id);
      return move(st.bookings.find((b) => b.id === id), pick.circuit, pick.start);
    }
    if (q("data-cancel")) {
      const id = Number(q("data-cancel").dataset.cancel), own = st.bookings.find((b) => b.id === id);
      if (!confirm(t("bk.cancel.confirm", { name: own.n, time: hm(own.s) }))) return;
      const x = await call("DELETE", `/${encodeURIComponent(key)}/${id}`);
      say(x.ok ? t("bk.cancelled", { name: own.n }) : errText(x.data.error), !x.ok);
      return reload();
    }
    if (e.target.id === "bk-go") return go();
  });

  const errText = (code) => t({ taken: "bk.err.taken", club: "bk.err.clubGap", twice: "bk.err.twice", slot: "bk.err.slot", closed: "bk.err.closed",
    max: "bk.err.max", runner: "bk.err.save", demo: "bk.err.demo", "too many": "bk.err.many" }[code] || "bk.err.save", { min: gapWords(ev.gap), n: ev.max });
  function say(text, bad = false, list = []) {
    st.msg = html`<div class="notice ${bad ? "" : "ok"} bk-msg" role="status"><div>${text}${list.length ? html`<ul>${list.map((x) => html`<li>${raw(x)}</li>`)}</ul>` : ""}</div></div>`;
    drawStatus();
    $("#bk-status").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  async function go() {
    const items = [...st.sel].filter(([, x]) => x.start != null && x.circuit).map(([id, x]) => ({ runner: id, circuit: x.circuit, start: x.start,
      ...(ev.card ? { card: ($(`[data-card="${id}"]`)?.value || "").trim() || undefined } : {}) }));
    if (!items.length) return;
    $("#bk-go").disabled = true;
    const x = await call("POST", `/${encodeURIComponent(key)}`, { book: items });
    if (!x.ok) { say(errText(x.data.error), true); $("#bk-go").disabled = false; return; }
    const res = x.data.results || [];
    const name = (id) => { const r = st.runners.find((y) => y.id === id); return r ? `${r.first_name} ${r.last_name}` : "?"; };
    const done = res.filter((y) => y.ok), bad = res.filter((y) => !y.ok);
    const okLines = done.map((y) => { const it = items.find((i) => i.runner === y.runner); return html`<b>${name(y.runner)}</b> · ${circuitOf(it.circuit)?.name} · <b>${hm(it.start)}</b>`; });
    const badLines = bad.map((y) => html`<b>${name(y.runner)}</b> · ${errText(y.error)}`);
    for (const y of done) st.sel.delete(y.runner);
    say(done.length ? (bad.length ? t("bk.done.some") : tn("bk.done", done.length, { n: done.length })) : t("bk.done.none"), !done.length, [...okLines, ...badLines]);
    await reload();
  }
  async function move(own, circuit, start) {
    const x = await call("PATCH", `/${encodeURIComponent(key)}/${own.id}`, { circuit, start });
    st.edit = null;
    say(x.ok ? t("bk.moved", { name: own.n, circuit: circuitOf(circuit)?.name, time: hm(start) }) : errText(x.data.error), !x.ok);
    await reload();
  }
  async function reload() {
    const y = await call("GET", `/${encodeURIComponent(key)}`);
    if (y.ok) { st.bookings = y.data.bookings; Object.assign(ev, y.data.event); }
    drawStatus(); drawBook(); drawGrid();
  }

  if (me) {
    const x = await call("GET", "/runners");
    st.runners = x.ok ? x.data.runners : [];
    st.active = st.runners[0]?.id ?? null;
  }
  drawStatus(); drawBook(); drawGrid();
  return { title: `${t("bk.title")} · ${ev.name}` };
}
