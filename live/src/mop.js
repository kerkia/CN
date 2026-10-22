// MeOS's online results (MOP, « MeOS Online Protocol », 2026-10-22): MeOS posts the whole race (<MOPComplete>) and then
// what changed (<MOPDiff>) every few seconds to an address it is given — here Ozimut's /api/live/mop, which hands the body
// to the race's object. Elements: <competition>, <ctrl id> (a radio control's name), <cls id ord radio="31,32;33"> (the
// radio controls of each leg, « ; » between legs), <org id> (a club), <cmp id competing> with <base org cls stat st rt prel>
// (start st in tenths of a second after midnight, running time rt in tenths) and <radio>ctrl,rt;ctrl,rt</radio> (the time
// at each radio control, from the start), <tm id> (a relay team: <base> as a runner's, <r> its members by leg);
// delete="true" removes one. When the organiser sends every control as a radio control, each runner's card read at the
// finish brings all their split times. Written from MeOS's protocol (mop.xsd), no other code reused.

// MeOS's status codes -> liveresultat's (0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 overtime, 12 not classified); 0 (unknown:
// running, or not started yet) is decided below
const STAT = { 1: 0, 2: 12, 3: 3, 4: 2, 5: 4, 6: 5, 15: 12, 20: 1, 21: 1, 99: 12 };
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unent = (s) => (s.includes("&") ? s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] !== "#" ? ENT[e] ?? m
  : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))))) : s);
/** MeOS's numbers, at times suffixed (« 31-1 »): the leading integer, as a string. */
export const mopId = (s) => { const m = /^\s*(-?\d+)/.exec(String(s ?? "")); return m ? String(Number(m[1])) : null; };
const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

/** A small XML reader (no DOMParser in Workers): the root element as { name, attrs, text, kids }, prefixes dropped. */
export function parseXml(s) {
  const top = { name: "", attrs: {}, text: "", kids: [] }, stack = [top];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  for (const x of s.matchAll(re)) {
    const cur = stack[stack.length - 1];
    if (x[1] != null) cur.text += x[1];
    else if (x[6] != null) { if (stack.length > 1) cur.text += unent(x[6]); }
    else if (x[3]) {
      const name = x[3].replace(/^.*:/, "");
      if (x[2]) {                                    // a closing tag: back to the element it closes
        const at = stack.map((e) => e.name).lastIndexOf(name);
        if (at > 0) stack.length = at;
        continue;
      }
      const el = { name, attrs: {}, text: "", kids: [] };
      for (const a of x[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1].replace(/^.*:/, "")] = unent(a[2] ?? a[3]);
      cur.kids.push(el);
      if (!x[5]) stack.push(el);
    }
  }
  return top.kids[0] || null;
}

/** The bytes as text: UTF-8 unless the declaration names a Latin encoding. */
export function decodeXml(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, 200)).toLowerCase();
  if (/encoding\s*=\s*["'](iso-8859-1|latin-?1|windows-1252|cp1252)/.test(head)) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return s;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** The first file of a zip (MeOS may pack what it sends), at most `max` bytes once inflated. */
export async function unzipFirst(b, max = 64 * 1024 * 1024) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("no zip directory");
  const cd = v.getUint32(e + 16, true);
  if (v.getUint32(cd, true) !== 0x02014b50) throw new Error("bad zip directory");
  const method = v.getUint16(cd + 10, true), size = v.getUint32(cd + 20, true), lho = v.getUint32(cd + 42, true);
  if (v.getUint32(lho, true) !== 0x04034b50) throw new Error("bad zip entry");
  const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
  const data = b.subarray(start, start + size);
  if (method === 0) return data;
  if (method !== 8) throw new Error(`zip method ${method}`);
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel(); throw new Error("zip too large"); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A fresh race: the head (kept under one key) — the competition, controls, classes, clubs, which class each runner and
 *  team is in, and each class's count and name as shown —; each class's runners and teams are kept under their own key. */
export const emptyHead = () => ({ comp: null, ctrl: {}, cls: {}, org: {}, who: {}, team: {}, cnt: {}, nm: {} });
export const emptyClass = () => ({ r: {}, t: {} });

/**
 * Applies one MOP document to the race's state. `getCls(id)` gives a class's state (loaded, or new). Answers the classes
 * touched (ids), those removed, and whether every class must be rebuilt (a club or control renamed).
 */
export async function apply(doc, h, getCls) {
  const touched = new Set(), removed = new Set();
  let all = false, runners = 0;
  const moveOut = async (map, id, key) => {
    const was = map[id];
    if (was != null) { delete (await getCls(was))[key][id]; touched.add(was); }
    return was;
  };
  for (const el of doc.kids) {
    const id = mopId(el.attrs.id), del = el.attrs.delete === "true";
    if (el.name === "competition") {
      h.comp = { name: el.text.trim().slice(0, 160), date: /^\d{4}-\d\d-\d\d$/.test(el.attrs.date || "") ? el.attrs.date : null,
        organizer: String(el.attrs.organizer || "").trim().slice(0, 160) };
    } else if (id == null) continue;
    else if (el.name === "ctrl") {
      if (del) delete h.ctrl[id]; else h.ctrl[id] = el.text.trim().slice(0, 60);
      all = true;
    } else if (el.name === "org") {
      if (del) delete h.org[id]; else h.org[id] = el.text.trim().slice(0, 120);
      all = true;
    } else if (el.name === "cls") {
      if (del) { delete h.cls[id]; removed.add(id); continue; }
      h.cls[id] = { n: el.text.trim().slice(0, 120), o: num(el.attrs.ord),
        radio: String(el.attrs.radio || "").split(";").map((leg) => leg.split(",").map(mopId).filter((c) => c != null)) };
      touched.add(id);
    } else if (el.name === "cmp" || el.name === "tm") {
      const team = el.name === "tm", map = team ? h.team : h.who, key = team ? "t" : "r";
      if (del) { await moveOut(map, id, key); delete map[id]; continue; }
      const base = el.kids.find((k) => k.name === "base");
      if (!base) continue;
      const cls = mopId(base.attrs.cls) ?? "0";
      if (map[id] != null && map[id] !== cls) await moveOut(map, id, key);
      const x = { n: base.text.trim().slice(0, 120), o: mopId(base.attrs.org), s: num(base.attrs.stat), st: num(base.attrs.st),
        rt: num(base.attrs.rt), p: base.attrs.prel === "true" ? 1 : 0 };
      if (!team) {
        x.c = el.attrs.competing === "true" ? 1 : 0;
        const radio = el.kids.find((k) => k.name === "radio")?.text || "";
        x.rd = radio.split(";").map((p) => p.split(",")).filter((p) => p.length === 2 && mopId(p[0]) != null && p[1].trim() !== "")
          .map(([c, t]) => [mopId(c), num(t)]);
        runners++;
      }
      (await getCls(cls))[key][id] = x;
      map[id] = cls;
      touched.add(cls);
    }
  }
  return { touched, removed, all, runners };
}

/**
 * One class in the compact form « En direct » shows (liveresultat's): controls [[code, name]], rows [place, name, club,
 * result, status, timeplus, progress, start, splits, provisional] in hundredths of a second, splits [time, place, timeplus]
 * per radio control. A relay class shows its teams (their total), without split times.
 */
export function compactClass(h, id, k) {
  const c = h.cls[id] || { n: `#${id}`, radio: [[]] };
  const club = (o) => (o != null ? h.org[o] || "" : "");
  const teams = Object.values(k.t || {});
  const people = teams.length ? teams : Object.values(k.r || {});
  const codes = teams.length ? [] : (c.radio[0] || []).filter((x) => Number(x) > 0);
  const list = people.map((x) => {
    let status;
    if (x.s === 1) status = x.rt > 0 ? 0 : null;
    else if (x.s === 0) status = x.c || x.rd?.some(([, t]) => t > 0) ? 9 : null;     // out, else let the start time say
    else status = STAT[x.s] ?? 12;
    const times = codes.map((code) => { const p = x.rd?.find(([cc]) => cc === code); return p && p[1] > 0 ? p[1] * 10 : null; });
    return { name: x.n, club: club(x.o), status, result: status === 0 ? x.rt * 10 : null, start: x.st > 0 ? x.st * 10 : null, times,
      prel: status === 0 && x.p ? 1 : 0 };
  });
  // places and gaps: at each control among those who passed it, at the finish among the classified
  const per = codes.map((_, i) => list.map((r) => r.times[i]).filter((t) => t != null).sort((a, b) => a - b));
  const fin = list.filter((r) => r.status === 0).map((r) => r.result).sort((a, b) => a - b);
  const placeIn = (sorted, t) => sorted.indexOf(t) + 1;           // ties share the better place
  return {
    controls: codes.map((code) => [code, h.ctrl[code] && !/^radio$/i.test(h.ctrl[code]) ? h.ctrl[code] : code]),
    rows: list.map((r) => [r.status === 0 ? placeIn(fin, r.result) : null, r.name, r.club, r.result, r.status,
      r.status === 0 ? r.result - fin[0] : null, null, r.start,
      codes.length ? r.times.map((t, i) => (t == null ? null : [t, placeIn(per[i], t), t - per[i][0]])) : null, r.prel]),
  };
}

/** The classes in MeOS's order (then by name), those with someone in them; their names made unique. */
export function classOrder(h) {
  return Object.entries(h.cls).filter(([id]) => h.cnt[id] > 0)
    .sort((a, b) => a[1].o - b[1].o || a[1].n.localeCompare(b[1].n)).map(([id]) => id);
}
