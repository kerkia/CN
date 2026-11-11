"""A town (sprint) race of « Virtually », every step after town_fetch.py:   py town_all.py <race> [--courses] [--from <step>]
map (town_map.py) → ocd (mkocd.mjs) → dump (dump.mjs) → build (build.py) → 3d (town_3d.py) → courses (course_sprint.py, with
--courses or when the package has none). Python: the venv with laspy, shapely, rasterio, scikit-image (see build.py)."""
import json, os, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
race = sys.argv[1]
RD = DATA / race
steps = ["map", "ocd", "dump", "build", "3d", "courses"]
first = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else "map"
py, node = sys.executable, ["node", "--import", "../mapper/shim.mjs"]
CMD = {"map": [py, "town_map.py", race], "ocd": node + ["mkocd.mjs", str(RD / "map_objects.json"), str(RD / "map.ocd")],
       "dump": node + ["dump.mjs", str(RD / "map.ocd"), str(RD / "map.json")], "build": [py, "build.py", race],
       "3d": [py, "town_3d.py", race], "courses": [py, "course_sprint.py", race]}
for s in steps[steps.index(first):]:
    if s == "courses" and "--courses" not in sys.argv:
        r = json.load(open(RD / "pkg" / "race.json"))
        if r.get("courses"):
            continue
    print(f"== {s}", flush=True)
    subprocess.run(CMD[s], cwd=HERE, check=True)
