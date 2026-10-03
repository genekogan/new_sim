import bpy,bmesh,pathlib,json,collections,hashlib
import numpy as np
from mathutils import Vector
O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable');bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene;m=json.load(open(O/'components.json'));removed=[];clipped=[];unprojected=[]
# Sample an unobstructed plywood wall from the inspected kitchen photograph.
crop=json.load(open(O/'textures/kitchen-crop.json'));src=crop['source_path'];box=crop['crop']
photo=bpy.data.images.load(str(O/'textures/kitchen-plywood-sample.jpg'),check_existing=True)
for mat in bpy.data.materials:
 if 'Wood Plywood Knots' in mat.name and mat.use_nodes:
  for node in mat.node_tree.nodes:
   if node.type=='TEX_IMAGE':node.image=photo
for o in list(s.objects):
 if o.type!='MESH' or not o.get('component_id'):continue
 if 'Sphere Light' in o.get('source_mesh',''):
  removed.append(o['component_id']);bpy.data.objects.remove(o,do_unlink=True);continue
 if o.get('assembly_id')!='chiba' or o.get('kind')!='wood_component':continue
 vs=np.array([o.matrix_world@v.co for v in o.data.vertices]);lo=vs.min(0);hi=vs.max(0);dims=hi-lo
 if lo[2]<-.06:
  o.data=o.data.copy();bm=bmesh.new();bm.from_mesh(o.data);point=o.matrix_world.inverted()@Vector((0,0,-.03));normal=o.matrix_world.to_3x3().transposed()@Vector((0,0,1));bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),plane_co=point,plane_no=normal,dist=.00001,clear_inner=True);bm.to_mesh(o.data);bm.free();o['geometry_refinement']='CAD members extending underground clipped at -0.03m for visible replica. Not a verified cut dimension.';clipped.append(o['component_id'])
 if (hi[2]<5.7 and (dims[2]<1.4 or np.sort(dims)[-2:].prod()<4)):
  found=False
  for f in o.data.polygons:
   if f.material_index<len(o.data.materials) and o.data.materials[f.material_index] and o.data.materials[f.material_index].name.startswith('Observed •'):
    f.material_index=0;found=True
  if found:unprojected.append(o['component_id']);o['finish_status']='CAD/source wood material; ambiguous photographic projection removed'
# Merge exactly identical copied component meshes, including UVs and material assignments.
cache={};shared=0
for o in s.objects:
 if o.type!='MESH' or not o.get('component_id'):continue
 mesh=o.data;hasher=hashlib.sha256();hasher.update(np.array([v.co[:] for v in mesh.vertices],dtype=np.float32).tobytes());hasher.update(str([(tuple(p.vertices),p.material_index) for p in mesh.polygons]).encode());hasher.update(str([a.name if a else '' for a in mesh.materials]).encode())
 for uv in mesh.uv_layers:hasher.update(np.array([x.uv[:] for x in uv.data],dtype=np.float32).tobytes())
 key=hasher.hexdigest()
 if key in cache:o.data=cache[key];shared+=1
 else:cache[key]=mesh
for r in m['instances']:
 if r['id'] in clipped:r['geometry_refinement']='CAD below-ground continuation trimmed at -0.03m; not a measured cut list'
 if r['id'] in unprojected:r.pop('finish_source',None)
m['instances']=[r for r in m['instances'] if r['id'] not in removed];used={r['definition_id'] for r in m['instances']};m['definitions']=[d for d in m['definitions'] if d['id'] in used];m['counts_by_kind']=dict(collections.Counter(r['kind'] for r in m['instances']));m['refinements']['removed_CAD_light_placeholders']=len(removed);m['refinements']['ground_clipped_CAD_members']=len(clipped);m['refinements']['ambiguous_small_surface_projections_removed']=len(unprojected);m['refinements']['shared_mesh_instances']=shared;m['refinements']['photo_finish_components']=len([r for r in m['instances'] if r.get('finish_source')]);(O/'components.json').write_text(json.dumps(m,indent=2));(O/'textures/ground-texture-provenance.json').write_text(json.dumps({'kitchen-plywood-sample.jpg':{'source_path':src,'crop_pixels':box,'source_reference_id':'ref-037','use':'Reusable observed plywood color/texture, with original illumination retained','physical_repeat_size':'unknown'}},indent=2))
for o in s.objects:o.select_set(False)
camp=bpy.data.objects.get('Mars 2026 • Editable campus')
for o in [camp]+list(camp.children_recursive):
 if o.get('assembly_id')!='reference-ground' and o.get('layer')!='Aerial reference':o.hide_set(False);o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'campus-components.glb'),export_format='GLB',use_selection=True,export_extras=True)
for o in s.objects:o.select_set(False)
chiba=next(o for o in s.objects if o.get('assembly_id')=='chiba' and not o.get('layer') and not o.get('component_id'))
for o in [chiba]+list(chiba.children_recursive):o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'chiba-components.glb'),export_format='GLB',use_selection=True,export_extras=True)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(O/'mars-2026-modular.blend'))
s.render.filepath=str(O/'modular-preview.png');bpy.ops.render.render(write_still=True)
for o in s.objects:
 if o.get('layer') in ['Roofs and upper floors','Walls and screens']:o.hide_render=True
s.camera.location=(-25,30,30);s.camera.rotation_euler=(Vector((0,0,2))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(O/'interior-preview.png');bpy.ops.render.render(write_still=True)
print('FINALIZE',len(removed),'helpers removed;',len(clipped),'underground CAD members clipped;',shared,'shared mesh instances',flush=True)
