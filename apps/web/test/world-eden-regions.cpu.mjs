// World Regions CPU check: node test/world-eden-regions.cpu.mjs (Node with TS type stripping).
import assert from 'node:assert/strict';import*as THREE from 'three';
import {createEdenRegions,REGION_DISTRICTS,FOOTPRINTS} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/index.ts';
import {expansionHeight} from '../../../mars/viewer/app/engine-view/content/environment/eden-expansion-landscape/layout.mjs';
assert.equal(createEdenRegions(null),null,'refuses without ground');
const ground=(x,z)=>x>=-30&&x<=30&&z>=-30&&z<=30?0:expansionHeight(x,z);
const r=createEdenRegions(ground);assert.ok(r&&r.group,'regions built');
{const sm=r.group.userData.edenSmokeSources;assert.ok(Array.isArray(sm)&&sm.length===16,'16 chimney smoke sources');for(const [x,y,z,k] of sm)assert.ok([x,y,z,k].every(Number.isFinite)&&y>3&&y<25,'chimney top '+[x,y,z]);}
{const ls=r.group.userData.edenLightSources,kinds={};assert.ok(Array.isArray(ls),'night light anchors');for(const [x,y,z,k,s] of ls){assert.ok([x,y,z,s].every(Number.isFinite)&&['lamp','park-lamp','lantern','window','fire'].includes(k),'light '+[x,y,z,k,s]);kinds[k]=(kinds[k]??0)+1;}
 assert.ok(kinds.lamp>=130&&kinds['park-lamp']>=4&&kinds.window>100&&kinds.fire>=1&&kinds.lantern>=1,'light kinds '+JSON.stringify(kinds));}
let draws=0,tris=0;r.group.traverse(o=>{if(!o.isMesh)return;draws++;const n=(o.geometry.index?o.geometry.index.count:o.geometry.attributes.position.count)/3;tris+=o.isInstancedMesh?n*o.count:n;
 assert.ok(!o.castShadow,'no shadow casters: '+o.name);for(const m of [].concat(o.material))assert.ok(m instanceof THREE.MeshStandardMaterial,'standard material');});
assert.ok(draws<=40*REGION_DISTRICTS.length,'draw budget '+draws);
// Seam: terrain vertices on the expansion rectangle equal the supplied ground.
const terrain=r.group.getObjectByName('Regions cosmetic ground terrain (scenery only; no native support)');assert.ok(terrain);const anchor=r.group.getObjectByName('Regions cosmetic ground terrain realism anchor (hidden below ground)');
const p=terrain.geometry.attributes.position;let seam=0;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);const onX=(Math.abs(x+100)<1e-3||Math.abs(x-105)<1e-3)&&z>=-65&&z<=85,onZ=(Math.abs(z+65)<1e-3||Math.abs(z-85)<1e-3)&&x>=-100&&x<=105;
 if(onX||onZ){seam++;const g=ground(Math.min(Math.max(x,-99.99),104.99),Math.min(Math.max(z,-64.99),84.99));assert.ok(Math.abs(p.getY(i)-g)<1e-3,'seam at '+x+','+z+' '+p.getY(i)+' vs '+g);}}
assert.ok(seam>100,'seam vertices '+seam);
// Nothing but path stubs inside the current expansion rectangle.
const box=new THREE.Box3();r.group.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o===terrain||o===anchor||/open water/.test(o.name))return;const q=o.geometry.attributes.position;for(let i=0;i<q.count;i++){const x=q.getX(i),z=q.getZ(i);if(x>-99.9&&x<104.9&&z>-64.9&&z<84.9){assert.ok(/dressing/.test(o.name)&&q.getY(i)<.2,'only flat path stubs inside: '+o.name+' '+x+','+z);}}});
// No two building bodies overlap (oriented footprints, separating-axis test, 15 cm tolerance).
const sat=(A,B)=>{for(const P of [A,B])for(let i=0;i<4;i++){const [ax,az]=P[i],[bx,bz]=P[(i+1)%4],nx=bz-az,nz=ax-bx,L=Math.hypot(nx,nz);const pr=Q=>Q.map(([x,z])=>(x*nx+z*nz)/L);const a=pr(A),b=pr(B);if(Math.max(...a)<Math.min(...b)+.15||Math.max(...b)<Math.min(...a)+.15)return false;}return true;};
assert.ok(FOOTPRINTS.length>100,'footprints '+FOOTPRINTS.length);for(let i=0;i<FOOTPRINTS.length;i++)for(let j=i+1;j<FOOTPRINTS.length;j++)assert.ok(!sat(FOOTPRINTS[i].corners,FOOTPRINTS[j].corners),'buildings overlap: '+JSON.stringify(FOOTPRINTS[i].corners)+' / '+JSON.stringify(FOOTPRINTS[j].corners));
r.dispose();assert.equal(r.group.children.length,0);
console.log('world-eden-regions cpu PASS',{draws,triangles:Math.round(tris),seam});
