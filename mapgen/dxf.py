"""karttapullautin's vector outputs as a compact JSON, for Cartographier (2026-11-06): the contours, form lines, cliffs, dot
knolls and small depressions it writes as DXF beside its PNGs (batch mode with savetempfiles=1 and output_dxf=1: in out/,
<cloud>_contours.dxf, _formlines.dxf, _c2g.dxf, _c3g.dxf, _dotknolls.dxf; c3g's steep marks written apart since 2026-11-12,
<id>.<variant>.steep.json, run.vectors), cut to the tile's square kilometre (karttapullautin
runs a little into the neighbours), in Lambert 93.

The JSON, `t/<id>.<style>.vec.json`:
    {"v": 1, "id": "0391_6819", "style": "forest", "crs": "EPSG:2154", "x0": 391000, "y0": 6818000, "q": 0.1,
     "lines": {"contour": [[z, x, y, dx, dy, …], …], …}, "points": {"dotknoll": [x, y, dx, dy, …], …}}
coordinates in decimetres (q) from the tile's south-west corner (x0, y0) in the tile's system ("crs": Lambert 93 in France,
LV95, UTM or NZTM2000 beyond, mapgen/grids.py), each line's first point then the steps to the next,
z its height in decimetres (null when the DXF gives none); a point layer one flat list, the same way.

The helper contours (2026-11-12): karttapullautin's « basemap » contours (basemapinterval, every 0.5 or 1 m; <cloud>_basemap.dxf,
layer "cont", no heights), the same JSON with their one layer, written apart as t/<id>.<variant>.help.json, each line simplified
(Douglas-Peucker, HELP_TOL m: they are a guide to draw by, and half a tile's weight otherwise).

Only karttapullautin's output files are read: nothing of its code (GPL-3) is here."""
from __future__ import annotations

import json
from pathlib import Path

# what is kept of each file: its layers (karttapullautin's names)
FILES = {
    "contours": {"contour", "contour_index", "small_depression", "depression_intermed"},
    "formlines": {"formline"},
    "c2g": {"cliff2"},
    "c3g": {"cliff3"},
    "dotknolls": {"dotknoll", "uglydotknoll", "udepression", "uglyudepression"},
    "basemap": {"cont"},
}
HELP_TOL = 0.15
VERSION = 1
Q = 0.1


def entities(path: Path):
    """An ASCII DXF's POLYLINE (with its VERTEX), LWPOLYLINE, LINE and POINT entities: (kind, layer, z, [(x, y)…])."""
    lines = path.read_text(encoding="latin-1").splitlines()
    pairs = [(lines[i].strip(), lines[i + 1].strip()) for i in range(0, len(lines) - 1, 2)]
    i, n = 0, len(pairs)
    while i < n:
        code, val = pairs[i]
        if code != "0" or val not in ("POLYLINE", "LWPOLYLINE", "LINE", "POINT"):
            i += 1
            continue
        kind, layer, z, flags, pts = val, None, None, 0, []
        x = None
        i += 1
        while i < n and pairs[i][0] != "0":
            c, v = pairs[i]
            if c == "8" and layer is None:
                layer = v
            elif c == "38":
                z = float(v)
            elif c == "70":
                flags = int(float(v))
            elif kind in ("LWPOLYLINE", "POINT", "LINE") and c in ("10", "11"):
                x = float(v)
            elif kind in ("LWPOLYLINE", "POINT", "LINE") and c in ("20", "21") and x is not None:
                pts.append((x, float(v)))
                x = None
            elif kind == "POINT" and c == "30":
                z = float(v)
            i += 1
        if kind == "POLYLINE":
            while i < n and pairs[i] == ("0", "VERTEX"):
                i += 1
                vx = None
                while i < n and pairs[i][0] != "0":
                    c, v = pairs[i]
                    if c == "10":
                        vx = float(v)
                    elif c == "20" and vx is not None:
                        pts.append((vx, float(v)))
                    elif c == "30" and z is None:
                        z = float(v)
                    i += 1
            if i < n and pairs[i] == ("0", "SEQEND"):
                i += 1
        if flags & 1 and len(pts) > 2 and pts[0] != pts[-1]:
            pts.append(pts[0])
        if pts:
            yield kind, layer or "", z, pts


def clip(pts, x0, y0, x1, y1):
    """A polyline's pieces inside the box (Liang-Barsky, segment by segment)."""
    out, cur = [], None
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        t0, t1, ok = 0.0, 1.0, True
        for p, q in ((-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)):
            if p == 0:
                if q < 0:
                    ok = False
                    break
                continue
            r = q / p
            if p < 0:
                if r > t1:
                    ok = False
                    break
                t0 = max(t0, r)
            else:
                if r < t0:
                    ok = False
                    break
                t1 = min(t1, r)
        if not ok:
            if cur:
                out.append(cur)
                cur = None
            continue
        s, e = (ax + t0 * dx, ay + t0 * dy), (ax + t1 * dx, ay + t1 * dy)
        if cur is None or t0 > 0:
            if cur:
                out.append(cur)
            cur = [s]
        cur.append(e)
        if t1 < 1:
            out.append(cur)
            cur = None
    if cur:
        out.append(cur)
    return [p for p in out if len(p) >= 2]


def simplified(pts, tol: float):
    """Douglas-Peucker within tol (m), iterative."""
    if tol <= 0 or len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L = (dx * dx + dy * dy) ** 0.5
        best, at = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / L if L else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best:
                best, at = d, i
        if best > tol and at > 0:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def _encode(pts, x0, y0):
    """[x, y, dx, dy, …] in decimetres from (x0, y0), repeated points dropped."""
    q = []
    for x, y in pts:
        p = (round((x - x0) / Q), round((y - y0) / Q))
        if not q or p != q[-1]:
            q.append(p)
    if len(q) < 2:
        return None
    flat = [q[0][0], q[0][1]]
    for (ax, ay), (bx, by) in zip(q, q[1:]):
        flat += [bx - ax, by - ay]
    return flat


def tile_vectors(files: dict[str, Path], tid: str, x0: float, y1: float, style: str, size: float = 1000.0,
                 crs: str = "EPSG:2154", simplify: float = 0.0) -> dict:
    """The tile's vectors from karttapullautin's DXF files ({"contours": path, …}; missing ones skipped), cut to the tile,
    in the tile's system (crs: Lambert 93 in France, the grid's beyond: mapgen/grids.py); simplify: the lines' tolerance (m)."""
    y0, x1 = y1 - size, x0 + size
    lines: dict[str, list] = {}
    points: dict[str, list] = {}
    last: dict[str, tuple] = {}
    for name, path in files.items():
        keep = FILES.get(name, set())
        if not path or not path.exists():
            continue
        for kind, layer, z, pts in entities(path):
            if layer not in keep:
                continue
            zq = None if z is None or z != z else round(z / Q)          # karttapullautin writes NaN for some heights
            if kind == "POINT":
                x, y = pts[0]
                # half-open: a point on the border belongs to one tile only
                if not (x0 <= x < x1 and y0 < y <= y1):
                    continue
                p = (round((x - x0) / Q), round((y - y0) / Q))
                flat = points.setdefault(layer, [])
                if not flat:
                    flat += [p[0], p[1]]
                else:
                    a = last[layer]
                    flat += [p[0] - a[0], p[1] - a[1]]
                last[layer] = p
                continue
            for piece in clip(pts, x0, y0, x1, y1):
                enc = _encode(simplified(piece, simplify), x0, y0)
                if enc:
                    lines.setdefault(layer, []).append([zq] + enc)
    return {"v": VERSION, "id": tid, "style": style, "crs": crs, "x0": x0, "y0": y0, "q": Q, "lines": lines, "points": points}


def write(out: Path, data: dict) -> int:
    """The JSON written compactly; its size in bytes."""
    text = json.dumps(data, separators=(",", ":"))
    out.write_text(text, encoding="utf-8")
    return len(text)


def find(folder: Path, tid: str) -> dict[str, Path]:
    """karttapullautin's DXF files of a tile in its batch output folder."""
    out = {}
    for name in FILES:
        hit = next(iter(sorted(folder.glob(f"*{tid}*_{name}.dxf"))), None)
        if hit:
            out[name] = hit
    return out


if __name__ == "__main__":                              # py -3 -m mapgen.dxf <out folder> <tile id> <dest.json> [style]
    import sys
    folder, tid, dest = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    style = sys.argv[4] if len(sys.argv) > 4 else "forest"
    kx, ky = (int(v) for v in tid.split("_"))
    data = tile_vectors(find(folder, tid), tid, kx * 1000, ky * 1000, style)
    n = write(dest, data)
    print(tid, n, "bytes", {k: len(v) for k, v in data["lines"].items()}, {k: len(v) // 2 for k, v in data["points"].items()})
