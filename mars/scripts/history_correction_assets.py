import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
"""Publish reviewed correction evidence; never mutate source media."""
import json, html, re
from pathlib import Path
from PIL import Image,ImageOps
ROOT=mars_root();BASE=ROOT/'docs/media/reconstruction/campus-history';RESEARCH=BASE/'corrections-20260926';OUT=ROOT/'code/campus-2026-reconstruction/viewer/public/history'
selections={2021:[(18,'corridor-ground','Separate rack buildings and bare desert aisle','Ground view shows the unfloored corridor between the two parallel buildings.'),(30,'corridor-occupied','Ground-level corridor in use','People occupy the bare-ground aisle alongside the raised side decks.')],2022:[(29,'courtyard-elevated','Elevated courtyard view','Four separate sides and ground-level access gaps; construction-stage view used for geometry, not late-season finishes.'),(41,'courtyard-march','March rooftop panorama','Late-season painted buildings and open central courtyard seen from the roof.')],2024:[(5,'front-full','Full frontage — painted wall, solar and glazing','Near-frontal group photograph: the left PV array steps inward; the right wing is glazing. The central mural remains exposed.'),(28,'front-oblique','January 29 — raked frontage and reused windows','Oblique view establishes the slope of the frontage and the right-hand glazing/eye insert. Earlier paint state; March references govern the mural.') ]}
private=[]
for year,choices in selections.items():
 rows=json.loads((RESEARCH/f'{year}.json').read_text());p=OUT/str(year)/'references.json';refs=json.loads(p.read_text())
 for index,name,title,caption in choices:
  row=rows[index-1];im=ImageOps.exif_transpose(Image.open(row['abs_path'])).convert('RGB');im.thumbnail((1800,1400));im.save(OUT/str(year)/(name+'.webp'),quality=85,method=6)
  refs=[r for r in refs if r['id']!=name];refs.insert(0,{'id':name,'title':title,'caption':caption,'url':f'/history/{year}/{name}.webp','source_path':Path(row['abs_path']).name});private.append({'year':year,'id':name,'source':row})
 p.write_text(json.dumps(refs,indent=2))
for year,name,source,timestamp,title,caption in [
 (2021,'aluminet-flythrough','media/drone/2021/flythrough_2.16.2021-74D4C.mp4',54,'February 16 flythrough — aluminet','Aerial close view of the woven silver shade suspended over the gap between the buildings.'),
 (2022,'courtyard-orbit','mars-archive/DJI_0806-D7C7F.mov',8,'Drone orbit — courtyard from another side','Independent oblique drone angle showing four buildings and their end stairs around the courtyard.')]:
 frame=RESEARCH/('2021-flythrough-54.jpg' if year==2021 else '2022-orbit-08.jpg');im=Image.open(frame);im.thumbnail((1800,1200));im.save(OUT/str(year)/(name+'.webp'),quality=85,method=6)
 p=OUT/str(year)/'references.json';refs=[r for r in json.loads(p.read_text()) if r['id']!=name];refs.insert(0,{'id':name,'title':title,'caption':caption,'url':f'/history/{year}/{name}.webp','source_path':f'{Path(source).name} · {timestamp}s'});p.write_text(json.dumps(refs,indent=2));private.append({'year':year,'id':name,'source_path':source,'timestamp_seconds':timestamp})
# Eye-painted insert, isolated from the previously reviewed oblique source.
im=Image.open(OUT/'2024/front-oblique.webp');w,h=im.size;im=im.crop((int(w*.653),int(h*.434),int(w*.728),int(h*.548)));im.save(OUT/'2024/eye.webp',quality=90)
(RESEARCH/'published-sources.json').write_text(json.dumps(private,indent=2))
# Regenerate the public index from the same reviewed reference lists, preserving the other years.
p=OUT/'README.html';text=p.read_text()
text=text.replace('Archived SketchUp plans provide dimensional cross-checks but contain alternate proposals; they are not automatically evidence of what was built.', 'SketchUp files are pre-season design proposals, largely abandoned in practice. They are not as-built evidence and must not determine the reconstruction. Photographs and participant corrections take precedence.')
replacements={
2021:'Two separate long rack buildings, with an equally wide bare-ground corridor and draped silver aluminet. February 16 drone flythrough and ground views establish these features; exact dimensions and hidden room boundaries remain estimated.',
2022:'Four buildings rotated around a square shared courtyard, with an open passage between the end of each building and the side of the next. DJI_0829 overhead, an additional DJI_0806 drone orbit and March rooftop views replace the previous proposal-based placement. Nominal rack dimensions constrain scale; spacing remains estimated.',
2023:'Broad Chiba roof terrace, inclined solar frontage and a separate kitchen. The existing seven-bay footprint was influenced by a pre-season proposal and remains provisional pending stronger photographic measurement; it is not verified as-built geometry.',
2024:'March photos show stepped solar coverage on the left and salvaged glazing with an eye insert on the right. The central painted frontage remains exposed. January 29 oblique views establish the raked wall geometry; March photographs govern the late-season paint state.'}
for year,description in replacements.items():
 text=re.sub(r'(<section id="year-'+str(year)+r'">.*?</h2><p>).*?(</p>)',lambda m:m[1]+description+m[2],text,flags=re.S)
for year in selections:
 refs=json.loads((OUT/str(year)/'references.json').read_text());links=''.join(f'<a href="{html.escape(r["url"])}">{html.escape(r["title"])}<small>{html.escape(r["caption"])}</small></a>' for r in refs)
 text=re.sub(r'(<section id="year-'+str(year)+r'">.*?<div class="refs">).*?(</div>)',lambda m:m[1]+links+m[2],text,flags=re.S)
p.write_text(text)
p=BASE/'README.md';text=p.read_text()
for year,description in replacements.items():text=re.sub(r'(## '+str(year)+r'\n\n).*?(?=\n## )',lambda m:m[1]+description+'\n',text,flags=re.S)
text+='\n## Correction policy (2026-09-26)\n\nGene confirms that the SketchUp files are pre-season proposals, largely abandoned. They are not as-built dimensional evidence. Never derive placement or proportions from these files without independent photographic confirmation. The previous claim that the 2022 CAD footprint was verified was incorrect and has been withdrawn.\n\n`corrections-20260926/` contains three 72-candidate reviews, extracted drone frames, and exact provenance for the additional published references. `history_correction_assets.py` reproduces those optimized copies after `history_assets.py`. Width equality in the 2021 corridor and rotational symmetry in 2022 are also supported by Gene’s first-person correction. Exact dimensions, cloth sag and window subdivisions are photographic estimates.\n'
p.write_text(text)
print('Prepared correction references, eye insert and corrected evidence index')
