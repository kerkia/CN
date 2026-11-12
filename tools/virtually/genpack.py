"""An invented-terrain race's package from gen.mjs's arrays (owner, 2026-11-12): the pictures the game reads, as build.py writes
them for a club's map — h.png ((h - base) * 100 as R * 256 + G), cls.png, veg.png, ground.jpg —, race.json and feats.json.
  py genpack.py <race>        (DATA/<race>/gen/ in, DATA/<race>/pkg/ out; DATA = paths.DATA_DIR / "virtual", or env VIRTUAL_DATA)"""
import json, os, sys
from pathlib import Path
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
DATA = Path(os.environ.get("VIRTUAL_DATA") or Path(__import__("paths").DATA_DIR) / "virtual")
race = sys.argv[1]
gen, pkg = DATA / race / "gen", DATA / race / "pkg"
pkg.mkdir(parents=True, exist_ok=True)
J = json.loads((gen / "world.json").read_text(encoding="utf-8"))
R = J["race"]; W, H = R["W"], R["H"]
h = np.fromfile(gen / "h.f32", np.float32).reshape(H, W)
base = float(np.floor(h.min())); R["base"] = base
hh = np.clip(np.round((h - base) * 100), 0, 65535).astype(np.uint16)
Image.fromarray(np.dstack([(hh >> 8).astype(np.uint8), (hh & 255).astype(np.uint8), np.zeros_like(hh, np.uint8)]), "RGB").save(pkg / "h.png", optimize=True)
Image.fromarray(np.fromfile(gen / "cls.u8", np.uint8).reshape(H, W), "L").save(pkg / "cls.png", optimize=True)
Image.fromarray(np.fromfile(gen / "veg.u8", np.uint8).reshape(H, W, 3), "RGB").save(pkg / "veg.png", optimize=True)
Image.fromarray(np.fromfile(gen / "ground.u8", np.uint8).reshape(H, W, 4)[..., :3], "RGB").save(pkg / "ground.jpg", quality=88)
(pkg / "feats.json").write_text(json.dumps(J["feats"]), encoding="utf-8")
(pkg / "race.json").write_text(json.dumps(R, indent=1), encoding="utf-8")
print(race, {f.name: f"{f.stat().st_size / 1e6:.1f} MB" for f in sorted(pkg.iterdir())})
