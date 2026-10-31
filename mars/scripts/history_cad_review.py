import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import json,pathlib,math
from PIL import Image,ImageDraw
OUT=media('reconstruction/campus-history/cad')
for file in OUT.glob('*.geometry.json'):
 parts=json.loads(file.read_text());verts=[v for p in parts for v in p['vertices']];lo=[min(v[i] for v in verts) for i in range(3)];hi=[max(v[i] for v in verts) for i in range(3)];print(file.stem,lo,hi)
 image=Image.new('RGB',(1500,850),'#e6e2d5');draw=ImageDraw.Draw(image)
 for view in range(2):
  def project(v):
   x,y,z=v
   return (x,y) if view==0 else ((x-y)*.707,(x+y)*.35-z)
  projected=[project(v) for v in verts];a=[min(v[i] for v in projected) for i in range(2)];b=[max(v[i] for v in projected) for i in range(2)];scale=min(690/(b[0]-a[0]),740/(b[1]-a[1]));off=(view*750+30,65)
  def screen(v):
   x,y=project(v);return (off[0]+(x-a[0])*scale,off[1]+(b[1]-y if view==0 else y-a[1])*scale)
  faces=[]
  for p in parts:
   for t,c in zip(p['triangles'],p['colors']):
    v=[p['vertices'][i] for i in t];depth=sum(x[2] if view==0 else x[0]+x[1]+x[2] for x in v);faces.append((depth,v,c))
  for _,v,c in sorted(faces,key=lambda q:q[0]):draw.polygon([screen(x) for x in v],fill=tuple(c[:3]))
 draw.text((20,15),file.stem.replace('.geometry','')+' | metres: '+str([round(hi[i]-lo[i],2) for i in range(3)]),fill='black')
 image.save(file.with_suffix('.jpg'),quality=90)
