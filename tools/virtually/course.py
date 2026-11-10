"""Propose a course on a « Virtually » race's map (build.py first): py course.py <race> <controls> <target km> [seed]
Control sites on distinct point features; start and finish beside a track or a path; legs 150-450 m, no dog-legs, no crossing
legs, controls 80 m apart at least, nothing in impassable or very slow ground, the start not given away by the first control's
direction. Writes the course into pkg/race.json and a review picture (classes, contours, features, course)."""
import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

race_id, NC, KM = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 7
import os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
P = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual") / race_id / "pkg"
R = json.load(open(P / "race.json")); F = json.load(open(P / "feats.json"))
cls = np.array(Image.open(P / "cls.png")); H, W = cls.shape
CL = R["classes"]; C = {n: i for i, n in enumerate(CL)}
speed = np.array(R["speed"], np.float32)[cls]
bad = speed < 0.35
near_bad = distance_transform_edt(~bad) < 8
pathy = np.isin(cls, [C[k] for k in ("path", "track", "road", "small_path")])
rng = np.random.default_rng(seed)
GOOD = {"boulder": 1.0, "bigboulder": 1.3, "cluster": 1.0, "knoll": 1.2, "eknoll": 1.1, "depression": 1.2, "pit": 1.0,
        "rockpit": 1.0, "rockface": 1.2, "cairn": 0.9, "mini": 1.0, "vegspec": 0.8, "bigtree": 0.9, "manmade": 0.9, "tower": 0.8,
        "waterhole": 1.0, "cave": 1.0, "landform": 0.8}
cand = []
for f in F["features"]:
    x, z = f["x"], f["z"]
    if not (60 < x < W - 60 and 60 < z < H - 60):
        continue
    if near_bad[int(z), int(x)] or speed[int(z), int(x)] < 0.6 or cls[int(z), int(x)] == C["outside"]:
        continue
    cand.append((x, z, f["k"], GOOD.get(f["k"], 0.7)))
# keep sites distinct: a feature with another of its kind within 12 m is ambiguous
xy = np.array([[c[0], c[1]] for c in cand])
from scipy.spatial import cKDTree
kd = cKDTree(xy)
cand = [c for i, c in enumerate(cand) if sum(1 for j in kd.query_ball_point(xy[i], 12) if j != i and cand[j][2] == c[2]) == 0]
xy = np.array([[c[0], c[1]] for c in cand])
print(race_id, "candidate sites", len(cand))
# start: a path or track cell with room around, near the middle of the map's west or south side
pr, pc = np.nonzero(pathy & ~near_bad & (distance_transform_edt(cls != C["outside"]) > 250))
starts = np.c_[pc, pr][rng.choice(len(pr), size=min(300, len(pr)), replace=False)] if len(pr) else np.array([[W / 2, H / 2]])


def seg_cross(a, b, c, d):
    def o(p, q, r):
        return np.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
    return o(a, b, c) != o(a, b, d) and o(c, d, a) != o(c, d, b)


def seg_dist(a, b, c, d):
    """Least distance between segments ab and cd."""
    def pd(p, q, r):
        qx, qy = r[0] - q[0], r[1] - q[1]; L = qx * qx + qy * qy
        t = 0 if L == 0 else max(0, min(1, ((p[0] - q[0]) * qx + (p[1] - q[1]) * qy) / L))
        return math.hypot(p[0] - q[0] - t * qx, p[1] - q[1] - t * qy)
    if seg_cross(a, b, c, d):
        return 0.0
    return min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b))


def line_cost(a, b):
    """Share of the straight line on impassable ground, and on slow ground (route choice hint)."""
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    xs = np.linspace(a[0], b[0], n).astype(int); zs = np.linspace(a[1], b[1], n).astype(int)
    s = speed[zs, xs]
    return float((s < 0.05).mean()), float((s < 0.6).mean())


def build():
    s = starts[rng.integers(len(starts))]
    pts = [(float(s[0]), float(s[1]))]; used = set(); kinds = []; score = 0.0
    for k in range(NC):
        last = pts[-1]
        d = np.hypot(xy[:, 0] - last[0], xy[:, 1] - last[1])
        ok = np.where((d > 180) & (d < 480))[0]
        rng.shuffle(ok)
        chosen = None
        for i in ok[:200]:
            if i in used:
                continue
            p = (xy[i, 0], xy[i, 1])
            if any(math.hypot(p[0] - q[0], p[1] - q[1]) < 80 for q in pts[1:]):
                continue
            if len(pts) >= 2:
                a1 = math.atan2(last[1] - pts[-2][1], last[0] - pts[-2][0]); a2 = math.atan2(p[1] - last[1], p[0] - last[0])
                turn = abs((a2 - a1 + math.pi) % (2 * math.pi) - math.pi)
                if turn > math.radians(150):
                    continue                                      # a dog-leg
            if any(seg_dist(last, p, pts[j], pts[j + 1]) < 45 for j in range(len(pts) - 2)):
                continue
            imp, slow = line_cost(last, p)
            if imp > 0.25:
                continue
            chosen = (i, p, imp, slow); break
        if chosen is None:
            return None
        i, p, imp, slow = chosen
        used.add(i); pts.append(p); kinds.append(cand[i][2])
        score += cand[i][3] + 0.8 * min(slow, 0.5) + 0.6 * imp
    # finish: near the start, after the last control, no crossing
    fin = None
    for _ in range(80):
        a = rng.uniform(0, 2 * math.pi); r = rng.uniform(40, 120)
        q = (pts[0][0] + r * math.cos(a), pts[0][1] + r * math.sin(a))
        if not (0 < q[0] < W and 0 < q[1] < H) or speed[int(q[1]), int(q[0])] < 0.6:
            continue
        L = math.hypot(q[0] - pts[-1][0], q[1] - pts[-1][1])
        if 80 < L < 450 and not any(seg_dist(pts[-1], q, pts[j], pts[j + 1]) < 30 for j in range(1, len(pts) - 2)):
            fin = q; break
    if fin is None:
        return None
    allp = pts + [fin]
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(allp, allp[1:]))
    legs = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(allp, allp[1:])]
    span = (max(p[0] for p in allp) - min(p[0] for p in allp)) * (max(p[1] for p in allp) - min(p[1] for p in allp))
    score += 2.0 * len(set(kinds)) / len(kinds) - 6 * abs(length / 1000 - KM) - 0.002 * np.std(legs[1:-1]) + 4 * span / 1e6
    # the first leg should not head straight off along the start's path (a decision from the first step)
    return score, allp, kinds, length


best = None
for it in range(40000):
    r = build()
    if r and (best is None or r[0] > best[0]):
        best = r
score, allp, kinds, length = best
print(f"course: {len(allp) - 2} controls, {length / 1000:.2f} km, score {score:.2f}, kinds {kinds}")
codes = list(range(31, 31 + len(kinds)))
rng.shuffle(codes)
course = [{"kind": "start", "x": round(allp[0][0], 1), "z": round(allp[0][1], 1)}]
for (x, z), k, code in zip(allp[1:-1], kinds, codes):
    course.append({"kind": "control", "x": round(x, 1), "z": round(z, 1), "code": str(code), "feature": k})
course.append({"kind": "finish", "x": round(allp[-1][0], 1), "z": round(allp[-1][1], 1)})
R["course"] = {"name": {"granites": "Granites", "foley": "Foley"}.get(race_id, race_id), "controls": course, "length": round(length)}
json.dump(R, open(P / "race.json", "w"), indent=1)
# review picture
pal = np.array([[235, 240, 228], [255, 222, 130], [250, 215, 130], [245, 205, 150], [235, 200, 145], [180, 225, 160], [195, 235, 175],
                [110, 195, 110], [150, 215, 140], [50, 150, 70], [160, 160, 160], [130, 130, 130], [40, 40, 40], [230, 150, 90],
                [80, 80, 80], [190, 190, 180], [150, 150, 140], [90, 160, 230], [210, 150, 90], [130, 190, 210], [70, 140, 200],
                [120, 180, 220], [20, 20, 20], [200, 40, 120], [230, 230, 120], [80, 150, 230], [60, 60, 60], [250, 250, 250],
                [10, 10, 10], [220, 170, 110]], np.uint8)
img = Image.fromarray(pal[np.minimum(cls, len(pal) - 1)]).convert("RGB")
dr = ImageDraw.Draw(img)
for f in F["features"]:
    dr.point((f["x"], f["z"]), fill=(0, 0, 0))
for a, b in zip(allp, allp[1:]):
    dr.line([a, b], fill=(200, 0, 160), width=3)
for i, (x, z) in enumerate(allp):
    r = 18
    if i == 0:
        dr.polygon([(x, z - 22), (x - 19, z + 11), (x + 19, z + 11)], outline=(200, 0, 160), width=3)
    else:
        dr.ellipse([x - r, z - r, x + r, z + r], outline=(200, 0, 160), width=3)
        if i < len(allp) - 1:
            dr.text((x + 20, z - 20), str(i), fill=(200, 0, 160))
img.save(P.parent / "course_review.png")
