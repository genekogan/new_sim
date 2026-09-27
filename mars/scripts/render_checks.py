import bpy,sys,json,pathlib,math
from mathutils import Matrix,Vector
args=sys.argv[sys.argv.index('--')+1:];folder=pathlib.Path(args[0]).resolve();BASE=pathlib.Path('<mars-media>/reconstruction/2026-campus');kind=args[1] if len(args)>1 else 'orbit';out=BASE/'validation'/folder.name;out.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(BASE/'deliverable/campus.blend' if kind=='campus' else folder/'campus.blend'))
# Blender Z-up to native Apple/glTF Y-up inverse conversion for cameras.
G=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
reg=json.load(open(BASE/('validation/campus-sfm-to-apple.json' if kind=='campus' else 'validation/sfm-to-apple.json')));R=Matrix(reg['rotation']);t=Vector(reg['translation']);s=reg['scale']
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 nodes=mat.node_tree.nodes;tex=next((n for n in nodes if n.type=='TEX_IMAGE' and n.image and '_tex' in n.image.name.lower()),None);output=next((n for n in nodes if n.type=='OUTPUT_MATERIAL'),None)
 if tex and output:
  emission=nodes.new('ShaderNodeEmission');mat.node_tree.links.new(tex.outputs['Color'],emission.inputs['Color']);mat.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.use_denoising=False;scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100;scene.world=bpy.data.worlds.new('Neutral');scene.world.color=(.01,.014,.018);scene.view_settings.view_transform='Standard'
camdata=bpy.data.cameras.new('Withheld view');cam=bpy.data.objects.new('Withheld view',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.sensor_width=36;camdata.clip_start=.001;camdata.clip_end=10000
for row in sorted(json.load(open(BASE/f'validation/holdout-{kind}/results.json')),key=lambda x:x['timestamp_seconds']):
 if not row['success']:continue
 rc=Matrix(row['R_world_to_camera']).transposed();rot=G@R@rc@Matrix(((1,0,0),(0,-1,0),(0,0,-1)));pos=G@(s*(R@Vector(row['position']))+t)
 cam.location=pos;cam.rotation_euler=rot.to_euler();camdata.lens=row['camera_params'][0]/row['width']*36;scene.render.filepath=str(out/row['file'].replace('.jpg','.png'));bpy.ops.render.render(write_still=True)
