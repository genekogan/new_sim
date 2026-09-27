import json,subprocess,pathlib,concurrent.futures,math
from PIL import Image,ImageDraw
ROOT=pathlib.Path('~/Mars'); OUT=ROOT/'docs/media/reconstruction/2026-campus'
rows=json.loads((OUT/'inventory/probed.json').read_text())
rows=[r for r in rows if 'duration' in r and ('/drone/2026/' in r['path'] or '/gandala/DJI_' in r['path'])]
def make(r):
 folder=OUT/'review/storyboards'/r['id'];folder.mkdir(parents=True,exist_ok=True)
 step=12 if r['duration']>100 else 5; times=list(range(0,int(r['duration']),step))
 for i,t in enumerate(times):
  p=folder/f'{i:04d}.jpg'
  if not p.exists():subprocess.run(['ffmpeg','-v','error','-threads','2','-ss',str(t),'-i',str(ROOT/r['path']),'-frames:v','1','-vf','scale=384:-1','-q:v','4','-y',str(p)],check=True)
 for start in range(0,len(times),25):
  part=times[start:start+25]; im=Image.new('RGB',(1920,math.ceil(len(part)/5)*242),'#202326');d=ImageDraw.Draw(im)
  for k,t in enumerate(part):
   tile=Image.open(folder/f'{start+k:04d}.jpg');im.paste(tile,((k%5)*384,(k//5)*242+24));d.text(((k%5)*384+5,(k//5)*242+5),f"{r['id']} {pathlib.Path(r['path']).name} {t}s",fill='white')
  im.save(folder/f'sheet_{start//25:02d}.jpg')
 print(r['id'],len(times),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(make,rows))
