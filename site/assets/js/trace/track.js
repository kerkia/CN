// A GPS trace as the Analyse page uses it: local metres, north up (y down, like an image), with the extra channels
// the file carries — altitude, heart rate, cadence, temperature, power. Read in the browser from:
// - GPX (trkpt; Garmin's TrackPointExtension hr / cad / atemp, power);
// - TCX (Trackpoint: Position, AltitudeMeters, HeartRateBpm, Cadence, RunCadence, Watts);
// - FIT, Garmin's binary format, the one most watches record: definition and data messages, normal and compressed
//   timestamp headers, developer fields skipped, chained files read in turn (record messages only: global 20).

export const R_EARTH = 6371000;
const FIT_EPOCH = 631065600;                       // 1989-12-31 00:00 UTC, in seconds since 1970
export const CHANNELS = ["ele", "hr", "cad", "temp", "pw"];

/** The file (name, ArrayBuffer) as a track. Throws "gpx" when unreadable, "time" when the points carry no time. */
export function parseTrace(name, buf) {
  const bytes = new Uint8Array(buf);
  if (bytes.length > 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === ".FIT") return build(parseFit(buf), "fit");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("gpx");
  const root = doc.documentElement.localName;
  if (root === "gpx") return build(parseGpx(doc), "gpx");
  if (root === "TrainingCenterDatabase") return build(parseTcx(doc), "tcx");
  throw new Error("gpx");
}
export const isTraceName = (name) => /\.(gpx|tcx|fit)$/i.test(name);

// ---- GPX / TCX ------------------------------------------------------------------------------------------------------
const num = (s) => { const v = s == null ? NaN : Number(String(s).trim()); return Number.isFinite(v) ? v : null; };
const child = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };
const text = (el, name) => child(el, name)?.textContent;
/** The first descendant with this local name (namespaces ignored), or null. */
function find(el, name) { for (const c of el.getElementsByTagName("*")) if (c.localName === name) return c; return null; }

function parseGpx(doc) {
  const pts = [];
  for (const p of doc.getElementsByTagName("trkpt")) {
    const time = text(p, "time");
    const r = { lat: num(p.getAttribute("lat")), lon: num(p.getAttribute("lon")), ms: time ? Date.parse(time) : NaN, ele: num(text(p, "ele")) };
    const ext = child(p, "extensions");
    if (ext) { r.hr = num(find(ext, "hr")?.textContent); r.cad = num(find(ext, "cad")?.textContent); r.temp = num(find(ext, "atemp")?.textContent); r.pw = num((find(ext, "power") || find(ext, "pwr"))?.textContent); }
    pts.push(r);
  }
  return pts;
}
function parseTcx(doc) {
  const pts = [];
  for (const p of doc.getElementsByTagName("Trackpoint")) {
    const pos = child(p, "Position");
    const r = { lat: num(pos && text(pos, "LatitudeDegrees")), lon: num(pos && text(pos, "LongitudeDegrees")), ms: Date.parse(text(p, "Time") || ""), ele: num(text(p, "AltitudeMeters")) };
    const hr = child(p, "HeartRateBpm"); r.hr = num(hr && text(hr, "Value"));
    r.cad = num(text(p, "Cadence"));
    const ext = child(p, "Extensions");
    if (ext) { if (r.cad == null) r.cad = num(find(ext, "RunCadence")?.textContent); r.pw = num(find(ext, "Watts")?.textContent); }
    pts.push(r);
  }
  return pts;
}

// ---- FIT ------------------------------------------------------------------------------------------------------------
/** A field's value by its base type (the first element of an array), null when the file says "invalid". */
function readField(dv, q, f, le) {
  const base = f.type & 0x1f;
  const need = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8][base] || 1;
  if (q + need > dv.byteLength || f.size < need) return null;
  switch (base) {
    case 0: case 2: case 13: { const v = dv.getUint8(q); return v === 0xff ? null : v; }
    case 1: { const v = dv.getInt8(q); return v === 0x7f ? null : v; }
    case 3: { const v = dv.getInt16(q, le); return v === 0x7fff ? null : v; }
    case 4: { const v = dv.getUint16(q, le); return v === 0xffff ? null : v; }
    case 5: { const v = dv.getInt32(q, le); return v === 0x7fffffff ? null : v; }
    case 6: { const v = dv.getUint32(q, le); return v === 0xffffffff ? null : v; }
    case 8: { const v = dv.getFloat32(q, le); return Number.isNaN(v) ? null : v; }
    case 9: { const v = dv.getFloat64(q, le); return Number.isNaN(v) ? null : v; }
    case 10: { const v = dv.getUint8(q); return v === 0 ? null : v; }
    case 11: { const v = dv.getUint16(q, le); return v === 0 ? null : v; }
    case 12: { const v = dv.getUint32(q, le); return v === 0 ? null : v; }
    default: return null;                          // strings and 64-bit integers: not needed here
  }
}
export function parseFit(buf) {
  const dv = new DataView(buf), len = buf.byteLength, pts = [];
  let pos = 0;
  while (pos + 12 <= len) {
    const hdr = dv.getUint8(pos), dataSize = dv.getUint32(pos + 4, true);
    if (hdr < 12 || String.fromCharCode(dv.getUint8(pos + 8), dv.getUint8(pos + 9), dv.getUint8(pos + 10), dv.getUint8(pos + 11)) !== ".FIT") break;
    const end = Math.min(len, pos + hdr + dataSize);
    let p = pos + hdr, lastTs = 0;
    const defs = new Array(16);
    while (p < end) {
      const h = dv.getUint8(p++);
      let def, ts = null;
      if (h & 0x80) {                                // compressed timestamp header: 5 bits of seconds since the last
        def = defs[(h >> 5) & 3];
        ts = (lastTs & ~0x1f) | (h & 0x1f);
        if (ts < lastTs) ts += 0x20;
        lastTs = ts;
      } else if (h & 0x40) {                         // definition message
        const local = h & 0xf, dev = !!(h & 0x20);
        p++;                                         // reserved
        const le = dv.getUint8(p++) === 0;
        const gmn = dv.getUint16(p, le); p += 2;
        const nf = dv.getUint8(p++), fields = [];
        let size = 0;
        for (let i = 0; i < nf; i++) { const f = { num: dv.getUint8(p), size: dv.getUint8(p + 1), type: dv.getUint8(p + 2), off: size }; fields.push(f); size += f.size; p += 3; }
        if (dev) { const nd = dv.getUint8(p++); for (let i = 0; i < nd; i++) { size += dv.getUint8(p + 1); p += 3; } }
        defs[local] = { gmn, le, fields, size };
        continue;
      } else def = defs[h & 0xf];
      if (!def) throw new Error("gpx");
      if (def.gmn === 20) {                          // record: a point
        const r = { lat: null, lon: null, ms: null, ele: null };
        for (const f of def.fields) {
          const v = readField(dv, p + f.off, f, def.le);
          if (v == null) continue;
          switch (f.num) {
            case 253: ts = v; lastTs = v; break;
            case 0: r.lat = v * (180 / 2147483648); break;
            case 1: r.lon = v * (180 / 2147483648); break;
            case 2: if (r.ele == null) r.ele = v / 5 - 500; break;
            case 78: r.ele = v / 5 - 500; break;
            case 3: r.hr = v; break;
            case 4: r.cad = v; break;
            case 13: r.temp = v; break;
            case 7: r.pw = v; break;
            default: break;
          }
        }
        if (ts != null) r.ms = (ts + FIT_EPOCH) * 1000;
        if (r.lat != null && r.lon != null && r.ms != null) pts.push(r);
      } else if (ts == null) {                       // another message's timestamp keeps the clock for compressed headers
        const f = def.fields.find((x) => x.num === 253);
        const v = f && readField(dv, p + f.off, f, def.le);
        if (v != null) lastTs = v;
      }
      p += def.size;
    }
    pos = end + 2;                                   // the file's CRC
  }
  return pts;
}

// ---- the track ------------------------------------------------------------------------------------------------------
function build(P0, source) {
  const located = P0.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.lat || p.lon));
  if (!located.length) throw new Error("gpx");
  const timed = located.filter((p) => Number.isFinite(p.ms)).sort((a, b) => a.ms - b.ms);
  if (timed.length < 2) throw new Error("time");
  const P = timed.filter((p, i) => !i || p.ms > timed[i - 1].ms);           // one point per instant
  const n = P.length, lat0 = P.reduce((s, p) => s + p.lat, 0) / n, lon0 = P.reduce((s, p) => s + p.lon, 0) / n;
  const kx = (Math.PI / 180) * R_EARTH * Math.cos((lat0 * Math.PI) / 180), ky = (Math.PI / 180) * R_EARTH;
  const tt = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n), cum = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tt[i] = (P[i].ms - P[0].ms) / 1000;
    x[i] = (P[i].lon - lon0) * kx;
    y[i] = -(P[i].lat - lat0) * ky;
  }
  const tr = { ms0: P[0].ms, t: tt, x, y, cum, v, n, lat0, lon0, kx, ky, dur: tt[n - 1], ch: {}, source };
  // the distance run: along the track smoothed over ± 3 s — the jitter of a 1 Hz trace adds metres at every step
  // (the trace is drawn raw); the pace: that distance over a window of ± 5 s
  let sx = x[0], sy = y[0];
  for (let i = 0; i < n; i++) {
    const a = indexAt(tr, tt[i] - 3), b = Math.min(n - 1, indexAt(tr, tt[i] + 3) + 1);
    let mx = 0, my = 0;
    for (let j = a; j <= b; j++) { mx += x[j]; my += y[j]; }
    mx /= b - a + 1; my /= b - a + 1;
    cum[i] = i ? cum[i - 1] + Math.hypot(mx - sx, my - sy) : 0;
    sx = mx; sy = my;
  }
  for (let i = 0; i < n; i++) {
    const a = indexAt(tr, tt[i] - 5), b = indexAt(tr, tt[i] + 5);
    v[i] = b > a && tt[b] > tt[a] ? (cum[b] - cum[a]) / (tt[b] - tt[a]) : 0;
  }
  // the extra channels, carried forward over the points without a value
  for (const c of CHANNELS) {
    if (!P.some((p) => p[c] != null)) continue;
    const a = new Float32Array(n);
    let lastV = P.find((p) => p[c] != null)[c];
    for (let i = 0; i < n; i++) { if (P[i][c] != null) lastV = P[i][c]; a[i] = lastV; }
    tr.ch[c] = a;
  }
  return tr;
}
/** lat/lon -> the track's local metres. */
export const toLocal = (tr, lat, lon) => [(lon - tr.lon0) * tr.kx, -(lat - tr.lat0) * tr.ky];
/** The last index whose time is ≤ s (0 before the trace). */
export function indexAt(tr, s) {
  let lo = 0, hi = tr.n - 1;
  if (s <= tr.t[0]) return 0;
  if (s >= tr.t[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr.t[m] <= s) lo = m; else hi = m; }
  return lo;
}
/** The position (metres) at trace time s, interpolated; clamped to the ends. */
export function posAt(tr, s) {
  const i = indexAt(tr, s);
  if (i >= tr.n - 1 || s <= tr.t[0]) return [tr.x[i], tr.y[i]];
  const f = (s - tr.t[i]) / (tr.t[i + 1] - tr.t[i]);
  return [tr.x[i] + f * (tr.x[i + 1] - tr.x[i]), tr.y[i] + f * (tr.y[i + 1] - tr.y[i])];
}
export const cumAt = (tr, s) => { const i = indexAt(tr, s); if (i >= tr.n - 1 || s <= tr.t[0]) return tr.cum[i];
  return tr.cum[i] + ((s - tr.t[i]) / (tr.t[i + 1] - tr.t[i])) * (tr.cum[i + 1] - tr.cum[i]); };
export const speedAt = (tr, s) => tr.v[indexAt(tr, s)];
/** A channel's value at trace time s (the last recorded), or null. */
export const valueAt = (tr, c, s) => (tr.ch[c] ? tr.ch[c][indexAt(tr, s)] : null);
/** A channel's mean between two trace times, or null. */
export function meanBetween(tr, c, s0, s1) {
  const a = tr.ch[c];
  if (!a) return null;
  const i0 = indexAt(tr, s0), i1 = indexAt(tr, s1);
  if (i1 <= i0) return a[i0];
  let s = 0;
  for (let i = i0; i <= i1; i++) s += a[i];
  return s / (i1 - i0 + 1);
}
