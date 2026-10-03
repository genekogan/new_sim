import bpy,pathlib,json,numpy as np,math
from mathutils import Vector
b=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/research');bpy.ops.wm.open_mainfile(filepath=str(b/'cad-reference.blend'));rows=[];angles=[]
for o in bpy.context.scene.objects:
 row={'name':o.name,'parent':o.parent.name if o.parent else None,'type':o.type,'world_matrix':[list(v) for v in o.matrix_world],'local_matrix':[list(v) for v in o.matrix_local]}
 if o.type=='MESH':
  v=np.array([list(o.matrix_world@p.co) for p in o.data.vertices]);row.update(bounds=[v.min(0).tolist(),v.max(0).tolist()],materials=[s.material.name if s.material else '' for s in o.material_slots],polygons=len(o.data.polygons))
  if 160<v[:,0].mean()<195 and 45<v[:,1].mean()<88:
   for e in o.data.edges:
    d=v[e.vertices[1]]-v[e.vertices[0]];l=np.linalg.norm(d)
    if l>2 and abs(d[2])<.02:angles.append([math.atan2(d[1],d[0])%(math.pi/2),l])
 rows.append(row)
(b/'cad-transforms.json').write_text(json.dumps(rows));a=np.array(angles);hist,edges=np.histogram(a[:,0],bins=180,range=(0,np.pi/2),weights=a[:,1]);theta=(edges[hist.argmax()]+edges[hist.argmax()+1])/2;print('ANGLE',math.degrees(theta),flush=True);(b/'cad-orientation.json').write_text(json.dumps({'dominant_angle_degrees':math.degrees(theta)}))
print('uprights',[(o.name,list(o.matrix_world.translation)) for o in bpy.context.scene.objects if 'upright' in o.name][:8],flush=True)
