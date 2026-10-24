// SPORTident Center (2026-10-24): SPORTident's cloud, where its Orienteering App, its Reader, OE12 and SiTiming publish
// results live (online controls, readouts) and keep them. Only what its own public results page reads is read here, while
// someone watches the race on « En direct »; none of its code (the results file's fields were read from the numbers its
// page's script decodes). A race there is relayed as an O'Live race is: the race's object reads its results file and passes
// the classes that changed to the same `update`.
//
//   /api/rest/v1/public-events?hasPublishedData=true&dateFrom=…&dateTo=…&page=0&size=100
//                                          the public events with published data: id, name, startDate, slug, eventType,
//                                          timezone, location.country, organisation.name, guid (none: no results file)
//   /event-files/<guid>/results/r.1.latest.bin
//                                          the results (protobuf « Results »), with an ETag and its Last-Modified: read
//                                          again only when it changed (304 otherwise)
//
// Times in the file are milliseconds after the event's zero time, its local midnight written as if it were UTC: the clock
// read in UTC is the local time (checked against the files' dates, sources/sportident.py).

export const HOST = "center.sportident.com";
export const BASE = `https://${HOST}`;
export const FROM = 600000000;                   // below O'Live's races (700 000 000); the event's own id added
export const isSi = (comp) => Number(comp) >= FROM && Number(comp) < FROM + 100000000;
export const raceId = (id) => FROM + Number(id);
export const eventOf = (comp) => Number(comp) - FROM;

const UA = "Ozimut-live/1.0 (+https://ozimut.com; one reader per competition, relayed to its spectators)";

/** The public events with results from lo to hi (ISO days), orienteering only: [{ id, name, organizer, date, country,
 *  timezone, guid, slug }]. */
export async function events(lo, hi) {
  const out = [];
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ page, size: 100, hasPublishedData: "true", dateFrom: lo, dateTo: hi });
    const r = await fetch(`${BASE}/api/rest/v1/public-events?${q}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!r.ok) throw new Error(`sportident ${r.status}`);
    const rows = await r.json();
    for (const e of rows) {
      if (e.eventType !== "orienteering" || !e.guid || !e.startDate) continue;
      out.push({ id: e.id, name: String(e.name || "").trim(), organizer: organiser(e), date: e.startDate,
        country: e.location?.country || null, timezone: e.timezone || null, guid: e.guid, slug: e.slug || "" });
    }
    if (rows.length < 100) break;
  }
  return out;
}

/** The event's organisation; none for « Not assigned » or SPORTident's own accounts (its branches' trainings). */
export function organiser(e) {
  const org = String(e.organisation?.name || "").trim();
  return org === "Not assigned" || /^sportident/i.test(org) ? "" : org;
}

/** The results file: { status: 200 | 304, bytes, etag, modified (ms) }. */
export async function results(guid, etag = null) {
  const headers = { "User-Agent": UA };
  if (etag) headers["If-None-Match"] = etag;
  const r = await fetch(`${BASE}/event-files/${guid}/results/r.1.latest.bin`, { headers });
  if (r.status !== 200 && r.status !== 304) throw new Error(`sportident ${r.status}`);
  const modified = Date.parse(r.headers.get("Last-Modified") || "");
  return { status: r.status, bytes: r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : null,
    etag: r.headers.get("ETag") || etag, modified: Number.isFinite(modified) ? modified : null };
}

/** When the results file last changed (ms), by a HEAD request: how « live » a race is. */
export async function lastChange(guid) {
  const r = await fetch(`${BASE}/event-files/${guid}/results/r.1.latest.bin`, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const t = Date.parse(r.headers.get("Last-Modified") || "");
  return Number.isFinite(t) ? t : null;
}

// ---- protobuf: the fields read (d.center.*) -------------------------------------------------------------------------------
const U = "u", I = "i", S = "s", B = "b";
const SCHEMA = {
  Results: { 2: ["revision", U], 5: ["eventDefinition", "EventDefinition"], 7: ["entries", ["map", "Entry"]],
    9: ["individualResults", ["map", "IndividualResult"]] },
  EventDefinition: { 1: ["eventInfo", "EventInfo"], 3: ["controls", ["map", "ControlDefinition"]], 5: ["sections", ["map", "SectionDefinition"]],
    7: ["classes", ["map", "ClassDefinition"]], 9: ["courses", ["map", "CourseDefinition"]] },
  EventInfo: { 1: ["name", S], 5: ["organisation", S], 7: ["startDate", S], 9: ["zeroTimeUnix", U], 15: ["timeFieldMultiplier", U] },
  ControlDefinition: { 1: ["codes", [U]], 2: ["type", I], 3: ["name", S] },
  SectionDefinition: { 5: ["fromControl", U], 7: ["toControl", U], 9: ["evaluationMode", I] },
  ClassDefinition: { 1: ["name", S], 2: ["shortName", S], 7: ["course", U], 15: ["isTeamClass", B], 17: ["displayOrder", U] },
  CourseDefinition: { 1: ["name", S], 4: ["type", I], 5: ["sections", [U]] },
  Entry: { 1: ["type", I], 3: ["plate", S], 4: ["firstName", S], 5: ["lastName", S], 12: ["classes", [U]], 13: ["course", U], 20: ["club", S] },
  IndividualResult: { 1: ["sectionResults", ["map", "SectionResult"]], 3: ["status", I] },
  SectionResult: { 2: ["cumulativeTime", U], 5: ["status", I], 6: ["actualStartTime", U] },
};
const td = new TextDecoder();

// varints as numbers: times and the zero time (ms since 1970, 41 bits) stay well under 2^53
function varint(b, p) {
  let r = 0, mul = 1, c;
  do { c = b[p.i++]; r += (c & 127) * mul; mul *= 128; } while (c >= 128);
  return r;
}
function skip(b, p, wire) {
  if (wire === 0) varint(b, p);
  else if (wire === 1) p.i += 8;
  else if (wire === 5) p.i += 4;
  else if (wire === 2) { const n = varint(b, p); p.i += n; } else throw new Error(`wire type ${wire}`);
}

/** A message of SCHEMA from protobuf bytes (fields not listed skipped; maps as objects, repeated numbers as arrays). */
export function decode(b, msg = "Results", p = { i: 0 }, end = b.length) {
  const sch = SCHEMA[msg], out = {};
  while (p.i < end) {
    const key = varint(b, p), field = Math.floor(key / 8), wire = key & 7;
    const d = sch[field];
    if (!d) { skip(b, p, wire); continue; }
    const [name, t] = d;
    if (Array.isArray(t) && t[0] === "map") {
      const j = varint(b, p) + p.i;
      let k = 0, v = {};
      while (p.i < j) {
        const kk = varint(b, p);
        if (kk >> 3 === 1) k = varint(b, p);
        else if (kk >> 3 === 2) { const n = varint(b, p); v = decode(b, t[1], p, p.i + n); } else skip(b, p, kk & 7);
      }
      (out[name] ||= {})[k] = v;
    } else if (Array.isArray(t)) {
      const lst = (out[name] ||= []);
      if (wire === 2) { const j = varint(b, p) + p.i; while (p.i < j) lst.push(varint(b, p)); } else lst.push(varint(b, p));
    } else if (t === U || t === I || t === B) {
      const v = varint(b, p);
      out[name] = t === B ? !!v : v;
    } else if (t === S) {
      const n = varint(b, p);
      out[name] = td.decode(b.subarray(p.i, p.i + n));
      p.i += n;
    } else {
      const n = varint(b, p);
      out[name] = decode(b, t, p, p.i + n);
    }
  }
  return out;
}

// IndividualStatus -> liveresultat's (0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 overtime, 9 running, 10 not started, 12 not
// classified); 3 « finished », not yet evaluated: a provisional result
const STAT = { 1: 10, 2: 9, 3: 0, 4: 0, 5: 1, 6: 2, 7: 4, 8: 3, 9: 5, 10: 12, 11: 2, 80: 0, 99: 10 };
const CONTROL = 1, SCORE_O = 7, OPTIONAL = 2, OK = 4, FINISHED = 3;

/** The sections counted on a course's line (each ends at a control, the last at the finish). */
const lineOf = (ed, course) => (course.sections || []).filter((s) => ed.sections?.[s]?.evaluationMode !== OPTIONAL);
/** The controls' [key, code] along a course (the finish apart; a code met twice keyed « 31.2 »); none for a score course. */
function controlsOf(ed, course) {
  if (course.type === SCORE_O) return [];
  const seen = {}, out = [];
  for (const s of lineOf(ed, course).slice(0, -1)) {
    const c = ed.controls?.[ed.sections[s].toControl];
    const code = c && (c.type ?? CONTROL) === CONTROL && c.codes?.length ? String(c.codes[0]) : `#${out.length + 1}`;
    seen[code] = (seen[code] || 0) + 1;
    out.push([seen[code] > 1 ? `${code}.${seen[code]}` : code, code]);
  }
  return out;
}

/**
 * The decoded file -> the classes in the compact form « En direct » shows (liveresultat's: rows [place, name, club, result,
 * status, timeplus, progress, start, splits, provisional] in hundredths, splits [time, place, timeplus] per control), one
 * class per SPORTident class, in its display order; team classes left out.
 */
export function compact(r) {
  const ed = r.eventDefinition || {}, info = ed.eventInfo || {};
  const zero = Number(info.zeroTimeUnix || 0), mul = Number(info.timeFieldMultiplier || 1);
  const clock = (t) => Math.floor(((zero + t * mul) / 1000) % 86400);     // the local clock (written as UTC)
  const classes = ed.classes || {}, courses = ed.courses || {};
  const by = new Map();
  for (const [eid, e] of Object.entries(r.entries || {})) {
    if ((e.type ?? 1) !== 1) continue;
    const cid = (e.classes || []).find((c) => classes[c]);
    const cls = classes[cid];
    if (!cls || cls.isTeamClass) continue;
    (by.get(cid) || by.set(cid, []).get(cid)).push([eid, e]);
  }
  const order = [...by.keys()].sort((a, b) => (classes[a].displayOrder ?? 1e9) - (classes[b].displayOrder ?? 1e9) || Number(a) - Number(b));
  const names = {}, used = new Set();
  for (const cid of order) {                       // the names shown, unique
    let n = (classes[cid].name || classes[cid].shortName || `#${cid}`).trim().slice(0, 120);
    while (used.has(n)) n += " ";
    used.add(n);
    names[cid] = n;
  }
  const out = {};
  for (const cid of order) {
    const course = courses[classes[cid].course] || {};
    const line = lineOf(ed, course), controls = controlsOf(ed, course);
    const list = by.get(cid).map(([eid, e]) => {
      const res = r.individualResults?.[eid] || {}, secs = res.sectionResults || {};
      let status = STAT[res.status] ?? 10;
      const first = secs[line[0]], end = secs[line[line.length - 1]];
      const start = first?.actualStartTime ? clock(first.actualStartTime) * 100 : null;
      const done = end && end.status === OK && end.cumulativeTime ? Math.round(end.cumulativeTime * mul / 10) : null;
      const result = status === 0 ? done : null;
      if (status === 0 && result == null) status = 9;
      if (status === 10 && start != null && Object.keys(secs).length) status = 9;
      const times = controls.map((_, i) => { const s = secs[line[i]]; return s && s.status === OK && s.cumulativeTime ? Math.round(s.cumulativeTime * mul / 10) : null; });
      const name = [e.firstName, e.lastName].map((x) => String(x || "").trim()).filter(Boolean).join(" ") || String(e.plate || "");
      return { name, club: String(e.club || "").trim(), status, result, start, times, prel: res.status === FINISHED ? 1 : 0 };
    });
    const fin = list.filter((x) => x.status === 0).map((x) => x.result).sort((a, b) => a - b);
    const per = controls.map((_, i) => list.map((x) => x.times[i]).filter((t) => t != null).sort((a, b) => a - b));
    out[names[cid]] = {
      controls,
      rows: list.map((x) => [x.status === 0 ? fin.indexOf(x.result) + 1 : null, x.name, x.club, x.result, x.status,
        x.status === 0 ? x.result - fin[0] : null, null, x.start,
        controls.length ? x.times.map((t, i) => (t == null ? null : [t, per[i].indexOf(t) + 1, t - per[i][0]])) : null, x.prel]),
    };
  }
  return { order: order.map((c) => names[c]), classes: out, info: { name: String(info.name || "").trim(), date: info.startDate || null } };
}

/** Is anyone out (running, or a finish not yet evaluated) in the compact classes? */
export const anyOut = (classes) => Object.values(classes).some((k) => k.rows.some((r) => r[4] === 9 || r[9] === 1));
/** Is anyone still to start? */
export const anyWaiting = (classes) => Object.values(classes).some((k) => k.rows.some((r) => r[4] === 10));
