"""Recover editable CAD components; retain provenance and nominal stock separately."""
import bpy, pathlib, json, math, hashlib, collections
import numpy as np
from mathutils import Matrix,Vector
P=pathlib.Path('<mars-campus-repo>'); B=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular'); R=B/'research'; O=B/'deliverable';O.mkdir(exist_ok=True);(O/'textures').mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(R/'cad-reference.blend'))
scene=bpy.context.scene
source='code/godot-mars/Imported Models/Mars Aerial/Mars 2026 - Aerial Located.glb'
original=list(bpy.data.objects)
# Source graph is retained in metadata; new graph uses readable spatial assemblies.
anc={}
for o in original:
 a=[];p=o.parent
 while p:a.append(p.name);p=p.parent
 anc[o.name]=a
centers=[('chiba','Chiba',177,66,27),('north-workshops','North workshops',155,144,25),('north-rack-building','North rack building',183,149,17),('northeast-compound','Northeast compound',221,161,23),('west-rack-building','West rack building',65,69,22)]
roots={}; records=[]; definitions={}; meshcache={}; count=collections.Counter();offset=Vector((177,66,0))
def empty(name,location=(0,0,0),parent=None):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.location=location;o.parent=parent;return o
camp=empty('Mars 2026 • Editable campus');camp['status']='Evidence-informed CAD replica; not a surveyed as-built'
for ident,label,x,y,r in centers:
 root=empty(label,(x-177,y-66,0),camp);root['assembly_id']=ident;root['evidence']='Archived CAD, visually compared with 2026 imagery';roots[ident]=root
context=empty('Vehicles, shelters and site objects',(0,0,0),camp);context['assembly_id']='site-context';roots['site-context']=context
terrain=empty('Historical aerial reference',(0,0,0),camp);terrain['assembly_id']='reference-ground';roots['reference-ground']=terrain
layers={}
def parent_for(root,category):
 key=(root.name,category)
 if key not in layers:
  o=empty(category,parent=root);o['layer']=category;layers[key]=o
 return layers[key]
# Recover connected parts after coincident source vertices are welded analytically.
def split_polygons(mesh):
 if len(mesh.polygons)>15000:return [list(range(len(mesh.polygons)))]
 pos=np.array([v.co[:] for v in mesh.vertices]);_,inv=np.unique(np.round(pos,4),axis=0,return_inverse=True)
 parent=list(range(int(inv.max())+1))
 def find(x):
  while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
  return x
 for f in mesh.polygons:
  ids=[int(inv[i]) for i in f.vertices];a=find(ids[0])
  for j in ids[1:]:parent[find(j)]=a
 groups=collections.defaultdict(list)
 for f in mesh.polygons:groups[find(int(inv[f.vertices[0]]))].append(f.index)
 return list(groups.values())
for index,o in enumerate(original):
 if o.type!='MESH':continue
 names=' '.join([o.name]+anc[o.name]); materialnames=[m.name if m else '' for m in o.data.materials];joined=' '.join(materialnames)
 # Flat human entourage is an unbuilt CAD illustration, not a campus component.
 if any(s in names.lower() for s in ['steve','marc','sophie','stacy','sang','cindy','tyler','susan','2d people','ty_ty']) or any(n in anc[o.name] for n in ['Node_3634','Node_3680','Node_7186']):continue
 world=o.matrix_world.copy();vworld=np.array([world@v.co for v in o.data.vertices]);lo=vworld.min(0);hi=vworld.max(0);c=(lo+hi)/2
 isterrain=any(n in names for n in ['Node_3630','Node_3632'])
 if isterrain:root=terrain
 else:
  near=[(math.hypot(c[0]-x,c[1]-y),ident) for ident,label,x,y,r in centers if math.hypot(c[0]-x,c[1]-y)<r]
  root=roots[min(near)[1]] if near else context
 structural=any(s.lower() in joined.lower() for s in ['wood','plywood','bumpy blue','color b04','glass','solar'])
 groups=split_polygons(o.data) if structural and not isterrain else [list(range(len(o.data.polygons)))]
 for seq,faces in enumerate(groups):
  ids=sorted({vi for fi in faces for vi in o.data.polygons[fi].vertices});lut={v:i for i,v in enumerate(ids)};vs=vworld[ids];mn=vs.min(0);mx=vs.max(0);center=(mn+mx)/2;dims=mx-mn
  if isterrain:category='Aerial reference';kind='reference'
  elif 'Bumpy Blue' in joined:category='Rack steel';kind='rack_member'
  elif '[Color B04]' in joined:category='Rack steel';kind='beam_candidate'
  elif 'solar' in joined.lower():category='Solar and equipment';kind='solar_assembly'
  elif 'glass' in joined.lower():category='Glazing';kind='transparent_panel'
  elif 'wood' in joined.lower():
   kind='wood_component'
   if dims[2]<.2 and mn[2]>2.8:category='Roofs and upper floors'
   elif dims[2]>1.5 and min(dims[:2])<5:category='Walls and screens'
   else:category='Timber, floors and stairs'
  else:category='Fittings and furniture';kind='cad_component'
  # Vertex coordinates stay local to component, making relocation independent.
  coords=vs-center
  faceverts=[[lut[v] for v in o.data.polygons[fi].vertices] for fi in faces]
  uv=[];oldUV=o.data.uv_layers.active
  for fi in faces:
   uv.extend([tuple(oldUV.data[j].uv) if oldUV else (0,0) for j in o.data.polygons[fi].loop_indices])
  signature=hashlib.sha1(np.round(coords,5).tobytes()+str(faceverts).encode()+str(materialnames).encode()+np.round(uv,5).tobytes()).hexdigest()[:14]
  did='cad-'+signature
  if did in meshcache:mesh=meshcache[did]
  else:
   mesh=bpy.data.meshes.new(did);mesh.from_pydata(coords.tolist(),[],faceverts);mesh.update()
   for m in o.data.materials:mesh.materials.append(m)
   for f,fi in zip(mesh.polygons,faces):f.material_index=o.data.polygons[fi].material_index
   uvl=mesh.uv_layers.new(name='Source UV')
   for j,co in enumerate(uv):uvl.data[j].uv=co
   meshcache[did]=mesh
   definitions[did]={'id':did,'kind':kind,'dimension_status':'preserved_source_CAD_not_verified_stock','source':source,'source_mesh':o.name,'nominal_stock_id':None}
  count[kind]+=1;pid=f'{kind}-{count[kind]:04d}'
  obj=bpy.data.objects.new(pid,mesh);scene.collection.objects.link(obj);obj.parent=parent_for(root,category);obj.location=Vector(center)-offset-root.location
  obj['component_id']=pid;obj['definition_id']=did;obj['kind']=kind;obj['source_mesh']=o.name;obj['source_parent']=o.parent.name if o.parent else '';obj['layer']=category;obj['assembly_id']=root.get('assembly_id','');obj['accuracy']='CAD geometry; visual correspondence, dimensions not field verified'
  records.append({'id':pid,'definition_id':did,'assembly_id':root.get('assembly_id'),'layer':category,'source_mesh':o.name,'source_ancestors':anc[o.name][:5],'cad_bounds_m':[mn.tolist(),mx.tolist()],'position_m':list(obj.location),'kind':kind})
 if index%1000==0:print('PROGRESS',index,len(records),flush=True)
for o in original:bpy.data.objects.remove(o,do_unlink=True)
# Remove stale datablocks but preserve every used source material and texture.
for im in bpy.data.images:
 if im.type=='IMAGE' and im.has_data:
  name='cad-'+hashlib.sha1(im.name.encode()).hexdigest()[:12]+'.png';im.filepath_raw=str(O/'textures'/name);im.file_format='PNG'
  try:im.save()
  except Exception:pass
terrain.hide_render=True;terrain.hide_set(True)
scene.unit_settings.system='METRIC';scene.unit_settings.length_unit='METERS'
scene['provenance']=source;scene['coordinate_origin']='CAD X=177m, Y=66m; Blender Z up; glTF Y up'
# User-specified stock definitions are genuinely shared, reusable geometry.
def mat(name,color,metal=0,rough=.7,alpha=1):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,alpha);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,alpha);b.inputs['Metallic'].default_value=metal;b.inputs['Roughness'].default_value=rough
 if alpha<1:b.inputs['Alpha'].default_value=alpha;m.surface_render_method='DITHERED'
 return m
blue=mat('Stock • blue powder-coated steel',(.025,.19,.39),.55,.4);orange=mat('Stock • orange rack beam',(.8,.15,.018),.4,.45);ply=mat('Stock • unfinished plywood',(.48,.31,.16));wood=mat('Stock • timber',(.42,.27,.14));glass=mat('Stock • clear acrylic',(.65,.85,.88),0,.16,.22)
library=bpy.data.collections.new('Reusable nominal stock • separate from campus');scene.collection.children.link(library)
def mesh_boxes(name,boxes,material):
 verts=[];faces=[]
 for a,b,w in boxes:
  a,b=Vector(a),Vector(b);d=b-a;z=d.normalized();ref=Vector((0,1,0)) if abs(z.y)<.9 else Vector((1,0,0));x=z.cross(ref).normalized()*w[0]/2;y=z.cross(x).normalized()*w[1]/2;k=len(verts)
  for p in [a,b]:
   for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]:verts.append(p+sx*x+sy*y)
  faces.extend([[k+j for j in f] for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
 m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.materials.append(material);return m
stock=[]
for h,w in [(8,4),(12,4),(16,3),(19,3)]:
 H,W=h*.3048,w*.3048;post=.065;boxes=[]
 for x in [post/2,W-post/2]:boxes.append(((x,0,0),(x,0,H),(post,.07)))
 for z in [.18,H-.18]:boxes.append(((post,0,z),(W-post,0,z),(.035,.035)))
 n=max(2,round(H/1.4))
 for j in range(n):boxes.append(((post if j%2==0 else W-post,0,.18+j*(H-.36)/n),(W-post if j%2==0 else post,0,.18+(j+1)*(H-.36)/n),(.025,.025)))
 ident=f'upright_frame_{h}ft_{w}ft';mesh=mesh_boxes(ident,boxes,blue);obj=bpy.data.objects.new(ident,mesh);library.objects.link(obj);obj['definition_id']=ident;obj['nominal_height_m']=H;obj['nominal_width_m']=W;obj['profile_status']='Illustrative profile, holes/connectors and bracing unmeasured';obj.location=(len(stock)*2.2,-35,0);stock.append(obj)
ident='horizontal_beam_12ft';mesh=mesh_boxes(ident,[((0,0,.08),(3.6576,0,.08),(.16,.075))],orange);obj=bpy.data.objects.new(ident,mesh);library.objects.link(obj);obj['definition_id']=ident;obj['nominal_length_m']=3.6576;obj['profile_status']='Illustrative section; end connectors unmeasured';obj.location=(10,-35,0);stock.append(obj)
# Adjustable sample blanks are explicitly templates, not inferred sheet sizes.
for ident,dims,ma in [('plywood_panel_template',(1.2192,2.4384,.018),ply),('timber_template',(.089,.038,2.4384),wood),('acrylic_panel_template',(1.2,.008,1.2),glass)]:
 x,y,z=dims;mesh=mesh_boxes(ident,[((x/2,y/2,0),(x/2,y/2,z),(x,y))],ma);obj=bpy.data.objects.new(ident,mesh);library.objects.link(obj);obj['definition_id']=ident;obj['dimension_status']='Adjustable example blank; stock dimensions NOT confirmed';obj.location=(len(stock)*2.2,-35,0);stock.append(obj)
# Export library instances centered at each definition origin, individual assets too.
for o in scene.objects:o.select_set(False)
for o in stock:
 saved=o.location.copy();o.location=(0,0,0);o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.export_scene.gltf(filepath=str(O/(o.name+'.glb')),export_format='GLB',use_selection=True,export_extras=True);o.select_set(False);o.location=saved
for o in stock:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'component-library.glb'),export_format='GLB',use_selection=True,export_extras=True)
for o in stock:o.hide_render=True;o.hide_set(True)
# Export only campus, retaining separate source objects and groups.
for o in scene.objects:o.select_set(False)
for o in [camp]+list(camp.children_recursive):
 if o!=terrain and o.get('assembly_id')!='reference-ground' and o.get('layer')!='Aerial reference':o.hide_set(False);o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'campus-components.glb'),export_format='GLB',use_selection=True,export_extras=True)
for o in scene.objects:o.select_set(False)
chiba=roots['chiba']
for o in [chiba]+list(chiba.children_recursive):o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'chiba-components.glb'),export_format='GLB',use_selection=True,export_extras=True)
# Stock library is available in Blender's asset browser; source CAD definitions stay editable.
for o in stock:o.asset_mark();o.asset_data.description=str(o.get('profile_status',o.get('dimension_status','Reusable part')))
scene.render.engine='CYCLES';scene.cycles.samples=12
world=bpy.data.worlds.new('Desert daylight');world.color=(.45,.5,.55);scene.world=world
light=bpy.data.lights.new('Sun','SUN');light.energy=2;sun=bpy.data.objects.new('Sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(.4,-.5,-.3)
cd=bpy.data.cameras.new('Review camera');cam=bpy.data.objects.new('Review camera',cd);scene.collection.objects.link(cam);cam.location=(32,-36,28);target=Vector((0,0,2));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cd.type='ORTHO';cd.ortho_scale=48;scene.camera=cam
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
for a in bpy.context.screen.areas:
 if a.type=='VIEW_3D':a.spaces.active.region_3d.view_distance=42;a.spaces.active.region_3d.view_location=(0,0,2)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(O/'mars-2026-modular.blend'))
manifest={'schema_version':1,'status':'editable_evidence_informed_CAD_replica_requires_as_built_dimension_review','source':source,'units':'metres','coordinate_origin_CAD_m':[177,66,0],'assemblies':[{'id':k,'name':o.name,'position_blender_m':list(o.location)} for k,o in roots.items() if k!='reference-ground'],'definitions':list(definitions.values()),'instances':records,'counts_by_kind':dict(count),'stock_on_hand':None,'limitations':['CAD frame names and scales conflict with user nominal stock. Imported rack members are not classified as 8/12/16/19ft stock.','Campus layout follows archived CAD aerial placement; aerial planes are not a surveyed orthomosaic.','Ground photos corroborate main hall, kitchen and Mimos features, but hidden partitions and compute-room location remain unverified.','Plywood pieces are source geometry, not a measured cut list.']}
(O/'components.json').write_text(json.dumps(manifest,indent=2));(O/'stock-library.json').write_text(json.dumps({'parts':[{'id':o.name,**{k:o[k] for k in o.keys()}} for o in stock]},indent=2))
scene.render.filepath=str(O/'modular-preview.png');bpy.ops.render.render(write_still=True)
print('DONE',len(records),'instances',len(definitions),'definitions',dict(count),flush=True)
