# Deterministic navigation assembly from the two procedural building footprints.
import json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]; scene={'bounds':[-40,-32,40,32],'levels':[{'id':0,'y':0,'label':'open garden'}],'surfaces':[{'id':'garden-ground','level':0,'y':0,'obb':{'c':[0,0],'half':[40,32],'yaw':0},'label':'garden'}],'obstacles':[],'links':[]};regions=[];placements=[]
for name,dx,lbase in [('ceramic-tower',-17,10),('minaret-temple',17,15)]:
 f=json.loads((root/f'worlds/littlemartians/buildings/{name}.footprint.json').read_text()); placements.append({'file':name,'p':[dx,0,0],'yaw':0})
 for lv in f['levels']: scene['levels'].append({**lv,'id':lbase+lv['id'],'label':f['name']+' '+lv['label']})
 for r in f['rooms']:
  poly=[[p[0]+dx,p[1]] for p in r['polygon']]; xs=[p[0] for p in poly];zs=[p[1] for p in poly];half=[(max(xs)-min(xs))/2-.15,(max(zs)-min(zs))/2-.15]
  scene['surfaces'].append({'id':r['id']+'-floor','level':lbase+r['level'],'y':r['y0'],'obb':{'c':[(max(xs)+min(xs))/2,(max(zs)+min(zs))/2],'half':half,'yaw':0},'label':r['label']})
  regions.append({'id':r['id'],'label':f['name']+' '+r['label'],'kind':'place','level':lbase+r['level'],'polygon':poly,'provenance':{'origin':'design-edit','confidence':'hypothetical'}})
 for o in f['obstacles']: scene['obstacles'].append({k:v for k,v in {**o,'obb':{**o['obb'],'c':[o['obb']['c'][0]+dx,o['obb']['c'][1]]}}.items() if k not in ['room','level']})
 def link(id,frm,to,width):
  return {'id':id,'kind':'ramp','width':width,'heading':0,'from':frm,'to':to,'path':[[frm['p'][0],frm['y'],frm['p'][1]],[to['p'][0],to['y'],to['p'][1]]],'usable':False,'reason':'floater-only-opening'}
 for l in f['links']:
  def end(e): return {**e,'level':lbase+e['level'],'p':[e['p'][0]+dx,e['p'][1]]}
  frm=end(l['from']);to=end(l['to']);frm['p'][0]-=.8;to['p'][0]+=.8
  scene['links'].append(link(l['id'],frm,to,l['width']))
 # A wide ground arch opens onto the raised ground floor; this declared short ramp is also humanoid-passable.
 y=f['levels'][0]['y']; z=max(p[1] for p in f['rooms'][0]['polygon']);
 entry=link(name+'-entry',{'level':0,'p':[dx,z+1.4],'y':0},{'level':lbase,'p':[dx,z-1.4],'y':y},2.0);entry['usable']=True;entry.pop('reason');scene['links'].append(entry)
regions.append({'id':'garden','label':'Open garden','kind':'walkable','level':0,'polygon':[[-40,12],[40,12],[40,32],[-40,32]],'provenance':{'origin':'design-edit','confidence':'hypothetical'}})
models=json.loads((root/'worlds/littlemartians/characters/manifest.json').read_text())['models']; kin=[{'model':m['id'],'p':[-12+i*5,0,24],'radius':.5,'hover':1.1} for i,m in enumerate(m for m in models if m['group']=='kin')]
(root/'worlds/littlemartians/scene.json').write_text(json.dumps({'scene':scene,'regions':regions,'buildings':placements,'kin':kin},indent=2)+'\n')
