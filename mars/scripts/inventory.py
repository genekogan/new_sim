import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
import json,subprocess,pathlib,concurrent.futures
from PIL import Image,ImageDraw
ROOT=mars_root(); OUT=ROOT/'docs/media/reconstruction/2026-campus'
rows=json.loads((OUT/'inventory/catalog_candidates.json').read_text())
def inspect(pair):
 i,r=pair; p=ROOT/r['rel_path']; d={'id':f'v{i:03d}','path':r['rel_path'],'bytes':r['bytes'],'caption':r['caption']}
 try:
  if r['media_type']=='video':
   meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(p)])); s=next(s for s in meta['streams'] if s['codec_type']=='video'); d.update(width=s['width'],height=s['height'],duration=float(meta['format']['duration']),tags=meta['format'].get('tags',{})); times=[d['duration']*f for f in [.1,.5,.9]]
   for j,t in enumerate(times):
    dest=OUT/f'review/{i:03d}_{j}.jpg'; subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(p),'-frames:v','1','-vf','scale=480:-1','-y',str(dest)],check=True);d.setdefault('thumbs',[]).append(str(dest.relative_to(OUT)))
  else:
   im=Image.open(p);d.update(width=im.width,height=im.height,exif={str(k):str(v) for k,v in im.getexif().items() if k in [306,36867,272,271]});im.thumbnail((480,300)); dest=OUT/f'review/{i:03d}_0.jpg';im.convert('RGB').save(dest);d['thumbs']=[str(dest.relative_to(OUT))]
 except Exception as e:d['error']=str(e)
 print(d['id'],p.name,d.get('duration'),d.get('tags',{}).get('creation_time'),flush=True);return d
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: data=list(pool.map(inspect,enumerate(rows)))
(OUT/'inventory/probed.json').write_text(json.dumps(data,indent=2))
for start in range(0,len(data),12):
 group=data[start:start+12]; sheet=Image.new('RGB',(1440,len(group)*300),'#202326');draw=ImageDraw.Draw(sheet)
 for y,r in enumerate(group):
  label=f"{r['id']} {r['path']} | {r.get('duration','photo')}s {r.get('tags',{}).get('creation_time','')}"; draw.text((8,y*300+4),label,fill='white')
  for j,f in enumerate(r.get('thumbs',[])):
   im=Image.open(OUT/f); im.thumbnail((478,268));sheet.paste(im,(j*480,y*300+26))
 sheet.save(OUT/f'review/sheet_{start//12:02d}.jpg')
