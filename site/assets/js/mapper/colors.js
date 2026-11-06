// Cartographier's colours and their printing (owner, 2026-11-06): the colour table — from the top of the printing order down,
// each colour's name, CMYK, overprint and the spot inks it is printed with (OCAD's « séparations » : `s<ink>` / `p<percent>`
// pairs in its colour string, the inks themselves in parameter strings of type 10: name, CMYK, screen frequency and angle) — and
// the colour separations a printer asks for:
// - a composite PDF where each colour printed with spot inks is painted in them (a PDF « Separation » colour space for one ink,
//   « DeviceN » for several, their CMYK for the screen), the colours without inks in CMYK;
// - one page per printing plate (each spot ink, or C, M, Y and K for process printing), in black at the colour's percentage,
//   a colour above that the plate does not print knocking out what is under it unless it overprints, with registration marks
//   and the plate's name — what OCAD's « séparations » print.
// The document: `doc.spots` [{ num, name, cmyk (0..1), freq, angle, visible }], each colour's `spot` [{ name, pct (0..1) }].

import { modal, field, num } from "../tracer/dialogs.js";
import { svg } from "../tracer/icons.js";
import { drawRect } from "./view.js";
import { t, tn } from "./lang.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (v) => Math.round(v * 1000) / 10;
const css = (cmyk) => { const [C, M, Y, K] = cmyk || [0, 0, 0, 0]; return `rgb(${Math.round(255 * (1 - C) * (1 - K))},${Math.round(255 * (1 - M) * (1 - K))},${Math.round(255 * (1 - Y) * (1 - K))})`; };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- reading OCAD's spot inks ------------------------------------------------------------------------------------------------
/** The spot inks and each colour's share of them, from OCAD's parameter strings (types 9 and 10). */
export function spotsFromParams(doc) {
  const spots = [];
  for (const p of doc.params || []) {
    if (p.type !== 10) continue;
    const parts = String(p.str || "").split("\t"), code = (c) => parts.find((x) => x[0] === c)?.slice(1);
    spots.push({ num: Number(code("n")) || spots.length, name: parts[0], cmyk: ["c", "m", "y", "k"].map((c) => (Number(code(c)) || 0) / 100),
      freq: Number(code("f")) || 0, angle: Number(code("a")) || 0, visible: code("v") !== "0" });
  }
  const byNum = new Map();
  for (const p of doc.params || []) {
    if (p.type !== 9) continue;
    const parts = String(p.str || "").split("\t"), n = Number(parts.find((x) => x[0] === "n")?.slice(1));
    const list = [];
    for (let i = 1; i < parts.length; i++) if (parts[i][0] === "s") {
      const next = parts[i + 1];
      list.push({ name: parts[i].slice(1), pct: next?.[0] === "p" ? (Number(next.slice(1)) || 0) / 100 : 1 });
    }
    if (Number.isFinite(n)) byNum.set(n, list);
  }
  for (const c of doc.colors || []) if (byNum.has(c.num)) c.spot = byNum.get(c.num);
  doc.spots = spots;
  return doc;
}

// ---- the colour table, edited --------------------------------------------------------------------------------------------------
export async function editColors(E) {
  let cols = clone(E.doc.colors), spots = clone(E.doc.spots || []);
  const row = (c, i) => `<tr data-i="${i}"><td><i class="mp-sw" style="background:${css(c.cmyk)}"></i></td>
    <td><input name="n${i}" value="${esc(c.name)}" maxlength="60" aria-label="${esc(t("map.col.name"))}"></td>
    ${[0, 1, 2, 3].map((k) => `<td><input name="c${i}_${k}" type="number" min="0" max="100" step="0.5" value="${pct(c.cmyk[k])}" class="mp-num" aria-label="${"CMYK"[k]}"></td>`).join("")}
    <td><input type="checkbox" name="o${i}" ${c.overprint ? "checked" : ""} aria-label="${esc(t("map.col.overprint"))}"></td>
    <td><input name="s${i}" value="${esc((c.spot || []).map((s) => `${s.name} ${pct(s.pct)}`).join(", "))}" placeholder="${esc(t("map.col.spotPh"))}" aria-label="${esc(t("map.col.spots"))}"></td>
    <td class="mp-nowrap"><button type="button" class="tr-icon" data-up="${i}" title="${esc(t("map.col.up"))}">▲</button><button type="button" class="tr-icon" data-down="${i}" title="${esc(t("map.col.down"))}">▼</button>
    <button type="button" class="tr-icon" data-del="${i}" title="${esc(t("map.col.delete"))}">${svg("trash", 14)}</button></td></tr>`;
  const spotRow = (s, i) => `<tr><td><i class="mp-sw" style="background:${css(s.cmyk)}"></i></td><td><input name="sn${i}" value="${esc(s.name)}" maxlength="40"></td>
    ${[0, 1, 2, 3].map((k) => `<td><input name="sc${i}_${k}" type="number" min="0" max="100" step="0.5" value="${pct(s.cmyk[k])}" class="mp-num"></td>`).join("")}
    <td><input name="sf${i}" type="number" min="0" step="1" value="${s.freq || ""}" class="mp-num"></td><td><input name="sa${i}" type="number" step="0.5" value="${s.angle || 0}" class="mp-num"></td>
    <td><button type="button" class="tr-icon" data-sdel="${i}" title="${esc(t("map.col.delete"))}">${svg("trash", 14)}</button></td></tr>`;
  // the table is shown from the top of the printing order down; `cols` is bottom → top
  const body = () => `<p class="mp-hint">${esc(t("map.col.hint"))}</p>
    <div class="table-wrap"><table class="data mp-coltable"><thead><tr><th></th><th>${esc(t("map.col.name"))}</th><th>C</th><th>M</th><th>J</th><th>N</th><th>${esc(t("map.col.op"))}</th><th>${esc(t("map.col.spots"))}</th><th></th></tr></thead>
    <tbody>${cols.map((c, i) => [c, i]).reverse().map(([c, i]) => row(c, i)).join("")}</tbody></table></div>
    <button type="button" class="btn btn-sm" data-add>${esc(t("map.col.add"))}</button>
    <h3>${esc(t("map.col.inks"))}</h3><p class="mp-hint">${esc(t("map.col.inksHint"))}</p>
    <div class="table-wrap"><table class="data mp-coltable"><thead><tr><th></th><th>${esc(t("map.col.name"))}</th><th>C</th><th>M</th><th>J</th><th>N</th><th>${esc(t("map.col.freq"))}</th><th>${esc(t("map.col.angle"))}</th><th></th></tr></thead>
    <tbody>${spots.map(spotRow).join("")}</tbody></table></div><button type="button" class="btn btn-sm" data-sadd>${esc(t("map.col.addInk"))}</button>`;
  const used = new Set();
  for (const s of E.doc.symbols) for (const v of Object.values(JSON.parse(JSON.stringify(s)))) void v;
  const read = (form) => {
    cols = cols.map((c, i) => {
      if (!form.elements[`n${i}`]) return c;
      const spot = String(form.elements[`s${i}`].value || "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(.*?)\s+([\d.,]+)\s*%?$/.exec(x); return m ? { name: m[1].trim(), pct: Math.min(1, (num(m[2]) || 0) / 100) } : { name: x, pct: 1 }; });
      return { ...c, name: form.elements[`n${i}`].value.trim() || c.name, cmyk: [0, 1, 2, 3].map((k) => Math.min(1, Math.max(0, (num(form.elements[`c${i}_${k}`].value) || 0) / 100))),
        overprint: form.elements[`o${i}`].checked, spot };
    });
    spots = spots.map((s, i) => (!form.elements[`sn${i}`] ? s : { ...s, name: form.elements[`sn${i}`].value.trim() || s.name, cmyk: [0, 1, 2, 3].map((k) => Math.min(1, Math.max(0, (num(form.elements[`sc${i}_${k}`].value) || 0) / 100))),
      freq: num(form.elements[`sf${i}`].value) || 0, angle: num(form.elements[`sa${i}`].value) || 0 }));
  };
  void used;
  const v = await modal(E, { title: t("map.rib.colors"), wide: true, ok: t("map.dlg.save"), body: `<div id="mp-colbody">${body()}</div>`,
    onOpen: (form) => form.addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      read(form);
      const i = Number(b.dataset.up ?? b.dataset.down ?? b.dataset.del ?? b.dataset.sdel);
      if (b.dataset.up != null && i < cols.length - 1) [cols[i], cols[i + 1]] = [cols[i + 1], cols[i]];
      else if (b.dataset.down != null && i > 0) [cols[i], cols[i - 1]] = [cols[i - 1], cols[i]];
      else if (b.dataset.del != null) {
        const n = cols[i].num;
        if (colourUsed(E, n)) { E.say(t("map.col.inUse"), "bad"); return; }
        cols.splice(i, 1);
      } else if (b.dataset.add != null) cols.push({ num: Math.max(0, ...cols.map((c) => c.num)) + 1, name: t("map.col.new"), cmyk: [0, 0, 0, 1], overprint: false, spot: [] });
      else if (b.dataset.sdel != null) spots.splice(i, 1);
      else if (b.dataset.sadd != null) spots.push({ num: Math.max(-1, ...spots.map((s) => s.num)) + 1, name: t("map.col.newInk"), cmyk: [0, 0, 0, 1], freq: 0, angle: 45, visible: true });
      else return;
      form.querySelector("#mp-colbody").innerHTML = body();
    }),
    validate: (x, form) => { read(form); return null; } });
  if (!v) return;
  E.live.transact(t("map.undo.colors"), () => {
    E.live.setColors(cols);
    E.live.setDocField("spots", spots);
    E.doc.dirty = { ...(E.doc.dirty || {}), colors: true, spots: true };
  });
  E.view.setLive(E.live);
  const P = await import("./panels.js"); P.drawRight(E); P.drawLeft(E);
}
/** Whether a colour number is used by a symbol or a graphics object. */
export function colourUsed(E, n) {
  const KEYS = /(^|[a-z])Color$|^color$|^col$/;
  let hit = false;
  const walk = (o) => { if (hit || !o || typeof o !== "object") return; for (const [k, v] of Object.entries(o)) { if (typeof v === "number" && KEYS.test(k) && v === n) { hit = true; return; } if (typeof v === "object") walk(v); } };
  for (const s of E.doc.symbols) walk(s);
  for (const o of E.doc.objects) if (o.sym < 0 && o.col === n) return true;
  return hit;
}

// ---- printing: composite with spot inks, or one page per plate -------------------------------------------------------------------
/** The plates: each spot ink (when the map has them), else C, M, Y, K. Each { name, share(colour) → 0..1, cmyk (preview) }. */
export function plates(doc, { process = false } = {}) {
  if (!process && (doc.spots || []).length) return doc.spots.filter((s) => s.visible !== false).map((s) => ({ name: s.name, angle: s.angle, freq: s.freq,
    share: (c) => (c.spot || []).find((x) => x.name === s.name)?.pct || 0 }));
  return ["C", "M", "Y", "K"].map((name, k) => ({ name, share: (c) => c.cmyk?.[k] || 0 }));
}
/** A colour printed with exactly one ink (its share as the tint), or null. */
const singleInk = (c) => (c.spot?.length === 1 ? c.spot[0] : null);

/** The separation dialog and PDF: composite with Separation colour spaces, or plates. */
export async function separationsPdf(E, area, base) {
  const hasSpots = (E.doc.spots || []).length > 0;
  const v = await modal(E, { title: t("map.sep.title"), body: `<fieldset class="mp-choice"><legend>${esc(t("map.sep.what"))}</legend>
      <label><input type="radio" name="m" value="composite" ${hasSpots ? "checked" : "disabled"}> ${esc(t("map.sep.composite"))}</label>
      <label><input type="radio" name="m" value="spot" ${hasSpots ? "" : "disabled"}> ${esc(t("map.sep.spotPlates"))}</label>
      <label><input type="radio" name="m" value="process" ${hasSpots ? "" : "checked"}> ${esc(t("map.sep.processPlates"))}</label></fieldset>
      ${hasSpots ? "" : `<p class="mp-hint">${esc(t("map.sep.noSpots"))}</p>`}
      <label class="mp-row"><input type="checkbox" name="marks" checked> ${esc(t("map.sep.marks"))}</label>`, remember: "mp-sep" });
  if (!v) return null;
  const { pdfLib, makeFonts } = await import("../tracer/pdf.js");
  const [{ PdfTarget }, { Matrix }] = await Promise.all([import("../tracer/vmap/target.js"), import("../tracer/vmap/geom.js")]);
  const L = await pdfLib(), doc = await L.PDFDocument.create();
  doc.setTitle(`${E.doc.title || ""} — ${t("map.sep.title")}`); doc.setCreator("Ozimut — Cartographier"); doc.setProducer("Ozimut (pdf-lib)");
  const fonts = await makeFonts(doc, L);
  const r = area, pt = 72 / 25.4, M = v.marks ? 15 : 0;              // 15 mm around the map for the marks
  const W = (r[2] - r[0] + 2 * M) * pt, H = (r[3] - r[1] + 2 * M) * pt;
  const map = E.live.map, cols = E.doc.colors;
  const vcol = (c) => map.colorById(c.num);

  if (v.m === "composite") {
    const page = doc.addPage([W, H]);
    // a Separation colour space per ink, its CMYK for the screen
    const res = page.node.Resources(), csDict = doc.context.obj({});
    res.set(L.PDFName.of("ColorSpace"), csDict);
    const csName = new Map();
    (E.doc.spots || []).forEach((s, i) => {
      const fn = doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: s.cmyk, N: 1 });
      const cs = doc.context.obj([L.PDFName.of("Separation"), L.PDFName.of(s.name.replace(/[^\w.-]/g, "_")), L.PDFName.of("DeviceCMYK"), fn]);
      const key = `CS${i}`; csDict.set(L.PDFName.of(key), doc.context.register(cs)); csName.set(s.name, key);
    });
    // a colour printed with several inks (a green screened over yellow…): a DeviceN colour space of those inks, its CMYK for the
    // screen the sum of the inks' CMYK by their tints (a PostScript calculator function, PDF's FunctionType 4)
    const spotByName = new Map((E.doc.spots || []).map((s) => [s.name, s]));
    const deviceN = new Map();
    const deviceNOf = (inks) => {
      const key = inks.map((x) => x.name).join("|");
      if (deviceN.has(key)) return deviceN.get(key);
      const N = inks.length, f = (v) => (Math.round(v * 10000) / 10000).toString();
      let ps = "{";
      for (let j = 0; j < 4; j++) {
        ps += " 0";
        inks.forEach((x, i) => { ps += ` ${j + 1 + (N - 1 - i)} index ${f(spotByName.get(x.name).cmyk[j])} mul add`; });
      }
      ps += ` ${N + 4} 4 roll${" pop".repeat(N)} }`;
      const fn = doc.context.stream(ps, { FunctionType: 4, Domain: Array(N).fill([0, 1]).flat(), Range: [0, 1, 0, 1, 0, 1, 0, 1] });
      const cs = doc.context.obj([L.PDFName.of("DeviceN"), inks.map((x) => L.PDFName.of(x.name.replace(/[^\w.-]/g, "_"))), L.PDFName.of("DeviceCMYK"), doc.context.register(fn)]);
      const name = `DN${deviceN.size}`;
      csDict.set(L.PDFName.of(name), doc.context.register(cs));
      deviceN.set(key, name);
      return name;
    };
    class SpotTarget extends PdfTarget {
      color(c, fill) {
        const rec = cols.find((x) => x.num === c.id), ink = rec && singleInk(rec);
        const op = (name, tints) => this.ops.push(this.L.PDFOperator.of(fill ? "cs" : "CS", [this.L.PDFName.of(name)]), this.L.PDFOperator.of(fill ? "scn" : "SCN", tints.map((v) => this.L.PDFNumber.of(v))));
        if (ink && csName.has(ink.name)) { op(csName.get(ink.name), [ink.pct]); return; }
        const inks = (rec?.spot || []).filter((x) => x.pct > 0 && spotByName.has(x.name));
        if (inks.length > 1) { op(deviceNOf(inks), inks.map((x) => x.pct)); return; }
        if (inks.length === 1) { op(csName.get(inks[0].name), [inks[0].pct]); return; }
        super.color(c, fill);
      }
    }
    let darken = null;
    if (cols.some((c) => c.overprint)) darken = page.node.newExtGState("GSdark", doc.context.register(doc.context.obj({ Type: "ExtGState", OP: true, op: true, OPM: 1 })));
    const tg = new SpotTarget(L, page, new Matrix(pt, 0, 0, pt, (M - r[0]) * pt, (M - r[1]) * pt), { fonts, darken, minRes: 0.01 });
    drawRect(E.live, tg, r, { minRes: 0.01, overprint: true });
    await tg.finish();
    if (M) marks(L, page, W, H, M * pt, E.doc.title || "", t("map.sep.composite"));
  } else {
    // one page per plate, in black at the colour's share; colours the plate does not print knock out what is under them (white)
    // unless they overprint
    for (const plate of plates(E.doc, { process: v.m === "process" })) {
      const page = doc.addPage([W, H]);
      const saved = new Map(), hide = new Set();
      for (const c of cols) {
        const vc = vcol(c); if (!vc) continue;
        saved.set(vc, { cmyk: vc.cmyk, css: vc.css });
        const s = plate.share(c);
        if (s > 0) { vc.cmyk = [0, 0, 0, s]; }
        else if (c.overprint) hide.add(c.num);
        else vc.cmyk = [0, 0, 0, 0];
      }
      try {
        const tg = new PdfTarget(L, page, new Matrix(pt, 0, 0, pt, (M - r[0]) * pt, (M - r[1]) * pt), { fonts, minRes: 0.01 });
        drawRect(E.live, tg, r, { minRes: 0.01, hide });
        await tg.finish();
      } finally { for (const [vc, s] of saved) { vc.cmyk = s.cmyk; vc.css = s.css; } }
      if (M) marks(L, page, W, H, M * pt, E.doc.title || "", `${t("map.sep.plate")} ${plate.name}${plate.angle != null ? ` · ${plate.angle}°` : ""}${plate.freq ? ` · ${plate.freq} lpi` : ""}`);
    }
  }
  return { bytes: await doc.save(), name: `${base}-${v.m === "composite" ? "spot" : v.m === "spot" ? "plates" : "cmyk-plates"}.pdf` };
}
/** Registration marks at the four corners and the plate's name in the margin (in registration black on every plate). */
function marks(L, page, W, H, m, title, label) {
  const ops = [L.pushGraphicsState(), L.setStrokingCmykColor(1, 1, 1, 1), L.setFillingCmykColor(1, 1, 1, 1), L.setLineWidth(0.3)];
  const cross = (x, y) => { const r = m * 0.28; ops.push(L.moveTo(x - r, y), L.lineTo(x + r, y), L.moveTo(x, y - r), L.lineTo(x, y + r), L.stroke());
    const k = 0.5523 * r * 0.6, c = r * 0.6; ops.push(L.moveTo(x + c, y), L.appendBezierCurve(x + c, y + k, x + k, y + c, x, y + c), L.appendBezierCurve(x - k, y + c, x - c, y + k, x - c, y),
      L.appendBezierCurve(x - c, y - k, x - k, y - c, x, y - c), L.appendBezierCurve(x + k, y - c, x + c, y - k, x + c, y), L.stroke()); };
  cross(m / 2, m / 2); cross(W - m / 2, m / 2); cross(m / 2, H - m / 2); cross(W - m / 2, H - m / 2);
  ops.push(L.popGraphicsState());
  page.pushOperators(...ops);
  page.drawText(`${title} — ${label}`.normalize("NFD").replace(/[^\x20-\x7e]/g, ""), { x: m * 1.2, y: m * 0.35, size: 7 });
}
export { tn };
