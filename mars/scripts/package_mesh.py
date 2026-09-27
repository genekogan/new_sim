import bpy,bmesh,sys,pathlib,json
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];folder=pathlib.Path(args[0]).resolve();base=folder.parents[1];out=base/'deliverable';out.mkdir(exist_ok=True);kind=args[1]
bpy.ops.wm.open_mainfile(filepath=str(folder/'campus.blend'))
# Remove only unsupported distant terrain, leaving the whole observed campus and tire oval.
# Bounds determined from the original 600 m orthographic inspection, in native model coordinates.
if kind=='campus':
 for o in bpy.context.scene.objects:
  if o.type!='MESH':continue
  bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);o.select_set(False)
  bm=bmesh.new();bm.from_mesh(o.data)
  for co,no in [((-225,0,0),(-1,0,0)),((170,0,0),(1,0,0)),((0,-100,0),(0,-1,0)),((0,155,0),(0,1,0))]:
   bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=co,plane_no=no,clear_outer=True,clear_inner=False)
  bm.to_mesh(o.data);bm.free();o.data.update()
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 ns=mat.node_tree.nodes;tex=next((n for n in ns if n.type=='TEX_IMAGE' and n.image and '_tex' in n.image.name),None)
 if not tex:continue
 image=tex.image;ns.clear();output=ns.new('ShaderNodeOutputMaterial');shader=ns.new('ShaderNodeBsdfPrincipled');shader.inputs['Roughness'].default_value=1;tex=ns.new('ShaderNodeTexImage');tex.image=image;mat.node_tree.links.new(tex.outputs['Color'],shader.inputs['Base Color']);mat.node_tree.links.new(shader.outputs[0],output.inputs['Surface'])
bpy.ops.export_scene.gltf(filepath=str(out/f'{kind}.glb'),export_format='GLB',export_image_format='JPEG',export_jpeg_quality=97,export_yup=True)
coords=[o.matrix_world@Vector(c) for o in bpy.context.scene.objects if o.type=='MESH' for c in o.bound_box];lo=[min(c[i] for c in coords) for i in range(3)];hi=[max(c[i] for c in coords) for i in range(3)]
tri=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH');info={'source':folder.name,'triangles':tri,'blender_bounds':[lo,hi],'glb_bounds':[[lo[0],lo[2],-hi[1]],[hi[0],hi[2],-lo[1]]],'crop_native_xz':[-225,170,-155,100] if kind=='campus' else None};(out/f'{kind}_mesh.json').write_text(json.dumps(info,indent=2));print(info,flush=True)
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out/f'{kind}.blend'))
