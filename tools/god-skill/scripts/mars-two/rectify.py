#!/usr/bin/env python3
"""MARSLAND: project a drone picture onto the ground plane (a top-down map in metres from the drone's take-off point:
x east, z south = north up), from the camera's position, compass heading and pitch (pinhole, no lens distortion).
Ground-level things land where they are; tall things smear away from the camera. Used to read the real campus layout.

  python3 rectify.py <image> <east_m> <north_m> <height_m> <heading_deg> <horizon_row> <out.png> [half_m=260] [m_per_px=0.5] [hfov=71.6]

<horizon_row> is the row (in the picture's own pixels) where the horizon sits; pitch = atan((H/2 - row) / f).
"""
import sys, math
import numpy as np
from PIL import Image, ImageDraw

def rectify(img_path, e, n, h, heading, horizon, out, half=260.0, mpp=0.5, hfov=71.6, ce=0.0, cn=0.0):
    im = np.asarray(Image.open(img_path).convert('RGB')).astype(np.float32)
    H, W = im.shape[:2]
    f = (W / 2) / math.tan(math.radians(hfov / 2))
    pitch = math.atan((H / 2 - horizon) / f)
    hd = math.radians(heading)
    # camera basis in (east, north, up)
    fwd = np.array([math.sin(hd) * math.cos(pitch), math.cos(hd) * math.cos(pitch), -math.sin(pitch)])
    right = np.array([math.cos(hd), -math.sin(hd), 0.0])
    up = np.cross(right, fwd)
    N = int(2 * half / mpp)
    xs = ce - half + (np.arange(N) + 0.5) * mpp       # east (map centre ce m east of the take-off point)
    zs = -cn - half + (np.arange(N) + 0.5) * mpp      # south (row 0 = north; map centre cn m north)
    X, Z = np.meshgrid(xs, zs)
    d = np.stack([X - e, -Z - n, np.full_like(X, -h)], -1)   # vector camera → ground point (east, north, up)
    zc = d @ fwd
    u = W / 2 + f * (d @ right) / np.maximum(zc, 1e-6)
    v = H / 2 - f * (d @ up) / np.maximum(zc, 1e-6)
    ok = (zc > 1) & (u >= 0) & (u < W - 1) & (v >= 0) & (v < H - 1)
    out_img = np.zeros((N, N, 3), np.float32) + 40
    ui, vi = np.clip(u.astype(int), 0, W - 1), np.clip(v.astype(int), 0, H - 1)
    out_img[ok] = im[vi[ok], ui[ok]]
    o = Image.fromarray(out_img.astype(np.uint8))
    dr = ImageDraw.Draw(o)
    for m in range(-int(half) // 50 * 50, int(half) + 1, 50):   # 50 m grid about the map centre
        p = (m + half) / mpp
        dr.line([(p, 0), (p, N)], fill=(255, 255, 0) if m == 0 else (90, 90, 90), width=1)
        dr.line([(0, p), (N, p)], fill=(255, 255, 0) if m == 0 else (90, 90, 90), width=1)
    o.save(out)
    return o

if __name__ == '__main__':
    a = sys.argv[1:]
    rectify(a[0], float(a[1]), float(a[2]), float(a[3]), float(a[4]), float(a[5]), a[6], *(float(x) for x in a[7:]))
