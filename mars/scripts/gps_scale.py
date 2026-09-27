import pathlib,json,numpy as np,sys
from align_cameras import similarity
BASE=pathlib.Path('<mars-media>/reconstruction/2026-campus');name=sys.argv[1] if len(sys.argv)>1 else 'campus-v1';folder=BASE/'models'/name
frames={r['file']:r for r in json.load(open(BASE/'inventory/campus-march19-frames.json'))};poses=json.load(open(folder/'poses.json'));selected=[(p,frames[p['file']]) for p in poses if p['file'] in frames and 'gps' in frames[p['file']]]
x=np.array([p['translation'] for p,f in selected]);gps=np.array([f['gps'] for p,f in selected]);ref=gps.mean(0);y=np.column_stack(((gps[:,1]-ref[1])*111320*np.cos(np.deg2rad(ref[0])),gps[:,2]-ref[2],-(gps[:,0]-ref[0])*111132))
s,R,t=similarity(x,y);res=np.linalg.norm(s*x@R.T+t-y,axis=1);loo=[]
for i in range(len(x)):
 mask=np.arange(len(x))!=i;ss,rr,tt=similarity(x[mask],y[mask]);loo.append(float(np.linalg.norm(ss*rr@x[i]+tt-y[i])))
report={'registered_images':len(poses),'gps_images':len(x),'meters_per_model_unit':float(s),'rotation':R.tolist(),'translation':t.tolist(),'reference_lat_lon_alt':ref.tolist(),'rms_gps_residual_m':float(np.sqrt(np.mean(res**2))),'median_gps_residual_m':float(np.median(res)),'max_gps_residual_m':float(res.max()),'leave_one_out_rms_m':float(np.sqrt(np.mean(np.array(loo)**2))),'points':[{'file':p['file'],'residual_m':float(e),'loo_residual_m':l} for (p,f),e,l in zip(selected,res,loo)],'caution':'Consumer drone GPS is not surveyed control. Altitude datum and systematic GNSS errors remain unverified. Fit measures consistency with GPS, not ground-truth accuracy.'}
(folder/'gps_scale.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['rotation','translation','points','reference_lat_lon_alt']},indent=2))
