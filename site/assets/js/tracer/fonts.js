// The Tracer's fonts, as Purple Pen uses them: Roboto (control numbers by default, column A, F) and Roboto Condensed
// (description sheet titles, column B, directives, texts, control codes), from the fontsource packages on jsdelivr
// (Apache 2.0 / OFL), with fontkit (MIT) to read them: their own advance widths place the labels, the screen draws with them
// (FontFace), and the PDFs embed them (subset). Text objects may name any font, as in Purple Pen: Arial (and the other sans
// serif faces) is printed in Helvetica, Times New Roman (and the serif faces) in Times, Courier New (and the fixed-width
// faces) in Courier — the PDF standard fonts, whose widths are those faces' —, the rest in Roboto; each in its bold, italic
// and bold italic.
// fontsource splits a font into character subsets (latin, latin-ext, cyrillic, greek, vietnamese…), each with its unicode
// range in the package's CSS (owner, 2026-10-15: description sheets in every language of Purple Pen's symbol file): only the
// basic Latin subsets load with the editor; the others load when a text needs them (Czech, Hungarian, Bulgarian…), and the
// Chinese and Japanese characters, which Roboto lacks, come from Noto Sans JP, TC or HK (by the event's language), loaded the
// same way. A text is measured, drawn and printed run by run, each run in the subset that holds its characters.
// Without the network the Tracer falls back to Helvetica's widths and, for the condensed font, Purple Pen's own fallback sizes
// (its « Arial » heights).

const CDN = "https://cdn.jsdelivr.net/npm/@fontsource";
const PKG = {
  Roboto: `${CDN}/roboto@5.0.8`, "Roboto Condensed": `${CDN}/roboto-condensed@5.0.8`,
  "Noto Sans JP": `${CDN}/noto-sans-jp@5.0.19`, "Noto Sans TC": `${CDN}/noto-sans-tc@5.0.19`, "Noto Sans HK": `${CDN}/noto-sans-hk@5.0.19`,
};
export const FONT_CSS = ["Roboto", "Roboto Condensed"].flatMap((f) => ["400", "700"].map((w) => `${PKG[f]}/${w}.css`));
export const FONTKIT = "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js";
const CJK = { ja: "Noto Sans JP", "zh-TW": "Noto Sans TC", "zh-HK": "Noto Sans HK" };
let cjk = "Noto Sans JP";
/** The event's language chooses the Chinese or Japanese font (the same characters are drawn differently). */
export function setLanguage(lang) { cjk = CJK[lang] || "Noto Sans JP"; }

// the PDF standard fonts' advance widths (1/1000 em) for printable ASCII, as pdf-lib gives them (Helvetica = Arial's)
const N = (s) => s.split(",").map(Number);
const STDW = {
  Helvetica: N("278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584"),
  HelveticaBold: N("278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584"),
  TimesRoman: N("250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541"),
  TimesRomanBold: N("250,333,555,500,500,1000,833,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,930,722,667,722,722,667,611,778,778,389,500,778,667,944,722,778,611,778,722,556,667,722,722,1000,722,722,667,333,278,333,581,500,333,500,556,444,556,444,333,500,556,278,333,556,278,833,556,500,556,556,444,389,333,556,500,722,500,500,444,394,220,394,520"),
  TimesRomanItalic: N("250,333,420,500,500,833,778,214,333,333,500,675,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,675,675,675,500,920,611,611,667,722,611,611,722,722,333,444,667,556,833,667,722,611,722,611,500,556,722,611,833,611,556,556,389,278,389,422,500,333,500,500,444,500,444,278,500,500,278,278,444,278,722,500,500,500,500,389,389,278,500,444,667,444,444,389,400,275,400,541"),
  TimesRomanBoldItalic: N("250,389,555,500,500,833,778,278,333,333,500,570,250,333,250,278,500,500,500,500,500,500,500,500,500,500,333,333,570,570,570,500,832,667,667,667,722,667,667,722,778,389,500,667,611,889,722,722,611,722,667,556,611,722,667,889,667,611,611,333,278,333,570,500,333,500,500,444,500,444,333,500,556,278,278,500,278,778,556,500,500,500,389,389,278,556,444,667,500,444,389,348,220,348,570"),
};
/** The standard font a family prints with (pdf-lib's StandardFonts names), or null for the embedded families. */
export function stdName(fam, bold, italic) {
  const k = (bold ? 1 : 0) + (italic ? 2 : 0);
  if (fam === "Arial") return ["Helvetica", "HelveticaBold", "HelveticaOblique", "HelveticaBoldOblique"][k];
  if (fam === "Times") return ["TimesRoman", "TimesRomanBold", "TimesRomanItalic", "TimesRomanBoldItalic"][k];
  if (fam === "Courier") return ["Courier", "CourierBold", "CourierOblique", "CourierBoldOblique"][k];
  return null;
}
// what WinAnsi (the standard fonts' encoding) can print
const CP1252 = new Set([0x20ac, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x17d, 0x2018, 0x2019,
  0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x17e, 0x178]);
export const inWinAnsi = (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252.has(cp);
const base = (ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
function stdWidth(name, ch) {
  if (name.startsWith("Courier")) return 600;
  const W = STDW[name.replace("Oblique", "")] || STDW.Helvetica;
  let c = ch.charCodeAt(0);
  if (c < 32 || c > 126) {
    if (ch === "×") return W === STDW.Helvetica || W === STDW.HelveticaBold ? 584 : 564;
    if (ch === "–") return W[16];                           // as wide as a digit
    if (ch === "—" || ch === "…" || ch === "‰") return 1000;
    if (ch === "œ" || ch === "Œ") return ch === "œ" ? 944 : 1000;
    if (ch === "«" || ch === "»") return W[16];
    if (ch === "’" || ch === "‘") return W[7] + 31;
    if (ch === "€") return W[16];
    c = base(ch).charCodeAt(0);
    if (!(c >= 32 && c <= 126)) c = 110;                      // an unknown sign: as wide as « n »
  }
  return W[c - 32];
}
export const CAP_HEIGHT = 0.718, ASCENT = 0.718, DESCENT = 0.207;

/** The family a font name stands for here: Roboto, Roboto Condensed, Arial (→ Helvetica), Times or Courier. */
export function family(name, condensed = false) {
  const n = String(name || "");
  if (condensed || /condensed|narrow/i.test(n)) return "Roboto Condensed";
  if (/roboto/i.test(n)) return "Roboto";
  if (/courier|mono|consolas|lucida console|fixedsys/i.test(n)) return "Courier";
  if (/times|serif|georgia|garamond|cambria|palatino|book antiqua|century|bookman|baskerville|tinos|minion/i.test(n) && !/sans/i.test(n)) return "Times";
  if (/arial|helvetica|arimo|liberation|sans|verdana|tahoma|calibri|segoe|trebuchet|frutiger|univers|futura|gill/i.test(n)) return "Arial";
  return "Roboto";
}
/** What a text object's font prints as, for the dialog. */
export const FAMILY_LABEL = { Roboto: "Roboto", "Roboto Condensed": "Roboto Condensed", Arial: "Helvetica (Arial)", Times: "Times", Courier: "Courier" };
/** The CSS font-family for the screen: the loaded faces first. */
export function cssFamily(fam) {
  const c = `"OCN ${cjk}"`;
  if (fam === "Roboto Condensed") return `"OCN Roboto Condensed", ${c}, "Arial Narrow", Arial, Helvetica, sans-serif`;
  if (fam === "Arial") return `Arial, Helvetica, "OCN Roboto", ${c}, sans-serif`;
  if (fam === "Times") return `"Times New Roman", Times, "Liberation Serif", "OCN Roboto", ${c}, serif`;
  if (fam === "Courier") return `"Courier New", Courier, "Liberation Mono", "OCN Roboto", ${c}, monospace`;
  return `"OCN Roboto", ${c}, Roboto, Arial, sans-serif`;
}

// ---- the subsets: the package's CSS read once per face, a subset's file read when a character needs it ---------------------
const FACES = new Map();               // "family|r", "family|b", "family|ri", "family|bi" -> { ready, parsed, chunks, index }
const key = (fam, bold, italic) => `${fam}|${bold ? "b" : "r"}${italic ? "i" : ""}`;
function parseRanges(s) {
  return s.split(",").map((x) => x.trim().replace(/^U\+/i, "")).filter(Boolean).map((x) => {
    const [a, b] = x.split("-"); return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
}
function face(k) {
  let f = FACES.get(k);
  if (f) return f.ready;
  const [fam, st] = k.split("|");
  f = { parsed: false, chunks: [], index: new Map() };
  FACES.set(k, f);
  const css = `${PKG[fam]}/${st.includes("b") ? "700" : "400"}${st.includes("i") ? "-italic" : ""}.css`;
  f.ready = fetch(css).then((r) => (r.ok ? r.text() : Promise.reject(new Error(css)))).then((text) => {
    for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const url = /url\(\.\/(files\/[^)]+?\.woff)\)\s*format\('woff'\)/.exec(m[1]), ur = /unicode-range:\s*([^;]+);/.exec(m[1]);
      if (!url) continue;
      const ranges = ur ? parseRanges(ur[1]) : [[0x20, 0x24f]];
      const i = f.chunks.push({ url: `${PKG[fam]}/${url[1]}`, ranges, range: ur ? ur[1].trim() : "U+0020-024F" }) - 1;
      for (const [a, b] of ranges) for (let cp = a; cp <= b; cp++) if (!f.index.has(cp)) f.index.set(cp, i);
    }
    f.parsed = true;
    return f;
  }).catch((e) => { FACES.delete(k); throw e; });
  return f.ready;
}
function script(src) {
  return new Promise((res, rej) => {
    const old = document.querySelector(`script[src="${src}"]`);
    if (old) { if (window.fontkit) res(); else { old.addEventListener("load", res); old.addEventListener("error", () => rej(new Error(src))); } return; }
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s);
  });
}
let fontkitP = null;
const fontkitReady = () => (fontkitP ||= script(FONTKIT).catch((e) => { fontkitP = null; throw e; }));
function loadChunk(k, i) {
  const f = FACES.get(k), c = f.chunks[i];
  if (!c.p) c.p = (async () => {
    await fontkitReady();
    const bytes = new Uint8Array(await (await fetch(c.url)).arrayBuffer());
    const font = window.fontkit.create(bytes), widths = new Map(), u = 1000 / font.unitsPerEm;
    for (const [a, b] of c.ranges) for (let cp = a; cp <= b; cp++) { const g = font.glyphForCodePoint(cp); if (g && g.id) widths.set(cp, g.advanceWidth * u); }
    c.data = { bytes, widths };
    const [fam, st] = k.split("|");
    try {
      const ff = new FontFace(`OCN ${fam}`, bytes, { weight: st.includes("b") ? "700" : "400", style: st.includes("i") ? "italic" : "normal", unicodeRange: c.range });
      await ff.load(); document.fonts.add(ff);
    } catch (e) { /* the screen keeps its fallback */ }
  })().catch((e) => { c.failed = true; throw e; });
  return c.p;
}
// characters measured before their subset was there: loaded together, then the editor lays out again (« tr-fonts »)
const WANT = new Set(), FAILED = new Map();             // a face whose CSS could not be read is not asked again for a minute
let wantTimer = null;
function want(k, i) {
  if (typeof document === "undefined") return;                // outside a browser (tests): the static widths only
  WANT.add(`${k}#${i}`);
  if (wantTimer) return;
  wantTimer = setTimeout(async () => {
    wantTimer = null;
    const list = [...WANT]; WANT.clear();
    const res = await Promise.allSettled(list.map(async (x) => {
      const [kk, ii] = x.split("#");
      if (Date.now() - (FAILED.get(kk) || 0) < 60000) throw new Error("offline");
      try { await face(kk); } catch (e) { FAILED.set(kk, Date.now()); throw e; }
      if (+ii >= 0) await loadChunk(kk, +ii);
    }));
    if (res.some((r) => r.status === "fulfilled") && typeof window !== "undefined") window.dispatchEvent(new Event("tr-fonts"));
  }, 0);
}
/** A character's width (1/1000 em) in a face: a number, null when the face lacks it, undefined when not known yet. */
function chunkWidth(k, cp) {
  const f = FACES.get(k);
  if (!f) { want(k, -1); return undefined; }
  if (!f.parsed) return undefined;
  const i = f.index.get(cp);
  if (i === undefined) return null;
  const c = f.chunks[i];
  if (c.data) return c.data.widths.get(cp) ?? null;
  if (!c.failed) want(k, i);
  return undefined;
}
const LATIN = ["Roboto|r", "Roboto|b", "Roboto Condensed|r", "Roboto Condensed|b"];
const latinIn = (k) => { const f = FACES.get(k); const i = f?.parsed ? f.index.get(65) : undefined; return i !== undefined && !!f.chunks[i].data; };
export const fontsReady = () => LATIN.every(latinIn);

/** Load the base fonts once (resolves false after `timeout` ms without them: the Helvetica widths stay). */
let loading = null;
export function loadFonts(timeout = 6000) {
  if (!loading) loading = (async () => {
    await fontkitReady();
    await Promise.allSettled(LATIN.map(async (k) => { const f = await face(k); await loadChunk(k, f.index.get(65)); }));
    return fontsReady();
  })().catch(() => { loading = null; return false; });
  return Promise.race([loading, new Promise((r) => setTimeout(() => r(false), timeout))]);
}

/**
 * The runs of a text, each with the face that prints it: { std } (a standard font's name) or { key, chunk } (a subset), its
 * text and its width in em. A standard family prints what WinAnsi holds and hands the rest to Roboto.
 */
export function textRuns(text, bold = false, fam = "Roboto", italic = false) {
  const runs = [];
  const std = stdName(fam, bold, italic), prim = std ? "Roboto" : fam;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    let r;
    if (std && inWinAnsi(cp)) r = { std, w: stdWidth(std, ch) };
    else {
      const it = italic && !std;
      for (const k of it ? [key(prim, bold, true), key(prim, bold, false)] : [key(prim, bold, false)]) {
        const w = chunkWidth(k, cp);
        if (typeof w === "number") { r = { key: k, chunk: FACES.get(k).index.get(cp), w }; break; }
        if (w === undefined && !r) r = { pending: true };
      }
      if (!r || r.pending) {
        const k = key(cjk, bold, false), w = cp >= 0x2e80 ? chunkWidth(k, cp) : null;
        if (typeof w === "number") r = { key: k, chunk: FACES.get(k).index.get(cp), w };
        else r = { std: bold ? "HelveticaBold" : "Helvetica", w: cp >= 0x2e80 ? 1000 : stdWidth("Helvetica", ch), missing: true };
      }
    }
    const last = runs[runs.length - 1];
    if (last && last.std === r.std && last.key === r.key && last.chunk === r.chunk && !!last.missing === !!r.missing) { last.text += ch; last.w += r.w; }
    else runs.push({ ...r, text: ch });
  }
  for (const x of runs) x.w /= 1000;
  return runs;
}
/** A subset's file, for a PDF to embed (null before it is loaded). */
export function chunkFile(k, i) { const c = FACES.get(k)?.chunks[i]; return c?.data ? { url: c.url, bytes: c.data.bytes } : null; }

/** Width of a text in em units (multiply by the font size). */
export function textWidth(text, bold = false, fam = "Roboto", italic = false) {
  let w = 0;
  for (const r of textRuns(text, bold, fam, italic)) w += r.w;
  return w;
}
/** Load the subsets these texts need, in the families the sheets and texts use; true when something new came in. */
export async function ensureText(strings, { italic = false, families = ["Roboto", "Roboto Condensed"] } = {}) {
  const cps = new Set();
  for (const s of strings) for (const ch of String(s ?? "")) { const cp = ch.codePointAt(0); if (cp > 0x7e) cps.add(cp); }
  if (!cps.size) return false;
  let fresh = false;
  const keys = families.flatMap((f) => [key(f, false, false), key(f, true, false), ...(italic ? [key(f, false, true), key(f, true, true)] : [])]);
  const cjkCps = [...cps].filter((cp) => cp >= 0x2e80);
  await Promise.allSettled([...keys, ...(cjkCps.length ? [key(cjk, false, false), key(cjk, true, false)] : [])].map(async (k) => {
    const f = await face(k), todo = new Set();
    for (const cp of k.startsWith(cjk) ? cjkCps : cps) { const i = f.index.get(cp); if (i !== undefined && !f.chunks[i].data && !f.chunks[i].failed) todo.add(i); }
    if (todo.size) { fresh = true; await Promise.allSettled([...todo].map((i) => loadChunk(k, i))); }
  }));
  return fresh;
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
