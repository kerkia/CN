"""« Virtually »'s photo textures (games/vforest.js), made once from CC0 sources and kept in site/assets/textures/virtually/:
   py textures.py <download folder>          (the files below, downloaded as they are; then the WebP files are written)

Sources, all CC0 (public domain dedication; credited all the same in CREDITS.txt beside the textures):
  Poly Haven  https://polyhaven.com/a/forest_leaves_02  forest_leaves_02_diffuse_1k.jpg, forest_leaves_02_nor_gl_1k.jpg
              https://polyhaven.com/a/forest_ground_04  forest_ground_04_diff_1k.jpg, forest_ground_04_nor_gl_1k.jpg
              https://polyhaven.com/a/bark_brown_02     bark_brown_02_diff_1k.jpg, bark_brown_02_nor_gl_1k.jpg
              https://polyhaven.com/a/lichen_rock       lichen_rock_diff_1k.jpg, lichen_rock_nor_gl_1k.jpg
  ambientCG   https://ambientcg.com/a/LeafSet009, LeafSet010   *_1K-PNG_Color.png, *_1K-PNG_Opacity.png

What is written (the colours normalised around mid-grey per channel, so that the game's own colours — the map's classes, the
biome's trunks and stones — tint them and the photo gives the grain and its variations; the game multiplies by 2):
  ground-litter.webp, ground-litter-n.webp   a deciduous forest's floor, 512 px, and its normal map
  ground-gravel.webp                         a pine forest's or a path's ground, 512 px
  bark.webp, bark-n.webp                     256 × 512
  stone.webp, stone-n.webp                   256 px
  leaves-a.webp, leaves-b.webp               crown cards: a cluster of the photographed leaves (hazel-like, maple), RGBA 512 px
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / "site" / "assets" / "textures" / "virtually"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(11)


def find(name):
    hits = list(SRC.rglob(name))
    if not hits:
        sys.exit(f"missing {name} in {SRC}")
    return hits[0]


def normalised(img: Image.Image, size, keep=0.85) -> Image.Image:
    """The colours around mid-grey per channel (mean 128), `keep` of the photo's own colour variation kept."""
    a = np.asarray(img.convert("RGB").resize(size, Image.Resampling.LANCZOS), np.float32)
    mean = a.reshape(-1, 3).mean(0)
    lum = a.mean(2, keepdims=True)
    b = a / mean * 128
    b = lum / lum.mean() * 128 * (1 - keep) + b * keep
    return Image.fromarray(np.clip(b, 0, 255).astype(np.uint8))


def save(img, name, q=82):
    img.save(OUT / name, quality=q, method=6)
    print(name, img.size, f"{(OUT / name).stat().st_size / 1024:.0f} KB")


save(normalised(Image.open(find("forest_leaves_02_diffuse_1k.jpg")), (512, 512)), "ground-litter.webp")
save(Image.open(find("forest_leaves_02_nor_gl_1k.jpg")).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS), "ground-litter-n.webp", 88)
save(normalised(Image.open(find("forest_ground_04_diff_1k.jpg")), (512, 512)), "ground-gravel.webp")
save(normalised(Image.open(find("bark_brown_02_diff_1k.jpg")), (256, 512), 0.6), "bark.webp")
save(Image.open(find("bark_brown_02_nor_gl_1k.jpg")).convert("RGB").resize((256, 512), Image.Resampling.LANCZOS), "bark-n.webp", 88)
save(normalised(Image.open(find("lichen_rock_diff_1k.jpg")), (256, 256), 0.9), "stone.webp")
save(Image.open(find("lichen_rock_nor_gl_1k.jpg")).convert("RGB").resize((256, 256), Image.Resampling.LANCZOS), "stone-n.webp", 88)


def leaves(set_id: str):
    """Each photographed leaf cut out by its opacity's connected parts."""
    c = np.asarray(Image.open(find(f"{set_id}_1K-PNG_Color.png")).convert("RGB"))
    o = np.asarray(Image.open(find(f"{set_id}_1K-PNG_Opacity.png")).convert("L"))
    lab, n = ndimage.label(o > 128)
    out = []
    for k, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or (sl[0].stop - sl[0].start) < 40:
            continue
        rgba = np.dstack([c[sl], np.where(lab[sl] == k, o[sl], 0)])
        out.append(Image.fromarray(rgba.astype(np.uint8), "RGBA"))
    return out


def cluster(set_id: str, name: str, n=1500, S=512):
    """A crown card: the leaves strewn over a cluster, denser and darker inside, sprigs reaching out from it so that its outline
    is ragged (a round card's edge shows), each leaf turned and shaded a little; the colours then brought toward grey (the game
    tints by the instance's colour) with some of the photo's hues kept."""
    src = leaves(set_id)
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sprigs = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.36, 0.48) * S) for _ in range(16)]
    for i in range(n):
        if i % 10 < 6:                                                       # the core, thinning toward its edge
            a = rng.uniform(0, 2 * np.pi); d = rng.uniform() ** 0.7 * 0.3 * S
        else:                                                                # along a sprig, out to its tip
            a0, L = sprigs[rng.integers(len(sprigs))]; t = rng.uniform() ** 0.8
            a = a0 + rng.normal(0, 0.18) * (1.2 - t); d = 0.12 * S + t * (L - 0.12 * S)
        x, y = S / 2 + np.cos(a) * d, S / 2 + np.sin(a) * d * 0.95
        leaf = src[rng.integers(len(src))]
        size = rng.uniform(20, 36) * (1.0 if d > 0.2 * S else 0.9)
        k = size / max(leaf.size)
        im = leaf.resize((max(2, int(leaf.width * k)), max(2, int(leaf.height * k))), Image.Resampling.LANCZOS)
        im = im.rotate(rng.uniform(0, 360), expand=True, resample=Image.Resampling.BICUBIC)
        arr = np.asarray(im, np.float32)
        shade = 0.62 + 0.5 * (d / (0.45 * S)) + rng.uniform(-0.12, 0.12)       # inner leaves in their neighbours' shade
        arr[..., :3] *= min(1.15, shade)
        im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        canvas.alpha_composite(im, (int(x - im.width / 2), int(y - im.height / 2)))
    a = np.asarray(canvas, np.float32)
    rgb, al = a[..., :3], a[..., 3:]
    m = al[..., 0] > 128
    mean = rgb[m].mean(0)
    lum = rgb.mean(2, keepdims=True)
    g = (lum / lum[m].mean() * 150) * 0.75 + (rgb / mean * 150) * 0.25             # grey with a quarter of the leaves' hues
    # the colour carried into the transparent pixels (their mean over the leaves near them): no dark fringe in the mipmaps
    w = ndimage.gaussian_filter((al[..., 0] > 0).astype(np.float32), 6) + 1e-4
    fill = np.dstack([ndimage.gaussian_filter(g[..., c] * (al[..., 0] > 0), 6) / w for c in range(3)])
    g = np.where(al > 0, g, fill)
    out = np.dstack([np.clip(g, 0, 255), al]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    img.save(OUT / name, quality=85, method=6)
    print(name, img.size, f"{(OUT / name).stat().st_size / 1024:.0f} KB")


cluster("LeafSet009", "leaves-a.webp")
cluster("LeafSet010", "leaves-b.webp")
(OUT / "CREDITS.txt").write_text(
    "Virtually's photo textures (games/vforest.js), made by tools/virtually/textures.py from CC0 sources (public domain):\n"
    "  ground-litter*: Poly Haven, forest_leaves_02 (https://polyhaven.com/a/forest_leaves_02)\n"
    "  ground-gravel: Poly Haven, forest_ground_04 (https://polyhaven.com/a/forest_ground_04)\n"
    "  bark*: Poly Haven, bark_brown_02 (https://polyhaven.com/a/bark_brown_02)\n"
    "  stone*: Poly Haven, lichen_rock (https://polyhaven.com/a/lichen_rock)\n"
    "  leaves-a, leaves-b: clusters of ambientCG's LeafSet009 and LeafSet010 (https://ambientcg.com, CC0)\n"
    "Poly Haven and ambientCG license their assets CC0 1.0 Universal; no attribution is required, it is given with thanks.\n",
    encoding="utf-8")
total = sum(f.stat().st_size for f in OUT.glob("*.webp"))
print(f"total {total / 1e6:.2f} MB")
