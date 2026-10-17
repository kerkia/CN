// « Caler les postes sur la carte »: when the map is not the file the courses were set on — a .ppen made on an OCAD map
// opened here with a PDF or an image of that map, a scan, a photo taken flat, a new edition — the controls are moved onto
// it by pairs of clicks: a control, then the place where it stands on the map (two pairs at least; more are fitted by least
// squares). The fit is a similarity (shift, rotation, one scale). When the controls' distances are right (a .ppen keeps
// true map millimetres), the scale found is the map file's error instead — an image's unknown resolution, a PDF printed at
// another scale — and the map is corrected rather than the course, so lengths stay right.

import * as M from "./model.js";
import { modal } from "./dialogs.js";
import { t, tn, locale } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const nf = (v, d = 0) => new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

/** Least-squares similarity from pairs [[src, dst]]: { m: [a, b, c, d, e, f] (x' = a x + b y + e, y' = c x + d y + f), k, deg, rms }. */
export function similarity(pairs) {
  const n = pairs.length;
  let sx = 0, sy = 0, tx = 0, ty = 0;
  for (const [s, t] of pairs) { sx += s[0]; sy += s[1]; tx += t[0]; ty += t[1]; }
  sx /= n; sy /= n; tx /= n; ty /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (const [s, t] of pairs) {
    const ax = s[0] - sx, ay = s[1] - sy, bx = t[0] - tx, by = t[1] - ty;
    num1 += ax * bx + ay * by; num2 += ax * by - ay * bx; den += ax * ax + ay * ay;
  }
  if (!den) return null;
  const zr = num1 / den, zi = num2 / den;
  const m = [zr, -zi, zi, zr, tx - zr * sx + zi * sy, ty - zi * sx - zr * sy];
  const T = ([x, y]) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
  const rms = Math.sqrt(pairs.reduce((a, [s, t]) => { const p = T(s); return a + (p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2; }, 0) / n);
  return { m, k: Math.hypot(zr, zi), deg: (Math.atan2(zi, zr) * 180) / Math.PI, rms };
}

/** A first guess when the controls lie off the sheet: the course's middle on the map's middle, the scale kept. */
export function centreOnMap(ev) {
  const cs = Object.values(ev.controls);
  if (!cs.length) return false;
  const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
  const off = cs.filter((c) => c.x < 0 || c.y < 0 || c.x > ev.map.w || c.y > ev.map.h).length;
  if (off < cs.length / 2) return false;
  const dx = ev.map.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, dy = ev.map.h / 2 - (Math.min(...ys) + Math.max(...ys)) / 2;
  M.transformAll(ev, [1, 0, 0, 1, dx, dy]);
  return true;
}

/** The interactive alignment. fromPpen: the controls' distances are known right (default: correct the map, not the course). */
export function calage(E, { fromPpen = false } = {}) {
  if (E.readOnly) { E.toast(t("trc.cal.readOnly")); return; }
  const pairs = [];
  let pending = null;                                         // a control chosen, its place not yet clicked
  const box = document.createElement("div");
  box.className = "tr-calage";
  E.root.appendChild(box);
  const overlay = (g, T) => {
    g.save(); g.lineWidth = 2;
    for (const [s, t] of pairs) {
      const [x1, y1] = T(...s), [x2, y2] = T(...t);
      g.strokeStyle = "#0a84ff"; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(x1, y1, 7, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "#e11d48"; g.beginPath(); g.moveTo(x2 - 8, y2); g.lineTo(x2 + 8, y2); g.moveTo(x2, y2 - 8); g.lineTo(x2, y2 + 8); g.stroke();
    }
    if (pending) { const [x, y] = T(...pending.pt); g.strokeStyle = "#0a84ff"; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  };
  E.overlays.push(overlay);
  const end = () => { E.pickOnce = null; E.pickCancel = null; box.remove(); E.overlays.splice(E.overlays.indexOf(overlay), 1); E.help(); E.redraw(); };
  const render = () => {
    const n = pairs.length;
    box.innerHTML = `<b>${esc(t("trc.cal.title"))}</b>
      <p>${pending ? t("trc.cal.clickPlace", { name: esc(pending.name) })
        : esc(`${t("trc.cal.pointN", { n: n + 1 })} ${n < 2 ? t("trc.cal.twoEnough") : t("trc.cal.onePlus")}`)}</p>
      <p class="tr-hint">${esc(tn("trc.cal.placed", n))}</p>
      <div class="tr-btns"><button type="button" class="btn btn-sm" data-c="cancel">${esc(t("trc.cal.cancel"))}</button>${n >= 2 ? `<button type="button" class="btn btn-sm btn-primary" data-c="apply">${esc(t("trc.cal.apply"))}</button>` : ""}</div>`;
    box.querySelector('[data-c="cancel"]').addEventListener("click", end);
    box.querySelector('[data-c="apply"]')?.addEventListener("click", apply);
    E.help(pending ? t("trc.cal.helpPlace", { name: pending.name }) : t("trc.cal.helpPick"));
    E.redraw();
    arm();
  };
  const arm = () => {
    E.pickCancel = end;
    E.pickOnce = (p) => {
      if (!pending) {
        // the control nearest the click, within a few millimetres
        let best = null;
        for (const [id, c] of Object.entries(E.ev.controls)) { const d = M.dist([c.x, c.y], p); if (!best || d < best.d) best = { id: Number(id), d, pt: [c.x, c.y] }; }
        if (!best || best.d > Math.max(6, 25 / E.view.k)) { E.toast(t("trc.cal.clickCircle")); arm(); return; }
        const c = E.ev.controls[best.id];
        pending = { pt: best.pt, name: c.kind === "normal" ? c.code : { start: t("trc.cal.start"), finish: t("trc.cal.finish") }[c.kind] || t("trc.cal.point") };
      } else { pairs.push([pending.pt, p]); pending = null; }
      render();
    };
  };
  async function apply() {
    const fit = similarity(pairs);
    if (!fit) { E.toast(t("trc.cal.twoDistinct")); return; }
    // an OCAD or Mapper map's millimetres are exact: the course is scaled by default, not the map
    const off = Math.abs(fit.k - 1) > 0.01, bitmap = E.ev.map.kind === "bitmap", mapFirst = fromPpen && E.ev.map.kind !== "ocad";
    const v = await modal(E, { title: t("trc.cal.modalTitle"), body: `
      <p>${esc(t("trc.cal.fit", { deg: nf(fit.deg, 1), k: nf(fit.k, 3), rms: pairs.length > 2 ? t("trc.cal.rms", { m: nf(M.mmToM(E.ev, fit.rms), 1) }) : "" }))}</p>
      ${off ? `<label class="tr-check"><input type="radio" name="how" value="map" ${mapFirst ? "checked" : ""}> ${esc(bitmap ? t("trc.cal.fixDpi", { a: nf(E.ev.map.dpi, 1), b: nf(E.ev.map.dpi * fit.k, 1) }) : t("trc.cal.fixScale", { a: nf(E.ev.map.scale), b: nf(Math.round(E.ev.map.scale / fit.k)) }))}</label>
        <label class="tr-check"><input type="radio" name="how" value="course" ${mapFirst ? "" : "checked"}> ${esc(t("trc.cal.mapRight"))}</label>` : `<p class="tr-hint">${esc(t("trc.cal.sameScale"))}</p>`}`, ok: t("trc.cal.apply") });
    if (!v) return;
    const toMap = off && v.how === "map", k = fit.k;
    E.change((x) => {
      if (toMap) {
        if (x.map.kind === "bitmap") {
          // the course keeps its size; the image's millimetres were wrong by k
          M.transformAll(x, fit.m.map((a) => a / k));
          x.map.dpi *= k; x.map.w /= k; x.map.h /= k;
          if (x.geo) for (const key of ["a", "b", "c", "d", "e", "f"]) x.geo[key] /= k;
        } else {
          M.transformAll(x, fit.m);
          x.map.scale = Math.round(x.map.scale / k);
        }
      } else M.transformAll(x, fit.m);
    }, t("trc.cal.undoLabel"));
    if (toMap && E.map && E.ev.map.kind === "bitmap") E.map.dpi = E.ev.map.dpi;
    end();
    E.fitCourse();
    E.toast(toMap ? t("trc.cal.doneMap") : t("trc.cal.done"), 6000);
  }
  render();
}
