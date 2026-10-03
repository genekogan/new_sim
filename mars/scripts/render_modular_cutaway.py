import bpy,pathlib,math,json
from mathutils import Vector
O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable');bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene
for o in s.objects:
 if o.get('layer') in ['Roofs and upper floors','Walls and screens','Aerial reference']:o.hide_render=True
s.render.resolution_x=1600;s.render.resolution_y=1200;s.cycles.samples=8
cam=s.camera;cam.data.ortho_scale=43
for name,pos in [('cutaway-east',(25,-32,30)),('cutaway-west',(-25,30,30)),('cutaway-top',(0,0,50))]:
 cam.location=pos;cam.rotation_euler=(Vector((0,0,2))-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(O/(name+'.png'));bpy.ops.render.render(write_still=True)
