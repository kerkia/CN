"""Lambert 93 (EPSG:2154, RGF93 on GRS80), both ways: IGN's LiDAR HD tiles are in it. RGF93 and WGS 84 differ by
less than a metre, which a map at 0.42 m a pixel does not need to know."""
from __future__ import annotations

import math

A = 6378137.0
F = 1 / 298.257222101
E2 = F * (2 - F)
E = math.sqrt(E2)
LAT1, LAT2, LAT0, LON0, FE, FN = 44.0, 49.0, 46.5, 3.0, 700000.0, 6600000.0


def _m(p: float) -> float:
    return math.cos(p) / math.sqrt(1 - E2 * math.sin(p) ** 2)


def _t(p: float) -> float:
    return math.tan(math.pi / 4 - p / 2) / ((1 - E * math.sin(p)) / (1 + E * math.sin(p))) ** (E / 2)


_P1, _P2, _P0 = (math.radians(v) for v in (LAT1, LAT2, LAT0))
N = math.log(_m(_P1) / _m(_P2)) / math.log(_t(_P1) / _t(_P2))
_FC = _m(_P1) / (N * _t(_P1) ** N)
_RHO0 = A * _FC * _t(_P0) ** N


def forward(lat: float, lon: float) -> tuple[float, float]:
    """[lat, lon] in degrees -> (X, Y) in metres."""
    rho = A * _FC * _t(math.radians(lat)) ** N
    th = N * math.radians(lon - LON0)
    return FE + rho * math.sin(th), FN + _RHO0 - rho * math.cos(th)


def inverse(x: float, y: float) -> tuple[float, float]:
    """(X, Y) in metres -> (lat, lon) in degrees."""
    dx, dy = x - FE, _RHO0 - (y - FN)
    rho = math.copysign(math.hypot(dx, dy), N)
    tt = (rho / (A * _FC)) ** (1 / N)
    lam = math.atan2(dx, dy) / N + math.radians(LON0)
    phi = math.pi / 2 - 2 * math.atan(tt)
    for _ in range(8):
        phi = math.pi / 2 - 2 * math.atan(tt * ((1 - E * math.sin(phi)) / (1 + E * math.sin(phi))) ** (E / 2))
    return math.degrees(phi), math.degrees(lam)
