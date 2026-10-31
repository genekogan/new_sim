import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import pathlib,json,sys,numpy as np
from scipy.spatial.transform import Rotation
from align_cameras import similarity
BASE=media('reconstruction/2026-campus');folder=BASE/'models'/sys.argv[1];ref=BASE/'models'/sys.argv[2]
a=json.load(open(folder/'poses.json'));b={p['file']:p for p in json.load(open(ref/'poses.json'))};common=[p for p in a if p['file'] in b];x=np.array([p['translation'] for p in common]);y=np.array([b[p['file']]['translation'] for p in common]);s,R,t=similarity(x,y);err=np.linalg.norm(s*x@R.T+t-y,axis=1)
(folder/'canonical_transform.json').write_text(json.dumps({'reference':ref.name,'scale':float(s),'rotation':R.tolist(),'translation':t.tolist(),'camera_rms':float(np.sqrt(np.mean(err**2))),'common_cameras':len(common)},indent=2))
for p in a:
 p['translation']=(s*R@p['translation']+t).tolist();p['rotation_xyzw']=(Rotation.from_matrix(R)*Rotation.from_quat(p['rotation_xyzw'])).as_quat().tolist()
(folder/'canonical_poses.json').write_text(json.dumps(a,indent=2));print(folder.name,len(common),'camera RMS',np.sqrt(np.mean(err**2)),flush=True)
