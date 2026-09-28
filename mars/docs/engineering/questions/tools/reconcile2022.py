# RECONCILIATION_2022.md pictures (W49): python3 docs/engineering/questions/tools/reconcile2022.py
# 1. r2022-aerial-annotated.jpg: photos/2022-aerial-03.jpg (1200x675, near-nadir, no telemetry) cropped to the
#    compound and doubled, with Gene's building names (questionnaire 2026-09-29), the stairs (hatch = tread direction),
#    the solar rows, the trailers (T1-T5 = the nose-to-tail train) and two north arrows.
# 2. r2022-names-model-vs-photo.jpg: the model's top-down capture q20-2022-top.jpg (screen up = world -Z, right = +X)
#    with each model house's new name, next to picture 1.
# Pixel picks are by eye on the original 1200x675 frame (W49); scale ~8.3 px/m from Huaqiangbei's 3-bay body
# (91 px = 10.97 m). Aerial-03 is roughly aligned with the model frame (same house in each quadrant).
# North: Gene "about 8 o'clock of the render" (240 deg clockwise from up); DJI_0829 north-up by its logged FlightYaw
# 110.2 shows the house axes ~11 deg clockwise of E-W, i.e. north at ~259 deg ("8:40") in this frame.
import math, os
from PIL import Image, ImageDraw, ImageFont
Q = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HV = '/System/Library/Fonts/Helvetica.ttc'
F = ImageFont.truetype(HV, 26); S = ImageFont.truetype(HV, 19); T = ImageFont.truetype(HV, 32, index=1)
RED, ORANGE, BLUE, GREEN, PURPLE, GREY = '#d11', '#ff8a00', '#1f6fff', '#0a8a3a', '#8a2be2', '#555'
X0, Y0, X1, Y1, K = 270, 20, 930, 550, 2  # crop of the original frame, scale


def P(x, y):
    return ((x - X0) * K, (y - Y0) * K)


def R(x0, y0, x1, y1):
    return (*P(x0, y0), *P(x1, y1))


def arrowhead(d, x, y, a, c, L=22):
    d.polygon([(x, y), (x - L * math.cos(a - 0.45), y - L * math.sin(a - 0.45)), (x - L * math.cos(a + 0.45), y - L * math.sin(a + 0.45))], fill=c)


def arrow(d, x0, y0, x1, y1, c, w=6, both=False):
    d.line([(x0, y0), (x1, y1)], fill=c, width=w); arrowhead(d, x1, y1, math.atan2(y1 - y0, x1 - x0), c)
    if both: arrowhead(d, x0, y0, math.atan2(y0 - y1, x0 - x1), c)


def pill(d, x, y, t, c, f=S, anchor='lt'):
    b = d.textbbox((x, y), t, font=f, anchor=anchor)
    d.rounded_rectangle((b[0] - 6, b[1] - 5, b[2] + 6, b[3] + 5), 5, fill='white', outline=c, width=3); d.text((x, y), t, fill='#111', font=f, anchor=anchor)


def north(d, x, y, deg, c, label, L=120, dx=0, dy=0):
    a = math.radians(deg); ex, ey = x + L * math.sin(a), y - L * math.cos(a)
    d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=c); arrow(d, x, y, ex, ey, c)
    pill(d, ex + dx, ey + dy, label, c)


def hatch(d, box, along_x, c, n=5):
    x0, y0, x1, y1 = box
    for i in range(1, n + 1):
        if along_x:
            y = y0 + (y1 - y0) * i / (n + 1); d.line([(x0 + 4, y), (x1 - 4, y)], fill=c, width=3)
        else:
            x = x0 + (x1 - x0) * i / (n + 1); d.line([(x, y0 + 4), (x, y1 - 4)], fill=c, width=3)


# --- 1. annotated aerial ---------------------------------------------------------------------------------------------
src = Image.open(os.path.join(Q, 'photos', '2022-aerial-03.jpg')).convert('RGB')
im = src.crop((X0, Y0, X1, Y1)).resize(((X1 - X0) * K, (Y1 - Y0) * K), Image.LANCZOS)
d = ImageDraw.Draw(im, 'RGBA')

# houses: body outline, name, model name; the long axis runs along x (Ba Sing Se, Chatsubo) or y (the other two)
houses = [  # name, model id, body box, stair box, long axis along screen x?, label pos, anchor
    ('Huaqiangbei', 'west-house', (448, 297, 490, 388), (427, 270, 470, 297), False, (424, 256), 'rt'),
    ('Ba Sing Se', 'chiba', (500, 238, 590, 292), (590, 250, 620, 292), True, (545, 30), 'mt'),
    ('Cahuilla (south)', 'east-house', (597, 302, 662, 400), (600, 400, 650, 425), False, (672, 300), 'lt'),
    ('Chatsubo', 'kitchen', (495, 403, 582, 455), (460, 405, 495, 455), True, (560, 522), 'mb'),
]
for name, mid, body, stair, along_x, (lx, ly), anc in houses:
    d.rectangle(R(*body), outline=BLUE, width=4)
    sb = R(*stair); d.rectangle(sb, outline=ORANGE, width=4, fill=(255, 138, 0, 40)); hatch(d, sb, along_x, ORANGE)
    x, y = P(lx, ly); pill(d, x, y, name, BLUE, F, anc)
    pill(d, x, y + (34 if anc[1] == 't' else -36), f'model: {mid}', BLUE, S, anc)

# stair callout (one, on Ba Sing Se): treads parallel to the house, run across its depth
sb = R(590, 250, 620, 292)
arrow(d, sb[2] + 14, sb[3] - 6, sb[2] + 14, sb[1] + 6, ORANGE, 4, both=True)
pill(d, sb[2] + 26, sb[1] - 70, 'stairs: treads PARALLEL to the house', ORANGE)
pill(d, sb[2] + 26, sb[1] - 40, '~3.2-3.9 m wide x ~4.5-5 m run (one end bay)', ORANGE)

# solar rows (green): one row on Huaqiangbei and Cahuilla (+ a short second group there), three stepped rows on Ba Sing Se
for box in [(452, 298, 475, 386), (505, 250, 515, 272), (527, 243, 540, 270), (554, 242, 566, 266), (604, 330, 620, 396), (622, 305, 642, 360)]:
    d.rectangle(R(*box), outline=GREEN, width=4)
pill(d, *P(495, 372), 'solar: one row along the house', GREEN)
pill(d, *P(470, 200), 'solar: 3 short stepped rows ("staggered")', GREEN, anchor='lb')
pill(d, *P(672, 350), 'solar: one long row + a short group (?)', GREEN)
pill(d, *P(515, 470), 'Chatsubo: no panels', GREEN)

# trailers: T1-T5 = the train (red), the rest (purple; ? = not sure it is a camper)
train = [('T1', 375, 242), ('T2', 342, 340), ('T3', 350, 415), ('T4', 395, 492), ('T5', 447, 500)]
others = [('T6', 484, 217), ('T7?', 586, 207), ('T8', 732, 400), ('T9?', 702, 470), ('P', 693, 198)]
d.line([P(x, y) for _, x, y in train], fill=RED, width=5)
for t, x, y in train: pill(d, *P(x, y), t, RED, anchor='mm')
for t, x, y in others: pill(d, *P(x, y), t, PURPLE, anchor='mm')
pill(d, *P(282, 120), 'T1-T5: trailer train, nose to tail', RED)
pill(d, *P(760, 440), 'T6-T9, P: "more disorganized"', PURPLE)

# Q1 corner: open, no table
cx, cy = P(462, 396); d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), outline=RED, width=4)
pill(d, *P(300, 455), "Q1 corner (the model's 'SW'): open, no table", RED)

# north arrows
ox, oy = P(860, 110)
north(d, ox, oy, 240, GREY, "N, Gene: ~8 o'clock", L=150, dx=-120, dy=8)
north(d, ox, oy, 259, RED, 'N, DJI_0829 yaw: ~8:40', L=150, dx=-200, dy=-44)
d.text((12, im.height - 30), 'aerial-03, 2022; ~8.3 px/m (original); picks by eye', fill='white', font=S)
im.save(os.path.join(Q, 'r2022-aerial-annotated.jpg'), quality=88)

# --- 2. model vs photo, names -------------------------------------------------------------------------------------------
m = Image.open(os.path.join(Q, 'q20-2022-top.jpg')).convert('RGB')
dm = ImageDraw.Draw(m)
for label, (x, y) in [('= Ba Sing Se', (545, 180)), ('= Cahuilla (south)', (845, 318)), ('= Chatsubo', (693, 580)), ('= Huaqiangbei', (443, 430))]:
    pill(dm, x, y, label, RED, F, 'mt')
north(dm, 1180, 700, 240, GREY, "N, Gene: ~8 o'clock", dx=-160, dy=0)
north(dm, 1180, 700, 259, RED, 'N, DJI_0829: ~8:40', dx=-210, dy=-40)
H = 900
a = m.resize((round(m.width * H / m.height), H), Image.LANCZOS); b = im.resize((round(im.width * H / im.height), H), Image.LANCZOS)
out = Image.new('RGB', (a.width + b.width + 30, H + 60), 'white'); out.paste(a, (0, 60)); out.paste(b, (a.width + 30, 60))
do = ImageDraw.Draw(out)
do.text((10, 12), 'The model, 2022, from above (q20-2022-top): old labels, new names', fill='#111', font=T)
do.text((a.width + 40, 12), 'Drone photo 2022 (aerial-03), same frame', fill='#111', font=T)
out.save(os.path.join(Q, 'r2022-names-model-vs-photo.jpg'), quality=85)
print('wrote r2022-aerial-annotated.jpg, r2022-names-model-vs-photo.jpg')
