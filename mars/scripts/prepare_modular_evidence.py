import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import pathlib,json,hashlib
import numpy as np
from PIL import Image,ImageOps
B=media('reconstruction/2026-campus/modular');O=B/'deliverable';R=B/'research';(O/'references').mkdir(parents=True,exist_ok=True)
r=json.load(open(R/'interior-candidates.json'))
selection=[(0,'Main hall during build','Tiered timber seating, central aisle and rack skeleton. December 2025 build for the 2026 season.'),(110,'Main hall · projector wall','Tall white projection surface between uprights; side galleries and lower rooms. February 2026.'),(11,'Main hall · upper gallery','Upper-floor gallery overlooking the double-height classroom.'),(37,'Kitchen','Perimeter plywood counters, stainless prep table and sink beneath the far window. Exact cabinet dimensions unmeasured.'),(5,'Kitchen during build','Window openings and perimeter counter arrangement before finish.'),(80,'Mimos · transparent wall','Sloping transparent panels with timber framing, blue rack uprights, orange beams and seating.'),(77,'Mimos · coffee counter','Coffee equipment and café signage; movable furnishings.'),(71,'Mimos · seating','Long café interior with tables and soft seating.'),(102,'Desk and screens','2026 workspace photo; exact location within upper-floor plan remains unconfirmed.'),(95,'Electronics workspace candidate','Useful furniture/equipment reference. Identification as the compute room is unconfirmed.')]
refs=[]
for i,title,caption in selection:
 row=r[i];p=pathlib.Path(row['abs_path']);im=ImageOps.exif_transpose(Image.open(p)).convert('RGB');im.thumbnail((1800,1800));name=f'reference-{i:03}.jpg';im.save(O/'references'/name,quality=92)
 refs.append({'id':f'ref-{i:03}','title':title,'caption':caption,'url':'/modular/references/'+name,'source_path':str(p),'source_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'location_confirmed':i not in [95,102]})
(O/'references.json').write_text(json.dumps(refs,indent=2))
# Manual roof-outline alignment is only an initial local fit, not a survey result.
cadpx=np.array([[477,1140],[1172,1466],[1390,1070],[658,731]],float)
scanpx=np.array([[1030,980],[1215,410],[870,310],[710,885]],float)
cad=np.column_stack((177+(cadpx[:,0]/1600-.5)*42,66+(.5-cadpx[:,1]/1600)*42))
scan=np.column_stack(((scanpx[:,0]/1600-.5)*1.6,(.5-scanpx[:,1]/1600)*1.6))
# solve similarity scan -> CAD
x=scan-scan.mean(0);y=cad-cad.mean(0);U,S,V=np.linalg.svd(x.T@y);rot=V.T@U.T;scale=S.sum()/(x*x).sum();t=cad.mean(0)-scale*rot@scan.mean(0);pred=scan@rot.T*scale+t;err=np.linalg.norm(pred-cad,axis=1)
fit={'method':'manual roof corners, least-squares planar similarity','scale':scale,'rotation':rot.tolist(),'translation':t.tolist(),'scan_points':scan.tolist(),'cad_points':cad.tolist(),'residual_m':err.tolist(),'rms_m':float(np.sqrt(np.mean(err**2))),'status':'approximate visual alignment only; roof-edge uncertainty and CAD differences'}
(R/'chiba-local-alignment.json').write_text(json.dumps(fit,indent=2));print(fit)
p=R/'scan-to-cad-map.json'
if p.exists():bad=json.load(open(p));bad['status']='REJECTED: degenerate SIFT fit, insufficient support; never use for geometry';p.write_text(json.dumps(bad,indent=2))
