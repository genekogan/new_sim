import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import media  # noqa: E402
import pathlib,json,numpy as np
b=media('reconstruction/2026-campus');out={}
for kind in ['orbit','campus']:
 p=b/f'validation/holdout-{kind}/results.json'
 if not p.exists():continue
 rows=json.load(open(p));ok=[r for r in rows if r['success']];err=np.concatenate([np.load(p.parent/(r['file']+'.npz'))['residuals_px'] for r in ok]);out[kind]={'checks':len(rows),'localized':len(ok),'landmark_observations':len(err),'median_px':float(np.median(err)),'p95_px':float(np.percentile(err,95)),'median_per_view_range':[min(r['median_px'] for r in ok),max(r['median_px'] for r in ok)]}
(b/'validation/metrics.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
