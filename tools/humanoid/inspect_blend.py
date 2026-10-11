# Headless inspection of a Quaternius modular character .blend: objects, armature, actions, materials.
# blender -b <file.blend> --python tools/humanoid/inspect_blend.py
import bpy, json
out = {"file": bpy.data.filepath, "objects": [], "actions": [], "materials": []}
for o in bpy.data.objects:
    d = {"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None}
    if o.type == 'MESH':
        me = o.data
        me.calc_loop_triangles()
        d.update(tris=len(me.loop_triangles), verts=len(me.vertices), mats=[m.name if m else None for m in me.materials],
                 groups=len(o.vertex_groups), mods=[(m.type, getattr(m, 'object', None) and m.object.name) for m in o.modifiers],
                 bbox=[list(o.matrix_world @ __import__('mathutils').Vector(c)) for c in (o.bound_box[0], o.bound_box[6])])
    if o.type == 'ARMATURE':
        d.update(bones=len(o.data.bones), rest={b.name: list(b.head_local) for b in o.data.bones if b.name in ('Hips','UpperLeg.L','LowerLeg.L','Head','Shoulder.L','UpperArm.L','Foot.L','Root','Body')})
    out["objects"].append(d)
for a in bpy.data.actions:
    out["actions"].append([a.name, round(a.frame_range[1]-a.frame_range[0], 2)])
for m in bpy.data.materials:
    c = None
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED': c = [round(x, 3) for x in n.inputs['Base Color'].default_value]
    out["materials"].append([m.name, c, m.users])
print("JSON>" + json.dumps(out))
