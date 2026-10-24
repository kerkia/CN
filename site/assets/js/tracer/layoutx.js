// Page layout objects of the advanced level (owner, 2026-10-24, after Condes's graphics layout): an enlarged section of the map
// (« inset »: a frame on the map showing another part of it, magnified, with the course — a complex start, a busy sprint corner)
// and a mask (a white area hiding the map, with holes where it shows). Their drawing: draw.js (the frame, the mask), the editor
// (editor.js drawInset) and the PDFs (pdf.js onePage) draw the map and the course inside a frame.

import * as M from "./model.js";
import { t } from "./lang.js";

/** The part of the map an inset shows (map mm [l, b, r, t]): its own, else the frame's size at its factor, centred on the frame. */
export function insetSrc(it) {
  if (it.src) return it.src;
  const [l, b, r, tt] = it.box, f = it.factor || 2, w = (r - l) / f, h = (tt - b) / f, cx = (l + r) / 2, cy = (b + tt) / 2;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

/** A new inset in the frame drawn: its factor asked, then the middle of the part to enlarge clicked on the map. */
export async function newInset(E, box) {
  const { modal, field, num } = await import("./dialogs.js");
  const v = await modal(E, { title: t("trc.lx.insetTitle"), body: `${field(t("trc.lx.factor"), '<input name="f" value="2" inputmode="decimal">', t("trc.lx.factorHint"))}` });
  if (!v) { E.setTool("select"); return; }
  const f = Math.max(1.2, Math.min(10, num(v.f) || 2));
  E.help(t("trc.lx.pickCentre"));
  const at = await new Promise((res) => { E.pickOnce = res; E.pickCancel = () => res(null); });
  E.help();
  if (!at) { E.setTool("select"); return; }
  const [l, b, r, tt] = box, w = (r - l) / f, h = (tt - b) / f;
  let id;
  E.change((x) => { id = M.addSpecial(x, "inset", [[l, tt], [r, b]], { factor: f, src: [at[0] - w / 2, at[1] - h / 2, at[0] + w / 2, at[1] + h / 2] }); }, t("trc.lx.inset"));
  E.select({ kind: "special", id });
  E.setTool("select");
}
/** The selected inset: another part of the map shown (its middle clicked), or another factor. */
export async function insetProps(E, id) {
  const { modal, field, num } = await import("./dialogs.js");
  const sp = E.ev.specials[id];
  const v = await modal(E, { title: t("trc.lx.insetTitle"), body: `${field(t("trc.lx.factor"), `<input name="f" value="${sp.factor || 2}" inputmode="decimal">`, t("trc.lx.factorHint"))}
    <label class="tr-check"><input type="checkbox" name="move"> ${t("trc.lx.moveSrc")}</label>` });
  if (!v) return;
  const f = Math.max(1.2, Math.min(10, num(v.f) || 2));
  let at = null;
  if (v.move) { E.help(t("trc.lx.pickCentre")); at = await new Promise((res) => { E.pickOnce = res; E.pickCancel = () => res(null); }); E.help(); }
  E.change((x) => {
    const s = x.specials[id], [l, b, r, tt] = [Math.min(s.pts[0][0], s.pts[1][0]), Math.min(s.pts[0][1], s.pts[1][1]), Math.max(s.pts[0][0], s.pts[1][0]), Math.max(s.pts[0][1], s.pts[1][1])];
    const src = s.src || insetSrc({ box: [l, b, r, tt], factor: s.factor });
    const c = at || [(src[0] + src[2]) / 2, (src[1] + src[3]) / 2], w = (r - l) / f, h = (tt - b) / f;
    s.factor = f; s.src = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2];
  }, t("trc.lx.inset"));
}
/** A hole in the selected mask: its corners clicked, Entrée (or a double-click) to end. */
export function maskHole(E, id) {
  E.setTool(`special:mask`);
  E.pending = { kind: "mask-hole", mask: id, pts: [] };
  E.help(t("trc.lx.holeHelp"));
}
