// A training map's ready-made choices (owner, 2026-11-05): the symbols each one hides, by their ISOM / ISSprOM numbers — the
// Tracer's « Filtrer la carte » (tracer/mapview.js) and Pixel's map options (games/vmapopt.js) share them. The map's margins
// (titles, legend, scale: 6xx-9xx and unnumbered symbols) are never touched. ISOM 2000 numbers its paths 501-509 and keeps its
// slope lines and contour values apart (104, 105), where ISOM 2017 has its earth bank and earth wall.

/** syms: [{ id, n (its number), kind }]; the ids of those the choice hides. */
export function presetSymbols(syms, preset) {
  const iso2000 = syms.some((s) => s.kind === "line" && (s.n === 521 || s.n === 524));
  const pathMax = iso2000 ? 509 : 508;
  const pick = (f) => syms.filter(f).map((s) => s.id);
  switch (preset) {
    case "relief": return pick((s) => s.n >= 200 && s.n < 600);
    case "contours": return pick((s) => s.n >= (iso2000 ? 106 : 104) && s.n < 600);
    case "nopaths": return pick((s) => s.kind === "line" && s.n >= 501 && s.n <= pathMax);
    case "noveg": return pick((s) => s.n >= 400 && s.n < 500);
    default: return [];
  }
}
export const PRESETS = ["full", "nopaths", "noveg", "relief", "contours"];
