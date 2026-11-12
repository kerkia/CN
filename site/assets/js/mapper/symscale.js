// A symbol set's records at a map's scale (from layout.js, 2026-11-12: imported by Pixel's invented maps, games/vgenmap.js,
// without Cartographier's dialogs).

/** A set's symbols at a map's scale: ISOM's 1:15 000 dimensions enlarged 150 % for 1:10 000 (the specification's rule). */
export function scaled(set, scale) {
  const f = set.scale === 15000 && scale <= 10000 ? 1.5 : 1;
  return f === 1 ? set.symbols : set.symbols.map((s) => scaleSymbol(s, f));
}
/** A symbol record with every dimension multiplied by f (line widths, dashes, gaps, patterns, elements, font sizes…). */
export function scaleSymbol(s, f) {
  const L = ["lineWidth", "distFromStart", "distToEnd", "mainLength", "endLength", "mainGap", "secGap", "endGap", "primSymDist", "dblWidth", "dblLeftWidth", "dblRightWidth", "dblLength", "dblGap",
    "frWidth", "hatchLineWidth", "hatchDist", "structWidth", "structHeight", "extent", "fontSize", "lbWidth", "lbDist", "cellWidth", "cellHeight", "radius", "frSize", "frLeft", "frTop", "frRight", "frBottom", "frOfX", "frOfY"];
  const el = (e) => ({ ...e, lineWidth: Math.round((e.lineWidth || 0) * f), diameter: Math.round((e.diameter || 0) * f), coords: (e.coords || []).map((c) => ({ x: ((Math.round((c.x >> 8) * f)) << 8) | (c.x & 0xff), y: ((Math.round((c.y >> 8) * f)) << 8) | (c.y & 0xff) })) });
  const o = JSON.parse(JSON.stringify(s));
  for (const k of L) if (typeof o[k] === "number") o[k] = Math.round(o[k] * f);
  for (const k of ["elts", "prim", "sec", "corner", "start", "end"]) if (Array.isArray(o[k])) o[k] = o[k].map(el);
  // `min` stays the specification's own (the checks scale it by the map's scale)
  return o;
}
