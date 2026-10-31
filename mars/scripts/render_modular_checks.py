import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import bpy,json,pathlib,math,numpy as np
from mathutils import Matrix,Vector,Quaternion
B=media('reconstruction/2026-campus');O=B/'modular/deliverable';bpy.ops.wm.open_mainfile(filepath=str(O/'mars-2026-modular.blend'));s=bpy.context.scene;fit=json.load(open(B/'modular/research/chiba-local-alignment.json'));R=Matrix.Identity(3)
for i in range(2):
 for j in range(2):R[i][j]=fit['rotation'][i][j]
G=Matrix(((1,0,0),(0,0,-1),(0,1,0)));t=Vector((fit['translation'][0]-177,fit['translation'][1]-66,0));scale=fit['scale'];m=json.load(open(B/'deliverable/manifest.json'));views=m['models'][0]['views'];camera=s.camera;camera.data.type='PERSP';camera.data.sensor_fit='VERTICAL';camera.data.sensor_height=24;s.render.resolution_x=1280;s.render.resolution_y=720;s.cycles.samples=8;s.render.film_transparent=False;s.world.color=(.45,.45,.42);rows=[]
for i in [0,4,8]:
 v=views[i];q=v['quaternion'];rot=R@G@Quaternion((q[3],q[0],q[1],q[2])).to_matrix();camera.matrix_world=rot.to_4x4();camera.location=scale*(R@G@Vector(v['position']))+t;camera.data.lens=24/(2*math.tan(math.radians(v['fov']/2)));name=f'camera-check-{i:02}.png';s.render.filepath=str(O/name);bpy.ops.render.render(write_still=True);rows.append({'name':v['name'],'render':name,'reference':str(B/'deliverable'/v['image'].removeprefix('/data/')),'camera_transform':'source GLTF camera → Blender Z up → manual planar CAD registration','registration_RMS_m':fit['rms_m']})
(O/'camera-checks.json').write_text(json.dumps(rows,indent=2))
