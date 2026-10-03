import pathlib,json,struct,io
from PIL import Image
O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable')
for name in ['campus-components.glb','chiba-components.glb','chiba-photo-reference.glb']:
 p=O/name;raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);bstart=20+n+8;binary=raw[bstart:];images={im['bufferView']:im for im in doc.get('images',[]) if 'bufferView'in im};new=bytearray();sizes=[]
 for i,view in enumerate(doc['bufferViews']):
  payload=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
  if i in images:
   iminfo=images[i];im=Image.open(io.BytesIO(payload));namehint=iminfo.get('name','');lim=4096 if 'projection' in namehint or name=='chiba-photo-reference.glb' else 1024;im.thumbnail((lim,lim));hasalpha='A' in im.getbands() and im.getchannel('A').getextrema()[0]<255;buf=io.BytesIO()
   if hasalpha:im.save(buf,format='PNG',optimize=True);iminfo['mimeType']='image/png'
   else:im.convert('RGB').save(buf,format='JPEG',quality=90 if 'projection' in namehint else 85,optimize=True);iminfo['mimeType']='image/jpeg'
   payload=buf.getvalue();sizes.append(len(payload))
  while len(new)%4:new.append(0)
  view['byteOffset']=len(new);view['byteLength']=len(payload);new.extend(payload)
 while len(new)%4:new.append(0)
 doc['buffers'][0]['byteLength']=len(new);js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);data=struct.pack('<4sII',b'glTF',2,28+len(js)+len(new))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(new),b'BIN\0')+new;p.write_bytes(data);print(p.name,len(raw),'->',len(data),'imagebytes',sum(sizes))
