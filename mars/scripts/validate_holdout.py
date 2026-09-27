import pathlib,json,subprocess,cv2,numpy as np,pycolmap
ROOT=pathlib.Path('~/Mars');BASE=ROOT/'docs/media/reconstruction/2026-campus';out=BASE/'validation/holdout-orbit';out.mkdir(parents=True,exist_ok=True);images=out/'images';images.mkdir(exist_ok=True)
times=[8.,23.,38.,53.,68.,83.,98.,113.,128.,143.,158.,171.]
for t in times:
 p=images/f'check_{t:06.2f}.jpg'
 if not p.exists():subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(ROOT/'media/drone/2026/DJI_0029.MP4'),'-frames:v','1','-q:v','2','-y',str(p)],check=True)
r=pycolmap.Reconstruction(BASE/'models/sfm-orbit/0');cam=r.cameras[1];f,cx,cy,k=cam.params;K=np.array([[f,0,cx],[0,f,cy],[0,0,1.]]);dist=np.array([k,0,0,0,0.])
ex=pycolmap.FeatureExtractionOptions();ex.max_image_size=2400;ex.num_threads=4;ex.sift.max_num_features=10000
reader=pycolmap.ImageReaderOptions();reader.camera_model='SIMPLE_RADIAL';reader.camera_params=','.join(map(str,cam.params))
pycolmap.extract_features(out/'database.db',images,camera_mode=pycolmap.CameraMode.SINGLE,reader_options=reader,extraction_options=ex,device=pycolmap.Device.cpu)
train=pycolmap.Database.open(BASE/'models/sfm-orbit/database.db');check=pycolmap.Database.open(out/'database.db');results=[]
for q in check.read_all_images():
 t=float(q.name[6:-4]);neighbors=sorted(r.images.values(),key=lambda im:abs((int(im.name[6:10])-.5)*1.25-t))[:5]
 desc=[];xyz=[];seen=set()
 for im in neighbors:
  ds=np.asarray(train.read_descriptors(im.image_id).data)
  for i,p in enumerate(im.points2D):
   if p.has_point3D() and p.point3D_id not in seen:
    seen.add(p.point3D_id);desc.append(ds[i]);xyz.append(r.points3D[p.point3D_id].xyz)
 ds=np.float32(desc);xyz=np.array(xyz);qd=np.float32(check.read_descriptors(q.image_id).data);xy=np.asarray(check.read_keypoints(q.image_id))[:,:2]
 matches=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=96)).knnMatch(qd,ds,k=2);good=[a for a,b in matches if a.distance<.75*b.distance]
 obj=np.array([xyz[a.trainIdx] for a in good]);img=np.array([xy[a.queryIdx] for a in good]);ok,rv,tv,inds=cv2.solvePnPRansac(obj,img,K,dist,iterationsCount=1000,reprojectionError=3.,confidence=.999)
 row={'file':q.name,'source':'media/drone/2026/DJI_0029.MP4','timestamp_seconds':t,'matches':len(good),'success':bool(ok)}
 if ok:
  ix=inds.ravel();rv,tv=cv2.solvePnPRefineLM(obj[ix],img[ix],K,dist,rv,tv);proj,_=cv2.projectPoints(obj[ix],rv,tv,K,dist);err=np.linalg.norm(proj[:,0]-img[ix],axis=1);R=cv2.Rodrigues(rv)[0]
  row.update(inliers=len(ix),median_px=float(np.median(err)),p95_px=float(np.percentile(err,95)),mean_px=float(err.mean()),R_world_to_camera=R.tolist(),t_world_to_camera=tv.ravel().tolist(),position=(-R.T@tv).ravel().tolist(),camera_params=cam.params.tolist(),width=cam.width,height=cam.height)
  np.savez(out/f'{q.name}.npz',xyz=obj[ix],xy=img[ix],residuals_px=err)
 print(q.name,row.get('inliers'),row.get('median_px'),flush=True);results.append(row)
(out/'results.json').write_text(json.dumps(results,indent=2));train.close();check.close()
