"""The world's towns and each country's centre, for placing the IOF's World Ranking Events on the Agenda's maps (countries/wre.py;
owner, 2026-11-04: « Australia has no map », « for IOF WRE, a world map »). The IOF's calendar gives a WRE's country and name
only: a town its name gives places it (« Halden O-Meeting », « Swedish League #5 - Middle Norrköping »), else its country's
centre does (an approximate place). Nothing is asked of a geocoding service at run time: this tool makes one table,
countries/places/world.json.gz, committed with the code, from GeoNames' towns of 5 000 people or more (CC BY 4.0,
https://www.geonames.org) and Natural Earth's countries (their label point; public domain).

    python tools/worldplaces.py fetch     # cities5000.zip into $CN_DATA_DIR/geonames (once; Natural Earth by countrymaps.py)
    python tools/worldplaces.py build

The table: { v, source, countries: { cc: { c: [lat, lon], t: { folded name: [lat, lon, population's log10] } } } }, positions
in hundredths of a degree (~1 km); a name met twice in a country keeps its most populous town.
"""
from __future__ import annotations

import gzip
import io
import json
import math
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "countries" / "places" / "world.json.gz"
URL = "https://download.geonames.org/export/dump/cities5000.zip"


def geonames_dir() -> Path:
    import paths
    return Path(paths.DATA_DIR) / "geonames"


def fetch() -> None:
    d = geonames_dir()
    d.mkdir(parents=True, exist_ok=True)
    if not (d / "cities5000.zip").exists():
        print("fetch", URL)
        urllib.request.urlretrieve(URL, d / "cities5000.zip")


def build() -> dict:
    from countries.agenda import fold
    from tools.countrymaps import src_dir, code_of
    out: dict[str, dict] = {}
    with zipfile.ZipFile(geonames_dir() / "cities5000.zip") as z:
        text = z.read("cities5000.txt").decode("utf-8")
    for line in io.StringIO(text):
        f = line.rstrip("\n").split("\t")
        if len(f) < 15:
            continue
        name, ascii_, lat, lon, cc, pop = f[1], f[2], float(f[4]), float(f[5]), f[8], int(f[14] or 0)
        t = out.setdefault(cc, {"t": {}})["t"]
        w = round(math.log10(max(pop, 1)), 1)
        for n in {fold(name), fold(ascii_)}:
            if len(n) >= 3 and (n not in t or t[n][2] < w):
                t[n] = [round(lat * 100), round(lon * 100), w]
    from tools.countrymaps import rings, bbox
    feats = json.loads((src_dir() / "ne_10m_admin_0_countries.geojson").read_text(encoding="utf-8"))["features"]
    # a code borne by several features (France's: Clipperton Island too, in the Pacific — owner, 2026-11-04: « Nationale moyenne
    # distance in France appears in the Pacific ocean »): the largest one's label point
    size = {}
    for ft in feats:
        p, cc = ft["properties"], code_of(ft["properties"])
        if not cc or p.get("LABEL_Y") is None:
            continue
        a = max(((b[2] - b[0]) * (b[3] - b[1]) for b in map(bbox, rings(ft["geometry"]))), default=0)
        if a > size.get(cc, -1):
            size[cc] = a
            out.setdefault(cc, {"t": {}})["c"] = [round(p["LABEL_Y"] * 100), round(p["LABEL_X"] * 100)]
    return {"v": 1, "source": "GeoNames (CC BY 4.0), https://www.geonames.org; Natural Earth (public domain)",
            "countries": {cc: v for cc, v in sorted(out.items()) if v.get("c")}}


def main(argv) -> None:
    if argv and argv[0] == "fetch":
        fetch()
        return
    t = build()
    data = json.dumps(t, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    OUT.write_bytes(gzip.compress(data, 9, mtime=0))
    print(f"{len(t['countries'])} countries, {sum(len(v['t']) for v in t['countries'].values())} names, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1:])
