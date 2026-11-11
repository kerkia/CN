"""« Virtually »'s town textures (games/vtown.js), made once from CC0 sources and kept in site/assets/textures/virtually/:
   py town_textures.py <download folder>      (the files below, downloaded as they are; then the WebP files are written)

Sources, all CC0 (public domain dedication; credited all the same in CREDITS.txt beside the textures), Poly Haven, 1k JPG:
  clean_asphalt_diff_1k.jpg            https://polyhaven.com/a/clean_asphalt           2.1 m square, Dimitrios Savva
  square_cobblestone_diff_1k.jpg       https://polyhaven.com/a/square_cobblestone      2.0 m, Sơn Nguyễn
  square_concrete_pavers_diff_1k.jpg   https://polyhaven.com/a/square_concrete_pavers  1.8 m, Amal Kumar
  roof_tiles_diff_1k.jpg               https://polyhaven.com/a/roof_tiles              2.0 m, Stephan Seeliger
  roof_slates_02_diff_1k.jpg           https://polyhaven.com/a/roof_slates_02          3.0 m, Rob Tuytel

What is written: each photo's lightness only (the game's own colours — the aerial photograph's, the roof's — tint it, the photo
gives the grain), around mid-grey (mean 128, the game multiplies by 2), 512 px, one material a channel:
  town-ground.webp   R asphalt, G paving stones (setts), B concrete slabs
  town-roof.webp     R clay tiles, G slates
The sizes the shaders tile them at are vtown.js's (GROUND, ROOF)."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / "site" / "assets" / "textures" / "virtually"


def lum(name, size=512, keep=0.9):
    """The photo's lightness around 128, `keep` of its variation, its slow shading (over a quarter of the tile) taken out."""
    a = np.asarray(Image.open(SRC / name).convert("L").resize((size, size), Image.Resampling.LANCZOS), np.float32)
    from scipy.ndimage import gaussian_filter
    a = a - gaussian_filter(a, size / 4, mode="wrap") + a.mean()
    return np.clip(128 + (a - a.mean()) * keep * 128 / max(a.mean(), 1), 0, 255).astype(np.uint8)


g = np.dstack([lum("clean_asphalt_diff_1k.jpg"), lum("square_cobblestone_diff_1k.jpg"), lum("square_concrete_pavers_diff_1k.jpg")])
Image.fromarray(g, "RGB").save(OUT / "town-ground.webp", quality=88, method=6)
r = np.dstack([lum("roof_tiles_diff_1k.jpg"), lum("roof_slates_02_diff_1k.jpg"), np.full((512, 512), 128, np.uint8)])
Image.fromarray(r, "RGB").save(OUT / "town-roof.webp", quality=88, method=6)
for f in ("town-ground.webp", "town-roof.webp"):
    print(f, round((OUT / f).stat().st_size / 1e3), "KB")
