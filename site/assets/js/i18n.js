// The interface's language (owner, 2026-10-17: the site globalised, French and English first). The texts live in
// catalogues — i18n/fr.js, the reference where every key exists first, and i18n/en.js —, plus an area's own catalogues
// loaded by its pages (loadArea: i18n/<area>.fr.js, <area>.en.js; the Tracer's). Long texts (the documentation, the
// guides, the legal pages) are whole modules per language, not keys. A text missing in English falls back to French.
//
// The language: the one chosen (localStorage ocn.lang — the user menu, Réglages, the login page; ?lang= in an address),
// else the browser's: French for a French-speaking browser, English for any other. « xx » is a test pseudo-language:
// French texts transformed, so that any text not drawn through t() stands out (?lang=xx).
// The catalogues load before any module that imports this one runs (top-level await), so t() is synchronous everywhere.

export const LANGS = ["fr", "en"];
export const LANG_NAMES = { fr: "Français", en: "English" };
const KEY = "ocn.lang";
// While the English is being written: French unless English is chosen, and the switch shown to administrators only.
// true once every text exists in both languages: the browser's language decides, everyone sees the switch.
export const OPEN = false;

function chosen() {
  try {
    const q = new URLSearchParams(location.search).get("lang") || new URLSearchParams(location.hash.split("?")[1] || "").get("lang");
    if (q && (LANGS.includes(q) || q === "xx")) localStorage.setItem(KEY, q);
    const v = localStorage.getItem(KEY);
    if (v && (LANGS.includes(v) || v === "xx")) return v;
  } catch (e) { /* no storage: the browser decides */ }
  if (!OPEN) return "fr";
  const nav = (typeof navigator !== "undefined" && (navigator.languages?.length ? navigator.languages : [navigator.language])) || [];
  return nav.some((l) => /^fr\b/i.test(l || "")) || !nav.length ? "fr" : "en";
}

const UI = chosen();
const FR = (await import("./i18n/fr.js")).default;
const EN = UI === "en" ? (await import("./i18n/en.js")).default : null;

/** The language the texts are in: "fr" or "en" (the pseudo-language formats as French). */
export const lang = () => (UI === "en" ? "en" : "fr");
/** The language as chosen, the pseudo-language included. */
export const uiLang = () => UI;
/** The locale numbers and dates are written in. */
export const locale = () => (UI === "en" ? "en-GB" : "fr-FR");
if (typeof document !== "undefined") document.documentElement.lang = lang();

/** Change the language: kept on this device (and on the account, by the caller), then the page is drawn again. */
export function setLang(l) {
  if (!LANGS.includes(l) && l !== "xx") return;
  try { localStorage.setItem(KEY, l); } catch (e) { /* this visit only */ }
  location.reload();
}

/** Load an area's catalogues (i18n/<area>.fr.js and, in English, <area>.en.js) into the tables; once. */
const areas = new Map();
export function loadArea(name) {
  if (!areas.has(name)) {
    areas.set(name, (async () => {
      Object.assign(FR, (await import(`./i18n/${name}.fr.js`)).default);
      if (EN) { try { Object.assign(EN, (await import(`./i18n/${name}.en.js`)).default); } catch (e) { /* French then */ } }
    })());
  }
  return areas.get(name);
}

/** Whether a key exists (in French, the reference). */
export const has = (key) => key in FR;

// the pseudo-language: letters accented, placeholders, tags and entities left alone, the whole bracketed
const PSEUDO = { a: "á", e: "é", i: "í", o: "ö", u: "ü", c: "ç", n: "ñ", A: "Á", E: "É", I: "Í", O: "Ö", U: "Ü", C: "Ç", N: "Ñ" };
const pseudo = (s) => `⟦${s.split(/(\{\w+\}|<[^>]*>|&\w+;)/).map((p, i) => (i % 2 ? p : p.replace(/[a-zA-Z]/g, (c) => PSEUDO[c] || c))).join("")}⟧`;

/** The text of `key` in the interface's language; `vars` fills its {placeholders}. */
export const t = (key, vars) => {
  let s = EN && EN[key] != null ? EN[key] : FR[key];
  if (s == null) return key;
  if (UI === "xx") s = pseudo(s);
  if (!vars) return s;
  const out = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  // an English text that opens on a placeholder (« {cn} history ») opens with a capital (« Official CN history »)
  return UI === "en" && s[0] === "{" ? out.charAt(0).toUpperCase() + out.slice(1) : out;
};

const plurals = new Intl.PluralRules(locale());
const numbers = new Intl.NumberFormat(locale());
/** A count's text: the key's plural form for n (key.one, key.other…; {n} is n written in the locale). */
export const tn = (key, n, vars = {}) => {
  const form = `${key}.${plurals.select(n)}`;
  return t(form in FR || (EN && form in EN) ? form : `${key}.other`, { n: numbers.format(n), ...vars });
};
