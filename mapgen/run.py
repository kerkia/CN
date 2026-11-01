"""Generated orienteering maps from IGN's LiDAR HD and OpenStreetMap (a prototype, 2026-11-01), in 1 km tiles.

    py -3 -m mapgen tiles 0391_6819 0392_6819 --out DIR      # these tiles (IGN's names: west km, north km)
    py -3 -m mapgen area 48.380 -1.180 48.400 -1.150 --out DIR   # every tile of an area (lat, lon, lat, lon)
    py -3 -m mapgen ci --requests DIR --out DIR              # the site's requests (lidarmap.yml)

A tile's map: IGN's classified point cloud (COPC LAZ, Licence Ouverte 2.0) through karttapullautin — a program of
its own (GPL-3), downloaded and run as it is, never part of Ozimut —, cut to its square kilometre, with OpenStreetMap's
roads, paths, buildings and water drawn over it (osm.py). Beside it the ground's heights every 2 m from IGN's MNT, for
the 3D view, Terrarium-encoded (R × 256 + G + B / 256 − 32 768 m) as the elevation tiles the 3D view already reads.

Out, per tile <id> (e.g. 0391_6819): t/<id>.png (2362 × 2362, 0.42333 m a pixel, the top-left corner at the tile's
north-west corner; a forest map's symbols) and t/<id>.s.png (the same in a sprint map's), t/<id>.dem.png (500 × 500, a node every 2 m from that corner), t/<id>.json (what and when).
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
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from . import lambert93, osm

WFS = "https://data.geopf.fr/wfs/ows"
UA = osm.UA
PX = 0.4233333333333334          # karttapullautin's 600 dpi at 1:10 000
SIZE = 2362                      # pixels a tile side: 999.9 m
DEM_STEP, DEM_N = 2.0, 500
# each tile in both styles (osm.draw), the same LiDAR render under them: a forest map's ISOM, a sprint map's ISSprOM
STYLES = {"forest": ".png", "sprint": ".s.png"}
KP_VERSION = "2.15.4"
ID = re.compile(r"^(\d{4})_(\d{4})$")
MAX_TILES = 16                   # a run's work at most (~4 GB of point clouds)
# karttapullautin's settings changed from its own defaults (pullauta.ini, written by the program at its first run)
KP_SETTINGS = {"batch": "1", "lazfolder": "./laz", "batchoutfolder": "./out", "savetempfiles": "0",
               "savetempfolders": "0", "output_dxf": "0"}


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


def karttapullautin(kp: Path, work: Path, processes: int) -> None:
    """karttapullautin over every point cloud in work/laz, in its batch mode (each tile with its neighbours' edges)."""
    ini = work / "pullauta.ini"
    if not ini.exists():
        subprocess.run([str(kp)], cwd=work, check=True, capture_output=True)
    text = ini.read_text(encoding="utf-8")
    for k, v in {**KP_SETTINGS, "processes": str(processes)}.items():
        text, n = re.subn(rf"(?m)^{k}\s*=.*$", f"{k}={v}", text)
        if not n:
            text += f"\n{k}={v}\n"
    ini.write_text(text, encoding="utf-8")
    (work / "out").mkdir(exist_ok=True)
    env = {**os.environ, "RUST_LOG": "warn"}
    subprocess.run([str(kp)], cwd=work, check=True, env=env)


def rendered(work: Path, tid: str) -> Image.Image:
    """karttapullautin's render of a tile (with its depressions), cut to the tile: its first pixel's corner is the
    tile's (it starts at the tile's corner and runs 0.75 m further)."""
    p = next((work / "out").glob(f"*{tid}*_depr.png"))
    w = [float(v) for v in p.with_suffix(".pgw").read_text().split()]
    x0, y1 = corner(tid)
    i0, j0 = round((x0 - (w[4] - w[0] / 2)) / w[0]), round((y1 - (w[5] - w[3] / 2)) / w[3])
    if abs(w[0] - PX) > 1e-6 or (i0, j0) != (0, 0):
        raise RuntimeError(f"{tid}: unexpected render frame {w}")
    im = Image.open(p)
    bg = Image.new("RGB", im.size, (255, 255, 255))
    bg.paste(im, mask=im.getchannel("A") if im.mode == "RGBA" else None)
    return bg.crop((0, 0, SIZE, SIZE))


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


def generate(tids: list[str], out: Path, work: Path, kp: Path, processes: int = 4, log=print) -> dict[str, str]:
    """The tiles' maps into out/t/. Returns each tile's outcome: "done", "none" (no LiDAR there yet) or an error."""
    tdir = out / "t"
    tdir.mkdir(parents=True, exist_ok=True)
    (work / "laz").mkdir(parents=True, exist_ok=True)
    res: dict[str, str] = {}
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
    for t in todo:
        fetch(http, cat[t]["laz"], work / "laz" / f"LHD_{t}.copc.laz", pace)
        fetch(http, cat[t]["mnt"], work / f"mnt_{t}.tif", pace)
    log(f"downloaded {len(todo)} tiles in {time.monotonic() - t0:.0f} s")
    t1 = time.monotonic()
    karttapullautin(kp, work, processes)
    log(f"karttapullautin: {time.monotonic() - t1:.0f} s")
    xs, ys = zip(*(corner(t) for t in todo))
    s, w = lambert93.inverse(min(xs) - 50, min(ys) - 1050)
    n, e = lambert93.inverse(max(xs) + 1050, max(ys) + 50)
    s2, w2 = lambert93.inverse(min(xs) - 50, max(ys) + 50)
    n2, e2 = lambert93.inverse(max(xs) + 1050, min(ys) - 1050)
    # without OpenStreetMap the tiles fail (asked again, they are made again) rather than be kept without roads and paths
    # the answer is kept in the work folder: MAPGEN_OSM_CACHE=1 reads it back (trying a style without asking Overpass again)
    cache = work / f"osm_{todo[0]}_{len(todo)}.json"
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
    for t in todo:
        try:
            x0, y1 = corner(t)
            base = rendered(work, t)
            for style, ext in STYLES.items():
                img = osm.draw(base, feats, x0, y1, PX, style)
                img.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(tdir / f"{t}{ext}", optimize=True)
            dem(work / f"mnt_{t}.tif").save(tdir / f"{t}.dem.png", optimize=True)
            (tdir / f"{t}.json").write_text(json.dumps({
                "id": t, "x0": x0, "y1": y1, "px": PX, "size": SIZE, "dem": {"step": DEM_STEP, "n": DEM_N}, "styles": list(STYLES),
                "lidar": cat[t]["date"], "osm": osm_at, "kp": KP_VERSION, "made": _now()}), encoding="utf-8")
            res[t] = "done"
        except Exception as ex:
            log(f"{t}: {ex}")
            res[t] = f"error: {ex}"[:300]
    log(f"{len(todo)} tiles in {time.monotonic() - t0:.0f} s")
    return res


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ci(reqs: Path, out: Path, work: Path, kp: Path, processes: int) -> None:
    """The site's waiting requests (lidarmap/req/<id>.json, {id, tiles, status "queued"}): their tiles made, at most
    MAX_TILES a run (the rest wait for the next run), each request's status written to out/req/."""
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
    for r in queued:
        new = [t for t in r.get("tiles", []) if ID.match(t) and t not in tids]
        if take and len(tids) + len(new) > MAX_TILES:
            break
        tids += new[:MAX_TILES]
        take.append(r)
    print(f"{len(queued)} requests waiting, {len(take)} taken, {len(tids)} tiles")
    if not tids:
        return
    try:
        res = generate(tids, out, work, kp, processes)
    except Exception as ex:
        res = {t: f"error: {ex}"[:300] for t in tids}
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
    for p in (a, b, c):
        p.add_argument("--out", required=True, type=Path)
        p.add_argument("--work", type=Path, default=None)
        p.add_argument("--kp", type=Path, default=Path(shutil.which("pullauta") or "pullauta"))
        p.add_argument("--processes", type=int, default=4)
    args = ap.parse_args(argv)
    work = args.work or args.out / "work"
    work.mkdir(parents=True, exist_ok=True)
    if args.cmd == "ci":
        ci(args.requests, args.out, work, args.kp, args.processes)
        return
    ids = args.ids if args.cmd == "tiles" else tile_ids(*args.box)
    if len(ids) > MAX_TILES:
        sys.exit(f"{len(ids)} tiles: at most {MAX_TILES}")
    print(json.dumps(generate(ids, args.out, work, args.kp, args.processes), indent=1))
