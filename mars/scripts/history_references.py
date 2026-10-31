import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
"""Read-only catalog audit and review sheets for seasonal campus reconstruction."""
import sys,json,re,sqlite3
from pathlib import Path
from collections import Counter
ROOT=mars_root();OUT=ROOT/'docs/media/reconstruction/campus-history'
sys.path.insert(0,str(ROOT/'tools/media'))
import mars_media as media
from PIL import Image,ImageDraw
c=sqlite3.connect(ROOT/'docs/media/catalog/media.sqlite');c.row_factory=sqlite3.Row
FACETS={
'aerial':['aerial','drone','overhead','top-down','bird','panoram','entire camp'],
'exterior':['facade','exterior','pallet','scaffold','two-story','two-storey','wooden structure','modular','stair','solar panel','mural'],
'interior':['kitchen','refrigerator','fridge','interior','classroom','library','projector','gallery','cafe','café','living room','compute','counter','shelves']}
def season(p,meta):
 p=p.lower()
 patterns=[r'media/drone/(202[0-6])/',r'brahman (2020)',r'/(2021) discord/',r'kif (2024)/',r'mars(23)highlights',r'discord/mars college/\[? ?(202[0-6])',r'/by_year/(202[0-6])/']
 for pat in patterns:
  m=re.search(pat,p)
  if m: return int('20'+m[1] if len(m[1])==2 else m[1])
 years=meta.get('year_candidates',[])
 return int(years[0]) if len(years)==1 and str(years[0]).isdigit() else None
rows=[];counts=Counter()
for record in c.execute("select * from media where media_type in ('image','video')"):
 r=dict(record);p=r['rel_path'];m=json.loads(r['metadata_json'] or '{}');y=season(p,m)
 if y not in range(2020,2027):continue
 if re.search(r'media/(ai|gallery|people|film_festival)/',p,re.I):continue
 if re.search(r'/(bots|un-build|unbuild)\b',p,re.I):continue
 counts[y]+=1
 v=m.get('openai_vision',{});text=(r['caption']+' '+v.get('visual_observation_text','')).lower()
 if re.search(r'ai.generated|sketchup|3d render|digital render|architectural render|screen capture of',text):continue
 campus=sum(text.count(t) for t in ['chiba','pallet','rack','campus','camp ','encampment','kitchen','wooden structure','scaffold','modular','portal'])
 if not campus:continue
 # Explicit dates identify construction for the following winter, and teardown.
 match=re.search(r'(202[0-6])[-_]?([01]\d)[-_]?([0-3]\d)',Path(p).name)
 date=''
 if match:
  date='-'.join(match.groups());cy,mo,day=map(int,match.groups())
  if mo>=11:y=cy+1
  elif 1<=mo<=4:y=cy
  if y not in range(2020,2027):continue
 date_bonus=5 if date and date[5:7] in ('02','03') else 0
 if date and date[5:7] in ('04','05'):date_bonus=-15
 r={k:r[k] for k in ['media_id','source','rel_path','abs_path','source_path','media_type','year_text','caption','metadata_json']}
 r['season']=y;r['date_hint']=date;r['fingerprint']=m.get('asset_fingerprint',p)
 r['scores']={facet:sum(min(text.count(t),3)*3 for t in terms)+min(campus,8)+date_bonus for facet,terms in FACETS.items()}
 r['observations']=v.get('visual_observation_text','');rows.append(r)
OUT.mkdir(exist_ok=True,parents=True)
(OUT/'catalog-audit.json').write_text(json.dumps({'scanned_by_season':dict(counts),'candidates':rows},indent=2))
indexer=media.load_indexer()
for year in range(2020,2027):
 cohort=[r for r in rows if r['season']==year];(OUT/str(year)).mkdir(exist_ok=True)
 for facet in FACETS:
  selected=[];seen=set()
  for r in sorted([r for r in cohort if r['media_type']=='image'],key=lambda r:r['scores'][facet],reverse=True):
   if r['fingerprint'] in seen:continue
   if facet=='aerial' and not any(t in r['observations'].lower()+r['caption'].lower() for t in FACETS[facet]):continue
   seen.add(r['fingerprint']);selected.append(r)
   if len(selected)==24:break
  (OUT/str(year)/f'{facet}.json').write_text(json.dumps(selected,indent=2))
  if not selected:continue
  sheet=Image.new('RGB',(1440,((len(selected)+3)//4)*255),'#eee');d=ImageDraw.Draw(sheet)
  for i,r in enumerate(selected):
   thumb=indexer.thumbnail_for_row(r,(354,215));x=(i%4)*360;y=(i//4)*255;sheet.paste(thumb,(x,y));d.text((x+3,y+217),f'{year} {facet} {i+1:02d} | {r["date_hint"]}\n{Path(r["rel_path"]).name[:45]}',fill='black')
  sheet.save(OUT/str(year)/f'{facet}.jpg',quality=85)
 print(year,'candidate files',len(cohort),flush=True)
