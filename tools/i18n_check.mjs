// The catalogues' check (owner, 2026-10-17: the site in French and English). node tools/i18n_check.mjs [--strict] [--list]
//  - keys the code uses (t("…"), tn("…")) that the French catalogue lacks;
//  - French keys the English catalogue lacks, English keys French does not have;
//  - placeholders {x} and markup tags that differ between a key's French and English;
//  - French written in the code outside the catalogues (string and template literals with French words or accents),
//    except in the long texts written per language (*.fr.js, *.en.js) and lines marked « i18n-ignore » (a pattern
//    matching French in documents, a name…); a file whose first lines say « i18n-ignore-file » is skipped whole.
// --strict exits 1 when anything is found; --list prints every finding, else the first ones of each kind.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const JS = join(ROOT, "site", "assets", "js");
const CAT = join(JS, "i18n");
const strict = process.argv.includes("--strict"), all = process.argv.includes("--list");

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : []; });
const load = async (f) => (await import(pathToFileURL(join(CAT, f)).href)).default;

// the catalogues: fr.js / en.js and the areas' <area>.fr.js / <area>.en.js
const FR = { ...(await load("fr.js")) }, EN = { ...(await load("en.js")) };
for (const f of readdirSync(CAT)) {
  const m = /^([\w-]+)\.(fr|en)\.js$/.exec(f);
  if (m) Object.assign(m[2] === "fr" ? FR : EN, await load(f));
}

const out = [];
const report = (title, items) => {
  out.push(`${title}: ${items.length}`);
  for (const x of all ? items : items.slice(0, 25)) out.push(`  ${x}`);
  if (!all && items.length > 25) out.push(`  … (${items.length - 25} more: --list)`);
};

// keys used by the code
const files = walk(JS).filter((f) => !f.startsWith(CAT + sep));
const used = new Set(), dynamic = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt[n]?\(\s*"([^"]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bt[n]?\(\s*`([^`]*\$\{[^`]*)`/g)) dynamic.push(`${relative(JS, f)}: ${m[1]}`);
}
const plural = (k) => [`${k}.one`, `${k}.other`].some((x) => x in FR);
report("Keys used but missing in fr.js", [...used].filter((k) => !(k in FR) && !plural(k)).sort());

// English against French
const missingEn = Object.keys(FR).filter((k) => !(k in EN));
const byPrefix = {};
for (const k of missingEn) { const p = k.split(".")[0]; byPrefix[p] = (byPrefix[p] || 0) + 1; }
report("French keys missing in English", all ? missingEn : Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}.* ${n}`));
report("English keys not in French", Object.keys(EN).filter((k) => !(k in FR)));
const marks = (s, re) => [...String(s).matchAll(re)].map((m) => m[1]).sort().join(",");
const diff = [];
for (const k of Object.keys(EN)) {
  if (!(k in FR)) continue;
  if (marks(FR[k], /\{(\w+)\}/g) !== marks(EN[k], /\{(\w+)\}/g)) diff.push(`${k}: placeholders ${marks(FR[k], /\{(\w+)\}/g)} / ${marks(EN[k], /\{(\w+)\}/g)}`);
  else if (marks(FR[k], /<\/?(\w+)/g) !== marks(EN[k], /<\/?(\w+)/g)) diff.push(`${k}: tags ${marks(FR[k], /<\/?(\w+)/g)} / ${marks(EN[k], /<\/?(\w+)/g)}`);
}
report("Placeholders or tags that differ", diff);

// French written in the code
const FRENCH = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŒ«»]|\b(les|des|une|pour|avec|dans|sur|votre|vous|aucun|aucune|chargement|enregistr\w*|choisi\w*|fermer|annuler|valider|ajouter|supprimer|cliquez|déposez)\b/i;
const inline = [];
for (const f of files) {
  if (/\.(fr|en)\.js$/.test(f)) continue;
  const src = readFileSync(f, "utf8");
  if (/i18n-ignore-file/.test(src.slice(0, 600))) continue;
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (/i18n-ignore/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const code = line.replace(/\/\/.*$/, "");
    for (const m of code.matchAll(/"((?:[^"\\]|\\.){2,})"|'((?:[^'\\]|\\.){2,})'|`([^`]{2,})`/g)) {
      const lit = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, "");
      // a key, an import path, a CSS rule or a regular expression is not text
      if (/^[\w.-]+$/.test(lit) || /^\.{0,2}\//.test(lit) || /[{};]\s*$/.test(lit.trim()) && !/[a-zà-ÿ]{3,} [a-zà-ÿ]{3,}/i.test(lit)) continue;
      if (FRENCH.test(lit)) { inline.push(`${relative(JS, f)}:${i + 1}: ${lit.trim().slice(0, 90)}`); break; }
    }
  });
}
report("French written in the code", inline);
if (dynamic.length) out.push(`(keys built at run time, not checked: ${dynamic.length})`);

console.log(out.join("\n"));
const bad = out.some((l) => /: [1-9]\d*$/.test(l) && !l.startsWith("French keys missing") || /^French keys missing in English: [1-9]/.test(l));
process.exit(strict && bad ? 1 : 0);
