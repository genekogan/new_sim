import assert from 'node:assert/strict';
import {createEdenExpansionLandscape} from './landscape.mjs';
import {inNative} from './layout.mjs';
// sampleVisibleBank looks bed triangles up by cell; it must equal the full scan over every bed triangle.
const owner=createEdenExpansionLandscape(true),beds=owner.group.children.filter(m=>m.name?.endsWith(' bed'));assert.ok(beds.length>0);
const scan=(x,z)=>{if(inNative(x,z)||!Number.isFinite(x)||!Number.isFinite(z))return null;let y=owner.sampleVisualGround(x,z);
 for(const bed of beds){const p=bed.geometry.attributes.position.array;for(let i=0;i<p.length;i+=9){const dx=p[i+3]-p[i],dz=p[i+5]-p[i+2],ex=p[i+6]-p[i],ez=p[i+8]-p[i+2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-12)continue;
  const u=((x-p[i])*ez-(z-p[i+2])*ex)/det,v=(dx*(z-p[i+2])-dz*(x-p[i]))/det;if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7){const top=p[i+1]+u*(p[i+4]-p[i+1])+v*(p[i+7]-p[i+1]);y=y===null?top:Math.max(y,top);}}}return y;};
let n=0,bank=0,seed=11;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const check=(x,z)=>{const want=scan(x,z),got=owner.sampleVisibleBank(x,z);assert.ok(Object.is(got,want),`sampleVisibleBank(${x},${z}) ${got} != ${want}`);n++;if(want!==null&&want!==owner.sampleVisualGround(x,z))bank++;};
for(let x=-104;x<=108;x+=.53)for(let z=-68;z<=88;z+=.53)check(x,z);
for(const bed of beds){const p=bed.geometry.attributes.position.array;for(let i=0;i<p.length;i+=9){for(let k=0;k<3;k++){const vx=p[i+3*k],vz=p[i+3*k+2];check(vx,vz);check(vx+1e-6,vz-1e-6);check(Math.fround(vx+1e-3),vz);}
 const u=rnd(),w=rnd()*(1-u);check(p[i]+u*(p[i+3]-p[i])+w*(p[i+6]-p[i]),p[i+2]+u*(p[i+5]-p[i+2])+w*(p[i+8]-p[i+2]));check((p[i]+p[i+3])/2,(p[i+2]+p[i+5])/2);}}
assert.ok(n>100000&&bank>500,`coverage ${bank}/${n}`);owner.dispose?.();
console.log('visible bank index exact',bank,'/',n);
