#!/usr/bin/env python3
"""Frame differences on fixed, declared image regions; no learned verdict."""
import sys,json,subprocess,pathlib
import numpy as np
from PIL import Image
root=pathlib.Path(sys.argv[1]);results={}
regions={'roof':(530,250,270,100),'panels':(520,470,240,110),'ground':(50,300,180,180)}
for mode in ['moving','frozen','no-shadows']:
    proc=subprocess.Popen(['ffmpeg','-v','error','-ss','5','-i',str(root/(mode+'.webm')),'-vf','fps=30,format=gray','-f','rawvideo','-'],stdout=subprocess.PIPE)
    prior=None;total=np.zeros((800,1280));squares=total.copy();diffs={k:[] for k in regions};n=0
    while True:
        raw=proc.stdout.read(800*1280)
        if len(raw)!=800*1280:break
        a=np.frombuffer(raw,dtype=np.uint8).reshape(800,1280).astype(float);total+=a;squares+=a*a;n+=1
        if prior is not None:
            for k,(x,y,w,h) in regions.items():
                d=np.abs(a[y:y+h,x:x+w]-prior[y:y+h,x:x+w]);diffs[k].append([float(d.mean()),float((d>8).mean())])
        prior=a
    proc.wait();std=np.sqrt(np.maximum(0,squares/n-(total/n)**2));Image.fromarray(np.uint8(np.minimum(255,std*15))).save(root/(mode+'-variation.png'))
    results[mode]={'frames':n,'regions':{k:{'meanAdjacentLumaDelta':float(np.mean(v,axis=0)[0]),'fractionPixelsDeltaOver8':float(np.mean(v,axis=0)[1]),'meanTemporalStd':float(std[y:y+h,x:x+w].mean())}for k,(x,y,w,h) in regions.items()for v in [diffs[k]]}}
(root/'metrics.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
