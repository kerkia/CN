"""A sprint map (ISSprOM 2019-2, 1:4000) of a town from open data, for « Virtually » (town_fetch.py first):

  py town_map.py <race>      DATA/<race>/map_objects.json, then  node --import ../mapper/shim.mjs mkocd.mjs … map.ocd

What each symbol comes from:
- 521 buildings, 522 canopies: IGN BD TOPO's buildings (OpenStreetMap's building=roof for canopies);
- 501 paved area: BD TOPO's roads at their carriageway width plus the sidewalks in town, OpenStreetMap's pedestrian areas,
  squares, parkings and paved footways, and unbuilt ground the photograph's infrared shows bare (courtyards, schoolyards);
- 401 open land, 402 with scattered trees, 405 forest, 406-410 green: the LiDAR's vegetation heights and cover over the
  infrared's vegetation index (lawns, parks, woods); 411 hedges (BD TOPO, OpenStreetMap);
- 520 area not to be entered: the cadastre's parcels holding a house (gardens), schools, the railway's corridor;
- 505/506 unpaved paths, 532 stairways (OpenStreetMap); 509 railway; 301/305 water (BD TOPO);
- 513/515 walls and 516/518 fences, passable or not by the height the LiDAR measures along them (1.5 m);
- 101/102 contours every 2.5 m from the LiDAR's ground; 417/418 trees standing alone (the LiDAR's crowns); 526 monuments,
  311 fountains (OpenStreetMap); 601 north lines.
Also writes DATA/<race>/src/rasters.npz (the LiDAR's grids, the classes) and src/roofpts.npy (class 6 points) for town_3d.py."""
import json, math, os, sys, time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import (binary_closing, binary_opening, distance_transform_edt, gaussian_filter, maximum_filter,
                           median_filter, binary_dilation, label)
import shapely
from shapely.geometry import shape, LineString, Polygon, MultiPolygon, Point, box as sbox
from shapely.ops import unary_union

DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__file__).resolve().parents[4] / "data" / "virtual")
if not DATA.exists():
    sys.path.insert(0, str(Path(__file__).resolve().parents[2])); DATA = Path(__import__("paths").DATA_DIR) / "virtual"
RACE = sys.argv[1]
RD = DATA / RACE; SRC = RD / "src"
A = json.load(open(RD / "area.json"))
X0, Y0, X1, Y1 = A["ext"]
R = 0.5                                                   # raster cell (m)
NX, NY = int(round((X1 - X0) / R)), int(round((Y1 - Y0) / R))
SCALE = 4000
CX, CY = (A["box"][0] + A["box"][2]) / 2, (A["box"][1] + A["box"][3]) / 2
T0 = time.time()
log = lambda *a: print(f"[{time.time() - T0:5.0f}s]", *a, flush=True)
S = lambda n, sub=0: n * 1000 + sub


def to_px(x, y):
    return (np.asarray(x) - X0) / R, (Y1 - np.asarray(y)) / R


def mm(x, y):
    """Lambert 93 → map mm (y up) about the area's centre."""
    return (x - CX) * 1000 / SCALE, (y - CY) * 1000 / SCALE


def bdtopo(layer):
    f = SRC / f"bdtopo_{layer}.json"
    return json.load(open(f))["features"] if f.exists() else []


def geom2d(g):
    return shapely.force_2d(shape(g)) if g else None


# ---- the LiDAR, rasterised at 0.5 m ------------------------------------------------------------------------------------------
cache = SRC / "lidar_grids.npz"
if cache.exists():
    Z = dict(np.load(cache)); roof = np.load(SRC / "roofpts.npy")
else:
    import laspy
    N = NX * NY
    gs, gc = np.zeros(N), np.zeros(N)
    zmax = {k: np.full(N, -1e9, np.float32) for k in ("v", "b", "o")}  # vegetation 3-5, building 6, other non-ground (1, 9…)
    cnt = {k: np.zeros(N, np.int32) for k in (0, 2, 3, 4, 5, 6)}
    roofs = []
    for f in sorted((RD / "lidar" / "laz").glob("*.laz")):
        with laspy.open(f) as rd:
            for ch in rd.chunk_iterator(4_000_000):
                x, y = np.asarray(ch.x), np.asarray(ch.y)
                m = (x >= X0) & (x < X1) & (y > Y0) & (y <= Y1)
                if not m.any():
                    continue
                x, y, z, c = x[m], y[m], np.asarray(ch.z)[m], np.asarray(ch.classification)[m]
                px, py = to_px(x, y); idx = py.astype(np.int64) * NX + px.astype(np.int64)
                keep = c != 7
                cnt[0] += np.bincount(idx[keep], minlength=N).astype(np.int32)
                for k in (2, 3, 4, 5, 6):
                    cnt[k] += np.bincount(idx[c == k], minlength=N).astype(np.int32)
                g = c == 2
                gs += np.bincount(idx[g], weights=z[g], minlength=N); gc += np.bincount(idx[g], minlength=N)
                for key, sel in (("v", (c >= 3) & (c <= 5)), ("b", c == 6), ("o", (c == 1) | (c == 9) | (c == 17) | (c == 64) | (c == 65) | (c == 66))):
                    np.maximum.at(zmax[key], idx[sel], z[sel].astype(np.float32))
                b = c == 6
                roofs.append(np.c_[x[b] - X0, y[b] - Y0, z[b]].astype(np.float32))
        log("LiDAR", f.name)
    has = gc > 0
    dtm = np.where(has, gs / np.maximum(gc, 1), np.nan).reshape(NY, NX)
    # holes (under buildings): a membrane would be best; the nearest ground smoothed is enough for a town
    _, (ri, ci) = distance_transform_edt(np.isnan(dtm), return_indices=True)
    dtm = gaussian_filter(dtm[ri, ci], 1.0)
    Z = {"dtm": dtm.astype(np.float32), **{f"z{k}": v.reshape(NY, NX) for k, v in zmax.items()},
         **{f"n{k}": v.reshape(NY, NX) for k, v in cnt.items()}}
    roof = np.concatenate(roofs)
    np.savez_compressed(cache, **Z); np.save(SRC / "roofpts.npy", roof)
dtm = Z["dtm"]
chm = np.where(Z["zv"] > -1e8, Z["zv"] - dtm, 0).astype(np.float32)
nall = Z["n0"].astype(np.float32) + 1e-3
cover5 = gaussian_filter(Z["n5"] / nall, 1.0)              # share of returns from high vegetation
cover4 = gaussian_filter(Z["n4"] / nall, 1.0)
log("LiDAR grids", dtm.shape, f"ground {dtm.min():.1f}-{dtm.max():.1f} m", "roof points", len(roof))

# ---- the photograph's infrared: a vegetation index ---------------------------------------------------------------------------
def mosaic(tag, res):
    W, H = int(round((X1 - X0) / res)), int(round((Y1 - Y0) / res))
    out = np.zeros((H, W, 3), np.uint8)
    for f in SRC.glob(f"ortho_{tag}_*.jpg"):
        _, _, x0, y0 = f.stem.split("_"); x0, y0 = int(x0), int(y0)
        im = Image.open(f).convert("RGB")
        w_m, h_m = im.width / 5, im.height / 5
        im = im.resize((int(round(w_m / res)), int(round(h_m / res))), Image.LANCZOS)
        c, r = int(round((x0 - X0) / res)), int(round((Y1 - (y0 + h_m)) / res))
        a = np.asarray(im); out[r:r + a.shape[0], c:c + a.shape[1]] = a[: H - r, : W - c]
    return out
irc = mosaic("irc", R).astype(np.float32)
ndvi = gaussian_filter((irc[..., 0] - irc[..., 1]) / (irc[..., 0] + irc[..., 1] + 1), 0.7)
rgb = mosaic("rgb", R).astype(np.float32)
lum = rgb.mean(axis=2)
log("NDVI", f"{np.percentile(ndvi, 5):.2f}…{np.percentile(ndvi, 95):.2f}")

# ---- vectors -----------------------------------------------------------------------------------------------------------------
osm = json.load(open(SRC / "osm.json"))["elements"]
L93 = None


def osm_xy(lat, lon):
    import pyproj
    global L93
    L93 = L93 or pyproj.Transformer.from_crs(4326, 2154, always_xy=True)
    return L93.transform(lon, lat)


def osm_geom(e, area=False):
    if e["type"] == "node":
        return Point(*osm_xy(e["lat"], e["lon"]))
    if e["type"] == "way" and e.get("geometry"):
        xs, ys = osm_xy(np.array([p["lat"] for p in e["geometry"]]), np.array([p["lon"] for p in e["geometry"]]))
        pts = list(zip(xs, ys))
        if area and len(pts) >= 4 and pts[0] == pts[-1]:
            return Polygon(pts).buffer(0)
        return LineString(pts) if len(pts) >= 2 else None
    if e["type"] == "relation" and area:
        outers, inners = [], []
        for m in e.get("members", []):
            if m.get("type") == "way" and m.get("geometry"):
                xs, ys = osm_xy(np.array([p["lat"] for p in m["geometry"]]), np.array([p["lon"] for p in m["geometry"]]))
                (inners if m.get("role") == "inner" else outers).append(LineString(list(zip(xs, ys))))
        polys = list(shapely.polygonize(outers).geoms) if outers else []
        g = unary_union(polys) if polys else None
        if g is not None and inners:
            g = g.difference(unary_union(list(shapely.polygonize(inners).geoms)))
        return g
    return None


tags = lambda e: e.get("tags", {})
frame = sbox(X0, Y0, X1, Y1)
buildings = []
for f in bdtopo("batiment"):
    g = geom2d(f["geometry"])
    if g is None or g.is_empty:
        continue
    g = g.buffer(0).intersection(frame)
    if g.area > 3:
        buildings.append((g, f["properties"]))
B = unary_union([g for g, _ in buildings])
canopy = unary_union([g for e in osm if tags(e).get("building") in ("roof", "carport") for g in [osm_geom(e, True)] if g is not None and g.geom_type.endswith("Polygon")] or [Polygon()])
log("buildings", len(buildings), "canopies", 0 if canopy.is_empty else len(getattr(canopy, "geoms", [canopy])))

PAVED_SURF = {"asphalt", "paving_stones", "concrete", "sett", "paved", "concrete:plates", "cobblestone", "unhewn_cobblestone", "metal", "wood", "bricks"}
UNPAVED_SURF = {"gravel", "fine_gravel", "ground", "dirt", "compacted", "grass", "earth", "mud", "sand", "unpaved", "pebblestone", "woodchips"}
paved, path_lines, small_lines, steps, rail = [], [], [], [], []
for f in bdtopo("troncon_de_route"):
    p = f["properties"]; g = geom2d(f["geometry"])
    if g is None or (p.get("position_par_rapport_au_sol") or "0").startswith("-"):
        continue
    nat = (p.get("nature") or "").lower()
    if "escalier" in nat:
        steps.append(g); continue
    if "sentier" in nat:
        path_lines.append(g); continue
    if "chemin" in nat or "empierr" in nat:
        path_lines.append(g); continue
    w = float(p.get("largeur_de_chaussee") or 0) or {"route à 1 chaussée": 5.5, "rond-point": 7, "bretelle": 6, "piste cyclable": 2.5}.get(nat, 5)
    side = 1.8 if p.get("urbain") not in (False, "false", 0) else 0.3        # sidewalks in town
    paved.append(g.buffer(w / 2 + side, cap_style="flat", join_style="round"))
for e in osm:
    t = tags(e); hw = t.get("highway")
    if e["type"] != "way" or not e.get("geometry"):
        continue
    if hw in ("pedestrian", "footway", "path", "cycleway", "service", "living_street", "track", "bridleway", "steps", "corridor") or t.get("area:highway"):
        if t.get("tunnel") in ("yes", "building_passage") or t.get("layer", "0").startswith("-") or t.get("indoor") == "yes":
            continue
        is_area = t.get("area") == "yes" or bool(t.get("area:highway"))
        g = osm_geom(e, area=is_area)
        if g is None:
            continue
        if hw == "steps":
            steps.append(g); continue
        surf = t.get("surface", "")
        if t.get("footway") in ("sidewalk", "crossing", "traffic_island") or t.get("cycleway") == "sidewalk":
            paved.append(g.buffer(1.0, cap_style="flat", join_style="round")); continue
        if is_area and g.geom_type.endswith("Polygon"):
            if surf not in UNPAVED_SURF:
                paved.append(g)
            continue
        if surf in UNPAVED_SURF or (hw in ("path", "track", "bridleway") and surf not in PAVED_SURF):
            (small_lines if hw == "path" and t.get("informal") == "yes" else path_lines).append(g)
        else:
            paved.append(g.buffer({"service": 2.2, "living_street": 2.5, "pedestrian": 2.5, "track": 1.5}.get(hw, 1.1), cap_style="flat", join_style="round"))
    if t.get("place") == "square" or t.get("amenity") in ("parking", "marketplace") or t.get("leisure") == "schoolyard":
        g = osm_geom(e, area=True)
        if g is not None and g.geom_type.endswith("Polygon") and t.get("parking") not in ("underground", "multi-storey"):
            paved.append(g)
for f in bdtopo("equipement_de_transport"):
    p = f["properties"]
    if "parking" in (p.get("nature") or "").lower():
        g = geom2d(f["geometry"])
        if g is not None and g.geom_type.endswith("Polygon"):
            paved.append(g)
for f in bdtopo("troncon_de_voie_ferree"):
    p = f["properties"]; g = geom2d(f["geometry"])
    if g is not None and not (p.get("position_par_rapport_au_sol") or "0").startswith("-"):
        rail.append(g)
PAVED = unary_union(paved).intersection(frame)
RAIL = unary_union(rail) if rail else LineString()
water = unary_union([geom2d(f["geometry"]).buffer(0) for f in bdtopo("surface_hydrographique")] or [Polygon()])
streams = [geom2d(f["geometry"]) for f in bdtopo("troncon_hydrographique")
           if not (f["properties"].get("position_par_rapport_au_sol") or "0").startswith("-")]
hedges = [geom2d(f["geometry"]) for f in bdtopo("haie")] + [osm_geom(e) for e in osm if e["type"] == "way" and tags(e).get("barrier") == "hedge"]
hedges = [h for h in hedges if h is not None]
walls = []                                                  # (line, kind, retaining)
for f in bdtopo("construction_lineaire"):
    nat = (f["properties"].get("nature") or "").lower(); g = geom2d(f["geometry"])
    if g is None:
        continue
    if nat.startswith("mur"):
        walls.append((g, "wall", "soutènement" in nat))
for e in osm:
    t = tags(e)
    if e["type"] == "way" and t.get("barrier") in ("wall", "city_wall", "retaining_wall", "fence", "guard_rail", "handrail"):
        g = osm_geom(e)
        if g is not None:
            kind = "fence" if t["barrier"] in ("fence", "guard_rail", "handrail") else "wall"
            walls.append((g, kind, t["barrier"] == "retaining_wall"))
# an OSM wall within 1 m along a BD TOPO wall is the same wall
kept = []
for g, kind, ret in walls:
    if any(k[1] == kind and g.length > 0 and g.buffer(1.2).contains(k[0].interpolate(0.5, normalized=True)) and k[0].hausdorff_distance(g) < 2 for k in kept):
        continue
    kept.append((g, kind, ret))
walls = kept
log("paved", round(PAVED.area), "m²; walls/fences", len(walls), "hedges", len(hedges), "steps", len(steps), "paths", len(path_lines))

# ---- private ground: the cadastre's parcels holding houses, schools, the railway ----------------------------------------------
parcels = []
for f in SRC.glob("parcelles_*.json"):
    import pyproj
    tr = pyproj.Transformer.from_crs(4326, 2154, always_xy=True)
    for p in json.load(open(f))["features"]:
        g = shape(p["geometry"])
        g = shapely.transform(g, lambda c: np.c_[tr.transform(c[:, 0], c[:, 1])])
        if g.intersects(frame):
            parcels.append(g.buffer(0))
bidx = shapely.STRtree([g for g, _ in buildings])
private = []
PUBLIC_USE = ("religieux", "sportif")
for pg in parcels:
    if pg.area > 6000:
        continue
    hits = bidx.query(pg)
    res = sum(buildings[i][0].intersection(pg).area for i in hits
              if (buildings[i][1].get("usage_1") or "").lower().startswith("résidentiel") and buildings[i][1].get("nature", "").lower() not in ("église", "chapelle"))
    pub = any((buildings[i][1].get("usage_1") or "").lower().startswith(PUBLIC_USE) for i in hits if buildings[i][0].intersection(pg).area > 20)
    if res > 25 and not pub:
        private.append(pg)
for f in bdtopo("zone_d_activite_ou_d_interet"):
    p = f["properties"]; cat = (p.get("categorie") or "").lower(); nat = (p.get("nature") or "").lower()
    if cat.startswith("science et enseignement") and any(k in nat for k in ("école", "collège", "lycée", "enseignement")):
        g = geom2d(f["geometry"])
        if g is not None and g.geom_type.endswith("Polygon"):
            private.append(g.buffer(0))
for e in osm:
    t = tags(e)
    if t.get("access") in ("private", "no") and (t.get("landuse") or t.get("leisure") or t.get("amenity")) and t.get("amenity") != "parking":
        g = osm_geom(e, area=True)
        if g is not None and g.geom_type.endswith("Polygon"):
            private.append(g)
PRIVATE = unary_union(private) if private else Polygon()
if not RAIL.is_empty:
    PRIVATE = PRIVATE.union(RAIL.buffer(5, cap_style="flat"))
# the streets and paths are public whatever the cadastre says; the buildings are drawn as buildings
PRIVATE = PRIVATE.difference(PAVED.buffer(0.3)).difference(B)
log("private ground", round(PRIVATE.area), "m²")

# ---- the classes raster (priority: water > building > private > paved > vegetation/ground) --------------------------------------
def burn(g, val, arr, all_touched=False):
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    if g is None or g.is_empty:
        return
    m = rasterize([(g, 1)], out_shape=arr.shape, transform=from_origin(X0, Y1, R, R), fill=0, all_touched=all_touched, dtype="uint8")
    arr[m == 1] = val


K = {"forest": 1, "open": 2, "open_t": 3, "rough": 4, "slow": 5, "walk": 6, "fight": 7, "paved": 8, "private": 9, "building": 10,
     "water": 11, "imp_veg": 12, "paved_t": 13}
cl = np.zeros((NY, NX), np.uint8)
# vegetation and ground from the LiDAR and the infrared
tall = (chm > 3.0) & (Z["n5"] > 0)
canopy_cover = gaussian_filter(tall.astype(np.float32), 6)            # share of 0.5 m cells under crowns within ~6 m
mid = (chm > 0.5) & (chm <= 3.0) & ((Z["n4"] + Z["n5"]) > 1)
mid_cover = gaussian_filter(mid.astype(np.float32), 2.0)
green_ground = ndvi > 0.12
cl[:] = K["open"]
# bare, unbuilt ground: paving near buildings and streets (courtyards, schoolyards, forecourts), open land elsewhere (a field
# out of season, a sports ground's earth)
near_built = np.zeros((NY, NX), np.uint8); burn(B.buffer(12).union(PAVED.buffer(6)), 1, near_built)
cl[~green_ground & (lum > 60) & (near_built == 1)] = K["paved"]
cl[~green_ground & (lum <= 60)] = K["open"]
cl[(canopy_cover > 0.25)] = K["open_t"]
cl[(canopy_cover > 0.6)] = K["forest"]
cl[(mid_cover > 0.55) & (canopy_cover <= 0.6)] = K["slow"]
cl[(mid_cover > 0.8) & (canopy_cover <= 0.6)] = K["walk"]
for k in ("forest", "open_t", "slow", "walk", "paved"):                # no speck: a class keeps patches of 25 m² at least
    m = cl == K[k]; m2 = binary_opening(m, iterations=2)
    lab, n = label(m2); sz = np.bincount(lab.ravel())
    small = (sz < 100); small[0] = False
    cl[m & ~m2] = K["open"]; cl[small[lab] & m2] = K["open"]
burn(PAVED, K["paved"], cl)
burn(PRIVATE, K["private"], cl)
burn(unary_union([h.buffer(0.7, cap_style="flat") for h in hedges]) if hedges else None, K["imp_veg"], cl)
burn(water, K["water"], cl)
burn(B, K["building"], cl)
# paved under the trees: a street tree is a point symbol, the paving stays
log("classes", {k: int((cl == v).sum() * R * R) for k, v in K.items()})

# ---- vectorising ------------------------------------------------------------------------------------------------------------
def shapes_of(mask, simplify=0.35, min_area=4.0):
    from rasterio.features import shapes
    from rasterio.transform import from_origin
    out = []
    for geo, v in shapes(mask.astype(np.uint8), mask=mask, transform=from_origin(X0, Y1, R, R)):
        g = shape(geo).simplify(simplify, preserve_topology=True)
        if g.area >= min_area:
            out.append(g)
    return out


objects = []


def add_area(g, sym, min_area=2.0):
    if g is None or g.is_empty:
        return
    g = g.intersection(frame)
    for p in getattr(g, "geoms", [g]):
        if p.geom_type != "Polygon" or p.area < min_area:
            continue
        rings = [[mm(x, y) for x, y in p.exterior.coords]] + [[mm(x, y) for x, y in r.coords] for r in p.interiors if Polygon(r).area > 1]
        objects.append({"sym": sym, "otp": 3, "rings": rings})


def add_line(g, sym, min_len=1.0):
    if g is None or g.is_empty:
        return
    g = g.intersection(frame)
    if g.geom_type == "GeometryCollection":
        g = shapely.MultiLineString([x for x in g.geoms if x.geom_type == "LineString"]) if any(x.geom_type == "LineString" for x in g.geoms) else None
        if g is None:
            return
    for l in getattr(g, "geoms", [g]):
        if l.geom_type in ("LineString", "LinearRing") and l.length >= min_len:
            objects.append({"sym": sym, "otp": 2, "rings": [[mm(x, y) for x, y in l.coords]]})
        elif l.geom_type == "Polygon":
            add_line(l.exterior, sym, min_len)


def add_point(x, y, sym, ang=0):
    objects.append({"sym": sym, "otp": 1, "ang": ang, "rings": [[mm(x, y)]]})


AREA_SYM = {"forest": None, "open": S(401), "open_t": S(402), "slow": S(406), "walk": S(408), "fight": S(410), "paved": S(501),
            "private": S(520), "water": S(301), "imp_veg": S(411)}
for k, sym in AREA_SYM.items():
    if sym:
        for g in shapes_of(cl == K[k], min_area=6 if k != "water" else 2):
            add_area(g, sym)
inside = frame.buffer(-0.01)
for g, p in buildings:
    add_area(g.simplify(0.15), S(521))
    add_line(g.simplify(0.15).boundary, S(521, 9))
if not canopy.is_empty:
    cg = canopy.difference(B)
    add_area(cg, S(522)); add_line(cg.boundary if not cg.is_empty else None, S(522, 9))
for g in shapes_of(cl == K["water"], min_area=2):
    add_line(g.exterior, S(301, 9))

# ---- lines ------------------------------------------------------------------------------------------------------------------
def along(line, arr, step=0.5):
    pts = [line.interpolate(d) for d in np.arange(0, line.length + 1e-6, step)]
    if not pts:
        return np.array([])
    px, py = to_px([p.x for p in pts], [p.y for p in pts])
    return arr[np.clip(py.astype(int), 0, NY - 1), np.clip(px.astype(int), 0, NX - 1)]


def height_of(line):
    """A wall or fence's height above the ground: the highest non-vegetation return within 0.5 m along it (LiDAR)."""
    zo = np.maximum(maximum_filter(Z["zo"], 3), maximum_filter(Z["zb"], 3))
    v = along(line, zo) - along(line, dtm)
    v = v[(v > 0.2) & (v < 8)]
    return float(np.median(v)) if len(v) > 3 else 0.0


wall_out = []
zo_cache = None
for g, kind, ret in walls:
    for l in getattr(g, "geoms", [g]):
        l = l.difference(B.buffer(0.3))
        for piece in getattr(l, "geoms", [l]):
            if piece.is_empty or piece.length < 2:
                continue
            h = height_of(piece)
            # a retaining wall: the ground on its two sides differs
            if ret:
                a = piece.parallel_offset(1.2, "left"); b = piece.parallel_offset(1.2, "right")
                drop = abs(float(np.median(along(a, dtm))) - float(np.median(along(b, dtm)))) if not a.is_empty and not b.is_empty else 0
                h = max(h, drop)
            imp = h >= 1.5
            sym = (S(518) if imp else S(516)) if kind == "fence" else S(515) if imp else (S(513, 2) if ret else S(513, 1))
            add_line(piece.simplify(0.2), sym, 1.5)
            wall_out.append({"pts": [[round(x - X0, 2), round(Y1 - y, 2)] for x, y in piece.simplify(0.15).coords], "kind": kind,
                             "h": round(max(h, 0.8 if kind == "fence" else 0.6), 2), "imp": bool(imp), "ret": bool(ret)})
for g in hedges:
    for piece in getattr(g, "geoms", [g]):
        if piece.geom_type != "LineString" or piece.length < 2:
            continue
        v = along(piece, chm); v = v[(v > 0.3) & (v < 8)]
        wall_out.append({"pts": [[round(x - X0, 2), round(Y1 - y, 2)] for x, y in piece.simplify(0.2).coords], "kind": "hedge",
                         "h": round(float(np.median(v)) if len(v) > 3 else 1.6, 2), "imp": True, "ret": False})
for g in steps:                                                       # stairways, for the 3D steps and the control sites
    for piece in getattr(g, "geoms", [g]):
        if piece.geom_type == "LineString" and piece.length >= 1.5:
            wall_out.append({"pts": [[round(x - X0, 2), round(Y1 - y, 2)] for x, y in piece.simplify(0.2).coords], "kind": "steps",
                             "h": 2.2, "imp": False, "ret": False})
log("walls and fences", len(wall_out), "impassable", sum(w["imp"] for w in wall_out))
for g in path_lines:
    add_line(g.difference(PAVED).difference(B), S(505), 3)
for g in small_lines:
    add_line(g.difference(PAVED).difference(B), S(506), 3)
for g in steps:
    add_line(g.difference(B), S(532), 1)
for g in streams:
    if g is not None:
        add_line(g.difference(water.buffer(0.5)).difference(B), S(305), 3)
if not RAIL.is_empty:
    add_line(RAIL.intersection(frame), S(509, 1), 3)

# contours: every 2.5 m from the LiDAR's ground, smoothed, out of the buildings
from skimage.measure import find_contours
sm = gaussian_filter(dtm, 3.0)
lo, hi = math.floor(sm.min() / 2.5) * 2.5, math.ceil(sm.max() / 2.5) * 2.5
NOC = B.buffer(0.6)
nc = 0
for lv in np.arange(lo, hi + 0.01, 2.5):
    idx = abs((lv / 2.5) % 5) < 1e-6
    for c in find_contours(sm, lv):
        if len(c) < 6:
            continue
        xs, ys = X0 + (c[:, 1] + 0.5) * R, Y1 - (c[:, 0] + 0.5) * R
        l = LineString(list(zip(xs, ys))).simplify(0.4)
        for piece in getattr(l.difference(NOC), "geoms", [l.difference(NOC)]):
            if piece.geom_type == "LineString" and piece.length > 15:
                add_line(piece, S(102) if idx else S(101)); nc += 1
log("contour pieces", nc, f"{lo}-{hi} m")

# ---- points -----------------------------------------------------------------------------------------------------------------
# trees standing alone: the LiDAR's crowns over paved or open ground
c = gaussian_filter(chm, 1.0)
pk = (c == maximum_filter(c, size=9)) & (c > 4)
r_, c_ = np.nonzero(pk)
lone = 0
for i, j in zip(r_, c_):
    if cl[i, j] in (K["paved"], K["open"]) and canopy_cover[i, j] < 0.5:
        x, y = X0 + (j + 0.5) * R, Y1 - (i + 0.5) * R
        add_point(x, y, S(417) if c[i, j] > 14 else S(418)); lone += 1
for e in osm:
    t = tags(e)
    if e["type"] != "node":
        continue
    x, y = osm_xy(e["lat"], e["lon"])
    if not (X0 < x < X1 and Y0 < y < Y1):
        continue
    if t.get("historic") in ("memorial", "monument", "wayside_cross") or t.get("tourism") == "artwork" or t.get("man_made") == "cross":
        add_point(x, y, S(526))
    elif t.get("amenity") in ("fountain", "drinking_water") or t.get("man_made") in ("water_well", "water_tap"):
        add_point(x, y, S(311))
log("points: lone trees", lone)
# north lines, 30 mm apart (120 m), blue
for xm in np.arange(math.floor((X0 - CX) / 120) * 120, (X1 - CX) + 1, 120):
    objects.append({"sym": S(601, 1), "otp": 2, "rings": [[mm(CX + xm, Y0), mm(CX + xm, Y1)]]})

json.dump({"title": f"{RACE} sprint", "scale": SCALE, "set": "issprom2019-2", "realWorld": {"x": CX, "y": CY, "epsg": 2154},
           "objects": objects}, open(RD / "map_objects.json", "w"))
np.savez_compressed(SRC / "classes.npz", cl=cl, chm=chm, canopy=canopy_cover)
json.dump({"walls": wall_out, "origin": [X0, Y1], "res": R}, open(SRC / "walls.json", "w"))
log("objects", len(objects), {s: sum(1 for o in objects if o["sym"] == s) for s in sorted({o["sym"] for o in objects})})
