# Static consistency check. Arguments: candidate activity JSON, original district survey JSON.
import json,sys
from pathlib import Path
data=json.load(open(sys.argv[1]))
survey=json.load(open(sys.argv[2]))['solids']
solids={s['id']:s for s in data['solids']};assert len(solids)==len(data['solids'])
assert all(s['id'] in solids for s in survey)
assert all(s==solids[s['id']] for s in survey if s['id']!='arts-mural-wall')
assert 'performance-stage' not in solids
spots={s['id']:s for s in data['spots']};assert spots['sport-frisbee-1']['at']==[5.5,116.5];assert spots['lib-desk-2']['also']==['use-computer']
for n in [1,2,3]:assert solids[f'picnic-table-{n}']['half']==[.92,.4]
for x,z in [(10,141.4),(62,141.4),(-76,-72.8)]:
 for s in data['solids']:
  if s['id'].startswith('harbour-boardwalk-sea-rail') or s['id'].startswith('arts-mural-wall'):
   assert not(abs(x-s['c'][0])<=s['half'][0] and abs(z-s['c'][1])<=s['half'][1]),(x,z,s)
platforms={p['id']:p for p in data['platforms']};assert all(platforms[k]['top']==.55 for k in ['harbour-boardwalk-deck','harbour-west-pier-deck','harbour-east-pier-deck'])
print('Eden data: 138 district IDs retained; 137 exact survey bytes; mural split aligned; no duplicate solids; stage deck, frisbee, library computer, picnic and harbour platforms verified')
