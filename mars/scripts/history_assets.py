import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
"""Publish deliberately reviewed campus references; keep full provenance in private research."""
import json,sys,re
from pathlib import Path
from PIL import Image,ImageOps
ROOT=mars_root();DATA=ROOT/'docs/media/reconstruction/campus-history';OUT=ROOT/'code/campus-2026-reconstruction/viewer/public/history'
sys.path.insert(0,str(ROOT/'tools/media'));import mars_media
idx=mars_media.load_indexer()
selected={2020:{'interior':[4,5,9,15,16,19,24],'exterior':[1,2,3]},2021:{'aerial':[1,21],'interior':[5,8,10,18,23]},2022:{'aerial':[2,3,10,15,18],'exterior':[9,10,11,20,24],'interior':[1,3,4,7,8,14,15,23]},2023:{'aerial':[1,9],'exterior':[4,5,9,10,12,18,19,20],'interior':[1,2,5,6,15,18,21]},2024:{'aerial':[1,20],'exterior':[1,4,6,13,15,19,21],'interior':[3,8,11,12,13,18]},2025:{'aerial':[1,4],'exterior':[3,7,13,16,18,19,20],'interior':[1,3,4,5,10,11,12]},2026:{'exterior':[3,4,7,15,16,18,20,22],'interior':[7,8,9,10,12,13,18,21,24]}}
additional={2020:{'rooms':[6,8,10,13]},2021:{'hall':[3,5],'rooms':[1,7,13,15],'exterior':[4,7,11,17]},2022:{'hall':[1,3,7]},2023:{'hall':[1,5,17],'rooms':[1,5,6,8]},2024:{'hall':[2,4,11,19,21],'rooms':[3,5,17]},2025:{'hall':[3,8,15],'rooms':[8,9,13,14,24]},2026:{'hall':[1,6,12,19,21,23],'rooms':[7,15,23]}}
for year,facets in additional.items():
 for facet,indices in facets.items(): selected[year].setdefault(facet,[]).extend(indices)
selected[2020]['exterior']=[1,2,9,12,15]
for year,facets in selected.items():
 dest=OUT/str(year);dest.mkdir(parents=True,exist_ok=True);public=[];private=[]
 for facet,indices in facets.items():
  rows=json.loads((DATA/str(year)/(facet+'.json')).read_text())
  for i in indices:
   r=rows[i-1];name=f'{facet}-{i:02d}';p=dest/(name+'.webp')
   try:
    im=ImageOps.exif_transpose(Image.open(r['abs_path'])).convert('RGB');im.thumbnail((1440,1100));im.save(p,quality=83,method=6)
   except Exception:
    im=idx.thumbnail_for_row(r,(1440,1100));im.save(p,quality=83,method=6)
   public.append({'id':name,'title':f'{year} · {facet} · {i:02d}','caption':f'Selected {facet} reference. '+('Capture-date hint: '+r['date_hint']+'. ' if r['date_hint'] else '')+'Photographs guide the reconstruction; hidden dimensions remain estimated.','url':f'/history/{year}/{name}.webp','source_path':Path(r['rel_path']).name})
   private.append(r)
 (dest/'references.json').write_text(json.dumps(public,indent=2));(DATA/str(year)/'reviewed-sources.json').write_text(json.dumps(private,indent=2))
# Crops from visually inspected photographs, normalized source coordinates.
crops=[(2022,'exterior-20',(0,.43,1,.758),'arches'),(2022,'exterior-20',(0,.10,.33,.425),'arches-upper'),(2023,'interior-21',(.08,.105,.975,.405),'swirls'),(2023,'interior-21',(.02,.51,.85,.73),'cafe-front'),(2025,'exterior-07',(.355,.584,.504,.678),'flower')]
crops.extend([(2024,'exterior-01',(.21,.25,.54,.445),'flower'),(2024,'exterior-01',(.55,.45,.88,.9),'red-wall'),(2024,'exterior-01',(.56,.255,.89,.425),'orange-wall'),(2024,'exterior-01',(.257,.565,.395,.642),'entry')])
for year,src,rect,name in crops:
 im=Image.open(OUT/str(year)/(src+'.webp'));w,h=im.size;im=im.crop(tuple(round(v*(w if i%2==0 else h)) for i,v in enumerate(rect)));im.thumbnail((1024,1024));im.save(OUT/str(year)/(name+'.webp'),quality=90)
print('Prepared',sum(len(v) for fs in selected.values() for v in fs.values()),'review references')

# Retain the previously verified March drone views of Brahman.
p=OUT/'2020/references.json';refs=json.loads(p.read_text());old=(OUT.parent.parent/'app/studio-2020/page.tsx').read_text();aerial=[]
for image,title,source,description in re.findall(r"\{ image: '([^']+)', title: '([^']+)', source: '([^']+)', description: '([^']+)' \}",old):
 aerial.append({'id':'aerial-'+Path(image).stem,'title':title,'caption':description,'url':image,'source_path':source.split('/')[-1]})
p.write_text(json.dumps(aerial+refs,indent=2))
