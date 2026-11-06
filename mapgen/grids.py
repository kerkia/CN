"""The generated maps' tile grids, one per country (2026-11-06): France's IGN tiles, and Switzerland's, the United States',
Canada's and New Zealand's, each a 1 km square of a projected system, named by its country.

    0391_6819          France: IGN's LiDAR HD name, Lambert 93 (EPSG:2154), the WEST and NORTH edges in km (unchanged)
    ch_2583_1219       Switzerland: LV95 (EPSG:2056), the WEST and SOUTH edges in km (swisstopo's own tile name 2583-1219)
    nz_1571_5172       New Zealand: NZTM2000 (EPSG:2193), the west and south edges in km
    us_13_0475_4427    United States: UTM zone 13 on WGS 84 (EPSG:32613), the west and south edges in km
    ca_18_0433_5038    Canada: UTM zone 18 on WGS 84 (EPSG:32618), the same

Every new grid is named by its square's south-west corner (the usual way, swisstopo's), four digits a number, so that one
id never holds another. Whatever the name, `corner(tid)` gives the north-west corner the pipeline draws from (run.py).
site/assets/js/trace/lidarmap.js computes the same ids in the browser (`tileIdsFor`): keep them in step.

    py -3 -m mapgen.grids ids ch 47.13 7.22         # the tile under a point
    py -3 -m mapgen.grids borders                   # the browser's simplified borders (lidarmap.js BORDERS), from site/assets/geo
"""
from __future__ import annotations

import json
import math
import re
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ID = re.compile(r"^(?:(?P<fx>\d{4})_(?P<fy>\d{4})|(?P<cc>ch|nz)_(?P<ce>\d{4})_(?P<cn>\d{4})"
                r"|(?P<uc>us|ca)_(?P<z>\d{1,2})_(?P<ue>\d{4})_(?P<un>\d{4}))$")
SIZE = 1000
COUNTRIES = ("fr", "ch", "nz", "us", "ca")
EPSG = {"fr": 2154, "ch": 2056, "nz": 2193}
# where each grid's numbers may lie (km): an id outside is refused (functions/api/lidarmap keeps the same bounds)
RANGE = {"fr": ((50, 1250), (6040, 7120)), "ch": ((2480, 2840), (1070, 1300)), "nz": ((1000, 2130), (4700, 6250)),
         "us": ((100, 900), (1500, 7900)), "ca": ((100, 900), (4500, 9400))}
ZONES = {"us": (1, 20), "ca": (7, 22)}
# what each country's point clouds are and who to credit (the record's "src", the page's credit line)
SOURCES = {
    "fr": {"name": "IGN – LiDAR HD®", "url": "https://geoservices.ign.fr/lidarhd", "licence": "Licence Ouverte 2.0"},
    "ch": {"name": "© swisstopo – swissSURFACE3D", "url": "https://www.swisstopo.admin.ch/en/height-model-swisssurface3d",
           "licence": "Open Government Data (free use, source credited)"},
    "us": {"name": "USGS 3D Elevation Program (3DEP)", "url": "https://www.usgs.gov/3d-elevation-program", "licence": "public domain"},
    "ca": {"name": "NRCan – CanElevation", "url": "https://open.canada.ca/data/en/dataset/7069387e-9986-4297-9f55-0288e9676947",
           "licence": "Open Government Licence – Canada 2.0"},
    "nz": {"name": "LINZ (via OpenTopography)", "url": "https://www.linz.govt.nz/products-services/data/types-linz-data/elevation-data",
           "licence": "CC BY 4.0"},
}


@dataclass(frozen=True)
class Tile:
    id: str
    country: str
    epsg: int
    zone: int | None
    x0: int                       # west edge, m
    y1: int                       # north edge, m

    @property
    def y0(self) -> int:
        return self.y1 - SIZE

    @property
    def x1(self) -> int:
        return self.x0 + SIZE

    @property
    def group(self) -> str:
        """Tiles of one group share a coordinate system: karttapullautin runs once per group (run.py)."""
        return f"{self.country}{self.zone}" if self.zone else self.country


def parse(tid: str) -> Tile:
    m = ID.match(tid or "")
    if not m:
        raise ValueError(f"bad tile id {tid!r}")
    if m["fx"]:
        return Tile(tid, "fr", 2154, None, int(m["fx"]) * 1000, int(m["fy"]) * 1000)
    if m["cc"]:
        return Tile(tid, m["cc"], EPSG[m["cc"]], None, int(m["ce"]) * 1000, int(m["cn"]) * 1000 + SIZE)
    z = int(m["z"])
    return Tile(tid, m["uc"], 32600 + z, z, int(m["ue"]) * 1000, int(m["un"]) * 1000 + SIZE)


def valid(tid: str) -> bool:
    """A well-formed id whose numbers lie in its country's range (and its UTM zone in the country's)."""
    try:
        t = parse(tid)
    except ValueError:
        return False
    (e0, e1), (n0, n1) = RANGE[t.country]
    if t.country in ZONES:
        z0, z1 = ZONES[t.country]
        if not z0 <= (t.zone or 0) <= z1 or tid != tile_id(t.country, t.x0 // 1000, t.y0 // 1000, t.zone):
            return False
    km_e, km_n = t.x0 // 1000, (t.y1 if t.country == "fr" else t.y0) // 1000
    return e0 <= km_e <= e1 and n0 <= km_n <= n1


def tile_id(country: str, e_km: int, s_km: int, zone: int | None = None) -> str:
    """A new grid's id from its square's west and south km (France: use run.tile_ids, west and north)."""
    if country == "fr":
        return f"{e_km:04d}_{s_km + 1:04d}"
    if country in ZONES:
        return f"{country}_{zone}_{e_km:04d}_{s_km:04d}"
    return f"{country}_{e_km:04d}_{s_km:04d}"


def corner(tid: str) -> tuple[int, int]:
    """The tile's north-west corner in its system's metres."""
    t = parse(tid)
    return t.x0, t.y1


def utm_zone(lon: float) -> int:
    return max(1, min(60, math.floor((lon + 180) / 6) + 1))


@lru_cache(maxsize=None)
def transformer(src: int | str, dst: int | str):
    """A pyproj transformer (x, y order: lon/lat for EPSG:4326)."""
    from pyproj import Transformer                      # only the countries beyond France need pyproj
    return Transformer.from_crs(src, dst, always_xy=True)


def to_latlon(epsg: int, x: float, y: float) -> tuple[float, float]:
    if epsg == 2154:
        from . import lambert93
        return lambert93.inverse(x, y)
    lon, lat = transformer(epsg, 4326).transform(x, y)
    return lat, lon


def from_latlon(epsg: int, lat: float, lon: float) -> tuple[float, float]:
    if epsg == 2154:
        from . import lambert93
        return lambert93.forward(lat, lon)
    return transformer(4326, epsg).transform(lon, lat)


def ids_for(country: str, pts: list[tuple[float, float]], margin: float = 150, zone: int | None = None) -> list[str]:
    """The tiles points [(lat, lon)…] touch with a margin (m), in a country's grid (UTM: the points' mean zone unless given)."""
    if country in ZONES and zone is None:
        zone = utm_zone(sum(p[1] for p in pts) / len(pts))
    epsg = EPSG.get(country) or 32600 + zone
    xy = [from_latlon(epsg, a, b) for a, b in pts]
    X0, X1 = min(p[0] for p in xy) - margin, max(p[0] for p in xy) + margin
    Y0, Y1 = min(p[1] for p in xy) - margin, max(p[1] for p in xy) + margin
    out = []
    for ky in range(math.floor(Y1 / 1000), math.floor(Y0 / 1000) - 1, -1):     # north to south, as France's
        for kx in range(math.floor(X0 / 1000), math.ceil(X1 / 1000)):
            if ky * 1000 >= Y1 or (ky + 1) * 1000 <= Y0:
                continue
            out.append(f"{kx:04d}_{ky + 1:04d}" if country == "fr" else tile_id(country, kx, ky, zone))
    return out


def groups(tids: list[str]) -> dict[str, list[str]]:
    """The ids by coordinate system, in their order."""
    out: dict[str, list[str]] = {}
    for t in tids:
        out.setdefault(parse(t).group, []).append(t)
    return out


def neighbours(tid: str) -> list[str]:
    """The eight tiles round one (same grid)."""
    t = parse(tid)
    e, s = t.x0 // 1000, t.y0 // 1000
    return [tile_id(t.country, e + dx, s + dy, t.zone) for dy in (1, 0, -1) for dx in (-1, 0, 1) if dx or dy]


# ---- the browser's simplified borders (lidarmap.js BORDERS: which grid a trace is in) --------------------------------------
def _rings(cc: str) -> list[list[tuple[float, float]]]:
    d = json.loads((Path(__file__).resolve().parents[1] / "site" / "assets" / "geo" / f"{cc}.json").read_text(encoding="utf-8"))
    land = json.loads(d["land"]) if isinstance(d["land"], str) else d["land"]
    q = float(d["q"])
    out = []
    for r in land:
        x, y = r[0], r[1]
        pts = [(x / q, y / q)]
        for i in range(2, len(r) - 1, 2):
            x += r[i]
            y += r[i + 1]
            pts.append((x / q, y / q))
        out.append(pts)
    return out


def _dp(pts, tol):
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1e-12
    i, dmax = 0, -1.0
    for k in range(1, len(pts) - 1):
        d = abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return _dp(pts[: i + 1], tol)[:-1] + _dp(pts[i:], tol)


def borders(tol: dict[str, float] | None = None, min_area: float = 0.05) -> dict[str, list]:
    """Switzerland's and the contiguous United States' borders as rings of [lon, lat] (3 and 2 decimals), small islands left
    out: the browser tells Switzerland from its neighbours and the United States from Canada by them (Canada, Alaska, Hawaii
    and New Zealand by boxes, lidarmap.js countryAt)."""
    tol = tol or {"ch": 0.008, "us": 0.05}
    out = {}
    for cc, t in tol.items():
        rings = []
        for r in _rings(cc):
            area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(r, r[1:] + r[:1]))) / 2
            if area < min_area:
                continue
            k = max(range(len(r)), key=lambda i: (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2)
            s = _dp(r[: k + 1], t)[:-1] + _dp(r[k:] + [r[0]], t)[:-1]          # a closed ring: two open halves
            nd = 3 if cc == "ch" else 2
            rings.append([v for p in s for v in (round(p[0], nd), round(p[1], nd))])
        out[cc] = rings
    return out


if __name__ == "__main__":
    if sys.argv[1:2] == ["ids"]:
        cc, lat, lon = sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
        print(ids_for(cc, [(lat, lon)], 0))
    elif sys.argv[1:2] == ["borders"]:
        b = borders()
        print("const BORDERS = " + json.dumps(b, separators=(",", ":")) + ";")
        print({k: sum(len(r) // 2 for r in v) for k, v in b.items()}, file=sys.stderr)
