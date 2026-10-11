# WP0 spike: import a shipped character GLB, apply a UV checker to every material, render front/back.
# blender -b --factory-startup --python tools/humanoid/uv_checker.py -- <in.glb> <out-prefix>
import bpy, sys, math
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
img = bpy.data.images.new('checker', 1024, 1024, alpha=False)
img.generated_type = 'COLOR_GRID'
mat = bpy.data.materials.new('uvcheck')
mat.use_nodes = True
nt = mat.node_tree
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
for o in bpy.data.objects:
    if o.type == 'MESH':
        for i in range(len(o.material_slots)): o.material_slots[i].material = mat
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x, scene.render.resolution_y = 600, 900
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.1
for name, ang in (('front', 0.0), ('back', math.pi)):
    cam.location = (math.sin(ang) * -5, -math.cos(ang) * 5 if False else (-5 if ang == 0 else 5), 0.95)
    cam.location = (0, -5 if ang == 0 else 5, 0.95)
    cam.rotation_euler = (math.pi / 2, 0, 0 if ang == 0 else math.pi)
    scene.render.filepath = f'{out}-{name}.png'
    bpy.ops.render.render(write_still=True)
