#!/usr/bin/env python3
# Op-level diff of two genesis templates (lane E1). Usage: run in a dir holding tpl-af01d75c.json (old) and tpl-HEAD.json (new); writes opdiff.json.
# Keys: place -> parent-name path / name (tmp parents resolved within a batch); define -> def name; set -> id.
import json,collections,sys
a=json.load(open('tpl-af01d75c.json'));b=json.load(open('tpl-HEAD.json'))
def ops(t):
  out={}
  for x in t['batches']:
    tmp={}
    for o in x['ops']:
      if o['op']=='place':
        par=(o.get('in') or {}).get('parent','world')
        par=tmp.get(par,par)
        path=par+'/'+o['name']
        if 'tmp' in o: tmp[o['tmp']]=path
        k=('place',path)
      elif o['op']=='define': k=('define',o['def']['name'])
      elif o['op']=='set': k=('set',o['id'])
      else: k=(o['op'],)
      assert k not in out,k
      out[k]=(x['note'],{kk:vv for kk,vv in o.items() if kk!='tmp'})
  return out
A=ops(a);B=ops(b)
J=lambda o: json.dumps(o,sort_keys=True)
added=[k for k in B if k not in A]; removed=[k for k in A if k not in B]
changed=[k for k in B if k in A and J(A[k][1])!=J(B[k][1])]
print('ops old',len(A),'new',len(B),'added',len(added),'removed',len(removed),'changed',len(changed))
def grp(n): 
  import re; return re.sub(r' \d+$','',n)
print('ADDED by batch', collections.Counter(grp(B[k][0]) for k in added))
print('REMOVED', [(k,A[k][0],A[k][1]['def']) for k in removed])
fc=collections.Counter(); ex={}
for k in changed:
  o1=A[k][1];o2=B[k][1]
  d=tuple(sorted(f for f in set(o1)|set(o2) if J(o1.get(f))!=J(o2.get(f))))
  g=(grp(A[k][0]),d); fc[g]+=1; ex.setdefault(g,[]).append(k)
for g,n in fc.most_common(): print('CHANGED',n,g, ex[g][:3])
json.dump({'added':[list(k) for k in added],'removed':[list(k) for k in removed],'changed':[list(k) for k in changed]},open('opdiff.json','w'),indent=0)
