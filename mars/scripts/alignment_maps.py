import bpy,pathlib,json
from mathutils import Vector
b=pathlib.Path('<mars-media>/reconstruction/2026-campus');out=b/'modular/research'
for kind,path,center,scale in [('cad',out/'cad-reference.blend',(142,105),320),('scan',b/'models/campus-raw/campus.blend',(0,0),600)]:
 bpy.ops.wm.open_mainfile(filepath=str(path));scene=bpy.context.scene
 if kind=='cad':
  for o in scene.objects:
   if o.type=='MESH' and (not o.parent or o.parent.name not in ['Node_3630','Node_3632']):o.hide_render=True
 for mat in bpy.data.materials:
  if not mat.use_nodes:continue
  nodes=mat.node_tree.nodes;bs=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None);outnode=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
  if bs and outnode:
   em=nodes.new('ShaderNodeEmission');em.inputs['Color'].default_value=bs.inputs['Base Color'].default_value
   for link in bs.inputs['Base Color'].links:mat.node_tree.links.new(link.from_socket,em.inputs['Color'])
   mat.node_tree.links.new(em.outputs[0],outnode.inputs['Surface'])
 scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=4096;scene.render.resolution_y=4096;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Neutral');scene.world.color=(0,0,0);scene.view_settings.view_transform='Standard';camdata=bpy.data.cameras.new('Map');cam=bpy.data.objects.new('Map',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO';camdata.ortho_scale=scale;camdata.clip_end=10000;cam.location=(center[0],center[1],1000);cam.rotation_euler=(0,0,0);scene.render.filepath=str(out/f'{kind}-alignment-map.png');bpy.ops.render.render(write_still=True);(out/f'{kind}-alignment-map.json').write_text(json.dumps({'center':center,'scale':scale,'resolution':4096}))
