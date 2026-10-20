# postercount.py <dir>: per run, tag frames C (cream >80%), K (black/dark >80%), W (other = world); report first W and any C/K after the first W
import sys,glob,os,re
from PIL import Image
runs={}
for f in sorted(glob.glob(sys.argv[1]+'/r*-f-*.png')):
  m=re.match(r'r(\d+)-f-(\d+)\.png',os.path.basename(f)); im=Image.open(f).convert('RGB').resize((39,84)); px=im.get_flattened_data() if hasattr(im,'get_flattened_data') else list(im.getdata())
  cream=sum(1 for r,g,b in px if r>215 and g>205 and b>180 and abs(r-b)<70)/len(px); dark=sum(1 for r,g,b in px if r+g+b<45)/len(px)
  runs.setdefault(int(m[1]),[]).append((int(m[2]),'C' if cream>.8 else 'K' if dark>.8 else 'W'))
for k,fr in sorted(runs.items()):
  fw=next((t for t,c in fr if c=='W'),None); bad=[f'{t}{c}' for t,c in fr if fw is not None and t>fw and c!='W']
  print(k,'firstWorld',fw,'frames',len(fr),'blank-after-world',bad or 0,' '.join(f'{t}:{c}' for t,c in fr[:12]))
