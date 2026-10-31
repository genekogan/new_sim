import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import bpy,pathlib,json,math,shutil,collections
import numpy as np
from mathutils import Matrix,Vector
B=media('reconstruction/2026-campus/modular');O=B/'deliverable';T=O/'textures';bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene
if not (O/'mars-2026-modular-cad.blend').exists():shutil.copy2(O/'mars-2026-modular.blend',O/'mars-2026-modular-cad.blend')
manifest=json.load(open(O/'components.json'));records={r['id']:r for r in manifest['instances']};byid={o.get('component_id'):o for o in s.objects if o.get('component_id')};roots={o.get('assembly_id'):o for o in s.objects if o.get('assembly_id') and not o.get('layer') and not o.get('component_id')}
# Exclude nearby vehicles from the movable Chiba building assembly.
context=roots['site-context'];moved=[]
for ident,o in byid.items():
 r=records[ident];lo,hi=np.array(r['cad_bounds_m']);c=(lo+hi)/2
 if r['assembly_id']=='chiba' and (c[0]<160 or c[1]>85):
  w=o.matrix_world.copy();o.parent=context;o.matrix_world=w;o['assembly_id']='site-context';r['assembly_id']='site-context';r['position_m']=list(o.location);moved.append(ident)
# Make glazing readable. Original CAD has gray glass, while ground photos show clear acrylic.
for o in byid.values():
 if o.get('assembly_id')=='chiba' and o.get('kind')=='transparent_panel':
  m=bpy.data.materials.new('Observed clear glazing • '+o.name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.67,.82,.85,1);p.inputs['Alpha'].default_value=.22;p.inputs['Roughness'].default_value=.13;m.surface_render_method='DITHERED';o.data=o.data.copy();o.data.materials.clear();o.data.materials.append(m);o['evidence']='ref-080 and 2026 drone scan; panel outlines retained from CAD'
# Correct the projector's orientation from the 2026 hall photo. Keep dimensions explicitly inferred.
projector=byid.get('cad_component-2244')
if projector:
 projector.data=projector.data.copy();vs=np.array([v.co[:] for v in projector.data.vertices]);vaxis=np.array([.4265,.9045,0]);span=np.ptp(vs@vaxis);height=np.ptp(vs[:,2])
 for vert,p in zip(projector.data.vertices,vs):
  q=p+vaxis*(p@vaxis)*(3.35/span-1);q[2]*=4.55/height;vert.co=q
 projector.location.z=2.65;projector.name='Main hall • portrait projection wall';projector['evidence']='ref-110: portrait white projection wall, estimated 3.35m wide × 4.55m high. Dimensions are not measured.';projector['accuracy']='Photo-informed proportion; approximate size';records['cad_component-2244']['refinement']='Portrait projection wall based on ref-110; estimated dimensions, no field measurement'
# Five photographic projections remain independent texture assets and UV sets.
photos=json.load(open(T/'photographic-textures.json'));projections={};photoMaterials={}
for view in photos['projections']:
 im=bpy.data.images.load(str(T/view['file']),check_existing=True);im.pack();m=bpy.data.materials.new('Observed • '+view['id']);m.use_nodes=True;ns=m.node_tree.nodes;bs=ns.get('Principled BSDF');bs.inputs['Roughness'].default_value=.9;tex=ns.new('ShaderNodeTexImage');tex.image=im;tex.extension='EXTEND';uv=ns.new('ShaderNodeUVMap');uv.uv_map='Observed projection UV';m.node_tree.links.new(uv.outputs['UV'],tex.inputs['Vector']);m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);projections[view['id']]=(Matrix(view['camera_world_matrix']).inverted(),view['ortho_scale_m']);photoMaterials[view['id']]=m
u=np.array([.9045,-.4265,0]);v=np.array([.4265,.9045,0]);origin=np.array([168.52125-177,57.075-66,0]);applied=[]
for ident,o in byid.items():
 if o.get('assembly_id')!='chiba' or o.get('kind')!='wood_component':continue
 o.data=o.data.copy();world=o.matrix_world;normalMatrix=world.to_3x3();selected=[]
 for f in o.data.polygons:
  c=np.array(world@f.center);n=np.array((normalMatrix@f.normal).normalized());q=c-origin;U=q@u;V=q@v;name=None
  # Roof finishes only on top-facing high panels; lower surfaces retain their wood UV.
  if n[2]>.8 and c[2]>5.7:name='roof'
  # Trace the four exterior main-hall faces without painting hidden interior partitions.
  elif c[2]>.25 and abs(n[2])<.8:
   candidates=[(abs(V),-v,'long-south'),(abs(V-11.65),v,'long-north'),(abs(U-20.8),u,'end-east'),(abs(U),-u,'end-west')]
   distance,direction,view=min(candidates,key=lambda x:x[0])
   if distance<.7 and n@direction>.6 and -1<U<22 and -1<V<13:name=view
  if name:selected.append((f,name))
 if not selected:continue
 layer=o.data.uv_layers.new(name='Observed projection UV');slots={}
 for f,name in selected:
  if name not in slots:slots[name]=len(o.data.materials);o.data.materials.append(photoMaterials[name])
  f.material_index=slots[name];inv,scale=projections[name]
  for li in f.loop_indices:
   point=inv@(world@o.data.vertices[o.data.loops[li].vertex_index].co);layer.data[li].uv=(point.x/scale+.5,point.y/scale+.5)
 o['finish_status']='Photographic projection; approximate registration; original CAD textures retained in source project';applied.append(ident);records[ident]['finish_source']='textures/photographic-textures.json'
# Correct classifications for cutaway: test face orientation in the building axes, not global AABB width.
for ident,o in byid.items():
 if o.get('assembly_id')!='chiba' or o.get('kind')!='wood_component':continue
 pts=np.array([o.matrix_world@p.co for p in o.data.vertices]);axisdims=np.array([np.ptp(pts@u),np.ptp(pts@v),np.ptp(pts[:,2])]);new=o.get('layer')
 if axisdims[2]>1.4 and min(axisdims[:2])<.3:new='Walls and screens'
 if new!=o.get('layer'):
  w=o.matrix_world.copy();o.parent=roots['chiba'];o.matrix_world=w;o['layer']=new;records[ident]['layer']=new;records[ident]['position_m']=list(o.location)
# Context terrain is hidden in Blender as well as excluded from export.
for o in s.objects:
 if o.get('assembly_id')=='reference-ground' or o.get('layer')=='Aerial reference':o.hide_render=True;o.hide_set(True)
# Save curated room evidence separately; unconfirmed room locations remain unresolved.
rooms=[{'id':'main-hall','name':'Main hall / classroom','center_CAD_m':[177.5,59,2],'evidence':['ref-000','ref-110','ref-011'],'confidence':'Room and observed features confirmed; precise dimensions unverified'}, {'id':'mimos','name':'Mimos café / solarium','center_CAD_m':[186,55.5,1.5],'evidence':['ref-080','ref-077','ref-071'],'confidence':'Solarium features confirmed; room footprint association inferred from CAD and photos'}, {'id':'kitchen','name':'Kitchen','center_CAD_m':[168,76,1.5],'evidence':['ref-037','ref-005'],'confidence':'Counters/windows confirmed; placement within wing provisional'}, {'id':'upstairs','name':'Upstairs workspace','center_CAD_m':None,'evidence':['ref-102'],'confidence':'Desk/screens observed; location in the model unresolved'}, {'id':'compute-room','name':'Compute room','center_CAD_m':None,'evidence':['ref-095'],'confidence':'Candidate photo only; room identification and placement unresolved'}]
(O/'rooms.json').write_text(json.dumps(rooms,indent=2));manifest['refinements']={'nearby_vehicle_pieces_removed_from_Chiba':len(moved),'photo_finish_components':len(applied),'projector':'portrait proportion from ref-110, dimensions estimated','clear_glazing':'2026 ground photos','rooms':'rooms.json'};manifest['limitations'].append('Photo finishes use a manual roof-corner registration (0.38m fit RMS); this is not a measured accuracy bound. Some surfaces remain generic.');manifest['instances']=list(records.values());(O/'components.json').write_text(json.dumps(manifest,indent=2))
for o in s.objects:o.select_set(False)
camp=bpy.data.objects.get('Mars 2026 • Editable campus')
for o in [camp]+list(camp.children_recursive):
 if o.get('assembly_id')!='reference-ground' and o.get('layer')!='Aerial reference':o.hide_set(False);o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'campus-components.glb'),export_format='GLB',use_selection=True,export_extras=True,export_image_format='JPEG',export_jpeg_quality=88)
for o in s.objects:o.select_set(False)
chiba=roots['chiba']
for o in [chiba]+list(chiba.children_recursive):o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'chiba-components.glb'),export_format='GLB',use_selection=True,export_extras=True,export_image_format='JPEG',export_jpeg_quality=90)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(O/'mars-2026-modular.blend'))
s.render.filepath=str(O/'modular-preview.png');bpy.ops.render.render(write_still=True)
for o in s.objects:
 if o.get('layer') in ['Roofs and upper floors','Walls and screens']:o.hide_render=True
s.camera.location=(-25,30,30);s.camera.rotation_euler=(Vector((0,0,2))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=str(O/'interior-preview.png');bpy.ops.render.render(write_still=True)
print('REFINED',len(applied),'photographic components; reparented',len(moved),flush=True)
