"""OpenStreetMap's man-made features and water over a generated map: what LiDAR cannot tell — roads, paths and their
kinds, buildings, walls and fences, railways, power lines, lakes and streams — read from the Overpass API for the area
and drawn in ISOM 2017-2's symbols at 1:10 000 (600 dpi, 23.6 px a millimetre: the karttapullautin render's scale).

© OpenStreetMap contributors, ODbL: the map says so wherever it is shown."""
from __future__ import annotations

import math
import time

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from . import lambert93

# public Overpass servers, tried in turn: any of them may answer 502/504 or time out when busy
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter")
UA = "Ozimut map generator (https://ozimut.com; contact@ozimut.com)"

# ISOM 2017-2's colours (site/assets/js/isom.js)
BLACK, BROWN50, BLUE, GREY65 = (28, 28, 28), (232, 191, 152), (0, 160, 226), (107, 107, 107)
WHITE = (255, 255, 255)

WIDE = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link",
        "secondary_link", "tertiary_link"}
ROAD = {"residential", "unclassified", "service", "living_street", "road", "busway"}
PATH = {"path", "footway", "bridleway", "cycleway", "steps", "pedestrian", "corridor"}
FAINT = {"bad", "horrible", "no"}
WATER_LINE = {"river": 0.5, "canal": 0.5, "stream": 0.25, "ditch": 0.18, "drain": 0.18}


def query(s: float, w: float, n: float, e: float, http: httpx.Client | None = None) -> dict:
    """The area's features, with their geometry (Overpass `out geom`)."""
    b = f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}"
    q = f"""[out:json][timeout:90];
(
  way["highway"]({b});
  way["building"]({b}); relation["building"]({b});
  way["natural"="water"]({b}); relation["natural"="water"]({b});
  way["landuse"~"^(reservoir|basin)$"]({b}); relation["landuse"~"^(reservoir|basin)$"]({b});
  way["waterway"]({b}); relation["waterway"="riverbank"]({b});
  way["railway"]({b});
  way["power"="line"]({b});
  way["barrier"~"^(wall|city_wall|retaining_wall|fence)$"]({b});
  way["amenity"="parking"]({b}); relation["amenity"="parking"]({b});
  way["area:highway"]({b});
  way["place"="square"]({b});
  way["landuse"~"^(grass|village_green|recreation_ground|meadow|greenfield|residential)$"]({b});
  relation["landuse"~"^(grass|village_green|recreation_ground|meadow|residential)$"]({b});
  way["leisure"~"^(park|playground|pitch|garden|common|dog_park)$"]({b}); relation["leisure"~"^(park|garden|common)$"]({b});
  way["natural"="grassland"]({b});
  way[~"^(landuse|leisure|amenity)$"~"."]["access"~"^(private|no)$"]({b});
);
out geom;"""
    own = http is None
    http = http or httpx.Client(timeout=120, headers={"User-Agent": UA})
    err = None
    try:
        for attempt in range(6):
            try:
                r = http.post(OVERPASS[attempt % len(OVERPASS)], data={"data": q}, timeout=120)
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, ValueError) as ex:
                err = ex
                time.sleep(5 * (attempt + 1))
        raise RuntimeError(f"Overpass: {err}")
    finally:
        if own:
            http.close()


def _rings(rel: dict) -> list[tuple[str, list]]:
    """A multipolygon's rings, its member ways joined end to end: [(role, [(lat, lon)…])]."""
    out = []
    for role in ("outer", "inner"):
        parts = [[(p["lat"], p["lon"]) for p in m.get("geometry") or []] for m in rel.get("members", [])
                 if m.get("type") == "way" and (m.get("role") or "outer") == role and m.get("geometry")]
        while parts:
            ring = parts.pop(0)
            grown = True
            while ring[0] != ring[-1] and grown:
                grown = False
                for i, p in enumerate(parts):
                    if p[0] == ring[-1]:
                        ring += p[1:]
                    elif p[-1] == ring[-1]:
                        ring += p[-2::-1]
                    elif p[-1] == ring[0]:
                        ring = p[:-1] + ring
                    elif p[0] == ring[0]:
                        ring = p[:0:-1] + ring
                    else:
                        continue
                    parts.pop(i)
                    grown = True
                    break
            if len(ring) >= 3:
                out.append((role, ring))
    return out


# the ground a sprint map fills (only it: a forest map keeps the LiDAR's): public open land, pitches and playgrounds, private
# ground, and the residential blocks whose unbuilt ground near the houses is gardens
GROUND = ("open", "pitch", "private", "residential")
OPEN_LANDUSE = {"grass", "village_green", "recreation_ground", "meadow", "greenfield"}
SIDES = {"both": 2, "left": 1, "right": 1}           # a street's sidewalks its own way does not draw


def _ground(tg: dict) -> str | None:
    lu, le = tg.get("landuse"), tg.get("leisure")
    if tg.get("access") in ("private", "no") and (lu or le or tg.get("amenity")):
        return "private"
    if le == "garden" and tg.get("garden:type") in ("residential", "private"):
        return "private"
    if le in ("pitch", "playground"):
        return "pitch"
    if lu in OPEN_LANDUSE or le in ("park", "common", "dog_park", "garden") or tg.get("natural") == "grassland":
        return "open"
    if lu == "residential":
        return "residential"
    return None


def features(data: dict) -> list[dict]:
    """The drawable features: {kind, area?, rings | line} in [lat, lon], tunnels and things underground left out."""
    out = []
    for el in data.get("elements", []):
        tg = el.get("tags") or {}
        if tg.get("tunnel") not in (None, "no") or tg.get("location") == "underground" or tg.get("layer", "0").startswith("-"):
            continue
        hw, ww = tg.get("highway"), tg.get("waterway")
        kind = None
        if tg.get("building") in ("roof", "carport") or tg.get("building:part") == "roof":
            kind = "canopy"
        elif tg.get("building") not in (None, "no"):
            kind = "building"
        elif tg.get("natural") == "water" or tg.get("landuse") in ("reservoir", "basin") or ww == "riverbank":
            kind = "water"
        elif tg.get("amenity") == "parking" or tg.get("area:highway") or tg.get("place") == "square" \
                or (hw in ("pedestrian", "footway") and tg.get("area") == "yes"):
            kind = "paved"
        elif hw in WIDE:
            kind = "wide"
        elif hw in ROAD:
            kind = "road"
        elif hw == "track":
            kind = "track"
        elif hw in PATH:
            if tg.get("footway") == "crossing":
                continue
            # a sidewalk mapped as its own way: a sprint map's paved area, nothing on a forest map (the street says it)
            kind = "sidewalk" if tg.get("footway") == "sidewalk" or tg.get("path") == "sidewalk" else "smallpath" if tg.get("trail_visibility") in FAINT or tg.get("informal") == "yes" else "path"
        elif ww in WATER_LINE:
            kind = "stream:" + ww
        elif tg.get("railway") in ("rail", "light_rail", "narrow_gauge", "tram", "subway"):
            kind = "rail"
        elif tg.get("power") == "line":
            kind = "power"
        elif tg.get("barrier") in ("wall", "city_wall"):
            kind = "wall"
        elif tg.get("barrier") == "retaining_wall":
            kind = "lowwall"
        elif tg.get("barrier") == "fence":
            kind = "fence"
        if not kind:
            kind = _ground(tg)
        if not kind:
            continue
        area = kind in ("building", "canopy", "water", "paved") or kind in GROUND
        if el["type"] == "relation":
            if area:
                out.append({"kind": kind, "rings": _rings(el)})
            continue
        pts = [(p["lat"], p["lon"]) for p in el.get("geometry") or []]
        if len(pts) < 2:
            continue
        if area:
            if pts[0] == pts[-1] and len(pts) >= 4:
                out.append({"kind": kind, "rings": [("outer", pts)]})
        else:
            out.append({"kind": kind, "line": pts, "hw": hw, "paved": paved(hw, tg.get("surface")), "width": _width(tg.get("width")),
                        "sides": SIDES.get(tg.get("sidewalk") or tg.get("sidewalk:both") or "", 0)})
    return out


def project(feats: list[dict], forward=None) -> list[dict]:
    """Every [lat, lon] in Lambert 93 metres (X, Y), or in the tiles' own system by forward(lat, lon) -> (X, Y) (beyond
    France: mapgen/grids.py), once for all the tiles."""
    fwd = forward or lambert93.forward

    def pr(pts):
        return [fwd(a, b) for a, b in pts]
    for f in feats:
        if "rings" in f:
            f["rings"] = [(r, pr(p)) for r, p in f["rings"]]
        else:
            f["line"] = pr(f["line"])
    return feats


def _dashed(d: ImageDraw.ImageDraw, pts, w: int, col, dash: float, gap: float) -> None:
    """A dashed line (lengths in px), the pattern running on along the whole line."""
    on, left = True, dash
    cur = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        t = 0.0
        while seg - t > left:
            t += left
            p = (x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg)
            if on:
                cur.append(p)
                d.line(cur, fill=col, width=w, joint="curve")
            cur = [p]
            on = not on
            left = dash if on else gap
        left -= seg - t
        if on:
            cur.append((x1, y1))
        else:
            cur = [(x1, y1)]
    if on and len(cur) > 1:
        d.line(cur, fill=col, width=w, joint="curve")


# ISSprOM 2019-2's sprint colours (site/assets/js/isom.js SC): paved areas, buildings, canopies
BROWN30, GREY50, GREY20 = (243, 219, 196), (154, 154, 154), (214, 214, 214)
PAVED = {"paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone",
         "unhewn_cobblestone", "metal", "wood", "bricks", "stone"}
UNPAVED = {"unpaved", "gravel", "fine_gravel", "compacted", "dirt", "earth", "ground", "grass", "sand", "mud", "pebblestone",
           "woodchips", "grass_paver", "rock"}
# a street's width on the ground (m) when OSM gives none, by its class: what a sprint map draws as paved area
STREET_W = {"motorway": 14, "trunk": 13, "primary": 12, "secondary": 10, "tertiary": 8, "residential": 6.5, "unclassified": 6,
            "living_street": 5, "road": 6, "busway": 6, "service": 4, "pedestrian": 6, "footway": 2.5, "cycleway": 2.5,
            "steps": 2.5, "path": 2, "bridleway": 2.5, "track": 3, "corridor": 2}


def paved(hw: str | None, surface: str | None) -> bool:
    """Whether a way is paved: its surface when OSM says, else its class (roads and footways yes, paths and tracks no)."""
    if surface in PAVED:
        return True
    if surface in UNPAVED:
        return False
    return hw not in ("path", "track", "bridleway")


def _width(v: str | None) -> float | None:
    """OSM's width in metres (« 4 », « 4.5 m », « 4,5 »), else None."""
    try:
        w = float(str(v).replace(",", ".").replace("m", "").strip())
        return w if 0.5 <= w <= 60 else None
    except (TypeError, ValueError):
        return None


class _Canvas:
    """A tile being drawn: its pixels' frame (top-left corner x0, y1 in Lambert 93, px metres a pixel) and what both styles
    use. `scale` is the map's, for the symbols' sizes in mm (10 000 forest, 4 000 sprint)."""

    def __init__(self, img: Image.Image, feats: list[dict], x0: float, y1: float, px: float, scale: float):
        self.img = img.convert("RGB")
        self.W, self.H = self.img.size
        self.d = ImageDraw.Draw(self.img)
        self.feats, self.x0, self.y1, self.px, self.scale = feats, x0, y1, px, scale

    def tp(self, pts):
        return [((x - self.x0) / self.px, (self.y1 - y) / self.px) for x, y in pts]

    def mm(self, v: float) -> int:
        """A width of v mm on the map, in pixels (1 at least)."""
        return max(1, round(v * self.scale / 1000 / self.px))

    def m(self, v: float) -> int:
        """A width of v metres on the ground, in pixels."""
        return max(1, round(v / self.px))

    def near(self, q, margin=200):
        xs = [p[0] for p in q]
        ys = [p[1] for p in q]
        return max(xs) > -margin and min(xs) < self.W + margin and max(ys) > -margin and min(ys) < self.H + margin

    def areas(self, kinds, fill, edge=None, ew=0.0):
        mask = Image.new("L", (self.W, self.H), 0)
        md = ImageDraw.Draw(mask)
        rings = []
        for f in self.feats:
            if f["kind"] not in kinds:
                continue
            for role, p in f["rings"]:
                q = self.tp(p)
                if not self.near(q):
                    continue
                md.polygon(q, fill=255 if role == "outer" else 0)
                rings.append(q)
        self.img.paste(fill, mask=mask)
        if edge:
            for q in rings:
                self.d.line(q + [q[0]], fill=edge, width=self.mm(ew), joint="curve")

    def lines(self):
        """The line features near the tile: [(feature, its pixels)]."""
        out = []
        for f in self.feats:
            if "line" in f:
                q = self.tp(f["line"])
                if self.near(q):
                    out.append((f, q))
        return out

    def streams(self, ls, widths):
        for f, q in ls:
            if not f["kind"].startswith("stream:"):
                continue
            kind = f["kind"][7:]
            if kind in ("ditch", "drain"):
                _dashed(self.d, q, self.mm(widths["minor"]), BLUE, self.mm(widths["dash"]), self.mm(0.25))
            else:
                self.d.line(q, fill=BLUE, width=self.mm(widths.get(kind, widths["stream"])), joint="curve")

    def rail_power(self, ls):
        for f, q in ls:
            if f["kind"] == "power":
                self.d.line(q, fill=BLACK, width=self.mm(0.14))
            elif f["kind"] == "rail":
                self.d.line(q, fill=BLACK, width=self.mm(0.35), joint="curve")
                _dashed(self.d, q, self.mm(0.1), WHITE, self.mm(1.0), self.mm(1.5))


def draw(img: Image.Image, feats: list[dict], x0: float, y1: float, px: float, style: str = "forest") -> Image.Image:
    """The features over a tile whose top-left corner is (x0, y1) in Lambert 93, px metres a pixel, in the style of a forest
    map (ISOM 2017-2 at 1:10 000) or of a sprint map (ISSprOM 2019-2 at 1:4 000)."""
    sprint = style == "sprint"
    return (_sprint if sprint else _forest)(_Canvas(img, feats, x0, y1, px, 4000 if sprint else 10000))


def _forest(c: _Canvas) -> Image.Image:
    d, mm = c.d, c.mm
    c.areas({"paved"}, BROWN50, BLACK, 0.14)
    c.areas({"water"}, BLUE, BLACK, 0.14)
    ls = c.lines()
    c.streams(ls, {"river": 0.5, "canal": 0.5, "stream": 0.25, "minor": 0.18, "dash": 1.0})
    by = {}
    for f, q in ls:
        by.setdefault(f["kind"], []).append(q)
    # 502 wide road: two black edges round a brown fill, the fill drawn over every casing so that junctions open
    for q in by.get("wide", []):
        d.line(q, fill=BLACK, width=mm(0.74 + 2 * 0.14), joint="curve")
    for q in by.get("wide", []):
        d.line(q, fill=BROWN50, width=mm(0.74), joint="curve")
    for q in by.get("road", []):
        d.line(q, fill=BLACK, width=mm(0.35), joint="curve")
    for q in by.get("track", []):
        _dashed(d, q, mm(0.35), BLACK, mm(3.0), mm(0.25))
    for q in by.get("path", []):
        _dashed(d, q, mm(0.25), BLACK, mm(2.0), mm(0.25))
    for q in by.get("smallpath", []):
        _dashed(d, q, mm(0.18), BLACK, mm(1.0), mm(0.25))
    for q in by.get("wall", []) + by.get("lowwall", []):
        d.line(q, fill=BLACK, width=mm(0.25), joint="curve")
    for q in by.get("fence", []):
        d.line(q, fill=BLACK, width=mm(0.14), joint="curve")
    c.rail_power(ls)
    c.areas({"canopy"}, GREY20, BLACK, 0.1)
    c.areas({"building"}, GREY65, BLACK, 0.14)
    return c.img


def _sprint(c: _Canvas) -> Image.Image:
    """ISSprOM 2019-2: streets, squares and paved footways as paved area (501, brown 30 %) at their width on the ground,
    unpaved paths as 505 (a narrow band with dashed edges) or 506, buildings grey 50 % (521), canopies (522), walls
    impassable (515), retaining walls and fences passable (513, 516), stairways hatched (532)."""
    d, mm, m = c.d, c.mm, c.m
    ls = c.lines()
    roadish = [(f, q) for f, q in ls if f["kind"] in ("wide", "road", "track", "path", "smallpath", "sidewalk")]
    _ground_fill(c, [(f, q) for f, q in roadish if f["kind"] in ("wide", "road") and f["paved"]])
    c.areas({"paved"}, BROWN30)
    # the paved ways, widest first, as bands of their own width
    width = street_w
    bands = sorted(((f, q) for f, q in roadish if f["paved"]), key=lambda fq: -width(fq[0]))
    for f, q in bands:
        d.line(q, fill=BROWN30, width=m(width(f)), joint="curve")
    c.areas({"water"}, BLUE, BLACK, 0.18)
    c.streams(ls, {"river": 0.4, "canal": 0.4, "stream": 0.21, "minor": 0.21, "dash": 1.87})
    # 532 stairway: the band crossed by thin lines every 0.3 mm
    for f, q in bands:
        if f["hw"] == "steps":
            _rungs(d, q, m(width(f)) / 2, mm(0.1), mm(0.3))
    # unpaved: 505 footpath (a 0.5 mm band with dashed edges), 506 small path (black, dashed)
    for f, q in roadish:
        if f["paved"]:
            continue
        if f["kind"] == "smallpath":
            _dashed(d, q, mm(0.27), BLACK, mm(1.5), mm(0.37))
        else:
            d.line(q, fill=BROWN30, width=mm(0.5), joint="curve")
            for side in (-1, 1):
                _dashed(d, _offset(q, side * mm(0.25)), mm(0.12), BLACK, mm(2.0), mm(0.25))
    c.areas({"canopy"}, GREY20, BLACK, 0.1)
    c.areas({"building"}, GREY50, BLACK, 0.14)
    for f, q in ls:
        if f["kind"] == "wall":
            d.line(q, fill=BLACK, width=mm(0.45), joint="curve")
        elif f["kind"] in ("lowwall", "fence"):
            d.line(q, fill=BLACK, width=mm(0.21), joint="curve")
    c.rail_power(ls)
    return c.img


YELLOW, OLIVE = (255, 186, 54), (166, 165, 58)   # ISSprOM 401 open land, 520 area that shall not be entered
NEAR_HOUSE = 20.0                                   # m: a residential block's gardens lie this close to its buildings
KERB = 3.0                                          # m beyond a street's paved band: its sidewalk, paved, never a garden


def street_w(f: dict) -> float:
    """A paved way's width on the ground (m): OSM's, else its class's, and the sidewalks it says it has."""
    return (f["width"] or STREET_W.get(f["hw"], 4)) + 1.5 * f.get("sides", 0)


def _ground_fill(c: _Canvas, streets) -> None:
    """A sprint map's ground where OpenStreetMap says what it is, on the LiDAR render's land only (white forest, its pale
    yellow open land, its greens; contours, cliffs and water stay): public lawns, parks, commons and grassland — the LiDAR's
    open land there becomes open land 401; pitches and playgrounds open land wherever no vegetation stands; the strip of KERB
    metres along each street of a residential block paved (the sidewalk between the street and the façades); and olive (520,
    not to be entered) the ground marked private, private gardens, and the unbuilt, unwooded ground of residential blocks
    within NEAR_HOUSE of a building — the gardens behind the houses — unless public open land covers it (a wooded slope is
    left to the LiDAR: a garden's trees cannot be told from a public wood). Streets, paved areas and buildings are drawn over
    it afterwards."""
    W, H = c.W, c.H
    a = np.asarray(c.img, dtype=np.int16)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    white = (r > 245) & (g > 245) & (b > 245)
    pale = (r > 245) & (abs(g - 219) < 12) & (abs(b - 166) < 14)
    green = (g > r + 20) & (g > b + 20) & (g > 150)
    land = white | pale | green

    def mask(kinds):
        mk = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(mk)
        for f in c.feats:
            if f["kind"] in kinds:
                for role, p in f["rings"]:
                    q = c.tp(p)
                    if c.near(q):
                        md.polygon(q, fill=255 if role == "outer" else 0)
        return np.asarray(mk) > 0

    openl, pitch, private, resid, houses = (mask({k}) for k in ("open", "pitch", "private", "residential", "building"))
    near = np.zeros((H, W), bool)
    if houses.any() and resid.any():
        # buildings grown by NEAR_HOUSE on a reduced copy (a max filter at full size is too slow), then back to size
        k = 8
        small = Image.fromarray((houses * 255).astype(np.uint8)).resize((max(1, W // k), max(1, H // k)), Image.Resampling.BOX)
        n = 2 * round(NEAR_HOUSE / (c.px * k)) + 1
        grown = small.point(lambda v: 255 if v else 0).filter(ImageFilter.MaxFilter(min(n, 31)))
        near = np.asarray(grown.resize((W, H), Image.Resampling.NEAREST)) > 0
    kerb_img = Image.new("L", (W, H), 0)
    kd = ImageDraw.Draw(kerb_img)
    for f, q in streets:
        kd.line(q, fill=255, width=c.m(street_w(f) + 2 * KERB), joint="curve")
    public = openl | pitch
    kerb = land & resid & ~public & ~private & (np.asarray(kerb_img) > 0)
    olive = land & ~kerb & (private | (resid & near & ~public & ~green))
    yellow = ((openl & pale) | (pitch & (white | pale))) & ~private
    out = a.astype(np.uint8).copy()
    out[olive] = OLIVE
    out[kerb] = BROWN30
    out[yellow & ~olive] = YELLOW
    c.img.paste(Image.fromarray(out, "RGB"))


def _offset(q, off: float):
    """A polyline moved sideways by off pixels (each point along the normal of its neighbours' chord)."""
    out = []
    for i, (x, y) in enumerate(q):
        a, b = q[max(0, i - 1)], q[min(len(q) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1
        out.append((x - dy / n * off, y + dx / n * off))
    return out


def _rungs(d: ImageDraw.ImageDraw, q, half: float, w: int, step: float) -> None:
    """Lines across a polyline every `step` px, `half` px each side: a stairway's steps."""
    left = step / 2
    for (x0, y0), (x1, y1) in zip(q, q[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if not seg:
            continue
        ux, uy = (x1 - x0) / seg, (y1 - y0) / seg
        t = left
        while t <= seg:
            px, py = x0 + ux * t, y0 + uy * t
            d.line([(px - uy * half, py + ux * half), (px + uy * half, py - ux * half)], fill=BLACK, width=w)
            t += step
        left = t - seg
