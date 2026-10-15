// Text measurement for the Tracer's drawings: Helvetica's advance widths (the PDF standard font, metrically Arial's;
// units of 1/1000 em) for printable ASCII, accented letters measured as their base letter. The screen draws in the
// system's sans-serif and the PDF in Helvetica, so a label placed on screen sits where it prints.

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
/** Width of a text in em units (multiply by the font size). */
export function textWidth(text, bold = false) {
  const W = bold ? BOLD : REG;
  let w = 0;
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
export function wrapText(text, size, width, bold = false) {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (!line || textWidth(tryLine, bold) * size <= width) line = tryLine;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}
