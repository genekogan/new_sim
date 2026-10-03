import bpy,pathlib,json,math
import numpy as np
from mathutils import Vector,Matrix
B=pathlib.Path('<mars-media>/reconstruction/2026-campus');R=B/'modular/research';O=B/'modular/deliverable';T=O/'textures';T.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(B/'models/orbit-raw/campus.blend'));scene=bpy.context.scene
fit=json.load(open(R/'chiba-local-alignment.json'));s=fit['scale'];r=np.array(fit['rotation']);t=np.array(fit['translation'])-np.array([177,66]);M=Matrix.Identity(4)
for i in range(2):
 for j in range(2):M[i][j]=float(s*r[i,j])
 M[i][3]=float(t[i])
M[2][2]=s
textures=[]
for im in bpy.data.images:
 if im.type=='IMAGE' and im.has_data:
  name='chiba-drone-atlas.png';im.filepath_raw=str(T/name);im.file_format='PNG';im.save();textures.append(name)
saved=[(o,o.matrix_world.copy()) for o in scene.objects if o.type=='MESH']
for o,w in saved:o.parent=None;o.matrix_world=M@w
for o in list(scene.objects):
 if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
# Save an aligned reference separately, not as a replacement for editable components.
for o in scene.objects:o['role']='Photographic reference skin; approximate manual roof registration';o['alignment_roof_rms_m']=fit['rms_m']
bpy.ops.export_scene.gltf(filepath=str(O/'chiba-photo-reference.glb'),export_format='GLB',export_extras=True)
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 ns=mat.node_tree.nodes;bs=next((n for n in ns if n.type=='BSDF_PRINCIPLED'),None);op=next((n for n in ns if n.type=='OUTPUT_MATERIAL'),None)
 if bs and op:
  em=ns.new('ShaderNodeEmission');em.inputs['Color'].default_value=bs.inputs['Base Color'].default_value
  for link in bs.inputs['Base Color'].links:mat.node_tree.links.new(link.from_socket,em.inputs['Color'])
  mat.node_tree.links.new(em.outputs[0],op.inputs['Surface'])
scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=4096;scene.render.resolution_y=4096;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Neutral');scene.world.color=(0,0,0);scene.view_settings.view_transform='Standard';scene.render.film_transparent=True
cd=bpy.data.cameras.new('Projection camera');cam=bpy.data.objects.new('Projection camera',cd);scene.collection.objects.link(cam);scene.camera=cam;cd.type='ORTHO';cd.ortho_scale=44;cd.clip_end=10000;center=Vector((0,0,3));views=[]
u=Vector((.9045,-.4265,0));v=Vector((.4265,.9045,0))
for name,direction in [('roof',Vector((0,0,1))),('long-south',-v),('long-north',v),('end-east',u),('end-west',-u)]:
 cam.location=center+direction*90;cam.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler();bpy.context.view_layer.update();scene.render.filepath=str(T/f'chiba-{name}-projection.png');bpy.ops.render.render(write_still=True);views.append({'id':name,'file':f'chiba-{name}-projection.png','camera_world_matrix':[list(row) for row in cam.matrix_world],'ortho_scale_m':44,'resolution':[4096,4096]})
(T/'photographic-textures.json').write_text(json.dumps({'source':'media/drone/2026/DJI_0029.MP4','capture_date':'2026-03-23','atlas':textures,'registration':fit,'projections':views,'limitations':['Photographic lighting and occlusions remain in these images.','Approximate CAD registration; do not treat texture edges as measured geometry.','Interior surfaces absent from drone scan. Ground references are saved separately.']},indent=2))
