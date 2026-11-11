"""A « Virtually » race package (build.py, course.py) into R2 cn-state virtual/<race>/, where functions/api/virtual serves it to
the administrators.   py upload.py <race>             the local dev server's R2 (wrangler --local)
                      py upload.py <race> --remote    the live site's R2 (the owner's go-ahead: the maps are their clubs')"""
import os, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
race = sys.argv[1]
where = "--remote" if "--remote" in sys.argv else "--local"
pkg = DATA / race / "pkg"
repo = Path(__file__).resolve().parents[2]
for name in ("race.json", "h.png", "cls.png", "veg.png", "ground.jpg", "feats.json", "trees.bin", "map.ocd", "thumb.webp", "town.json", "town.bin", "surf.png", "facades.webp"):
    f = pkg / name
    if not f.exists():
        continue
    cmd = f'npx wrangler r2 object put "cn-state/virtual/{race}/{name}" {where} --file "{f}"'
    r = subprocess.run(cmd, cwd=repo, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(name, "ok" if r.returncode == 0 else r.stderr.strip()[-300:], flush=True)
