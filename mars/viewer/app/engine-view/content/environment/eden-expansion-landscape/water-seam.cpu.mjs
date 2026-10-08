import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createEdenExpansionLandscape} from './landscape.mjs';
import {extractEdenExpansionWaterSupport} from '../eden-expansion-water-support/extract.mjs';
import {subtractWetPolygon} from './water-join.mjs';
const old=JSON.parse(readFileSync(new URL('../eden-expansion-water-support/request.v1.json',import.meta.url),'utf8')),owner=createEdenExpansionLandscape(true);
try{
 const now=extractEdenExpansionWaterSupport(owner),area=p=>Math.abs(p.reduce((n,v,i)=>n+v[0]*p[(i+1)%p.length][2]-p[(i+1)%p.length][0]*v[2],0))/2;
 const tris=g=>Array.from({length:g.indices.length/3},(_,i)=>g.indices.slice(i*3,i*3+3).map(j=>g.positions.slice(j*3,j*3+3)));
 function overlapCount(rows){let count=0,sum=0;for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=area(rows[i]);if(a<1e-9||area(rows[j])<1e-9)continue;const rem=subtractWetPolygon(rows[i],rows[j].map(v=>[v[0],v[2]])).reduce((n,p)=>n+area(p),0),d=a-rem;if(d>1e-8){count++;sum+=d;}}return{count,sum};}
 const before=overlapCount(tris(old.wetDomain.surface)),after=overlapCount(tris(now.wetDomain.surface));assert.ok(before.count>0);assert.equal(after.count,0);
 const beforeArea=tris(old.wetDomain.surface).reduce((n,p)=>n+area(p),0),afterArea=tris(now.wetDomain.surface).reduce((n,p)=>n+area(p),0);assert.ok(Math.abs(beforeArea-afterArea)<.00003);
 for(let i=1;i<now.wetDomain.surface.positions.length;i+=3)assert.equal(now.wetDomain.surface.positions[i],-2);
 // Actual internal river rectangle water-level edges caused the supplied dotted box.
 const isInner=p=>{for(const tri of tris(now.wetDomain.surface)){const ax=tri[1][0]-tri[0][0],az=tri[1][2]-tri[0][2],bx=tri[2][0]-tri[0][0],bz=tri[2][2]-tri[0][2],den=ax*bz-az*bx;if(Math.abs(den)<1e-12)continue;const u=((p[0]-tri[0][0])*bz-(p[2]-tri[0][2])*bx)/den,v=(ax*(p[2]-tri[0][2])-az*(p[0]-tri[0][0]))/den;if(u>1e-5&&v>1e-5&&u+v<1-1e-5)return true;}return false;};
 function internalBedEdges(r){let n=0;for(const g of r.bankAndBedSurfaces)for(const t of tris(g))for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3];if(a[1]===-2&&b[1]===-2&&Math.hypot(a[0]-b[0],a[2]-b[2])>.01&&isInner([(a[0]+b[0])/2,-2,(a[2]+b[2])/2]))n++;}return n;}
 const beforeEdges=internalBedEdges(old),afterEdges=internalBedEdges(now);assert.ok(beforeEdges>0);assert.equal(afterEdges,0);
 const receipt={groups:3,oldWaterTriangles:177,newWaterTriangles:now.wetDomain.triangleCount,beforeWaterOverlap:before,afterWaterOverlap:after,beforeArea,afterArea,unionAreaDelta:afterArea-beforeArea,beforeInternalBedWaterLevelEdges:beforeEdges,afterInternalBedWaterLevelEdges:afterEdges,waterDatumDisplacements:0,originalCanonicalPhysicsChanges:0,scope:'NEWowned union conforming topology and internal bed-edge removal; suppliedimage sourcecorrespondence, not newpixels'};
 writeFileSync(new URL('./water-seam-receipt.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{owner.dispose();}
