"""The sports grounds of a town race, for town_3d.py: each pitch's playing surface, its markings at the rules' sizes fitted to the
pitch's outline, its goals, posts and nets — from src/sports.json (town_map.py: OpenStreetMap's pitches and tracks with their sport
and surface, BD TOPO's « terrains de sport » where OSM has none).

layout(polys_world, sport, surface) → {"surface", "g", "regions", "lines", "stripes", "props", "walls"}, in the world frame (metres):
- regions: the parts painted each in its own clean colour (a tennis court and its run-off);
- lines: the markings (one geometry), white;
- stripes: the frame (centre, u, v, length) a grass pitch's mowing stripes run across;
- props: [kind, x, z, angle] for vtown.js (goal, rugby, citygoal; pole, rpole: a post that stops the runner, not drawn);
- walls: {"pts", "kind": "net", "h", "imp"} (a goal's net, a tennis net).
The sizes: football (IFAB Law 1), rugby union (World Rugby Law 1: in-goal 6-22 m, the field's lines scaled when it is short of
100 m), tennis (ITF: 23.77 × 10.97 m, the net posts 0.914 m outside the doubles lines), athletics (lanes 1.22 m from the kerb)."""
import math

import numpy as np
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union


def frame(g):
    """centre, u (along the long side), v (across), length, width: the outline's minimum rotated rectangle."""
    c = np.array(g.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    if np.hypot(*e1) < np.hypot(*e2):
        e1, e2 = e2, e1
    L, Wd = float(np.hypot(*e1)), float(np.hypot(*e2))
    u = e1 / L
    return c.mean(axis=0), u, np.array([-u[1], u[0]]), L, Wd


def world(geom, F):
    ctr, u, v = F[0], F[1], F[2]
    return affinity.affine_transform(geom, [u[0], v[0], u[1], v[1], ctr[0], ctr[1]])


def wpt(F, s, t):
    return F[0] + s * F[1] + t * F[2]


def seg(a, b, w):
    return LineString([a, b]).buffer(w / 2, cap_style="flat")


def rect(x0, y0, x1, y1, w):
    return box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)).boundary.buffer(w / 2, cap_style="flat", join_style="mitre")


def ring(cx, cy, r, w):
    return Point(cx, cy).buffer(r + w / 2, 64).difference(Point(cx, cy).buffer(r - w / 2, 64))


def dashed(a, b, w, dash=1.0, gap=1.0):
    a, b = np.asarray(a, float), np.asarray(b, float); L = float(np.hypot(*(b - a))); d = (b - a) / max(L, 1e-9)
    return unary_union([seg(a + d * s, a + d * min(L, s + dash), w) for s in np.arange(0, L, dash + gap)])


def facing(F, s, t, toward=(0.0, 0.0)):
    """A prop's angle so that its +z faces the local point `toward` (vtown.js turns a prop by −angle about the vertical)."""
    p, q = wpt(F, s, t), wpt(F, *toward)
    return round(-math.degrees(math.atan2(q[0] - p[0], q[1] - p[1])), 1)


def net(F, pts, h):
    return {"pts": [[round(float(x), 2), round(float(z), 2)] for x, z in (wpt(F, s, t) for s, t in pts)], "kind": "net", "h": h, "imp": True}


def soccer(F):
    L, Wd = F[3], F[4]; hl, hw = L / 2, Wd / 2; w = 0.12
    k = min(1.0, L / 100)                                              # a youth pitch: its areas in proportion
    pa, pw, ga, gw_, ps, cr = 16.5 * k, 20.16 * k, 5.5 * k, 9.16 * k, 11 * k, 9.15 * k
    parts = [rect(-hl + w / 2, -hw + w / 2, hl - w / 2, hw - w / 2, w), seg((0, -hw), (0, hw), w), ring(0, 0, cr, w), Point(0, 0).buffer(0.15)]
    props, walls = [], []
    gwid = 7.32 * max(k, 0.68) / 2                                   # 7.32 m, 5 m on a small pitch
    for sg in (-1, 1):
        x = sg * hl
        parts += [rect(x, -pw, x - sg * pa, pw, w), rect(x, -gw_, x - sg * ga, gw_, w), Point(x - sg * ps, 0).buffer(0.12)]
        arc = ring(x - sg * ps, 0, cr, w).difference(box(min(x, x - sg * pa), -hw, max(x, x - sg * pa), hw))
        parts.append(arc)
        for yc in (-hw, hw):                                           # corner arcs, 1 m
            parts.append(ring(x, yc, 1.0, w).intersection(box(-hl, -hw, hl, hw)))
        props.append(["goal" if k >= 0.9 else "goal5", *map(lambda c: round(float(c), 2), wpt(F, x, 0)), facing(F, x, 0)])
        props += [["pole", *map(lambda c: round(float(c), 2), wpt(F, x, y)), 0] for y in (-gwid, gwid)]
        d = sg * 1.6                                                   # the net: 1.6 m deep behind the goal line
        walls.append(net(F, [(x, -gwid), (x + d, -gwid), (x + d, gwid), (x, gwid)], 1.9))
    return unary_union(parts), props, walls


def rugby(F):
    L, Wd = F[3], F[4]; hl, hw = L / 2, Wd / 2; w = 0.12
    ing = min(22.0, max(5.0, (L - 100) / 2))                           # in-goal: what the length leaves beyond 100 m
    f = L - 2 * ing; s = f / 100; tl = f / 2
    parts = [rect(-hl + w / 2, -hw + w / 2, hl - w / 2, hw - w / 2, w), seg((0, -hw), (0, hw), w)]
    props = []
    for sg in (-1, 1):
        parts += [seg((sg * tl, -hw), (sg * tl, hw), w), seg((sg * (tl - 22 * s), -hw), (sg * (tl - 22 * s), hw), w),
                  dashed((sg * 10 * s, -hw), (sg * 10 * s, hw), w, 2, 1.5), dashed((sg * (tl - 5 * s), -hw + 5), (sg * (tl - 5 * s), hw - 5), w, 1, 1.5)]
        for yy in ([hw - 5, hw - 15] if Wd >= 40 else [hw - 5]):
            for y in (-yy, yy):
                parts.append(dashed((-tl + 5 * s, y), (tl - 5 * s, y), w, 1, 2))
        props.append(["rugby", *map(lambda c: round(float(c), 2), wpt(F, sg * tl, 0)), facing(F, sg * tl, 0)])
        props += [["rpole", *map(lambda c: round(float(c), 2), wpt(F, sg * tl, y)), 0] for y in (-2.8, 2.8)]
    return unary_union(parts), props, []


TEN_L, TEN_W, TEN_S = 23.77 / 2, 10.97 / 2, 8.23 / 2


def tennis(F):
    w = 0.05
    parts = [rect(-TEN_L, -TEN_W, TEN_L, TEN_W, w), seg((-TEN_L, -TEN_S), (TEN_L, -TEN_S), w), seg((-TEN_L, TEN_S), (TEN_L, TEN_S), w),
             seg((-6.40, -TEN_S), (-6.40, TEN_S), w), seg((6.40, -TEN_S), (6.40, TEN_S), w), seg((-6.40, 0), (6.40, 0), w),
             seg((-TEN_L, 0), (-TEN_L + 0.1, 0), w), seg((TEN_L - 0.1, 0), (TEN_L, 0), w)]
    parts += [seg((-TEN_L, y), (-TEN_L - 0.05, y), 0.1) for y in (-TEN_W, TEN_W)]   # the baselines up to 0.1 m wide
    return unary_union(parts), [], [net(F, [(0, -6.4), (0, 6.4)], 1.0)]


def multi(F):
    L, Wd = F[3], F[4]; hl, hw = L / 2 - 0.6, Wd / 2 - 0.6; w = 0.08
    parts = [rect(-hl, -hw, hl, hw, w), seg((0, -hw), (0, hw), w), ring(0, 0, 3.0, w)]
    props = []
    for sg in (-1, 1):
        parts.append(ring(sg * hl, 0, 6.0, w).intersection(box(-hl, -hw, hl, hw)))
        props.append(["citygoal", *map(lambda c: round(float(c), 2), wpt(F, sg * hl, 0)), facing(F, sg * hl, 0)])
        props += [["pole", *map(lambda c: round(float(c), 2), wpt(F, sg * hl, y)), 0] for y in (-1.5, 1.5)]
    return unary_union(parts), props, []


def athletics(g):
    """The track: a ring (its kerb the inner edge), lanes every 1.22 m, the finish line where the home straight meets the bend."""
    p = max(getattr(g, "geoms", [g]), key=lambda q: q.area)
    if not p.interiors:
        return None, [], []
    inner = Polygon(p.interiors[0]); ring_w = p.area / ((p.exterior.length + inner.exterior.length) / 2)
    n = int((ring_w - 0.1) // 1.22)
    w = 0.05
    parts = []
    for k in range(n + 1):
        d = 0.05 + k * 1.22
        parts.append(inner.buffer(d + w / 2, 64).difference(inner.buffer(d - w / 2, 64)))
    lines = unary_union(parts).intersection(p.buffer(0.01))
    F = frame(inner); sh = (F[3] - F[4]) / 2                          # the straights' half length
    fin = world(seg((sh, F[4] / 2), (sh, F[4] / 2 + 0.05 + n * 1.22), w * 2), F)
    return unary_union([lines, fin.intersection(p)]), [], []


def layout(g, sport, surface):
    """g: the outline (a shapely polygon, world metres). See the module's text."""
    out = {"surface": surface, "g": g, "regions": [g], "lines": None, "stripes": None, "props": [], "walls": []}
    if sport == "athletics":
        out["lines"], _, _ = athletics(g)
        return out
    F = frame(g)
    if sport == "soccer" and F[3] > 40:
        lines, out["props"], out["walls"] = soccer(F)
    elif sport == "rugby" and F[3] > 50:
        lines, out["props"], out["walls"] = rugby(F)
    elif sport == "tennis" and 26 < F[3] < 45 and 12 < F[4] < 24:
        lines, out["props"], out["walls"] = tennis(F)
        court = world(box(-TEN_L, -TEN_W, TEN_L, TEN_W), F)
        out["regions"] = [court.intersection(g), g.difference(court)]
    elif sport in ("multi", "basketball", "handball") and F[3] > 15:
        lines, out["props"], out["walls"] = multi(F)
    else:
        return out
    out["lines"] = world(lines, F).intersection(g.buffer(2.5))
    if surface == "grass":
        out["stripes"] = F
    return out
