"""The legibility check of a town sprint map (ISSprOM 2019-2), after OCAD's (since OCAD 2018): what the standard asks that the
generator may break, counted rule by rule with the first places in Lambert 93, and fixed where a fix is safe.

  py legibility.py <race> [--fix] [--in FILE] [--out FILE]     DATA/<race>/map_objects.json, the report DATA/<race>/src/legibility.json

town_map.py runs it on its objects before writing them (`check(doc, fix=True)`), so every town map — Pixel's races and
Cartographier's « Plan de ville (sprint) » — comes out checked. The rules (symbols, the 0.4 mm gap…) are
site/assets/js/mapper/sets/legibility.json, which Cartographier's checks (mapper/checks.js) read too; the minimum sizes per symbol
are minimums.json's (docs/mapper/sets.mjs, from the specification).

The rules, and what is fixed (with fix: two passes — a fix can leave a scrap the second takes —, then a plain check, so that
the report says what is really left; about 3.5 min on Gif's 1.4 km²):
- gap: two impassable features (buildings, uncrossable walls and fences, 520 olive, 411, water, 709) less than 0.4 mm apart
  (1.6 m at 1:4000; under 0.02 mm they touch: OCAD's grid is 0.01 mm) — the specification: closed or widened. Closed: a wall's or
  fence's end drawn on to what lies straight ahead of it (one beside it is reported: drawn sideways it made zigzags of short
  parallel pieces), the gap between areas filled with the area's symbol (two buildings: one building; olive on either side:
  olive) — long gaps by a closing, two corners near each other by the hull of their near parts; a gap a path, stairway or passage
  runs through is left for the mapper to widen (`gap_way`); the wedge where two features meet at an angle is a dead end, not a
  gap; a notch or a hole narrower than 0.4 mm in one feature is filled (`notch`); a bridge's sides, two short 515 lines along a
  deck (`decks`, else found by their shape: `bridge_sides`), are no gap;
- width / sliver: an area's part narrower than its symbol's minimum width (minimums.json, else 0.3 mm), and the white strips left
  between areas: a runnable area's strip goes to the neighbour sharing most of its edge, an impassable one (olive, 411, water) is
  widened to its minimum; a building's narrow part is reported only;
- area: an area under its symbol's minimum area: given to its neighbour (a building: reported);
- length: a line under its symbol's minimum length (reported);
- contour_end: a contour that ends in the open, not at a stairway or the map's edge (reported: the mapper's « not allowed »; a
  contour runs through the buildings and across the streets, and is cut only where it crosses a stairway — ISSprOM);
- overlap: a line (path, wall, fence, stream, edge) or a point (tree, monument) inside a building — cut out or dropped —, two
  point symbols drawn over each other (the smaller tree dropped), the LiDAR's vegetation over an area with a vector source
  (cut), any other two ground areas over each other (reported);
- bridge: 512.1 anywhere but at a passage's mouth (reported);
- stairs: a stairway not standing on paving: the paving drawn under it at its width;
- path_paved: a path (505, 506, a paved footway 501.6-501.9) drawn on paving: cut there.
Not yet redrawn after a fix: the paved area's edge (501.1) and the 995 boundaries keep their place where an area moved."""
import json, math, os, sys, time
from pathlib import Path

import shapely
import shapely.ops
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box as sbox
from shapely.ops import unary_union as _union


def unary_union(geoms):
    """shapely's, made tolerant: a geometry left invalid by a fix (a hole touching its shell) is made valid, else everything is
    snapped to a 1 cm grid — one bad piece must not stop a town's map."""
    geoms = [g for g in geoms if g is not None]
    try:
        return _union(geoms)
    except shapely.errors.GEOSException:
        geoms = [shapely.make_valid(g) for g in geoms]
        try:
            return _union(geoms)
        except shapely.errors.GEOSException:
            return shapely.union_all(geoms, grid_size=0.01)

HERE = Path(__file__).resolve()
SETS = HERE.parents[2] / "site" / "assets" / "js" / "mapper" / "sets"
RULES = json.load(open(SETS / "legibility.json", encoding="utf-8"))
MINS = json.load(open(SETS / "minimums.json", encoding="utf-8"))["issprom"]
SHOW = 5                                                       # places printed per rule


def code(sym):
    n, sub = divmod(int(sym), 1000)
    return f"{n}.{sub}" if sub else f"{n}"


def sym_of(c):
    n, _, sub = c.partition(".")
    return int(n) * 1000 + (int(sub) if sub else 0)


def mins(c):
    """A symbol's minimums (map mm), its own or its main number's."""
    return MINS.get(c) or MINS.get(c.split(".")[0]) or {}


def as_lines(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    if g.geom_type in ("MultiLineString", "GeometryCollection"):
        return [x for p in g.geoms for x in as_lines(p)]
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return as_lines(g.boundary)
    return []


def as_polys(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        return [x for p in g.geoms for x in as_polys(p)]
    return []


class Local:
    """Polygons indexed: the union of those near a geometry, not a whole class's (a town's paving is one huge polygon)."""
    def __init__(self, geoms):
        self.g = [q for g in geoms for p in as_polys(g) for q in as_polys(shapely.make_valid(p))]
        self.t = shapely.STRtree(self.g) if self.g else None

    def at(self, geom, pad=0.0, margin=3.0):
        """The polygons within `pad` of geom, cut to its box widened by pad + margin (an inward buffer of the result is right
        within `margin` of that box's edge)."""
        if self.t is None:
            return Polygon()
        x0, y0, x1, y1 = geom.bounds
        m = pad + margin
        ix = self.t.query(sbox(x0 - pad, y0 - pad, x1 + pad, y1 + pad))
        if not len(ix):
            return Polygon()
        parts = []
        for i in ix:
            try:
                parts.append(shapely.clip_by_rect(self.g[i], x0 - m, y0 - m, x1 + m, y1 + m))
            except shapely.errors.GEOSException:
                parts.append(self.g[i].intersection(sbox(x0 - m, y0 - m, x1 + m, y1 + m)))
        return shapely.make_valid(unary_union([q for q in parts if not q.is_empty]))


def opened_away(U, w):
    """The parts of U narrower than w (an opening by w/2, polygon by polygon)."""
    out = []
    for p in as_polys(U):
        if p.area < 0.3:
            continue
        o = p.buffer(-w / 2).buffer(w / 2)
        r = p.difference(o) if not o.is_empty else p
        out += as_polys(r)
    return out


def bridge_sides(by, decks=None):
    """The indexes of the 515 objects that are a bridge's sides: along a deck when the generator gives them, else two
    near-parallel 515 lines 1-6 m apart with water, a stream or the railway by them."""
    walls = [f for f in by.get(RULES["bridgeSides"]["line"], []) if f["otp"] == 2]
    if decks is not None and not getattr(decks, "is_empty", True):
        near = decks.buffer(1.0)
        return {f["i"] for f in walls if f["g"].intersection(near).length >= 0.5 * f["g"].length}
    lows = unary_union([f["g"] for c in RULES["bridgeSides"]["low"] for f in by.get(c, []) if f["g"] is not None])
    if lows.is_empty or not walls:
        return set()
    lo, hi = RULES["bridgeSides"]["apartM"]
    tree = shapely.STRtree([f["g"] for f in walls])
    out = set()

    def heading(g):
        (x0, y0), (x1, y1) = g.coords[0], g.coords[-1]
        return math.atan2(y1 - y0, x1 - x0)

    for j, f in enumerate(walls):
        if f["g"].length > RULES["bridgeSides"]["maxLengthM"] or f["g"].distance(lows) > 3.0:
            continue
        for m in tree.query(f["g"].buffer(hi)):
            g = walls[m]
            if m == j or g["g"].length > RULES["bridgeSides"]["maxLengthM"]:
                continue
            d = f["g"].distance(g["g"])
            a = abs((heading(f["g"]) - heading(g["g"]) + math.pi / 2) % math.pi - math.pi / 2)
            if lo <= d <= hi and a < math.radians(25) and g["g"].distance(f["g"].centroid) <= hi + 1:
                out |= {f["i"], g["i"]}
    return out


def overlaps(cover, codes_a, codes_b, min_area=0.05):
    """The pieces where an area of codes_a lies over one of codes_b: {(a, b): [polygons]} (an index, not whole-class
    intersections)."""
    polys, owner = [], []
    for c in set(codes_a) | set(codes_b):
        for p in as_polys(cover[c]):
            polys.append(p); owner.append(c)
    if not polys:
        return {}
    tree = shapely.STRtree(polys)
    out = {}
    ia, ib = tree.query(polys, predicate="intersects")
    for i, j in zip(ia, ib):
        a, b = owner[i], owner[j]
        if i >= j or a == b:
            continue
        if a not in codes_a or b not in codes_b:
            if b in codes_a and a in codes_b:
                a, b, i, j = b, a, j, i
            else:
                continue
        try:
            x = polys[i].intersection(polys[j])
        except shapely.errors.GEOSException:
            x = shapely.make_valid(polys[i]).intersection(shapely.make_valid(polys[j]))
        for q in as_polys(x):
            if q.area >= min_area:
                out.setdefault((a, b), []).append(q)
    return out


class Report:
    def __init__(self):
        self.found, self.fixed = {}, {}

    def add(self, rule, g, detail=""):
        p = g.representative_point() if not isinstance(g, Point) else g
        self.found.setdefault(rule, []).append({"at": [round(p.x, 1), round(p.y, 1)], "detail": detail})

    def fix(self, rule, n=1):
        self.fixed[rule] = self.fixed.get(rule, 0) + n

    def lines(self):
        out = []
        for rule in sorted(set(self.found) | set(self.fixed)):
            f, x = self.found.get(rule, []), self.fixed.get(rule, 0)
            out.append(f"  {rule:12s} {len(f):5d} left" + (f", {x} fixed" if x else ""))
            for it in f[:SHOW]:
                out.append(f"      E {it['at'][0]:.0f} N {it['at'][1]:.0f}  {it['detail']}")
        return out

    def json(self):
        return {"rules": {r: {"left": len(self.found.get(r, [])), "fixed": self.fixed.get(r, 0), "places": self.found.get(r, [])}
                          for r in sorted(set(self.found) | set(self.fixed))}}


def check(doc, fix=False, frame=None, log=print, passes=2, decks=None):
    """Checks a map_objects.json document; with fix, mends it in place in up to `passes` passes (a fix can leave a scrap the
    next one takes), then checks it once more so that the report says what is really left. decks: the bridges' decks (Lambert
    93), whose sides the generator draws as 515 (ISSprOM: « a simple bridge, which cannot be passed underneath, shall be
    represented using symbol Uncrossable wall »); without them, two near-parallel 515 lines 1-6 m apart by water, a stream or the
    railway are taken for a bridge's sides (as Cartographier's checks do)."""
    total = {}
    rep = None
    for n in range(passes if fix else 1):
        rep = _once(doc, fix, frame, log, f"pass {n + 1}" if fix else "check", areas_only=n > 0, decks=decks)
        for r, v in rep.fixed.items():
            total[r] = total.get(r, 0) + v
        if not fix or sum(rep.fixed.values()) == 0:
            break
    if fix and sum(rep.fixed.values()):
        rep = _once(doc, False, frame, log, "check", decks=decks)
    rep.fixed = total
    return rep


def _once(doc, fix, frame, log, what, areas_only=False, decks=None):
    """Checks (and with fix, mends) a map_objects.json document in place; returns the Report. Coordinates in map mm about
    doc['realWorld']; frame: the map's box in Lambert 93 (default the extent of its areas)."""
    k = doc["scale"] / 1000.0                                  # metres a map mm
    cx, cy = doc["realWorld"]["x"], doc["realWorld"]["y"]
    to_m = lambda pts: [(cx + x * k, cy + y * k) for x, y in pts]
    to_mm = lambda g: [[round((x - cx) / k, 3), round((y - cy) / k, 3)] for x, y in g.coords]
    rep = Report()
    objs = doc["objects"]
    t0 = time.time()
    step = lambda st: log(f"  legibility {what} [{time.time() - t0:5.1f}s] {st}") if log else None
    helpers = set(RULES["helpers"])

    # ---- the objects as geometries in metres
    F = []
    for i, o in enumerate(objs):
        c = code(o["sym"])
        try:
            if o["otp"] == 3:
                g = shapely.make_valid(Polygon(to_m(o["rings"][0]), [to_m(r) for r in o["rings"][1:] if len(r) >= 3]))
            elif o["otp"] == 2:
                g = LineString(to_m(o["rings"][0])) if len(o["rings"][0]) >= 2 else None
            else:
                g = Point(to_m(o["rings"][0])[0])
        except Exception:
            g = None
        F.append({"i": i, "c": c, "otp": o["otp"], "g": g})
    by = {}
    for f in F:
        if f["g"] is not None and not f["g"].is_empty:
            by.setdefault(f["c"], []).append(f)
    cover_codes = RULES["cover"]
    cover = {c: unary_union([f["g"] for f in by.get(c, []) if f["otp"] == 3]) for c in cover_codes + ["709"]}
    if frame is None:
        frame = sbox(*unary_union([g for g in cover.values() if not g.is_empty]).bounds)
    elif not hasattr(frame, "geom_type"):
        frame = sbox(*frame)
    changed = set()                                            # area codes rewritten from `cover`
    drop = set()                                               # indexes of objects removed or replaced
    new = []                                                   # objects added

    gap_m = RULES["gap"]["mm"] * k
    touch_m = RULES["gap"].get("touchMm", 0.02) * k               # closer: touching (OCAD's grid is 0.01 mm)
    gap_areas, gap_lines = RULES["gap"]["areas"], RULES["gap"]["lines"]
    hw = {c: RULES["gap"]["lineWidthMm"].get(c, 0.4) * k / 2 for c in gap_lines}
    ways = RULES["gap"]["ways"]
    WAYS = unary_union([f["g"] for c in ways for f in by.get(c, [])])
    PASS = unary_union([f["g"] for f in by.get(RULES["passage"], [])])
    ground = [c for c in cover_codes if c != "521"]
    impassable_ground = ("301", "411", "520")

    def line_feats(codes):
        return [f for c in codes for f in by.get(c, []) if f["otp"] == 2 and f["i"] not in drop]

    def set_line(f, g, rule):
        """Replaces a line object by `g`'s pieces (none: removed)."""
        o = objs[f["i"]]
        drop.add(f["i"])
        mn = 1.0 if f["c"] not in ("505", "506") else 3.0
        for l in as_lines(g):
            if l.length >= mn:
                n = {**o, "rings": [to_mm(l)]}
                n.pop("bez", None)                                 # (a map already curved: the piece goes straight)
                if o.get("curve") and len(l.coords) < 3:
                    n.pop("curve", None)
                new.append(n)

    step("loaded")
    # ---- 1. gap: a wall's or fence's end drawn on to what it stops short of
    def printed(f):
        return f["g"].buffer(hw[f["c"]], cap_style="flat") if f["otp"] == 2 else f["g"]

    # a bridge's sides (two short 515 lines over the water, a stream or the railway it crosses) are no gap to close: left out
    sides = bridge_sides(by, decks)
    imp = [f for c in gap_areas for f in by.get(c, []) if f["otp"] == 3] + [f for f in line_feats(gap_lines) if f["i"] not in sides]
    imp_g = [printed(f) for f in imp]
    # ---- 1a. holes narrower than the gap in an impassable area (what a merge left): filled
    for j, f in enumerate(imp):
        if f["otp"] != 3:
            continue
        holes, keep = [], []
        for p in as_polys(f["g"]):
            kept = []
            for ring in p.interiors:
                h = Polygon(ring)
                # (a hole under 0.1 m² is the rounding's, below OCAD's grid: dropped, not counted)
                if 0 < h.area < 0.1:
                    if fix:
                        holes.append(h)
                    continue
                (holes if h.area > 0 and h.buffer(-gap_m / 2).is_empty else kept).append(h if h.area > 0 else ring)
            keep.append((p, kept))
        if not holes:
            continue
        if fix:
            f["g"] = shapely.make_valid(unary_union([shapely.make_valid(Polygon(p.exterior, [h.exterior for h in kept if hasattr(h, "exterior")]))
                                                     for p, kept in keep]))
            imp_g[j] = f["g"]
            cover[f["c"]] = unary_union([cover[f["c"]]] + [h.buffer(0.05) for h in holes]); changed.add(f["c"])
            rep.fix("notch", sum(1 for h in holes if h.area >= 0.1))
        else:
            for h in holes:
                rep.add("notch", h, f"a hole of {h.area:.1f} m² in {f['c']}")
    # the areas cut into 25 m tiles for the search: a merged olive or paving is one polygon of thousands of points (pieces of
    # one feature touch, so they never make a gap between them)
    tiles = []
    for f, g in zip(imp, imp_g):
        if f["otp"] == 3 and g.area > 625:
            x0, y0, x1, y1 = g.bounds
            for tx in range(int((x1 - x0) // 25) + 1):
                for ty in range(int((y1 - y0) // 25) + 1):
                    q = shapely.clip_by_rect(g, x0 + tx * 25, y0 + ty * 25, x0 + (tx + 1) * 25, y0 + (ty + 1) * 25)
                    tiles += [(f, x) for x in as_polys(q)]
        else:
            tiles.append((f, g))
    imp, imp_g = [f for f, _ in tiles], [g if g.is_valid else shapely.make_valid(g) for _, g in tiles]
    tree = shapely.STRtree(imp_g)
    for j, f in enumerate(imp):
        if f["otp"] != 2:
            continue
        cs = list(f["g"].coords)
        moved = False
        for end in (0, -1):
            p = Point(cs[end])
            best = None
            for m in tree.query(p.buffer(gap_m + hw[f["c"]])):
                if m == j:
                    continue
                d = imp_g[m].distance(p)
                if touch_m < d < gap_m and (best is None or d < best[0]):
                    best = (d, m)
            if best is None:
                continue
            tgt = imp[best[1]]["g"] if imp[best[1]]["otp"] == 2 else imp_g[best[1]]
            q = shapely.ops.nearest_points(tgt.boundary if tgt.geom_type in ("Polygon", "MultiPolygon") else tgt, p)[0]
            seg = LineString([cs[end], (q.x, q.y)])
            # only straight on: a wall drawn sideways on to its neighbour makes a zigzag (short parallel pieces)
            prev = cs[1] if end == 0 else cs[-2]
            ux, uy = cs[end][0] - prev[0], cs[end][1] - prev[1]
            vx, vy = q.x - cs[end][0], q.y - cs[end][1]
            nu, nv = math.hypot(ux, uy), math.hypot(vx, vy)
            if nv > 0.02 and (nu < 1e-6 or (ux * vx + uy * vy) / (nu * nv) < 0.7):
                rep.add("gap", seg, f"{f['c']} end {best[0]:.1f} m from {imp[best[1]]['c']}, beside it")
                continue
            if not WAYS.is_empty and seg.intersects(WAYS):
                rep.add("gap_way", seg, f"{f['c']} end {best[0]:.1f} m from {imp[best[1]]['c']}, a way between")
                continue
            if fix:
                cs = [(q.x, q.y)] + cs if end == 0 else cs + [(q.x, q.y)]
                moved = True
                rep.fix("gap")
            else:
                rep.add("gap", seg, f"{f['c']} end {best[0]:.1f} m from {imp[best[1]]['c']}")
        if moved:
            f["g"] = LineString(cs)
            set_line(f, f["g"], "gap")
            imp_g[j] = printed(f)

    step("line ends")
    # ---- 1b. gap and notch between areas (and lines' sides): closing by half the gap
    I = unary_union(imp_g)
    r = gap_m / 2
    G = I.buffer(r).buffer(-r).difference(I).intersection(frame)
    tree = shapely.STRtree(imp_g)
    fills = {}
    def wedge(comp, touch):
        zone = comp.buffer(3 * gap_m)
        parts = [(imp[m]["i"], imp_g[m].intersection(zone)) for m in touch]
        for u in range(len(parts)):
            for v in range(u + 1, len(parts)):
                if parts[u][0] != parts[v][0] and not parts[u][1].is_empty and not parts[v][1].is_empty                         and parts[u][1].distance(parts[v][1]) <= touch_m:
                    return True
        return False

    # the closing bridges long gaps (a fence along a building); two corners near each other it barely touches: there, the
    # convex hull of both features' parts by their nearest points, less what is impassable already
    bridges = []
    done_pairs = set()
    for j, a in enumerate(imp_g):
        for m in tree.query(a.buffer(gap_m)):
            if m <= j or (j, m) in done_pairs:
                continue
            b = imp_g[m]
            dd = a.distance(b)
            if not (touch_m < dd < gap_m):
                continue
            done_pairs.add((j, m))
            p, q = shapely.ops.nearest_points(a, b)
            disk = LineString([p, q]).buffer(max(0.8, dd))
            bridges.append(shapely.make_valid(unary_union([a.intersection(disk), b.intersection(disk)])).convex_hull)
    if bridges:
        loose = []
        for x in bridges:
            x = shapely.make_valid(x)
            near_ = [imp_g[m] for m in tree.query(x)]
            loose.append(x.difference(unary_union(near_)) if near_ else x)
        G = unary_union([G] + loose).intersection(frame)
    for comp in as_polys(G):
        if comp.area < 0.02:
            continue
        touch = [m for m in tree.query(comp.buffer(0.05)) if imp_g[m].distance(comp) < 0.05]
        codes_t = {imp[m]["c"] for m in touch}
        feats_t = {imp[m]["i"] for m in touch}
        kind = "notch" if len(feats_t) <= 1 else "gap"
        # a notch in one feature counts from 0.3 m² (the closing also rounds every inner corner a little); a wedge between two
        # features however small (an olive's corner 0.8 m from a building)
        if kind == "notch" and (comp.area < 0.3 or comp.buffer(-0.05).is_empty):
            continue
        # the wedge where two features meet at an angle is a dead end, not a passage: no gap when they touch near it
        if kind == "gap" and wedge(comp, touch):
            continue
        if not WAYS.is_empty and comp.intersects(WAYS):
            rep.add("gap_way", comp, f"{kind} between {'/'.join(sorted(codes_t))}, a way through")
            continue
        areas_t = codes_t & set(gap_areas)
        fill = next((c for c in ("520", "521", "411", "709", "301") if c in areas_t), None)
        if areas_t == {"521"}:
            fill = "521"
        if fill is None:
            rep.add(kind, comp, f"between {'/'.join(sorted(codes_t))}")
            continue
        if fix:
            fills.setdefault(fill, []).append(comp.buffer(0.05))     # over its neighbours' edges: no hairline once rounded
            rep.fix(kind)
        else:
            rep.add(kind, comp, f"{comp.area:.1f} m² between {'/'.join(sorted(codes_t))}")
    if fills:
        cut_ground = unary_union([g for c, gs in fills.items() if c not in ("521", "709") for g in gs])
        for c, gs in fills.items():
            cover[c] = unary_union([cover[c]] + gs); changed.add(c)
        if not cut_ground.is_empty:
            for c in ground:
                if c not in fills and not cover[c].is_empty and cover[c].intersects(cut_ground):
                    cover[c] = shapely.make_valid(cover[c]).difference(cut_ground); changed.add(c)

    step("gaps")
    # ---- 1c. ground areas over each other: the LiDAR's vegetation (401-410) gives way to what has a vector source (water, 411,
    # paving, olive) — as the generator means it; any other pair is reported below
    raster_c = [c for c in ground if c.startswith("4") and c != "411"]
    vector_c = ["301", "411", "501", "501.4", "520"]
    if fix:
        for (a, b), x in overlaps(cover, raster_c, vector_c).items():
            cover[a] = shapely.make_valid(cover[a]).difference(unary_union(x)); changed.add(a)
            rep.fix("overlap", sum(1 for p in x if p.area >= 0.5))
    step("overlaps")
    # ---- 2. width, slivers and small areas
    def width_of(c):
        return (mins(c).get("width") or RULES["minWidthDefaultMm"]) * k

    idx = {}

    def local(c, geom, pad=0.0):
        if c not in idx:
            idx[c] = Local([cover[c]])
        return idx[c].at(geom, pad)

    def neighbour(s, own):
        best, bl = None, 0.02
        ring = s.boundary
        for d in ground + ["521"]:
            if d == own or cover[d].is_empty:
                continue
            bx = local(d, s, 0.1)
            if bx.is_empty or not bx.intersects(s.buffer(0.05)):
                continue
            l = ring.intersection(bx.buffer(0.05)).length
            if l > bl:
                best, bl = d, l
        return best

    moves = []                                                 # (sliver, from, to)
    widen = {}
    for c in ground + ["white"]:
        if c == "white":
            U = frame.difference(unary_union([cover[x] for x in cover_codes]))
        else:
            U = cover[c]
        if U.is_empty:
            continue
        w = width_of(c if c != "white" else "405")
        for s in opened_away(U, w * 0.95):
            if s.area < (0.05 if c == "white" else max(w * w * 0.6, 0.5)):
                continue
            if c == "white" and s.distance(frame.exterior) < 0.05:   # the map's edge, not a strip between areas
                continue
            rule = "sliver" if c == "white" else "width"
            if not fix:
                rep.add(rule, s, f"{c} {2 * s.area / max(s.length, 1e-6):.1f} m wide, minimum {w:.1f} m")
                continue
            if c in impassable_ground:
                est = 2 * s.area / max(s.length, 1e-6)
                widen.setdefault(c, []).append(s.buffer(max(0.0, (w - est) / 2 + 0.03)))
                rep.fix(rule)
                continue
            to = neighbour(s, c)
            if to is None:
                rep.add(rule, s, f"{c} {2 * s.area / max(s.length, 1e-6):.1f} m wide, no neighbour")
                continue
            moves.append((s, c, to)); rep.fix(rule)
    step("widths")
    # areas under their minimum area
    for c in ground + ["521"]:
        a_min = mins(c).get("area")
        if not a_min or cover[c].is_empty:
            continue
        a_min *= k * k
        for p in as_polys(cover[c]):
            if p.area >= a_min or p.area < 0.1:                  # (under 0.1 m²: below OCAD's 0.01 mm grid, noise)
                continue
            to = neighbour(p, c) if fix and c != "521" else None
            if to is None:
                rep.add("area", p, f"{c} {p.area:.1f} m², minimum {a_min:.1f} m²")
                continue
            moves.append((p, c, to)); rep.fix("area")
    if fix and (moves or widen):
        add, sub = {}, {}
        for s, a, b in moves:
            add.setdefault(b, []).append(s)
            if a != "white":
                sub.setdefault(a, []).append(s)
        for c, gs in widen.items():
            add.setdefault(c, []).extend(gs)
            wg = unary_union(gs)
            for d in ground:
                if d != c and cover[d].intersects(wg):
                    sub.setdefault(d, []).append(wg)
        for c, gs in sub.items():
            cover[c] = shapely.make_valid(cover[c]).difference(unary_union(gs)); changed.add(c)
        for c, gs in add.items():
            cover[c] = unary_union([cover[c]] + gs); changed.add(c)
        idx.clear()

    step("areas")
    # ---- 3. stairways on paving; paths off it
    k_stairs = [c for c in by if c.split(".")[0] == RULES["stairs"]]
    paved_ways = unary_union([f["g"].buffer(max(0.7, 0.5 * {"501.6": 1.4, "501.7": 2, "501.8": 3, "501.9": 4}[c]))
                              for c in RULES["pavedWays"] for f in by.get(c, [])])
    PAVE = Local([cover[c] for c in RULES["paving"]] + [paved_ways, PASS])
    under = []
    for f in line_feats(k_stairs):
        sub = f["c"].split(".")[1] if "." in f["c"] else "0"
        wmm = [0.4, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0][min(int(sub), 6)]
        g = f["g"]
        share = g.intersection(PAVE.at(g, 1).buffer(0.2)).length / max(g.length, 1e-6)
        if share >= RULES["stairsOnPavingShare"]:
            continue
        if fix:
            under.append(g.buffer(wmm * k / 2, cap_style="flat")); rep.fix("stairs")
        else:
            rep.add("stairs", g, f"{share:.0%} on paving")
    if under:
        U = unary_union(under).difference(local("521", unary_union(under))).intersection(frame)
        for c in ground:
            if c != "501" and not local(c, U).is_empty:
                cover[c] = shapely.make_valid(cover[c]).difference(U); changed.add(c); idx.pop(c, None)
        cover["501"] = unary_union([cover["501"], U]); changed.add("501"); idx.pop("501", None)
    PAVING = Local([cover[c] for c in RULES["paving"]])
    for f in line_feats(RULES["unpavedPaths"] + RULES["pavedWays"]):
        loc = PAVING.at(f["g"])
        if loc.is_empty:
            continue
        PAVE_IN = loc.buffer(-0.3)
        if not f["g"].intersects(PAVE_IN):
            continue
        on = f["g"].intersection(PAVE_IN).length
        if on < 1.0:
            continue
        if fix:
            set_line(f, f["g"].difference(PAVE_IN), "path_paved"); rep.fix("path_paved")
        else:
            rep.add("path_paved", f["g"].intersection(PAVE_IN), f"{f['c']} {on:.0f} m on paving")

    step("stairs and paths")
    # passes after the first mend the areas their fixes left (scraps, notches): the lines and points are done
    if not areas_only:
        # ---- 4. overlap: lines and points inside buildings, points over points, ground areas over each other
        B = cover["521"]
        BL = Local([B])
        PASS_B = PASS.buffer(0.5)

        def b_in(g):
            loc = BL.at(g)
            return loc.buffer(-0.3).difference(PASS_B) if not loc.is_empty else loc

        if not B.is_empty:
            for f in line_feats(RULES["notInBuildings"]):
                B_IN = b_in(f["g"])
                if f["i"] in drop or B_IN.is_empty or not f["g"].intersects(B_IN):
                    continue
                inside = f["g"].intersection(B_IN).length
                if inside < 0.5:
                    continue
                if fix:
                    set_line(f, f["g"].difference(B_IN), "overlap"); rep.fix("overlap")
                else:
                    rep.add("overlap", f["g"].intersection(B_IN), f"{f['c']} {inside:.1f} m inside a building")
            pts = [f for c in RULES["points"] for f in by.get(c, [])]
            for f in pts:
                if b_in(f["g"]).contains(f["g"]):
                    if fix and f["c"] in ("417", "418"):
                        drop.add(f["i"]); rep.fix("overlap")
                    else:
                        rep.add("overlap", f["g"], f"{f['c']} inside a building")
        step("lines in buildings")
        # point symbols drawn over each other: the trees thinned, the larger kept (a monument, a goal, a fountain first)
        rad = {c: v * k for c, v in RULES["points"].items()}
        pts = [f for c in ("526", "531", "311", "417", "418") for f in by.get(c, []) if f["i"] not in drop]
        cell, grid = 2 * max(rad.values()), {}

        def keep(g, c):
            grid.setdefault((int(g.x // cell), int(g.y // cell)), []).append((g, c))

        for f in pts:
            hit = None
            gx, gy = int(f["g"].x // cell), int(f["g"].y // cell)
            for g, c in (q for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in grid.get((gx + dx, gy + dy), [])):
                if g.distance(f["g"]) < rad[c] + rad[f["c"]]:
                    hit = c; break
            if hit is None:
                keep(f["g"], f["c"])
                continue
            if fix and f["c"] in ("417", "418"):
                drop.add(f["i"]); rep.fix("point_over")
            else:
                rep.add("point_over", f["g"], f"{f['c']} over {hit}")
                keep(f["g"], f["c"])
        step("points")
        for (a, b), x in overlaps(cover, ground, ground, 0.5).items():
            for p in x:
                rep.add("overlap", p, f"{a} over {b}, {p.area:.1f} m²")

        step("overlaps")
        # ---- 5. reported only: line lengths, contour ends, 512.1 away from a passage's mouth
        for c, fs in by.items():
            mn = mins(c).get("length")
            if not mn or c in helpers:
                continue
            for f in fs:
                if f["otp"] == 2 and f["i"] not in drop and f["g"].length < mn * k:
                    rep.add("length", f["g"], f"{c} {f['g'].length:.1f} m, minimum {mn * k:.1f} m")
        near_end = RULES["contourEndMm"] * k
        edge = frame.boundary
        _sw = lambda f: [0.4, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0][min(int(f["c"].split(".")[1]) if "." in f["c"] else 0, 6)]
        STL = Local([unary_union([f["g"].buffer(_sw(f) * k / 2 + 1.0, cap_style="flat") for f in line_feats(k_stairs)] or [Polygon()])])
        for f in line_feats(RULES["contours"]):
            cs = list(f["g"].coords)
            if len(cs) > 2 and Point(cs[0]).distance(Point(cs[-1])) < 0.05:
                continue
            for e in (cs[0], cs[-1]):
                p = Point(e)
                nb = STL.at(p, near_end + 0.1)
                if (nb.is_empty or nb.distance(p) > near_end) and edge.distance(p) > 1.0:
                    rep.add("contour_end", p, f"{f['c']} ends in the open")
        mouths = PASS.boundary if not PASS.is_empty else None
        for f in line_feats([RULES["bridgeMouth"]]):
            if mouths is None or mouths.distance(f["g"].centroid) > 1.5:
                rep.add("bridge", f["g"], "512.1 not at a passage's mouth")

        step("lengths, contours, bridges")
    # ---- write back
    if fix:
        for c in changed:
            for f in by.get(c, []):
                if f["otp"] == 3:
                    drop.add(f["i"])
            g = shapely.make_valid(cover[c]).intersection(frame)
            for p in as_polys(g):
                if p.area < 0.5:
                    continue
                rings = [to_mm(p.exterior)] + [to_mm(rr) for rr in p.interiors if Polygon(rr).area > 0.5]
                new.append({"sym": sym_of(c), "otp": 3, "rings": rings})
            if c == "521":                                     # the buildings' outlines again
                for f in by.get("521.9", []):
                    drop.add(f["i"])
                for p in as_polys(g):
                    if p.area >= 0.5:
                        for l in as_lines(p.boundary):
                            new.append({"sym": sym_of("521.9"), "otp": 2, "rings": [to_mm(l)]})
        doc["objects"] = [o for i, o in enumerate(objs) if i not in drop] + new
    return rep


def main():
    a = sys.argv[1:]
    race = a[0]
    DATA = Path(os.environ.get("VIRTUAL_DATA") or HERE.parents[4] / "data" / "virtual")
    if not DATA.exists():
        sys.path.insert(0, str(HERE.parents[2])); DATA = Path(__import__("paths").DATA_DIR) / "virtual"
    rd = DATA / race
    src = Path(a[a.index("--in") + 1]) if "--in" in a else rd / "map_objects.json"
    out = Path(a[a.index("--out") + 1]) if "--out" in a else src
    doc = json.load(open(src))
    fix = "--fix" in a
    rep = check(doc, fix=fix)
    print(f"legibility ({'fixed' if fix else 'checked'}): {src}")
    print("\n".join(rep.lines()))
    (rd / "src").mkdir(exist_ok=True)
    json.dump(rep.json(), open(rd / "src" / "legibility.json", "w"), indent=1)
    if fix:
        json.dump(doc, open(out, "w"))


if __name__ == "__main__":
    main()
