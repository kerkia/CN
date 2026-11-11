"""The organiser's own courses (coursefile.mjs's JSON, in the map's mm) into a built « Virtually » package's race.json, in its world
frame:   py filecourses.py <race> <courses.json>
Each course keeps its name and control codes; a control's feature is the package's nearest point feature within 10 m (the
game's description line), else none. Length = the straight legs', climb = the ground's rises along them (course.py's way)."""
import json, math, os, re, sys, unicodedata
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
race_id, src = sys.argv[1], sys.argv[2]
P = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual") / race_id / "pkg"
R = json.load(open(P / "race.json")); F = json.load(open(P / "feats.json"))
hp = np.array(Image.open(P / "h.png").convert("RGB")).astype(np.float32)
height = R["base"] + (hp[..., 0] * 256 + hp[..., 1]) / 100.0
H, W = height.shape
X0, Y1 = R["mm0"]; K = R["k"]
feats = F.get("features", [])
fxy = np.array([[f["x"], f["z"]] for f in feats]) if feats else np.zeros((0, 2))


def slug(name, used):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:20] or "c"
    k, n = s, 2
    while k in used:
        k = f"{s[:17]}_{n}"; n += 1
    used.add(k)
    return k


def climb(a, b):
    n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 2))
    xs = np.clip(np.linspace(a[0], b[0], n).astype(int), 0, W - 1); zs = np.clip(np.linspace(a[1], b[1], n).astype(int), 0, H - 1)
    h = height[zs, xs]
    return float(np.clip(np.diff(h), 0, None).sum())


used, courses = set(), []
for co in json.load(open(src, encoding="utf-8"))["courses"]:
    ctl = []
    for c in co["controls"]:
        x, z = (c["x"] - X0) * K, (Y1 - c["y"]) * K
        if not (0 <= x < W and 0 <= z < H):
            ctl = None; break
        e = {"kind": c["kind"], "x": round(x, 1), "z": round(z, 1)}
        if c["kind"] == "control":
            e["code"] = str(c["code"])
            if len(fxy):
                d = np.hypot(fxy[:, 0] - x, fxy[:, 1] - z); i = int(np.argmin(d))
                if d[i] < 10:
                    e["feature"] = feats[i]["k"]
        ctl.append(e)
    if not ctl:
        print("left out (off the map):", co["name"]); continue
    pts = [(c["x"], c["z"]) for c in ctl]
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
    up = sum(climb(a, b) for a, b in zip(pts, pts[1:]))
    courses.append({"id": slug(co["name"], used), "name": co["name"], "controls": ctl, "length": round(length), "climb": int(round(up / 5.0) * 5)})
R["courses"] = courses
json.dump(R, open(P / "race.json", "w"), indent=1)
print(len(courses), "courses:", ", ".join(f"{c['name']} {c['length']} m" for c in courses))
