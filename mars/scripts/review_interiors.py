import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import pathlib,json
from PIL import Image,ImageOps,ImageDraw
b=media('reconstruction/2026-campus/modular/research');allrows=[]
for name in ['main-room','kitchen','mimos','upstairs']:
 p=b/(name+'.json')
 if not p.exists():continue
 rows=json.load(open(p));rows=[r for r in rows if ('2026' in r['rel_path'] or '202512' in r['rel_path']) and 'kif 2024' not in r['rel_path']]
 for r in rows:
  if r['media_id'] not in {x['media_id'] for x in allrows}:r['review_id']=len(allrows);allrows.append(r)
for offset in range(0,len(allrows),20):
 rows=allrows[offset:offset+20];sheet=Image.new('RGB',(1600,1150),'#1b2025');draw=ImageDraw.Draw(sheet)
 for i,r in enumerate(rows):
  x=i%4*400;y=i//4*230
  try:
   im=Image.open(r['abs_path']);im=ImageOps.exif_transpose(im);im.thumbnail((394,197));sheet.paste(im,(x+(400-im.width)//2,y))
  except Exception as e:draw.text((x+3,y+30),str(e)[:45],fill='red')
  draw.text((x+5,y+199),f"{r['review_id']:03d} {pathlib.Path(r['rel_path']).name[:46]}",fill='white')
 sheet.save(b/f'interiors_{offset//20:02}.jpg',quality=92)
(b/'interior-candidates.json').write_text(json.dumps(allrows,indent=2));print(len(allrows),'candidates')
