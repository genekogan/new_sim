# WP1 stage 1 (Blender headless): export one Quaternius "Ultimate Modular" character .blend as a GLB holding
# only its skinned parts (Head/Body/Legs/Feet) and armature, no animations. build-kit.mjs then rebinds the
# parts to the shared rigs and writes the kit. Usage:
#   blender -b <Character.blend> --python tools/humanoid/export_parts.py -- <out.glb>
import bpy, sys
out = sys.argv[sys.argv.index('--') + 1]
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE']
assert len(arm) == 1, 'expected one armature, found %d' % len(arm)
arm = arm[0]
parts = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]
assert parts, 'no skinned parts under the armature'
# Rest pose for the export: no action bound, pose position REST.
if arm.animation_data: arm.animation_data.action = None
arm.data.pose_position = 'REST'
for o in bpy.data.objects: o.select_set(o == arm or o in parts)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=True,
    export_animations=False, export_skins=True, export_morph=False, export_texcoords=False,
    export_normals=True, export_yup=True)
print('EXPORTED', out, [p.name for p in parts])
