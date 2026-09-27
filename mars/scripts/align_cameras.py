import numpy as np,json,pathlib,pycolmap
from scipy.spatial.transform import Rotation
BASE=pathlib.Path('<mars-media>/reconstruction/2026-campus')
def similarity(x,y):
 mx=x.mean(0);my=y.mean(0);xx=x-mx;yy=y-my;U,S,Vt=np.linalg.svd(yy.T@xx/len(x));d=np.ones(3);d[-1]=np.linalg.det(U@Vt);R=U@np.diag(d)@Vt;s=(S*d).sum()/(xx**2).sum()*len(x);t=my-s*R@mx;return s,R,t
if __name__=='__main__':
 r=pycolmap.Reconstruction(BASE/'models/sfm-orbit/0');poses={p['file']:p for p in json.load(open(BASE/'models/orbit-v1/poses.json'))};ims=[im for im in r.images.values() if im.name in poses];x=np.array([im.projection_center() for im in ims]);y=np.array([poses[im.name]['translation'] for im in ims]);s,R,t=similarity(x,y);err=np.linalg.norm(s*x@R.T+t-y,axis=1)
 d={'scale':float(s),'rotation':R.tolist(),'translation':t.tolist(),'median_camera_center_residual':float(np.median(err)),'max_camera_center_residual':float(err.max()),'relative_rms_percent_of_camera_radius':float(100*np.sqrt(np.mean(err**2))/np.linalg.norm(y-y.mean(0),axis=1).mean())}
 print(json.dumps(d,indent=2));(BASE/'validation/sfm-to-apple.json').write_text(json.dumps(d,indent=2))
