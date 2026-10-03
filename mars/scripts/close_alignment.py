import bpy,pathlib,json
b=pathlib.Path('<mars-media>/reconstruction/2026-campus');out=b/'modular/research'
for kind,path,center,scale in [('cad-close',out/'cad-reference.blend',(177,66),42),('orbit-close',b/'models/orbit-raw/campus.blend',(0,0),1.6)]:
 bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene
 for mat in bpy.data.materials:
  if not mat.use_nodes:continue
  ns=mat.node_tree.nodes;bs=next((n for n in ns if n.type=='BSDF_PRINCIPLED'),None);op=next((n for n in ns if n.type=='OUTPUT_MATERIAL'),None)
  if bs and op:
   em=ns.new('ShaderNodeEmission');em.inputs['Color'].default_value=bs.inputs['Base Color'].default_value
   for link in bs.inputs['Base Color'].links:mat.node_tree.links.new(link.from_socket,em.inputs['Color'])
   mat.node_tree.links.new(em.outputs[0],op.inputs['Surface'])
 scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=1600;scene.render.resolution_y=1600;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Neutral');scene.world.color=(0,0,0);scene.view_settings.view_transform='Standard';cd=bpy.data.cameras.new('Map');cam=bpy.data.objects.new('Map',cd);scene.collection.objects.link(cam);scene.camera=cam;cd.type='ORTHO';cd.ortho_scale=scale;cd.clip_end=10000;cam.location=(*center,1000);cam.rotation_euler=(0,0,0);scene.render.filepath=str(out/f'{kind}.png');bpy.ops.render.render(write_still=True)
