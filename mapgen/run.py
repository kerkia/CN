"""Generated orienteering maps from IGN's LiDAR HD and OpenStreetMap (a prototype, 2026-11-01), in 1 km tiles.

    py -3 -m mapgen tiles 0391_6819 0392_6819 --out DIR      # these tiles (IGN's names: west km, north km)
    py -3 -m mapgen area 48.380 -1.180 48.400 -1.150 --out DIR   # every tile of an area (lat, lon, lat, lon)
    ... --style sprint                                         # in a sprint map's style (forest by default)
    py -3 -m mapgen ci --requests DIR --out DIR              # the site's requests (lidarmap.yml)

A tile's map: IGN's classified point cloud (COPC LAZ, Licence Ouverte 2.0) through karttapullautin — a program of
its own (GPL-3), downloaded and run as it is, never part of Ozimut —, cut to its square kilometre, with OpenStreetMap's
roads, paths, buildings and water drawn over it (osm.py). Beside it the ground's heights every 2 m from IGN's MNT, for
the 3D view, Terrarium-encoded (R × 256 + G + B / 256 − 32 768 m) as the elevation tiles the 3D view already reads.

Each style has karttapullautin run with its own settings (KP_STYLE): a forest map's 5 m contours with form lines at
1:10 000, a sprint map's 2.5 m contours drawn at 1:4000 (its lines and cliffs 2.5 times finer on the ground), the render
then brought to the tile's pixel. A tile is made in the style asked; its record lists the styles made, each with its
version (STYLE_V: a style's tiles of an older version are made again).

Out, per tile <id> (e.g. 0391_6819): t/<id>.png (2362 × 2362, 0.42333 m a pixel, the top-left corner at the tile's
north-west corner; a forest map's symbols) and t/<id>.s.png (the same in a sprint map's), t/<id>.dem.png (500 × 500, a node every 2 m from that corner), t/<id>.json (what and when).
For Cartographier (2026-11-06), per style: t/<id>.<style>.vec.json, karttapullautin's contours, form lines, cliffs, knolls and
small depressions as vectors in Lambert 93 (dxf.py), and t/<id>.<style>.vege.png, its vegetation raster (1 m a pixel from
the tile's north-west corner); the record's "vec" lists the styles that have them, with their version (VEC_V).
A tile IGN has no LiDAR for yet: t/<id>.json alone, {"none": true}."""
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

from . import dxf, lambert93, osm

WFS = "https://data.geopf.fr/wfs/ows"
UA = osm.UA
PX = 0.4233333333333334          # karttapullautin's 600 dpi at 1:10 000
SIZE = 2362                      # pixels a tile side: 999.9 m
DEM_STEP, DEM_N = 2.0, 500
# a tile's two styles (osm.draw): a forest map's ISOM, a sprint map's ISSprOM, each on its own karttapullautin render
STYLES = {"forest": ".png", "sprint": ".s.png"}
# a style's version: a tile made in an older one is made again (sprint 2, 2026-11-01: its own render, 2.5 m contours at
# 1:4000; before, the forest render under the sprint symbols). Keep functions/api/lidarmap/[[path]].js's STYLE_V in step.
STYLE_V = {"forest": 1, "sprint": 2}
# karttapullautin's settings per style: sprint's contours every 2.5 m without form lines (formline 0; ISSprOM's 2-2.5 m),
# drawn at 1:4000 (scalefactor 0.4: the 600 dpi render 0.16933 m a pixel, so its lines are 2.5 times finer on the ground),
# contours too close to be told apart left out (remove_touching_contours: a rampart's slope came out solid brown)
KP_STYLE = {"forest": {}, "sprint": {"formline": "0", "contour_interval": "2.5", "scalefactor": "0.4",
                                     "remove_touching_contours": "1"}}
KP_VERSION = "2.15.4"
ID = re.compile(r"^(\d{4})_(\d{4})$")
MAX_TILES = 16                   # a run's work at most (~4 GB of point clouds)
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
    which never claims to be done. report(stage, frac) is called every TICK seconds by a thread of its own and at each
    stage's start."""
    STAGES = (("lidar", 0.30), ("kp", 0.35), ("osm", 0.20), ("draw", 0.15))
    TICK = 10.0

    def __init__(self, report=None):
        self.report, self.stage, self.t0, self.est, self.done, self.total = report, None, 0.0, None, 0, 1
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._tick, daemon=True) if report else None
        if self._thread:
            self._thread.start()

    def start(self, stage: str, total: int = 1, est: float | None = None) -> None:
        self.stage, self.t0, self.est, self.done, self.total = stage, time.monotonic(), est, 0, max(1, total)
        self.send()

    def step(self, n: int = 1) -> None:
        self.done += n

    def frac(self) -> float:
        base = 0.0
        for name, w in self.STAGES:
            if name == self.stage:
                inside = (1 - math.exp(-(time.monotonic() - self.t0) / self.est)) if self.est else self.done / self.total
                return base + w * min(1.0, inside)
            base += w
        return 0.0

    def send(self) -> None:
        if self.report and self.stage:
            try:
                self.report(self.stage, self.frac())
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
    """The tile's north-west corner in Lambert 93 metres."""
    m = ID.match(tid)
    if not m:
        raise ValueError(f"bad tile id {tid!r}")
    return int(m[1]) * 1000, int(m[2]) * 1000


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
            out[tid] = {"laz": p.get("url_npl"), "mnt": p.get("url_mnt"), "date": (p.get("date_fin_acquisition") or "")[:10]}
    return out


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
    pace.wait()
    part = dest.with_suffix(dest.suffix + ".part")
    with http.stream("GET", url, timeout=600, follow_redirects=True) as r:
        r.raise_for_status()
        with open(part, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    part.replace(dest)
    return dest


def karttapullautin(kp: Path, work: Path, processes: int, style: str = "forest") -> Path:
    """karttapullautin over every point cloud in work/laz, in its batch mode (each tile with its neighbours' edges), with
    the style's settings, in a folder of the style's own (work/<style>, returned)."""
    home = work / style
    home.mkdir(parents=True, exist_ok=True)
    ini = home / "pullauta.ini"
    if not ini.exists():
        subprocess.run([str(kp)], cwd=home, check=True, capture_output=True)
    text = ini.read_text(encoding="utf-8")
    laz = (work / "laz").resolve().as_posix()
    for k, v in {**KP_SETTINGS, "lazfolder": laz, **KP_STYLE[style], "processes": str(processes)}.items():
        text, n = re.subn(rf"(?m)^{k}\s*=.*$", f"{k}={v}", text)
        if not n:
            text += f"\n{k}={v}\n"
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
    if abs(w[0] - px) > 1e-6 or (i0, j0) != (0, 0):
        raise RuntimeError(f"{tid}: unexpected render frame {w}")
    im = Image.open(p)
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.getchannel("A") if im.mode == "RGBA" else None)
    n = round(SIZE * PX / px)
    return bg.crop((0, 0, n, n)), px


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
# sprint's render at 1:4000 ~40 s); Overpass's usual answer
KP_EST = {"forest": (15, 18), "sprint": (15, 40)}
OSM_EST = 60


def generate(tids: list[str], out: Path, work: Path, kp: Path, processes: int = 4, log=print, style: str = "forest",
             known: Path | None = None, progress: Progress | None = None) -> dict[str, str]:
    """The tiles' maps in a style into out/t/, each tile's record keeping the styles made before (its former record read
    from out/t, else from known/: the workflow's copy of R2's). Returns each tile's outcome: "done", "none" (no LiDAR
    there yet) or an error."""
    tdir = out / "t"
    tdir.mkdir(parents=True, exist_ok=True)
    (work / "laz").mkdir(parents=True, exist_ok=True)
    res: dict[str, str] = {}
    prog = progress or Progress()
    http = httpx.Client(timeout=120, headers={"User-Agent": UA})
    pace = Pace()
    t0 = time.monotonic()
    cat = catalogue(tids, http)
    for t in tids:
        if t not in cat or not cat[t]["laz"]:
            res[t] = "none"
            (tdir / f"{t}.json").write_text(json.dumps({"id": t, "none": True, "checked": _now()}), encoding="utf-8")
    todo = [t for t in tids if t not in res]
    if not todo:
        return res
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
    home = karttapullautin(kp, work, processes, style)
    log(f"karttapullautin ({style}): {time.monotonic() - t1:.0f} s")
    xs, ys = zip(*(corner(t) for t in todo))
    s, w = lambert93.inverse(min(xs) - 50, min(ys) - 1050)
    n, e = lambert93.inverse(max(xs) + 1050, max(ys) + 50)
    s2, w2 = lambert93.inverse(min(xs) - 50, max(ys) + 50)
    n2, e2 = lambert93.inverse(max(xs) + 1050, min(ys) - 1050)
    # without OpenStreetMap the tiles fail (asked again, they are made again) rather than be kept without roads and paths
    # the answer is kept in the work folder: MAPGEN_OSM_CACHE=1 reads it back (trying a style without asking Overpass again)
    cache = work / f"osm_{todo[0]}_{len(todo)}.json"
    prog.start("osm", est=OSM_EST)
    try:
        if os.environ.get("MAPGEN_OSM_CACHE") == "1" and cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            data = osm.query(min(s, s2), min(w, w2), max(n, n2), max(e, e2), http)
            cache.write_text(json.dumps(data), encoding="utf-8")
        feats = osm.project(osm.features(data))
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
            img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(tdir / f"{t}{STYLES[style]}", optimize=True)
            dem(work / f"mnt_{t}.tif").save(tdir / f"{t}.dem.png", optimize=True)
            v = {k: n for k, n in _versions(tdir, known, t).items() if k != style}
            v[style] = STYLE_V[style]
            vec = {k: n for k, n in _prior(tdir, known, t).get("vec", {}).items() if k != style}
            if vectors(home, t, x0, y1, style, tdir, log):
                vec[style] = VEC_V
            (tdir / f"{t}.json").write_text(json.dumps({
                "id": t, "x0": x0, "y1": y1, "px": PX, "size": SIZE, "dem": {"step": DEM_STEP, "n": DEM_N}, "styles": sorted(v),
                "v": v, "vec": vec, "lidar": cat[t]["date"], "osm": osm_at, "kp": KP_VERSION, "made": _now()}), encoding="utf-8")
            res[t] = "done"
        except Exception as ex:
            log(f"{t}: {ex}")
            res[t] = f"error: {ex}"[:300]
        prog.step()
    log(f"{len(todo)} tiles in {time.monotonic() - t0:.0f} s")
    return res


def vectors(home: Path, tid: str, x0: int, y1: int, style: str, tdir: Path, log=print) -> bool:
    """The tile's vectors (karttapullautin's DXF files, dxf.py) and its vegetation raster, cut to the tile, into
    tdir/<id>.<style>.vec.json and .vege.png; False when karttapullautin left none (never a reason to fail the tile)."""
    try:
        files = dxf.find(home / "out", tid)
        if not files:
            return False
        n = dxf.write(tdir / f"{tid}.{style}.vec.json", dxf.tile_vectors(files, tid, x0, y1, style))
        veg = next(iter(sorted((home / "out").glob(f"*{tid}*_vege.png"))), None)
        if veg and veg.with_suffix(".pgw").exists():
            w = [float(v) for v in veg.with_suffix(".pgw").read_text().split()]
            i0, j0 = round((x0 - (w[4] - w[0] / 2)) / w[0]), round((y1 - (w[5] - w[3] / 2)) / w[3])
            k = round(1000 / w[0])
            Image.open(veg).convert("RGB").crop((i0, j0, i0 + k, j0 + k)).save(tdir / f"{tid}.{style}.vege.png", optimize=True)
        log(f"{tid}: vectors {n} bytes")
        return True
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

    def report(stage: str, frac: float) -> None:
        pdir.mkdir(parents=True, exist_ok=True)
        for r in reqs:
            f = pdir / f"{r['id']}.json"
            f.write_text(json.dumps({**r, "progress": {"stage": stage, "frac": round(frac, 3), "at": _now()}}), encoding="utf-8")
            if dest:
                subprocess.run(["aws", "s3", "cp", str(f), f"{dest}{r['id']}.json", "--endpoint-url", os.environ.get("R2", ""),
                                "--only-show-errors"], timeout=30, capture_output=True)
    return report


def ci(reqs: Path, out: Path, work: Path, kp: Path, processes: int, known: Path | None = None,
       progress_dest: str | None = None) -> None:
    """The site's waiting requests (lidarmap/req/<id>.json, {id, tiles, style, status "queued"}): their tiles made in the
    oldest request's style, at most MAX_TILES a run (the rest, and the other style's, wait for the next round), each
    request's status written to out/req/."""
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
    style = next((r.get("style") for r in queued if r.get("style") in STYLES), "forest")
    for r in (r for r in queued if (r.get("style") if r.get("style") in STYLES else "forest") == style):
        new = [t for t in r.get("tiles", []) if ID.match(t) and t not in tids]
        if take and len(tids) + len(new) > MAX_TILES:
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
    c = sub.add_parser("ci"); c.add_argument("--requests", required=True, type=Path)
    c.add_argument("--known", type=Path, default=None)
    c.add_argument("--progress-to", default=None, help="R2 address the requests' progress is copied to (s3://…/lidarmap/req/)")
    for p in (a, b):
        p.add_argument("--style", choices=list(STYLES), default="forest")
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
    ids = args.ids if args.cmd == "tiles" else tile_ids(*args.box)
    if len(ids) > MAX_TILES:
        sys.exit(f"{len(ids)} tiles: at most {MAX_TILES}")
    print(json.dumps(generate(ids, args.out, work, args.kp, args.processes, style=args.style), indent=1))
