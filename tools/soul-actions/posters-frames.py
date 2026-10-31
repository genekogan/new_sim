#!/usr/bin/env python3
"""Entry 38: stills around every phase of each hand stroke in a posters take, from continuous.webm and proof.json.
Usage: posters-frames.py <visual-dir>  -> <visual-dir>/sheets/<n>-<body>-<kind>.jpg (4x3 tiles) + stills/*.jpg
The depicted tick of each sample is mapped to video time by the sample's wall-clock time."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw
d = sys.argv[1]; P = json.load(open(d + '/proof.json')); S = [s for s in P['samples'] if s]; v0 = P['videoStart']
os.makedirs(d + '/sheets', exist_ok=True); os.makedirs(d + '/stills', exist_ok=True)
strokes = {}
for s in S:
    for b in s['bodies']:
        m = b.get('motion')
        if m and m.get('stroke'): strokes.setdefault((m['startTick'], b['id']), m['stroke'])
def vt(tick): s = min(S, key=lambda s: abs(s['tick'] - tick)); return (s['at'] - v0) / 1000
for n, ((start, body), st) in enumerate(sorted(strokes.items())):
    sec, rel = st['seconds'], st.get('release', .7)
    marks = [-.8, 0, .3, .65] + [.65 + sec * k for k in (.1, .2, .35, .5, .65, .8, .95)] + [.65 + sec + rel * .5]
    tiles = []
    for el in marks:
        t = vt(start + el / .05); out = f"{d}/stills/{n:02d}-{st['kind']}-{el:+.2f}.jpg"
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', d + '/continuous.webm', '-frames:v', '1', '-vf', 'scale=640:-1', out], check=True)
        im = Image.open(out); ImageDraw.Draw(im).text((10, 40), f"{st['kind']} el {el:+.2f}s  video {t:.2f}s", fill=(255, 255, 0)); im.save(out); tiles.append(im)
    w, h = tiles[0].size; sheet = Image.new('RGB', (w * 4, h * 3))
    for i, im in enumerate(tiles[:12]): sheet.paste(im, ((i % 4) * w, (i // 4) * h))
    sheet.save(f"{d}/sheets/{n:02d}-{st['kind']}.jpg", quality=80)
    print(n, st['kind'], start, 'video', round(vt(start), 2))
