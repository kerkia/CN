// A start list read in the browser (« Organisation › Horaires », 2026-10-18): the organiser sees it read before sending it.
// A port of the server's ffco_scraper/prov/parsers/startlist.py — keep them in step: IOF XML StartList, CSV (our own
// layout, OE's, MeOS', a Google Sheets export), HTML tables (lists and grids of circuits side by side), and the PDFs of OE
// and MeOS (pdf.js, the words' positions, as pdfplumber gives them to the server). -> { by, title, date, head, classes:
// [{ name, runners: [{ name, club, club_code, category, start_s }] }] } or null.

import { plain } from "./localparse.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

// ---- the model ---------------------------------------------------------------------------------------------------------
const CLOCK = /^\s*([01]?\d|2[0-3])[:hH]([0-5]\d)(?::([0-5]\d))?\s*$/;
/** '10:42', '10:42:30', '10h42' -> seconds after midnight (a plausible start: 6:00 to 23:59), else null. */
export function clock(text) {
  const m = CLOCK.exec(text || "");
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  return s >= 6 * 3600 ? s : null;
}
const category = (text) => {
  const m = String(text ?? "").trim().toUpperCase().match(/^([HD])\s?(\d{2})([A-Z]{0,2})$/);
  return m ? `${m[1]}${m[2]}` : null;
};
const clubCode = (club) => { const m = /^\s*(\d{4})(?:[A-Z]{0,3})?\b/.exec(String(club || "")); return m ? m[1] : null; };
const klass = (name) => ({ name, runners: [] });
const runner = (name, { club = null, category: cat = null, start_s = null } = {}) =>
  ({ name: String(name ?? "").replace(/\s+/g, " ").trim(), club: club || null, club_code: clubCode(club), category: cat, start_s });

function finish(classes, title, date) {
  classes = classes.filter((k) => k.runners.some((r) => r.start_s != null));
  if (!classes.length || classes.reduce((s, k) => s + k.runners.length, 0) < 3) return null;
  const by = classes.filter((k) => category(k.name)).length >= 0.6 * classes.length ? "category" : "circuit";
  if (by === "category") for (const k of classes) for (const r of k.runners) r.category = r.category || category(k.name);
  return { kind: "startlist", by, title: title || null, date: date || null, classes };
}

export async function parse(bytes, name = "") {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = new TextDecoder("latin1").decode(u8.subarray(0, 2048)).replace(/^﻿/, "").trimStart();
  try {
    if (head.startsWith("<?xml") || head.includes("<StartList")) return xml(decode(u8));
    if (head.startsWith("%PDF-")) return await pdf(u8);
    if (isCsv(u8, name)) return csv(u8);
    if (/<table/i.test(new TextDecoder("latin1").decode(u8.subarray(0, 2_000_000)))) return html(decode(u8));
  } catch (e) {
    console.warn("start list", e);
    return null;
  }
  return null;
}
function decode(u8) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^﻿/, ""); } catch (e) { return new TextDecoder("windows-1252").decode(u8); }
}

// ---- IOF XML ---------------------------------------------------------------------------------------------------------
function xml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "StartList") return null;
  const kids = (el, nm) => el ? [...el.children].filter((c) => c.localName === nm) : [];
  const kid = (el, nm) => kids(el, nm)[0] || null;
  const txt = (el, ...path) => { let e = el; for (const p of path) e = kid(e, p); return (e?.textContent || "").trim(); };
  const event = kid(root, "Event");
  const date = txt(event, "StartTime", "Date") || txt(event, "StartDate", "Date") || null;
  const tclock = (s) => { const m = /T?(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || ""); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0) : null; };
  const classes = [];
  for (const cs of kids(root, "ClassStart")) {
    const k = klass(txt(cs, "Class", "Name") || txt(cs, "ClassShortName") || txt(cs, "Class", "ClassShortName") || "?");
    for (const ps of kids(cs, "PersonStart")) {
      const person = kid(ps, "Person");
      if (!person) continue;
      const nm = [txt(person, "Name", "Given") || txt(person, "PersonName", "Given"), txt(person, "Name", "Family") || txt(person, "PersonName", "Family")]
        .filter(Boolean).join(" ");
      if (!nm) continue;
      const org = kid(ps, "Organisation") || kid(ps, "Club");
      const st = kid(ps, "Start");
      k.runners.push(runner(nm, { club: org ? txt(org, "Name") || txt(org, "ShortName") : null, category: category(txt(ps, "Class", "Name")),
        start_s: st ? tclock(txt(st, "StartTime") || txt(st, "StartTime", "Clock")) : null }));
    }
    classes.push(k);
  }
  return finish(classes, txt(event, "Name") || null, date);
}

// ---- tables: HTML and CSV ------------------------------------------------------------------------------------------------
const HEAD = {
  time: ["heure", "depart", "start", "h dep", "hdep", "horaire", "hour", "time"],
  first: ["prenom", "first name", "firstname", "given"],
  name: ["nom", "name", "coureur", "concurrent", "surname", "family", "last name", "lastname"],
  club: ["club", "equipe", "organisation", "ligue", "n club", "no club", "num club", "numero club", "numero de club", "code club", "city", "ville", "cl name"],
  course: ["circuit", "parcours", "course"],
  cat: ["cat", "categorie", "class", "classe"],
};
const EXACT = { short: "cat", long: "cat" };
/** What a heading names (see startlist._key): time, first, name, club, course, cat, or null. */
export function key(h) {
  const p = plain(h).replace(/[._\-/:]+/g, " ").trim();
  if (!p) return null;
  if ((/\bnom\b/.test(p) && p.includes("prenom")) || p === "name" || p === "full name") return "name";
  if (p in EXACT) return EXACT[p];
  if (p.startsWith("classif")) return null;
  for (const [k, words] of Object.entries(HEAD)) {
    if (words.some((w) => p === w || p.startsWith(w + " ") || (p.startsWith(w) && w.length >= 4))) {
      if (k === "time" && /\b(no|n|nr|num|numero|bib|dossard)\b/.test(p)) return null;
      return k;
    }
  }
  return null;
}
const wordy = (s) => /[A-Za-zÀ-ÿ]{2,}/.test(s || "") && clock(s) == null;
const club4 = (s) => { s = (s || "").trim(); return (/^\d{3}$/.test(s) ? s.padStart(4, "0") : s) || null; };
const cell = (c, i) => (i != null && i < c.length ? c[i] : "");

function grid(head, above) {
  const keys = head.map(key);
  const names = keys.flatMap((k, i) => (k === "name" ? [i] : []));
  const times = keys.flatMap((k, i) => (k === "time" ? [i] : []));
  if (names.length < 2 || !times.length || times[0] > names[0]) return null;
  const labels = [...above].reverse().find((r) => r.filter((x) => x && wordy(x)).length >= 2) || [];
  const before = (ni) => Math.max(...times.filter((t) => t < ni));
  const starts = names.map((ni, k) => { const ti = before(ni); return k === 0 || ti > names[k - 1] ? ti : ni; });
  return { groups: names.map((ni, k) => {
    const ti = before(ni), stop = k + 1 < starts.length ? starts[k + 1] : head.length;
    let fi = null, ci = null;
    for (let j = ni + 1; j < stop; j++) { if (fi == null && keys[j] === "first") fi = j; if (ci == null && keys[j] === "club") ci = j; }
    let label = "";
    for (let j = starts[k]; j < Math.min(stop, labels.length); j++) if (labels[j] && wordy(labels[j])) { label = labels[j]; break; }
    return [ti, ni, fi, ci, label || `Circuit ${k + 1}`];
  }) };
}
function columns(head) {
  const cols = {};
  head.forEach((h, i) => { const k = key(h); if (k && !(k in cols)) cols[k] = i; });
  return "time" in cols && "name" in cols ? cols : {};
}

/** One table's rows (cells, merged ones expanded): its classes (see startlist._read_table). */
function readTable(rows, label, lead) {
  let cur = klass(label || "?");
  const out = [], groups = new Map();
  let cols = {}, g = null;
  const above = [];
  const group = (lab) => { if (!groups.has(lab)) groups.set(lab, klass(lab)); return groups.get(lab); };
  for (const c of rows) {
    if (!c.some(Boolean)) continue;
    if (!Object.keys(cols).length && !g && !c.some((x) => clock(x) != null)) {
      g = grid(c, above);
      if (g) { for (const grp of g.groups) group(grp[4]); continue; }
      cols = columns(c);
      if (Object.keys(cols).length) continue;
      above.push(c);
      if (lead.length < 6) lead.push(...c.filter((x) => x && wordy(x)).slice(0, 3));
    }
    if (g) {
      for (const [ti, ni, fi, ci, lab] of g.groups) {
        const start = clock(cell(c, ti));
        let nm = cell(c, ni);
        if (fi != null && cell(c, fi)) nm = `${cell(c, fi)} ${nm}`.trim();
        if (start == null || !nm || !wordy(nm) || nm.length > 60) continue;
        group(lab).runners.push(runner(nm, { club: club4(cell(c, ci)), start_s: start }));
      }
      continue;
    }
    const filled = c.filter(Boolean);
    if (filled.length === 1 && wordy(filled[0])) {
      if (cur.runners.length) out.push(cur);
      cur = klass(filled[0].replace(/\s*\(\d+\)\s*$/, ""));
      continue;
    }
    let start, nm, club, cat, grp = null;
    if (Object.keys(cols).length) {
      start = clock(cell(c, cols.time)); nm = cell(c, cols.name);
      if (cell(c, cols.first)) nm = `${cell(c, cols.first)} ${nm}`.trim();
      club = cell(c, cols.club); cat = cell(c, cols.cat);
      grp = cell(c, cols.course) || (!("course" in cols) ? cat : "") || null;
    } else {
      const ti = c.findIndex((x) => clock(x) != null);
      if (ti < 0) continue;
      const w = c.map((x, i) => i).filter((i) => i !== ti && wordy(c[i]));
      const after = w.filter((i) => i > ti).length ? w.filter((i) => i > ti) : w;
      if (!after.length) continue;
      start = clock(c[ti]); nm = c[after[0]]; club = after.length > 1 ? c[after[1]] : null; cat = null;
    }
    if (start == null || !wordy(nm) || nm.length > 60) continue;
    const r = runner(nm, { club: club4(club), category: category((cat || "").split(" ")[0]), start_s: start });
    (grp ? group(grp) : cur).runners.push(r);
  }
  if (cur.runners.length) out.push(cur);
  return [...out, ...[...groups.values()].filter((k) => k.runners.length)];
}
function merge(classes) {
  const m = new Map();
  for (const k of classes) { if (m.has(k.name)) m.get(k.name).runners.push(...k.runners); else m.set(k.name, k); }
  return [...m.values()];
}

function cellsOf(tr) {
  const out = [];
  for (const td of tr.children) {
    if (!/^t[hd]$/i.test(td.tagName)) continue;
    const parts = [];
    (function collect(n) { for (const ch of n.childNodes) { if (ch.nodeType === 3) parts.push(ch.nodeValue); else if (ch.nodeType === 1) collect(ch); } })(td);
    out.push(parts.join(" ").replace(/\s+/g, " ").trim());
    const span = Math.min(Number(td.getAttribute("colspan")) || 1, 50);
    for (let i = 1; i < span; i++) out.push("");
  }
  return out;
}
function html(text) {
  const doc = new DOMParser().parseFromString(text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " "), "text/html");
  const title = (doc.querySelector("title")?.textContent || "").replace(/\s+/g, " ").trim() || null;
  const classes = [], lead = [];
  let label = "";
  for (const el of doc.body ? doc.body.querySelectorAll("table, h1, h2, h3, h4, h5, h6, caption, b, strong") : []) {
    if (el.tagName === "TABLE") {
      if (el.parentElement?.closest("table")) continue;         // a table inside another one: read with it
      const rows = [...el.querySelectorAll("tr")].filter((tr) => tr.closest("table") === el).map(cellsOf);
      classes.push(...readTable(rows, label.replace(/\s*\(\d+\)\s*$/, ""), lead));
      label = "";
    } else if (!el.closest("table")) {
      label = (el.textContent || "").replace(/\s+/g, " ").trim();
    }
  }
  const d = finish(merge(classes), title, null);
  if (d) d.head = [title || "", ...lead].join(" ").slice(0, 300).trim();
  return d;
}

/** A CSV file: by its name, else a text with no tag and many separators. */
function isCsv(u8, name) {
  if (/\.(csv|txt)$/i.test(name || "")) return true;
  const h = new TextDecoder("latin1").decode(u8.subarray(0, 4000));
  return !h.startsWith("%PDF") && !h.includes("<") && (h.match(/[;,\t]/g) || []).length >= 6 && (h.match(/\n/g) || []).length >= 2;
}
/** CSV rows (quoted fields, doubled quotes, line breaks inside quotes). */
export function csvRows(text, delim) {
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim()));
}
function csv(u8) {
  const text = decode(u8);
  const sample = text.slice(0, 8000);
  const delim = [";", ",", "\t"].reduce((a, b) => (sample.split(b).length > sample.split(a).length ? b : a));
  const lead = [];
  const d = finish(merge(readTable(csvRows(text, delim), "", lead)), lead.length ? lead[0].slice(0, 120) : null, null);
  if (d) d.head = lead.join(" ").slice(0, 300).trim();
  return d;
}

// ---- PDF (OE, MeOS): the words' positions, as the server's reader sees them ---------------------------------------------
const CHIP = /^\d{5,9}$/;
const BANNER = /^(meos|oe\d*|oe12|page\b|horaires? de d|liste de d|start ?list|n[o°] ?puce|nom\b|doss|d[ée]part\b)/i;
const CLUB_HEAD = /^(\d{4})[A-Z]{0,3}\s+(.+?)\s*\((\d+)\)$/;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, fev: 2, avr: 4, mai: 5, juin: 6, juil: 7, aou: 8 };
function dates(text) {
  const found = [];
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) found.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  for (const m of text.matchAll(/\b(\d{1,2})[- ]([A-Za-zéû]{3,9})\.?[- ](\d{2}|\d{4})\b/g)) {
    const mon = MONTHS[plain(m[2]).slice(0, 4)] || MONTHS[plain(m[2]).slice(0, 3)];
    if (mon) found.push(`${Number(m[3]) + (m[3].length === 2 ? 2000 : 0)}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push(m[0]);
  return found;
}
const pdfDate = (text) => { const f = dates(text); return f.length ? f.sort().at(-1) : null; };

let ctx2d = null;
const measure = (text) => {
  if (!ctx2d) {
    ctx2d = (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas")).getContext("2d");
    ctx2d.font = "100px Arial, Helvetica, 'Liberation Sans', sans-serif";
  }
  return ctx2d.measureText(text).width;
};
/** The pages' lines of words: { words: [{ text, x0, top, size }], text } (pdf.js text runs split at spaces). */
async function pdfLines(u8) {
  let pdfjs;
  try { pdfjs = await import(/* webpackIgnore: true */ PDFJS); } catch (e) { throw new Error("pdf"); }
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: u8.slice() }).promise;
  if (!doc.numPages || doc.numPages > 80) return null;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const h = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    const words = [];
    for (const it of tc.items) {
      const s = it.str || "";
      if (!s.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || it.height || 10;
      if (Math.abs(b) > 0.01 * size) continue;                   // not upright
      // a run holds several cells (OE: the chip and the name, the time and the circuit): each word's place measured in
      // Arial — the lists' font — and scaled to the run's own width, as pdfplumber's characters give it to the server
      const total = measure(s) || 1;
      const top = h - f - size;
      for (const m of s.matchAll(/\S+/g)) words.push({ text: m[0], x0: e + (it.width || 0) * measure(s.slice(0, m.index)) / total, top, size });
    }
    words.sort((u, v) => u.top - v.top || u.x0 - v.x0);
    const groups = [];
    for (const w of words) {
      const g = groups.at(-1);
      if (g && Math.abs(w.top - g[0].top) <= Math.max(1.5, 0.35 * w.size)) g.push(w); else groups.push([w]);
    }
    for (const g of groups) { g.sort((u, v) => u.x0 - v.x0); lines.push({ words: g, text: g.map((w) => w.text).join(" ") }); }
  }
  return lines;
}
function edges(rows, wordsOf, share) {
  const count = new Map();
  for (const l of rows) for (const x of new Set(wordsOf(l).map((w) => Math.round(w.x0)))) count.set(x, (count.get(x) || 0) + 1);
  const groups = [];
  for (const x of [...count.keys()].sort((a, b) => a - b)) { const g = groups.at(-1); if (g && x - g.at(-1) <= 2) g.push(x); else groups.push([x]); }
  const out = [];
  for (const g of groups) {
    if (g.at(-1) - g[0] > 2) continue;
    const n = rows.filter((l) => wordsOf(l).some((w) => g[0] - 0.6 <= w.x0 && w.x0 <= g.at(-1) + 0.6)).length;
    if (n >= share * rows.length) out.push(g[0] - 0.8);
  }
  return out;
}
async function pdf(u8) {
  const lines = await pdfLines(u8);
  if (!lines) return null;
  const isClock = (w) => clock(w.text) != null;
  let rows = lines.filter((l) => l.words.some(isClock));
  if (rows.length < 3) return null;
  const xs = new Map();
  for (const l of rows) { const x = Math.round(l.words.find(isClock).x0); xs.set(x, (xs.get(x) || 0) + 1); }
  const tx = [...xs.entries()].sort((a, b) => b[1] - a[1])[0][0];
  rows = rows.filter((l) => l.words.some((w) => isClock(w) && Math.abs(w.x0 - tx) <= 4));
  if (rows.length < 3) return null;
  const textw = (l) => l.words.filter((w) => !isClock(w) && !CHIP.test(w.text));
  const cols = edges(rows, textw, 0.6);
  if (!cols.length) return null;
  const bounds = [...cols, 1e6];
  const col = (l, a, b) => textw(l).filter((w) => a <= w.x0 && w.x0 < b).map((w) => w.text).join(" ").trim();
  const kinds = [];
  let texts = 0;
  for (let i = 0; i < cols.length; i++) {
    const vals = rows.map((l) => col(l, bounds[i], bounds[i + 1])).filter(Boolean);
    if (!vals.length) kinds.push(null);
    else if (vals.filter((v) => category(v.split(" ")[0])).length >= 0.6 * vals.length) kinds.push("cat");
    else if (vals.filter((v) => /^\d/.test(v)).length >= 0.6 * vals.length || vals.every((v) => v.length <= 2)) kinds.push(null);
    else if (vals.length >= 6 && new Set(vals).size <= Math.max(3, Math.floor(vals.length / 8))) kinds.push("class");
    else { kinds.push(texts < 2 ? ["name", "club"][texts] : null); texts++; }
  }
  for (let i = 1; i < kinds.length; i++) {
    if (kinds[i] == null && kinds[i - 1] === "class") {
      const vals = rows.map((l) => col(l, bounds[i], bounds[i + 1])).filter(Boolean);
      if (vals.length && vals.every((v) => v.length <= 2 && !/^\d/.test(v)) && new Set(vals).size > 1) kinds[i] = "class";
    }
  }
  if (!kinds.includes("name")) return null;
  const rowSet = new Set(rows);
  const headText = lines.slice(0, 6).map((l) => l.text).join(" ");
  const classes = new Map();
  let curClass = null, curClub = null;
  for (const l of lines) {
    if (!rowSet.has(l)) {
      const t = l.text.trim();
      const m = CLUB_HEAD.exec(t);
      if (m) curClub = m[2];
      else if (t && l.words.length <= 7 && t.length <= 50 && !BANNER.test(t) && !pdfDate(t) && !/\d{1,2}:\d{2}/.test(t)) {
        curClass = t.replace(/\s+\d+\s*m(?:[eè]tres)?\b.*$|\s*\(\d+\)\s*$/, "").trim() || t;
      }
      continue;
    }
    const vals = {};
    kinds.forEach((k, i) => { if (k && k !== "class") vals[k] = col(l, bounds[i], bounds[i + 1]); });
    vals.class = kinds.map((k, i) => (k === "class" ? col(l, bounds[i], bounds[i + 1]) : "")).filter(Boolean).join(" ");
    const nm = vals.name || "";
    if (!wordy(nm) || nm.length > 60) continue;
    const start = clock(l.words.find((w) => isClock(w) && Math.abs(w.x0 - tx) <= 4).text);
    const cls = vals.class || curClass || "?";
    if (!classes.has(cls)) classes.set(cls, klass(cls));
    classes.get(cls).runners.push(runner(nm, { club: vals.club || curClub, category: category((vals.cat || "").split(" ")[0]), start_s: start }));
  }
  const title = lines.slice(0, 4).map((l) => l.text).find((t) => !BANNER.test(t) && !pdfDate(t)) || null;
  const d = finish([...classes.values()], title, pdfDate(headText));
  if (d) d.head = headText.slice(0, 300);
  return d;
}
