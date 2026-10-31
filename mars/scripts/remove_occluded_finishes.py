import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import bpy,pathlib,json
from mathutils import Vector
O=media('reconstruction/2026-campus/modular/deliverable');bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene;m=json.load(open(O/'components.json'));kept=[];removed=[]
for o in s.objects:
 if o.type!='MESH' or not o.get('component_id'):continue
 changed=False;roof=False
 for p in o.data.polygons:
  mat=o.data.materials[p.material_index] if p.material_index<len(o.data.materials) else None
  if mat and mat.name.startswith('Observed •'):
   if mat.name=='Observed • roof':roof=True
   else:p.material_index=0;changed=True
 if changed:removed.append(o['component_id']);o['finish_status']='Facade source projection rejected because of foreground occlusion; generic/source material retained'
 if roof:kept.append(o['component_id'])
for r in m['instances']:
 if r['id'] not in kept:r.pop('finish_source',None)
m['refinements']['photo_finish_components']=len(kept);m['refinements']['facade_projection_rejected']='Foreground trailers and occlusions in orthographic texture projections; all side projections are retained as source images but not applied.';m['limitations'].append('Only clean roof projections are applied. Facade projections were rejected after camera-matched checks showed foreground objects painted onto walls; mural/other facade textures need clean surface extraction.');(O/'components.json').write_text(json.dumps(m,indent=2))
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
s.camera.location=(-25,30,30);s.camera.rotation_euler=(Vector((0,0,2))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(O/'interior-preview.png');bpy.ops.render.render(write_still=True);print('Kept',len(kept),'roof-finish components. Rejected facade projections on',len(removed),'components.')
