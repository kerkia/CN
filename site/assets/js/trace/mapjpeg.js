// « Mes cartes » (Coach; owner, 2026-11-01): the JPEG files a runner's maps come in and go out as, read and written in the
// browser (pure functions: Uint8Array in, plain objects out; nothing here touches the page).
//
// - QuickRoute's JPEG (the files DOMA archives hold): the map with the route painted on it, under QuickRoute's header, and the
//   route itself in APP0 segments named « QuickRoute ». Read from the format's description (QuickRoute is GPL: none of its code
//   is used): the segments' payloads joined, then tag (u8), length (u32 LE), data; little-endian throughout. 1 version,
//   2 the map's corners (SW, NW, NE, SE) in longitude/latitude, 3 the picture's, 4 the map's place in the picture (u16 x, y, w,
//   h), 5 the sessions; a session's 7 route, 8 handles, 9 projection origin, 10 laps, 11 runner's info, 12 map-reading times.
//   A waypoint is placed on the map as QuickRoute drew it: by the matrix of the last handle at or before it (the last but one
//   at most: a handle's matrix holds from it to the next), applied to the
//   orthographic projection about the origin (ρ = 6 378 200 m); a session without handles was never adjusted: its points go
//   by the map's corners.
// - Ozimut's own file (`.jpg`): a JPEG anyone can open — the map with the routes drawn on it — whose APP9 segments named
//   « Ozimut » carry a zip: `ozimut-map.json` (the map's title, day, place, georeference, its runs as drawn) and the clean
//   map, byte for byte (`map.<ext>`). Ozimut reads it back as it was.

const QR_ID = "QuickRoute", OZ_ID = "Ozimut\0";
const OZ_MARKER = 0xe9;                         // APP9
const SEG_MAX = 65533 - 2;                      // a segment's payload, its length field apart
const enc = new TextEncoder(), dec = new TextDecoder();

/** A JPEG's segments before the image data: [{ marker, start (of the payload), end }]. */
function segments(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = [];
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) break;
    const m = b[p + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
    if (m === 0xda || m === 0xd9) break;          // the image data: no more segments to read
    const len = (b[p + 2] << 8) | b[p + 3];
    out.push({ marker: m, start: p + 4, end: p + 2 + len });
    p += 2 + len;
  }
  return out;
}
const startsWith = (b, at, s) => { for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false; return true; };

/** The payloads of the segments of a marker named `id`, joined (null when there is none). */
function payload(b, marker, id) {
  const segs = segments(b);
  if (!segs) return null;
  const parts = segs.filter((s) => s.marker === marker && startsWith(b, s.start, id)).map((s) => b.subarray(s.start + id.length, s.end));
  if (!parts.length) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** "quickroute", "ozimut" or null. */
export function kindOf(bytes) {
  const segs = segments(bytes);
  if (!segs) return null;
  if (segs.some((s) => s.marker === OZ_MARKER && startsWith(bytes, s.start, OZ_ID))) return "ozimut";
  if (segs.some((s) => s.marker === 0xe0 && startsWith(bytes, s.start, QR_ID))) return "quickroute";
  return null;
}

// ---- QuickRoute -------------------------------------------------------------------------------------------------------
const TICKS_1970 = 621355968000000000n;
class Reader {
  constructor(b) { this.b = b; this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); this.p = 0; }
  u8() { return this.b[this.p++]; }
  u16() { const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  i16() { const x = this.v.getInt16(this.p, true); this.p += 2; return x; }
  u32() { const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  i32() { const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  f64() { const x = this.v.getFloat64(this.p, true); this.p += 8; return x; }
  ll() { const lon = this.i32() / 3600000, lat = this.i32() / 3600000; return { lon, lat }; }
  // .NET DateTime.ToBinary(): the two top bits are the kind; the rest, ticks of 100 ns since 0001-01-01 (UTC)
  date() { const x = this.v.getBigUint64(this.p, true) & 0x3fffffffffffffffn; this.p += 8; return Number((x - TICKS_1970) / 10000n); }
  str() { const n = this.u16(); const s = dec.decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s; }
  /** The tags of a block: [[tag, Reader of its data]]. */
  tags(end = this.b.length) {
    const out = [];
    while (this.p + 5 <= end) {
      const tag = this.u8(), len = this.u32();
      out.push([tag, new Reader(this.b.subarray(this.p, Math.min(end, this.p + len)))]);
      this.p += len;
    }
    return out;
  }
}

function readRoute(r) {
  const attr = r.u16(), extra = r.u16(), nseg = r.u32(), segs = [];
  let last = null;
  for (let s = 0; s < nseg; s++) {
    const n = r.u32(), pts = [];
    for (let i = 0; i < n; i++) {
      const w = {};
      if (attr & 1) Object.assign(w, r.ll());
      if (attr & 2) {
        const type = r.u8();
        w.ms = type === 0 ? r.date() : (last ?? 0) + r.u16();
        last = w.ms;
      }
      if (attr & 4) w.hr = r.u8();
      if (attr & 8) w.ele = r.i16();
      r.p += extra;
      pts.push(w);
    }
    segs.push(pts);
  }
  return segs;
}
function readHandles(r) {
  const n = r.u32(), out = [];
  for (let i = 0; i < n; i++) {
    const m = Array.from({ length: 9 }, () => r.f64());
    const seg = r.u32(), value = r.f64();
    const x = r.f64(), y = r.f64(), type = r.i16();
    out.push({ m, seg, value, x, y, type });
  }
  return out;
}
const RHO = 6378200, RAD = Math.PI / 180;
/** QuickRoute's projection: the orthographic one about the origin, in metres. */
function project(ll, o) {
  const f = ll.lat * RAD, l = ll.lon * RAD, f0 = o.lat * RAD, l0 = o.lon * RAD;
  return [RHO * Math.cos(f) * Math.sin(l - l0), RHO * (Math.cos(f0) * Math.sin(f) - Math.sin(f0) * Math.cos(f) * Math.cos(l - l0))];
}

/** The least-squares affine map (lon, lat) -> (x, y) of pairs [[lon, lat, x, y]]: { a, b, c, d, e, f } (x = a lon + b lat + c). */
export function affineFit(pairs) {
  if (pairs.length < 3) return null;
  // centred for the conditioning
  const n = pairs.length, mlo = pairs.reduce((s, p) => s + p[0], 0) / n, mla = pairs.reduce((s, p) => s + p[1], 0) / n;
  let s11 = 0, s12 = 0, s22 = 0, sx1 = 0, sx2 = 0, sy1 = 0, sy2 = 0, mx = 0, my = 0;
  for (const [lo, la, x, y] of pairs) { mx += x / n; my += y / n; }
  for (const [lo, la, x, y] of pairs) {
    const u = lo - mlo, v = la - mla, X = x - mx, Y = y - my;
    s11 += u * u; s12 += u * v; s22 += v * v; sx1 += X * u; sx2 += X * v; sy1 += Y * u; sy2 += Y * v;
  }
  const det = s11 * s22 - s12 * s12;
  if (!(Math.abs(det) > 1e-18)) return null;
  const a = (sx1 * s22 - sx2 * s12) / det, b = (sx2 * s11 - sx1 * s12) / det;
  const d = (sy1 * s22 - sy2 * s12) / det, e = (sy2 * s11 - sy1 * s12) / det;
  return { a, b, c: mx - a * mlo - b * mla, d, e, f: my - d * mlo - e * mla };
}

/**
 * A QuickRoute JPEG -> { version, crop: { x, y, w, h } (the map in the picture), geo (lon, lat -> px of the map, from its
 * corners), sessions: [{ name, club, description, calibrated, segs: [[{ lon, lat, ms, hr, ele, x, y }]], laps: [{ ms, type }] }] }.
 * Throws "quickroute" when the data cannot be read.
 */
export function readQuickRoute(bytes) {
  const data = payload(bytes, 0xe0, QR_ID);
  if (!data) throw new Error("quickroute");
  try {
    const out = { version: "", crop: null, corners: null, geo: null, sessions: [] };
    for (const [tag, r] of new Reader(data).tags()) {
      if (tag === 1) out.version = Array.from(r.b.subarray(0, 4)).join(".");
      else if (tag === 2) out.corners = [r.ll(), r.ll(), r.ll(), r.ll()];            // SW, NW, NE, SE
      else if (tag === 4) out.crop = { x: r.u16(), y: r.u16(), w: r.u16(), h: r.u16() };
      else if (tag === 5) {
        const n = r.u32();
        for (const [st, sr] of r.tags()) if (st === 6 && out.sessions.length < n) out.sessions.push(readSession(sr));
      }
    }
    if (!out.crop) throw new Error("crop");
    const { w, h } = out.crop;
    if (out.corners) {
      const [sw, nw, ne, se] = out.corners;
      out.geo = affineFit([[sw.lon, sw.lat, 0, h], [nw.lon, nw.lat, 0, 0], [ne.lon, ne.lat, w, 0], [se.lon, se.lat, w, h]]);
    }
    for (const s of out.sessions) place(s, out.geo);
    return out;
  } catch (e) { throw new Error("quickroute"); }
}
function readSession(r) {
  const s = { name: "", club: "", description: "", segs: [], handles: [], origin: null, laps: [] };
  for (const [tag, t] of r.tags()) {
    if (tag === 7) s.segs = readRoute(t);
    else if (tag === 8) s.handles = readHandles(t);
    else if (tag === 9) s.origin = t.ll();
    else if (tag === 10) { const n = t.u32(); for (let i = 0; i < n; i++) s.laps.push({ ms: t.date(), type: t.u8() }); }
    else if (tag === 11) { s.name = t.str(); s.club = t.str(); t.u32(); s.description = t.str(); }
  }
  return s;
}
/** Each waypoint's place on the map as QuickRoute drew it. */
function place(s, geo) {
  const H = s.handles.slice().sort((a, b) => a.seg - b.seg || a.value - b.value);
  s.calibrated = H.length > 0 && !!s.origin;
  s.segs.forEach((pts, si) => pts.forEach((w, i) => {
    if (w.lon == null) return;
    if (s.calibrated) {
      // the last handle at or before the point, the last but one at most (each handle's matrix holds from it to the next)
      let k = 0;
      while (k + 1 < H.length - 1 && (H[k + 1].seg < si || (H[k + 1].seg === si && H[k + 1].value <= i))) k++;
      const h = H[k];
      const [x, y] = project(w, s.origin), m = h.m;
      w.x = m[0] * x + m[1] * y + m[2]; w.y = m[3] * x + m[4] * y + m[5];
      const z = m[6] * x + m[7] * y + m[8];
      if (Math.abs(z) > 1e-12 && Math.abs(z - 1) > 1e-9) { w.x /= z; w.y /= z; }
    } else if (geo) {
      w.x = geo.a * w.lon + geo.b * w.lat + geo.c; w.y = geo.d * w.lon + geo.e * w.lat + geo.f;
    }
  }));
  delete s.handles;
}

// ---- Ozimut's file ----------------------------------------------------------------------------------------------------
/** The zip an Ozimut JPEG carries (Uint8Array), or null. */
export const ozimutPayload = (bytes) => payload(bytes, OZ_MARKER, OZ_ID);

/** A JPEG (Uint8Array) with `data` (Uint8Array) in APP9 « Ozimut » segments, put after its APP0/APP1 segments. */
export function withOzimut(jpeg, data) {
  const segs = segments(jpeg);
  if (!segs) throw new Error("jpeg");
  // after the JFIF/Exif head, before anything else: the place readers look first
  let at = 2;
  for (const s of segs) { if (s.marker === 0xe0 || s.marker === 0xe1) at = s.end; else break; }
  const id = enc.encode(OZ_ID), per = SEG_MAX - id.length, n = Math.ceil(data.length / per) || 1;
  const out = new Uint8Array(jpeg.length + data.length + n * (4 + id.length));
  out.set(jpeg.subarray(0, at), 0);
  let o = at;
  for (let i = 0; i < n; i++) {
    const part = data.subarray(i * per, (i + 1) * per), len = 2 + id.length + part.length;
    out[o] = 0xff; out[o + 1] = OZ_MARKER; out[o + 2] = len >> 8; out[o + 3] = len & 255;
    out.set(id, o + 4); out.set(part, o + 4 + id.length);
    o += 2 + len;
  }
  out.set(jpeg.subarray(at), o);
  return out.subarray(0, o + jpeg.length - at);
}
