# Q3 picture: python3 docs/engineering/questions/tools/compass.py
# Draws the model's north (screen up = world -Z) and its February sunset bearing (~253 deg) on the
# top-down capture q03-2022-top.jpg (from viewer/e2e/questions-captures.spec.ts) -> q03-2022-top-compass.jpg.
import math, os
from PIL import Image, ImageDraw, ImageFont
Q = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
im = Image.open(os.path.join(Q, 'q03-2022-top.jpg')).convert('RGB'); d = ImageDraw.Draw(im)
F = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 26); S = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 20)
def arrow(x0, y0, x1, y1, c, w=8):
    d.line([(x0, y0), (x1, y1)], fill=c, width=w); a = math.atan2(y1 - y0, x1 - x0); L = 26
    d.polygon([(x1, y1), (x1 - L * math.cos(a - 0.45), y1 - L * math.sin(a - 0.45)), (x1 - L * math.cos(a + 0.45), y1 - L * math.sin(a + 0.45))], fill=c)
def pill(x, y, t, c, f=F):
    b = d.textbbox((x, y), t, font=f); d.rounded_rectangle((b[0] - 8, b[1] - 6, b[2] + 8, b[3] + 6), 6, fill='white', outline=c, width=3); d.text((x, y), t, fill='#111', font=f)
cx, cy = 1110, 200
arrow(cx, cy, cx, cy - 110, '#d11'); d.ellipse((cx - 7, cy - 7, cx + 7, cy + 7), fill='#d11')
pill(cx - 120, cy - 165, 'N (model’s guess)', '#d11')
ox, oy, az, L = 640, 400, math.radians(253), 420
ex, ey = ox + L * math.sin(az), oy - L * math.cos(az)
arrow(ox, oy, ex, ey, '#ff8a00', 7)
pill(ex + 10, ey + 18, 'sunset in February, as the model puts it', '#ff8a00', S)
im.save(os.path.join(Q, 'q03-2022-top-compass.jpg'), quality=86)
