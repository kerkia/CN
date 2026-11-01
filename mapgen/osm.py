"""OpenStreetMap's man-made features and water over a generated map: what LiDAR cannot tell — roads, paths and their
kinds, buildings, walls and fences, railways, power lines, lakes and streams — read from the Overpass API for the area
and drawn in ISOM 2017-2's symbols at 1:10 000 (600 dpi, 23.6 px a millimetre: the karttapullautin render's scale).

© OpenStreetMap contributors, ODbL: the map says so wherever it is shown."""
from __future__ import annotations

import math
import time

import httpx
from PIL import Image, ImageDraw

from . import lambert93

# the main Overpass server, then another public one: either may answer 502/504 when busy
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
UA = "Ozimut map generator (https://ozimut.com; contact@ozimut.com)"

# ISOM 2017-2's colours (site/assets/js/isom.js)
BLACK, BROWN50, BLUE, GREY65 = (28, 28, 28), (232, 191, 152), (0, 160, 226), (107, 107, 107)
WHITE = (255, 255, 255)
PX_MM = 1 / 0.04233333  # px a millimetre of map: 0.42333 m a pixel at 1:10 000

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
);
out geom;"""
    own = http is None
    http = http or httpx.Client(timeout=120, headers={"User-Agent": UA})
    err = None
    try:
        for attempt in range(6):
            try:
                r = http.post(OVERPASS[attempt % len(OVERPASS)], data={"data": q}, timeout=180)
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


def features(data: dict) -> list[dict]:
    """The drawable features: {kind, area?, rings | line} in [lat, lon], tunnels and things underground left out."""
    out = []
    for el in data.get("elements", []):
        tg = el.get("tags") or {}
        if tg.get("tunnel") not in (None, "no") or tg.get("location") == "underground" or tg.get("layer", "0").startswith("-"):
            continue
        hw, ww = tg.get("highway"), tg.get("waterway")
        kind = None
        if tg.get("building") not in (None, "no"):
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
            if tg.get("footway") in ("sidewalk", "crossing") or tg.get("path") == "sidewalk":
                continue
            kind = "smallpath" if tg.get("trail_visibility") in FAINT or tg.get("informal") == "yes" else "path"
        elif ww in WATER_LINE:
            kind = "stream:" + ww
        elif tg.get("railway") in ("rail", "light_rail", "narrow_gauge", "tram", "subway"):
            kind = "rail"
        elif tg.get("power") == "line":
            kind = "power"
        elif tg.get("barrier") in ("wall", "city_wall", "retaining_wall"):
            kind = "wall"
        elif tg.get("barrier") == "fence":
            kind = "fence"
        if not kind:
            continue
        area = kind in ("building", "water", "paved")
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
            out.append({"kind": kind, "line": pts})
    return out


def project(feats: list[dict]) -> list[dict]:
    """Every [lat, lon] in Lambert 93 metres (X, Y), once for all the tiles."""
    def pr(pts):
        return [lambert93.forward(a, b) for a, b in pts]
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


def draw(img: Image.Image, feats: list[dict], x0: float, y1: float, px: float) -> Image.Image:
    """The features over a tile whose top-left corner is (x0, y1) in Lambert 93, px metres a pixel."""
    W, H = img.size
    img = img.convert("RGB")
    d = ImageDraw.Draw(img)

    def tp(pts):
        return [((x - x0) / px, (y1 - y) / px) for x, y in pts]

    def mm(v):
        return max(1, round(v * PX_MM))

    margin = 200
    def near(pts):
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return max(xs) > -margin and min(xs) < W + margin and max(ys) > -margin and min(ys) < H + margin

    def areas(kind, fill, edge, ew):
        mask = Image.new("L", (W, H), 0)
        md = ImageDraw.Draw(mask)
        rings = []
        for f in feats:
            if f["kind"] != kind:
                continue
            for role, p in f["rings"]:
                q = tp(p)
                if not near(q):
                    continue
                md.polygon(q, fill=255 if role == "outer" else 0)
                rings.append(q)
        img.paste(fill, mask=mask)
        for q in rings:
            d.line(q + [q[0]], fill=edge, width=mm(ew), joint="curve")

    areas("paved", BROWN50, BLACK, 0.14)
    areas("water", BLUE, BLACK, 0.14)

    lines = {k: [] for k in ("wide", "road", "track", "path", "smallpath", "rail", "power", "wall", "fence")}
    streams = []
    for f in feats:
        if "line" not in f:
            continue
        q = tp(f["line"])
        if not near(q):
            continue
        if f["kind"].startswith("stream:"):
            streams.append((WATER_LINE[f["kind"][7:]], f["kind"] in ("stream:ditch", "stream:drain"), q))
        else:
            lines[f["kind"]].append(q)
    for w, dashed, q in streams:
        if dashed:
            _dashed(d, q, mm(w), BLUE, mm(1.0), mm(0.25))
        else:
            d.line(q, fill=BLUE, width=mm(w), joint="curve")
    # 502 wide road: two black edges round a brown fill, the fill drawn over every casing so that junctions open
    for q in lines["wide"]:
        d.line(q, fill=BLACK, width=mm(0.74 + 2 * 0.14), joint="curve")
    for q in lines["wide"]:
        d.line(q, fill=BROWN50, width=mm(0.74), joint="curve")
    for q in lines["road"]:
        d.line(q, fill=BLACK, width=mm(0.35), joint="curve")
    for q in lines["track"]:
        _dashed(d, q, mm(0.35), BLACK, mm(3.0), mm(0.25))
    for q in lines["path"]:
        _dashed(d, q, mm(0.25), BLACK, mm(2.0), mm(0.25))
    for q in lines["smallpath"]:
        _dashed(d, q, mm(0.18), BLACK, mm(1.0), mm(0.25))
    for q in lines["wall"]:
        d.line(q, fill=BLACK, width=mm(0.25), joint="curve")
    for q in lines["fence"]:
        d.line(q, fill=BLACK, width=mm(0.14), joint="curve")
    for q in lines["power"]:
        d.line(q, fill=BLACK, width=mm(0.14))
    for q in lines["rail"]:
        d.line(q, fill=BLACK, width=mm(0.35), joint="curve")
        _dashed(d, q, mm(0.1), WHITE, mm(1.0), mm(1.5))
    areas("building", GREY65, BLACK, 0.14)
    return img
