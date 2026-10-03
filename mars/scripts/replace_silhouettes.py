"""Replace the visually verified, four-person CAD silhouette definition.

Keep original group IDs/transforms for saved layouts. Individual replacements
are shared reusable human meshes, anchored at each original silhouette's feet.
"""
import bpy,json,pathlib,shutil,collections,math,csv
import numpy as np
from mathutils import Matrix,Vector
O=pathlib.Path('<mars-media>/reconstruction/2026-campus/modular/deliverable');R=O.parent/'research/silhouettes'
for name in ['mars-2026-modular.blend','components.json']:
 backup=R/('before-'+name)
 if not backup.exists():shutil.copy2(O/name,backup)
bpy.ops.wm.open_mainfile(filepath=str(R/'before-mars-2026-modular.blend'));s=bpy.context.scene
m=json.load(open(R/'before-components.json'));records={r['id']:r for r in m['instances']}
targets=[o for o in s.objects if o.type=='MESH' and o.get('definition_id')=='cad-40b2b78c32721c']
assert len(targets)==2,'Reinspect source silhouettes if the model changed'
templates={}
for name in ['person_casual','person_woman','person_punk']:
 before=set(s.objects);bpy.ops.import_scene.gltf(filepath=str(O/(name+'.glb')));imported=set(s.objects)-before
 obj=next(o for o in imported if o.type=='MESH');world=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=world
 for other in imported:
  if other!=obj:bpy.data.objects.remove(other,do_unlink=True)
 templates[name]=obj
report=[];counter=9
for source in targets:
 p=np.array([source.matrix_world@v.co for v in source.data.vertices]);_,inv=np.unique(np.round(p,4),axis=0,return_inverse=True);parents=list(range(int(inv.max())+1))
 def find(i):
  while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
  return i
 for face in source.data.polygons:
  ids=[int(inv[i]) for i in face.vertices];a=find(ids[0])
  for j in ids[1:]:parents[find(j)]=a
 groups=collections.defaultdict(list)
 for i,k in enumerate(inv):groups[find(int(k))].append(i)
 assert len(groups)==4
 root=bpy.data.objects.new('People • replaced CAD silhouettes',None);s.collection.objects.link(root);root.parent=source.parent;root.matrix_world=source.matrix_world.copy()
 for k,v in source.items():root[k]=v
 root['kind']='context_group';root['layer']='People';root['definition_id']='people_group_four';root['evidence']='Four CAD silhouette placements replaced with reusable Quaternius meshes; not inventory.'
 record=records[source['component_id']];record.update({'kind':'context_group','layer':'People','definition_id':'people_group_four','inventory':False,'replacement_source':'silhouette-replacements.json'})
 for index,ids in enumerate(sorted(groups.values(),key=lambda ids:float(p[ids,0].mean()))):
  points=p[ids];lo=points.min(0);hi=points.max(0);foot=(lo+hi)/2;foot[2]=lo[2]
  assert 1.5<hi[2]-lo[2]<1.9
  name=['person_casual','person_woman','person_punk','person_woman'][index];template=templates[name]
  obj=template.copy();obj.data=template.data;s.collection.objects.link(obj);obj.parent=root
  # Distinct natural orientations within each original group.
  obj.matrix_world=Matrix.Translation(Vector(foot))@Matrix.Rotation(math.radians([65,240,150,-30][index]),4,'Z')@template.matrix_world
  ident=f'context_person-{counter:03d}';counter+=1;obj.name=f'Chiba person • {ident}';obj['component_id']=ident;obj['assembly_id']=source['assembly_id'];obj['definition_id']=name;obj['kind']='context_person';obj['layer']='People';obj['evidence']='Quaternius CC0 human mesh replacing a visually verified CAD silhouette at its original foot position.'
  records[ident]={'id':ident,'assembly_id':source['assembly_id'],'definition_id':name,'kind':'context_person','layer':'People','position_m':list(obj.location),'source':'silhouette-replacements.json','inventory':False}
  report.append({'old_group':source['component_id'],'new_person':ident,'template':name,'foot_blender_m':foot.tolist(),'original_height_m':float(hi[2]-lo[2])})
 bpy.data.objects.remove(source,do_unlink=True)
# Two additional colored, flat SketchUp Ty figures are split by material.
tygroups=collections.defaultdict(list)
for ident,record in list(records.items()):
 tag=next((a for a in record.get('source_ancestors',[]) if a.startswith('Ty_Ty')),None)
 if tag:tygroups[tag].append(ident)
for tag,ids in tygroups.items():
 old=[o for o in s.objects if o.get('component_id') in ids];points=np.array([o.matrix_world@v.co for o in old for v in o.data.vertices]);lo=points.min(0);hi=points.max(0);foot=(lo+hi)/2;foot[2]=lo[2]
 # Verify this really is a flat human-sized figure before replacing its parts.
 singular=np.linalg.svd(points-points.mean(0),compute_uv=False)
 assert singular[-1]/singular[0]<.001 and 1.5<hi[2]-lo[2]<2.2
 obj=templates['person_casual'].copy();obj.data=templates['person_casual'].data;s.collection.objects.link(obj);obj.parent=old[0].parent;obj.matrix_world=Matrix.Translation(Vector(foot))@Matrix.Rotation(.5,4,'Z')@templates['person_casual'].matrix_world
 ident=f'context_person-{counter:03d}';counter+=1;obj.name='Person • replaced flat Ty';obj['component_id']=ident;obj['assembly_id']=old[0]['assembly_id'];obj['definition_id']='person_casual';obj['kind']='context_person';obj['layer']='People'
 records[ident]={'id':ident,'assembly_id':old[0]['assembly_id'],'definition_id':'person_casual','kind':'context_person','layer':'People','position_m':list(obj.location),'source':'silhouette-replacements.json','inventory':False}
 report.append({'old_group':tag,'old_parts':ids,'new_person':ident,'template':'person_casual','foot_blender_m':foot.tolist(),'original_height_m':float(hi[2]-lo[2])})
 for o in old:records.pop(o['component_id']);bpy.data.objects.remove(o,do_unlink=True)
for obj in templates.values():bpy.data.objects.remove(obj,do_unlink=True)
m['instances']=list(records.values());m['definitions']=[d for d in m['definitions'] if d['id']!='cad-40b2b78c32721c'];m['definitions'].append({'id':'people_group_four','kind':'context_group','dimension_status':'illustrative_people_not_inventory','source':'silhouette-replacements.json'})
used={r['definition_id'] for r in m['instances']};m['definitions']=[d for d in m['definitions'] if d['id'] in used]
m['counts_by_kind']=dict(collections.Counter(r['kind'] for r in m['instances']));m['refinements']['remaining_CAD_silhouettes_replaced']=len(report);m['refinements']['generic_people']=8+len(report)
(O/'components.json').write_text(json.dumps(m,indent=2));(O/'silhouette-replacements.json').write_text(json.dumps({'method':'Connected CAD silhouettes were visually reviewed, then replaced individually at original foot anchors. Group IDs retained for layouts. Human height 1.75m; no claim of actual attendee identity.','replacements':report},indent=2))
# Silhouettes were previously mislabeled as physical CAD fittings in this audit.
csvpath=O/'modeled-pieces.csv';rows=list(csv.DictReader(csvpath.open()));fields=list(rows[0]);removed={r['old_group'] for r in report}|{ident for r in report for ident in r.get('old_parts',[])}
with csvpath.open('w') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(r for r in rows if r['component_id'] not in removed)
camp=bpy.data.objects.get('Mars 2026 • Editable campus');chiba=next(o for o in s.objects if o.get('assembly_id')=='chiba' and not o.get('layer') and not o.get('component_id'))
for root,name in [(camp,'campus-components.glb'),(chiba,'chiba-components.glb')]:
 for obj in s.objects:obj.select_set(False)
 for obj in [root]+list(root.children_recursive):
  if obj.get('assembly_id')!='reference-ground' and obj.get('layer')!='Aerial reference':obj.hide_set(False);obj.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(O/name),export_format='GLB',use_selection=True,export_extras=True,export_animations=False)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(O/'mars-2026-modular.blend'));print('REPLACED',len(report),'silhouettes; zero instances of the old silhouette mesh remain')
