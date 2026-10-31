import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
"""Apply evidence-backed facade finishes and independently editable context people."""
import bpy,json,pathlib,shutil,math
import numpy as np
from mathutils import Matrix,Vector
O=media('reconstruction/2026-campus/modular/deliverable')
B=O.parent/'research/appearance'
for name in ['mars-2026-modular.blend','components.json']:
 backup=B/('before-appearance-'+name)
 if not backup.exists():shutil.copy2(O/name,backup)
bpy.ops.wm.open_mainfile(filepath=str(B/'before-appearance-mars-2026-modular.blend'))
s=bpy.context.scene;m=json.load(open(B/'before-appearance-components.json'));records={r['id']:r for r in m['instances']}
u=Vector((.9045,-.4265,0));v=Vector((.4265,.9045,0));origin=Vector((-8.47875,-8.925,0))
views={};mats={};alpha={}
for view in json.load(open(O/'textures/photographic-textures.json'))['projections']:
 name=view['id']
 if name=='roof':continue
 im=bpy.data.images.load(str(O/'textures'/f'chiba-{name}-surface-projection.png'),check_existing=False)
 pixels=np.array(im.pixels[:],dtype=np.float32).reshape(im.size[1],im.size[0],4);alpha[name]=pixels[:,:,3].copy()
 # Texture bake: unsupported scan pixels fall back to neutral wood, not invented artwork.
 a=pixels[:,:,3:4];pixels[:,:,:3]=pixels[:,:,:3]*a+np.array([.34,.26,.17])*(1-a);pixels[:,:,3]=1
 im.pixels.foreach_set(pixels.ravel());im.update();im.filepath_raw=str(O/'textures'/f'chiba-{name}-finish-projection.png');im.file_format='PNG';im.save();im.pack()
 mat=bpy.data.materials.new('Surface evidence • '+name);mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.92
 tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='EXTEND';uv=mat.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='Observed projection UV'
 mat.node_tree.links.new(uv.outputs['UV'],tex.inputs['Vector']);mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 mats[name]=mat;views[name]=(Matrix(view['camera_world_matrix']).inverted(),view['ortho_scale_m'])
applied=[];facecount=0
for obj in list(s.objects):
 if obj.type!='MESH' or obj.get('assembly_id')!='chiba' or obj.get('kind')!='wood_component':continue
 selected=[];world=obj.matrix_world
 for f in obj.data.polygons:
  c=world@f.center;n=(world.to_3x3()@f.normal).normalized();q=c-origin;U=q.dot(u);V=q.dot(v)
  if c.z<.25 or abs(n.z)>.8:continue
  d,direction,name=min([(abs(V),-v,'long-south'),(abs(V-11.65),v,'long-north'),(abs(U+c.z-20.95),u,'end-east'),(abs(U),-u,'end-west')],key=lambda a:a[0])
  if d>.7 or n.dot(direction)<.6 or not (-1<U<24 and -1<V<13):continue
  inv,scale=views[name];mask=alpha[name];coverage=[]
  for p in [c]+[(world@obj.data.vertices[i].co)*.9+c*.1 for i in f.vertices]:
   p=inv@p;x=int((p.x/scale+.5)*(mask.shape[1]-1));y=int((p.y/scale+.5)*(mask.shape[0]-1))
   coverage.append(float(mask[y,x]) if 0<=y<mask.shape[0] and 0<=x<mask.shape[1] else 0)
  if sum(coverage)/len(coverage)>.65:selected.append((f.index,name))
 if not selected:continue
 obj.data=obj.data.copy();uv=obj.data.uv_layers.get('Observed projection UV') or obj.data.uv_layers.new(name='Observed projection UV');slots={}
 for index,name in selected:
  if name not in slots:slots[name]=len(obj.data.materials);obj.data.materials.append(mats[name])
  f=obj.data.polygons[index];f.material_index=slots[name];inv,scale=views[name]
  for li in f.loop_indices:
   p=inv@(world@obj.data.vertices[obj.data.loops[li].vertex_index].co);uv.data[li].uv=(p.x/scale+.5,p.y/scale+.5)
 ident=obj['component_id'];applied.append(ident);facecount+=len(selected);obj['finish_status']='March 23 drone facade surface extraction; approximate registration'
 records[ident]['finish_source']='appearance-sources.json'

camp=bpy.data.objects.get('Mars 2026 • Editable campus')
people=bpy.data.objects.new('People • generic movable context',None);s.collection.objects.link(people);people.parent=camp;people['assembly_id']='people'
m['assemblies'].append({'id':'people','name':'People · generic context','position_blender_m':[0,0,0]})
placements=[('person_casual',4,-3,25),('person_woman',5.6,-3.4,210),('person_punk',14,-4,145),('person_woman',-3,4,70),('person_casual',-4,5,-80),('person_punk',8,15,0),('person_woman',18,14,115),('person_casual',26,3,90)]
templates={}
for name in sorted(set(p[0] for p in placements)):
 before=set(s.objects);bpy.ops.import_scene.gltf(filepath=str(O/(name+'.glb')));imported=set(s.objects)-before
 obj=next(o for o in imported if o.type=='MESH');world=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=world
 for other in imported:
  if other!=obj:bpy.data.objects.remove(other,do_unlink=True)
 templates[name]=obj
 m['definitions'].append({'id':name,'kind':'context_person','dimension_status':'illustrative_1.75m_not_inventory','source':'appearance-sources.json'})
for i,(name,U,V,angle) in enumerate(placements):
 obj=templates[name].copy();obj.data=templates[name].data;s.collection.objects.link(obj);obj.parent=people
 obj.location=origin+u*U+v*V;obj.location.z=-.15;obj.rotation_euler.z=math.radians(angle);obj.name=f'Person {i+1:02d} • {name.removeprefix("person_")}'
 ident=f'context_person-{i+1:03d}';obj['component_id']=ident;obj['assembly_id']='people';obj['layer']='People';obj['kind']='context_person';obj['definition_id']=name
 records[ident]={'id':ident,'assembly_id':'people','definition_id':name,'kind':'context_person','layer':'People','position_m':list(obj.location),'source':'appearance-sources.json','inventory':False}
for obj in templates.values():bpy.data.objects.remove(obj,do_unlink=True)
m['instances']=list(records.values());m['refinements']['facade_surface_components']=len(applied);m['refinements']['generic_people']=len(placements)
m['refinements'].pop('facade_projection_rejected',None)
m['limitations']=[l for l in m['limitations'] if not l.startswith('Only clean roof projections')]
m['limitations'].append('Facade finishes use extracted March 23 scan surfaces with a 0.8m wall-plane slab and coverage screening. Missing or poorly aligned surfaces retain CAD materials. Generic people and soil are presentation assets, not surveyed evidence or stock.')
(O/'components.json').write_text(json.dumps(m,indent=2))
for obj in s.objects:obj.select_set(False)
for obj in [camp]+list(camp.children_recursive):
 if obj.get('assembly_id')!='reference-ground' and obj.get('layer')!='Aerial reference':obj.hide_set(False);obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'campus-components.glb'),export_format='GLB',use_selection=True,export_extras=True,export_animations=False)
for obj in s.objects:obj.select_set(False)
chiba=next(o for o in s.objects if o.get('assembly_id')=='chiba' and not o.get('layer') and not o.get('component_id'))
for obj in [chiba]+list(chiba.children_recursive):obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(O/'chiba-components.glb'),export_format='GLB',use_selection=True,export_extras=True,export_animations=False)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(O/'mars-2026-modular.blend'))
print('APPEARANCE',len(applied),'wall components',facecount,'faces;',len(placements),'people',flush=True)
