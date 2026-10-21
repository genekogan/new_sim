import assert from 'node:assert/strict';
import {edenExpansionLayout,inside,inNative,pathDistance,reserved} from './layout.mjs';
// reserved() skips paths whose box is out of reach; it must answer exactly as the unfiltered predicate over the real Eden data.
const data=edenExpansionLayout();
const reference=(x,z,r=0)=>inNative(x,z,r)||data.regions.some(p=>['volcanic-periphery','outlook-grove-accent'].includes(p.id)&&inside(x,z,p.bounds,r))||data.places.some(p=>inside(x,z,p.bounds,r+.6))||data.paths.some(p=>pathDistance(x,z,p.points)<=p.width/2+r+.35)||data.stops.some(p=>Math.hypot(x-p.p[0],z-p.p[1])<=p.radius+r);
const [x0,z0,x1,z1]=data.bounds;let n=0,hits=0,seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
const check=(x,z,r)=>{const want=reference(x,z,r);assert.equal(reserved(x,z,r),want,`reserved(${x},${z},${r})`);n++;if(want)hits++;};
for(const r of [0,.3,1.2])for(let x=x0-4;x<=x1+4;x+=.37)for(let z=z0-4;z<=z1+4;z+=.37)check(x,z,r);
// Points exactly on, just inside and just outside each path's reach (where a box test could go wrong).
for(const p of data.paths)for(let i=1;i<p.points.length;i++){const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
  for(let k=0;k<12;k++){const u=rnd(),t=p.width/2+.35,s=[t,t-1e-9,t+1e-9,t*rnd()*2][k%4]*(k<6?1:-1);check(a[0]+u*dx-dz/len*s,a[1]+u*dz+dx/len*s,0);}
  for(const q of [a,b])for(let k=0;k<8;k++){const ang=rnd()*Math.PI*2,s=(p.width/2+.35)*(1+(rnd()-.5)*1e-8);check(q[0]+Math.cos(ang)*s,q[1]+Math.sin(ang)*s,0);}}
for(let k=0;k<20000;k++)check(x0+(x1-x0)*rnd(),z0+(z1-z0)*rnd(),rnd()*1.5-.2);
assert.ok(n>50000&&hits>1000&&hits<n,`coverage ${hits}/${n}`);
console.log('reserved prefilter exact',hits,'/',n);
