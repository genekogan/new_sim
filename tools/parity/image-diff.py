#!/usr/bin/env python3
"""Raw RGB differences; zero tolerance. Also retain a labelled side-by-side."""
import json, sys
from PIL import Image, ImageChops, ImageStat, ImageDraw

left, right, output = sys.argv[1:]
a, b = Image.open(left).convert('RGB'), Image.open(right).convert('RGB')
if a.size != b.size:
    print(json.dumps({'status':'FAIL','reason':'image dimensions differ','oldSize':a.size,'candidateSize':b.size}))
    sys.exit(0)
d = ImageChops.difference(a, b)
h = d.histogram()
mae = sum((i % 256) * n for i,n in enumerate(h)) / (a.width*a.height*3*255)
changed = sum(1 for r,g,b in zip(*[iter(d.tobytes())]*3) if r or g or b)
sheet = Image.new('RGB',(a.width*2,a.height+32),'#17202c')
sheet.paste(a,(0,32));sheet.paste(b,(a.width,32))
draw = ImageDraw.Draw(sheet)
draw.text((12,10),'OLD ENGINE | matched named view',fill='white')
draw.text((a.width+12,10),'CANDIDATE | matched named view',fill='white')
sheet.save(output)
print(json.dumps({'status':'PASS' if changed==0 else 'FAIL','meanAbsoluteError':mae,
 'changedPixels':changed,'totalPixels':a.width*a.height,'changedFraction':changed/(a.width*a.height),
 'oldSize':a.size,'candidateSize':b.size,'sideBySide':output}))
