// Mapbox Vector Tiles read in the browser (Cartographier's national vectors, 2026-11-06: swisstopo's base vector tiles): a
// small Protocol Buffers reader for the tile's layers, features, tags and geometry commands (MVT 2.1), nothing more. A
// feature's geometry comes out in tile units (0 … extent, y down), its rings and lines as arrays of [x, y].

/** The protobuf reader: varints, lengths, fixed 32/64 bits. */
class Pbf {
  constructor(buf) { this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); this.p = 0; this.dv = new DataView(this.b.buffer, this.b.byteOffset, this.b.byteLength); }
  varint() {
    let v = 0, s = 1, c;
    do { c = this.b[this.p++]; v += (c & 0x7f) * s; s *= 128; } while (c & 0x80);
    return v;
  }
  svarint() { const v = this.varint(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  bytes() { const n = this.varint(), out = this.b.subarray(this.p, this.p + n); this.p += n; return out; }
  string() { return new TextDecoder().decode(this.bytes()); }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.p += this.varint();
    else if (wire === 5) this.p += 4;
    else throw new Error(`mvt: wire type ${wire}`);
  }
  /** Each field of the message ending at `end`: fn(tag, wire). */
  fields(end, fn) { while (this.p < end) { const k = this.varint(), at = this.p; fn(k >> 3, k & 7); if (this.p === at) this.skip(k & 7); } }
  packed() { const end = this.varint() + this.p, out = []; while (this.p < end) out.push(this.varint()); return out; }
}

function value(pbf) {
  const end = pbf.varint() + pbf.p;
  let v = null;
  pbf.fields(end, (tag, wire) => {
    if (tag === 1) v = pbf.string();
    else if (tag === 2) { v = pbf.dv.getFloat32(pbf.p, true); pbf.p += 4; }
    else if (tag === 3) { v = pbf.dv.getFloat64(pbf.p, true); pbf.p += 8; }
    else if (tag === 4 || tag === 5) v = pbf.varint();
    else if (tag === 6) v = pbf.svarint();
    else if (tag === 7) v = !!pbf.varint();
    else pbf.skip(wire);
  });
  return v;
}

/** Geometry commands into rings / lines / points ([[x, y]…] each). */
export function geometry(cmds) {
  const out = [];
  let x = 0, y = 0, cur = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < n; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += dx % 2 ? -(dx + 1) / 2 : dx / 2; y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
        if (id === 1) { cur = [[x, y]]; out.push(cur); } else cur.push([x, y]);
      }
    } else if (id === 7 && cur) cur.push([cur[0][0], cur[0][1]]);
  }
  return out;
}

/**
 * A tile's layers: { name: { extent, features: [{ id, type (1 point, 2 line, 3 polygon), props, parts }] } } — parts as
 * geometry() gives them. `want` (a Set of names) leaves the other layers unread.
 */
export function decodeTile(buf, want = null) {
  const pbf = new Pbf(buf), layers = {};
  pbf.fields(pbf.b.length, (tag, wire) => {
    if (tag !== 3) { pbf.skip(wire); return; }
    const end = pbf.varint() + pbf.p, keys = [], vals = [], raw = [];
    let name = "", extent = 4096;
    pbf.fields(end, (t, w) => {
      if (t === 1) name = pbf.string();
      else if (t === 3) keys.push(pbf.string());
      else if (t === 4) vals.push(value(pbf));
      else if (t === 5) extent = pbf.varint();
      else if (t === 2) { const fe = pbf.varint() + pbf.p; raw.push([pbf.p, fe]); pbf.p = fe; }
      else pbf.skip(w);
    });
    pbf.p = end;
    if (want && !want.has(name)) return;
    const features = raw.map(([s, e]) => {
      pbf.p = s;
      const f = { id: 0, type: 0, props: {}, parts: [] };
      let tags = [], cmds = [];
      pbf.fields(e, (t, w) => {
        if (t === 1) f.id = pbf.varint();
        else if (t === 2) tags = pbf.packed();
        else if (t === 3) f.type = pbf.varint();
        else if (t === 4) cmds = pbf.packed();
        else pbf.skip(w);
      });
      for (let i = 0; i + 1 < tags.length; i += 2) f.props[keys[tags[i]]] = vals[tags[i + 1]];
      f.parts = geometry(cmds);
      return f;
    });
    pbf.p = end;
    layers[name] = { extent, features };
  });
  return layers;
}

/** A polygon feature's parts grouped as polygons: each outer ring (positive area in tile units, y down) with its holes. */
export function polygons(parts) {
  const out = [];
  for (const r of parts) {
    let s = 0;
    for (let i = 1; i < r.length; i++) s += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1];
    if (s > 0 || !out.length) out.push([r]); else out[out.length - 1].push(r);
  }
  return out;
}
