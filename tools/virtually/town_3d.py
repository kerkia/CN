"""The town of a sprint race of « Virtually », in 3D (after town_map.py, mkocd.mjs, dump.mjs and build.py):

  py town_3d.py <race>      writes pkg/town.json and pkg/town.bin, and replaces pkg/ground.jpg by the aerial photograph

- each building of IGN's BD TOPO: its footprint, walls from the ground to its roof's edge, and its roof fitted to the LiDAR's
  building points (class 6): up to 8 planes found by RANSAC, each roof node taking the plane of its nearest points, so that
  gables, hips and flat roofs come out as they are; a building without points gets a flat roof at BD TOPO's height;
- the façades' look from BD TOPO's use (housing, shops, church…) and a seed: the shader (games/vtown.js) draws floors, windows,
  shutters and doors on them; the roofs' colour is the photograph's over the roof;
- walls, fences and hedges (town_map.py's, their heights measured on the LiDAR), street furniture from OpenStreetMap;
- the ground's texture: IGN's BD ORTHO at 0.25 m, the shade of the buildings lightened.
Everything in the world frame of build.py (x to the map's right, z down, metres), grouped by 64 m chunks as vworld.js streams.

town.bin: the arrays listed in town.json `arrays` (name, type, offset in bytes, count), each 4-byte aligned:
  rpos f32 (x, y, z), rcol u8 (r, g, b, flat + 2 × material), ridx u16 or u32 (chunk-local) — roofs;
  wpos f32 (x, y, z), wuv f32 (u along the wall's side, v above the ground's median along the building), wseg f32 (segment length, eave height,
  floor height, seed), wcol u8 (r, g, b, kind + 10 × material), widx u16 or u32 — walls.
town.json: { arrays, chunks: { "a,b": { r: [v0, nv, i0, ni], w: [v0, nv, i0, ni] } }, foot: [[ [x, z]… ]…] (collision outlines),
  walls: [{ pts, kind, h, imp }], props: [[kind, x, z, angle]], credit }"""
import json, math, os, sys, time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt, binary_dilation
from scipy.spatial import cKDTree, Delaunay
import shapely
from shapely.geometry import shape, Polygon, Point

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
RACE = sys.argv[1]
RD = DATA / RACE; SRC = RD / "src"; PKG = RD / "pkg"
A = json.load(open(RD / "area.json")); race = json.load(open(PKG / "race.json"))
EX0, EY0, EX1, EY1 = A["ext"]
K = race["k"]; M0 = race["mm0"]
MAPC = json.load(open(RD / "map_objects.json"))["realWorld"]
WX0, WZ0 = MAPC["x"] + M0[0] * K, MAPC["y"] + M0[1] * K          # world (0, 0) in Lambert 93
W, H = race["W"], race["H"]
CH = 64
T0 = time.time()
log = lambda *a: print(f"[{time.time() - T0:5.0f}s]", *a, flush=True)
rng = np.random.default_rng(11)
wx = lambda X: X - WX0
wz = lambda Y: WZ0 - Y

# the game's own ground heights (h.png), so that walls meet the ground the runner sees
hp = np.asarray(Image.open(PKG / "h.png").convert("RGB")).astype(np.float32)
HG = race["base"] + (hp[..., 0] * 256 + hp[..., 1]) / 100


def ground(x, z):
    j = np.clip(np.asarray(x).astype(int), 0, W - 1); i = np.clip(np.asarray(z).astype(int), 0, H - 1)
    return HG[i, j]


# ---- the aerial photograph, in the world frame at 0.25 m ------------------------------------------------------------------
GR = 0.25
gw, gh = int(W / GR), int(H / GR)
photo = np.zeros((gh, gw, 3), np.float32) + np.array([96, 100, 86], np.float32)
for f in SRC.glob("ortho_rgb_*.jpg"):
    _, _, x0, y0 = f.stem.split("_"); x0, y0 = int(x0), int(y0)
    im = Image.open(f).convert("RGB"); w_m, h_m = im.width / 5, im.height / 5
    im = np.asarray(im.resize((int(round(w_m / GR)), int(round(h_m / GR))), Image.LANCZOS)).astype(np.float32)
    c, r = int(round(wx(x0) / GR)), int(round(wz(y0 + h_m) / GR))
    a0, b0 = max(0, -r), max(0, -c); r1, c1 = min(gh, r + im.shape[0]), min(gw, c + im.shape[1])
    if r1 > max(r, 0) and c1 > max(c, 0):
        photo[max(r, 0):r1, max(c, 0):c1] = im[a0:a0 + r1 - max(r, 0), b0:b0 + c1 - max(c, 0)]
log("photograph", photo.shape)

# ---- buildings -------------------------------------------------------------------------------------------------------------
feats = json.load(open(SRC / "bdtopo_batiment.json"))["features"]
roof = np.load(SRC / "roofpts.npy")                               # x - EX0, y - EY0, z (L93)
roof[:, 0] += EX0 - WX0; roof[:, 1] = WZ0 - (roof[:, 1] + EY0)     # → world x, z
rtree = cKDTree(roof[:, :2])
world_box = shapely.box(0, 0, W, H)
USE = {"résidentiel": 0, "commercial et services": 1, "religieux": 2, "sportif": 3, "industriel": 4, "agricole": 4, "annexe": 5,
       "indifférencié": 0}
FACADE = [  # plasters of the Île-de-France: cream, sand, grey, white, meulière (millstone)
    (222, 208, 182), (210, 196, 170), (198, 192, 182), (230, 226, 216), (176, 150, 118), (214, 200, 168), (190, 176, 152), (236, 222, 196)]
STONE = (188, 178, 160)


def ransac_planes(P, max_planes=8, tol=0.15):
    """Planes z = a x + b y + c over roof points P (n×3): [(a, b, c, inlier indices)]."""
    planes = []; left = np.arange(len(P)); n0 = len(P)
    for _ in range(max_planes):
        if len(left) < max(20, 0.05 * n0):
            break
        Q = P[left]
        t = rng.integers(0, len(Q), (300, 3))
        p1, p2, p3 = Q[t[:, 0]], Q[t[:, 1]], Q[t[:, 2]]
        nrm = np.cross(p2 - p1, p3 - p1)
        ok = np.abs(nrm[:, 2]) > 1e-6
        a = -nrm[:, 0] / np.where(ok, nrm[:, 2], 1); b = -nrm[:, 1] / np.where(ok, nrm[:, 2], 1)
        c = p1[:, 2] - a * p1[:, 0] - b * p1[:, 1]
        ok &= np.hypot(a, b) < 1.25                                # roofs steeper than 51° are walls
        res = np.abs(Q[:, 2][None, :] - (a[:, None] * Q[:, 0][None, :] + b[:, None] * Q[:, 1][None, :] + c[:, None]))
        cnt = (res < tol).sum(1) * ok
        k = int(np.argmax(cnt))
        if cnt[k] < max(18, 0.06 * n0):
            break
        inl = res[k] < tol
        X = np.c_[Q[inl, 0], Q[inl, 1], np.ones(inl.sum())]
        sol = np.linalg.lstsq(X, Q[inl, 2], rcond=None)[0]
        inl = np.abs(Q[:, 2] - (sol[0] * Q[:, 0] + sol[1] * Q[:, 1] + sol[2])) < tol
        planes.append((*sol, left[inl]))
        left = left[~inl]
    return planes


def colour_over(poly):
    """The photograph's median colour inside the outline drawn 1 m in."""
    p = poly.buffer(-1.0)
    if p.is_empty:
        p = poly
    x0, z0, x1, z1 = p.bounds
    xs = np.arange(x0, x1, 0.5); zs = np.arange(z0, z1, 0.5)
    if not len(xs) or not len(zs):
        return (120, 110, 100)
    X, Z = np.meshgrid(xs, zs); X, Z = X.ravel(), Z.ravel()
    inn = shapely.contains_xy(p, X, Z)
    if inn.sum() < 4:
        return (120, 110, 100)
    c = photo[np.clip((Z[inn] / GR).astype(int), 0, gh - 1), np.clip((X[inn] / GR).astype(int), 0, gw - 1)]
    return tuple(int(v) for v in np.median(c, axis=0))


chunks = {}
foot = []
stats = {"planes": 0, "flat": 0, "fitted": 0}


def chunk_of(x, z):
    return f"{int(x // CH)},{int(z // CH)}"


def push(key, part, pos, col, idx, extra=None):
    c = chunks.setdefault(key, {"r": [[], [], []], "w": [[], [], [], [], []]})
    if part == "r":
        base = sum(len(p) for p in c["r"][0])
        c["r"][0].append(pos); c["r"][1].append(col); c["r"][2].append(idx + base)
    else:
        base = sum(len(p) for p in c["w"][0])
        c["w"][0].append(pos); c["w"][1].append(extra[0]); c["w"][2].append(extra[1]); c["w"][3].append(col); c["w"][4].append(idx + base)


for f in feats:
    pr = f["properties"]; g = shapely.force_2d(shape(f["geometry"])).buffer(0)
    g = shapely.transform(g, lambda c: np.c_[wx(c[:, 0]), wz(c[:, 1])])
    g = g.intersection(world_box)
    for poly in getattr(g, "geoms", [g]):
        if poly.geom_type != "Polygon" or poly.area < 4:
            continue
        poly = poly.simplify(0.1)
        cx, cz = poly.centroid.x, poly.centroid.y
        rings = [np.array(poly.exterior.coords)] + [np.array(r.coords) for r in poly.interiors]
        foot.append([[round(float(x), 2), round(float(z), 2)] for x, z in rings[0]])
        base = float(np.min(ground(rings[0][:, 0], rings[0][:, 1]))) - 0.3
        top_g = float(np.median(ground(rings[0][:, 0], rings[0][:, 1])))
        # the roof's points
        cand = rtree.query_ball_point([cx, cz], math.sqrt(poly.area) * 1.2 + 10)
        P = roof[cand] if cand else np.zeros((0, 3), np.float32)
        if len(P):
            P = P[shapely.contains_xy(poly.buffer(-0.25), P[:, 0], P[:, 1])]
        hz = float(pr.get("hauteur") or 0) or 3.0 * (pr.get("nombre_d_etages") or 2)
        # the roof's nodes: the outline densified, a lattice inside
        edge = shapely.segmentize(poly, 0.9)
        bnd = [np.array(edge.exterior.coords)[:-1]] + [np.array(r.coords)[:-1] for r in edge.interiors]
        x0, z0, x1, z1 = poly.bounds
        xs, zs = np.meshgrid(np.arange(x0 + 0.45, x1, 0.9), np.arange(z0 + 0.45, z1, 0.9))
        xs, zs = xs.ravel(), zs.ravel()
        inner = poly.buffer(-0.3)
        keep = shapely.contains_xy(inner, xs, zs) if not inner.is_empty else np.zeros(len(xs), bool)
        nodes = np.vstack(bnd + [np.c_[xs[keep], zs[keep]]])
        nb = sum(len(b) for b in bnd)
        if len(P) >= 15:
            planes = ransac_planes(P.astype(np.float64))
            stats["planes"] += len(planes); stats["fitted"] += 1
            zmax = float(P[:, 2].max()) + 0.2
            if planes:
                lab = np.full(len(P), -1)
                for k, pl in enumerate(planes):
                    lab[pl[3]] = k
                L = lab >= 0
                kt = cKDTree(P[L, :2]); d, ii = kt.query(nodes, k=min(6, int(L.sum())))
                ii = np.atleast_2d(ii) if ii.ndim == 1 else ii
                labs = lab[L][ii]
                best = np.array([np.bincount(r, minlength=len(planes)).argmax() for r in labs])
                pa = np.array([[p[0], p[1], p[2]] for p in planes])
                nz = pa[best, 0] * nodes[:, 0] + pa[best, 1] * nodes[:, 1] + pa[best, 2]
                # a node far from any plane's points takes the points' own height near it
                far = np.atleast_2d(d)[:, 0] > 2.5
                if far.any():
                    pt = cKDTree(P[:, :2]); dd, jj = pt.query(nodes[far], k=min(5, len(P)))
                    nz[far] = np.median(P[np.atleast_2d(jj), 2], axis=1)
            else:
                pt = cKDTree(P[:, :2]); dd, jj = pt.query(nodes, k=min(5, len(P)))
                nz = np.median(P[np.atleast_2d(jj), 2], axis=1)
            # a node whose plane's height is far from the points' own around it (a plane extrapolated across a step, a dormer)
            # takes the points' median: no spike, no roof sunk below its walls
            pt = cKDTree(P[:, :2]); dd, jj = pt.query(nodes, k=min(8, len(P)))
            zloc = np.median(P[np.atleast_2d(jj), 2], axis=1)
            bad = np.abs(nz - zloc) > 0.7
            nz[bad] = zloc[bad]
            nz = np.clip(nz, top_g + 2.2, zmax)
            # the eaves: along each ring, a running median of 3 nodes (a node taking another plane than its neighbours made a saw)
            off = 0
            for b in bnd:
                n = len(b)
                if n >= 5:
                    zr = nz[off:off + n]; ext = np.concatenate([zr[-1:], zr, zr[:1]])
                    nz[off:off + n] = np.median(np.lib.stride_tricks.sliding_window_view(ext, 3), axis=1)
                off += n
        else:
            stats["flat"] += 1
            z = float(pr.get("altitude_maximale_toit") or 0) or (top_g + max(hz, 3))
            nz = np.full(len(nodes), max(z, top_g + 2.5))
        # roof triangles inside the outline
        try:
            tri = Delaunay(nodes).simplices
        except Exception:
            continue
        cen = nodes[tri].mean(axis=1)
        tri = tri[shapely.contains_xy(poly, cen[:, 0], cen[:, 1])]
        if not len(tri):
            continue
        rc = colour_over(poly)
        use = (pr.get("usage_1") or "indifférencié").lower()
        nat = (pr.get("nature") or "").lower()
        kind = 2 if ("église" in nat or "chapelle" in nat or use.startswith("religieux")) else USE.get(use, 0)
        if poly.buffer(-0.9).is_empty:                                  # a sliver under 1.8 m wide: a wall, no windows
            kind = 5
        flat = (nz.max() - nz.min()) < 0.6
        rpos = np.c_[nodes[:, 0], nz, nodes[:, 1]].astype(np.float32)
        # the roof's material (materiaux_de_la_toiture's first digit): 1 tiles, 2 slates, 3 zinc; its colour the photograph's
        rmat = {"2": 1, "3": 2}.get(str(pr.get("materiaux_de_la_toiture") or "0")[:1], 0)
        canon = {0: (150, 82, 62), 1: (78, 82, 90), 2: (140, 146, 150)}[rmat]
        rc = tuple(int(0.6 * a + 0.4 * b) for a, b in zip(rc, canon)) if not flat else rc
        rcol = np.tile(np.array([*rc, (1 if flat else 0) + 2 * rmat], np.uint8), (len(nodes), 1))
        key = chunk_of(cx, cz)
        push(key, "r", rpos, rcol, tri.astype(np.uint32))
        # walls: each ring's edge where the roof's edge bends (Douglas-Peucker on the height along it, 0.1 m)
        b0 = top_g                                                   # the façade's floors count from the ground's median
        eave = float(np.percentile(nz[:nb], 20)) - b0
        levels = pr.get("nombre_d_etages") or max(1, round((eave - 0.5) / 2.9))
        floor_h = max(2.5, min(3.6, (eave - 0.4) / max(1, levels))) if kind not in (2, 3, 4, 5) else 0
        seed = float(rng.random())
        # the walls' material from the land registry's code (BD TOPO materiaux_des_murs, its first digit): 1 stone, 2 millstone
        # (meulière, Île-de-France's), 4 brick, 6 wood; concrete, blocks and the unknown are rendered (plaster)
        wm = str(pr.get("materiaux_des_murs") or "0")[:1]
        mat = {"1": 1, "2": 2, "4": 3, "6": 4}.get(wm, 0)
        if kind == 2:
            mat = 1
        fc = {1: STONE, 2: (170, 128, 88), 3: (150, 78, 58), 4: (120, 90, 62)}.get(mat) or (FACADE[int(seed * 997) % len(FACADE)] if kind != 5 else (172, 160, 140))
        style = kind + 10 * mat
        off = 0
        wp, wu, ws, wi = [], [], [], []
        for b in bnd:
            n = len(b); zb = nz[off:off + n]; off += n
            # split the ring at the outline's own corners (the original vertices), each side its own segment
            ring0 = np.array(rings[len(wp) and 0 or 0])
            P2 = np.vstack([b, b[:1]]); Z2 = np.concatenate([zb, zb[:1]])
            seglen = np.hypot(*np.diff(P2, axis=0).T)
            # corners: where the direction turns by more than 20°
            d = np.diff(P2, axis=0); ang = np.arctan2(d[:, 1], d[:, 0])
            turn = np.abs((np.diff(np.concatenate([ang[-1:], ang])) + np.pi) % (2 * np.pi) - np.pi) > math.radians(20)
            corners = list(np.nonzero(turn)[0]) or [0]
            corners = sorted(set(corners))
            for ci, s0 in enumerate(corners):
                s1 = corners[(ci + 1) % len(corners)]
                ids = list(range(s0, s1 + 1)) if s1 > s0 else list(range(s0, n + 1)) + list(range(1, s1 + 1))
                ids = [k % (n + 0) if k < n else 0 for k in ids] if False else [k if k <= n else k - n for k in ids]
                pts = P2[[k if k < n + 1 else 0 for k in ids]]; zz = Z2[[k if k < n + 1 else 0 for k in ids]]
                s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
                Ls = float(s[-1])
                if Ls < 0.3:
                    continue
                # Douglas-Peucker on (s, z)
                keepi = [0, len(s) - 1]
                stack = [(0, len(s) - 1)]
                while stack:
                    i0, i1 = stack.pop()
                    if i1 <= i0 + 1:
                        continue
                    t = (s[i0 + 1:i1] - s[i0]) / max(s[i1] - s[i0], 1e-6)
                    dev = np.abs(zz[i0 + 1:i1] - (zz[i0] + t * (zz[i1] - zz[i0])))
                    k = int(np.argmax(dev))
                    if dev[k] > 0.1:
                        m_ = i0 + 1 + k; keepi.append(m_); stack += [(i0, m_), (m_, i1)]
                keepi = sorted(set(keepi))
                for qa, qb in zip(keepi, keepi[1:]):
                    ax, az, bx, bz = pts[qa][0], pts[qa][1], pts[qb][0], pts[qb][1]
                    v = len(wp)
                    wp += [[ax, base, az], [bx, base, bz], [bx, zz[qb], bz], [ax, zz[qa], az]]
                    wu += [[s[qa], base - b0], [s[qb], base - b0], [s[qb], zz[qb] - b0], [s[qa], zz[qa] - b0]]
                    ws += [[Ls, eave, floor_h, seed]] * 4
                    wi += [v, v + 1, v + 2, v, v + 2, v + 3]
        if wp:
            push(key, "w", np.array(wp, np.float32), np.tile(np.array([*fc, style], np.uint8), (len(wp), 1)), np.array(wi, np.uint32),
                 extra=(np.array(wu, np.float32), np.array(ws, np.float32)))
log("buildings", len(foot), stats)

# ---- arrays -------------------------------------------------------------------------------------------------------------
out = bytearray(); arrays = {}
NAMES = {"rpos": ("f32", 3), "rcol": ("u8", 4), "ridx": ("u32", 1), "wpos": ("f32", 3), "wuv": ("f32", 2), "wseg": ("f32", 4),
         "wcol": ("u8", 4), "widx": ("u32", 1)}
bufs = {k: [] for k in NAMES}
index = {}
counts = {k: 0 for k in NAMES}
for key, c in chunks.items():
    e = {}
    if c["r"][0]:
        pos = np.vstack(c["r"][0]); e["r"] = [counts["rpos"], len(pos), counts["ridx"], 0]
        bufs["rpos"].append(pos); bufs["rcol"].append(np.vstack(c["r"][1])); idx = np.concatenate([i.ravel() for i in c["r"][2]])
        bufs["ridx"].append(idx); e["r"][3] = len(idx); counts["rpos"] += len(pos); counts["ridx"] += len(idx)
    if c["w"][0]:
        pos = np.vstack(c["w"][0]); e["w"] = [counts["wpos"], len(pos), counts["widx"], 0]
        bufs["wpos"].append(pos); bufs["wuv"].append(np.vstack(c["w"][1])); bufs["wseg"].append(np.vstack(c["w"][2]))
        bufs["wcol"].append(np.vstack(c["w"][3])); idx = np.concatenate(c["w"][4]); bufs["widx"].append(idx)
        e["w"][3] = len(idx); counts["wpos"] += len(pos); counts["widx"] += len(idx)
    index[key] = e
for k, (tp, n) in NAMES.items():
    a = np.concatenate(bufs[k]) if bufs[k] else np.zeros(0)
    if tp == "u32" and (not len(a) or a.max() < 65536):              # chunk-local indices: 16 bits are enough
        tp = "u16"
    a = a.astype({"f32": np.float32, "u8": np.uint8, "u16": np.uint16, "u32": np.uint32}[tp])
    while len(out) % 4:
        out += b"\0"
    arrays[k] = [tp, len(out), int(a.size)]
    out += a.tobytes()
(PKG / "town.bin").write_bytes(bytes(out))

# ---- walls, fences, hedges; street furniture -------------------------------------------------------------------------------
WJ = json.load(open(SRC / "walls.json")); ox, oy = WJ["origin"]
walls = []
for w in WJ["walls"]:
    pts = [[round(EX0 + x - WX0, 2), round(WZ0 - (oy - z), 2)] for x, z in w["pts"]]
    walls.append({"pts": pts, "kind": w["kind"], "h": w["h"], "imp": w["imp"]})
props = []
osm = json.load(open(SRC / "osm.json"))["elements"]
import pyproj
tr = pyproj.Transformer.from_crs(4326, 2154, always_xy=True)
PROP = {("highway", "street_lamp"): "lamp", ("amenity", "bench"): "bench", ("leisure", "picnic_table"): "bench",
        ("amenity", "waste_basket"): "bin", ("barrier", "bollard"): "bollard", ("amenity", "post_box"): "postbox",
        ("amenity", "bicycle_parking"): "bikes", ("amenity", "fountain"): "fountain", ("amenity", "recycling"): "recycling",
        ("amenity", "telephone"): "phone", ("highway", "traffic_signals"): "signals", ("highway", "bus_stop"): "busstop",
        ("amenity", "drinking_water"): "tap", ("man_made", "street_cabinet"): "cabinet", ("advertising", "column"): "column",
        ("historic", "memorial"): "memorial", ("tourism", "artwork"): "memorial"}
for e in osm:
    if e["type"] != "node":
        continue
    t = e.get("tags", {})
    k = next((v for (a, b), v in PROP.items() if t.get(a) == b), None)
    if not k:
        continue
    X, Y = tr.transform(e["lon"], e["lat"]); x, z = wx(X), wz(Y)
    if 0 < x < W and 0 < z < H:
        props.append([k, round(x, 2), round(z, 2), round(float(t.get("direction", "0").split(";")[0]) if t.get("direction", "0").replace(".", "").isdigit() else rng.uniform(0, 360), 0)])
# street lamps along the streets where OpenStreetMap has none: every 26 m on one side of BD TOPO's town roads, none within 15 m
# of a lamp OpenStreetMap places
lamps = cKDTree([[p[1], p[2]] for p in props if p[0] == "lamp"] or [[-1e6, -1e6]])
if True:
    for f in json.load(open(SRC / "bdtopo_troncon_de_route.json"))["features"]:
        p = f["properties"]
        if (p.get("nature") or "").lower() not in ("route à 1 chaussée", "route à 2 chaussées", "rond-point"):
            continue
        g = shapely.force_2d(shape(f["geometry"])); g = shapely.transform(g, lambda c: np.c_[wx(c[:, 0]), wz(c[:, 1])])
        w = float(p.get("largeur_de_chaussee") or 5) / 2 + 1.2
        for l in getattr(g, "geoms", [g]):
            side = l.offset_curve(w)
            for d in np.arange(8, side.length, 26):
                q = side.interpolate(d)
                if 0 < q.x < W and 0 < q.y < H and lamps.query([q.x, q.y])[0] > 15:
                    o = l.interpolate(l.project(q))                    # the lamp's arm over the road
                    props.append(["lamp", round(q.x, 2), round(q.y, 2), round(-math.degrees(math.atan2(o.x - q.x, o.y - q.y)), 0)])
json.dump({"arrays": arrays, "chunks": index, "foot": foot, "walls": walls, "props": props, "chunk": CH,
           "credit": "© IGN (LiDAR HD, BD TOPO, BD ORTHO), Licence Ouverte 2.0; © OpenStreetMap contributors, ODbL"},
          open(PKG / "town.json", "w"), separators=(",", ":"))
log("town.bin", round(len(out) / 1e6, 2), "MB; town.json", round((PKG / "town.json").stat().st_size / 1e6, 2), "MB; walls", len(walls), "props", len(props))

# ---- the ground: the photograph, its shade lightened; under the trees' crowns (the photograph shows their tops) and outside the
# photograph, the ground classes' own colours with the photograph's grain ------------------------------------------------------------
from scipy.ndimage import zoom
lumi = photo.mean(axis=2)
local = gaussian_filter(lumi, 40)                                  # 10 m
shade = np.clip(1 - lumi / np.maximum(local * 0.8, 1), 0, 0.75)
shade = gaussian_filter(shade, 2)
img = photo * (1 + 1.6 * shade)[..., None]
img[..., 2] *= 1 - 0.12 * shade                                    # shade is bluish
cl1 = np.asarray(Image.open(PKG / "cls.png"))
CN = race["classes"]
GC = {"paved": (112, 110, 106), "road": (100, 100, 98), "open": (98, 122, 64), "open_t": (92, 114, 60), "forest": (82, 80, 58),
      "oob": (94, 116, 62), "building": (118, 112, 104), "water": (52, 74, 86), "stairs": (130, 128, 124), "path": (150, 132, 100),
      "small_path": (140, 124, 96), "slow": (76, 92, 54), "walk": (70, 86, 50), "block": (70, 90, 50)}
lut = np.array([GC.get(n, (96, 104, 70)) for n in CN] + [(96, 104, 70)] * (256 - len(CN)), np.float32)
cg = lut[cl1]                                                      # 1 m
cg = np.repeat(np.repeat(cg, 4, axis=0), 4, axis=1)[:gh, :gw]
cz = np.load(SRC / "classes.npz")
can = (cz["chm"] > 2.5).astype(np.float32)
# the canopy grid (0.5 m, the area's frame) onto the ground's (0.25 m, the world's)
gx = (np.arange(gw) + 0.5) * GR + WX0; gy = WZ0 - (np.arange(gh) + 0.5) * GR
ci = np.clip(((gx - EX0) / 0.5).astype(int), 0, can.shape[1] - 1); ri = np.clip(((EY1 - gy) / 0.5).astype(int), 0, can.shape[0] - 1)
canw = gaussian_filter(can, 1.5)[ri[:, None], ci[None, :]]
outside = ((gx < EX0) | (gx > EX1))[None, :] | ((gy < EY0) | (gy > EY1))[:, None]
grain = np.clip(lumi / np.maximum(gaussian_filter(lumi, 6), 1), 0.75, 1.25)[..., None]
m = np.clip(np.maximum(canw * 1.3 - 0.15, outside.astype(np.float32)), 0, 1)[..., None]
cg = gaussian_filter(cg, (3, 3, 0))
img = (img * (1 - m) + cg * (0.9 + 0.1 * grain) * m) * 0.8          # the photograph's colours are lit already: the scene lights them again
img = np.clip(img, 0, 255).astype(np.uint8)
Image.fromarray(img).save(PKG / "ground.jpg", quality=86)
# features.json: the town's walls are drawn by vtown.js, not as the forest's strips
F = json.load(open(PKG / "feats.json")); F["walls"] = []; json.dump(F, open(PKG / "feats.json", "w"))
race["town"] = {"file": "town.json", "bin": "town.bin"}
race["source"] = "town"
race["groundRes"] = GR
json.dump(race, open(PKG / "race.json", "w"), indent=1)
log("ground.jpg", img.shape, round((PKG / "ground.jpg").stat().st_size / 1e6, 2), "MB")
