// World Buildings & Interiors lane: place data + scene budget. node test/world-eden-interiors.cpu.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {INTERIOR_PLACES} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/places.ts';
import {createEdenInteriors} from '../../../mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts';
import {readFileSync} from 'node:fs';
const base=JSON.parse(readFileSync(new URL('../../../worlds/eden/places.v1.json',import.meta.url),'utf8')).places;
const inside=(p,poly)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>p[1])!==(zj>p[1])&&p[0]<(xj-xi)*(p[1]-zi)/(zj-zi)+xi)c=!c;}return c;};
const area=poly=>{let a=0;for(let i=0;i<poly.length;i++){const [x0,z0]=poly[i],[x1,z1]=poly[(i+1)%poly.length];a+=x0*z1-x1*z0;}return a/2;};
const centroid=poly=>{const A=area(poly);let cx=0,cz=0;for(let i=0;i<poly.length;i++){const [x0,z0]=poly[i],[x1,z1]=poly[(i+1)%poly.length],f=x0*z1-x1*z0;cx+=(x0+x1)*f;cz+=(z0+z1)*f;}return [cx/(6*A),cz/(6*A)];};
const byId=new Map([...base,...INTERIOR_PLACES].map(p=>[p.id,p]));
assert.equal(INTERIOR_PLACES.filter(p=>base.some(q=>q.id===p.id)).length,INTERIOR_PLACES.length,'every interior place is merged into places.v1.json');const ids=new Set();
for(const p of INTERIOR_PLACES){assert.match(p.id,/^int-[a-z0-9._-]{1,96}$/,p.id);assert.ok(!ids.has(p.id),'duplicate '+p.id);ids.add(p.id);
 // Once merged into places.v1.json (tools/world/eden-places.mjs), the merged entry must be this one (the generator may append a reachability note).
 const merged=base.find(q=>q.id===p.id);if(merged){assert.ok(merged.description.startsWith(p.description),p.id+' description');assert.deepEqual({...merged,level:merged.level??0,starting:false,description:''},{...p,level:p.level??0,starting:false,description:''},'merged '+p.id+' differs from the lane source');}
 assert.ok(p.name.length>0&&p.name.length<=100);assert.ok(p.description.length>20&&p.description.length<=4000);
 assert.ok(p.capacity===null||(Number.isInteger(p.capacity)&&p.capacity>=1),p.id+' capacity');if(p.enclosed)assert.ok(p.capacity!==null,p.id+' enclosed needs capacity');
 assert.ok(Number.isInteger(p.level??0));assert.ok(p.polygon.length>=3&&Math.abs(area(p.polygon))>1e-6,p.id+' polygon');
 const par=byId.get(p.parent);assert.ok(par,p.id+' parent '+p.parent);assert.ok(inside(centroid(p.polygon),par.polygon),p.id+' centroid outside parent');}
const lane=createEdenInteriors((x,z)=>0);assert.ok(lane);
{const sm=lane.group.userData.edenSmokeSources;assert.equal(sm.length,2,'yurt and A-frame stove pipes smoke');for(const [x,y,z] of sm)assert.ok(y>3.2&&y<4,'pipe top '+[x,y,z]);}let draws=0;const mats=new Set();
lane.group.traverse(o=>{if(!o.isMesh)return;draws++;mats.add(o.material);
 if(/furniture|glow|fabric|glass/.test(o.material.name))assert.equal(o.userData.cameraTransparent,true,o.name+' must be camera-transparent');
 if(/wall|floor|roof/.test(o.material.name)&&!/fabric/.test(o.material.name))assert.notEqual(o.userData.cameraTransparent,true,o.name+' must stay opaque');});
assert.equal(draws,lane.stats.draws);assert.ok(mats.size<=7,'shared materials');assert.ok(draws<=4*lane.stats.rooms,'≤4 draws per room');
assert.equal(createEdenInteriors(()=>null),null,'refuses off native ground');
const nativeOnly=createEdenInteriors((x,z)=>x>=30&&x<=105&&z>=-30&&z<=85?0:null);assert.ok(nativeOnly,'accepted on native east ground (only its own floors are sampled)');nativeOnly.dispose();
lane.dispose();console.log('ok',INTERIOR_PLACES.length,'places',lane.stats);
// WN6: the opened yurt (round, r 3) and A-frame (Λ roof): every part's centre lies inside the real (non-box) shell
// (the AABB placement check exempts these two hollow shells), and the doorways stay clear.
{const {interiorBoxes}=await import('../../../mars/viewer/app/engine-view/content/assets/eden-interiors/index.ts');
 const local=(cx,cz,yaw,x,z)=>{const dx=x-cx,dz=z-cz,c=Math.cos(yaw),s=Math.sin(yaw);return [c*dx-s*dz,s*dx+c*dz];};
 for(const b of interiorBoxes()){const mx=(b.min[0]+b.max[0])/2,mz=(b.min[2]+b.max[2])/2;
  if(b.room==='eden-yurt'){const [x,z]=local(67.5,-18.5,-.6,mx,mz);const r=Math.hypot(x,z);assert.ok(r<2.75,`yurt «${b.label}» r ${r.toFixed(2)}`);assert.ok(!(z>2&&Math.abs(x)<.6),`yurt doorway «${b.label}»`);}
  if(b.room==='eden-observatory'){const [x,z]=local(36.5,82,0,mx,mz);assert.ok(Math.hypot(x,z)<1.75,`observatory «${b.label}»`);assert.ok(!(z<-1.2&&Math.abs(x)<.6),`observatory doorway «${b.label}»`);}
  if(b.room==='eden-tower-house'){const [x,z]=local(69,20,Math.PI/2,mx,mz);assert.ok(Math.abs(x)<1.56&&Math.abs(z)<1.56,`tower house «${b.label}» ${x.toFixed(2)},${z.toFixed(2)}`);assert.ok(!(z>1.0&&Math.abs(x)<.6&&b.min[1]<2.2),`tower doorway «${b.label}»`);}
  if(b.room==='eden-windmill'){const [x,z]=local(88,27.75,-Math.PI/4,mx,mz);assert.ok(Math.hypot(x,z)<1.8,`windmill «${b.label}» r ${Math.hypot(x,z).toFixed(2)}`);assert.ok(!(z>1.2&&Math.abs(x)<.6),`windmill doorway «${b.label}»`);}
  if(b.room==='eden-a-frame'&&!/stovepipe/.test(b.label)){const [x,z]=local(76.5,-25.5,.4,mx,mz),half=0,allowed=2.34*(1-b.max[1]/5.04);
   assert.ok(Math.abs(x)+half<=allowed+.05,`a-frame «${b.label}» |x| ${(Math.abs(x)+half).toFixed(2)} > ${allowed.toFixed(2)} at y ${b.max[1].toFixed(2)}`);assert.ok(Math.abs(z)<2.95,`a-frame «${b.label}» z`);assert.ok(!(z>1.9&&Math.abs(x)<.6),`a-frame doorway «${b.label}»`);}}}
console.log('ok yurt/a-frame/observatory/windmill/tower-house interiors inside their shells');
