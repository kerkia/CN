// Cartographier's texts: its own catalogue, i18n/mapper.<lang>.js (keys « map.<module>.* »), loaded once before any of its
// modules runs; each imports t from here, never from i18n.js directly (as the Tracer's modules do from tracer/lang.js).
import { loadArea, t, tn, lang, locale } from "../i18n.js";

await loadArea("mapper").catch(() => {});

export { t, tn, lang, locale };
