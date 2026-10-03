"""Repack a derived GLB with 1024px textures; source GLB/textures stay untouched."""
import io,json,struct,pathlib,hashlib
from PIL import Image
root=pathlib.Path(__file__).resolve().parents[1]
source=root/'public/modular/campus-components.glb'
f=io.BytesIO(source.read_bytes());f.read(12);n,_=struct.unpack('<II',f.read(8));g=json.loads(f.read(n));n,_=struct.unpack('<II',f.read(8));binary=f.read(n)
images={im['bufferView']:im for im in g['images']};data=bytearray();before=after=0
for i,v in enumerate(g['bufferViews']):
 payload=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
 if i in images:
  im=Image.open(io.BytesIO(payload));before+=im.width*im.height*4*4/3
  if max(im.size)>1024:
   im.thumbnail((1024,1024),Image.Resampling.LANCZOS);out=io.BytesIO();im.save(out,format='PNG' if images[i]['mimeType']=='image/png' else 'JPEG',quality=90);payload=out.getvalue()
  after+=im.width*im.height*4*4/3
 while len(data)%4:data.append(0)
 v['byteOffset']=len(data);v['byteLength']=len(payload);data.extend(payload)
while len(data)%4:data.append(0)
g['buffers'][0]['byteLength']=len(data)
js=json.dumps(g,separators=(',',':')).encode();js+=b' '*((-len(js))%4)
result=struct.pack('<III',0x46546c67,2,28+len(js)+len(data))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(data),0x004e4942)+data
out=root/'public/browser/campus.glb';out.parent.mkdir(exist_ok=True);out.write_bytes(result)
print(json.dumps({'browser_bytes':len(result),'source_gpu_mib':before/2**20,'browser_gpu_mib':after/2**20,'sha256':hashlib.sha256(result).hexdigest()}))
