import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = p => JSON.parse(readFileSync(p,'utf8'));
const pose = (name, at, d=22, kind='landmark') => ({name,kind,at,eye:[at[0]+d*.65,at[1]+d*.7,at[2]+d],hour:14});
export function namedPoses(root, world, template, oldPlaces=[]) {
  const views = world === 'mars' ? [{name:'overview',kind:'overview',eye:[65,90,100],at:[0,0,-30],hour:14}] :
    [{name:'overview',kind:'overview',eye:[0,100,150],at:[0,5,0],hour:14}];
  if (world === 'mars') {
    const old=read(resolve(root,'worlds/mars/camp/manifest.json'));
    for (const b of old.buildings) views.push(pose(`old-${b.id}`,[(b.rect[0]+b.rect[2])/2,1,(b.rect[1]+b.rect[3])/2],18));
    for(const p of oldPlaces.filter(p=>['chiba','north-rack-building','north-workshops','northeast-compound','west-rack-building','build-site','fire-circle','garden'].includes(p.id)&&Array.isArray(p.polygon))){
      const at=[p.polygon.reduce((s,v)=>s+v[0],0)/p.polygon.length,1,p.polygon.reduce((s,v)=>s+v[1],0)/p.polygon.length];
      views.push(pose(`old-${p.id}`,at,25));
    }
    // Campus root buildings, not every chair, van or decorative exhibit.
    for(const op of template.batches[0].ops.filter(o=>o.op==='place'&&o.p)) {
      const p=op.p.length===2?[op.p[0],0,op.p[1]]:op.p;
      views.push(pose(`candidate-${op.name}`,p,30));
    }
    views.push({name:'interior-kitchen',kind:'interior',eye:[-14,1.65,-10],at:[-14,1.2,-17],hour:14},
      {name:'interior-living-room',kind:'interior',eye:[1,1.65,-10],at:[2,1.2,-17],hour:14});
  } else {
    for(const b of read(resolve(root,'worlds/littlemartians/scene.json')).buildings) views.push(pose(`old-${b.file}`,b.p,30));
    const names=['madmaraca','minarete','celadon-beacon','painted-grotto','overlook-summit'];
    for(const o of template.batches.flatMap(b=>b.ops).filter(o=>names.includes(o.name))) {
      const p=o.p.length===2?[o.p[0],0,o.p[1]]:o.p; views.push(pose(`candidate-${o.name}`,p,35));
    }
    views.push({name:'interior-tower-ground',kind:'interior',eye:[-17,2,6],at:[-17,2,0],hour:14},
      {name:'interior-temple-pavilion',kind:'interior',eye:[17,2.25,5],at:[17,1.8,0],hour:14});
  }
  for(const [name,hour] of [['dusk',18],['night',23]])views.push({...views[0],name,kind:'time',hour});
  return views;
}
