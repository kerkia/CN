// The results file an organiser drops on « Déposer », read in the browser — nothing is sent before they choose to
// publish. A port of the server's parsers (ffco_scraper/prov/parsers: iofxml, oe_html, meos_html and the helpers of
// html_generic and model), giving the same documents: { kind, by, title, date, classes: [{ name, length_m, climb_m,
// controls, runners: [{ place, name, club, club_code, category, birth, bib, time_s, status, splits, start_s }] }] }.
// Keep the two in step. PDFs are read on the server only (pdfplumber); .zip and .gz archives are opened here.

// ---- model ---------------------------------------------------------------------------------------------------
export const plain = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\x7f]/g, "")
  .replace(/\s+/g, " ").trim().toLowerCase();

const STATUS_WORDS = {
  mp: ["pm", "p.m.", "mp", "poincon manquant", "poinc. manquant", "missing punch", "mispunch", "manquant"],
  dnf: ["ab", "abandon", "abd", "dnf", "abandonne", "aband", "forfait"],
  dsq: ["disq", "disq.", "dsq", "disqualifie", "disqualifiee", "dq"],
  ot: ["hd", "hors delai", "hors-delai", "h.d.", "h. delai", "ot", "over time", "temps max", "depassement"],
  dns: ["np", "non partant", "dns", "absent", "abs"],
  nc: ["nc", "n.c.", "hc", "hors concours", "hors course", "non classe", "nl"],
};
const strip = (s, chars) => s.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, "g"), "");
function statusOf(text) {
  const t = strip(plain(text), " .");
  if (!t) return null;
  for (const [st, words] of Object.entries(STATUS_WORDS)) if (words.some((w) => strip(w, " .") === t)) return st;
  return null;
}
const TIME = /^\s*(?:(\d+)\s*[:hH]\s*)?(\d{1,3})\s*[:'m]\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*(?:s|")?\s*$/;
export function parseTime(text) {
  if (text == null) return null;
  const m = String(text).replace(/ /g, " ").match(TIME);
  if (!m) return null;
  const [, h, mi, s, frac] = m;
  if (Number(s) >= 60) return null;
  let t = Number(h || 0) * 3600 + Number(mi) * 60 + Number(s);
  if (frac) t += Number(frac) / 10 ** frac.length;
  return t;
}
const clubCode = (text) => String(text ?? "").match(/\b(\d{4})(?:[A-Z]{2})?\b/)?.[1] ?? null;
function birthYear(text) {
  const t = String(text ?? "").trim();
  if (/^\d{4}$/.test(t)) { const y = Number(t); return y > 1900 && y < 2100 ? y : null; }
  if (/^\d{2}$/.test(t)) { const y = Number(t); return y <= 30 ? 2000 + y : 1900 + y; }
  return null;
}
function category(text) {
  const m = String(text ?? "").trim().toUpperCase().match(/^([HD])\s?(\d{2})([A-Z]{0,2})$/);
  return m ? `${m[1]}${m[2]}` : null;
}
function runner(name, kw = {}) {
  const r = { place: null, name: String(name ?? "").replace(/\s+/g, " ").trim(), club: null, club_code: null, category: null,
    birth: null, bib: null, time_s: null, status: "ok", splits: null, start_s: null };
  for (const k of Object.keys(kw)) if (k in r) r[k] = kw[k];
  if (r.club && !r.club_code) r.club_code = clubCode(r.club);
  if (r.status === "ok" && r.time_s == null) r.status = "dnf";
  return r;
}
const klass = (name) => ({ name: String(name ?? "").replace(/\s+/g, " ").trim(), length_m: null, climb_m: null, controls: null, runners: [] });
const doc = (kind, classes, by = "unknown", title = null, date = null) =>
  ({ kind, by, title, date, classes: classes.filter((c) => c.runners.length) });
// Counter.most_common(1): the commonest, the first seen among equals
function commonest(items) {
  const n = new Map();
  for (const x of items) n.set(x, (n.get(x) || 0) + 1);
  let best = null, bn = 0;
  for (const [k, v] of n) if (v > bn) { best = k; bn = v; }
  return best;
}

// ---- html helpers (html_generic) ------------------------------------------------------------------------------
function decodeHtml(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return new TextDecoder(bytes[0] === 0xff ? "utf-16le" : "utf-16be").decode(bytes);
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const declared = (head.match(/<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i)?.[1] || "").toLowerCase();
  if (["windows-1252", "cp1252", "iso-8859-1", "iso8859-1", "latin1", "latin-1", "iso-8859-15"].includes(declared)) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder("windows-1252").decode(bytes); }
}
const textOf = (el) => (el ? (el.textContent || "").replace(/ /g, " ").replace(/&nbsp/g, " ").replace(/\s+/g, " ").trim() : "");
function cellsOf(tr) {
  const out = [];
  for (const c of tr.children) {
    if (c.localName !== "td" && c.localName !== "th") continue;
    const span = Math.max(1, Math.min(parseInt(c.getAttribute("colspan") || "1", 10) || 1, 50));
    out.push(c);
    for (let i = 1; i < span; i++) out.push(null);
  }
  return out;
}
const MONTHS = { jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6, juil: 7, jul: 7, aou: 8, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12 };
const ymd = (y, m, d) => (y >= 2000 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31
  ? `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);
function findDate(...texts) {
  for (const raw of texts) {
    const t = plain(raw);
    if (!t) continue;
    for (const [rx, order] of [[/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g, "ymd"], [/(?<!\d)(\d{1,2})[ /.\-_](\d{1,2})[ /.\-_](\d{4})(?!\d)/g, "dmy"]]) {
      for (const m of t.matchAll(rx)) {
        const [a, b, c] = [m[1], m[2], m[3]].map(Number);
        const d = order === "ymd" ? ymd(a, b, c) : ymd(c, b, a);
        if (d) return d;
      }
    }
    let m = t.match(/(?<!\d)(\d{1,2})(?:er)? ([a-z]{3,9})\.? (\d{4})(?!\d)/);
    if (m) {
      const mon = Object.entries(MONTHS).find(([k]) => m[2].startsWith(k))?.[1];
      if (mon && ymd(Number(m[3]), mon, Number(m[1]))) return ymd(Number(m[3]), mon, Number(m[1]));
    }
    m = t.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
    if (m && ymd(Number(m[1]), Number(m[2]), Number(m[3]))) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    m = t.match(/(?:^|[_ ])(\d{2})(\d{2})(\d{2})(?:$|[_ .])/);
    if (m) {
      const [d, mo, y] = [m[1], m[2], m[3]].map(Number);
      if (y >= 10 && y <= 40) { const r = ymd(2000 + y, mo, d); if (r) return r; }
    }
  }
  return null;
}
const cleanClassName = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/\s*\(\s*\d+\s*(?:\/\s*\d+\s*)?\)\s*$/, "").trim();
function lengthClimb(text) {
  const t = String(text ?? "").replace(/ /g, " ");
  let length = null, climb = null;
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*km\b/i);
  if (m) length = Math.round(Number(m[1].replace(",", ".")) * 1000);
  const rest = m ? t.slice(m.index + m[0].length) : t;
  const c = rest.match(/(?<![\d.,k])(\d+)\s*m\b/);
  if (c) climb = Number(c[1]);
  return [length, climb];
}
function placeOf(text) {
  const m = plain(text).match(/^\s*=?\s*(\d{1,4})\s*(?:\.|e|er|ere|eme|°)?\s*$/);
  return m ? Number(m[1]) : null;
}
const STATUS_PREFIXES = [["h. delai", "ot"], ["h.delai", "ot"], ["hors del", "ot"], ["depassement", "ot"], ["temps depasse", "ot"], ["max", "ot"],
  ["aband", "dnf"], ["disq", "dsq"], ["non part", "dns"], ["pas parti", "dns"], ["forfait", "dns"], ["hors conc", "nc"], ["hors cours", "nc"],
  ["non class", "nc"], ["poinc", "mp"], ["p.m", "mp"]];
function statusWord(text) {
  const st = statusOf(text);
  if (st) return st;
  const t = plain(text);
  return STATUS_PREFIXES.find(([p]) => t.startsWith(p))?.[1] ?? null;
}
function timeStatus(text) {
  const t = String(text ?? "").trim();
  const st = statusWord(t);
  if (st) return [null, st];
  const s = parseTime(t);
  return s != null ? [s, "ok"] : [null, null];
}
function splitTime(text) {
  const t = String(text ?? "").trim();
  if (!t || [...t].every((c) => "-–—*. 0:".includes(c))) return null;
  return parseTime(t);
}
function byOf(names, hint) {
  const h = plain(hint);
  if (/par (circuit|parcours)|parcircuit|par_circuit|circuits?\b/.test(h) && !h.includes("categ")) return "circuit";
  const ns = names.filter(Boolean);
  if (!ns.length) return "unknown";
  const cats = ns.filter((n) => /^[HD]\s?\d{2}(?!\d)/i.test(n.trim())).length;
  if (cats >= 0.6 * ns.length) return "category";
  if (/par categ|parcateg|par_categ/.test(h)) return "category";
  return "circuit";
}
function finishClasses(classes, by) {
  for (const c of classes) {
    const cat = by === "category" ? category(c.name) : null;
    const placed = c.runners.some((r) => r.place != null);
    for (const r of c.runners) {
      if (cat && !r.category) r.category = cat;
      if (placed && r.place == null && r.status === "ok" && r.time_s != null) r.status = "nc";
    }
  }
}
function checkSplits(splits, n) {
  const s = [...splits, ...Array(n).fill(null)].slice(0, n);
  return s.some((v) => v != null) ? s : null;
}
const LETTER = /\p{L}/u;

// ---- IOF XML ---------------------------------------------------------------------------------------------------
const IOF_STATUS = { ok: "ok", finished: "ok", missingpunch: "mp", mispunch: "mp", didnotfinish: "dnf", sportingwithdrawal: "dnf",
  sportwithdr: "dnf", disqualified: "dsq", overtime: "ot", didnotstart: "dns", notcompeting: "nc",
  inactive: null, didnotenter: null, cancelled: null, active: null };
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
function child(el, ...path) {
  for (const name of path) { if (!el) return null; el = kids(el, name)[0] || null; }
  return el;
}
const txt = (el, ...path) => {
  const e = path.length ? child(el, ...path) : el;
  return e && e.textContent ? e.textContent.replace(/\s+/g, " ").trim() : "";
};
function seconds(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return parseTime(t);
}
function clock(text) {
  const m = (text || "").trim().match(/(?:T|^)(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
function parseIof(text) {
  const head = text.slice(0, 2048).replace(/^[﻿ \t\r\n]+/, "");
  if (!(head.startsWith("<?xml") || head.startsWith("<ResultList") || head.includes("<ResultList"))) return null;
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const root = xml.documentElement;
  if (!root || root.localName !== "ResultList" || xml.getElementsByTagName("parsererror").length) return null;
  const event = child(root, "Event");
  const title = txt(event, "Name") || null;
  let date = null;
  for (const path of [["StartTime", "Date"], ["StartDate", "Date"], ["Race", "StartTime", "Date"]]) {
    const m = (event ? txt(event, ...path) : "").match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) { date = m[1]; break; }
  }
  const classes = kids(root, "ClassResult").map(iofClass).filter((k) => k && k.runners.length);
  if (!classes.length) return null;
  const names = classes.map((c) => c.name);
  const by = names.filter((n) => category(n)).length >= 0.6 * names.length ? "category" : "circuit";
  if (by === "category") for (const c of classes) { const cat = category(c.name); for (const r of c.runners) r.category = r.category || cat; }
  return doc("iofxml", classes, by, title, date);
}
function iofClass(cr) {
  const name = txt(cr, "Class", "Name") || txt(cr, "ClassShortName") || txt(cr, "Class", "ClassShortName");
  const course = child(cr, "Course");
  const k = klass(name || "?");
  const length = course ? txt(course, "Length") : "", climb = course ? txt(course, "Climb") : "";
  k.length_m = /^\d+(?:\.\d+)?$/.test(length) ? Math.trunc(Number(length)) : null;
  k.climb_m = /^\d+(?:\.\d+)?$/.test(climb) ? Math.trunc(Number(climb)) : null;
  const raw = kids(cr, "PersonResult").map((pr) => iofPerson(pr, k)).filter(Boolean);
  const seq = (s) => s.map(([c]) => c).join("\u0001");
  let pool = raw.filter(([r, s]) => s.length && r.status === "ok").map(([, s]) => seq(s));
  if (!pool.length) pool = raw.filter(([, s]) => s.length).map(([, s]) => seq(s));
  const best = commonest(pool);
  const controls = best != null ? best.split("\u0001") : null;
  k.controls = controls;
  for (const [r, s] of raw) {
    if (controls && s.length) r.splits = align(controls, s);
    k.runners.push(r);
  }
  return k;
}
function align(controls, punches) {
  const out = [];
  let j = 0;
  for (const code of controls) {
    while (j < punches.length && punches[j][0] !== code) j++;
    if (j >= punches.length) return null;
    out.push(punches[j][1]);
    j++;
  }
  return out.some((v) => v != null) ? out : null;
}
function iofPerson(pr, k) {
  const person = child(pr, "Person");
  if (!person) return null;
  const family = txt(person, "Name", "Family") || txt(person, "PersonName", "Family");
  const given = txt(person, "Name", "Given") || txt(person, "PersonName", "Given");
  const name = [given, family].filter(Boolean).join(" ");
  if (!name) return null;
  const bd = txt(person, "BirthDate", "Date") || txt(person, "BirthDate");
  const birth = /^\d{4}/.test(bd) ? birthYear(bd.slice(0, 4)) : null;
  const org = child(pr, "Organisation") || child(pr, "Club");
  const club = org ? (txt(org, "Name") || txt(org, "ShortName")) : "";
  const res = child(pr, "Result");
  if (!res) return null;
  let stRaw;
  if (child(res, "Status")) stRaw = txt(res, "Status");
  else stRaw = child(res, "CompetitorStatus")?.getAttribute("value") || "";
  const key = stRaw.toLowerCase().replace(/[^a-z]/g, "");
  let status = key in IOF_STATUS ? IOF_STATUS[key] : (key ? "nc" : "ok");
  if (status === null) return null;
  const time = seconds(txt(res, "Time"));
  const pos = txt(res, "Position") || txt(res, "ResultPosition");
  const place = /^\d+$/.test(pos) && Number(pos) > 0 && status === "ok" ? Number(pos) : null;
  if (status === "ok" && time == null) status = "dnf";
  if (k.length_m == null) { const cl = txt(res, "CourseLength"); if (/^\d+$/.test(cl)) k.length_m = Number(cl); }
  const cat = category(txt(pr, "Class", "Name"));
  const punches = [];
  for (const st of kids(res, "SplitTime")) {
    const s = (st.getAttribute("status") || "").toLowerCase();
    if (s === "additional") continue;
    const code = txt(st, "ControlCode");
    if (!code) continue;
    punches.push([code, s === "missing" ? null : seconds(txt(st, "Time"))]);
  }
  const r = runner(name, { place, club: club || null, category: cat, birth, bib: txt(res, "BibNumber") || null, time_s: time, status,
    start_s: clock(txt(res, "StartTime") || txt(res, "StartTime", "Clock")) });
  return [r, punches];
}

// ---- OE (SportSoftware) HTML -------------------------------------------------------------------------------------
const OE_SIGNS = ["sportsoftware", "stephan kr", "oe2010", "oe12", "oe2003", "oe11", "oe2013"];
const OE_CONTROL = /^(\d+)\s*\(\s*(\w+)\s*\)$/;
const OE_FINISH = ["arr", "arr.", "arrivee", "ziel", "finish", "f"];
const OE_COLS = { pl: "place", "pl.": "place", place: "place", rang: "place", platz: "place", nom: "name", name: "name", "nom prenom": "name",
  "doss.": "bib", doss: "bib", stno: "bib", bib: "bib", startnr: "bib", ne: "birth", yb: "birth", jg: "birth", an: "birth",
  club: "club", verein: "club", "catg.": "category", "cat.": "category", class: "category", "kat.": "category",
  temps: "time", time: "time", zeit: "time" };
function parseOe(html, root, url) {
  const head = html.slice(0, 6000).toLowerCase();
  if (!OE_SIGNS.some((s) => head.includes(s)) && !html.toLowerCase().includes("sportsoftware")) return null;
  if (!root.querySelector("td#c00")) return null;
  const title = textOf(root.querySelector("title")) || null;
  const top = [...root.querySelectorAll("div#reporttop td")].map(textOf);
  const event = top.length ? top[0] : (title || "");
  let classes = [], state = null;
  for (const tr of root.querySelectorAll("tr")) {
    if ([...tr.children].some((c) => c.localName === "td" && c.id === "c00")) {
      state = oeNewClass(tr);
      classes.push(state.klass);
      continue;
    }
    if (!state) continue;
    const texts = cellsOf(tr).map((c) => (c ? textOf(c) : ""));
    if ([...tr.children].some((c) => c.localName === "th")) {
      state.cols = {};
      texts.forEach((t, i) => { const k = plain(t); if (k in OE_COLS) state.cols[OE_COLS[k]] = i; });
      continue;
    }
    if (oeControlRow(texts)) { oeAddControlLine(state, texts); continue; }
    if (!texts.some(Boolean)) continue;
    if (state.lines.length) oeSplitRow(state, texts); else { const r = oeRunner(state, texts); if (r) state.klass.runners.push(r); }
  }
  classes = classes.filter((c) => c.runners.length);
  if (!classes.length) return null;
  for (const c of classes) {
    if (c.controls != null) for (const r of c.runners) if (r.splits != null) r.splits = checkSplits(r.splits, c.controls.length);
  }
  const by = byOf(classes.map((c) => c.name), [title, url].filter(Boolean).join(" "));
  finishClasses(classes, by);
  return doc("oe_html", classes, by, title, findDate(event, title));
}
function oeNewClass(tr) {
  const cells = [...tr.children].filter((c) => c.localName === "td").map(textOf);
  const k = klass(cleanClassName(cells[0]));
  [k.length_m, k.climb_m] = lengthClimb(cells.slice(1).join(" "));
  return { klass: k, cols: {}, lines: [], block: null };
}
const oeControlRow = (texts) => texts.filter((t) => OE_CONTROL.test(t)).length >= 1
  && texts.filter((t) => OE_CONTROL.test(t) || OE_FINISH.includes(plain(t))).length >= 2;
function oeAddControlLine(state, texts) {
  const line = [], k = state.klass;
  if (k.controls == null) k.controls = [];
  for (let i = 0; i < texts.length; i++) {
    const m = texts[i].match(OE_CONTROL);
    if (m) { line.push([i, k.controls.length]); k.controls.push(m[2]); }
    else if (OE_FINISH.includes(plain(texts[i]))) break;
  }
  state.lines.push(line);
}
const oeGet = (state, texts, field) => { const i = state.cols[field]; return i != null && i < texts.length ? texts[i] : ""; };
function oeRunner(state, texts) {
  const name = oeGet(state, texts, "name");
  if (!name || !LETTER.test(name)) return null;
  const timeText = oeGet(state, texts, "time");
  let [time, status] = timeStatus(timeText);
  const placeText = oeGet(state, texts, "place");
  if (status == null || (status === "ok" && statusWord(placeText))) {
    status = statusWord(placeText) || (!timeText ? "dns" : null);
    if (status == null) return null;
  }
  return runner(name, { place: placeOf(placeText), club: oeGet(state, texts, "club") || null, category: category(oeGet(state, texts, "category")),
    birth: birthYear(oeGet(state, texts, "birth")), bib: oeGet(state, texts, "bib") || null, time_s: time, status });
}
function oeSplitRow(state, texts) {
  const ends = state.lines.flatMap((line) => line.map(([i]) => i));
  const end = ends.length ? Math.min(...ends) : Object.keys(state.cols).length + 1;
  const nameI = state.cols.name;
  const fixed = texts.slice(0, end).filter((t, i) => i !== nameI && t);
  const block = state.block;
  const named = nameI != null && nameI < texts.length && texts[nameI];
  if (fixed.length || (named && (block == null || block.rows.length % 2 === 0))) {
    const r = oeRunner(state, texts);
    if (!r) { state.block = null; return; }
    state.klass.runners.push(r);
    state.block = { runner: r, rows: [texts] };
    oeFillSplits(state);
    return;
  }
  if (!block) return;
  block.rows.push(texts);
  if (block.rows.length === 2 && nameI != null && nameI < texts.length && texts[nameI]) {
    block.runner.club = texts[nameI];
    block.runner.club_code = clubCode(texts[nameI]);
  }
  oeFillSplits(state);
}
const increasing = (vals) => { const v = vals.filter((x) => x != null); return v.length >= 2 && v.every((a, i) => i === 0 || v[i - 1] <= a); };
function oeFillSplits(state) {
  const rows = state.block.rows;
  const splits = Array((state.klass.controls || []).length).fill(null);
  state.lines.forEach((line, li) => {
    const pair = rows.slice(2 * li, 2 * li + 2);
    if (!pair.length) return;
    const cands = pair.map((row) => line.map(([i]) => (i < row.length ? splitTime(row[i]) : null)));
    let vals = cands[0];
    if (cands.length === 2 && !increasing(cands[0]) && increasing(cands[1])) vals = cands[1];
    line.forEach(([, ci], j) => { if (j < vals.length) splits[ci] = vals[j]; });
  });
  state.block.runner.splits = splits.some((v) => v != null) ? splits : null;
}

// ---- MeOS HTML -------------------------------------------------------------------------------------------------
const TIME_TITLES = ["temps", "time", "tid", "zeit", "resultat"];
function parseMeos(html, root, url) {
  const low = html.toLowerCase();
  if (!low.includes("melin.nu/meos") && !/<meta[^>]+generator[^>]+meos/.test(low)) return null;
  const title = textOf(root.querySelector("title")) || null;
  if (root.querySelector("table#resultsTable")) return null;          // Orientation Data pages: read on the server
  const heading = [...root.querySelectorAll("h1, h2, h3")].slice(0, 2).map(textOf).join(" ");
  const absolute = [...root.querySelectorAll("div")].some((d) => (d.getAttribute("style") || "").toLowerCase().includes("absolute"));
  const lines = absolute ? divLines(root) : tableLines(root);
  const classes = readLines(lines);
  if (!classes.length) return null;
  const by = byOf(classes.map((c) => c.name), [heading, url].filter(Boolean).join(" "));
  finishClasses(classes, by);
  const early = lines.slice(0, 4).flatMap((line) => line.map(([, t]) => t));
  return doc("meos_html", classes, by, title || heading || null, findDate(...early, heading, title));
}
function isBold(el) {
  if (!el) return false;
  const style = (el.getAttribute("style") || "").replace(/ /g, "").toLowerCase();
  const bs = [...el.querySelectorAll("b, strong")];
  return style.includes("font-weight:bold") || (el.getAttribute("class") || "").split(/\s+/).includes("header")
    || (bs.length > 0 && textOf(el) === bs.map(textOf).join(" "));
}
function tableLines(root) {
  const lines = [];
  for (const tr of root.querySelectorAll("tr")) {
    if (tr.querySelector("h1, h2, h3")) continue;
    const line = [];
    cellsOf(tr).forEach((c, i) => { if (c && textOf(c)) line.push([i, textOf(c), isBold(c)]); });
    if (line.length) lines.push(line);
  }
  return lines;
}
function divLines(root) {
  const byTop = new Map();
  for (const el of root.querySelectorAll("div, p")) {
    const pos = {};
    for (const m of (el.getAttribute("style") || "").matchAll(/(left|top)\s*:\s*(-?\d+(?:\.\d+)?)px/gi)) pos[m[1].toLowerCase()] = Number(m[2]);
    if (!("left" in pos) || !("top" in pos) || el.querySelector("h1, h2, h3")) continue;
    const t = textOf(el);
    if (t) { if (!byTop.has(pos.top)) byTop.set(pos.top, []); byTop.get(pos.top).push([pos.left, t, isBold(el)]); }
  }
  const cmp = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || Number(a[2]) - Number(b[2]);
  return [...byTop.keys()].sort((a, b) => a - b).map((k) => byTop.get(k).sort(cmp));
}
function readLines(lines) {
  const groups = [];
  for (const line of lines) {
    if (line.every(([, , b]) => b)) {
      const titles = new Map(line.slice(1).map(([x, t]) => [x, plain(t)]));
      groups.push([klass(cleanClassName(line[0][1])), titles, []]);
    } else if (groups.length) {
      const row = new Map();
      for (const [x, t] of line) row.set(x, t);
      groups[groups.length - 1][2].push(row);
    }
  }
  const classes = [];
  for (const [k, titles, rows] of groups) {
    const cols = meosColumns(titles, rows);
    if (!cols) continue;
    for (const row of rows) { const r = meosRunner(row, cols); if (r) k.runners.push(r); }
    if (k.runners.length) classes.push(k);
  }
  return classes;
}
function meosColumns(titles, rows) {
  const xs = [...new Set(rows.flatMap((row) => [...row.keys()]))].sort((a, b) => a - b);
  if (!xs.length) return null;
  const vals = new Map(xs.map((x) => [x, rows.map((row) => row.get(x)).filter(Boolean)]));
  const share = (x, test) => { const v = vals.get(x); return v.length ? v.filter(test).length / v.length : 0; };
  const timeish = (t) => !t.startsWith("+") && (timeStatus(t)[1] != null || plain(t) === "ok");
  let timeX = [...titles].find(([x, t]) => TIME_TITLES.includes(t) && vals.has(x))?.[0];
  if (timeX == null) {
    let best = null;
    for (const x of xs) {
      const s = [share(x, timeish) * vals.get(x).length, -x, x];
      if (!best || s[0] > best[0] || (s[0] === best[0] && s[1] > best[1])) best = s;
    }
    if (best[0] <= 0) return null;
    timeX = best[2];
  }
  const left = xs.filter((x) => x < timeX);
  const placeX = left.find((x) => share(x, (t) => /^\d+\.$/.test(t)) >= 0.5) ?? null;
  const rest = left.filter((x) => placeX == null || x > placeX);
  const nameX = rest.find((x) => share(x, (t) => /\p{L}{2}/u.test(t)) >= 0.5 && share(x, timeish) < 0.5);
  if (nameX == null) return null;
  let birthX = null, clubX = null, classX = null;
  const texts = [];
  for (const x of rest) {
    if (x <= nameX) continue;
    if (share(x, (t) => /^(19|20)?\d{2}$/.test(t)) >= 0.8) birthX = birthX ?? x;
    else if (share(x, (t) => LETTER.test(t)) >= 0.5) texts.push(x);
  }
  if (texts.length === 1) clubX = texts[0];
  else if (texts.length >= 2) {
    const key = (x) => [share(x, (t) => clubCode(t) != null), new Set(vals.get(x)).size / Math.max(1, vals.get(x).length)];
    const ranked = [...texts].sort((a, b) => { const [a1, a2] = key(a), [b1, b2] = key(b); return b1 - a1 || b2 - a2; });
    [clubX, classX] = ranked;
  }
  return { time: timeX, place: placeX, name: nameX, club: clubX, class: classX, birth: birthX };
}
function meosRunner(row, cols) {
  const name = row.get(cols.name) || "";
  if (!name || !LETTER.test(name)) return null;
  const tt = row.get(cols.time) || "";
  let [time, status] = timeStatus(tt);
  if (status == null) {
    if (plain(tt) === "ok") status = "nc";
    else if (!tt || [...tt].every((c) => "-–—".includes(c))) status = "dns";
    else return null;
  }
  const clsText = cols.class != null ? row.get(cols.class) || "" : "";
  return runner(name, { place: cols.place != null ? placeOf(row.get(cols.place) || "") : null,
    club: cols.club != null ? row.get(cols.club) ?? null : null, category: category(clsText),
    birth: cols.birth != null ? birthYear(row.get(cols.birth) || "") : null, time_s: time, status });
}

// ---- files and archives -----------------------------------------------------------------------------------------
async function inflate(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** The files of a .zip archive: [{ name, bytes }] (stored or deflated entries; folders and macOS extras skipped). */
async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || name.startsWith("__MACOSX") || (method !== 0 && method !== 8)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    try { out.push({ name, bytes: method === 8 ? await inflate(data, "deflate-raw") : data }); } catch (e) { /* a damaged entry */ }
  }
  return out;
}

/** One file's bytes -> a document, or null when it is none of the formats read here. */
export function parseBytes(bytes, name) {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 400)).trimStart().toLowerCase();
  if (head.startsWith("%pdf-")) return null;
  if (head.startsWith("<?xml") || head.includes("<resultlist")) {
    try { return parseIof(new TextDecoder("utf-8").decode(bytes)); } catch (e) { return null; }
  }
  const html = decodeHtml(bytes);
  let root;
  try { root = new DOMParser().parseFromString(html.replace(/^\s*<\?xml[^>]*\?>/, ""), "text/html"); } catch (e) { return null; }
  for (const p of [parseOe, parseMeos]) {
    try { const d = p(html, root, name); if (d?.classes.length) return d; } catch (e) { /* the next one */ }
  }
  return null;
}

/**
 * A dropped file -> { docs: [{ kind, by, title, date, classes, url }], pdf, unread: [names] }. Archives are opened
 * (every XML / HTML file inside); a PDF is not read here.
 */
export async function readFile(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let entries = [{ name: file.name, bytes }];
  if (/\.gz$/i.test(file.name) || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
    entries = [{ name: file.name.replace(/\.gz$/i, ""), bytes: await inflate(bytes, "gzip") }];
  } else if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    entries = await unzip(bytes);
  }
  const docs = [], unread = [];
  let pdf = false;
  for (const e of entries) {
    if (/\.pdf$/i.test(e.name) || new TextDecoder("latin1").decode(e.bytes.subarray(0, 5)) === "%PDF-") { pdf = true; continue; }
    if (!/\.(xml|html?|txt)$/i.test(e.name) && entries.length > 1) continue;
    const d = parseBytes(e.bytes, e.name);
    if (d) docs.push({ ...d, url: e.name, source: "local" }); else unread.push(e.name);
  }
  return { docs, pdf, unread };
}
