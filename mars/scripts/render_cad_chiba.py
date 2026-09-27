import bpy,pathlib,math
from mathutils import Vector
b=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/research');bpy.ops.wm.open_mainfile(filepath=str(b/'cad-reference.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('World');scene.world.color=(.5,.5,.5);scene.view_settings.view_transform='Standard';light=bpy.data.lights.new('Sun','SUN');light.energy=2;ob=bpy.data.objects.new('Sun',light);scene.collection.objects.link(ob);ob.rotation_euler=(.4,-.5,-.3)
camera=bpy.data.cameras.new('Review');cam=bpy.data.objects.new('Review',camera);scene.collection.objects.link(cam);scene.camera=cam;camera.type='ORTHO';camera.ortho_scale=46;camera.clip_end=100000;center=Vector((177,66,3))
for name,off in [('east',(30,-38,26)),('west',(-32,30,26)),('top',(0,0,50))]:
 cam.location=center+Vector(off);cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(b/f'cad-chiba-{name}.png');bpy.ops.render.render(write_still=True)
