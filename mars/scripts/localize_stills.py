import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import pathlib,json,cv2,numpy as np,pycolmap,os
from align_cameras import similarity
BASE=media('reconstruction/2026-campus');out=BASE/'validation/stills-to-orbit';out.mkdir(exist_ok=True);images=out/'images';images.mkdir(exist_ok=True)
frames=[r for r in json.load(open(BASE/'inventory/campus-march19-frames.json')) if 'gps' in r]
for f in frames:
 dest=images/f['file']
 if not dest.exists():dest.symlink_to(BASE/'frames/campus-march19'/f['file'])
r=pycolmap.Reconstruction(BASE/'models/sfm-orbit/0');cam=r.cameras[1];f,cx,cy,k=cam.params;scale=4000/3840;f*=scale;cx*=scale;cy*=scale;K=np.array([[f,0,cx],[0,f,cy],[0,0,1.]]);dist=np.array([k,0,0,0,0.])
ex=pycolmap.FeatureExtractionOptions();ex.max_image_size=2400;ex.num_threads=4;ex.sift.max_num_features=10000
reader=pycolmap.ImageReaderOptions();reader.camera_model='SIMPLE_RADIAL';reader.camera_params=','.join(map(str,[f,cx,cy,k]))
pycolmap.extract_features(out/'database.db',images,camera_mode=pycolmap.CameraMode.SINGLE,reader_options=reader,extraction_options=ex,device=pycolmap.Device.cpu)
train=pycolmap.Database.open(BASE/'models/sfm-orbit/database.db');check=pycolmap.Database.open(out/'database.db');desc=[];xyz=[];seen=set()
for im in r.images.values():
 ds=np.asarray(train.read_descriptors(im.image_id).data)
 for i,p in enumerate(im.points2D):
  if p.has_point3D() and p.point3D_id not in seen:
   seen.add(p.point3D_id);desc.append(ds[i]);xyz.append(r.points3D[p.point3D_id].xyz)
ds=np.float32(desc);xyz=np.array(xyz);matcher=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=96));matcher.add([ds]);matcher.train();results=[]
for q in check.read_all_images():
 qd=np.float32(check.read_descriptors(q.image_id).data);xy=np.asarray(check.read_keypoints(q.image_id))[:,:2];matches=matcher.knnMatch(qd,k=2);good=[a for a,b in matches if a.distance<.75*b.distance];obj=np.array([xyz[a.trainIdx] for a in good]);img=np.array([xy[a.queryIdx] for a in good]);ok=False
 if len(good)>30:ok,rv,tv,inds=cv2.solvePnPRansac(obj,img,K,dist,iterationsCount=3000,reprojectionError=4.,confidence=.999)
 row={'file':q.name,'matches':len(good),'success':bool(ok)}
 if ok:
  ix=inds.ravel();rv,tv=cv2.solvePnPRefineLM(obj[ix],img[ix],K,dist,rv,tv);proj,_=cv2.projectPoints(obj[ix],rv,tv,K,dist);err=np.linalg.norm(proj[:,0]-img[ix],axis=1);R=cv2.Rodrigues(rv)[0];row.update(inliers=len(ix),median_px=float(np.median(err)),p95_px=float(np.percentile(err,95)),R_world_to_camera=R.tolist(),t_world_to_camera=tv.ravel().tolist(),position=(-R.T@tv).ravel().tolist())
 print(row['file'],row.get('inliers'),row.get('median_px'),flush=True);results.append(row)
(out/'results.json').write_text(json.dumps(results,indent=2));train.close();check.close()
source={f['file']:f for f in frames};valid=[q for q in results if q['success'] and q['inliers']>=100];x=np.array([q['position'] for q in valid]);gps=np.array([source[q['file']]['gps'] for q in valid]);ref=gps.mean(0);y=np.column_stack(((gps[:,1]-ref[1])*111320*np.cos(np.deg2rad(ref[0])),gps[:,2]-ref[2],-(gps[:,0]-ref[0])*111132));s,R,t=similarity(x,y);res=np.linalg.norm(s*x@R.T+t-y,axis=1)
report={'localized_stills':len(valid),'meters_per_sfm_unit':float(s),'rms_gps_residual_m':float(np.sqrt(np.mean(res**2))),'max_gps_residual_m':float(res.max()),'points':[{'file':q['file'],'residual_m':float(e)} for q,e in zip(valid,res)]};(out/'gps_scale.json').write_text(json.dumps(report,indent=2));print(report,flush=True)
