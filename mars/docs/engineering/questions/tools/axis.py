# Q20-Q22 pictures (W44): python3 docs/engineering/questions/tools/axis.py
# Puts each year's top-down model capture (viewer/e2e/questions-captures.spec.ts: q20-2022-top, q21-2024-top,
# q22-2026-top; screen up = world -Z, right = +X) next to the drone still W42 used, turned north-up from its logged
# camera heading, with a north arrow on both sides:
#   2022 DJI_0829 (FlightYaw 110.2, pitch -86.4)        -> q20-2022-model-vs-drone.jpg (+ spin arrows)
#   2024 DJI_20240122144543_0335_D (nadir, north-up by   -> q21-2024-model-vs-drone.jpg
#        the old tire ring, which runs north-south on the west side)
#   2026 DJI_0005 (FlightYaw -91.7, near-nadir)          -> q22-2026-model-vs-drone.jpg (two north arrows)
# Photo positions below are pixel picks on the north-up stills (looked at by eye, W44).
import math, os
from PIL import Image, ImageDraw, ImageFont
Q = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HV = '/System/Library/Fonts/Helvetica.ttc'
F = ImageFont.truetype(HV, 30); S = ImageFont.truetype(HV, 22); T = ImageFont.truetype(HV, 34, index=1)
RED, ORANGE, BLUE, GREY = '#d11', '#ff8a00', '#1f6fff', '#555'
H = 820  # panel height


def arrowhead(d, x, y, a, c, L=26):
    d.polygon([(x, y), (x - L * math.cos(a - 0.45), y - L * math.sin(a - 0.45)), (x - L * math.cos(a + 0.45), y - L * math.sin(a + 0.45))], fill=c)


def arrow(d, x0, y0, x1, y1, c, w=8):
    d.line([(x0, y0), (x1, y1)], fill=c, width=w); arrowhead(d, x1, y1, math.atan2(y1 - y0, x1 - x0), c)


def pill(d, x, y, t, c, f=F, anchor='lt'):
    b = d.textbbox((x, y), t, font=f, anchor=anchor)
    d.rounded_rectangle((b[0] - 8, b[1] - 6, b[2] + 8, b[3] + 6), 6, fill='white', outline=c, width=3); d.text((x, y), t, fill='#111', font=f, anchor=anchor)


def north(d, x, y, deg, c, label, L=110, lab_dx=-60, lab_dy=-40):
    """Arrow from (x, y) pointing `deg` clockwise from screen-up."""
    a = math.radians(deg); ex, ey = x + L * math.sin(a), y - L * math.cos(a)
    d.ellipse((x - 7, y - 7, x + 7, y + 7), fill=c); arrow(d, x, y, ex, ey, c)
    pill(d, ex + lab_dx, ey + lab_dy, label, c, S)


def spin(d, cx, cy, r, clockwise, c, label):
    """Circular arrow round (cx, cy): 300 degrees of arc with the head showing the turning sense."""
    d.arc((cx - r, cy - r, cx + r, cy + r), 20, 320, fill=c, width=9)
    if clockwise:
        t = math.radians(320); x, y = cx + r * math.cos(t), cy + r * math.sin(t); a = math.atan2(math.cos(t), -math.sin(t))
    else:
        t = math.radians(20); x, y = cx + r * math.cos(t), cy + r * math.sin(t); a = math.atan2(-math.cos(t), math.sin(t))
    arrowhead(d, x, y, a, c, 34)
    pill(d, cx, cy, label, c, S, anchor='mm')


def fit(im, h=H):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def north_up(name, yaw):
    """Turn a still whose top faces compass `yaw` so that north is up (PIL rotates counter-clockwise)."""
    return Image.open(os.path.join(Q, 'photos', name)).convert('RGB').rotate(yaw, expand=True, fillcolor='white', resample=Image.BICUBIC)


def side_by_side(left, right, titles, out):
    gap, top = 30, 60
    W = left.width + right.width + gap
    im = Image.new('RGB', (W, H + top), 'white'); d = ImageDraw.Draw(im)
    im.paste(left, (0, top)); im.paste(right, (left.width + gap, top))
    d.text((12, 14), titles[0], fill='#111', font=T); d.text((left.width + gap + 12, 14), titles[1], fill='#111', font=T)
    im.save(os.path.join(Q, out), quality=85); print(out, im.size)


# --- Q20 2022: the model's four houses turn counter-clockwise; DJI_0829 shows them turning clockwise.
m = Image.open(os.path.join(Q, 'q20-2022-top.jpg')).convert('RGB').crop((280, 60, 1000, 740))  # 720 x 680
m = fit(m); d = ImageDraw.Draw(m)
spin(d, m.width // 2, m.height // 2 + 10, 95, False, RED, 'turns this way')
north(d, m.width - 70, 190, 0, RED, 'N (model)', lab_dx=-80)
p = north_up('2022-DJI_0829.jpg', -110.2)  # top of the frame faced 110.2 deg (ESE)
cx, cy = p.width // 2, p.height // 2
p = p.crop((cx - 380, cy - 340, cx + 380, cy + 360)); p = fit(p); d = ImageDraw.Draw(p)
s = H / 700
spin(d, 490, 330, 72, True, RED, 'turns this way')
north(d, p.width - 70, 190, 0, RED, 'N (photo)', lab_dx=-80)
side_by_side(m, p, ['The model, 2022, from above', 'Drone photo DJI_0829, 2022, turned north-up'], 'q20-2022-model-vs-drone.jpg')

# --- Q21 2024: kitchen + trailer ring south of Chiba in the model, north of it in the photo.
m = Image.open(os.path.join(Q, 'q21-2024-top.jpg')).convert('RGB').crop((190, 40, 1090, 740))
m = fit(m); d = ImageDraw.Draw(m)
north(d, 70, 200, 0, RED, 'N (model)', lab_dx=-20)
p = Image.open(os.path.join(Q, 'photos', '2024-DJI_20240122144543_0335_D.jpg')).convert('RGB')  # already north-up
p = fit(p); d = ImageDraw.Draw(p); k = H / 1048
pill(d, 730 * k, 870 * k, 'Chiba', BLUE)
pill(d, 710 * k, 225 * k, 'kitchen', ORANGE)
pill(d, 520 * k, 590 * k, 'trailer ring', RED)
pill(d, 250 * k, 150 * k, 'old tire ring (runs north-south)', GREY, S)
north(d, p.width - 90, 220, 0, RED, 'N (photo)', lab_dx=-80)
side_by_side(m, p, ['The model, 2024, from above', 'Drone photo, 22 Jan 2024, north-up'], 'q21-2024-model-vs-drone.jpg')

# --- Q22 2026: north the model uses now (world -X, screen left) vs north from the drone (-X turned 33 deg toward -Z).
m = Image.open(os.path.join(Q, 'q22-2026-top.jpg')).convert('RGB').crop((160, 0, 1280, 800))
m = fit(m); d = ImageDraw.Draw(m)
ox, oy = 330, 740  # clear sand, bottom left
north(d, ox, oy, -90, GREY, 'N the model uses now', L=150, lab_dx=-30, lab_dy=22)
north(d, ox, oy, -57, RED, 'N from the drone photos', L=190, lab_dx=-60, lab_dy=-52)
p = north_up('2026-DJI_0005.jpg', 91.7)  # top of the frame faced -91.7 deg (W)
p = fit(p); d = ImageDraw.Draw(p)
north(d, p.width - 70, 200, 0, RED, 'N (photo)', lab_dx=-90)
side_by_side(m, p, ['The model, 2026, from above', 'DJI_0005, north-up'], 'q22-2026-model-vs-drone.jpg')
