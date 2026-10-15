// The Tracer's fonts, as Purple Pen uses them: Roboto (control numbers by default, column A, F) and Roboto Condensed
// (description sheet titles, column B, directives, texts, control codes), from the fontsource packages on jsdelivr
// (Apache 2.0 / OFL), with fontkit (MIT) to read them: their own advance widths place the labels, the screen draws with them
// (FontFace), and the PDFs embed them (subset). Numbers set in Arial use Helvetica, the PDF standard font, whose widths are
// Arial's. Without the network the Tracer falls back to Helvetica's widths and, for the condensed font, Purple Pen's own
// fallback sizes (its « Arial » heights).

const CDN = "https://cdn.jsdelivr.net/npm/@fontsource";
const FILES = {
  Roboto: { r: `${CDN}/roboto@5.0.8/files/roboto-latin-400-normal.woff`, b: `${CDN}/roboto@5.0.8/files/roboto-latin-700-normal.woff` },
  "Roboto Condensed": { r: `${CDN}/roboto-condensed@5.0.8/files/roboto-condensed-latin-400-normal.woff`, b: `${CDN}/roboto-condensed@5.0.8/files/roboto-condensed-latin-700-normal.woff` },
};
export const FONTKIT = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";

// Helvetica's advance widths (1/1000 em) for printable ASCII: the fallback
const REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611,
  389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
export const CAP_HEIGHT = 0.718, ASCENT = 0.718, DESCENT = 0.207;
const base = (ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "");

const LOADED = {};                                            // "family|r" or "family|b" -> { bytes, widths: Map(code point -> 1/1000 em) }
let loading = null;
/** The family a font name stands for here. */
export const family = (name, condensed = false) => (condensed || /condensed|narrow/i.test(name || "") ? "Roboto Condensed"
  : /arial|helvetica|arimo|liberation|sans serif$/i.test(name || "") ? "Arial" : "Roboto");
export const fontsReady = () => Object.keys(LOADED).length === 4;
/** The CSS font-family for the screen: the loaded face first. */
export const cssFamily = (fam) => (fam === "Roboto Condensed" ? '"OCN Roboto Condensed", Arial, Helvetica, sans-serif'
  : fam === "Arial" ? "Arial, Helvetica, sans-serif" : '"OCN Roboto", Roboto, Arial, sans-serif');
/** A font's bytes, for a PDF to embed (null before loading or without the network). */
export const fontBytes = (fam, bold) => LOADED[`${fam}|${bold ? "b" : "r"}`]?.bytes || null;

function script(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { if (window.fontkit) res(); else document.querySelector(`script[src="${src}"]`).addEventListener("load", res); return; }
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s);
  });
}
/** Load the fonts once (resolves false after `timeout` ms without them: the Helvetica widths stay). */
export function loadFonts(timeout = 6000) {
  if (!loading) loading = (async () => {
    await script(FONTKIT);
    const fk = window.fontkit;
    await Promise.allSettled(Object.entries(FILES).flatMap(([fam, f]) => ["r", "b"].map(async (w) => {
      const bytes = new Uint8Array(await (await fetch(f[w])).arrayBuffer());
      const font = fk.create(bytes), widths = new Map(), k = 1000 / font.unitsPerEm;
      const take = (cp) => { const g = font.glyphForCodePoint(cp); if (g && g.id) widths.set(cp, g.advanceWidth * k); };
      for (let cp = 32; cp < 0x180; cp++) take(cp);
      for (const cp of [0x152, 0x153, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac, 0x2212, 0xd7]) take(cp);
      LOADED[`${fam}|${w}`] = { bytes, widths };
      try { const ff = new FontFace(`OCN ${fam}`, bytes, { weight: w === "b" ? "700" : "400" }); await ff.load(); document.fonts.add(ff); } catch (e) { /* the screen keeps its fallback */ }
    })));
    return fontsReady();
  })().catch(() => { loading = null; return false; });
  return Promise.race([loading, new Promise((r) => setTimeout(() => r(false), timeout))]);
}

/** Width of a text in em units (multiply by the font size). */
export function textWidth(text, bold = false, fam = "Roboto") {
  const m = LOADED[`${fam}|${bold ? "b" : "r"}`]?.widths;
  let w = 0;
  if (m) {
    for (const ch of String(text)) { const cp = ch.codePointAt(0); w += m.get(cp) ?? m.get(base(ch).codePointAt(0)) ?? m.get(110) ?? 500; }
    return w / 1000;
  }
  const W = bold ? BOLD : REG;
  for (const ch of String(text)) {
    let c = ch.charCodeAt(0);
    if (c < 32 || c > 126) {
      if (ch === "×") { w += 584; continue; }
      if (ch === "–" || ch === "—") { w += ch === "–" ? 556 : 1000; continue; }
      if (ch === "œ" || ch === "Œ") { w += ch === "œ" ? 944 : 1000; continue; }
      if (ch === "«" || ch === "»") { w += 556; continue; }
      if (ch === "’") { w += 222; continue; }
      c = base(ch).charCodeAt(0);
      if (!(c >= 32 && c <= 126)) c = 110;           // an unknown sign: as wide as « n »
    }
    w += W[c - 32];
  }
  return w / 1000;
}
/** Break a text into lines of at most `width` (em units × size). */
export function wrapText(text, size, width, bold = false, fam = "Roboto") {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (!line || textWidth(tryLine, bold, fam) * size <= width) line = tryLine;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}
