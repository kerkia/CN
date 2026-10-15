// GIF (89a) writer for the course images (Purple Pen writes GIF beside PNG and JPEG; browsers cannot): the colours reduced to
// a palette of 256 — the exact colours when there are no more, else a median cut over a histogram of 5 bits per channel —,
// each pixel given its nearest palette colour without dithering (a map's flat colours stay flat), then LZW-compressed with
// codes of 3 to 12 bits, as the format says.

/** A GIF file of RGBA pixels (transparent pixels count as white). */
export function encodeGif(rgba, w, h) {
  const n = w * h, rgb = new Uint32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = rgba[j + 3] / 255, r = Math.round(rgba[j] * a + 255 * (1 - a)), g = Math.round(rgba[j + 1] * a + 255 * (1 - a)), b = Math.round(rgba[j + 2] * a + 255 * (1 - a));
    rgb[i] = (r << 16) | (g << 8) | b;
  }
  const { palette, index } = quantize(rgb);
  const idx = new Uint8Array(n);
  for (let i = 0; i < n; i++) idx[i] = index(rgb[i]);
  // the palette is written at a power of two, at least 4 entries (the LZW codes start at 2 bits + 1)
  let bits = 2;
  while (1 << bits < palette.length) bits++;
  const out = new Bytes();
  out.str("GIF89a"); out.u16(w); out.u16(h);
  out.u8(0x80 | ((bits - 1) << 4) | (bits - 1)); out.u8(0); out.u8(0);
  for (let i = 0; i < 1 << bits; i++) { const c = palette[i] ?? 0; out.u8((c >> 16) & 255); out.u8((c >> 8) & 255); out.u8(c & 255); }
  out.u8(0x2c); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.u8(0);
  out.u8(bits);
  const data = lzw(idx, bits);
  for (let i = 0; i < data.length; i += 255) { const k = Math.min(255, data.length - i); out.u8(k); out.bytes(data.subarray(i, i + k)); }
  out.u8(0); out.u8(0x3b);
  return out.done();
}

class Bytes {
  constructor() { this.a = new Uint8Array(1 << 16); this.n = 0; }
  room(k) { if (this.n + k > this.a.length) { const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  u8(v) { this.room(1); this.a[this.n++] = v; }
  u16(v) { this.u8(v & 255); this.u8((v >> 8) & 255); }
  str(s) { for (const c of s) this.u8(c.charCodeAt(0)); }
  bytes(b) { this.room(b.length); this.a.set(b, this.n); this.n += b.length; }
  done() { return this.a.slice(0, this.n); }
}

/** The palette (24-bit colours) and a function giving a colour's palette index. */
function quantize(rgb) {
  const seen = new Map();
  for (let i = 0; i < rgb.length && seen.size <= 256; i++) if (!seen.has(rgb[i])) seen.set(rgb[i], seen.size);
  if (seen.size <= 256) return { palette: [...seen.keys()], index: (c) => seen.get(c) };
  // median cut over 15-bit buckets, each keeping its pixels' count and colour sums
  const cnt = new Float64Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  const bucket = (c) => (((c >> 19) & 31) << 10) | (((c >> 11) & 31) << 5) | ((c >> 3) & 31);
  for (const c of rgb) { const k = bucket(c); cnt[k]++; sr[k] += (c >> 16) & 255; sg[k] += (c >> 8) & 255; sb[k] += c & 255; }
  const used = [];
  for (let k = 0; k < 32768; k++) if (cnt[k]) used.push(k);
  const ch = (k, a) => (a === 0 ? k >> 10 : a === 1 ? (k >> 5) & 31 : k & 31);
  const boxOf = (list) => {
    const lo = [31, 31, 31], hi = [0, 0, 0]; let total = 0;
    for (const k of list) { total += cnt[k]; for (let a = 0; a < 3; a++) { const v = ch(k, a); if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; } }
    return { list, lo, hi, total };
  };
  const boxes = [boxOf(used)];
  while (boxes.length < 256) {
    // the box to split: the most pixels times its widest side (a box of one colour cannot be split)
    let best = -1, bestScore = 0;
    boxes.forEach((b, i) => { const span = Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]); const s = span > 0 ? b.total * span : 0; if (s > bestScore) { bestScore = s; best = i; } });
    if (best < 0) break;
    const b = boxes[best], spans = [0, 1, 2].map((a) => b.hi[a] - b.lo[a]), a = spans.indexOf(Math.max(...spans));
    const sorted = b.list.slice().sort((p, q) => ch(p, a) - ch(q, a));
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) { acc += cnt[sorted[i]]; if (acc >= b.total / 2) { cut = i + 1; break; } cut = i + 1; }
    boxes.splice(best, 1, boxOf(sorted.slice(0, cut)), boxOf(sorted.slice(cut)));
  }
  const palette = boxes.map((b) => {
    let r = 0, g = 0, bl = 0, t = 0;
    for (const k of b.list) { r += sr[k]; g += sg[k]; bl += sb[k]; t += cnt[k]; }
    return (Math.round(r / t) << 16) | (Math.round(g / t) << 8) | Math.round(bl / t);
  });
  const cache = new Int16Array(32768).fill(-1);
  const index = (c) => {
    const k = bucket(c);
    if (cache[k] >= 0) return cache[k];
    const r = ((k >> 10) << 3) + 4, g = (((k >> 5) & 31) << 3) + 4, bl = ((k & 31) << 3) + 4;
    let best = 0, bd = Infinity;
    palette.forEach((p, i) => { const d = (((p >> 16) & 255) - r) ** 2 * 3 + (((p >> 8) & 255) - g) ** 2 * 4 + ((p & 255) - bl) ** 2 * 2; if (d < bd) { bd = d; best = i; } });
    cache[k] = best;
    return best;
  };
  return { palette, index };
}

/** LZW with GIF's variable-length codes, least significant bit first; a clear code when the table is full. */
function lzw(idx, minBits) {
  const clear = 1 << minBits, eoi = clear + 1, out = [];
  let size = minBits + 1, next = eoi + 1, acc = 0, nb = 0;
  const dict = new Map();
  const emit = (code) => { acc |= code << nb; nb += size; while (nb >= 8) { out.push(acc & 255); acc >>>= 8; nb -= 8; } };
  emit(clear);
  if (!idx.length) { emit(eoi); if (nb > 0) out.push(acc & 255); return Uint8Array.from(out); }
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = prefix * 256 + k, c = dict.get(key);
    if (c !== undefined) { prefix = c; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > 1 << size && size < 12) size++; }
    else { emit(clear); dict.clear(); size = minBits + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (nb > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}
