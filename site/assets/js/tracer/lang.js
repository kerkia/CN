// The Tracer's texts (owner, 2026-10-17: the site in French and English): its own catalogue, i18n/tracer.fr.js and
// tracer.en.js, loaded once here before any module of the Tracer runs — each imports t from this module, so the labels
// a module builds as it loads (the ribbon's, the menus') are already in the site's language.
import { loadArea, t, tn, lang, locale } from "../i18n.js";

await loadArea("tracer").catch(() => {});            // offline without the catalogue: the keys show, nothing breaks

export { t, tn, lang, locale };
