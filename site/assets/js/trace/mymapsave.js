// « Analyse solo »'s « Enregistrer dans Mes cartes » (owner, 2026-11-01): the map and the run as the playback draws them —
// the map as it came, the race's part of the trace in the map's pixels with its times, the controls placed —, never the trace's
// file. Heart rate, altitude and cadence only when the runner ticks it (off by default: personal data). Mounted in the
// playback's « Export » tab by pages/analysis.js (and « Analyse de carte »'s, pages/shared.js), which gives what it holds through `state()`.

import { html, $ } from "../util.js";
import { imageBlob } from "./mapfile.js";
import { t, loadArea, locale } from "../i18n.js";
import * as auth from "../auth.js";
import * as MM from "./mymaps.js";

await loadArea("mymaps");

const PERSONAL = { hr: "hr", ele: "ele", cad: "cad" };

/** The race's part of the trace as the playback draws it (the whole trace when the race's window holds too little of it). */
function windowOf(s) {
  const tr = s.track;
  let i0 = 0, i1 = tr.n - 1;
  if (s.offset != null && s.total > 0) {
    const a = tr.t.findIndex((v) => v >= s.offset), b = tr.t.findLastIndex((v) => v <= s.offset + s.total);
    if (a >= 0 && b - a >= 10) { i0 = a; i1 = b; }
  }
  return [i0, i1];
}
/** The personal channels the run holds, with values over the race (owner, 2026-11-05: the box asked about them only then). */
function personalOf(s) {
  if (!s.track?.ch) return [];
  const [i0, i1] = windowOf(s);
  return Object.keys(PERSONAL).filter((c) => { const v = s.track.ch[c]; if (!v) return false; for (let i = i0; i <= i1; i++) if (Number.isFinite(v[i])) return true; return false; });
}

/**
 * el: where the box goes; state(): { file (the map's file), image, track, pxs, pys, offset, total, controls: [{ k, x, y, t (s of
 * the race) | null }], geo, title, perso }.
 */
export function mount(el, state) {
  const me = auth.session();
  if (!el || !me || me.demo) { if (el) el.hidden = true; return; }
  const s0 = state();
  const chans = personalOf(s0);
  const what = chans.length ? new Intl.ListFormat(locale(), { type: "conjunction" }).format(chans.map((c) => t(`mm.ch.${c}`))) : "";
  el.innerHTML = html`<div class="an-opts mm-save"><b>${t("mm.solo.box")}</b>
    <label><span>${t("mm.f.title")}</span><input type="text" id="mm-s-title" maxlength="200" value="${s0.title || ""}"></label>
    <label class="mm-s-note"><span>${t("mm.note")}</span><textarea id="mm-s-note" rows="2" maxlength="1000" placeholder="${t("mm.note.ph")}"></textarea></label>
    ${chans.length ? html`<label class="mm-check"><input type="checkbox" id="mm-s-personal"> <span>${t("mm.personal.askWhat", { what })}</span></label>` : ""}
    <button type="button" class="btn btn-sm btn-primary" id="mm-s-go">${t("mm.solo.save")}</button><span class="muted" id="mm-s-state"></span></div>`;
  $("#mm-s-go", el).addEventListener("click", async () => {
    const btn = $("#mm-s-go", el), out = $("#mm-s-state", el), s = state();
    if (!s.image || !s.track || !s.pxs) { out.textContent = t("mm.solo.notReady"); return; }
    btn.disabled = true; out.textContent = t("mm.solo.saving");
    try {
      const personal = !!$("#mm-s-personal", el)?.checked;
      const tr = s.track, [i0, i1] = windowOf(s);
      const pts = [];
      for (let i = i0; i <= i1; i++) {
        const p = { x: s.pxs[i], y: s.pys[i], ms: tr.ms0 + tr.t[i] * 1000, lat: tr.lat0 - tr.y[i] / tr.ky, lon: tr.lon0 + tr.x[i] / tr.kx };
        for (const c of chans) { const v = tr.ch[c][i]; if (Number.isFinite(v)) p[c] = v; }
        pts.push(p);
      }
      const startMs = tr.ms0 + tr.t[i0] * 1000;
      const raceMs = s.offset != null ? tr.ms0 + s.offset * 1000 : null;
      const controls = (s.controls || []).filter((c) => Number.isFinite(c.x)).map((c) => ({ k: c.k, x: c.x, y: c.y, t: c.t != null && raceMs != null ? raceMs + c.t * 1000 : null }));
      const rec = MM.encodeRun(pts, { personal: true, controls });
      const day = new Date(startMs).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
      const title = $("#mm-s-title", el).value.trim();
      const blob = await imageBlob(s.file || null, s.image);      // the map as it came; a PDF's or a generated map's page as a PNG
      const { map, existed } = await MM.save({ blob, name: s.file?.name || "", image: s.image, title, day, geo: s.geo || null,
        runs: [{ title, day, source: tr.source === "drawn" ? "drawn" : "solo", note: $("#mm-s-note", el).value.trim(), start: startMs, dur: (pts.at(-1).ms - pts[0].ms) / 1000, dist: MM.lengthOf(pts), rec }] }, { personal });
      out.innerHTML = html`${t(existed ? "mm.solo.addedTo" : "mm.solo.saved")} <a href="#/mes-cartes?carte=${map.id}">${t("mm.solo.open")}</a>`.toString();
    } catch (e) {
      console.error(e);
      out.textContent = t(e.status === 503 ? "mm.err.notReady" : e.status === 413 ? "mm.err.size" : "mm.err.save");
      btn.disabled = false;
    }
  });
}
