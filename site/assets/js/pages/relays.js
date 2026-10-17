// Relais: a relay simulator. A format (FFCO's championships, or one's own legs), a club, a method: the club's best
// teams, made automatically or changed runner by runner, their predicted times and their place among every club's
// best team. The model and the solver: relay.js.

import { html, raw, $, $$, fmt, fmtTime, fmtDate } from "../util.js";
import { t } from "../i18n.js";
import * as store from "../store.js";
import * as data from "../data.js";
import { methodSeg, bindMethodSeg, methodLabel, filterFold, setLede } from "../ui.js";
import { loadRanking } from "./ranking.js";
import { clubName } from "../clubstats.js";
import { link, replaceQuery, terrainField } from "../app.js";
import { myClub } from "../auth.js";
import { PRESETS, TARGETS, catParts, fits, bestTeam, clubTeams, checkTeam, terrainOf, nextNationalRelay } from "../relay.js";

const TOP = 20;                 // teams in the predicted ranking
const MAX_TEAMS = 4;            // the club's teams, made automatically
const clone = (f) => ({ ...f, slots: f.slots.map((s) => ({ ...s })), legs: f.legs.map((l) => ({ ...l })) });
const custom = () => ({ label: t("rl.custom"), target: "winner", custom: true,
  slots: [{ label: t("rl.slot.16plus"), min: 16 }, { label: t("rl.slot.16plus"), min: 16 }, { label: t("rl.slot.16plus"), min: 16 }],
  legs: [{ ref: 40 }, { ref: 40 }, { ref: 40 }] });
const consLabel = (c) => [c.sex === "H" ? t("rl.cons.men") : c.sex === "D" ? t("rl.cons.women") : "", c.min != null && c.min > 0 ? t("rl.cons.min", { n: c.min }) : "",
  c.max != null ? t("rl.cons.max", { n: c.max }) : ""].filter(Boolean).join(" · ");
// the age groups offered for an added runner (its category: sex + age, as H21 or D45)
const AGES = [10, 12, 14, 16, 18, 20, 21, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];
const mmss = (min) => (min == null || !isFinite(min) ? "—" : fmtTime(Math.round(min * 60)));
// what the visitor chose last time (owner, 2026-10-14): the format (one's own format's legs too), its discipline, the
// club, and the agenda's next national relay at that time — when that relay changes, the agenda's format is proposed again
const MEM = "ocn.relay";
const readMem = () => { try { return JSON.parse(localStorage.getItem(MEM) || "{}") || {}; } catch (e) { return {}; } };
const validFormat = (f) => !!f && Array.isArray(f.legs) && Array.isArray(f.slots) && f.legs.length > 0 && f.legs.length === f.slots.length
  && f.legs.every((l) => l && Number(l.ref) > 0) && f.slots.every((s) => s && typeof s === "object");

export async function render(main, { query }) {
  const mem = readMem();
  let next = null;                                   // the agenda's next national relay: the format to propose
  try { next = nextNationalRelay((await data.agenda())?.events); } catch (e) { next = null; }
  // the format: the link's, else the one chosen last time — unless the agenda's next national relay changed since —,
  // else that relay's, else the CFC's N1
  const valid = (k) => (PRESETS[k] || k === "perso" ? k : null);
  let key = valid(query.f) || (mem.f && (!next || mem.next === next.id) ? valid(mem.f) : null) || next?.key || valid(mem.f) || "cfc1";
  const perso = validFormat(mem.perso) ? { ...custom(), slots: mem.perso.slots.map((s) => ({ ...s })), legs: mem.perso.legs.map((l) => ({ ...l, ref: Number(l.ref) })) } : custom();
  let fmtNow = key === "perso" ? perso : clone(PRESETS[key]);
  let club = query.club || mem.club || myClub() || "";
  const method = store.get().method;
  // the discipline of the CNs: the format's (forest, the sprint relay in sprint), whatever the site-wide one; one's own
  // format: chosen here
  const qt = query.t || mem.t;
  let terrain = key === "perso" ? (store.TERRAINS.includes(qt) ? qt : "For") : terrainOf(PRESETS[key]);
  let runners = [], byClub = new Map(), manual = null;
  // the runners this account added to the club (no CN of their own: relays only, abroad), and the club's runners it
  // marked unavailable (licences; out of the teams), from /api/account/relay; saved: "" | "saving" | "saved" | "unavailable"
  let extra = [], out = new Set(), extraClub = null, saved = "";      // manual: the team typed by hand (array of runners), else null
  function remember() {
    try {
      const m = readMem();
      localStorage.setItem(MEM, JSON.stringify({ ...m, f: key, t: terrain, club: club || null, next: next?.id ?? null,
        perso: key === "perso" ? { slots: fmtNow.slots, legs: fmtNow.legs } : m.perso || null }));
    } catch (e) {}
  }

  setLede(t("rl.lede"));
  main.innerHTML = html`
    ${filterFold(html`<div class="filters" id="rl-filters"></div>`)}
    <div class="grid grid-main-side" style="align-items:start;margin-bottom:16px">
      <section class="card"><div class="card-head"><div><h2 id="rl-team-title">${t("rl.teams")}</h2><div class="hint" id="rl-team-hint"></div></div>
        <div class="row"><button class="btn btn-sm" type="button" id="rl-auto" hidden>${t("rl.auto")}</button></div></div>
        <div id="rl-teams"><div class="empty">${t("rl.loading")}</div></div></section>
      <section class="card"><div class="card-head"><div><h2>${t("rl.format")}</h2><div class="hint" id="rl-format-hint"></div></div></div>
        <div id="rl-format"></div></section>
    </div>
    <section class="card" id="rl-extra-card" style="margin-bottom:16px" hidden><div class="card-head"><div><h2 id="rl-extra-title"></h2>
      <div class="hint">${t("rl.extra.hint")}</div></div><span class="muted" id="rl-extra-state" style="font-size:12.5px"></span></div>
      <div id="rl-extra"></div></section>
    <section class="card"><div class="card-head"><div><h2>${t("rl.ranking")}</h2><div class="hint">${t("rl.ranking.hint")}</div></div></div>
      <div id="rl-ranking"></div></section>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">${t("rl.model")}</p>`;

  function drawFilters() {
    const groups = new Map();
    for (const [k, p] of Object.entries(PRESETS)) { if (!groups.has(p.group)) groups.set(p.group, []); groups.get(p.group).push([k, p.label]); }
    const clubs = [...byClub.keys()].sort((a, b) => clubName(a).localeCompare(clubName(b), "fr"));
    $("#rl-filters").innerHTML = html`${key === "perso" ? html`<label class="field"><span>${t("f.terrain")}</span><select id="rl-t">
        ${store.TERRAINS.map((x) => html`<option value="${x}" ${raw(x === terrain ? "selected" : "")}>${t(`terrain.${x}`)}</option>`)}</select></label>`
        : ""}
      <label class="field"><span>${t("rl.format")}</span><select id="rl-f">
        ${[...groups].map(([g, list]) => html`<optgroup label="${g}">${list.map(([k, l]) => html`<option value="${k}" ${raw(k === key ? "selected" : "")}>${l}</option>`)}</optgroup>`)}
        <option value="perso" ${raw(key === "perso" ? "selected" : "")}>${t("rl.custom")}</option></select></label>
      <label class="field"><span>${t("rl.club")}</span><select id="rl-club" style="max-width:280px"><option value="">—</option>
        ${clubs.map((c) => html`<option value="${c}" ${raw(c === club ? "selected" : "")}>${clubName(c)}</option>`)}</select></label>`;
    $("#rl-t")?.addEventListener("change", (e) => { terrain = e.target.value; manual = null; load(); });
    $("#rl-f").addEventListener("change", (e) => setFormat(e.target.value));
    $("#rl-club").addEventListener("change", async (e) => { club = e.target.value; manual = null; await loadExtra(); compute(); });
  }
  function setFormat(k) {
    key = k; fmtNow = key === "perso" ? perso : clone(PRESETS[key]); manual = null; drawFormat();
    // another discipline (the sprint relay): its runners' CNs
    const tr = key === "perso" ? terrain : terrainOf(PRESETS[key]);
    if (tr !== terrain) { terrain = tr; load(); } else { drawFilters(); compute(); }
  }

  // ---- the format: its legs (reference times editable; one's own format entirely) -------------------------------
  function drawFormat() {
    const f = fmtNow, total = f.legs.reduce((s, l) => s + l.ref, 0);
    $("#rl-format-hint").textContent = `${f.legs.length} relayeurs · ${fmt(total)} min · ${TARGETS[f.target]}`;
    const sexSel = (i, v) => html`<select data-leg-sex="${i}"><option value="" ${raw(!v ? "selected" : "")}>D/H</option>
      <option value="D" ${raw(v === "D" ? "selected" : "")}>D</option><option value="H" ${raw(v === "H" ? "selected" : "")}>H</option></select>`;
    $("#rl-format").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr><th class="r">${t("rl.leg")}</th>
        <th class="r">${t("rl.ref")}</th><th>${f.custom ? t("rl.who") : t("rl.legRule")}</th>${f.custom ? html`<th></th>` : ""}</tr></thead>
      <tbody>${f.legs.map((l, i) => html`<tr><td class="r num">${i + 1}</td>
        <td class="r"><input type="number" min="5" max="240" step="5" value="${l.ref}" data-leg-ref="${i}" style="width:64px"> min</td>
        <td>${f.custom ? html`${sexSel(i, f.slots[i].sex)} <input type="number" min="0" max="95" value="${f.slots[i].min ?? ""}" placeholder="min" data-leg-min="${i}" style="width:56px">
            – <input type="number" min="0" max="95" value="${f.slots[i].max ?? ""}" placeholder="max" data-leg-max="${i}" style="width:56px">`
          : html`<span class="muted">${consLabel(l) || "—"}</span>`}</td>
        ${f.custom ? html`<td><button class="btn btn-sm" type="button" data-leg-del="${i}" ${raw(f.legs.length < 2 ? "disabled" : "")}>✕</button></td>` : ""}</tr>`)}</tbody></table></div>
      <div class="card-body">${f.custom ? html`<button class="btn btn-sm" type="button" id="rl-add">${t("rl.addLeg")}</button>`
        : html`<div class="muted" style="font-size:12.5px"><b>${t("rl.slots")}</b> : ${f.slots.map((s) => s.label).join(" · ")}</div>`}
        ${next ? html`<div class="muted" style="font-size:12.5px;margin-top:8px">${t("rl.next")} : <a href="#/agenda?id=${next.id}">${next.name}</a>,
          ${fmtDate(next.date)}${next.place ? ` · ${next.place}` : ""}${next.key === key ? "" : html` — <a href="#/relais" id="rl-next-use">${t("rl.next.use")}</a>`}</div>` : ""}</div>`;
    $("#rl-next-use")?.addEventListener("click", (e) => { e.preventDefault(); setFormat(next.key); });
    const changed = () => { manual = manual && manual.length === fmtNow.legs.length ? manual : null; compute(); drawFormat(); };
    $$("[data-leg-ref]").forEach((x) => x.addEventListener("change", () => { const v = Number(x.value); if (v > 0) { fmtNow.legs[x.dataset.legRef].ref = v; changed(); } }));
    if (f.custom) {
      const num = (v) => (v === "" ? null : Number(v));
      $$("[data-leg-sex]").forEach((x) => x.addEventListener("change", () => { fmtNow.slots[x.dataset.legSex].sex = x.value || null; relabel(); changed(); }));
      $$("[data-leg-min]").forEach((x) => x.addEventListener("change", () => { fmtNow.slots[x.dataset.legMin].min = num(x.value); relabel(); changed(); }));
      $$("[data-leg-max]").forEach((x) => x.addEventListener("change", () => { fmtNow.slots[x.dataset.legMax].max = num(x.value); relabel(); changed(); }));
      $$("[data-leg-del]").forEach((x) => x.addEventListener("click", () => { const i = Number(x.dataset.legDel); fmtNow.legs.splice(i, 1); fmtNow.slots.splice(i, 1); manual = null; changed(); }));
      $("#rl-add").addEventListener("click", () => { fmtNow.legs.push({ ref: 40 }); fmtNow.slots.push({ label: "D/H16 et +", min: 16 }); manual = null; changed(); });
    }
  }
  // one's own format: each leg's runner as typed, the criterion being the leg's own
  function relabel() {
    fmtNow.slots.forEach((s, i) => { s.label = consLabel(s) || "tous"; Object.assign(fmtNow.legs[i], { sex: s.sex, min: s.min, max: s.max }); });
  }

  // ---- data and computation -------------------------------------------------------------------------------------------
  async function load() {
    main.classList.add("loading-veil");
    const { rows } = await loadRanking([method], terrain, data.latestMonth());
    main.classList.remove("loading-veil");
    runners = rows.filter((r) => r.cn[method] > 0 && r.clubCode).map((r) => {
      const [sex, age] = catParts(r.cat);
      return { lic: r.lic, name: r.name, cat: r.cat, sex, age, cn: r.cn[method], club: r.clubCode };
    }).filter((r) => r.sex);
    byClub = new Map();
    for (const r of runners) { if (!byClub.has(r.club)) byClub.set(r.club, []); byClub.get(r.club).push(r); }
    if (club && !byClub.has(club)) club = "";
    drawFilters();
    compute();
    drawExtra();
  }

  // the best team of the strongest clubs (a club that cannot beat the TOP-th team or ours, even with its best runners on
  // the longest legs, is skipped), our club's teams, the constant k
  let res = null;
  // ---- runners added by hand, saved with the account for this club ------------------------------------------------
  const added = () => extra.filter((r) => r.cn?.[terrain] > 0).map((r) => ({ lic: `x:${r.id}`, name: r.name, cat: `${r.sex}${r.age}`,
    sex: r.sex, age: r.age, cn: r.cn[terrain], club, added: true }));
  // one's own club: without the runners marked unavailable
  const poolOf = (c) => [...(byClub.get(c) || []), ...(c === club ? added() : [])].filter((r) => c !== club || !out.has(r.lic));
  async function loadExtra() {
    extra = []; out = new Set(); extraClub = club; saved = "";
    if (club) {
      try {
        const r = await fetch(`/api/account/relay?club=${encodeURIComponent(club)}`, { credentials: "same-origin", cache: "no-store" });
        if (r.ok) { const j = await r.json(); extra = j.runners || []; out = new Set((j.out || []).map(String)); } else saved = "unavailable";
      } catch (e) { saved = "unavailable"; }
    }
    drawExtra();
  }
  async function saveExtra() {
    saved = "saving"; drawExtraState();
    try {
      const r = await fetch("/api/account/relay", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ club: extraClub, runners: extra, out: [...out] }) });
      saved = r.ok ? "saved" : "unavailable";
    } catch (e) { saved = "unavailable"; }
    drawExtraState();
  }
  const drawExtraState = () => { const el = $("#rl-extra-state"); if (el) el.textContent = saved ? t(`rl.extra.${saved}`) : ""; };
  function drawExtra() {
    const card = $("#rl-extra-card");
    if (!card) return;
    card.hidden = !club;
    if (!club) return;
    const tr = t(`terrain.${terrain}`).toLowerCase();
    $("#rl-extra-title").textContent = `${t("rl.extra.title")} · ${clubName(club)}`;
    // the club's runners marked unavailable (a licence no longer in the club's pool is shown as such), and the others
    const all = [...(byClub.get(club) || []), ...added()];
    const outList = [...out].map((lic) => all.find((r) => r.lic === lic) || { lic, name: lic, cat: "", cn: null });
    const available = all.filter((r) => !out.has(r.lic)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    $("#rl-extra").innerHTML = html`
      ${extra.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>${t("rk.col.name")}</th><th>${t("rk.col.cat")}</th>
<th class="r">${t("rl.extra.cn", { t: tr })}</th><th></th></tr></thead>
        <tbody>${extra.map((r, i) => html`<tr><td>${r.name}</td><td>${r.sex}${r.age}</td>
          <td class="r"><input type="number" min="1" max="20000" step="1" value="${r.cn?.[terrain] ?? ""}" data-extra-cn="${i}" style="width:90px"
            aria-label="${t("rl.extra.cn", { t: tr })}"></td>
          <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-extra-del="${i}">${t("rl.extra.del")}</button></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty" style="padding:12px 16px">${t("rl.extra.none")}</div>`}
      <div class="filters" style="margin:12px 16px 14px;padding:0;border:0;background:none" id="rl-extra-form">
        <label class="field"><span>${t("rk.col.name")}</span><input type="text" id="rx-name" maxlength="60" style="width:200px"></label>
        <label class="field"><span>${t("f.sexe")}</span><select id="rx-sex"><option value="H">${t("rl.extra.H")}</option><option value="D">${t("rl.extra.D")}</option></select></label>
        <label class="field"><span>${t("rk.col.cat")}</span><select id="rx-age">${AGES.map((a) => html`<option value="${a}" ${raw(a === 21 ? "selected" : "")}>${a}</option>`)}</select></label>
        <label class="field"><span>${t("rl.extra.cn", { t: tr })}</span><input type="number" id="rx-cn" min="1" max="20000" step="1" style="width:110px"></label>
        <button type="button" class="btn btn-sm" id="rx-add" style="align-self:flex-end">${t("rl.extra.add")}</button>
      </div>
      <h3 style="margin:4px 16px 4px;font-size:15px">${t("rl.out.title")}</h3>
      <div class="hint" style="margin:0 16px 8px">${t("rl.out.hint")}</div>
      ${outList.length ? html`<div class="table-wrap"><table class="data compact"><thead><tr><th>${t("rk.col.name")}</th><th>${t("rk.col.cat")}</th>
        <th class="r">CN</th><th></th></tr></thead>
        <tbody>${outList.map((r) => html`<tr><td>${r.name}${r.added ? html` <span class="tag">${t("rl.extra.tag")}</span>` : ""}</td><td>${r.cat}</td>
          <td class="r num">${r.cn ? fmt(r.cn) : ""}</td>
          <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-out-back="${r.lic}">${t("rl.out.back")}</button></td></tr>`)}</tbody></table></div>`
        : html`<div class="empty" style="padding:12px 16px">${t("rl.out.none")}</div>`}
      <div class="filters" style="margin:12px 16px 14px;padding:0;border:0;background:none">
        <label class="field"><span>${t("rl.out.mark")}</span><select id="rx-out" style="max-width:280px"><option value="">—</option>
          ${available.map((r) => html`<option value="${r.lic}">${r.name}${r.added ? ` (${t("rl.extra.tag")})` : ""} · ${r.cat} · ${fmt(r.cn)}</option>`)}</select></label>
        <button type="button" class="btn btn-sm" id="rx-out-add" style="align-self:flex-end">${t("rl.out.add")}</button>
      </div>`;
    drawExtraState();
    const changed = () => { manual = null; saveExtra(); compute(); drawExtra(); };
    $("#rx-out-add").addEventListener("click", () => { const lic = $("#rx-out").value; if (lic) setOut(lic, true); });
    $$("[data-out-back]").forEach((b) => b.addEventListener("click", () => setOut(b.dataset.outBack, false)));
    $("#rx-add").addEventListener("click", () => {
      const name = $("#rx-name").value.trim().replace(/\s+/g, " "), cn = Math.round(Number($("#rx-cn").value));
      if (!name || !(cn > 0 && cn <= 20000)) { $("#rx-name").reportValidity?.(); return; }
      const sex = $("#rx-sex").value, age = Number($("#rx-age").value);
      // the same name again: its category and its CN in this discipline are updated
      const same = extra.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (same) Object.assign(same, { sex, age, cn: { ...same.cn, [terrain]: cn } });
      else if (extra.length < 40) extra.push({ id: Math.random().toString(36).slice(2, 10), name, sex, age, cn: { [terrain]: cn } });
      changed();
    });
    $$("[data-extra-del]").forEach((b) => b.addEventListener("click", () => { extra.splice(Number(b.dataset.extraDel), 1); changed(); }));
    $$("[data-extra-cn]").forEach((x) => x.addEventListener("change", () => {
      const r = extra[Number(x.dataset.extraCn)], v = Math.round(Number(x.value));
      r.cn = { ...r.cn };
      if (v > 0 && v <= 20000) r.cn[terrain] = v; else delete r.cn[terrain];
      changed();
    }));
  }

  /** Marks a runner of the club unavailable (or available again): out of the teams, kept with the account. */
  function setOut(lic, isOut) {
    if (isOut) out.add(lic); else out.delete(lic);
    if (manual) {
      // the hand-made team keeps the others; the leg left takes the best available runner who fits it
      manual = manual.map((r) => (r && r.lic === lic ? null : r));
      const pool = poolOf(club);
      manual = manual.map((r, i) => r || pool.filter((x) => fits(x.sex, x.age, fmtNow.legs[i]) && !manual.some((y) => y && y.lic === x.lic))
        .sort((a, b) => b.cn - a.cn)[0] || null);
    }
    saveExtra(); compute(); drawExtra();
  }

  function compute() {
    replaceQuery({ f: key === "cfc1" ? null : key, club: club || null, m: method, t: key === "perso" && terrain !== "For" ? terrain : null });
    remember();
    const f = fmtNow, n = f.legs.length;
    if (f.slots.length !== n || !n) return;
    const refs = f.legs.map((l) => l.ref).sort((a, b) => b - a);
    const bound = (rs) => {
      const cns = rs.map((r) => r.cn).sort((a, b) => b - a);
      return cns.length < n ? Infinity : refs.reduce((s, x, i) => s + x / cns[i], 0);
    };
    const mine = club ? clubTeams(poolOf(club), f, MAX_TEAMS) : [];
    const myWorst = mine.length ? Math.max(...mine.map((x) => x.cost)) : 0;
    const order = [...byClub.entries()].filter(([c]) => c !== club).map(([c, rs]) => [c, rs, bound(rs)]).filter((x) => isFinite(x[2]))
      .sort((a, b) => a[2] - b[2]);
    const others = [];
    for (const [c, rs, lb] of order) {
      const cut = others.length >= TOP ? [...others].sort((a, b) => a.cost - b.cost)[TOP - 1].cost : Infinity;
      if (lb >= Math.max(cut === Infinity ? Infinity : cut, myWorst) && others.length >= TOP) break;
      const tm = bestTeam(rs, f);
      if (tm) others.push({ club: c, ...tm });
    }
    const firsts = [...others, ...(mine[0] ? [{ club, ...mine[0] }] : [])].sort((a, b) => a.cost - b.cost);
    const ref = f.legs.reduce((s, l) => s + l.ref, 0);
    const basis = f.target === "top5" ? firsts.slice(0, 5) : firsts.slice(0, 1);
    const k = basis.length ? ref / (basis.reduce((s, x) => s + x.cost, 0) / basis.length) : null;
    res = { mine, others, firsts, k, ref };
    drawTeams();
    drawRanking();
  }

  const timesOf = (team) => team.map((r, i) => (r && res.k ? (res.k * fmtNow.legs[i].ref) / r.cn : null));
  const placeOf = (cost) => 1 + res.others.filter((x) => x.cost < cost).length;

  function teamTable(team, idx, editable) {
    const f = fmtNow, times = timesOf(team.map((x) => x?.runner || x));
    const rs = team.map((x) => x?.runner || x);
    const slotsOk = checkTeam(rs, f);
    const cost = rs.every(Boolean) ? rs.reduce((s, r, i) => s + f.legs[i].ref / r.cn, 0) : null;
    const total = cost != null && res.k ? res.k * cost : null;
    let cum = 0;
    const pool = poolOf(club);
    // the runners who fit the leg — and the one on it, whatever the leg's restriction (moved there by a swap: the warning says)
    const opts = (i, cur) => pool.filter((r) => fits(r.sex, r.age, f.legs[i]) || (cur && r.lic === cur.lic)).sort((a, b) => b.cn - a.cn)
      .map((r) => html`<option value="${r.lic}" ${raw(cur && r.lic === cur.lic ? "selected" : "")}>${r.name}${r.added ? ` (${t("rl.extra.tag")})` : ""} · ${r.cat} · ${fmt(r.cn)}</option>`);
    return html`<div class="rl-team">
      <h3 style="margin:12px 16px 6px;font-size:15px">${t("rl.team")} ${idx + 1}${total != null ? html` · <b>${mmss(total)}</b>
        <span class="muted" style="font-weight:400">· ${t("rl.place")} ${placeOf(cost)}${res.firsts[0] && res.k ? ` · +${mmss(total - res.k * res.firsts[0].cost)}` : ""}</span>` : ""}</h3>
      ${slotsOk ? "" : html`<div class="notice warn" style="margin:0 16px 8px">${t("rl.invalid")}</div>`}
      <div class="table-wrap"><table class="data compact"><thead><tr>${editable ? html`<th></th>` : ""}<th class="r">${t("rl.leg")}</th><th class="r">${t("rl.ref")}</th>
        <th>${t("rl.slot")}</th><th>${t("rl.runner")}</th><th class="r">CN</th><th class="r">${t("rl.time")}</th><th class="r">${t("rl.cum")}</th><th></th></tr></thead>
        <tbody>${rs.map((r, i) => {
          cum = times[i] != null && cum != null ? cum + times[i] : null;
          const slot = slotsOk ? f.slots[slotsOk[i]].label : "";
          // the runner taken out of the teams: a « ✕ » in a column of its own (owner, 2026-10-14: a word « indispo » after
          // each name read as that runner's status)
          const outBtn = r ? html`<button type="button" class="btn btn-sm rl-out" data-out="${r.lic}" title="${t("rl.out.mark")} : ${r.name}"
            aria-label="${t("rl.out.mark")} : ${r.name}">✕</button>` : "";
          return html`<tr ${raw(editable ? `data-leg="${i}"` : "")}>${editable ? html`<td class="c rl-move"><span class="rl-grip" draggable="true" data-grip="${i}" title="${t("rl.grip")}">⋮⋮</span>
              <button type="button" class="btn btn-ghost btn-sm" data-move="${i}:-1" title="${t("rl.move.up")}" ${raw(i ? "" : "disabled")}>▲</button><button type="button" class="btn btn-ghost btn-sm" data-move="${i}:1" title="${t("rl.move.down")}" ${raw(i < rs.length - 1 ? "" : "disabled")}>▼</button></td>` : ""}
            <td class="r num">${i + 1}</td><td class="r num">${fmt(f.legs[i].ref)}′</td><td class="muted" style="font-size:12.5px">${slot}</td>
            <td>${editable ? html`<select data-pick-leg="${i}" style="max-width:260px"><option value="">—</option>${opts(i, r)}</select>`
              : r ? html`${r.added ? html`<span>${r.name}</span> <span class="tag">${t("rl.extra.tag")}</span>` : html`<a href="${link.runner(r.lic)}">${r.name}</a>`}
                <span class="muted">${r.cat}</span>` : "—"}</td>
            <td class="r num">${r ? fmt(r.cn) : ""}</td><td class="r num">${mmss(times[i])}</td><td class="r num">${mmss(cum)}</td><td class="c">${outBtn}</td></tr>`;
        })}</tbody></table></div></div>`;
  }

  function drawTeams() {
    $("#rl-auto").hidden = !manual;
    if (!club) {
      $("#rl-team-title").textContent = t("rl.teams");
      $("#rl-teams").innerHTML = html`<div class="empty">${t("rl.pickClub")}</div>`;
      $("#rl-team-hint").textContent = "";
      return;
    }
    $("#rl-team-title").textContent = `${t("rl.teams")} · ${clubName(club)}`;
    // the best predicted time of each leg, as a share of its reference time (FFCO: about 85 %)
    const share = res.k ? fmtNow.legs.map((l, i) => Math.min(...res.firsts.map((x) => res.k * l.ref / x.legs[i].runner.cn)) / l.ref) : [];
    const mean = share.length ? share.reduce((s, x) => s + x, 0) / share.length : null;
    $("#rl-team-hint").textContent = mean ? t("rl.bestShare", { p: fmt(100 * mean) }) : "";
    if (!res.mine.length && !manual) {
      // which criteria the club cannot fill (runners ranked in the discipline)
      const pool = poolOf(club), need = new Map();
      for (const s of fmtNow.slots) need.set(s.label, [(need.get(s.label)?.[0] || 0) + 1, s]);
      const short = [...need].filter(([, [n, s]]) => pool.filter((r) => fits(r.sex, r.age, s)).length < n).map(([l]) => l);
      $("#rl-teams").innerHTML = html`<div class="empty">${short.length
        ? t("rl.missing", { t: t(`terrain.${terrain}`).toLowerCase(), list: short.join(", ") }) : t("rl.none")}</div>`;
      return;
    }
    const first = manual || res.mine[0].legs.map((x) => x.runner);
    $("#rl-teams").innerHTML = html`${teamTable(first, 0, true)}
      ${manual ? "" : res.mine.slice(1).map((tm, i) => teamTable(tm.legs, i + 1, false))}
      <p class="muted" style="font-size:12.5px;margin:8px 16px 14px">${t("rl.edit")}</p>`;
    $$("[data-pick-leg]").forEach((sel) => sel.addEventListener("change", () => {
      const pool = poolOf(club);
      manual = [...(manual || res.mine[0].legs.map((x) => x.runner))];
      manual[Number(sel.dataset.pickLeg)] = pool.find((r) => r.lic === sel.value) || null;
      drawTeams();
    }));
    $$("[data-out]").forEach((b) => b.addEventListener("click", () => setOut(b.dataset.out, true)));
    // two runners of the first team exchange their legs: the arrows, or a row's grip dropped on another row (owner, 2026-10-14)
    const swap = (i, j) => {
      if (i === j || !(i in first) || !(j in first)) return;
      manual = [...(manual || first)];
      [manual[i], manual[j]] = [manual[j], manual[i]];
      drawTeams();
    };
    $$("[data-move]").forEach((b) => b.addEventListener("click", () => { const [i, d] = b.dataset.move.split(":").map(Number); swap(i, i + d); }));
    $$("[data-grip]").forEach((g) => {
      g.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", g.dataset.grip); e.dataTransfer.effectAllowed = "move"; g.closest("tr").classList.add("dragging"); });
      g.addEventListener("dragend", () => $$("tr.dragging, tr.drop").forEach((x) => x.classList.remove("dragging", "drop")));
    });
    $$("tr[data-leg]").forEach((tr) => {
      tr.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; tr.classList.add("drop"); });
      tr.addEventListener("dragleave", () => tr.classList.remove("drop"));
      tr.addEventListener("drop", (e) => { e.preventDefault(); const i = Number(e.dataTransfer.getData("text/plain")); if (Number.isInteger(i)) swap(i, Number(tr.dataset.leg)); });
    });
  }
  $("#rl-auto").addEventListener("click", () => { manual = null; drawTeams(); });

  function drawRanking() {
    if (!res.firsts.length || !res.k) { $("#rl-ranking").innerHTML = html`<div class="empty">${t("rl.none")}</div>`; return; }
    const top = res.firsts.slice(0, TOP);
    const mineIn = club && !top.some((x) => x.club === club) && res.mine[0];
    const rows = [...top.map((x, i) => [i + 1, x]), ...(mineIn ? [[placeOf(res.mine[0].cost), { club, ...res.mine[0] }]] : [])];
    const best = res.firsts[0].cost;
    $("#rl-ranking").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr><th class="r">${t("rk.col.rank")}</th>
      <th>${t("rl.club")}</th><th class="r">${t("rl.total")}</th><th class="r">${t("rl.gap")}</th><th>${t("rl.runners")}</th></tr></thead>
      <tbody>${rows.map(([p, x], i) => html`<tr class="${x.club === club ? "me" : ""}">${mineIn && i === rows.length - 1 ? "" : ""}
        <td class="r num">${p}</td><td><a href="${link.club(x.club)}">${clubName(x.club)}</a></td>
        <td class="r num"><b>${mmss(res.k * x.cost)}</b></td><td class="r num">${p === 1 ? "" : `+${mmss(res.k * (x.cost - best))}`}</td>
        <td class="muted" style="font-size:12px">${x.legs.map((l) => l.runner.name).join(", ")}</td></tr>`)}</tbody></table></div>`;
  }

  drawFormat();
  await loadExtra();
  await load();
  return { title: t("rl.title") };
}
