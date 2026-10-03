import pathlib,json,struct,numpy as np,urllib.request
b=pathlib.Path('<mars-media>/reconstruction/2026-campus');out=b/'deliverable';results=[];manifest=json.load(open(out/'manifest.json'))
for m in manifest['models']:
 p=out/(m['id']+'.glb');blob=p.read_bytes();magic,version,length=struct.unpack_from('<4sII',blob);n,typ=struct.unpack_from('<II',blob,12);d=json.loads(blob[20:20+n]);assert magic==b'glTF' and version==2 and length==len(blob);tris=sum(d['accessors'][prim['indices']]['count']//3 for mesh in d['meshes'] for prim in mesh['primitives']);assert tris==m['triangles'];assert all('uri' not in im for im in d.get('images',[]));assert (out/(m['id']+'.blend')).stat().st_size>10000
 for v in m['views']:
  assert (out/v['image'].replace('/data/','')).exists();assert np.isfinite(v['position']).all();assert abs(np.linalg.norm(v['quaternion'])-1)<.001;assert 10<v['fov']<100
 results.append({'id':m['id'],'bytes':len(blob),'triangles':tris,'embedded_images':len(d['images']),'camera_comparisons':len(m['views']),'heldout_views':sum(v.get('heldOut',False) for v in m['views'])})
for path in ['','data/manifest.json','data/report.html','data/chiba.glb','data/campus.glb']:
 req=urllib.request.Request('http://localhost:4326/'+path,method='HEAD')
 with urllib.request.urlopen(req) as r:assert r.status==200
(b/'validation/deliverable-verification.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
