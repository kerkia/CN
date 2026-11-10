// A control description symbol drawn as SVG (Purple Pen's symbols, tracer/symbols.js), as « Définitions de postes » and the
// learning test (« Apprendre › Test ») show it: a square cell, or a row of eight for a special instruction, with the text a
// sheet prints in its place (column F's sizes, the instructions' distances: the specification's own examples).

import { raw } from "./util.js";
import { symbolPaths } from "./tracer/symbols.js";
import { iscdRef } from "./iscd.js";

// what a sheet prints as text in a symbol's place; « a/b » on a diagonal (height on slope), « a|b » one over the other
const PRINTED = { "9.1": "2.5", "9.2": "8 × 4", "9.3": "0.5/3", "9.4": "2|3", "14.1": "150 m", "15.1": "60 m", "15.2": "300 m",
  "15.5": "50 m", "16.1": "400 m", "16.2": "150 m", "16.3": "380 m" };

/** A symbol (tracer/symbols.js `symbol(id)`) drawn as SVG, `size` px high. */
export function cdSymbolSvg(s, size = 56, cls = "cd-sym") {
  const wide = s.k >= "T";
  const w = wide ? size * 8 : size, h = size;
  const d = (cmds) => cmds.map(([c, ...n]) => c + n.map((v) => +v.toFixed(2)).join(" ")).join("");
  const parts = symbolPaths(s, 0, 0, w, h).map((p) => (p.fill ? `<path d="${d(p.d)}" fill="currentColor"/>`
    : `<path d="${d(p.d)}" fill="none" stroke="currentColor" stroke-width="${Math.max(0.6, p.stroke).toFixed(2)}" stroke-linecap="${p.cap}" stroke-linejoin="${p.join}"/>`));
  // the text a sheet prints there (descr.js places it so: column F's box, or columns D-E of an instruction's line)
  const said = PRINTED[iscdRef(s.id)?.ref];
  if (said) {
    const tx = (x, y, v, fs) => `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-family="Arial, Helvetica, sans-serif" font-weight="600">${v}</text>`;
    const cx = w / 2;
    if (said.includes("/")) { const [a, b2] = said.split("/"); parts.push(`<path d="M${w},0L0,${h}" stroke="currentColor" stroke-width="1"/>`, tx(w * 0.3, h * 0.27, a, h * 0.3), tx(w * 0.7, h * 0.73, b2, h * 0.3)); }
    else if (said.includes("|")) { const [a, b2] = said.split("|"); parts.push(tx(cx, h * 0.27, a, h * 0.34), tx(cx, h * 0.73, b2, h * 0.34)); }
    else parts.push(tx(cx, h / 2, said, wide ? h * 0.42 : h * (said.length > 3 ? 0.3 : 0.4)));
  }
  return raw(`<svg class="${cls}${wide ? " wide" : ""}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${parts.join("")}</svg>`);
}
