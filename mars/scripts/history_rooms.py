import json,sys,re
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path('~/Mars');D=ROOT/'docs/media/reconstruction/campus-history'
sys.path.insert(0,str(ROOT/'tools/media'));import mars_media
idx=mars_media.load_indexer();rows=json.loads((D/'catalog-audit.json').read_text())['candidates']
for year in range(2020,2027):
 for facet,terms in {'hall':['projector','classroom','lecture','main hall','tiered seating','chiba interior','talks'], 'rooms':['gallery','mimos','compute','upstairs','library','cafe','café']}.items():
  found=[];seen=set()
  candidates=[]
  for r in rows:
   if r['season']!=year or r['media_type']!='image':continue
   t=(r['observations']+' '+r['caption']).lower();score=sum(min(t.count(x),3) for x in terms)
   if score:candidates.append((score,r))
  for score,r in sorted(candidates,key=lambda x:-x[0]):
   if r['fingerprint'] in seen:continue
   seen.add(r['fingerprint']);found.append(r)
   if len(found)==24:break
  (D/str(year)/(facet+'.json')).write_text(json.dumps(found,indent=2));im=Image.new('RGB',(1440,255*((len(found)+3)//4)),'#eee');c=ImageDraw.Draw(im)
  for i,r in enumerate(found):
   t=idx.thumbnail_for_row(r,(354,215));x=i%4*360;y=i//4*255;im.paste(t,(x,y));c.text((x+3,y+218),f'{year} {facet} {i+1:02d}\n{Path(r["rel_path"]).name[:40]}',fill='black')
  if found:im.save(D/str(year)/(facet+'.jpg'),quality=86)
 print(year,flush=True)
