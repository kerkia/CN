"""Generated orienteering maps from IGN's LiDAR HD and OpenStreetMap (a prototype, 2026-11-01), in 1 km tiles.

    py -3 -m mapgen tiles 0391_6819 0392_6819 --out DIR      # these tiles (IGN's names: west km, north km)
    py -3 -m mapgen area 48.380 -1.180 48.400 -1.150 --out DIR   # every tile of an area (lat, lon, lat, lon)
    ... --style sprint [--interval 2]                         # in a sprint map's style (forest by default), its other interval
    py -3 -m mapgen ci --requests DIR --out DIR              # the site's requests (lidarmap.yml)

A tile's map: IGN's classified point cloud (COPC LAZ, Licence Ouverte 2.0) through karttapullautin — a program of
its own (GPL-3), downloaded and run as it is, never part of Ozimut —, cut to its square kilometre, with OpenStreetMap's
roads, paths, buildings and water drawn over it (osm.py). Beside it the ground's heights every 2 m from IGN's MNT, for
the 3D view, Terrarium-encoded (R × 256 + G + B / 256 − 32 768 m) as the elevation tiles the 3D view already reads.

Each style has karttapullautin run with its own settings (KP_STYLE): a forest map's 5 m contours with form lines at
1:10 000, a sprint map's 2.5 m contours drawn at 1:4000 (its lines and cliffs 2.5 times finer on the ground), the render
then brought to the tile's pixel. Each style also at its other contour interval (2026-11-12, INTERVALS: forest 2.5 m, sprint
2 m), a « variant » with files of its own. A tile is made in the variant asked; its record lists the variants made, each with
its version (VARIANT_V: a variant's tiles of an older version are made again), and the settings karttapullautin was run with
("kp": {variant: {setting: value}}). Beside the contours, karttapullautin's dense « basemap » contours (every 0.5 or 1 m), the
helper contours Cartographier offers for drawing form lines: t/<id>.<variant>.help.json, the record's "help" {variant: interval}.

Out, per tile <id> (e.g. 0391_6819): t/<id>.png (2362 × 2362, 0.42333 m a pixel, the top-left corner at the tile's
north-west corner; a forest map's symbols) and t/<id>.s.png (the same in a sprint map's), t/<id>.dem.png (500 × 500, a node every 2 m from that corner), t/<id>.json (what and when).
For Cartographier (2026-11-06), per variant: t/<id>.<variant>.vec.json, karttapullautin's contours, form lines, cliffs, knolls and
small depressions as vectors in Lambert 93 (dxf.py), and t/<id>.<variant>.vege.png, its vegetation raster (1 m a pixel from
the tile's north-west corner); the record's "vec" lists the styles that have them, with their version (VEC_V).
A tile IGN has no LiDAR for yet: t/<id>.json alone, {"none": true}.

Beyond France (2026-11-06): Switzerland, the United States, Canada and New Zealand, each in a grid of its own (grids.py:
ch_2583_1219 in LV95, us_13_0475_4427 / ca_18_0433_5038 in UTM on WGS 84, nz_1571_5172 in NZTM2000), their point clouds read
by sources.py, the ground's heights computed from the points' ground class, the rest the same. A run makes each grid's tiles
apart (karttapullautin's batch mode must never mix two coordinate systems), in work/<grid>/. Every record names its system
("crs": "EPSG:…", "country") and its source ("src"); the world file's and the vectors' coordinates are in that system.

    py -3 -m mapgen tiles ch_2583_1219 --out DIR
    py -3 -m mapgen area 40.00 -105.30 40.01 -105.28 --country us --out DIR"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from . import dxf, grids, lambert93, osm

WFS = "https://data.geopf.fr/wfs/ows"
UA = osm.UA
PX = 0.4233333333333334          # karttapullautin's 600 dpi at 1:10 000
SIZE = 2362                      # pixels a tile side: 999.9 m
DEM_STEP, DEM_N = 2.0, 500
# a tile's two styles (osm.draw): a forest map's ISOM, a sprint map's ISSprOM, each on its own karttapullautin render
STYLES = {"forest": ".png", "sprint": ".s.png"}
# the contour intervals each style is made at (owner, 2026-11-12: ISSprOM 2019-2 draws 2 or 2.5 m, ISOM 2017-2 2.5 or 5 m — never
# 5 m on a sprint map), the first the style's default. A tile in another interval is a « variant » of the style, named
# "<style>-<interval in dm>" ("sprint-20", "forest-25"), its files apart: t/<id>.<variant>.png, .vec.json, .vege.png, .help.json.
INTERVALS = {"sprint": (2.5, 2.0), "forest": (5.0, 2.5)}
# a variant's version: a tile made in an older one is made again (sprint 2, 2026-11-01: its own render; sprint 3, 2026-11-12: its
# contours were every 0.5 m — karttapullautin halves contour_interval without form lines and scales it by scalefactor —, now
# every 2.5 m). Keep functions/api/lidarmap/[[path]].js's VARIANT_V and trace/lidarmap.js's in step.
VARIANT_V = {"forest": 1, "forest-25": 1, "sprint": 3, "sprint-20": 1}
STYLE_V = {k: VARIANT_V[k] for k in STYLES}
# karttapullautin's settings per style: sprint without form lines (formline 0), drawn at 1:4000 (scalefactor 0.4: the 600 dpi
# render 0.16933 m a pixel, so its lines are 2.5 times finer on the ground), contours too close to be told apart left out
# (remove_touching_contours: a rampart's slope came out solid brown); the interval's own settings in kp_settings
KP_STYLE = {"forest": {}, "sprint": {"formline": "0", "scalefactor": "0.4", "remove_touching_contours": "1"}}
# the helper contours (owner, 2026-11-12: dense contours, for drawing form lines by hand): karttapullautin's « basemap » contours
# (basemapinterval, a DXF without heights), every 0.5 m under 2-2.5 m contours, every metre under 5 m ones (both divide the
# interval), kept apart as t/<id>.<variant>.help.json (dxf.py)
HELP_V = 1
# the points kept (owner, 2026-11-12: a tenth of IGN's points gave the same map): karttapullautin's thinfactor set so that about
# THIN_TARGET points a m² go through (measured on two IGN tiles, 2026-11-12: Gif-sur-Yvette's town and woods, 29 points a m²,
# 40 s → 22-30 s; Fontainebleau's forest, 42 a m², 55-74 s → 47 s — reading the LAZ stays, the rest is ~5 times faster;
# vegetation and contours as with every point, a few small cliffs fewer), from the clouds' own headers: France ~0.15-0.2, the
# American and Canadian clouds alike, Switzerland's sparser ones less or not at all
THIN_TARGET = 6.0


def variant(style: str, interval: float | None = None) -> str:
    """A style at an interval: the style's own name at its default interval, else "<style>-<dm>"."""
    if interval is None or abs(interval - INTERVALS[style][0]) < 1e-6:
        return style
    if not any(abs(interval - v) < 1e-6 for v in INTERVALS[style]):
        raise ValueError(f"{style}: no {interval} m contours")
    return f"{style}-{round(interval * 10)}"


def parse_variant(v: str) -> tuple[str, float]:
    """A variant's style and contour interval."""
    style, _, dm = v.partition("-")
    if style not in STYLES:
        raise ValueError(f"variant {v}")
    return style, (int(dm) / 10 if dm else INTERVALS[style][0])


def help_interval(interval: float) -> float:
    return 1.0 if interval >= 5 else 0.5


def kp_settings(v: str) -> dict:
    """karttapullautin's settings of a variant (beside KP_SETTINGS): the style's, the interval's — with form lines (forest)
    contour_interval is the interval; without them karttapullautin draws contours every contour_interval / 2 × scalefactor
    (measured 2026-11-12), so sprint asks 2 × interval / 0.4 — and the index contours every fifth, the helper contours."""
    style, interval = parse_variant(v)
    out = dict(KP_STYLE[style])
    if out.get("formline") == "0":
        out["contour_interval"] = f"{2 * interval / float(out.get('scalefactor', 1)):g}"
        out["indexcontours"] = f"{5 * interval:g}"
    else:
        out["contour_interval"] = f"{interval:g}"
    out["basemapinterval"] = f"{help_interval(interval):g}"
    return out


def image_ext(v: str) -> str:
    """The map image's file ending: the style's own for its default interval, else the variant's."""
    return STYLES[v] if v in STYLES else f".{v}.png"


def thinfactor(laz: Path) -> float:
    """The share of points karttapullautin keeps: THIN_TARGET a m² over the clouds of the folder, from their LAS headers (the
    point count, 64-bit from LAS 1.4, and the bounds), at most 1."""
    import struct
    n = area = 0.0
    for f in list(laz.glob("*.laz")) + list(laz.glob("*.las")):
        try:
            with open(f, "rb") as fh:
                h = fh.read(255)
            if h[:4] != b"LASF":
                continue
            count = struct.unpack_from("<I", h, 107)[0]
            if h[25] >= 4 and len(h) >= 255:
                count = struct.unpack_from("<Q", h, 247)[0] or count
            maxx, minx, maxy, miny = struct.unpack_from("<4d", h, 179)
            n += count
            area += max(0.0, maxx - minx) * max(0.0, maxy - miny)
        except (OSError, struct.error):
            continue
    if not n or not area:
        return 1.0
    return round(min(1.0, THIN_TARGET / (n / area)), 3)
KP_VERSION = "2.15.4"
ID = re.compile(r"^(\d{4})_(\d{4})$")
MAX_TILES = 16                   # a run's work at most (~4 GB of point clouds)
# beyond France a tile counts double in a round's work: the American and Canadian clouds hold 25-50 points a m² (IGN's ~10-20),
# and they are read with a margin (sources.py)
ABROAD_COST = 2


def cost(tids: list[str]) -> int:
    return sum(1 if grids.parse(t).country == "fr" else ABROAD_COST for t in tids)
# karttapullautin's settings changed from its own defaults (pullauta.ini, written by the program at its first run)
# (savetempfiles and output_dxf on since 2026-11-06: each tile's contours, cliffs, knolls as DXF and its vegetation raster, for
# Cartographier's vectors)
KP_SETTINGS = {"batch": "1", "lazfolder": "./laz", "batchoutfolder": "./out", "savetempfiles": "1",
               "savetempfolders": "0", "output_dxf": "1"}
# the vectors' version (t/<id>.<style>.vec.json, dxf.VERSION): the record's "vec" {style: version}
VEC_V = dxf.VERSION


class Progress:
    """The run's progress, for the page that waits (owner, 2026-11-01: « progress bars wherever IGN, OpenStreetMap or
    karttapullautin take time »): four stages weighted by their usual share of the time; within a stage the share of its
    files or tiles done, or, for the two that cannot tell (karttapullautin, Overpass), 1 − e^(−elapsed / the usual time),
    which never claims to be done. report(stage, frac, info) is called every TICK seconds by a thread of its own and at each
    stage's start; info (2026-11-07, owner: « a progress bar with relevant information ») says what the page shows beside the
    bar: the country whose point clouds are read, the tiles of the run, a counted stage's done / total, the seconds spent in the
    stage, and, when the run holds tiles of several grids (one karttapullautin run each), which part it is at."""
    STAGES = (("lidar", 0.30), ("kp", 0.35), ("osm", 0.20), ("draw", 0.15))
    TICK = 10.0

    def __init__(self, report=None):
        self.report, self.stage, self.t0, self.est, self.done, self.total = report, None, 0.0, None, 0, 1
        self.country, self.tiles, self.part = None, 0, (0, 1)          # set by generate for each grid's tiles
        self.note: dict = {}                                            # the stage's own facts (Overpass: try, server)
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._tick, daemon=True) if report else None
        if self._thread:
            self._thread.start()

    def start(self, stage: str, total: int = 1, est: float | None = None) -> None:
        self.stage, self.t0, self.est, self.done, self.total = stage, time.monotonic(), est, 0, max(1, total)
        self.note = {}
        self.send()

    def step(self, n: int = 1) -> None:
        self.done += n

    def frac(self) -> float:
        """The share of the whole run done: the parts (grids) one after the other, each its four stages."""
        base, (k, n) = 0.0, self.part
        for name, w in self.STAGES:
            if name == self.stage:
                inside = (1 - math.exp(-(time.monotonic() - self.t0) / self.est)) if self.est else self.done / self.total
                return (k + base + w * min(1.0, inside)) / max(1, n)
            base += w
        return k / max(1, n)

    def info(self) -> dict:
        d = {"country": self.country, "tiles": self.tiles, "s": round(time.monotonic() - self.t0)}
        if not self.est:
            d.update(done=min(self.done, self.total), total=self.total)
        if self.part[1] > 1:
            d["part"] = [self.part[0] + 1, self.part[1]]
        return {**d, **self.note}

    def send(self) -> None:
        if self.report and self.stage:
            try:
                self.report(self.stage, self.frac(), self.info())
            except Exception as ex:                      # a progress not sent never stops the maps
                print(f"progress: {ex}")

    def _tick(self) -> None:
        while not self._stop.wait(self.TICK):
            self.send()

    def close(self) -> None:
        self._stop.set()


def tile_ids(lat0: float, lon0: float, lat1: float, lon1: float) -> list[str]:
    """The 1 km tiles an area touches, by IGN's name: the west and the north edges in km."""
    xs, ys = zip(*(lambert93.forward(a, b) for a in (lat0, lat1) for b in (lon0, lon1)))
    return [f"{x:04d}_{y:04d}" for y in range(math.floor(min(ys) / 1000) + 1, math.ceil(max(ys) / 1000) + 1)
            for x in range(math.floor(min(xs) / 1000), math.ceil(max(xs) / 1000))]


def corner(tid: str) -> tuple[int, int]:
    """The tile's north-west corner in its system's metres (France: Lambert 93)."""
    return grids.corner(tid)


def catalogue(tids: list[str], http: httpx.Client) -> dict[str, dict]:
    """IGN's records of the tiles (point cloud and MNT addresses, acquisition date), from its public WFS."""
    pts = [lambert93.inverse(x + dx, y - dy) for t in tids for x, y in [corner(t)] for dx in (100, 900) for dy in (100, 900)]
    lats, lons = [p[0] for p in pts], [p[1] for p in pts]
    r = http.get(WFS, params={"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
                              "TYPENAMES": "IGNF_LIDAR-HD_METADONNEE:metadata", "OUTPUTFORMAT": "application/json",
                              "BBOX": f"{min(lons)},{min(lats)},{max(lons)},{max(lats)},urn:ogc:def:crs:OGC:1.3:CRS84"})
    r.raise_for_status()
    out = {}
    for f in r.json().get("features", []):
        p = f["properties"]
        tid = (p.get("coordonnees_nw") or "").replace("-", "_")
        if tid in tids:
            out[tid] = {"laz": p.get("url_npl"), "mnt": _no_filename(p.get("url_mnt")),
                        "date": (p.get("date_fin_acquisition") or "")[:10]}
    return out


def _no_filename(url: str | None) -> str | None:
    """IGN's MNT address without its FILENAME parameter: since November 2026 its WMS answers 400 to a GetMap carrying one
    (the address its own metadata gives), and the same request without it the GeoTIFF."""
    return re.sub(r"&FILENAME=[^&]*", "", url, flags=re.I) if url else url


class Pace:
    """IGN's download service takes one request a second."""
    def __init__(self, s: float = 1.1):
        self.s, self.last = s, 0.0

    def wait(self) -> None:
        dt = self.s - (time.monotonic() - self.last)
        if dt > 0:
            time.sleep(dt)
        self.last = time.monotonic()


def fetch(http: httpx.Client, url: str, dest: Path, pace: Pace) -> Path:
    """A file into dest (kept: a second run reuses it), streamed."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    # IGN's servers answer 502/503 now and then, or drop a connection: tried again after 15 s, 45 s, 2 and 4 min
    # (2026-11-11: a 502 on the MNT stopped a whole Virtually build)
    for attempt, wait in enumerate((15, 45, 120, 240, None)):
        pace.wait()
        try:
            with http.stream("GET", url, timeout=600, follow_redirects=True) as r:
                r.raise_for_status()
                with open(part, "wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
            break
        except (httpx.HTTPStatusError, httpx.TransportError) as e:
            code = getattr(getattr(e, "response", None), "status_code", 0)
            if wait is None or (code and code < 500 and code != 429):
                raise
            print(f"  {type(e).__name__} {code or ''}, again in {wait} s", flush=True)
            time.sleep(wait)
    part.replace(dest)
    return dest


def karttapullautin(kp: Path, work: Path, processes: int, v: str = "forest", used: dict | None = None) -> Path:
    """karttapullautin over every point cloud in work/laz, in its batch mode (each tile with its neighbours' edges), with
    the variant's settings, in a folder of the variant's own (work/<variant>, returned); `used` gets the settings changed from
    karttapullautin's own defaults (for the tiles' records: Cartographier shows them)."""
    home = work / v
    home.mkdir(parents=True, exist_ok=True)
    ini = home / "pullauta.ini"
    if not ini.exists():
        subprocess.run([str(kp)], cwd=home, check=True, capture_output=True)
    text = ini.read_text(encoding="utf-8")
    laz = (work / "laz").resolve().as_posix()
    mine = {**kp_settings(v), "thinfactor": f"{thinfactor(work / 'laz'):g}"}
    if used is not None:
        used.update(mine)
    for k, val in {**KP_SETTINGS, "lazfolder": laz, **mine, "processes": str(processes)}.items():
        text, n = re.subn(rf"(?m)^{k}\s*=.*$", f"{k}={val}", text)
        if not n:
            text += f"\n{k}={val}\n"
    ini.write_text(text, encoding="utf-8")
    # its batch mode skips a point cloud whose render is there: an earlier run's (other settings) must go
    shutil.rmtree(home / "out", ignore_errors=True)
    (home / "out").mkdir()
    env = {**os.environ, "RUST_LOG": "warn"}
    subprocess.run([str(kp)], cwd=home, check=True, env=env)
    return home


def rendered(home: Path, tid: str, style: str = "forest") -> tuple[Image.Image, float]:
    """karttapullautin's render of a tile (with its depressions) and its pixel in metres, cut to the tile: its first
    pixel's corner is the tile's (it starts at the tile's corner and runs a little further)."""
    p = next((home / "out").glob(f"*{tid}*_depr.png"))
    w = [float(v) for v in p.with_suffix(".pgw").read_text().split()]
    px = PX * float(KP_STYLE[style].get("scalefactor", 1))
    x0, y1 = corner(tid)
    i0, j0 = round((x0 - (w[4] - w[0] / 2)) / w[0]), round((y1 - (w[5] - w[3] / 2)) / w[3])
    if abs(w[0] - px) > 1e-6 or abs(w[3] + px) > 1e-6 or (grids.parse(tid).country == "fr" and (i0, j0) != (0, 0)):
        raise RuntimeError(f"{tid}: unexpected render frame {w}")
    im = Image.open(p)
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.getchannel("A") if im.mode == "RGBA" else None)
    n = round(SIZE * PX / px)
    if (i0, j0) == (0, 0):
        return bg.crop((0, 0, n, n)), px
    # beyond France the render may start where the tile's first point lies: its pixels moved onto the tile's own
    out = Image.new("RGB", (n, n), (255, 255, 255))
    out.paste(bg, (-i0, -j0))
    return out, px


def dem(tif: Path) -> Image.Image:
    """IGN's MNT (0.5 m, pixel centres from the tile's corner) as Terrarium heights every 2 m, the mean of the
    3 × 3 MNT pixels round each node; holes (water: no ground) filled from their neighbours."""
    z = np.array(Image.open(tif), dtype=np.float64)
    bad = ~np.isfinite(z) | (z < -500)
    if bad.all():
        raise RuntimeError(f"{tif.name}: no heights")
    if bad.any():
        z[bad] = np.nan
        for _ in range(200):
            if not np.isnan(z).any():
                break
            p = np.pad(z, 1, mode="edge")
            nb = np.stack([p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
            fill = np.nanmean(np.where(np.isnan(nb), np.nan, nb), axis=0)
            z = np.where(np.isnan(z), fill, z)
        z[np.isnan(z)] = np.nanmean(z)
    p = np.pad(z, 1, mode="edge")
    k = int(DEM_STEP / 0.5)
    m = sum(p[1 + dj: 1 + dj + z.shape[0], 1 + di: 1 + di + z.shape[1]] for dj in (-1, 0, 1) for di in (-1, 0, 1)) / 9
    g = m[::k, ::k][:DEM_N, :DEM_N] + 32768
    r = np.floor(g / 256)
    gg = np.floor(g - r * 256)
    b = np.floor((g - np.floor(g)) * 256)
    return Image.fromarray(np.stack([r, gg, b], axis=-1).astype(np.uint8), "RGB")


# karttapullautin's usual time (s): a start, then each tile (measured on the PC, 2026-11-01: forest ~17 s a tile in batch,
# sprint's render at 1:4000 ~40 s; 2026-11-12, the points thinned: forest ~45 s a dense tile alone, most of it reading the LAZ);
# Overpass's usual answer
KP_EST = {"forest": (15, 15), "sprint": (15, 30)}
OSM_EST = 240                 # Overpass answered in 1-10 min on 2026-11-06/07 (60 s made the bar stop short of it)


def generate(tids: list[str], out: Path, work: Path, kp: Path, processes: int = 4, log=print, style: str = "forest",
             known: Path | None = None, progress: Progress | None = None) -> dict[str, str]:
    """The tiles' maps in a style or variant ("forest", "sprint-20": variant()) into out/t/, each tile's record keeping the variants made before (its former record read
    from out/t, else from known/: the workflow's copy of R2's). Returns each tile's outcome: "done", "none" (no LiDAR
    there yet) or an error. France's tiles in work/ as before, each other grid's in work/<grid>/ (one karttapullautin run
    per coordinate system: its batch mode reads every file of its folder as neighbours)."""
    res: dict[str, str] = {}
    groups = grids.groups(tids)
    for k, (g, ids) in enumerate(groups.items()):
        if progress:
            progress.part, progress.tiles, progress.country = (k, len(groups)), len(ids), grids.parse(ids[0]).country
        if g == "fr":
            res.update(_generate(ids, out, work, kp, processes, log, style, known, progress))
            continue
        try:
            res.update(_generate(ids, out, work / g, kp, processes, log, style, known, progress, dl_cache=work / "cache"))
        except Exception as ex:                         # another grid's tiles of the same run go on
            log(f"{g}: {ex}")
            res.update({t: f"error: {ex}"[:300] for t in ids})
    return res


def _generate(tids: list[str], out: Path, work: Path, kp: Path, processes: int = 4, log=print, style: str = "forest",
              known: Path | None = None, progress: Progress | None = None, dl_cache: Path | None = None) -> dict[str, str]:
    """One grid's tiles (generate); dl_cache: where the other countries' downloads and indexes are kept between grids."""
    tile0 = grids.parse(tids[0])
    epsg, country = tile0.epsg, tile0.country
    v, (style, interval) = style, parse_variant(style)              # the variant asked, its style and contour interval
    tdir = out / "t"
    tdir.mkdir(parents=True, exist_ok=True)
    (work / "laz").mkdir(parents=True, exist_ok=True)
    res: dict[str, str] = {}
    prog = progress or Progress()
    http = httpx.Client(timeout=120, headers={"User-Agent": UA})
    pace = Pace()
    t0 = time.monotonic()
    if country == "fr":
        cat = catalogue(tids, http)
    else:
        from . import sources                            # beyond France: the country's own point clouds (sources.py)
        prog.start("lidar", total=len(tids))
        got = sources.prepare(tids, work / "laz", work, dl_cache or work / "cache", log, prog)
        cat = {t: {**v, "laz": True} for t, v in got.items() if v}
    for t in tids:
        if t not in cat or not cat[t]["laz"]:
            res[t] = "none"
            (tdir / f"{t}.json").write_text(json.dumps({"id": t, "none": True, "checked": _now()}), encoding="utf-8")
    todo = [t for t in tids if t not in res]
    if not todo:
        return res
    if country == "fr":
        prog.start("lidar", total=2 * len(todo))
        for t in todo:
            fetch(http, cat[t]["laz"], work / "laz" / f"LHD_{t}.copc.laz", pace)
            prog.step()
            fetch(http, cat[t]["mnt"], work / f"mnt_{t}.tif", pace)
            prog.step()
    log(f"downloaded {len(todo)} tiles in {time.monotonic() - t0:.0f} s")
    t1 = time.monotonic()
    a, b = KP_EST[style]
    prog.start("kp", est=a + b * len(todo))
    used: dict = {}
    home = karttapullautin(kp, work, processes, v, used)
    log(f"karttapullautin ({v}, {used}): {time.monotonic() - t1:.0f} s")
    xs, ys = zip(*(corner(t) for t in todo))
    s, w = grids.to_latlon(epsg, min(xs) - 50, min(ys) - 1050)
    n, e = grids.to_latlon(epsg, max(xs) + 1050, max(ys) + 50)
    s2, w2 = grids.to_latlon(epsg, min(xs) - 50, max(ys) + 50)
    n2, e2 = grids.to_latlon(epsg, max(xs) + 1050, min(ys) - 1050)
    # without OpenStreetMap the tiles fail (asked again, they are made again) rather than be kept without roads and paths
    # the answer is kept in the work folder: MAPGEN_OSM_CACHE=1 reads it back (trying a style without asking Overpass again)
    cache = work / f"osm_{todo[0]}_{len(todo)}.json"
    prog.start("osm", est=OSM_EST)
    try:
        if os.environ.get("MAPGEN_OSM_CACHE") == "1" and cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            def tried(k: int, server: str) -> None:
                prog.note = {"try": k, "server": server}
                if k > 1:
                    prog.send()
            data = osm.query(min(s, s2), min(w, w2), max(n, n2), max(e, e2), http, on_attempt=tried)
            cache.write_text(json.dumps(data), encoding="utf-8")
        feats = osm.project(osm.features(data), None if country == "fr" else lambda a, b: grids.from_latlon(epsg, a, b))
        osm_at = _now()
    except Exception as ex:
        log(f"OpenStreetMap: {ex}")
        return {**res, **{t: f"error: OpenStreetMap: {ex}"[:300] for t in todo}}
    prog.start("draw", total=len(todo))
    for t in todo:
        prog.step(0)
        try:
            x0, y1 = corner(t)
            # OpenStreetMap drawn on the render's own pixels (the ground's fill reads its colours, which averaging blurs),
            # then the whole brought to the tile's pixel PX
            base, px = rendered(home, t, style)
            img = osm.draw(base, feats, x0, y1, px, style)
            if img.width != SIZE:
                img = img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
            img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(tdir / f"{t}{image_ext(v)}", optimize=True)
            if country == "fr":
                dem(work / f"mnt_{t}.tif").save(tdir / f"{t}.dem.png", optimize=True)
            elif (work / f"dem_{t}.png").exists():          # the ground points' heights (sources.dem_png)
                shutil.copyfile(work / f"dem_{t}.png", tdir / f"{t}.dem.png")
            prior = _prior(tdir, known, t)
            ver = {k: n for k, n in _versions(tdir, known, t).items() if k != v}
            ver[v] = VARIANT_V[v]
            vec = {k: n for k, n in prior.get("vec", {}).items() if k != v}
            hlp = {k: n for k, n in prior.get("help", {}).items() if k != v}
            kps = {k: n for k, n in prior.get("kp", {}).items() if k != v} if isinstance(prior.get("kp"), dict) else {}
            kps[v] = used
            got = vectors(home, t, x0, y1, v, tdir, log, f"EPSG:{epsg}")
            if got:
                vec[v] = VEC_V
            if got == "help":
                hlp[v] = help_interval(interval)
            (tdir / f"{t}.json").write_text(json.dumps({
                "id": t, "x0": x0, "y1": y1, "px": PX, "size": SIZE, "dem": {"step": DEM_STEP, "n": DEM_N},
                "styles": sorted({parse_variant(k)[0] for k in ver if k in STYLES}), "v": ver, "vec": vec, "help": hlp,
                "lidar": cat[t]["date"], "osm": osm_at, "kpv": KP_VERSION, "kp": kps, "made": _now(), "crs": f"EPSG:{epsg}",
                "country": country, "src": grids.SOURCES[country]["name"],
                **({"project": cat[t]["project"]} if cat[t].get("project") else {})}), encoding="utf-8")
            res[t] = "done"
        except Exception as ex:
            log(f"{t}: {ex}")
            res[t] = f"error: {ex}"[:300]
        prog.step()
    log(f"{len(todo)} tiles in {time.monotonic() - t0:.0f} s")
    return res


def vectors(home: Path, tid: str, x0: int, y1: int, v: str, tdir: Path, log=print, crs: str = "EPSG:2154") -> bool | str:
    """The tile's vectors (karttapullautin's DXF files, dxf.py), its helper contours and its vegetation raster, cut to the
    tile, into tdir/<id>.<variant>.vec.json, .help.json and .vege.png; "help" when the helper contours are there too, True without
    them, False when karttapullautin left none (never a reason to fail the tile)."""
    try:
        files = dxf.find(home / "out", tid)
        helper = files.pop("basemap", None)
        if not files:
            return False
        n = dxf.write(tdir / f"{tid}.{v}.vec.json", dxf.tile_vectors(files, tid, x0, y1, v, crs=crs))
        if helper:
            h = dxf.write(tdir / f"{tid}.{v}.help.json", dxf.tile_vectors({"basemap": helper}, tid, x0, y1, v, crs=crs, simplify=dxf.HELP_TOL))
            log(f"{tid}: helper contours {h} bytes")
        veg = next(iter(sorted((home / "out").glob(f"*{tid}*_vege.png"))), None)
        if veg and veg.with_suffix(".pgw").exists():
            w = [float(v) for v in veg.with_suffix(".pgw").read_text().split()]
            i0, j0 = round((x0 - (w[4] - w[0] / 2)) / w[0]), round((y1 - (w[5] - w[3] / 2)) / w[3])
            k = round(1000 / w[0])
            vi = Image.new("RGB", (k, k), (255, 255, 255))           # beyond France the raster may start off the corner
            vi.paste(Image.open(veg).convert("RGB"), (-i0, -j0))
            vi.save(tdir / f"{tid}.{v}.vege.png", optimize=True)
        log(f"{tid}: vectors {n} bytes")
        return "help" if helper else True
    except Exception as ex:                              # the map is made all the same
        log(f"{tid}: vectors: {ex}")
        return False


def _prior(tdir: Path, known: Path | None, tid: str) -> dict:
    """The tile's former record (out/t, else the workflow's copy of R2's), {} when none."""
    for d in (tdir, known):
        p = d / f"{tid}.json" if d else None
        if p and p.exists():
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
            except ValueError:
                continue
            return {} if m.get("none") else m
    return {}


def _versions(tdir: Path, known: Path | None, tid: str) -> dict[str, int]:
    """The styles a tile was made in before, with their versions (a record without "v": its "styles" at version 1)."""
    for d in (tdir, known):
        p = d / f"{tid}.json" if d else None
        if p and p.exists():
            try:
                m = json.loads(p.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if not m.get("none"):
                return m.get("v") or {k: 1 for k in m.get("styles", ["forest"])}
    return {}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def progress_to(dest: str | None, reqs: list[dict], out: Path):
    """The requests' progress written while the tiles are made: each request's record with its "progress" (stage, share
    done, when), copied to R2 at dest (the workflow's aws CLI and endpoint, env R2) — the page reads it there."""
    pdir = out / "prog"

    def report(stage: str, frac: float, info: dict | None = None) -> None:
        pdir.mkdir(parents=True, exist_ok=True)
        for r in reqs:
            f = pdir / f"{r['id']}.json"
            f.write_text(json.dumps({**r, "progress": {"stage": stage, "frac": round(frac, 3), "at": _now(), **(info or {})}}),
                         encoding="utf-8")
            if dest:
                subprocess.run(["aws", "s3", "cp", str(f), f"{dest}{r['id']}.json", "--endpoint-url", os.environ.get("R2", ""),
                                "--only-show-errors"], timeout=30, capture_output=True)
    return report


def ci(reqs: Path, out: Path, work: Path, kp: Path, processes: int, known: Path | None = None,
       progress_dest: str | None = None) -> None:
    """The site's waiting requests (lidarmap/req/<id>.json, {id, tiles, style, interval?, status "queued"}): their tiles made
    in the oldest request's variant (style and contour interval), at most MAX_TILES a run (the rest, and the other variants',
    wait for the next round), each request's status written to out/req/."""
    queued = []
    for p in sorted(reqs.glob("*.json")):
        try:
            r = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if r.get("status") == "queued":
            queued.append(r)
    queued.sort(key=lambda r: r.get("at", ""))
    tids: list[str] = []
    take = []
    def variant_of(r: dict) -> str:
        try:
            return variant(r.get("style") if r.get("style") in STYLES else "forest", r.get("interval"))
        except (ValueError, TypeError):
            return r.get("style") if r.get("style") in STYLES else "forest"
    style = variant_of(queued[0]) if queued else "forest"
    for r in (r for r in queued if variant_of(r) == style):
        new = [t for t in r.get("tiles", []) if grids.valid(t) and t not in tids]
        if take and cost(tids) + cost(new) > MAX_TILES:
            break
        tids += new[:MAX_TILES]
        take.append(r)
    print(f"{len(queued)} requests waiting, {len(take)} taken, {len(tids)} tiles ({style})")
    if not tids:
        return
    prog = Progress(progress_to(progress_dest, take, out))
    try:
        res = generate(tids, out, work, kp, processes, style=style, known=known, progress=prog)
    except Exception as ex:
        res = {t: f"error: {ex}"[:300] for t in tids}
    finally:
        prog.close()
    (out / "req").mkdir(parents=True, exist_ok=True)
    for r in take:
        mine = {t: res.get(t, "error: not made") for t in r["tiles"]}
        r["result"] = mine
        r["status"] = "failed" if any(v.startswith("error") for v in mine.values()) else "done"
        r["done"] = _now()
        (out / "req" / f"{r['id']}.json").write_text(json.dumps(r), encoding="utf-8")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="mapgen")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("tiles"); a.add_argument("ids", nargs="+")
    b = sub.add_parser("area"); b.add_argument("box", nargs=4, type=float)
    b.add_argument("--country", choices=grids.COUNTRIES, default="fr")
    c = sub.add_parser("ci"); c.add_argument("--requests", required=True, type=Path)
    c.add_argument("--known", type=Path, default=None)
    c.add_argument("--progress-to", default=None, help="R2 address the requests' progress is copied to (s3://…/lidarmap/req/)")
    for p in (a, b):
        p.add_argument("--style", choices=list(STYLES), default="forest")
        p.add_argument("--interval", type=float, default=None, help="contour interval, m (INTERVALS: sprint 2.5 or 2, forest 5 or 2.5)")
    for p in (a, b, c):
        p.add_argument("--out", required=True, type=Path)
        p.add_argument("--work", type=Path, default=None)
        p.add_argument("--kp", type=Path, default=Path(shutil.which("pullauta") or "pullauta"))
        p.add_argument("--processes", type=int, default=4)
    args = ap.parse_args(argv)
    work = args.work or args.out / "work"
    work.mkdir(parents=True, exist_ok=True)
    if args.cmd == "ci":
        ci(args.requests, args.out, work, args.kp, args.processes, args.known, args.progress_to)
        return
    if args.cmd == "tiles":
        ids = args.ids
    elif args.country == "fr":
        ids = tile_ids(*args.box)
    else:
        la0, lo0, la1, lo1 = args.box
        ids = grids.ids_for(args.country, [(la0, lo0), (la1, lo1), (la0, lo1), (la1, lo0)], 0)
    bad = [t for t in ids if not grids.valid(t)]
    if bad:
        sys.exit(f"bad tile ids: {bad}")
    if len(ids) > MAX_TILES:
        sys.exit(f"{len(ids)} tiles: at most {MAX_TILES}")
    print(json.dumps(generate(ids, args.out, work, args.kp, args.processes, style=variant(args.style, args.interval)), indent=1))
