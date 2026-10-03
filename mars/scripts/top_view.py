import bpy,sys,pathlib,math
from mathutils import Vector
folder=pathlib.Path(sys.argv[sys.argv.index('--')+1]).resolve();bpy.ops.wm.open_mainfile(filepath=str(folder/'campus.blend'))
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 ns=mat.node_tree.nodes;tex=next((n for n in ns if n.type=='TEX_IMAGE' and n.image and '_tex' in n.image.name),None);output=next((n for n in ns if n.type=='OUTPUT_MATERIAL'),None)
 if tex and output:
  em=ns.new('ShaderNodeEmission');mat.node_tree.links.new(tex.outputs['Color'],em.inputs['Color']);mat.node_tree.links.new(em.outputs[0],output.inputs['Surface'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=1600;scene.render.resolution_y=1600;scene.render.resolution_percentage=100;scene.view_settings.view_transform='Standard';scene.world=bpy.data.worlds.new('Background');scene.world.color=(.02,.03,.04)
cd=bpy.data.cameras.new('Top');cam=bpy.data.objects.new('Top',cd);scene.collection.objects.link(cam);scene.camera=cam;cam.location=(0,0,800);cam.rotation_euler=(0,0,0);cd.type='ORTHO';cd.ortho_scale=600;cd.clip_end=10000;scene.render.filepath=str(folder/'top.png');bpy.ops.render.render(write_still=True)
