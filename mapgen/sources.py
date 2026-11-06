"""The point clouds beyond France (2026-11-06): each new grid's tiles (grids.py) as LAZ files karttapullautin reads, and the
ground's heights every 2 m for the 3D view, from each country's open LiDAR — read without an account or a key.

    Switzerland     swisstopo's swissSURFACE3D, its 1 km tiles in LV95 found through its STAC API
                    (data.geo.admin.ch/api/stac/v1, collection ch.swisstopo.swisssurface3d), a zipped LAS each, taken as it
                    is (its square is the grid's: no margin beyond the tiles asked, as in France)
    United States   USGS 3DEP's point clouds as Entwine Point Tiles on AWS (s3-us-west-2…/usgs-lidar-public/<project>/ept.json,
                    Web Mercator), the projects found by Hobu's boundaries (github.com/hobuinc/usgs-lidar, resources.geojson);
                    the octree's nodes over the tile read, reprojected to UTM
    Canada          NRCan's CanElevation on S3 (canelevation-lidar-point-clouds, COPC), its tiles found in its tile index
                    (Index_LiDARtiles_tuileslidar.gpkg, read by HTTP ranges through its R-tree: ~12 requests, not 450 MB);
                    the COPC files queried for the tile's box, reprojected to UTM
    New Zealand     LINZ's point clouds as OpenTopography redistributes them (opentopography.s3.sdsc.edu/pc-bulk/NZ…), tiles
                    named by LINZ's Topo50 sheet and 1:1000 grid (480 × 720 m in NZTM2000), so found by their names

Beyond Switzerland a tile is read with a margin (MARGIN m): its own square becomes <id>.laz, and the parts of the squares
round it that nobody asked for become edge_<id>.laz, so that karttapullautin's batch mode draws the tile's edges with their
neighbours' points as it does between the tiles asked (each point in one file only).

Only data files are read; karttapullautin itself (GPL-3) stays a program of its own (run.py)."""
from __future__ import annotations

import io
import json
import math
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from . import grids

MARGIN = 150
DEM_STEP, DEM_N = 2.0, 500
NOISE = (7, 18)                 # ASPRS low and high noise: never vegetation
FIELDS = ("x", "y", "z", "intensity", "return_number", "number_of_returns", "classification")
UA = "Ozimut map generator (https://ozimut.com; contact@ozimut.com)"


# ---- points ----------------------------------------------------------------------------------------------------------------
def _empty() -> dict:
    return {k: np.zeros(0, np.float64 if k in "xyz" else np.uint16 if k == "intensity" else np.uint8) for k in FIELDS}


def _cat(parts: list[dict]) -> dict:
    parts = [p for p in parts if len(p["x"])]
    if not parts:
        return _empty()
    return {k: np.concatenate([p[k] for p in parts]) for k in FIELDS}


def _sel(p: dict, m) -> dict:
    return {k: v[m] for k, v in p.items()}


def from_las(las) -> dict:
    """A laspy record's points (noise and withheld points left out), coordinates in metres."""
    keep = ~np.isin(np.asarray(las.classification), NOISE)
    try:
        keep &= ~np.asarray(las.withheld, dtype=bool)
    except (AttributeError, ValueError):
        pass
    p = {"x": np.asarray(las.x, np.float64), "y": np.asarray(las.y, np.float64), "z": np.asarray(las.z, np.float64),
         "intensity": np.asarray(las.intensity, np.uint16), "return_number": np.asarray(las.return_number, np.uint8),
         "number_of_returns": np.asarray(las.number_of_returns, np.uint8), "classification": np.asarray(las.classification, np.uint8)}
    return _sel(p, keep)


def in_box(p: dict, box) -> np.ndarray:
    x0, y0, x1, y1 = box
    return (p["x"] >= x0) & (p["x"] < x1) & (p["y"] >= y0) & (p["y"] < y1)


def reproject(p: dict, src, dst) -> dict:
    if not len(p["x"]) or src == dst:
        return p
    x, y = grids.transformer(src, dst).transform(p["x"], p["y"])
    return {**p, "x": np.asarray(x), "y": np.asarray(y)}


def write_laz(path: Path, p: dict, origin: tuple[float, float], epsg: int | None = None) -> int:
    """The points as LAZ (LAS 1.4, point format 6, centimetres from the tile's corner); the file's size."""
    import laspy
    h = laspy.LasHeader(point_format=6, version="1.4")
    h.offsets = np.array([origin[0], origin[1], 0.0])
    h.scales = np.array([0.01, 0.01, 0.01])
    if epsg:
        try:
            from pyproj import CRS
            h.add_crs(CRS.from_epsg(epsg))
        except Exception:
            pass
    las = laspy.LasData(h)
    las.x, las.y, las.z = p["x"], p["y"], p["z"]
    las.intensity = p["intensity"]
    las.return_number = np.clip(p["return_number"], 1, 15)
    las.number_of_returns = np.clip(np.maximum(p["number_of_returns"], p["return_number"]), 1, 15)
    las.classification = p["classification"]
    path.parent.mkdir(parents=True, exist_ok=True)
    las.write(str(path), do_compress=True)
    return path.stat().st_size


def dem_png(p: dict, x0: float, y1: float) -> Image.Image | None:
    """The ground's heights every 2 m from (x0, y1) (DEM_N nodes a side, as IGN's MNT is read in run.dem), Terrarium-
    encoded: the mean of the ground points (class 2, else water 9) within a metre of each node, holes filled from their
    neighbours. None without ground."""
    g = p["classification"] == 2
    if g.sum() < 1000:
        g |= p["classification"] == 9
    if not g.any():
        return None
    i = np.rint((p["x"][g] - x0) / DEM_STEP).astype(np.int64)
    j = np.rint((y1 - p["y"][g]) / DEM_STEP).astype(np.int64)
    ok = (i >= 0) & (i < DEM_N) & (j >= 0) & (j < DEM_N)
    q = j[ok] * DEM_N + i[ok]
    s = np.bincount(q, weights=p["z"][g][ok], minlength=DEM_N * DEM_N)
    n = np.bincount(q, minlength=DEM_N * DEM_N)
    z = np.where(n > 0, s / np.maximum(n, 1), np.nan).reshape(DEM_N, DEM_N)
    if np.isnan(z).all():
        return None
    for _ in range(400):
        if not np.isnan(z).any():
            break
        pz = np.pad(z, 1, mode="edge")
        nb = np.stack([pz[:-2, 1:-1], pz[2:, 1:-1], pz[1:-1, :-2], pz[1:-1, 2:]])
        cnt = (~np.isnan(nb)).sum(axis=0)
        fill = np.where(cnt > 0, np.nansum(nb, axis=0) / np.maximum(cnt, 1), np.nan)
        z = np.where(np.isnan(z), fill, z)
    z[np.isnan(z)] = np.nanmean(z)
    v = z + 32768
    r = np.floor(v / 256)
    gg = np.floor(v - r * 256)
    b = np.floor((v - np.floor(v)) * 256)
    return Image.fromarray(np.stack([r, gg, b], axis=-1).astype(np.uint8), "RGB")


def download(http: httpx.Client, url: str, dest: Path) -> Path:
    """A file into dest (kept: a second run reuses it), streamed."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    with http.stream("GET", url, timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with open(part, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    part.replace(dest)
    return dest


def _year(name: str) -> int:
    m = re.findall(r"(?<!\d)((?:19|20)\d\d)(?!\d)", name)
    return int(m[0]) if m else 0


def _cached_json(http: httpx.Client, url: str, dest: Path, days: float = 7):
    if not (dest.exists() and time.time() - dest.stat().st_mtime < days * 86400):
        download(http, url, dest.with_suffix(".tmp"))
        dest.with_suffix(".tmp").replace(dest)
    return json.loads(dest.read_text(encoding="utf-8"))


def _box_in(t: grids.Tile, epsg_to, margin: float = MARGIN):
    """The tile's box with its margin, as the bounding box of its outline in another system."""
    x0, y0, x1, y1 = t.x0 - margin, t.y0 - margin, t.x1 + margin, t.y1 + margin
    xs = np.array([x0, (x0 + x1) / 2, x1] * 3)
    ys = np.repeat([y0, (y0 + y1) / 2, y1], 3)
    if epsg_to == 4326:
        lon, lat = grids.transformer(t.epsg, 4326).transform(xs, ys)
        return float(min(lon)), float(min(lat)), float(max(lon)), float(max(lat))
    X, Y = grids.transformer(t.epsg, epsg_to).transform(xs, ys)
    return float(min(X)), float(min(Y)), float(max(X)), float(max(Y))


def _horizontal(crs):
    """A file's horizontal system (its EPSG code when it has one, else its WKT), the vertical part of a compound one left."""
    if crs is None:
        return None
    if crs.is_compound and crs.sub_crs_list:
        crs = crs.sub_crs_list[0]
    return crs.to_epsg() or crs.to_wkt()


def _inside(lon: float, lat: float, ring) -> bool:
    c = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            c = not c
    return c


# ---- Switzerland: swissSURFACE3D ---------------------------------------------------------------------------------------------
class Swiss:
    STAC = "https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d/items"

    def __init__(self, http, cache: Path, log=print):
        self.http, self.cache, self.log = http, cache, log

    def item(self, t: grids.Tile) -> tuple[str, int] | None:
        """The tile's newest LAS asset and its year."""
        lat, lon = grids.to_latlon(t.epsg, t.x0 + 500, t.y0 + 500)
        r = self.http.get(self.STAC, params={"bbox": f"{lon - 1e-4},{lat - 1e-4},{lon + 1e-4},{lat + 1e-4}", "limit": 50})
        r.raise_for_status()
        best = None
        name = f"{t.x0 // 1000}-{t.y0 // 1000}"
        for f in r.json().get("features", []):
            m = re.match(r"^swisssurface3d_(\d{4})_(\d{4}-\d{4})$", f.get("id", ""))
            if not m or m[2] != name:
                continue
            href = next((a["href"] for a in f.get("assets", {}).values() if a["href"].endswith((".las.zip", ".laz", ".zip"))), None)
            if href and (best is None or int(m[1]) > best[1]):
                best = (href, int(m[1]))
        return best

    def prepare(self, tiles: list[grids.Tile], lazdir: Path, demdir: Path, prog=None) -> dict:
        import laspy
        out = {}
        for t in tiles:
            it = self.item(t)
            if not it:
                out[t.id] = None
                if prog:
                    prog.step()
                continue
            href, year = it
            z = download(self.http, href, self.cache / "ch" / href.rsplit("/", 1)[1])
            with zipfile.ZipFile(z) as zf:
                inner = next(n for n in zf.namelist() if n.lower().endswith((".las", ".laz")))
                dest = lazdir / f"{t.id}{Path(inner).suffix.lower()}"
                with zf.open(inner) as src, open(dest, "wb") as f:
                    while chunk := src.read(1 << 22):
                        f.write(chunk)
            parts = []
            with laspy.open(str(dest)) as rd:
                for ch in rd.chunk_iterator(5_000_000):
                    parts.append(from_las(ch))
            p = _cat(parts)
            d = dem_png(p, t.x0, t.y1)
            if d:
                d.save(demdir / f"dem_{t.id}.png")
            out[t.id] = {"date": str(year), "points": int(len(p["x"])), "files": [href]}
            if prog:
                prog.step()
        return out


# ---- the countries read with a margin --------------------------------------------------------------------------------------
class Margined:
    """A country whose point clouds are read for any box: points(tile, box) in the tile's system, or None (no data there)."""

    def __init__(self, http, cache: Path, log=print):
        self.http, self.cache, self.log = http, cache, log

    def points(self, t: grids.Tile, box) -> tuple[dict, dict] | None:
        raise NotImplementedError

    def prepare(self, tiles: list[grids.Tile], lazdir: Path, demdir: Path, prog=None) -> dict:
        out: dict = {}
        asked = {t.id for t in tiles}
        done_boxes: list[tuple] = []
        edges: dict[str, list[dict]] = {}
        for t in sorted(tiles, key=lambda t: t.id):
            box = (t.x0 - MARGIN, t.y0 - MARGIN, t.x1 + MARGIN, t.y1 + MARGIN)
            t0 = time.monotonic()
            got = self.points(t, box)
            if got is None or not len(got[0]["x"]):
                out[t.id] = None
                if prog:
                    prog.step()
                continue
            p, meta = got
            p = _sel(p, in_box(p, box))
            core = in_box(p, (t.x0, t.y0, t.x1, t.y1))
            pc = _sel(p, core)
            if not len(pc["x"]):
                out[t.id] = None
                if prog:
                    prog.step()
                continue
            size = write_laz(lazdir / f"{t.id}.laz", pc, (t.x0, t.y0), t.epsg)
            d = dem_png(pc, t.x0, t.y1)
            if d:
                d.save(demdir / f"dem_{t.id}.png")
            # the margin: the squares round it nobody asked for, each point once (not in an earlier tile's margin)
            rest = _sel(p, ~core)
            kx = np.floor(rest["x"] / 1000).astype(np.int64)
            ky = np.floor(rest["y"] / 1000).astype(np.int64)
            keep = np.ones(len(kx), bool)
            for b in done_boxes:
                keep &= ~in_box(rest, b)
            cells = {}
            for cx, cy in set(zip(kx[keep].tolist(), ky[keep].tolist())):
                cid = grids.tile_id(t.country, cx, cy, t.zone)
                if cid not in asked:
                    cells[cid] = (cx, cy)
            for cid, (cx, cy) in cells.items():
                m = keep & (kx == cx) & (ky == cy)
                if m.any():
                    edges.setdefault(cid, []).append(_sel(rest, m))
            done_boxes.append(box)
            out[t.id] = {**meta, "points": int(len(pc["x"])), "laz": size}
            self.log(f"{t.id}: {len(pc['x'])} points ({len(p['x'])} with the margin), {size / 1e6:.1f} MB, {time.monotonic() - t0:.0f} s")
            if prog:
                prog.step()
        for cid, parts in edges.items():
            e = grids.parse(cid)
            write_laz(lazdir / f"edge_{cid}.laz", _cat(parts), (e.x0, e.y0), e.epsg)
        return out


class USGS(Margined):
    """3DEP's Entwine Point Tiles (Web Mercator), the newest project with points in the box."""
    BOUNDARIES = "https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson"
    # vertical systems in feet some projects keep (EPSG): their heights brought to metres
    FEET = {"6360": 0.3048006096012192, "8228": 0.3048, "5702": 0.3048006096012192, "6358": 0.3048006096012192}

    def projects(self, t: grids.Tile) -> list[dict]:
        res = _cached_json(self.http, self.BOUNDARIES, self.cache / "us" / "resources.geojson")
        lon0, lat0, lon1, lat1 = _box_in(t, 4326, 0)
        probes = [((lon0 + lon1) / 2, (lat0 + lat1) / 2), (lon0, lat0), (lon1, lat0), (lon0, lat1), (lon1, lat1)]
        hits = []
        for f in res.get("features", []):
            g = f.get("geometry") or {}
            polys = g.get("coordinates", []) if g.get("type") == "MultiPolygon" else [g.get("coordinates", [])]
            n = sum(any(_inside(x, y, [tuple(c[:2]) for c in poly[0]]) for poly in polys if poly) for x, y in probes)
            if n:
                hits.append((n, _year(f["properties"]["name"]), f["properties"]))
        hits.sort(key=lambda h: (min(h[0], 5) == 5, h[1], h[0]), reverse=True)     # whole tile first, then the newest
        return [h[2] for h in hits]

    def _get(self, url):
        for k in range(4):
            try:
                r = self.http.get(url, timeout=120)
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                return r.content
            except httpx.HTTPError:
                if k == 3:
                    raise
                time.sleep(2 * (k + 1))

    def points(self, t, box):
        import laspy
        mb = _box_in(t, 3857)                            # the margin box in Web Mercator
        for pr in self.projects(t)[:4]:
            base = pr["url"].rsplit("/", 1)[0]
            ept = json.loads(self._get(pr["url"]))
            b = ept["bounds"]
            counts = json.loads(self._get(f"{base}/ept-hierarchy/0-0-0-0.json"))

            def hit(key):
                d, x, y, _ = (int(v) for v in key.split("-"))
                sx, sy = (b[3] - b[0]) / 2 ** d, (b[4] - b[1]) / 2 ** d
                nx0, ny0 = b[0] + x * sx, b[1] + y * sy
                return nx0 < mb[2] and nx0 + sx > mb[0] and ny0 < mb[3] and ny0 + sy > mb[1]

            nodes, stack = [], ["0-0-0-0"]
            while stack:
                k = stack.pop()
                n = counts.get(k)
                if n is None or not hit(k):
                    continue
                if n == -1:
                    counts.update(json.loads(self._get(f"{base}/ept-hierarchy/{k}.json")))
                    n = counts.get(k, 0)
                if n > 0:
                    nodes.append(k)
                d, x, y, z = (int(v) for v in k.split("-"))
                stack += [f"{d + 1}-{2 * x + a}-{2 * y + c}-{2 * z + e}" for a in (0, 1) for c in (0, 1) for e in (0, 1)]
            if not nodes:
                continue
            vert = str((ept.get("srs") or {}).get("vertical") or "")
            zf = self.FEET.get(vert, 1.0)

            def read(k):
                raw = self._get(f"{base}/ept-data/{k}.laz")
                if not raw:
                    return _empty()
                p = from_las(laspy.read(io.BytesIO(raw)))
                return _sel(p, in_box(p, mb))

            with ThreadPoolExecutor(8) as ex:
                parts = list(ex.map(read, nodes))
            p = _cat(parts)
            if not len(p["x"]):
                continue
            if zf != 1.0:
                p["z"] = p["z"] * zf
            p = reproject(p, 3857, t.epsg)
            self.log(f"{t.id}: 3DEP {pr['name']}, {len(nodes)} nodes")
            return p, {"date": str(_year(pr["name"]) or ""), "project": pr["name"], "nodes": len(nodes)}
        return None


class _RangeFile:
    """A remote file read by HTTP ranges, in 64 KB blocks kept in memory (CanElevation's tile index)."""
    BLOCK = 1 << 16

    def __init__(self, http, url):
        self.http, self.url, self.blocks = http, url, {}
        self.size = int(http.head(url).headers["content-length"])
        self.requests = 0

    def read(self, amount, offset):
        out = bytearray()
        while amount > 0 and offset < self.size:
            b = offset // self.BLOCK
            if b not in self.blocks:
                lo = b * self.BLOCK
                r = self.http.get(self.url, headers={"Range": f"bytes={lo}-{min(self.size, lo + self.BLOCK) - 1}"})
                r.raise_for_status()
                self.blocks[b] = r.content
                self.requests += 1
            blk = self.blocks[b]
            piece = blk[offset - b * self.BLOCK: offset - b * self.BLOCK + amount]
            if not piece:
                break
            out += piece
            offset += len(piece)
            amount -= len(piece)
        return bytes(out)


def _http_sqlite(http, url):
    """A read-only SQLite connection on a remote file (apsw's virtual file system over HTTP ranges)."""
    import apsw
    rf = _RangeFile(http, url)

    class F:
        def xRead(self, amount, offset):
            return rf.read(amount, offset)

        def xFileSize(self):
            return rf.size

        def xClose(self):
            pass

        def xLock(self, level):
            pass

        def xUnlock(self, level):
            pass

        def xCheckReservedLock(self):
            return False

        def xFileControl(self, op, ptr):
            return False

        def xSectorSize(self):
            return 4096

        def xDeviceCharacteristics(self):
            return 0

        def xSync(self, flags):
            pass

        def xWrite(self, data, offset):
            raise apsw.ReadOnlyError()

        def xTruncate(self, size):
            raise apsw.ReadOnlyError()

    name = f"http{id(rf)}"

    class V(apsw.VFS):
        def __init__(self):
            super().__init__(name, "")

        def xOpen(self, n, flags):
            return F()

        def xAccess(self, n, flags):
            return False

        def xFullPathname(self, n):
            return n

    vfs = V()
    db = apsw.Connection("file:index.gpkg?immutable=1", flags=apsw.SQLITE_OPEN_READONLY | apsw.SQLITE_OPEN_URI, vfs=name)
    return db, (vfs, rf)                                 # the VFS must live as long as the connection


class CanElevation(Margined):
    """CanElevation's COPC tiles, the project covering most of the tile (the newest among equals)."""
    INDEX = "https://canelevation-lidar-point-clouds.s3.ca-central-1.amazonaws.com/pointclouds_nuagespoints/Index_LiDARtiles_tuileslidar.gpkg"

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.db = None

    def tiles(self, t: grids.Tile, margin=MARGIN) -> dict[str, list[tuple[str, tuple]]]:
        if self.db is None:
            self.db, self.keep = _http_sqlite(self.http, self.INDEX)
        lon0, lat0, lon1, lat1 = _box_in(t, 4326, margin)
        q = ("select t.Project, t.URL, r.minx, r.miny, r.maxx, r.maxy from index_lidartiles_tuileslidar t "
             "join rtree_index_lidartiles_tuileslidar_geom r on t.fid = r.id where r.minx <= ? and r.maxx >= ? and r.miny <= ? and r.maxy >= ?")
        out: dict[str, list] = {}
        for proj, url, a, b, c, d in self.db.execute(q, (lon1, lon0, lat1, lat0)):
            out.setdefault(proj, []).append((url, (a, b, c, d)))
        return out

    def points(self, t, box):
        import laspy
        projs = self.tiles(t)
        lon0, lat0, lon1, lat1 = _box_in(t, 4326, 0)

        def cover(items):                                # the share of the tile under the project's tiles (their envelopes)
            n, hit = 12, 0
            for i in range(n):
                for j in range(n):
                    lo, la = lon0 + (i + 0.5) * (lon1 - lon0) / n, lat0 + (j + 0.5) * (lat1 - lat0) / n
                    hit += any(a <= lo <= c and b <= la <= d for _, (a, b, c, d) in items)
            return hit / n / n

        order = sorted(projs, key=lambda p: (round(cover(projs[p]), 1), _year(p)), reverse=True)
        for proj in order[:3]:
            parts = []
            for url, _ in projs[proj]:
                rd = laspy.CopcReader.open(url, http_num_threads=8)
                try:
                    src = _horizontal(rd.header.parse_crs())
                    if src is None:
                        raise RuntimeError(f"{url}: no coordinate system")
                    x0, y0, x1, y1 = _box_in(t, src)
                    p = from_las(rd.query(bounds=laspy.Bounds(mins=np.array([x0, y0]), maxs=np.array([x1, y1]))))
                    parts.append(reproject(p, src, t.epsg))
                finally:
                    getattr(rd.source, "close", lambda: None)()
            p = _cat(parts)
            if len(p["x"]):
                self.log(f"{t.id}: CanElevation {proj}, {len(projs[proj])} files")
                return p, {"date": str(_year(proj) or ""), "project": proj, "files": len(projs[proj])}
        return None


class LINZ(Margined):
    """LINZ's point clouds on OpenTopography's bucket, by their Topo50 tile names (NZTM2000)."""
    BUCKET = "https://opentopography.s3.sdsc.edu/pc-bulk/"
    # LINZ's Topo50 sheets (its topo-imagery tile index): 24 × 36 km, columns from 988 000 E, rows (two letters) from 6 234 000 N
    SHEET_W, SHEET_H, LEFT, TOP = 24_000, 36_000, 988_000, 6_234_000
    CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    ROW0 = 16                                          # "AS", the first row

    def _list(self, prefix, delimiter=None, max_keys=1000):
        params = {"list-type": "2", "prefix": prefix, "max-keys": str(max_keys)}
        if delimiter:
            params["delimiter"] = delimiter
        for k in range(4):
            try:
                r = self.http.get(self.BUCKET, params=params, timeout=60)
                r.raise_for_status()
                return re.findall(r"<Prefix>([^<]*)</Prefix>", r.text), re.findall(r"<Key>([^<]*)</Key>", r.text)
            except httpx.HTTPError:
                if k == 3:
                    raise
                time.sleep(3 * (k + 1))

    def datasets(self) -> dict[str, str]:
        """Every NZ dataset in LINZ's naming and its files' prefix (« CL2 »), {dataset: prefix}: one listing of the bucket and
        one short listing a dataset (in parallel; its first keys sort before its tile index), kept a week in the cache."""
        p = self.cache / "nz" / "datasets.json"
        if p.exists() and time.time() - p.stat().st_mtime < 7 * 86400:
            return json.loads(p.read_text(encoding="utf-8"))
        prefixes, _ = self._list("", "/")

        def pre(ds):
            _, keys = self._list(ds + "/", None, 3)
            m = next((re.match(rf"^{re.escape(ds)}/([A-Z]{{2}}\d)_[A-Z]{{2}}\d\d_\d{{4}}_\d+_\d+\.la[sxz]$", k) for k in keys), None)
            return ds, m[1] if m else None

        with ThreadPoolExecutor(8) as ex:
            out = {ds: v for ds, v in ex.map(pre, [x.rstrip("/") for x in prefixes if x.startswith("NZ")]) if v}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out), encoding="utf-8")
        return out

    def on_sheet(self, sheet: str) -> dict[str, tuple[str, int]]:
        """The datasets holding tiles of a Topo50 sheet: {dataset: (year, scale)} from one key each (prefix listings, in
        parallel), kept a week."""
        p = self.cache / "nz" / f"sheet_{sheet}.json"
        if p.exists() and time.time() - p.stat().st_mtime < 7 * 86400:
            return {k: tuple(v) for k, v in json.loads(p.read_text(encoding="utf-8")).items()}
        dss = self.datasets()

        def one(ds):
            _, keys = self._list(f"{ds}/{dss[ds]}_{sheet}_", None, 1)
            m = re.match(rf"^.*_{sheet}_(\d{{4}})_(\d+)_\d+\.la[sxz]$", keys[0]) if keys else None
            return ds, (m[1], int(m[2])) if m else None

        with ThreadPoolExecutor(8) as ex:
            out = {ds: v for ds, v in ex.map(one, sorted(dss)) if v}
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out), encoding="utf-8")
        return out

    def sheet_of(self, x, y) -> tuple[str, float, float]:
        col = math.floor((x - self.LEFT) / self.SHEET_W)
        row = math.floor((self.TOP - y) / self.SHEET_H) + self.ROW0
        code = self.CHARSET[row // 24] + self.CHARSET[row % 24] + f"{col:02d}"
        return code, self.LEFT + col * self.SHEET_W, self.TOP - (row - self.ROW0) * self.SHEET_H

    def names(self, box, scale: int) -> list[tuple[str, tuple]]:
        """The sheet tiles (sheet_scale_rrcc, their box) a box touches."""
        n = 50_000 // scale
        w, h = self.SHEET_W / n, self.SHEET_H / n
        dig = 2 if n < 100 else 3
        out = {}
        x0, y0, x1, y1 = box
        for y in np.arange(y0, y1 + h, h):
            for x in np.arange(x0, x1 + w, w):
                xx, yy = min(x, x1 - 0.01), min(y, y1 - 0.01)
                sheet, left, top = self.sheet_of(xx, yy)
                c, r = math.floor((xx - left) / w), math.floor((top - yy) / h)
                out[f"{sheet}_{scale}_{r + 1:0{dig}d}{c + 1:0{dig}d}"] = (left + c * w, top - (r + 1) * h, left + (c + 1) * w, top - r * h)
        return list(out.items())

    def points(self, t, box):
        import laspy
        dss = self.datasets()
        sheets = sorted({self.sheet_of(x, y)[0] for x in (box[0], box[2] - 0.01) for y in (box[1], box[3] - 0.01)})
        found: dict[str, tuple[str, int]] = {}
        for sh in sheets:
            for ds, v in self.on_sheet(sh).items():
                found.setdefault(ds, v)
        for ds in sorted(found, key=lambda d: (int(found[d][0]), d), reverse=True)[:4]:   # the newest survey first
            pre, (year, scale) = dss[ds], found[ds]
            parts, files = [], []
            for name, nb in self.names(box, scale):
                sheet_code, _, tile_no = name.split("_")
                url = f"{self.BUCKET}{ds}/{pre}_{sheet_code}_{year}_{scale}_{tile_no}.laz"
                dest = self.cache / "nz" / ds / url.rsplit("/", 1)[1]
                try:
                    download(self.http, url, dest)
                except httpx.HTTPStatusError as ex:
                    if ex.response.status_code in (403, 404):
                        continue                        # no tile there (the sea, the survey's edge)
                    raise
                las = laspy.read(str(dest))
                p = reproject(from_las(las), _horizontal(las.header.parse_crs()) or 2193, t.epsg)
                parts.append(_sel(p, in_box(p, box)))
                files.append(url)
            p = _cat(parts)
            if len(p["x"]):
                self.log(f"{t.id}: LINZ {ds}, {len(files)} files")
                return p, {"date": year, "project": ds, "files": len(files)}
        return None


FETCHERS = {"ch": Swiss, "us": USGS, "ca": CanElevation, "nz": LINZ}


def prepare(tids: list[str], lazdir: Path, demdir: Path, cache: Path, log=print, prog=None) -> dict:
    """The point clouds of one grid's tiles into lazdir (<id>.las/.laz, edge_<id>.laz) and their heights into
    demdir/dem_<id>.png: {id: {date, points, …} | None (no LiDAR there)}."""
    tiles = [grids.parse(t) for t in tids]
    cc = tiles[0].country
    if any(t.group != tiles[0].group for t in tiles):
        raise ValueError("one grid at a time")
    lazdir.mkdir(parents=True, exist_ok=True)
    demdir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=120, headers={"User-Agent": UA}, follow_redirects=True) as http:
        return FETCHERS[cc](http, cache, log).prepare(tiles, lazdir, demdir, prog)


if __name__ == "__main__":                              # py -3 -m mapgen.sources <tile id> <folder>: the fetch step alone
    import sys
    tid, base = sys.argv[1], Path(sys.argv[2])
    t0 = time.monotonic()
    res = prepare([tid], base / "laz", base, base / "cache")
    print(json.dumps(res, indent=1), f"{time.monotonic() - t0:.0f} s")
    for f in sorted((base / "laz").iterdir()):
        print(f.name, f.stat().st_size)
