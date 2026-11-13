"""Pixel's terrain texture library (games/vforest.js TEXTURE_SETS): textures by kind of ground, rock, bark and plant, made once
from CC0 sources and kept in site/assets/textures/virtually/, which a race's biome picks as a set (biome « textures »):
   py texsets.py <download folder>     (the files below, downloaded as they are; then the WebP files are written)

Owner, 2026-11-13: « photos, like for Sprint, to much improve the scene textures… a general solution for more realistic scenes in
forest? » — the first set is « sandpine », Fontainebleau's: sand under pine needles, white sand on the paths, grey sandstone
boulders, Scots pine bark, pine needle sprays, oak leaves. The kinds are files of their own, so another set
(another massif) takes the ones that fit and adds its own.

Sources, all CC0 (public domain dedication; credited all the same in CREDITS.txt beside the textures):
  Poly Haven  https://polyhaven.com/a/forrest_sand_01   forrest_sand_01_diff_1k.jpg, _nor_gl_1k.jpg    sand under pine needles
              https://polyhaven.com/a/sand_01           sand_01_diff_1k.jpg                           trampled light sand
              https://polyhaven.com/a/rock_boulder_dry  rock_boulder_dry_diff_1k.jpg, _nor_gl_1k.jpg  a weathered grey boulder
              https://polyhaven.com/a/pine_bark         pine_bark_diff_1k.jpg, _nor_gl_1k.jpg         Scots pine bark
  ambientCG   https://ambientcg.com/a/PineNeedles001     PineNeedles001_1K-PNG_Color.png, _Opacity.png  pine needle pairs
              https://ambientcg.com/a/LeafSet016         LeafSet016_1K-PNG_Color.png, _Opacity.png      oak leaves

Each photo's colours are normalised around mid-grey (the game's own colours tint them: the map's classes, the biome's trunks,
leaves and plants; the game multiplies by 2), the cards' colour carried into their transparent pixels (no dark mipmap fringes).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / "site" / "assets" / "textures" / "virtually"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(13)


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


def normal(src, name, size):
    save(Image.open(find(src)).convert("RGB").resize(size, Image.Resampling.LANCZOS), name, 88)


def cutouts(set_id: str, min_px=30):
    """Each photographed piece (a leaf, a blade, a needle pair) cut out by its opacity's connected parts, RGBA."""
    c = np.asarray(Image.open(find(f"{set_id}_1K-PNG_Color.png")).convert("RGB"))
    o = np.asarray(Image.open(find(f"{set_id}_1K-PNG_Opacity.png")).convert("L"))
    lab, n = ndimage.label(o > 100)
    out = []
    for k, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) < min_px:
            continue
        rgba = np.dstack([c[sl], np.where(lab[sl] == k, o[sl], 0)])
        out.append(Image.fromarray(rgba.astype(np.uint8), "RGBA"))
    return out


def finish(card: Image.Image, keep=0.3, mean=128) -> Image.Image:
    """A card's colours toward grey around `mean` (the game tints it), some of the photo's hues kept, and its colour carried into
    the transparent pixels (the mipmaps then blend toward the card's own colour, not black)."""
    a = np.asarray(card, np.float32)
    rgb, al = a[..., :3], a[..., 3]
    m = al > 20
    if m.any():
        mu = rgb[m].mean(0)
        lum = rgb.mean(2, keepdims=True)
        rgb = (lum / max(1, lum[m].mean()) * mean) * (1 - keep) + (rgb / mu * mean) * keep
        # carry the colours outward: the nearest opaque pixel's colour, then blurred a little
        idx = ndimage.distance_transform_edt(~m, return_distances=False, return_indices=True)
        rgb = rgb[idx[0], idx[1]]
        rgb = ndimage.gaussian_filter(rgb, (1, 1, 0)) * (~m[..., None]) + rgb * m[..., None]
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype(np.uint8), "RGBA")


def paste_rot(dst: Image.Image, piece: Image.Image, x, y, ang, scale, shade=1.0, anchor=(0.5, 1.0)):
    """A piece turned by `ang` degrees about its anchor (default its base) and pasted with that anchor at (x, y)."""
    w, h = piece.size
    p = piece.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    if shade != 1.0:
        a = np.asarray(p, np.float32); a[..., :3] *= shade; p = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    ax, ay = anchor[0] * p.width, anchor[1] * p.height
    big = Image.new("RGBA", (p.width * 3, p.height * 3), (0, 0, 0, 0))
    big.paste(p, (p.width, p.height))
    r = big.rotate(ang, resample=Image.Resampling.BICUBIC, center=(p.width + ax, p.height + ay))
    dst.alpha_composite(r, (int(x - p.width - ax), int(y - p.height - ay)))


# ---- ground, rock, bark -------------------------------------------------------------------------------------------------------
save(normalised(Image.open(find("forrest_sand_01_diff_1k.jpg")), (512, 512)), "sandpine-litter.webp")
normal("forrest_sand_01_nor_gl_1k.jpg", "sandpine-litter-n.webp", (512, 512))
save(normalised(Image.open(find("sand_01_diff_1k.jpg")), (512, 512), 0.7), "sand.webp")
save(normalised(Image.open(find("rock_boulder_dry_diff_1k.jpg")), (512, 512), 0.8), "sandstone.webp")
normal("rock_boulder_dry_nor_gl_1k.jpg", "sandstone-n.webp", (512, 512))
save(normalised(Image.open(find("pine_bark_diff_1k.jpg")), (256, 512), 0.75), "pine-bark.webp")
normal("pine_bark_nor_gl_1k.jpg", "pine-bark-n.webp", (256, 512))


# ---- cards ----------------------------------------------------------------------------------------------------------------
def needle_spray(S=512):
    """A Scots pine's branch seen from the side, as the drawn needle card: shoots along a drooping stem on either side of the
    middle, each a brush of the photographed needle pairs, denser and darker toward the stem."""
    pairs = cutouts("PineNeedles001", 40)
    card = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    for b in range(7):
        y0 = S * (0.18 + b * 0.105); side = 1 if b % 2 else -1
        x, y = S / 2, y0
        length = S * (0.44 - abs(b - 3) * 0.035)
        for s in range(10):
            nx, ny = x + side * length / 10, y + s * 1.2
            d.line([(x, y), (nx, ny)], fill=(70, 58, 44, 255), width=max(1, int(4 - s * 0.3)))
            for k in range(14):
                t = rng.random(); px, py = x + (nx - x) * t, y + (ny - y) * t
                p = pairs[rng.integers(len(pairs))]
                ang = rng.uniform(-60, 60) + (25 if side > 0 else -25) + (90 if rng.random() < 0.5 else -90)
                paste_rot(card, p, px, py, ang, 0.36 * rng.uniform(0.75, 1.1) * (1 - s * 0.03) * S / 512, shade=rng.uniform(0.55, 1.0), anchor=(0.0, 0.5))
            x, y = nx, ny
    return finish(card, keep=0.15)


def leaf_cluster(set_id, n=1500, S=512):
    """A crown card of photographed leaves (textures.py's clusters: a core thinning to its edge and sprigs reaching out, the
    leaves 20-36 px, inner ones in shade; grey around 150, as the game's leaf gain expects)."""
    src = cutouts(set_id, 40)
    card = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sprigs = [(rng.uniform(0, 2 * np.pi), rng.uniform(0.36, 0.48) * S) for _ in range(16)]
    for i in range(n):
        if i % 10 < 6:
            a = rng.uniform(0, 2 * np.pi); d = rng.uniform() ** 0.7 * 0.3 * S
        else:
            a0, L = sprigs[rng.integers(len(sprigs))]; t = rng.uniform() ** 0.8
            a = a0 + rng.normal(0, 0.18) * (1.2 - t); d = 0.12 * S + t * (L - 0.12 * S)
        x, y = S / 2 + np.cos(a) * d, S / 2 + np.sin(a) * d * 0.95
        p = src[rng.integers(len(src))]
        size = rng.uniform(20, 36) * (1.0 if d > 0.2 * S else 0.9)
        shade = min(1.15, 0.62 + 0.5 * (d / (0.45 * S)) + rng.uniform(-0.12, 0.12))
        paste_rot(card, p, x, y, rng.uniform(0, 360), size / max(p.size), shade=shade, anchor=(0.5, 0.5))
    return finish(card, keep=0.25, mean=150)


save(needle_spray(), "needles.webp", 76)
save(leaf_cluster("LeafSet016"), "oak-leaves.webp", 85)

# ---- credits: this script's block of CREDITS.txt (textures.py and town_textures.py write theirs) -----------------------------------
BLOCK = ("Pixel's terrain texture sets (games/vforest.js TEXTURE_SETS), made by tools/virtually/texsets.py from CC0 sources (public domain):\n"
         "  sandpine-litter*: Poly Haven, forrest_sand_01 (https://polyhaven.com/a/forrest_sand_01)\n"
         "  sand: Poly Haven, sand_01 (https://polyhaven.com/a/sand_01)\n"
         "  sandstone*: Poly Haven, rock_boulder_dry (https://polyhaven.com/a/rock_boulder_dry)\n"
         "  pine-bark*: Poly Haven, pine_bark (https://polyhaven.com/a/pine_bark)\n"
         "  needles: sprays of ambientCG's PineNeedles001 (https://ambientcg.com/a/PineNeedles001)\n"
         "  oak-leaves: a cluster of ambientCG's LeafSet016 (https://ambientcg.com/a/LeafSet016)\n")
cr = OUT / "CREDITS.txt"
txt = cr.read_text(encoding="utf-8") if cr.exists() else ""
head = BLOCK.split("\n", 1)[0]
if head in txt:
    i = txt.index(head); j = txt.find("\n", txt.find("oak-leaves:", i)) + 1
    txt = txt[:i] + BLOCK + txt[j:]
else:
    k = txt.find("Poly Haven and ambientCG license")
    txt = txt[:k] + BLOCK + txt[k:] if k >= 0 else txt + BLOCK
cr.write_text(txt, encoding="utf-8", newline="\r\n")                   # CRLF, as the file is in git
