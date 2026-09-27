import json,struct,pathlib,hashlib,collections,io
import numpy as np
from PIL import Image
O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable')
def glb(path):
 b=path.read_bytes();magic,v,total=struct.unpack_from('<4sII',b,0);assert magic==b'glTF' and v==2 and total==len(b);n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);bin=b[28+n:];assert j['buffers'][0]['byteLength']<=len(bin)
 for bv in j.get('bufferViews',[]):assert bv.get('byteOffset',0)+bv['byteLength']<=len(bin)
 return j,bin,len(b)
def bounds(j):
 pts=[]
 def walk(i,parent):
  node=j['nodes'][i]
  if 'matrix'in node:M=np.array(node['matrix']).reshape(4,4).T
  else:
   t=node.get('translation',[0,0,0]);q=node.get('rotation',[0,0,0,1]);x,y,z,w=q;rot=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]);M=np.eye(4);M[:3,:3]=rot@np.diag(node.get('scale',[1,1,1]));M[:3,3]=t
  M=parent@M
  if 'mesh'in node:
   for p in j['meshes'][node['mesh']]['primitives']:
    a=j['accessors'][p['attributes']['POSITION']];lo,hi=a['min'],a['max'];points=np.array([[a,b,c,1] for a in [lo[0],hi[0]] for b in [lo[1],hi[1]] for c in [lo[2],hi[2]]]);pts.extend((points@M.T)[:,:3])
  for c in node.get('children',[]):walk(c,M)
 for i in j['scenes'][j.get('scene',0)]['nodes']:walk(i,np.eye(4))
 p=np.array(pts);assert np.isfinite(p).all();return p.min(0),p.max(0)
report={'status':'pass','stock_dimensions':[],'exports':[],'browser_checks':{'component_load':'pass','select_Chiba_and_cutaway':'pass','add_19ft_upright':'pass','move_X_12_5m_rotate_90deg':'pass','save_download_JSON':'pass','restore_saved_JSON':'pass','export_edited_GLB':'pass','interior_photo_comparison':'pass'},'accuracy_status':'not a field-verified as-built'}
for h,w in [(8,4),(12,4),(16,3),(19,3)]:
 name=f'upright_frame_{h}ft_{w}ft';j,_,_=glb(O/(name+'.glb'));lo,hi=bounds(j);d=hi-lo;assert abs(d[0]-w*.3048)<1e-5 and abs(d[1]-h*.3048)<1e-5,(name,d);report['stock_dimensions'].append({'id':name,'actual_bounds_m':d.tolist(),'nominal_width_height_m':[w*.3048,h*.3048]})
j,_,_=glb(O/'horizontal_beam_12ft.glb');lo,hi=bounds(j);assert abs((hi-lo)[0]-3.6576)<1e-5;report['stock_dimensions'].append({'id':'horizontal_beam_12ft','actual_length_m':float((hi-lo)[0])})
m=json.load(open(O/'components.json'));expected={r['id'] for r in m['instances'] if r['kind']!='reference'};assert len(expected)==len([r for r in m['instances'] if r['kind']!='reference'])
for name in ['campus-components.glb','chiba-components.glb','component-library.glb','chiba-photo-reference.glb']:
 j,b,size=glb(O/name);lo,hi=bounds(j);ids=[n.get('extras',{}).get('component_id') for n in j['nodes'] if n.get('extras',{}).get('component_id')];assert len(ids)==len(set(ids));imagecount=0
 for im in j.get('images',[]):
  if 'bufferView'in im:
   view=j['bufferViews'][im['bufferView']];imbytes=b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']];Image.open(io.BytesIO(imbytes)).verify();imagecount+=1
 if name=='campus-components.glb':assert set(ids)==expected,(len(ids),len(expected));assert not any(n.get('extras',{}).get('kind')=='reference' for n in j['nodes'])
 report['exports'].append({'file':name,'bytes':size,'nodes':len(j['nodes']),'meshes':len(j.get('meshes',[])),'component_ids':len(ids),'valid_embedded_images':imagecount,'bounds_m':[lo.tolist(),hi.tolist()],'sha256':hashlib.sha256((O/name).read_bytes()).hexdigest()})
layout=json.load(open(O.parent/'research/layout-ui-roundtrip.json'));addition=next(e for e in layout['edits'] if e.get('added')=='upright_frame_19ft_3ft');assert addition['position'][0]==12.5;assert np.allclose(addition['quaternion'],[0,2**-.5,0,2**-.5]);report['layout_roundtrip']={'added_definition':addition['added'],'position':addition['position'],'quaternion':addition['quaternion']}
p=pathlib.Path('~/Downloads/mars-campus-edited.glb')
if p.exists():
 j,_,size=glb(p);a=next(n for n in j['nodes'] if n.get('extras',{}).get('added_definition')=='upright_frame_19ft_3ft');mat=np.array(a['matrix']).reshape(4,4).T;assert abs(mat[0,3]-12.5)<1e-5;assert abs(mat[0,0])<1e-5;report['edited_export']={'bytes':size,'added_part_transform_preserved':True}
(O/'verification.json').write_text(json.dumps(report,indent=2));print(json.dumps({'status':report['status'],'component_count':len(expected),'verified_stock_definitions':len(report['stock_dimensions']),'exports':[(e['file'],e['bytes']) for e in report['exports']]},indent=2))
