import bpy,sys,pathlib,json,math
from mathutils import Vector,Matrix
args=sys.argv[sys.argv.index('--')+1:];folder=pathlib.Path(args[0]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.usd_import(filepath=str(folder/'campus.usdz'))
if (folder/'canonical_transform.json').exists():
 tr=json.load(open(folder/'canonical_transform.json'));T=Matrix(tr['rotation']).to_4x4()
 for i in range(3):
  for j in range(3):T[i][j]*=tr['scale']
  T[i][3]=tr['translation'][i]
 G=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)));M=G@T@G.inverted()
 for o in bpy.context.scene.objects:
  if not o.parent:o.matrix_world=M@o.matrix_world
 bpy.context.view_layer.update()
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];coords=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box];lo=[min(c[i] for c in coords) for i in range(3)];hi=[max(c[i] for c in coords) for i in range(3)]
triangles=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes)
info={'meshes':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),'triangles':triangles,'blender_bounds':[lo,hi],'textures':[{'name':im.name,'size':list(im.size)} for im in bpy.data.images]}
print(json.dumps(info),flush=True);(folder/'mesh_info.json').write_text(json.dumps(info,indent=2))
bpy.ops.export_scene.gltf(filepath=str(folder/'campus.glb'),export_format='GLB',export_yup=True)
# Keep editable model with packed texture images.
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(folder/'campus.blend'))
# Photographic color: emission, no invented lighting or atmospheric effects.
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 nodes=mat.node_tree.nodes;tex=next((n for n in nodes if n.type=='TEX_IMAGE' and n.image and ('_tex' in n.image.name.lower())),None);output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
 if tex and output:
  emission=nodes.new('ShaderNodeEmission');mat.node_tree.links.new(tex.outputs['Color'],emission.inputs['Color']);mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=1400;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Neutral');scene.world.color=(.025,.035,.045);scene.view_settings.view_transform='Standard'
center=Vector([(a+b)/2 for a,b in zip(lo,hi)]);extent=max(b-a for a,b in zip(lo,hi));camdata=bpy.data.cameras.new('Review');cam=bpy.data.objects.new('Review',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.lens=42;camdata.clip_end=100000
cam.location=center+Vector((extent*.5,-extent*.65,extent*.65));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(folder/'overview.png');bpy.ops.render.render(write_still=True)
