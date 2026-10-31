import os,sys;sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)));from _paths import mars_root  # noqa: E402
"""Read original SketchUp geometry locally; originals remain untouched. Requires Python 3.11."""
import sys,json,pathlib,math
BASE=mars_root()
sys.path.insert(0,str(BASE/'code/campus-2026-reconstruction/vendor/sketchup/sketchup_importer'))
import sketchup
OUT=BASE/'docs/media/reconstruction/campus-history/cad'
I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]
def mul(a,b):return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def point(m,v):return [sum(m[i][j]*v[j] for j in range(3))+m[i][3] for i in range(3)]
for filename in sys.argv[1:]:
 model=sketchup.Model.from_file(str(BASE/'code/sketchup'/filename));parts=[]
 def visit(e,m=I,name='root',color=(185,179,157,255),depth=0):
  verts=[];tris=[];colors=[]
  for f in e.faces:
   vs,ts,uv=f.tessfaces;n=len(verts);verts.extend([point(m,v) for v in vs]);tris.extend([[j+n for j in t] for t in ts]);colors.extend([f.material.color if f.material else color]*len(ts))
  if tris:parts.append({'name':name,'vertices':verts,'triangles':tris,'colors':colors})
  for index,g in enumerate(e.groups):
   if not g.hidden:visit(g.entities,mul(m,g.transform),name+'/'+(g.name or f'group-{index}'),g.material.color if g.material else color,depth+1)
  for index,c in enumerate(e.instances):
   if not c.hidden and c.definition.name not in ['Ty','Sang','Susan','Bryce','Chris','Heather','Stacy']:visit(c.definition.entities,mul(m,c.transform),name+'/'+(c.name or c.definition.name)+f'#{index}',c.material.color if c.material else color,depth+1)
 visit(model.entities)
 out=OUT/(pathlib.Path(filename).stem+'.geometry.json');out.write_text(json.dumps(parts,separators=(',',':')))
 bounds=[]
 for p in parts:
  v=p['vertices'];lo=[min(x[i] for x in v) for i in range(3)];hi=[max(x[i] for x in v) for i in range(3)];bounds.append({'name':p['name'],'bounds':[lo,hi],'dimensions':[round(hi[i]-lo[i],3) for i in range(3)]})
 (OUT/(pathlib.Path(filename).stem+'.bounds.json')).write_text(json.dumps(bounds,indent=2));print(filename,len(parts),sum(len(p['triangles']) for p in parts),'triangles',flush=True)
 model.close()
