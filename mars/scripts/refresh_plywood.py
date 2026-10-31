import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import bpy,pathlib
from mathutils import Vector
O=media('reconstruction/2026-campus/modular/deliverable');bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene;im=bpy.data.images.load(str(O/'textures/kitchen-plywood-sample.jpg'),check_existing=False);im.pack()
for ma in bpy.data.materials:
 if ma.use_nodes:
  for n in ma.node_tree.nodes:
   if n.type=='TEX_IMAGE' and n.image and n.image.name.startswith('kitchen-plywood-sample'):n.image=im
camp=bpy.data.objects.get('Mars 2026 • Editable campus')
for o in s.objects:o.select_set(False)
for o in [camp]+list(camp.children_recursive):
 if o.get('assembly_id')!='reference-ground' and o.get('layer')!='Aerial reference':o.hide_set(False);o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'campus-components.glb'),export_format='GLB',use_selection=True,export_extras=True)
for o in s.objects:o.select_set(False)
chiba=next(o for o in s.objects if o.get('assembly_id')=='chiba' and not o.get('layer') and not o.get('component_id'))
for o in [chiba]+list(chiba.children_recursive):o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'chiba-components.glb'),export_format='GLB',use_selection=True,export_extras=True)
bpy.ops.wm.save_as_mainfile(filepath=str(O/'mars-2026-modular.blend'));s.render.filepath=str(O/'modular-preview.png');bpy.ops.render.render(write_still=True)
for o in s.objects:
 if o.get('layer') in ['Roofs and upper floors','Walls and screens']:o.hide_render=True
s.camera.location=(-25,30,30);s.camera.rotation_euler=(Vector((0,0,2))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(O/'interior-preview.png');bpy.ops.render.render(write_still=True)
