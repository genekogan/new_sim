"""Convert CC0 Quaternius character templates into reusable, posed static meshes."""
import bpy,pathlib
from mathutils import Vector
B=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular')
R=B/'research/appearance';O=B/'deliverable'
for name,file in [('person_casual','Casual_2.blend'),('person_punk','Punk.blend'),('person_woman','Woman_Casual.blend')]:
 bpy.ops.wm.open_mainfile(filepath=str(R/file));s=bpy.context.scene
 for arm in [o for o in s.objects if o.type=='ARMATURE']:
  arm.animation_data_create();arm.animation_data.action=bpy.data.actions.get('Idle')
  for track in arm.animation_data.nla_tracks:track.mute=True
 s.frame_set(12);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
 sources=[o for o in s.objects if o.type=='MESH'];posed=[]
 for source in sources:
  mesh=bpy.data.meshes.new_from_object(source.evaluated_get(deps),depsgraph=deps)
  obj=bpy.data.objects.new('Posed '+source.name,mesh);s.collection.objects.link(obj);obj.matrix_world=source.matrix_world;posed.append(obj)
 for obj in list(s.objects):
  if obj not in posed:bpy.data.objects.remove(obj,do_unlink=True)
 bpy.ops.object.select_all(action='SELECT');bpy.context.view_layer.objects.active=posed[0];bpy.ops.object.join();obj=bpy.context.object
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
 pts=[obj.matrix_world@v.co for v in obj.data.vertices];lo=Vector([min(p[i] for p in pts) for i in range(3)]);hi=Vector([max(p[i] for p in pts) for i in range(3)])
 center=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
 for vert in obj.data.vertices:vert.co=(obj.matrix_world@vert.co-center)*(1.75/(hi.z-lo.z))
 obj.matrix_world.identity();obj.name=name;obj['kind']='context_person';obj['definition_id']=name;obj['evidence']='Generic posed Quaternius CC0 character; not a specific Mars attendee or inventory item'
 bpy.ops.export_scene.gltf(filepath=str(O/(name+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_animations=False)
 print('PERSON',name,len(obj.data.vertices),tuple(obj.dimensions),flush=True)
