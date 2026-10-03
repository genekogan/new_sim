import bpy, pathlib, math
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
p=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/research/appearance/euc')
for i,n in enumerate(['Pièce1.STL','Pièce2x2.STL','Pièce3.STL','Pièce4x2.STL']):
 bpy.ops.wm.stl_import(filepath=str(p/n));o=bpy.context.object
 vs=[v.co for v in o.data.vertices];c=Vector([(min(v[a] for v in vs)+max(v[a] for v in vs))/2 for a in range(3)])
 for v in o.data.vertices:v.co-=c
 o.location.x=(i-1.5)*38
 m=bpy.data.materials.new(n);m.diffuse_color=(.25+.15*i,.4,.55,1);o.data.materials.append(m)
 bpy.ops.object.text_add(location=((i-1.5)*38-10,-24,0));t=bpy.context.object;t.data.body=str(i+1);t.data.size=6
bpy.ops.object.camera_add(location=(65,-100,150));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=180;bpy.context.scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(0,0,120));bpy.context.object.data.energy=200000;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=100
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=16;s.world.color=(.3,.3,.3);s.render.resolution_x=1200;s.render.resolution_y=600;s.render.resolution_percentage=100;s.render.filepath=str(p/'parts.png');bpy.ops.render.render(write_still=True)
