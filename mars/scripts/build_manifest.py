import pathlib,json,numpy as np,math,shutil
from PIL import Image
from scipy.spatial.transform import Rotation
BASE=pathlib.Path('<mars-media>/reconstruction/2026-campus');out=BASE/'deliverable';(out/'images').mkdir(exist_ok=True)
reg=json.load(open(BASE/'validation/sfm-to-apple.json'));s=reg['scale'];R=np.array(reg['rotation']);t=np.array(reg['translation']);views=[]
for row in sorted(json.load(open(BASE/'validation/holdout-orbit/results.json')),key=lambda x:x['timestamp_seconds']):
 if not row['success']:continue
 pos=s*R@row['position']+t;rot=R@np.array(row['R_world_to_camera']).T@np.diag([1,-1,-1]);im=Image.open(BASE/'validation/holdout-orbit/images'/row['file']);im.thumbnail((1920,1080));im.save(out/'images'/row['file'],quality=95)
 secs=row['timestamp_seconds'];views.append({'name':f'{int(secs)//60:02d}:{int(secs)%60:02d} · Chiba orbit','image':'/data/images/'+row['file'],'position':pos.tolist(),'quaternion':Rotation.from_matrix(rot).as_quat().tolist(),'fov':math.degrees(2*math.atan(row['height']/2/row['camera_params'][0])),'aspect':row['width']/row['height'],'heldOut':True})
chiba_info=json.load(open(out/'chiba_mesh.json'));campus_info=json.load(open(out/'campus_mesh.json'))
model={'id':'chiba','name':'Chiba · Close orbit','date':'23 March 2026','url':'/data/chiba.glb','frames':140,'triangles':chiba_info['triangles'],'description':'A textured exterior mesh reconstructed from the original 4K daylight orbit. Select a check photograph below to compare it with the same camera view.','limitations':['Thin rails and poles are incomplete; some are reconstructed as wisps.','Shaded recesses, transparent glazing, and unobserved interiors are unresolved.','Outer trailers and the edge of the ground surface contain gaps and softened geometry.','Textures contain the original sunlight and shadows.'],'views':views,'target':[0,.10,0],'home':[1.65,1.25,1.65],'up':[0,1,0],'scale':'Relative units; no surveyed control','residual':'0.63 px · sparse camera solve'}
chosen=['photo_DJI_0005.JPG','photo_DJI_0007.JPG','photo_DJI_0013.JPG'];folder=BASE/'models'/campus_info['source'];pf=folder/'canonical_poses.json';pf=pf if pf.exists() else folder/'poses.json';poses={p['file']:p for p in json.load(open(pf))};cv=[]
for name in chosen:
 if name not in poses:continue
 p=poses[name];im=Image.open(BASE/'frames/campus-march19'/name);aspect=im.width/im.height;im.thumbnail((1920,1080));dest='campus_'+name;im.save(out/'images'/dest,quality=95)
 cv.append({'name':name.replace('photo_','').replace('.jpg','').replace('.JPG',''),'image':'/data/images/'+dest,'position':p['translation'],'quaternion':p['rotation_xyzw'],'fov':math.degrees(2*math.atan(2250/2/2919.0330999579455)),'aspect':aspect,'heldOut':False})
reg=json.load(open(BASE/'validation/campus-sfm-to-apple.json'));s=reg['scale'];R=np.array(reg['rotation']);t=np.array(reg['translation']);checks=[]
for row in sorted(json.load(open(BASE/'validation/holdout-campus/results.json')),key=lambda x:x['file']):
 if not row['success']:continue
 pos=s*R@row['position']+t;rot=R@np.array(row['R_world_to_camera']).T@np.diag([1,-1,-1]);im=Image.open(BASE/'validation/holdout-campus/images'/row['file']);im.thumbnail((1920,1080));dest='check_campus_'+row['file'];im.save(out/'images'/dest,quality=95);tm=int(row['timestamp_seconds']);clip=row['file'][:8].replace('DJI_00','Flight ')
 checks.append({'name':f'{clip} · {tm//60:02d}:{tm%60:02d}','image':'/data/images/'+dest,'position':pos.tolist(),'quaternion':Rotation.from_matrix(rot).as_quat().tolist(),'fov':math.degrees(2*math.atan(row['height']/2/row['camera_params'][0])),'aspect':row['width']/row['height'],'heldOut':True})
cv=checks+cv
wide={'id':'campus','name':'Campus · Wide view','date':'19 March 2026','url':'/data/campus.glb','frames':254,'triangles':campus_info['triangles'],'description':'The wider campus, trailer arc, outer camps, and tire oval, reconstructed from two same-day flights and 17 original GPS-tagged photographs. 251 inputs registered.','limitations':['Outer camps have fewer close views and lower detail than Chiba.','The unsupported distant desert fringe is cropped. The retained terrain is not a surveyed elevation model.','Thin structures, hidden surfaces, and moving objects remain incomplete.','GPS positions disagree by 1.7 m RMS; centimetre accuracy is not established.'],'views':cv,'target':[0,3,-35],'home':[160,150,180],'up':[0,1,0],'scale':'Approximate metres · consumer GPS'}
(out/'manifest.json').write_text(json.dumps({'models':[model,wide]},indent=2));print('manifest',len(views),len(cv))
