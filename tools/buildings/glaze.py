"""Glaze textures from the ceramic scans.

The Polycam atlases are chart-fragmented, so they cannot be tiled directly. We
quilt a seamless (toroidal) texture from many small atlas patches that are
mostly glaze — chosen by colour, rejecting the bare-clay islands and the
black atlas gaps — with cosine-feathered overlaps. Colour and normal patches
come from the same atlas positions so the relief follows the colour.

Runs inside Blender (bpy + numpy). Writes JPEGs into the output textures dir.
"""
import os

import bpy
import numpy as np

SRC = os.environ.get('LM_3D', '<lm-3d-models>')

SOURCES = {
    # name: (colour atlas, normal atlas) relative to the 3d-models root
    'tower': ('architecture/tower/textured_0_CRK4z6VL.jpg',
              'architecture/tower/textured_0_norm_CRK4z6VL.jpg'),
    'temple': ('architecture/temple-minarete/poly-high/textured_0_0xX3Vhat.jpg',
               'architecture/temple-minarete/poly-high/textured_0_norm_0xX3Vhat.jpg'),
}

# Per-channel gain applied to the quilted colour (sRGB values), nudging each
# towards its sculpture as photographed: the temple reads a deeper blue.
TINT = {
    'tower': (0.98, 1.02, 1.02),
    'temple': (0.80, 0.86, 1.04),
}

# Contrast kept around the mean: the quilt is busier than glaze seen from afar.
CONTRAST = {'tower': 0.62, 'temple': 0.72}

WORK = 2048     # atlas is downsampled to this before sampling
PATCH = 96      # patch size at WORK resolution
OUT = 1024      # output texture size
STEP = 40       # jitter-grid spacing of patch placement on the output


def _load(path, size):
    img = bpy.data.images.load(path, check_existing=False)
    img.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[:, :, :3]


def _glaze_mask(rgb, kind):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    clay = (r > b + 0.06) & (r > g - 0.01)          # bare clay / table: warm
    if kind == 'tower':                              # pale blue-green glaze
        return (lum > 0.32) & ~clay & (g >= r - 0.02)
    return (lum > 0.16) & ~clay & (b >= r - 0.02)    # temple: blue / lavender glaze


def _candidates(mask, rng, n=1500):
    h = mask.shape[0]
    integ = np.pad(mask.astype(np.float32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    ys = rng.integers(0, h - PATCH, n * 6)
    xs = rng.integers(0, h - PATCH, n * 6)
    frac = (integ[ys + PATCH, xs + PATCH] - integ[ys, xs + PATCH]
            - integ[ys + PATCH, xs] + integ[ys, xs]) / (PATCH * PATCH)
    order = np.argsort(-frac)[:n]
    return list(zip(ys[order], xs[order])), float(frac[order].mean())


def _window(n):
    t = (np.arange(n) + 0.5) / n
    w = np.sin(np.pi * t) ** 2
    return np.outer(w, w)[..., None] + 1e-6


def _quilt(layers, cands, rng):
    acc = [np.zeros((OUT, OUT, 3), np.float64) for _ in layers]
    wsum = np.zeros((OUT, OUT, 1), np.float64)
    s = PATCH  # patches placed 1:1 (WORK px -> OUT px) to keep glaze grain sharp
    win = _window(s)
    idx = np.arange(s)
    for gy in range(0, OUT, STEP):
        for gx in range(0, OUT, STEP):
            y0 = (gy + rng.integers(-STEP // 2, STEP // 2)) % OUT
            x0 = (gx + rng.integers(-STEP // 2, STEP // 2)) % OUT
            py, px = cands[rng.integers(len(cands))]
            rows = ((y0 + idx) % OUT)[:, None]
            cols = ((x0 + idx) % OUT)[None, :]
            for a, layer in zip(acc, layers):
                a[rows, cols] += layer[py:py + s, px:px + s] * win
            wsum[rows, cols] += win
    return [a / wsum for a in acc]


def _save(arr, path, srgb=True):
    h, w, _ = arr.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    if not srgb:
        img.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([np.clip(arr, 0, 1), np.ones((h, w, 1))], axis=2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'JPEG'
    img.save(filepath=path, quality=88)  # byte image: values pass through, no view transform
    bpy.data.images.remove(img)


def build(name, out_dir, seed=7):
    """Write <name>-glaze.jpg and <name>-glaze-normal.jpg; return their paths and stats."""
    colour_rel, normal_rel = SOURCES[name]
    col_src = os.path.join(SRC, colour_rel)
    nrm_src = os.path.join(SRC, normal_rel)
    col_out = os.path.join(out_dir, f'{name}-glaze.jpg')
    nrm_out = os.path.join(out_dir, f'{name}-glaze-normal.jpg')
    if not (os.path.exists(col_src) and os.path.exists(nrm_src)):
        if os.path.exists(col_out) and os.path.exists(nrm_out):
            return col_out, nrm_out, {'reused': True}
        raise FileNotFoundError(f'scan atlas missing for {name}: {col_src}')
    rng = np.random.default_rng(seed)
    col = _load(col_src, WORK)
    nrm = _load(nrm_src, WORK)
    cands, purity = _candidates(_glaze_mask(col, name), rng)
    col_q, nrm_q = _quilt([col, nrm], cands, rng)
    col_q = col_q * np.array(TINT[name])
    mean = col_q.reshape(-1, 3).mean(0)
    col_q = mean + (col_q - mean) * CONTRAST[name]
    # renormalise the blended tangent-space normals, flatten them a little
    n = nrm_q * 2 - 1
    n[..., 2] = np.maximum(n[..., 2], 0.35)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    os.makedirs(out_dir, exist_ok=True)
    _save(col_q, col_out)
    _save(n * 0.5 + 0.5, nrm_out, srgb=False)
    return col_out, nrm_out, {'patchGlazePurity': round(purity, 3),
                              'meanRGB': [round(float(v), 3) for v in mean]}
