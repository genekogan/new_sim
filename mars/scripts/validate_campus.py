import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import pathlib,json,cv2,numpy as np,pycolmap
from align_cameras import similarity
BASE=media('reconstruction/2026-campus');out=BASE/'validation/holdout-campus';images=out/'images';sfm=BASE/'models/sfm-campus-constrained'
models=[pycolmap.Reconstruction(p) for p in sfm.iterdir() if p.is_dir() and (p/'images.bin').exists()];r=max(models,key=lambda r:r.num_reg_images());cam=next(c for c in r.cameras.values() if c.width==1920);f,cx,cy,k=cam.params;K=np.array([[f,0,cx],[0,f,cy],[0,0,1.]]);dist=np.array([k,0,0,0,0.])
a={p['file']:p for p in json.load(open(BASE/'models/campus-v1/poses.json'))};common=[im for im in r.images.values() if im.name in a];x=np.array([im.projection_center() for im in common]);y=np.array([a[im.name]['translation'] for im in common]);s,R,t=similarity(x,y);err=np.linalg.norm(s*x@R.T+t-y,axis=1)
(BASE/'validation/campus-sfm-to-apple.json').write_text(json.dumps({'scale':s,'rotation':R.tolist(),'translation':t.tolist(),'common_cameras':len(common),'center_rms':float(np.sqrt(np.mean(err**2))),'center_median':float(np.median(err)),'cameras':{str(c.camera_id):{'width':c.width,'height':c.height,'params':c.params.tolist()} for c in r.cameras.values()}},indent=2))
ex=pycolmap.FeatureExtractionOptions();ex.max_image_size=2400;ex.num_threads=4;ex.sift.max_num_features=10000;reader=pycolmap.ImageReaderOptions();reader.camera_model='SIMPLE_RADIAL';reader.camera_params=','.join(map(str,cam.params))
pycolmap.extract_features(out/'database.db',images,camera_mode=pycolmap.CameraMode.SINGLE,reader_options=reader,extraction_options=ex,device=pycolmap.Device.cpu)
train=pycolmap.Database.open(BASE/'models/sfm-campus-shared/database.db');check=pycolmap.Database.open(out/'database.db');results=[];sources={p['file']:p for p in json.load(open(out/'sources.json'))}
for q in check.read_all_images():
 src=sources[q.name];tm=src['timestamp_seconds'];clip=q.name[:8];neighbors=sorted([im for im in r.images.values() if im.name.startswith(clip)],key=lambda im:abs(int(im.name[9:-4])-tm))[:7];desc=[];xyz=[];seen=set()
 for im in neighbors:
  ds=np.asarray(train.read_descriptors(im.image_id).data)
  for i,p in enumerate(im.points2D):
   if p.has_point3D() and p.point3D_id not in seen:
    seen.add(p.point3D_id);desc.append(ds[i]);xyz.append(r.points3D[p.point3D_id].xyz)
 ds=np.float32(desc);xyz=np.array(xyz);qd=np.float32(check.read_descriptors(q.image_id).data);xy=np.asarray(check.read_keypoints(q.image_id))[:,:2];row={**src,'success':False}
 if len(ds)<10:results.append(row);continue
 matches=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=96)).knnMatch(qd,ds,k=2);good=[a for a,b in matches if a.distance<.75*b.distance];obj=np.array([xyz[a.trainIdx] for a in good]);img=np.array([xy[a.queryIdx] for a in good]);ok,rv,tv,inds=cv2.solvePnPRansac(obj,img,K,dist,iterationsCount=1000,reprojectionError=3.,confidence=.999);row.update(matches=len(good),success=bool(ok))
 if ok:
  ix=inds.ravel();rv,tv=cv2.solvePnPRefineLM(obj[ix],img[ix],K,dist,rv,tv);proj,_=cv2.projectPoints(obj[ix],rv,tv,K,dist);err=np.linalg.norm(proj[:,0]-img[ix],axis=1);rot=cv2.Rodrigues(rv)[0];row.update(inliers=len(ix),median_px=float(np.median(err)),p95_px=float(np.percentile(err,95)),mean_px=float(err.mean()),R_world_to_camera=rot.tolist(),position=(-rot.T@tv).ravel().tolist(),camera_params=cam.params.tolist(),width=cam.width,height=cam.height);np.savez(out/f'{q.name}.npz',xyz=obj[ix],xy=img[ix],residuals_px=err)
 
 if row.get('inliers',0)<100:row.update(success=False,rejection_reason='Fewer than 100 supporting landmarks')
 print(q.name,row.get('inliers'),row.get('median_px'),flush=True);results.append(row)
(out/'results.json').write_text(json.dumps(results,indent=2));train.close();check.close()
