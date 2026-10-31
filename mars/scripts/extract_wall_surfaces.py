import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
"""Reproject only scanned triangles close to the four CAD wall planes.

Foreground vehicles are excluded geometrically. Transparent gaps are retained;
they represent missing evidence, not inferred paint.
"""
import bpy, bmesh, json, pathlib
from mathutils import Matrix, Vector

O=media('reconstruction/2026-campus/modular/deliverable')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(O/'chiba-photo-reference.glb'))
s=bpy.context.scene
sources=[o for o in s.objects if o.type=='MESH']
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 nodes=mat.node_tree.nodes;bs=nodes.get('Principled BSDF');out=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
 if bs:
  em=nodes.new('ShaderNodeEmission')
  for link in bs.inputs['Base Color'].links:mat.node_tree.links.new(link.from_socket,em.inputs['Color'])
  mat.node_tree.links.new(em.outputs[0],out.inputs['Surface'])
u=Vector((.9045,-.4265,0));v=Vector((.4265,.9045,0));origin=Vector((-8.47875,-8.925,0))
views=json.load(open(O/'textures/photographic-textures.json'))['projections']
s.render.engine='CYCLES';s.cycles.samples=1;s.cycles.use_denoising=False
s.render.resolution_x=s.render.resolution_y=4096;s.render.resolution_percentage=100
s.render.film_transparent=True;s.view_settings.view_transform='Standard'
s.world=bpy.data.worlds.new('Unlit photographic projection')
cd=bpy.data.cameras.new('Wall projection');cam=bpy.data.objects.new(cd.name,cd);s.collection.objects.link(cam);s.camera=cam;cd.type='ORTHO';cd.clip_end=1000
for view in views:
 name=view['id']
 if name=='roof':continue
 axis,offset={'long-south':(v,0),'long-north':(v,11.65),'end-east':(u,20.8),'end-west':(u,0)}[name]
 for source in sources:source.hide_render=True
 copies=[];count=0
 for source in sources:
  obj=source.copy();obj.data=source.data.copy();s.collection.objects.link(obj);obj.hide_render=False;copies.append(obj)
  bm=bmesh.new();bm.from_mesh(obj.data);remove=[]
  for face in bm.faces:
   c=obj.matrix_world@face.calc_center_median();q=c-origin
   # Keep a narrow slab around the observed exterior. Registration is approximate.
   distance=abs(q.dot(u)+c.z-23.0) if name=='end-east' else abs(q.dot(axis)-offset)
   if distance>.8 or c.z<.1 or c.z>7.1 or not (-.8<q.dot(u)<24 and -.8<q.dot(v)<12.45):remove.append(face)
  bmesh.ops.delete(bm,geom=remove,context='FACES');count+=len(bm.faces);bm.to_mesh(obj.data);bm.free()
 cam.matrix_world=Matrix(view['camera_world_matrix']);cd.ortho_scale=view['ortho_scale_m']
 s.render.filepath=str(O/'textures'/f'chiba-{name}-surface-projection.png');bpy.ops.render.render(write_still=True)
 print('EXTRACTED',name,count,flush=True)
 for obj in copies:bpy.data.objects.remove(obj,do_unlink=True)
