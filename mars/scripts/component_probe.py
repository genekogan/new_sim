import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import bpy,json,pathlib,collections,numpy as np
p=media('reconstruction/2026-campus/modular/research');bpy.ops.wm.open_mainfile(filepath=str(p/'cad-reference.blend'))
rows=[]
for m in bpy.data.materials:
 if not m.use_nodes:continue
 bs=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if bs:
  c=list(bs.inputs['Base Color'].default_value)
  if c[0]>.2 and c[0]>c[1]*1.5 and c[0]>c[2]*2:rows.append([m.name,c])
print('ORANGE',rows)
o=bpy.data.objects['3DGeom-6653'];vs=np.array([o.matrix_world@v.co for v in o.data.vertices]);print('verts',len(vs));print('positions',vs[:12]);print('bounds',vs.min(0),vs.max(0))
