// « VMA » (Entrainement group, 2026-10-14): the ways to measure one's maximal aerobic speed, a calculator for the 6- and
// 12-minute tests (demi-Cooper, Cooper) on a track — laps of the lane run plus the metres of the last lap, or a measured
// distance —, the training speeds that follow, and the free smartphone apps that play a track test's beeps.
// Nothing leaves the browser; the calculator's entries are kept in localStorage (ocn.vma). The long texts — how to run
// the test, the methods, the apps — are one module per language, content/vma.fr.js and vma.en.js; the rest vma.* keys.

import { html, raw, $, $$, fmt, fmtTime, pct } from "../util.js";
import { t, tn, lang } from "../i18n.js";
import { pageTabs, tabFrom, bindPageTabs, seg, tile } from "../ui.js";

const MEM = "ocn.vma";
const LANE_W = 1.22;              // a lane's width (m); lane 1 measured 0.30 m from the kerb, the others 0.20 m from their inner line
/** One lap of a 400 m track in lane n: 400 m in lane 1, then 2π × (1.22 (n − 1) − 0.10) more (lane 2: 407.04 m, lane 8: 453.03 m). */
const lap400 = (lane) => (lane <= 1 ? 400 : 400 + 2 * Math.PI * (LANE_W * (lane - 1) - 0.1));
// % of VMA, what it is used for
const ZONES = [105, 100, 95, 90, 85, 80, 75, 70, 65].map((p) => [p, t(`vma.zone.${p}`)]);
// the share of VMA a runner holds over the test (owner, 2026-10-14): 6 minutes is about the time one lasts at VMA (4 to 8
// minutes, often 6), so the demi-Cooper is run at it; 12 minutes is run below it, at about 95 % for a well-trained runner and
// 90 % for a moderately trained adult (coaching rules of thumb, as the races: a 3 km near 95 %, a 10 km at 85 to 90 %)
const LEVELS = [["trained", t("vma.level.trained"), 0.95], ["moderate", t("vma.level.moderate"), 0.90]];
const shareOf = (test, level) => (test === "6" ? 1 : LEVELS.find(([k]) => k === level)?.[2] ?? null);
const read = () => { try { return JSON.parse(localStorage.getItem(MEM) || "{}") || {}; } catch (e) { return {}; } };
const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);
const pace = (kmh) => (kmh > 0 ? t("vma.perKm", { t: fmtTime(Math.round(3600 / kmh)) }) : "—");

export async function render(main, { query }) {
  const tabs = [["calcul", t("vma.tab.calc")], ["methodes", t("vma.tab.methods")], ["applis", t("vma.tab.apps")]];
  const tab = tabFrom(tabs, query);
  const m = read();
  const st = {
    test: m.test === "12" ? "12" : "6",
    level: LEVELS.some(([k]) => k === m.level) ? m.level : null,       // asked explicitly before a Cooper's VMA is shown
    mode: m.mode === "dist" ? "dist" : "track",
    track: ["400", "200", "other"].includes(m.track) ? m.track : "400",
    lane: Math.min(8, Math.max(1, Math.round(num(m.lane, 1)))),
    other: num(m.other, 250), laps: num(m.laps, ""), extra: num(m.extra, ""), dist: num(m.dist, ""),
  };
  const save = () => { try { localStorage.setItem(MEM, JSON.stringify(st)); } catch (e) {} };
  const C = await import(`../content/vma.${lang()}.js`);

  main.innerHTML = html`
    <div class="page-head"><div><h1>${t("nav.vma")}</h1><p class="lede">${t("vma.lede")}</p></div></div>
    ${pageTabs(tabs, tab)}
    <div data-panel="calcul">
      <div class="grid grid-main-side vma-grid" style="align-items:start;margin-bottom:16px">
        <div>
          <section class="card" style="margin-bottom:16px"><div class="card-head"><div><h2>${t("vma.test.title")}</h2>
            <div class="hint">${t("vma.test.hint")}</div></div></div>
            <div class="card-body vma-form" id="vma-form"></div></section>
          <div class="tiles" id="vma-tiles" style="margin-bottom:12px"></div>
          <p class="muted vma-note" id="vma-note"></p>
        </div>
        ${raw(C.howTo)}
      </div>
      <section class="card"><div class="card-head"><div><h2>${t("vma.zones.title")}</h2>
        <div class="hint">${t("vma.zones.hint")}</div></div></div>
        <div id="vma-zones"></div></section>
    </div>
    <div data-panel="methodes" hidden>${raw(C.methods)}</div>
    <div data-panel="applis" hidden>${raw(C.apps)}</div>`;

  function lapLen() {
    if (st.track === "400") return lap400(st.lane);
    if (st.track === "200") return 200;
    return st.other > 0 ? st.other : null;
  }
  function distance() {
    if (st.mode === "dist") return st.dist > 0 ? st.dist : null;
    const L = lapLen(), laps = st.laps === "" ? 0 : st.laps, extra = st.extra === "" ? 0 : st.extra;
    if (!L || (st.laps === "" && st.extra === "")) return null;
    return laps * L + extra;
  }

  // under the track's fields: the lap's length, and a warning when the last lap's metres exceed a lap
  function trackNote() {
    const L = lapLen();
    return html`${L ? html`${raw(t("vma.lap", { m: fmt(L, 2) }))}${st.track === "400" ? t("vma.lap.400") : st.track === "200" ? t("vma.lap.200") : ""}` : t("vma.lap.none")}
      ${L && st.extra !== "" && st.extra >= L ? html`<br><span class="vma-warn">${t("vma.lap.warn")}</span>` : ""}`;
  }
  function drawForm() {
    $("#vma-form").innerHTML = html`
      <div class="filters vma-fields">
        <div class="field"><span>${t("vma.f.test")}</span>${seg("vma-test", [["6", t("vma.f.half")], ["12", t("vma.f.cooper")]], st.test)}</div>
        <div class="field"><span>${t("vma.f.distance")}</span>${seg("vma-mode", [["track", t("vma.f.laps")], ["dist", t("vma.f.measured")]], st.mode)}</div>
        ${st.test === "12" ? html`<div class="field"><span>${t("vma.f.level")}</span>${seg("vma-level",
          LEVELS.map(([k, l, p]) => [k, `${l} · ${pct(p)}`]), st.level ?? "")}</div>` : ""}
      </div>
      ${st.mode === "track" ? html`<div class="filters vma-fields">
        <label class="field"><span>${t("vma.f.track")}</span><select id="vma-track">
          <option value="400" ${raw(st.track === "400" ? "selected" : "")}>${t("vma.f.t400")}</option>
          <option value="200" ${raw(st.track === "200" ? "selected" : "")}>${t("vma.f.t200")}</option>
          <option value="other" ${raw(st.track === "other" ? "selected" : "")}>${t("vma.f.tother")}</option></select></label>
        ${st.track === "400" ? html`<label class="field"><span>${t("vma.f.lane")}</span><select id="vma-lane">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => html`<option value="${n}" ${raw(n === st.lane ? "selected" : "")}>${n} · ${fmt(lap400(n), 2)} m</option>`)}</select></label>` : ""}
        ${st.track === "other" ? html`<label class="field"><span>${t("vma.f.lapLen")}</span>
          <input type="number" id="vma-other" min="20" max="5000" step="0.1" value="${st.other}" style="width:110px"></label>` : ""}
        <label class="field"><span>${t("vma.f.fullLaps")}</span><input type="number" id="vma-laps" min="0" max="60" step="1" value="${st.laps}" inputmode="numeric" style="width:90px"></label>
        <label class="field"><span>${t("vma.f.extra")}</span><input type="number" id="vma-extra" min="0" max="5000" step="1" value="${st.extra}" inputmode="numeric" style="width:110px"></label>
      </div>
      <div class="muted vma-small" id="vma-small">${trackNote()}</div>`
      : html`<div class="filters vma-fields">
        <label class="field"><span>${t("vma.f.dist")}</span><input type="number" id="vma-dist" min="0" max="6000" step="1" value="${st.dist}" inputmode="numeric" style="width:120px"></label>
      </div>
      <div class="muted vma-small">${t("vma.f.distNote")}</div>`}`;
    $$('[data-seg="vma-test"]').forEach((b) => b.addEventListener("click", () => { st.test = b.dataset.value; changed(true); }));
    $$('[data-seg="vma-mode"]').forEach((b) => b.addEventListener("click", () => { st.mode = b.dataset.value; changed(true); }));
    $$('[data-seg="vma-level"]').forEach((b) => b.addEventListener("click", () => { st.level = b.dataset.value; changed(true); }));
    $("#vma-track")?.addEventListener("change", (e) => { st.track = e.target.value; changed(true); });
    $("#vma-lane")?.addEventListener("change", (e) => { st.lane = Number(e.target.value); changed(true); });
    const bindNum = (id, key, redraw) => $(id)?.addEventListener("input", (e) => {
      st[key] = e.target.value === "" ? "" : Math.max(0, Number(e.target.value)); changed(redraw);
    });
    bindNum("#vma-other", "other", false);
    bindNum("#vma-laps", "laps", false);
    bindNum("#vma-extra", "extra", false);
    bindNum("#vma-dist", "dist", false);
  }
  // a choice redraws the form; a number typed only the note under the fields (the field keeps its focus) and the results
  function changed(redrawForm) {
    save();
    if (redrawForm) drawForm();
    else if ($("#vma-small")) $("#vma-small").innerHTML = trackNote();
    drawResults();
  }

  function drawResults() {
    const d = distance(), T = Number(st.test);
    if (!d) {
      $("#vma-tiles").innerHTML = html`<div class="empty" style="grid-column:1/-1">${t("vma.enterDist")}</div>`;
      $("#vma-note").textContent = "";
      $("#vma-zones").innerHTML = html`<div class="empty">—</div>`;
      return;
    }
    const share = shareOf(st.test, st.level);
    const L = lapLen();
    const how = st.mode === "track" ? tn("vma.how.laps", st.laps || 0, { m: fmt(L, 2), x: fmt(st.extra || 0) }) : t("vma.how.measured");
    if (!share) {                                   // a Cooper without a level: no VMA until it is chosen
      $("#vma-tiles").innerHTML = html`${tile(t("vma.t.distance"), `${fmt(d, d % 1 ? 1 : 0)} m`, how)}
        <div class="empty" style="grid-column:1/-1">${t("vma.chooseLevel")}</div>`;
      $("#vma-note").textContent = "";
      $("#vma-zones").innerHTML = html`<div class="empty">—</div>`;
      return;
    }
    // the speed held over the test is share × VMA, and that speed is d / T
    const vma = (d * 60) / (T * 1000) / share;
    const vo2 = 3.5 * vma;                          // the oxygen cost of running: about 3.5 ml/kg/min per km/h (Léger)
    $("#vma-tiles").innerHTML = html`
      ${tile(t("vma.t.distance"), `${fmt(d, d % 1 ? 1 : 0)} m`, how)}
      ${tile(t("vma.t.vma"), `${fmt(vma, 1)} km/h`, `${T === 6 ? t("vma.t.vma6") : t("vma.t.vma12", { p: fmt(share * 100) })} · ${pace(vma)}`)}
      ${tile(t("vma.t.vo2"), `${fmt(vo2, 1)} ml/kg/min`, t("vma.t.vo2.sub"))}`;
    $("#vma-note").textContent = T === 6 ? t("vma.note6") : t("vma.note12", { p: fmt(share * 100) });
    $("#vma-zones").innerHTML = html`<div class="table-wrap"><table class="data compact"><thead><tr>
        <th class="r">${t("vma.col.pct")}</th><th class="r">${t("vma.col.speed")}</th><th class="r">${t("vma.col.pace")}</th><th class="r">200 m</th><th class="r">400 m</th><th class="r">${fmt(1000)} m</th><th>${t("vma.col.use")}</th></tr></thead>
      <tbody>${ZONES.map(([p, use]) => {
        const s = (vma * p) / 100, per = (m) => fmtTime(Math.round((m / 1000) * (3600 / s)));
        return html`<tr class="${p === 100 ? "me" : ""}"><td class="r num">${pct(p / 100)}</td><td class="r num"><b>${fmt(s, 1)}</b> km/h</td><td class="r num">${pace(s)}</td>
          <td class="r num">${per(200)}</td><td class="r num">${per(400)}</td><td class="r num">${per(1000)}</td><td>${use}</td></tr>`;
      })}</tbody></table></div>`;
  }

  drawForm();
  drawResults();
  bindPageTabs(main, tabs, tab);
  return { title: t("nav.vma") };
}
