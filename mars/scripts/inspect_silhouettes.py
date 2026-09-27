import bpy,pathlib,json,math
import numpy as np
from mathutils import Vector
O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable');R=O.parent/'research/silhouettes'
bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene
rows=json.load(open(R/'candidates.json'));chosen=[];seen=set()
for row in rows:
 key=(row['vertices'],row['polygons'],tuple(m[0] for m in row['materials']))
 if key in seen:continue
 if any(max(m[1][:3])<.08 or 'Ty_' in m[0] or m[0]=='Body' for m in row['materials']):chosen.append(row);seen.add(key)
objects={o.get('component_id'):o for o in s.objects if o.type=='MESH'}
for o in s.objects:
 if o.type=='MESH':o.hide_render=True
cam=s.camera;cam.data.type='ORTHO';s.render.resolution_x=480;s.render.resolution_y=480;s.render.resolution_percentage=100;s.cycles.samples=1;s.render.film_transparent=False
s.world.color=(.8,.8,.8);s.view_settings.view_transform='Standard'
# A light neutral clay pass makes black CAD shapes readable.
mat=bpy.data.materials.new('Inspection clay');mat.use_nodes=True;ns=mat.node_tree.nodes;em=ns.new('ShaderNodeEmission');em.inputs['Color'].default_value=(.65,.65,.65,1);mat.node_tree.links.new(em.outputs[0],ns.get('Material Output').inputs['Surface']);s.view_layers[0].material_override=mat
for row in chosen:
 o=objects[row['id']];o.hide_render=False;o.data=o.data.copy();o.data.materials.clear();o.data.materials.append(mat);lo,hi=map(Vector,row['bounds']);c=(lo+hi)/2;d=hi-lo
 pts=np.array([o.matrix_world@v.co for v in o.data.vertices]);_,axes=np.linalg.eigh(np.cov(pts[:,:2].T));direction=Vector((float(-axes[1,0]),float(axes[0,0]),.12));cam.location=c+direction*6;cam.rotation_euler=(c-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=max(d)*1.5
 s.render.filepath=str(R/(row['id']+'.png'));bpy.ops.render.render(write_still=True);o.hide_render=True
(R/'rendered.json').write_text(json.dumps(chosen,indent=2));print('RENDERED',len(chosen))
