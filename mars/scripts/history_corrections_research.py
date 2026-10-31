import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
import json,re,sys
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=mars_root();BASE=ROOT/'docs/media/reconstruction/campus-history';OUT=BASE/'corrections-20260926';OUT.mkdir(exist_ok=True)
sys.path.insert(0,str(ROOT/'tools/media'));import mars_media;idx=mars_media.load_indexer()
rows=json.loads((BASE/'catalog-audit.json').read_text())['candidates']
for year in [2021,2022,2024]:
 candidates=[]
 for r in rows:
  if r['season']!=year or r['media_type']!='image':continue
  text=(r.get('observations','')+' '+r['caption'].split('.')[0]).lower();name=Path(r['rel_path']).name
  if year==2021:score=sum(text.count(t)*5 for t in ['corridor','aisle','aluminet','shade cloth','parallel','between two','silver'])+sum(text.count(t)*2 for t in ['rack','pallet','building'])
  elif year==2022:score=sum(text.count(t)*7 for t in ['aerial','overhead','top-down','drone'])+(20 if name.startswith('DJI') else 0)+sum(text.count(t)*2 for t in ['courtyard','roof','campus','pallet'])
  else:score=sum(text.count(t)*6 for t in ['solar','mural','facade','façade'])+sum(text.count(t)*2 for t in ['chiba','front','red','stairs','wide'])
  if score>4:candidates.append((score,r))
 seen=set();selected=[]
 for score,r in sorted(candidates,key=lambda x:x[0],reverse=True):
  fp=r.get('fingerprint',r['abs_path'])
  if fp in seen:continue
  seen.add(fp);selected.append(r)
  if len(selected)>=72:break
 (OUT/f'{year}.json').write_text(json.dumps(selected,indent=2))
 for start in range(0,len(selected),24):
  sheet=Image.new('RGB',(1600,6*280),'#eee');draw=ImageDraw.Draw(sheet)
  for j,r in enumerate(selected[start:start+24]):
   thumb=idx.thumbnail_for_row(r,(394,240));x=j%4*400;y=j//4*280;sheet.paste(thumb,(x,y));draw.text((x+3,y+243),f'{start+j+1:02d} {Path(r["rel_path"]).name[:48]}',fill='black')
  sheet.save(OUT/f'{year}-{start//24+1}.jpg',quality=88)
 print(year,len(selected),flush=True)
