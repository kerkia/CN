// Checks drawn on the map (the advanced level; owner, 2026-10-24, after Condes's « Course Layout » menu): each control's attack
// angle on the course shown — the turn between the leg in and the leg out, 0° straight on, 180° straight back; Condes highlights
// those over 120° — and the controls closer to another than a distance chosen (its « proximate controls »). Overlays of the
// editor's map (E.overlays), on the screen only; the choice stays for the visit.

import * as M from "./model.js";
import { t } from "./lang.js";

const DEG = 180 / Math.PI;
const isSprint = (ev) => ev.appearance?.mapStandard === "Spr2019" || ev.map.scale <= 5000;

/** The attack angles of a course designator's controls: [{ control, at: [x, y], angle (degrees) }]. */
export function attackAngles(ev, cd) {
  if (!cd.course) return [];
  const v = M.view(ev, cd, { specials: false, descriptions: false }), out = [];
  for (let i = 0; i < v.controls.length; i++) {
    const cv = v.controls[i], c = ev.controls[cv.control];
    if (c.kind !== "normal") continue;
    const prev = v.controls.findIndex((x) => x.legTo?.includes(i)), next = M.nextIndex(v, i);
    if (prev < 0 || next < 0) continue;
    const pin = M.legPoints(ev, v.controls[prev].control, cv.control), pout = M.legPoints(ev, cv.control, v.controls[next].control);
    const a = pin[pin.length - 2], b = [c.x, c.y], d = pout[1];
    const din = Math.atan2(b[1] - a[1], b[0] - a[0]), dout = Math.atan2(d[1] - b[1], d[0] - b[0]);
    let turn = Math.abs(dout - din) * DEG;
    if (turn > 180) turn = 360 - turn;
    out.push({ control: cv.control, at: b, angle: turn, dirIn: din, dirOut: dout });
  }
  return out;
}
/** Pairs of controls closer than a distance in metres: [{ a, b, m }]. */
export function proximate(ev, minM) {
  const ids = Object.keys(ev.controls).map(Number).filter((id) => ev.controls[id].kind === "normal"), out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ev.controls[ids[i]], b = ev.controls[ids[j]], m = M.mmToM(ev, M.dist([a.x, a.y], [b.x, b.y]));
    if (m < minM) out.push({ a: ids[i], b: ids[j], m });
  }
  return out;
}

function overlay(E, key, draw) {
  const i = E.overlays.findIndex((f) => f.key === key);
  if (i >= 0) { E.overlays.splice(i, 1); E.redraw(); return false; }
  draw.key = key;
  E.overlays.push(draw);
  E.redraw();
  return true;
}
/** Carte › Vérifier: the attack angles shown or hidden. */
export function toggleAngles(E) {
  const on = overlay(E, "angles", (g, T, k) => {
    const r = M.controlRadius(E.ev) * (E.layout?.ratio || 1);
    for (const x of attackAngles(E.ev, E.cdDraw || E.cd)) {
      const [sx, sy] = T(...x.at), big = x.angle > 120, R = Math.max(14, r * k * 1.6);
      // the arc from the way in, carried on, to the way out (the turn), and the angle in degrees (screen angles: y down)
      g.save();
      g.strokeStyle = big ? "#dc2626" : "#0a84ff"; g.fillStyle = big ? "#dc2626" : "#0a84ff"; g.lineWidth = big ? 2.4 : 1.4;
      const s = -x.dirIn;
      let diff = -x.dirOut - s;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff <= -Math.PI) diff += 2 * Math.PI;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(s) * R, sy + Math.sin(s) * R); g.arc(sx, sy, R, s, s + diff, diff < 0); g.stroke();
      g.font = `${big ? "700 " : ""}12px system-ui, sans-serif`; g.textAlign = "center";
      g.fillText(`${Math.round(x.angle)}°`, sx + Math.cos(s + diff / 2) * (R + 10), sy + Math.sin(s + diff / 2) * (R + 10) + 4);
      g.restore();
    }
  });
  E.toast(on ? t("trc.adv.anglesOn") : t("trc.adv.anglesOff"));
  E.opts.angles = on;
}
/** Carte › Vérifier: the controls closer to another than a distance, ringed in red with their distance. */
export async function toggleNearest(E) {
  if (E.overlays.some((f) => f.key === "nearest")) { overlay(E, "nearest"); E.opts.nearest = 0; E.toast(t("trc.adv.nearestOff")); return; }
  const { modal, field, num } = await import("./dialogs.js");
  const v = await modal(E, { title: t("trc.adv.nearestTitle"), body: field(t("trc.adv.nearestField"), `<input name="m" value="${E.opts.nearestM || (isSprint(E.ev) ? 15 : 30)}" inputmode="numeric">`, t("trc.adv.nearestHint")) });
  if (!v) return;
  const minM = Math.max(1, num(v.m) || 30);
  E.opts.nearestM = minM;
  overlay(E, "nearest", (g, T) => {
    const pairs = proximate(E.ev, minM);
    g.save(); g.strokeStyle = "#dc2626"; g.fillStyle = "#dc2626"; g.lineWidth = 2; g.font = "700 12px system-ui, sans-serif"; g.textAlign = "center";
    for (const p of pairs) {
      const a = E.ev.controls[p.a], b = E.ev.controls[p.b], [ax, ay] = T(a.x, a.y), [bx, by] = T(b.x, b.y);
      g.setLineDash([5, 4]); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
      for (const [x, y] of [[ax, ay], [bx, by]]) { g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.stroke(); }
      g.fillText(`${Math.round(p.m)} m`, (ax + bx) / 2, (ay + by) / 2 - 6);
    }
    g.restore();
  });
  E.toast(t("trc.adv.nearestOn", { n: proximate(E.ev, minM).length, m: minM }));
}
