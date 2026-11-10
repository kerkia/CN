"""A national LiDAR's point clouds over a « Virtually » race's map, through mapgen's fetchers (Switzerland, the USA, Canada,
New Zealand: mapgen/sources.py), into DATA/<race>/lidar/laz/ for build.py.   py lidar.py <race> <country: ch|us|ca|nz>
France's IGN LiDAR HD is not fetched here (mapgen/run.py's catalogue does it for the generated maps); a country without open
LiDAR (Australia, most of the world) builds from the map and the worldwide relief alone."""
import json, math, os, sys, time
from pathlib import Path
import numpy as np
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from mapgen import grids, sources                                  # noqa: E402

DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
race, cc = sys.argv[1], sys.argv[2]
D = json.load(open(DATA / race / "map.json"))
RW, K = D["realWorld"], D["scale"] / 1000
zone = RW.get("zone") or 0
epsg = (32700 + (-zone - 2000)) if zone < -2000 else (32600 + zone - 2000)
a = -(RW.get("angle") or 0) * math.pi / 180
pts = np.array([[c[0] / 100, c[1] / 100] for o in D["objs"] if 100 <= o["sym"] // 1000 < 600 for c in o["c"]])
lo, hi = np.percentile(pts, 0.1, axis=0), np.percentile(pts, 99.9, axis=0)
to_ll = Transformer.from_crs(epsg, 4326, always_xy=True)
corners = []
for mx in (lo[0], hi[0]):
    for my in (lo[1], hi[1]):
        X, Y = mx * K, my * K
        gx, gy = X * math.cos(a) - Y * math.sin(a) + RW["x"], X * math.sin(a) + Y * math.cos(a) + RW["y"]
        lon, lat = to_ll.transform(gx, gy)
        corners.append((lat, lon))
ids = grids.ids_for(cc, corners, margin=100, zone=(epsg % 100) if cc in grids.ZONES else None)
print(race, len(ids), "tiles:", ids, flush=True)
base = DATA / race / "lidar"
t0 = time.time()
res = sources.prepare(ids, base / "laz", base, base / "cache", log=lambda m: print(m, flush=True))
json.dump(res, open(base / "prepared.json", "w"), indent=1)
print("done", round(time.time() - t0), "s")
