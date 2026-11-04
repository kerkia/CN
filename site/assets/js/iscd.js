// The IOF's International Specification for Control Descriptions, ISCD 2024 (owner, 2026-11-04: « everything from the
// specification and only from it »): each symbol's number in the specification, and for column D the ISOM 2017-2 and ISSprOM
// 2019-2 map symbols the specification's own « ISOM/ISSprOM » column names for it (« where a number is given it includes all
// symbols beginning with that number, e.g. 509 indicates 509.1 & 509.2 »), drawn by isom.js exactly as « Symboles de carte »
// draws them. The other columns have no map equivalent in the specification, so none is drawn. The symbols themselves are
// Purple Pen's (tracer/symbols.js), whose ids keep older numbers here and there: `iscdRef` gives the specification's.
// Names and descriptions: the catalogues' `cd.s.<ref>` / `cd.d.<ref>` (IOF's English, our French and the others' from it).

import { GROUPS, GROUPS_SPRINT, isomSvg } from "./isom.js";

/** Column D: the specification's ISOM/ISSprOM column, by ISCD number. */
const MAP = {
  "1.1": ["101", "102", "103"], "1.2": ["101", "102", "103"], "1.3": ["101", "102", "103"], "1.4": ["104"], "1.5": ["104"],
  "1.6": ["105", "106"], "1.7": ["107"], "1.8": ["108"], "1.9": ["101", "102", "103"], "1.10": ["109", "110"],
  "1.11": ["101", "102", "103"], "1.12": ["101", "102", "103"], "1.13": ["111"], "1.14": ["112", "203"], "1.15": ["113", "114"],
  "1.16": ["115"],
  "2.1": ["201", "202"], "2.2": ["206"], "2.3": ["203"], "2.4": ["204", "205"], "2.5": ["208", "209"], "2.6": ["207"],
  "2.7": ["210", "211", "212"], "2.8": ["214"], "2.9": ["201", "202"], "2.10": ["215"],
  "3.1": ["301"], "3.2": ["301", "302"], "3.3": ["303"], "3.4": ["301", "304", "305"], "3.5": ["306"], "3.6": ["309"],
  "3.7": ["307", "308", "310"], "3.8": ["307", "308", "310"], "3.9": ["311"], "3.10": ["312"], "3.11": ["311"],
  "4.1": ["213", "401", "403", "412", "413", "414"], "4.2": ["402", "404"], "4.3": ["405", "406", "408", "410"], "4.4": ["401", "403"],
  "4.5": ["406", "408", "410", "411", "418"], "4.6": ["410", "411"], "4.7": ["415", "416"], "4.8": ["405", "406", "408", "410"],
  "4.9": ["417", "418"], "4.10": ["419"],
  "5.1": ["502", "503"], "5.2": ["504", "505", "506", "507"], "5.3": ["508", "401", "403", "416"], "5.4": ["512"], "5.5": ["510", "511"],
  "5.6": ["510", "511", "524"], "5.7": ["512"], "5.8": ["513", "515", "514"], "5.9": ["516", "518", "517"], "5.10": ["519"],
  "5.11": ["521", "522.1"], "5.12": ["501"], "5.13": ["523"], "5.14": ["528", "529"], "5.15": ["524", "525"], "5.16": ["525"],
  "5.17": ["526"], "5.18": ["527"], "5.19": ["530", "115"], "5.20": ["530", "531"], "5.21": ["522"], "5.22": ["532"], "5.23": ["520"],
  "5.24": ["509"],
  "6.1": ["115", "313", "419", "531"], "6.2": ["530"],
};

// Purple Pen's ids whose number is not the specification's (the rest are the same)
const RENUMBER = {
  "5.23": "5.21", "5.24": "5.22", "5.25": "5.23", "5.26": "5.24",            // canopy, stairway, out of bounds, railway
  "11.7": "11.1",                                                            // bend (column F)
  "11.1": "12.1", "11.2": "12.2", "11.3": "12.3", "11.4": "12.4", "11.5": "12.5", "11.6": "12.6", "11.8": "12.7",
  "11.9": "12.8", "11.10": "12.9", "11.11": "12.10", "11.13": "12.11", "11.14": "12.12", "11.12": "12.13", "11.15": "12.14",
  "12.1": "13.1", "12.2": "13.2", "12.4": "13.3",                            // first aid, refreshments, manned control
  "13.6": "14.1", "13.1": "15.1", "13.2": "15.2", "13.3": "15.3", "13.4": "15.4", "13.5": "15.5",
  "14.1": "16.1", "14.2": "16.2", "14.3": "16.3",
  "9.1high": "9.1", "9.3high": "9.3",
};
// Purple Pen's symbols the specification does not have (« radio or TV control », « map exchange at a control »), and its
// second forms of one symbol (the text of a written description differs, the symbol not)
const LEFT_OUT = new Set(["12.3", "13.5control", "9.1deep", "9.3deep", "10.1single", "10.2single", "11.15single"]);
const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The specification's number of a Purple Pen symbol id, its direction (columns C and G), or null when the specification
 *  does not have it. */
export function iscdRef(id) {
  const raw = String(id || "").replace(/@.*/, "");
  if (LEFT_OUT.has(raw)) return null;
  const m = /^(\d+\.\d+)(N|NE|E|SE|S|SW|W|NW)$/.exec(raw);
  const base = m ? m[1] : raw, dir = m ? m[2] : "";
  const ref = RENUMBER[base] || base;
  return /^\d+\.\d+$/.test(ref) ? { ref, dir } : null;
}
export const directions = () => DIRS;

const known = (groups) => groups.flatMap((g) => g.codes.map(String));
/** The map symbols of a column D number in ISOM 2017-2 (forest) or ISSprOM 2019-2 (`sprint`): those the specification names,
 *  each with the symbols numbered under it (509 → 509.1, 509.2), those the map specification has. */
export function mapCodes(ref, sprint = false) {
  const have = known(sprint ? GROUPS_SPRINT : GROUPS);
  const out = [];
  for (const c of MAP[ref] || []) for (const k of have) if ((k === c || k.startsWith(`${c}.`)) && !out.includes(k)) out.push(k);
  return out;
}
/** The swatches of those symbols, as « Symboles de carte » draws them, each with its number. */
export function mapSwatches(ref, sprint = false, width = 70) {
  const codes = mapCodes(ref, sprint);
  if (!codes.length) return "";
  return `<span class="cd-maps">${codes.map((c) => `<span class="cd-sw">${isomSvg(c, width, "cd-map", sprint)}<span class="cd-swn">${c}</span></span>`).join("")}</span>`;
}
