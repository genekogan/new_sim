import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
import pathlib,json,subprocess,concurrent.futures,shutil
from PIL import Image
ROOT=mars_root();OUT=ROOT/'docs/media/reconstruction/2026-campus'; dest=OUT/'frames/campus-march19';dest.mkdir(exist_ok=True)
selection={'DJI_0002.MP4':[(0,192,2),(350,398,2),(422,508,2)],'DJI_0014.MP4':[(0,70,2),(78,106,2),(296,345,2)]}
rows=[]
for name,ranges in selection.items():
 for lo,hi,step in ranges:
  for t in range(lo,hi,step):rows.append({'file':f'{name[:-4]}_{t:04d}.jpg','source':f'media/drone/2026/{name}','timestamp_seconds':t,'split':'train','date':'2026-03-19'})
def extract(r):
 p=dest/r['file']
 if not p.exists():subprocess.run(['ffmpeg','-v','error','-threads','2','-ss',str(r['timestamp_seconds']),'-i',str(ROOT/r['source']),'-frames:v','1','-q:v','2','-y',str(p)],check=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(extract,rows))
for p in sorted((ROOT/'media/drone/2026').glob('*.JPG')):
 ex=Image.open(p).getexif()
 if str(ex.get(306,'')).startswith('2026:03:19'):
  name='photo_'+p.name;shutil.copy2(p,dest/name);gps=ex.get_ifd(34853)
  def degrees(v):return float(v[0])+float(v[1])/60+float(v[2])/3600
  rows.append({'file':name,'source':str(p.relative_to(ROOT)),'date':ex.get(306),'split':'train','gps':[degrees(gps[2]),-degrees(gps[4]),float(gps[6])*(-1 if gps[5]==b'\x01' else 1)]})
(OUT/'inventory/campus-march19-frames.json').write_text(json.dumps(rows,indent=2)); print(len(rows),'frames',flush=True)
