// TIFF maps, which browsers do not open: a small baseline TIFF reader (no library) — strips or tiles, uncompressed, LZW,
// Deflate or PackBits, horizontal predictor, 1 to 16 bits per sample, grey, palette, RGB(A) and planar RGB — giving a
// canvas, the resolution the file declares, and a GeoTIFF's georeferencing when it has one (tie point and pixel scale, or a
// transformation matrix, with the EPSG code of its system: Lambert 93, UTM, WGS 84). JPEG-compressed and BigTIFF files
// are refused with a message (export the map as PNG, or as an uncompressed or LZW TIFF).

import { LAMBERT93 } from "../trace/georef.js";
import { t } from "./lang.js";

export const isTiff = (bytes) => { const a = bytes; return (a[0] === 0x49 && a[1] === 0x49 && a[2] === 42 && a[3] === 0) || (a[0] === 0x4d && a[1] === 0x4d && a[2] === 0 && a[3] === 42); };

// the messages (decodeTiff names its tags t)
const ERR = { big: () => t("trc.tif.bigTiff"), unreadable: () => t("trc.tif.unreadable"), size: () => t("trc.tif.tooBig"), jpeg: () => t("trc.tif.jpeg"),
  comp: (c) => t("trc.tif.compression", { c }), float: () => t("trc.tif.float") };

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

function readIfd(v, off, le) {
  const n = v.getUint16(off, le), tags = {};
  for (let i = 0; i < n; i++) {
    const e = off + 2 + i * 12, tag = v.getUint16(e, le), type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] || 1) * count, at = size <= 4 ? e + 8 : v.getUint32(e + 8, le);
    const vals = [];
    for (let k = 0; k < count && k < 1e7; k++) {
      const p = at + k * (TYPE_SIZE[type] || 1);
      if (p + (TYPE_SIZE[type] || 1) > v.byteLength) break;
      switch (type) {
        case 1: case 2: case 7: vals.push(v.getUint8(p)); break;
        case 6: vals.push(v.getInt8(p)); break;
        case 3: vals.push(v.getUint16(p, le)); break;
        case 8: vals.push(v.getInt16(p, le)); break;
        case 4: vals.push(v.getUint32(p, le)); break;
        case 9: vals.push(v.getInt32(p, le)); break;
        case 5: vals.push(v.getUint32(p, le) / (v.getUint32(p + 4, le) || 1)); break;
        case 10: vals.push(v.getInt32(p, le) / (v.getInt32(p + 4, le) || 1)); break;
        case 11: vals.push(v.getFloat32(p, le)); break;
        case 12: vals.push(v.getFloat64(p, le)); break;
        default: vals.push(0);
      }
    }
    tags[tag] = type === 2 ? String.fromCharCode(...vals).replace(/\0+$/, "") : vals;
  }
  return { tags, next: v.getUint32(off + 2 + n * 12, le) };
}

/** The dots per inch a TIFF declares, or 0. */
export function tiffDpi(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isTiff(a)) return 0;
  const v = new DataView(a.buffer, a.byteOffset, a.byteLength), le = a[0] === 0x49;
  try {
    const { tags: t } = readIfd(v, v.getUint32(4, le), le);
    const unit = t[296]?.[0] || 2, xr = t[282]?.[0] || 0;
    return xr > 1 ? Math.round((unit === 3 ? xr * 2.54 : unit === 2 ? xr : 0) * 10) / 10 : 0;
  } catch (e) { return 0; }
}

/** TIFF's LZW: codes MSB first, from 9 bits, « early change » (the width grows one code early). */
function lzw(src, expected) {
  const out = new Uint8Array(expected);
  let o = 0, bitPos = 0, width = 9;
  const dictPrefix = new Int32Array(4096), dictChar = new Uint8Array(4096), dictLen = new Uint16Array(4096);
  let next = 258, prev = -1;
  const total = src.length * 8;
  const read = () => {
    if (bitPos + width > total) return 257;
    let code = 0;
    for (let i = 0; i < width; i++) { const b = (src[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1; code = (code << 1) | b; }
    bitPos += width;
    return code;
  };
  const emit = (code) => {
    const len = code < 256 ? 1 : dictLen[code];
    let c = code;
    for (let i = len - 1; i >= 0; i--) { if (o + i < expected) out[o + i] = c < 256 ? c : dictChar[c]; c = c < 256 ? c : dictPrefix[c]; }
    o += len;
  };
  const first = (code) => { let c = code; while (c >= 256) c = dictPrefix[c]; return c; };
  for (let i = 0; i < 256; i++) dictLen[i] = 1;
  for (;;) {
    const code = read();
    if (code === 257 || o >= expected) break;
    if (code === 256) { next = 258; width = 9; prev = -1; continue; }
    if (prev < 0) { emit(code); prev = code; continue; }
    if (code < next) {
      emit(code);
      if (next < 4096) { dictPrefix[next] = prev; dictChar[next] = first(code); dictLen[next] = (prev < 256 ? 1 : dictLen[prev]) + 1; next++; }
    } else {
      const ch = first(prev);
      if (next < 4096) { dictPrefix[next] = prev; dictChar[next] = ch; dictLen[next] = (prev < 256 ? 1 : dictLen[prev]) + 1; next++; }
      emit(next - 1);
    }
    prev = code;
    if (next + 1 >= (1 << width) && width < 12) width++;
  }
  return out;
}
function packBits(src, expected) {
  const out = new Uint8Array(expected);
  let i = 0, o = 0;
  while (i < src.length && o < expected) {
    const n = (src[i] << 24) >> 24; i++;
    if (n >= 0) { for (let k = 0; k <= n && o < expected; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const b = src[i++]; for (let k = 0; k < 1 - n && o < expected; k++) out[o++] = b; }
  }
  return out;
}
async function inflate(src) {
  for (const fmt of ["deflate", "deflate-raw"]) {
    try { return new Uint8Array(await new Response(new Blob([src]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer()); } catch (e) { /* the other */ }
  }
  throw new Error("deflate");
}

/** Decode a TIFF: { canvas, width, height, dpi, world: { wf: [A, D, B, E, C, F], crs } | null }. */
export async function decodeTiff(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(a.buffer, a.byteOffset, a.byteLength);
  const le = a[0] === 0x49;
  if (v.getUint16(2, le) === 43) throw new Error(ERR.big());
  const { tags: t } = readIfd(v, v.getUint32(4, le), le);
  const W = t[256]?.[0], H = t[257]?.[0];
  if (!W || !H) throw new Error(ERR.unreadable());
  if (W * H > 160e6) throw new Error(ERR.size());
  const comp = t[259]?.[0] || 1, photo = t[262]?.[0] ?? 1, spp = t[277]?.[0] || 1, bps = t[258]?.[0] || 1;
  const planar = t[284]?.[0] || 1, pred = t[317]?.[0] || 1, fmt = t[339]?.[0] || 1;
  if (![1, 5, 8, 32946, 32773].includes(comp)) throw new Error(comp === 7 || comp === 6 ? ERR.jpeg() : ERR.comp(comp));
  if (fmt === 3) throw new Error(ERR.float());
  const tiled = !!t[322];
  const tw = tiled ? t[322][0] : W, th = tiled ? t[323][0] : (t[278]?.[0] || H);
  const offs = tiled ? t[324] : t[273], counts = tiled ? t[325] : t[279];
  if (!offs?.length) throw new Error(ERR.unreadable());
  const perPlane = planar === 2 ? 1 : spp;
  const rowBytes = Math.ceil((tw * perPlane * bps) / 8), chunkBytes = rowBytes * th;
  const across = Math.ceil(W / tw), down = Math.ceil(H / th), chunksPerPlane = across * down;
  // samples as 8 bits, interleaved, one plane per pass
  const samples = new Uint8Array(W * H * spp);
  for (let ci = 0; ci < offs.length; ci++) {
    const plane = planar === 2 ? Math.floor(ci / chunksPerPlane) : 0, k = ci % chunksPerPlane;
    const cx = (k % across) * tw, cy = Math.floor(k / across) * th;
    const raw = a.subarray(offs[ci], offs[ci] + (counts?.[ci] ?? chunkBytes));
    let d = comp === 1 ? raw : comp === 5 ? lzw(raw, chunkBytes) : comp === 32773 ? packBits(raw, chunkBytes) : await inflate(raw);
    if (pred === 2 && bps === 8) {
      d = new Uint8Array(d);
      for (let y = 0; y < th; y++) for (let x = perPlane; x < tw * perPlane; x++) { const p = y * rowBytes + x; if (p < d.length) d[p] = (d[p] + d[p - perPlane]) & 255; }
    } else if (pred === 2 && bps === 16) {
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength), out = new Uint8Array(d);
      const ov = new DataView(out.buffer);
      for (let y = 0; y < th; y++) for (let x = perPlane; x < tw * perPlane; x++) { const p = y * rowBytes + x * 2; if (p + 2 <= d.length) ov.setUint16(p, (ov.getUint16(p, le) + ov.getUint16(p - perPlane * 2, le)) & 0xffff, le); }
      d = out; void dv;
    }
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let y = 0; y < th && cy + y < H; y++) {
      for (let x = 0; x < tw && cx + x < W; x++) {
        for (let s = 0; s < perPlane; s++) {
          const idx = x * perPlane + s;
          let val;
          if (bps === 8) val = d[y * rowBytes + idx];
          else if (bps === 16) { const p = y * rowBytes + idx * 2; val = p + 2 <= d.length ? dv.getUint16(p, le) >> 8 : 0; }
          else { const bit = idx * bps, byte = d[y * rowBytes + (bit >> 3)] || 0; val = (byte >> (8 - bps - (bit & 7))) & ((1 << bps) - 1); }
          samples[((cy + y) * W + cx + x) * spp + (planar === 2 ? plane : s)] = val;
        }
      }
    }
  }
  // to RGBA
  const rgba = new Uint8ClampedArray(W * H * 4), cmap = t[320];
  const max = (1 << Math.min(bps, 8)) - 1, extra = t[338]?.[0];
  for (let i = 0, n = W * H; i < n; i++) {
    const s = i * spp, o = i * 4;
    if (photo === 2) { rgba[o] = samples[s]; rgba[o + 1] = samples[s + 1]; rgba[o + 2] = samples[s + 2]; rgba[o + 3] = spp > 3 ? samples[s + 3] : 255; if (spp > 3 && extra === 1 && rgba[o + 3]) { for (let c = 0; c < 3; c++) rgba[o + c] = Math.min(255, (rgba[o + c] * 255) / rgba[o + 3]); } }
    else if (photo === 3 && cmap) { const k = samples[s], m = cmap.length / 3; rgba[o] = cmap[k] >> 8; rgba[o + 1] = cmap[m + k] >> 8; rgba[o + 2] = cmap[2 * m + k] >> 8; rgba[o + 3] = 255; }
    else { let g = bps < 8 ? Math.round((samples[s] * 255) / max) : samples[s]; if (photo === 0) g = 255 - g; rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = spp > 1 ? samples[s + 1] : 255; }
  }
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.getContext("2d").putImageData(new ImageData(rgba, W, H), 0, 0);
  // resolution
  const unit = t[296]?.[0] || 2, xr = t[282]?.[0] || 0;
  const dpi = xr > 1 ? (unit === 3 ? xr * 2.54 : unit === 2 ? xr : 0) : 0;
  return { canvas, width: W, height: H, dpi: Math.round(dpi * 10) / 10, world: geoTiff(t) };
}

/** A GeoTIFF's world file (centre of the top-left pixel) and its system, or null. */
function geoTiff(t) {
  let wf = null;
  const tie = t[33922], sc = t[33550], mt = t[34264];
  const isPoint = geoKey(t, 1025) === 2;                     // RasterPixelIsPoint: the tie point is the pixel's centre
  if (mt?.length >= 16) wf = [mt[0], mt[4], mt[1], mt[5], mt[3] + (isPoint ? 0 : (mt[0] + mt[1]) / 2), mt[7] + (isPoint ? 0 : (mt[4] + mt[5]) / 2)];
  else if (tie?.length >= 6 && sc?.length >= 2) {
    const [I, J, , X, Y] = tie, [sx, sy] = sc;
    wf = [sx, 0, 0, -sy, X - I * sx + (isPoint ? 0 : sx / 2), Y + J * sy - (isPoint ? 0 : sy / 2)];
  }
  if (!wf) return null;
  const epsg = geoKey(t, 3072) || geoKey(t, 2048);
  let crs = null;
  if (epsg === 2154) crs = LAMBERT93;
  else if (epsg >= 32601 && epsg <= 32660) { const z = epsg - 32600; crs = { kind: "tm", lon0: z * 6 - 183, k0: 0.9996, lat0: 0, fe: 500000, fn: 0, name: `UTM ${z}` }; }
  else if (epsg >= 25828 && epsg <= 25838) { const z = epsg - 25800; crs = { kind: "tm", lon0: z * 6 - 183, k0: 0.9996, lat0: 0, fe: 500000, fn: 0, name: `UTM ${z} (ETRS89)` }; }
  else if (epsg === 4326 || epsg === 4171 || epsg === 4258) crs = { kind: "latlon", name: "WGS 84" };
  return { wf, crs, epsg: epsg || null };
}
function geoKey(t, key) {
  const d = t[34735];
  if (!d || d.length < 4) return 0;
  for (let i = 4; i + 3 < d.length; i += 4) if (d[i] === key) return d[i + 1] === 0 ? d[i + 3] : 0;
  return 0;
}
