"""A « Virtually » race from the LiDAR alone, without an organiser's map (administrators; owner, 2026-11-11): the generated
orienteering map of mapgen (karttapullautin over the national LiDAR, OpenStreetMap drawn over) is the player's map, and what
build.py needs is made from the same sources, so that the forest one runs through looks like the map one reads.

  py lidarrace.py <race> <lat> <lon> [size m] [--kp pullauta] [--work folder] [--tiles folder]

Writes DATA/<race>/ (DATA = paths.DATA_DIR / "virtual", or env VIRTUAL_DATA), then build.py and course.py run as for a map:
  map.json      the dump.mjs shape, made up: the frame (`frame`, mm), its grid (`epsg`), no map relief (`lidarOnly`), and as
                objects OpenStreetMap's ways and areas (roads, tracks, paths, streams, walls, fences, buildings, water, paved and
                open ground: their ISOM 2017 symbols), karttapullautin's cliffs (the short ones as boulders) and dot knolls
  cls_base.png  the ground classes under them: karttapullautin's vegetation (white forest, its greens, its yellow), 1 m
  map.webp      the map itself over the frame (0.5 m a pixel), which the game shows instead of an OCAD file
  lidar/laz/    the point clouds (the ground, the trees: build.py)
The tiles come from mapgen (python -m mapgen tiles …, forest style) unless --tiles names a folder that holds them (with its
work/ beside: the point clouds and OpenStreetMap's answer)."""
import argparse, json, math, os, shutil, subprocess, sys, time
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from mapgen import grids, osm, run as mg                               # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("race"); ap.add_argument("lat", type=float); ap.add_argument("lon", type=float)
ap.add_argument("size", type=float, nargs="?", default=2000)
ap.add_argument("--kp", default=shutil.which("pullauta") or "pullauta")
ap.add_argument("--work", type=Path, default=None)
ap.add_argument("--tiles", type=Path, default=None)
A = ap.parse_args()
DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
RD = DATA / A.race; RD.mkdir(parents=True, exist_ok=True)
T0 = time.time()
log = lambda *a: print(f"[{time.time() - T0:5.0f}s]", *a, flush=True)

# ---- the country, its grid, the square -----------------------------------------------------------------------------------
def country_at(lat, lon):
    for cc in ("fr", "ch", "nz", "us", "ca"):
        try:
            rings = grids._rings(cc)
        except Exception:
            continue
        for ring in rings:
            inside = False
            for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
                if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / ((y2 - y1) or 1e-12) + x1:
                    inside = not inside
            if inside:
                return cc
    return None


CC = country_at(A.lat, A.lon)
if not CC:
    sys.exit("no LiDAR source known here (France, Switzerland, the USA, Canada, New Zealand)")
half = A.size / 2
corners = []
ids = grids.ids_for(CC, [(A.lat, A.lon)], margin=half)
EPSG = grids.parse(ids[0]).epsg
cx, cy = grids.from_latlon(EPSG, A.lat, A.lon)
GX0, GX1, GY0, GY1 = cx - half, cx + half, cy - half, cy + half
log(A.race, CC, f"EPSG:{EPSG}", len(ids), "tiles", ids)

# ---- the tiles ---------------------------------------------------------------------------------------------------------------
work = A.work or (DATA / "_mapgen")
tiles = A.tiles or (work / "out")
if not all((tiles / "t" / f"{t}.png").exists() and (tiles / "t" / f"{t}.forest.vege.png").exists() for t in ids):
    r = subprocess.run([sys.executable, "-m", "mapgen", "tiles", *ids, "--style", "forest", "--out", str(tiles), "--work", str(work / "work"),
                        "--kp", str(A.kp)], cwd=ROOT)
    if r.returncode:
        sys.exit("mapgen failed")
mwork = (A.tiles.parent / "work") if A.tiles else (work / "work")
missing = [t for t in ids if not (tiles / "t" / f"{t}.json").exists()]
if missing:                                       # mapgen keeps no tile without its OpenStreetMap: Overpass may have failed
    sys.exit(f"mapgen made no tile for {', '.join(missing)} (OpenStreetMap's Overpass may have failed: try again later)")
recs = {t: json.loads((tiles / "t" / f"{t}.json").read_text(encoding="utf-8")) for t in ids}
if any(r.get("none") for r in recs.values()):
    sys.exit("no LiDAR yet in part of the area: " + ", ".join(t for t, r in recs.items() if r.get("none")))
log("tiles ready")

# ---- the world: 1 m, x east from GX0, z south from GY1 ----------------------------------------------------------------------
W = H = int(round(A.size))
K = 10.0                                    # 1:10 000: 10 m a map mm
SCALE = 10000
# map mm: (gx - GX0) / K east, (gy - GY0) / K north — build.py's frame from `frame` [X0, Y0, X1, Y1] mm
frame = [0.0, 0.0, W / K, H / K]
# vegetation classes, 1 m: each tile's vege.png (1000 px from its north-west corner) put together
VEG = {(255, 255, 255): "forest", (255, 219, 166): "rough", (200, 254, 200): "slow_vis", (180, 246, 180): "slow_vis",
       (160, 239, 160): "slow", (140, 231, 140): "slow", (120, 224, 120): "walk_vis", (100, 217, 100): "walk", (80, 209, 80): "fight"}
CL = ["forest", "open", "open_t", "rough", "rough_t", "slow", "slow_vis", "walk", "walk_vis", "fight", "paved", "rock",
      "building", "path", "road", "stony", "bfield", "water", "track", "marsh", "marsh_x", "shallow", "cliff", "oob",
      "cultivated", "stream", "rockstep", "outside", "block", "small_path", "stairs"]       # build.py's classes, in its order
C = {n: i for i, n in enumerate(CL)}
cls = np.full((H, W), C["outside"], np.uint8)
mos = np.full((H, W, 3), 255, np.uint8)
MPX = 0.5                                    # the player's map: 0.5 m a pixel
mapimg = Image.new("RGB", (int(W / MPX), int(H / MPX)), (255, 255, 255))
for t, rec in recs.items():
    x0, y1 = rec["x0"], rec["y1"]
    v = np.array(Image.open(tiles / "t" / f"{t}.forest.vege.png").convert("RGB"))
    keys = v[..., 0].astype(np.int32) * 65536 + v[..., 1].astype(np.int32) * 256 + v[..., 2]
    lut = {r * 65536 + g * 256 + b: C[n] for (r, g, b), n in VEG.items()}
    cv = np.full(keys.shape, C["forest"], np.uint8)
    for k_, c_ in lut.items():
        cv[keys == k_] = c_
    # nearest greens for colours not in the table (anti-aliasing)
    j0, i0 = int(round(x0 - GX0)), int(round(GY1 - y1))
    a0, b0 = max(0, i0), max(0, j0); a1, b1 = min(H, i0 + cv.shape[0]), min(W, j0 + cv.shape[1])
    if a1 > a0 and b1 > b0:
        cls[a0:a1, b0:b1] = cv[a0 - i0:a1 - i0, b0 - j0:b1 - j0]
    # the map image (its pixel px m) onto the player's map at MPX
    im = Image.open(tiles / "t" / f"{t}.png").convert("RGB")
    px = rec["px"]
    n = int(round(im.width * px / MPX))
    im = im.resize((n, n), Image.Resampling.LANCZOS)
    mapimg.paste(im, (int(round((x0 - GX0) / MPX)), int(round((GY1 - y1) / MPX))))
log("classes and map image")

# ---- OpenStreetMap's ways and areas, and karttapullautin's vectors, as map objects --------------------------------------
cache = sorted(mwork.glob("osm_*.json"), key=lambda p: p.stat().st_mtime)
feats = []
if cache:
    data = json.loads(cache[-1].read_text(encoding="utf-8"))
    fwd = None if CC == "fr" else (lambda a, b: grids.from_latlon(EPSG, a, b))
    feats = osm.project(osm.features(data), fwd)
log("OpenStreetMap features", len(feats))


def mm(gx, gy):
    return [int(round((gx - GX0) / K * 100)), int(round((gy - GY0) / K * 100)), 0, 0]


def inside_any(pts, pad=60):
    return any(GX0 - pad <= x <= GX1 + pad and GY0 - pad <= y <= GY1 + pad for x, y in pts)


objs = []
LINE = {"wide": 502, "road": 503, "track": 504, "path": 505, "smallpath": 506, "wall": 513, "lowwall": 514, "fence": 516,
        "power": 510, "stream:river": 304, "stream:canal": 304, "stream:stream": 305, "stream:ditch": 306, "stream:drain": 306}
AREA = {"building": 521, "canopy": 522, "water": 301, "paved": 501, "open": 401, "pitch": 401}
for f in feats:
    if "line" in f:
        s = LINE.get(f["kind"])
        if s and inside_any(f["line"]):
            objs.append({"sym": s * 1000, "otp": 2, "ang": 0, "c": [mm(x, y) for x, y in f["line"]]})
    else:
        s = AREA.get(f["kind"])
        if not s:
            continue
        for k, (role, ring) in enumerate([r for r in f["rings"] if r[0] == "outer"] + [r for r in f["rings"] if r[0] != "outer"]):
            if not inside_any(ring):
                continue
            c = [mm(x, y) for x, y in ring]
            if role != "outer":
                continue                                         # holes left out (rare in a forest)
            objs.append({"sym": s * 1000, "otp": 3, "ang": 0, "c": c})


def decode(enc, x0, y0, q, has_z):
    vals = enc[1:] if has_z else enc
    x, y = vals[0], vals[1]; out = [(x0 + x * q, y0 + y * q)]
    for i in range(2, len(vals) - 1, 2):
        x += vals[i]; y += vals[i + 1]; out.append((x0 + x * q, y0 + y * q))
    return out


rocks = cliffs = knolls = 0
# karttapullautin draws its cliffs as short strokes: drawn on the 1 m grid, gathered by contact; a small group is one boulder,
# a large one an outcrop (Fontainebleau's sandstone chaos): boulders along it, about one every 3 m, and its long edges as cliffs
from PIL import ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree
rockm = Image.new("L", (W, H), 0); dr = ImageDraw.Draw(rockm)
for t in ids:
    p = tiles / "t" / f"{t}.forest.vec.json"
    if not p.exists():
        continue
    v = json.loads(p.read_text(encoding="utf-8"))
    x0, y0, q = v["x0"], v["y0"], v["q"]
    for layer, lines in v.get("lines", {}).items():
        if layer not in ("cliff2", "cliff3"):
            continue
        for enc in lines:
            pts = [(gx - GX0, GY1 - gy) for gx, gy in decode(enc, x0, y0, q, True)]
            if any(0 <= x < W and 0 <= z < H for x, z in pts):
                dr.line(pts, fill=2 if layer == "cliff3" else 1, width=1)
rk = np.array(rockm)
lab, n = ndimage.label(ndimage.binary_dilation(rk > 0, iterations=1))
rng = np.random.default_rng(5)
idx = ndimage.find_objects(lab)
for k, sl in enumerate(idx, start=1):
    if sl is None:
        continue
    zz, xx = np.nonzero(lab[sl] == k)
    zz = zz + sl[0].start; xx = xx + sl[1].start
    big = (rk[zz, xx] == 2).any()
    if len(zz) < 30:
        mx, mz = xx.mean() + 0.5, zz.mean() + 0.5
        objs.append({"sym": 205000 if len(zz) > 10 or big else 204000, "otp": 1, "ang": 0, "c": [mm(GX0 + mx, GY1 - mz)]}); rocks += 1
        continue
    pts = np.c_[xx, zz].astype(float) + rng.uniform(0, 1, (len(xx), 2))
    kept = []
    tree = None
    for i in rng.permutation(len(pts)):
        if all((pts[i][0] - a) ** 2 + (pts[i][1] - b) ** 2 > 9 for a, b in kept[-60:]):
            kept.append(tuple(pts[i]))
    for mx, mz in kept:
        objs.append({"sym": 205000, "otp": 1, "ang": 0, "c": [mm(GX0 + mx, GY1 - mz)]}); rocks += 1
    cliffs += 1
for t in ids:
    p = tiles / "t" / f"{t}.forest.vec.json"
    if not p.exists():
        continue
    v = json.loads(p.read_text(encoding="utf-8"))
    x0, y0, q = v["x0"], v["y0"], v["q"]
    for layer, flat in v.get("points", {}).items():
        sym = {"dotknoll": 109000, "udepression": 111000}.get(layer)
        if not sym:
            continue
        for gx, gy in decode([0] + flat, x0, y0, q, True):
            if GX0 <= gx <= GX1 and GY0 <= gy <= GY1:
                objs.append({"sym": sym, "otp": 1, "ang": 0, "c": [mm(gx, gy)]}); knolls += 1
log(f"objects {len(objs)}: boulders {rocks} (outcrops {cliffs}), knolls and depressions {knolls}")

# ---- write ---------------------------------------------------------------------------------------------------------------
lat_c, lon_c = grids.to_latlon(EPSG, cx, cy)
D = {"version": 0, "scale": SCALE, "realWorld": {"x": GX0, "y": GY0, "angle": 0, "zone": 0}, "epsg": EPSG, "frame": frame,
     "lidarOnly": True, "std": "ISOM 2017", "syms": [], "objs": objs, "courseSetting": None,
     "sources": {"lidar": recs[ids[0]].get("src", ""), "lidarDate": max(r.get("lidar", "") for r in recs.values()), "osm": recs[ids[0]].get("osm", "")}}
json.dump(D, open(RD / "map.json", "w"))
Image.fromarray(cls, "L").save(RD / "cls_base.png", optimize=True)
mapimg.save(RD / "map.webp", quality=90, method=6)
th = mapimg.copy(); th.thumbnail((640, 640), Image.Resampling.LANCZOS); th.save(RD / "thumb.webp", quality=82)   # the page's card
if not (RD / "biome.json").exists():
    # a temperate European forest (oaks, beeches, birches, Scots pines), the default for these maps
    json.dump({"conifer": 0.3, "leaf": ["#56763a", "#61803f", "#4d6c35", "#6a8a46"], "coniferLeaf": ["#34552f", "#3d5f35"],
               "bush": ["#4f6d34", "#5a7a3a"], "low": ["#6f8045", "#7d8a4c", "#8a7a48"], "trunk": "#6b625a", "trunk2": "#5a5048",
               "rock": ["#a29a8c", "#958e82", "#b0a898"], "fog": "#cdd6d8"}, open(RD / "biome.json", "w"))
laz = RD / "lidar" / "laz"; laz.mkdir(parents=True, exist_ok=True)
for t in ids:
    for f in (mwork / "laz").glob(f"*{t}*.la[sz]"):
        dst = laz / f.name
        if not dst.exists():
            try:
                os.link(f, dst)
            except OSError:
                shutil.copyfile(f, dst)
log("written", RD, {f.name: f"{f.stat().st_size / 1e6:.1f} MB" for f in RD.iterdir() if f.is_file()},
    f"centre {lat_c:.5f}, {lon_c:.5f}")
