"""Sprint courses on a town race of « Virtually » (after town_3d.py):   py course_sprint.py <race> [seed]

Control sites on sprint features: buildings' outer corners (the flag a metre out), monuments, fountains, trees and bushes
standing alone, stairways' feet, impassable walls' ends — never in a building, a garden, a forbidden area or against a wall.
Legs are timed on the ground classes' speeds (buildings, gardens, impassable walls, fences and hedges block; 1 m grid,
skimage's geometric MCP). A leg scores for its route choice: the best route and a second one kept 10 m away from it, within
12 % of its time; legs 60-260 m, controls 25 m apart, no dog-leg, no leg through another control's circle. Three courses
(yellow, orange, violet: few to many controls, short to long legs, route choice weighed more and more) into pkg/race.json
`courses`, the middle one also as `course`; a review picture per course beside the package."""
import json, math, os, sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, binary_dilation
from skimage.graph import MCP_Geometric

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
RACE = sys.argv[1]; SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 3
P = DATA / RACE / "pkg"
R = json.load(open(P / "race.json")); F = json.load(open(P / "feats.json")); TJ = json.load(open(P / "town.json"))
A = json.load(open(DATA / RACE / "area.json"))
cls = np.array(Image.open(P / "cls.png")); H, W = cls.shape
C = {n: i for i, n in enumerate(R["classes"])}
speed = np.array(R["speed"], np.float32)[cls]
rng = np.random.default_rng(SEED)

# ---- passability: the classes, the buildings' outlines and the impassable lines drawn in -------------------------------------
img = Image.fromarray((speed > 0.05).astype(np.uint8)); dr = ImageDraw.Draw(img)
for ring in TJ["foot"]:
    dr.polygon([tuple(p) for p in ring], fill=0)
for w in TJ["walls"]:
    if w["imp"]:
        dr.line([tuple(p) for p in w["pts"]], fill=0, width=1)
free = np.array(img, bool)
cost = np.where(free, 1.0 / np.maximum(speed, 0.05), np.inf)
cost[~free] = np.inf
# the course's area: the map's box, 25 m in from its edge (the world is the box plus the 3D scenery's margin)
WX0 = R["mm0"][0] * R["k"] + json.load(open(DATA / RACE / "map_objects.json"))["realWorld"]["x"]
WZ0 = R["mm0"][1] * R["k"] + json.load(open(DATA / RACE / "map_objects.json"))["realWorld"]["y"]
bx0, by0, bx1, by1 = A["box"]
X0, X1 = bx0 - WX0 + 25, bx1 - WX0 - 25
Z0, Z1 = WZ0 - by1 + 25, WZ0 - by0 - 25
inbox = lambda x, z: X0 < x < X1 and Z0 < z < Z1
near_block = distance_transform_edt(free) < 1.5                   # within 1.5 m of a wall or a building
ok_ground = free & np.isin(cls, [C[k] for k in ("paved", "open", "open_t", "path", "road", "track", "small_path", "forest", "stairs")])

# ---- control sites ----------------------------------------------------------------------------------------------------------
sites = []


def site(x, z, kind):
    i, j = int(z), int(x)
    if not inbox(x, z) or not (0 <= i < H and 0 <= j < W) or not ok_ground[i, j]:
        return
    sites.append((x, z, kind))


for ring in TJ["foot"]:
    p = np.array(ring[:-1]); n = len(p)
    if n < 4:
        continue
    area = 0.5 * abs(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1]))
    if area < 50:
        continue
    sgn = np.sign(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1]))
    for k in range(n):
        a, b, c = p[k - 1], p[k], p[(k + 1) % n]
        u, v = b - a, c - b
        if np.hypot(*u) < 3 or np.hypot(*v) < 3:
            continue
        cross = (u[0] * v[1] - u[1] * v[0]) * sgn
        ang = math.degrees(math.acos(np.clip(np.dot(-u, v) / np.hypot(*u) / np.hypot(*v), -1, 1)))
        if cross <= 0 or not (60 < ang < 120):                      # an outer corner, near square
            continue
        out = (u / np.hypot(*u) - v / np.hypot(*v)); out /= np.hypot(*out) or 1
        q = b + out * 1.1
        # open on both sides: 4 m along each wall's prolongation free
        if all(free[int(np.clip(t[1], 0, H - 1)), int(np.clip(t[0], 0, W - 1))] for t in (b + u / np.hypot(*u) * 4, b - v / np.hypot(*v) * 4)):
            site(q[0], q[1], "corner")
for f in F["features"]:
    k = {"monument": "monument", "fountain": "fountain", "bush": "bush", "bigtree": "bigtree", "manmade": "manmade"}.get(f["k"])
    if k:
        site(f["x"] + 0.8, f["z"], k)
for w in TJ["walls"]:
    if w["imp"] and w["kind"] == "wall" and len(w["pts"]) >= 2:
        for e, nb in ((w["pts"][0], w["pts"][1]), (w["pts"][-1], w["pts"][-2])):
            d = np.array(e) - np.array(nb); d /= np.hypot(*d) or 1
            q = np.array(e) + d * 1.0
            site(q[0], q[1], "wallend")
for w in TJ["walls"]:                                                  # a stairway's foot (its lower end, by the ground's height)
    if w["kind"] == "steps" and len(w["pts"]) >= 2:
        hh = np.array(Image.open(P / "h.png").convert("RGB"), np.float32) if "hh" not in globals() else hh
        lv = [hh[int(p[1]), int(p[0]), 0] * 256 + hh[int(p[1]), int(p[0]), 1] for p in (w["pts"][0], w["pts"][-1])]
        e, nb = (w["pts"][0], w["pts"][1]) if lv[0] <= lv[1] else (w["pts"][-1], w["pts"][-2])
        d = np.array(e) - np.array(nb); d /= np.hypot(*d) or 1
        q = np.array(e) + d * 1.2
        site(q[0], q[1], "stairs")
xy = np.array([[s[0], s[1]] for s in sites]); kinds = [s[2] for s in sites]
# thin out the corners: one in 12 m (a street's long row of house corners is one choice, not ten)
keep = np.ones(len(sites), bool)
from scipy.spatial import cKDTree
kd = cKDTree(xy)
for i in rng.permutation(len(sites)):
    if keep[i]:
        for j in kd.query_ball_point(xy[i], 12):
            if j != i:
                keep[j] = False
xy = xy[keep]; kinds = [k for k, m in zip(kinds, keep) if m]
print(RACE, "sites", len(xy), {k: kinds.count(k) for k in set(kinds)})

# ---- legs ---------------------------------------------------------------------------------------------------------------------
def route(i, j, cst):
    """The best route from site i to j over the cost grid cst (a window of the map): (time units, path [(z, x)…] in the map)."""
    (z0, x0), sub = cst
    m = MCP_Geometric(sub, fully_connected=True)
    cc, _ = m.find_costs([(int(xy[i][1]) - z0, int(xy[i][0]) - x0)])
    end = (int(xy[j][1]) - z0, int(xy[j][0]) - x0)
    if not np.isfinite(cc[end]):
        return math.inf, []
    return float(cc[end]), [(z + z0, x + x0) for z, x in m.traceback(end)]


def path_cost(pth):
    p = np.array(pth); d = np.hypot(*np.diff(p, axis=0).T)
    c = cost[p[:, 0], p[:, 1]]
    return float(np.sum(d * (c[1:] + c[:-1]) / 2))


_legs = {}


def leg(i, j):
    """(best time, the second route's time over the best's, the two routes' gap) — the second route kept 10 m away."""
    if (i, j) in _legs:
        return _legs[(i, j)]
    x0 = int(max(0, min(xy[i][0], xy[j][0]) - 130)); x1 = int(min(W, max(xy[i][0], xy[j][0]) + 130))
    z0 = int(max(0, min(xy[i][1], xy[j][1]) - 130)); z1 = int(min(H, max(xy[i][1], xy[j][1]) + 130))
    sub = cost[z0:z1, x0:x1]
    t1, p1 = route(i, j, ((z0, x0), sub))
    if not p1:
        _legs[(i, j)] = (math.inf, 9, 0, [], []); return _legs[(i, j)]
    band = np.zeros(sub.shape, bool); pa = np.array(p1) - [z0, x0]; band[pa[:, 0], pa[:, 1]] = True
    band = binary_dilation(band, iterations=10)
    for (z, x) in (pa[0], pa[-1]):                                  # the second route leaves the same control
        band[max(0, z - 12):z + 13, max(0, x - 12):x + 13] = False
    c2 = sub.copy(); c2[band] *= 6
    _, p2 = route(i, j, ((z0, x0), c2))
    r2 = path_cost(p2) / t1 if p2 else 9
    if p2:
        line = np.zeros(sub.shape, bool); line[pa[:, 0], pa[:, 1]] = True
        dd = distance_transform_edt(~line); q = np.array(p2) - [z0, x0]
        gap = float(np.mean(dd[q[:, 0], q[:, 1]]))
    else:
        gap = 0
    _legs[(i, j)] = (t1, r2, gap, p1, p2)
    return _legs[(i, j)]


def seg_cross(a, b, c, d):
    o = lambda p, q, r: np.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
    return o(a, b, c) != o(a, b, d) and o(c, d, a) != o(c, d, b)


LEVELS = {"yellow": dict(n=8, km=1.4, lo=60, hi=200, rc=0.3), "orange": dict(n=12, km=2.1, lo=70, hi=240, rc=1.0),
          "violet": dict(n=16, km=2.9, lo=70, hi=260, rc=2.0)}


def make(level, tries=60):
    L = LEVELS[level]; best = None
    # the start: a site near the box's middle-south (the map's bottom), the finish near it
    for t in range(tries):
        s = int(rng.integers(len(xy)))
        seq = [s]; score = 0.0; legs_ = []
        while len(seq) < L["n"] + 1:
            last = seq[-1]
            d = np.hypot(xy[:, 0] - xy[last, 0], xy[:, 1] - xy[last, 1])
            cand = [int(c) for c in np.nonzero((d > L["lo"]) & (d < L["hi"]))[0] if c not in seq]
            rng.shuffle(cand)
            got = None
            for c in cand[:25]:
                if any(math.hypot(*(xy[c] - xy[q])) < 25 for q in seq):
                    continue
                if len(seq) >= 2:
                    a1 = math.atan2(*(xy[last] - xy[seq[-2]])[::-1]); a2 = math.atan2(*(xy[c] - xy[last])[::-1])
                    if abs((a2 - a1 + math.pi) % (2 * math.pi) - math.pi) > math.radians(145):
                        continue
                if any(seg_cross(xy[last], xy[c], xy[seq[k]], xy[seq[k + 1]]) for k in range(len(seq) - 2)):
                    continue
                t1, r2, gap, p1, p2 = leg(last, c)
                if not math.isfinite(t1) or t1 > 2.6 * d[c]:
                    continue
                # no leg through another control's circle (15 m)
                pa = np.array(p1)
                if any(np.min(np.hypot(pa[:, 1] - xy[q][0], pa[:, 0] - xy[q][1])) < 15 for q in seq[:-1]):
                    continue
                choice = max(0.0, 1.12 - r2) / 0.12 if gap > 12 else 0.0
                got = (c, choice, t1); break
            if got is None:
                break
            seq.append(got[0]); legs_.append(got); score += L["rc"] * got[1] + 0.2 * (got[2] / d[got[0]] > 1.25)
        if len(seq) < L["n"] + 1:
            continue
        # the finish: a free cell 30-120 m from the last control, toward the start
        fin = None
        for _ in range(200):
            a = rng.uniform(0, 2 * math.pi); r = rng.uniform(40, 140)
            q = xy[seq[-1]] + r * np.array([math.cos(a), math.sin(a)])
            if inbox(*q) and ok_ground[int(q[1]), int(q[0])] and not near_block[int(q[1]), int(q[0])] and math.hypot(*(q - xy[s])) < 200:
                fin = q; break
        if fin is None:
            continue
        pts = [xy[k] for k in seq] + [fin]
        length = sum(math.hypot(*(b - a)) for a, b in zip(pts, pts[1:]))
        kinds_ = [kinds[k] for k in seq[1:]]
        score += 1.5 * len(set(kinds_)) / len(kinds_) - 4 * abs(length / 1000 - L["km"])
        if best is None or score > best[0]:
            best = (score, seq, fin, length, legs_)
    return best


out = []
used_starts = set()
for level in ("yellow", "orange", "violet"):
    b = make(level)
    if b is None:
        print(level, "no course found"); continue
    score, seq, fin, length, legs_ = b
    codes = list(range(31, 31 + len(seq) - 1)); rng.shuffle(codes)
    ctl = [{"kind": "start", "x": round(float(xy[seq[0]][0]), 1), "z": round(float(xy[seq[0]][1]), 1)}]
    for k, code in zip(seq[1:], codes):
        ctl.append({"kind": "control", "x": round(float(xy[k][0]), 1), "z": round(float(xy[k][1]), 1), "code": str(code), "feature": kinds[k]})
    ctl.append({"kind": "finish", "x": round(float(fin[0]), 1), "z": round(float(fin[1]), 1)})
    rc = sum(1 for l in legs_ if l[1] > 0.3)
    print(f"{level}: {len(seq) - 1} controls, {length / 1000:.2f} km, {rc} legs with a route choice, score {score:.2f}")
    out.append({"id": level, "level": level, "name": {"yellow": "Gif Sprint Jaune", "orange": "Gif Sprint Orange", "violet": "Gif Sprint Violet"}[level],
                "controls": ctl, "length": round(length)})
    # review picture
    rv = Image.fromarray(np.where(free[..., None], np.array([250, 250, 245], np.uint8), np.array([60, 60, 60], np.uint8))).convert("RGB")
    d_ = ImageDraw.Draw(rv)
    for (c, ch, t1), (i0, i1) in zip(legs_, zip(seq, seq[1:])):
        _, _, _, p1, p2 = leg(i0, i1)
        d_.line([(x, z) for z, x in p1], fill=(0, 120, 255), width=2)
        if ch > 0:
            d_.line([(x, z) for z, x in p2], fill=(0, 200, 90), width=2)
    pts = [tuple(xy[k]) for k in seq] + [tuple(fin)]
    for a_, b_ in zip(pts, pts[1:]):
        d_.line([a_, b_], fill=(200, 0, 160), width=2)
    for i, (x, z) in enumerate(pts):
        d_.ellipse([x - 12, z - 12, x + 12, z + 12], outline=(200, 0, 160), width=2)
        d_.text((x + 13, z - 13), "S" if i == 0 else "F" if i == len(pts) - 1 else str(i), fill=(200, 0, 160))
    rv.save(P.parent / f"course_{level}.png")
R["courses"] = out
mid = next((c for c in out if c["id"] == "orange"), out[0])
R["course"] = {"name": mid["name"], "controls": mid["controls"], "length": mid["length"]}
json.dump(R, open(P / "race.json", "w"), indent=1)
