// What of an OCAD or Mapper map is shown (the advanced level; owner, 2026-10-24, after Condes's Canvas menu): its colours, any of
// them left out of the screen and the prints (ev.mapHidden: the colours' numbers), and an OCAD map's templates — the other files
// it shows under its drawing (a scan, an older map: vmap/ocad.js map.templates), which a browser cannot open by their path: the
// user gives them, and they are kept with the event as its other maps (maps.js, ev.maps[id].template), drawn half transparent
// over the map, placed where OCAD places them.

import * as M from "./model.js";
import * as S from "./store.js";
import { openMap, mimeOf } from "./mapsrc.js";
import { mapColors } from "./appear.js";
import { t } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** « Couleurs de la carte »: tick the colours to show. */
export async function colorsDialog(E) {
  const cols = mapColors(E.map);
  if (!cols.length) { E.toast(t("trc.mv.notVector")); return; }
  const { modal } = await import("./dialogs.js");
  const hidden = new Set(E.ev.mapHidden || []);
  const v = await modal(E, { title: t("trc.mv.colorsTitle"), wide: true, ok: t("trc.mv.apply"), body: `<p>${esc(t("trc.mv.colorsIntro"))}</p>
    <div class="tr-checks tr-cols">${cols.map(([id, name]) => `<label class="tr-check"><input type="checkbox" name="c${id}" ${hidden.has(id) ? "" : "checked"}> ${esc(name)}</label>`).join("")}</div>
    <p><button type="button" class="btn btn-sm" id="tr-cols-all">${esc(t("trc.mv.all"))}</button></p>`,
  onOpen: (f) => f.querySelector("#tr-cols-all").addEventListener("click", () => f.querySelectorAll(".tr-cols input").forEach((x) => { x.checked = true; })) });
  if (!v) return;
  const off = cols.filter(([id]) => !v[`c${id}`]).map(([id]) => id);
  E.status(t("trc.mv.redraw"), "busy");
  E.change((x) => { if (off.length) x.mapHidden = off; else delete x.mapHidden; }, t("trc.mv.colorsUndo"));
  await E.syncMap?.();
  E.status(t("trc.mv.done"), "ok");
}

/** The affine from the event's mm to a template image's sheet mm (its pixels at u × v mm, OCAD's placing: its centre at (x, y) of
 *  the map file's mm, turned by its angle). */
function templateTf(ev, tp, pxW, pxH) {
  const w = pxW * tp.u, h = pxH * tp.v, a = (tp.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), [ox, oy] = M.fileOffset(ev);
  // sheet (sx, sy) → file: centre + R·(sx − w/2, sy − h/2) → event: file − origin; the inverse is the event → sheet
  const fwd = [c, -s, tp.x - ox - c * w / 2 + s * h / 2, s, c, tp.y - oy - s * w / 2 - c * h / 2];
  const det = fwd[0] * fwd[4] - fwd[1] * fwd[3];
  return [fwd[4] / det, -fwd[1] / det, (fwd[1] * fwd[5] - fwd[4] * fwd[2]) / det, -fwd[3] / det, fwd[0] / det, (fwd[3] * fwd[2] - fwd[0] * fwd[5]) / det];
}
/** « Modèles de la carte »: the OCAD map's templates listed, their files dropped here, shown over the map or not. */
export async function templatesDialog(E) {
  const list = E.map?.vmap?.templates || [];
  const { modal, dropHtml, dropZone } = await import("./dialogs.js");
  const kept = Object.entries(E.ev.maps || {}).filter(([, m]) => m.template);
  const given = new Map();
  const base = (p) => String(p || "").split(/[\\/]/).pop().toLowerCase();
  const v = await modal(E, { title: t("trc.mv.tplTitle"), wide: true, ok: t("trc.mv.apply"), body: `<p>${esc(list.length ? t("trc.mv.tplIntro") : t("trc.mv.tplNone"))}</p>
    ${list.length ? `<table class="tr-table"><thead><tr><th>${esc(t("trc.mv.tplFile"))}</th><th>${esc(t("trc.mv.tplState"))}</th></tr></thead><tbody>
      ${list.map((tp, i) => { const k = kept.find(([, m]) => base(m.map.file) === base(tp.file)); return `<tr><td>${esc(base(tp.file))}</td><td id="tr-tpl-${i}">${k ? `<label class="tr-check"><input type="checkbox" name="s${k[0]}" ${E.ev.maps[k[0]].hidden ? "" : "checked"}> ${esc(t("trc.mv.tplShown"))}</label>` : esc(t("trc.mv.tplMissing"))}</td></tr>`; }).join("")}</tbody></table>
      ${dropHtml("tr-tpl-drop", t("trc.mv.tplDrop"), "image/*,.tif,.tiff,.bmp,.jpg,.png", true)}` : ""}`,
  onOpen: (f) => { const z = f.querySelector("#tr-tpl-drop"); if (z) dropZone(z, (files) => { for (const fl of files) { const i = list.findIndex((tp) => base(tp.file) === fl.name.toLowerCase()); if (i >= 0) { given.set(i, fl); f.querySelector(`#tr-tpl-${i}`).textContent = t("trc.mv.tplGiven"); } else E.toast(t("trc.mv.tplNotListed", { name: fl.name })); } }); } });
  if (!v) return;
  const added = [];
  for (const [i, fl] of given) {
    const tp = list[i], bytes = new Uint8Array(await fl.arrayBuffer()), type = mimeOf(fl.name, fl.type);
    let src;
    try { src = await openMap(bytes, type, fl.name); } catch (e) { E.toast(t("trc.mv.tplUnreadable", { name: fl.name })); continue; }
    const id = Math.max(0, ...Object.keys(E.ev.maps || {}).map(Number), ...added.map((a) => a.id)) + 1;
    await S.saveExtraMap(E.meta.id, id, bytes, type, E.key);
    E.extraMaps = { ...(E.extraMaps || {}), [id]: src };
    added.push({ id, entry: { name: fl.name, template: true, map: { kind: "bitmap", file: fl.name, scale: E.ev.map.scale, dpi: 0, w: src.pxW * tp.u, h: src.pxH * tp.v }, tf: templateTf(E.ev, tp, src.pxW, src.pxH) } });
  }
  E.change((x) => {
    x.maps = x.maps || {};
    for (const a of added) x.maps[a.id] = a.entry;
    for (const [id] of kept) if (x.maps[id]) { if (v[`s${id}`]) delete x.maps[id].hidden; else x.maps[id].hidden = true; }
    if (!Object.keys(x.maps).length) delete x.maps;
  }, t("trc.mv.tplUndo"));
}
