// World Regions place data + Explore views: node test/world-eden-regions-places.cpu.mjs
import assert from 'node:assert/strict';
import {REGION_PLACES} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/places.ts';
const inside=(p,poly)=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>p[1])!==(zj>p[1])&&p[0]<(xj-xi)*(p[1]-zi)/(zj-zi)+xi)c=!c;}return c;};
const area=poly=>{let a=0;for(let i=0;i<poly.length;i++){const [x0,z0]=poly[i],[x1,z1]=poly[(i+1)%poly.length];a+=x0*z1-x1*z0;}return a/2;};
const centroid=poly=>{const A=area(poly);let cx=0,cz=0;for(let i=0;i<poly.length;i++){const [x0,z0]=poly[i],[x1,z1]=poly[(i+1)%poly.length],f=x0*z1-x1*z0;cx+=(x0+x1)*f;cz+=(z0+z1)*f;}return [cx/(6*A),cz/(6*A)];};
const ids=new Set(),byId=new Map(REGION_PLACES.map(p=>[p.id,p]));
for(const p of REGION_PLACES){assert.match(p.id,/^[a-z0-9][a-z0-9._-]{0,99}$/,p.id);assert.ok(p.id.startsWith('region-'),p.id);assert.ok(!ids.has(p.id),'duplicate '+p.id);ids.add(p.id);
 assert.ok(p.name.length>0&&p.name.length<=100);assert.ok(p.description.length>0&&p.description.length<=4000);assert.ok(p.capacity===null||(Number.isInteger(p.capacity)&&p.capacity>=1),p.id+' capacity');
 assert.ok(p.polygon.length>=3&&p.polygon.every(v=>v.length===2&&v.every(Number.isFinite)),p.id+' polygon');assert.ok(Math.abs(area(p.polygon))>1e-6,p.id+' degenerate');
 if(p.enclosed)assert.ok(p.capacity!==null,p.id+' enclosed needs capacity');
 if(p.parent==='eden'){const c=centroid(p.polygon);assert.ok(!(c[0]>-100&&c[0]<105&&c[1]>-65&&c[1]<85),p.id+' centroid inside existing Eden');}
 else{const par=byId.get(p.parent);assert.ok(par,p.id+' parent '+p.parent);assert.ok(inside(centroid(p.polygon),par.polygon),p.id+' centroid outside parent');}}
assert.ok(REGION_PLACES.filter(p=>p.starting).length>=2&&REGION_PLACES.filter(p=>p.starting).length<=4,'2-4 starting');
// Named enclosed buildings never overlap each other.
const bb=p=>{const xs=p.polygon.map(v=>v[0]),zs=p.polygon.map(v=>v[1]);return [Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];};
const built=REGION_PLACES.filter(p=>p.enclosed);for(let i=0;i<built.length;i++)for(let j=i+1;j<built.length;j++){const a=bb(built[i]),b=bb(built[j]);assert.ok(!(a[0]<b[2]-.01&&b[0]<a[2]-.01&&a[1]<b[3]-.01&&b[1]<a[3]-.01),'overlap '+built[i].id+' / '+built[j].id);}
const {REGION_EXPLORE}=await import('../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts');
const ex=new Set();for(const v of REGION_EXPLORE){assert.ok(!ex.has(v.id));ex.add(v.id);assert.ok(v.label&&v.camera.length===3&&v.target.length===3&&[...v.camera,...v.target].every(Number.isFinite));}
console.log('world-eden-regions places PASS',{places:REGION_PLACES.length,starting:REGION_PLACES.filter(p=>p.starting).map(p=>p.id),explore:REGION_EXPLORE.length});
