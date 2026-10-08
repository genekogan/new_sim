// NEW owned water topology, shared Float32 boundary vertices, no datum/normal displacement.
import * as THREE from 'three';
const key=p=>p[0]+','+p[1];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
function inside(p,poly){let result=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
export function triangulateWetUnion(input){
 const polys=input.map(poly=>poly.map(p=>p.map(Math.fround))),edges=[];
 polys.forEach((poly,k)=>poly.forEach((a,i)=>edges.push({a,b:poly[(i+1)%poly.length],poly:k,cuts:[{t:0,p:a},{t:1,p:poly[(i+1)%poly.length]}]})));
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j];if(a.poly===b.poly)continue;const r=[a.b[0]-a.a[0],a.b[1]-a.a[1]],s=[b.b[0]-b.a[0],b.b[1]-b.a[1]],q=[b.a[0]-a.a[0],b.a[1]-a.a[1]],den=cross(r,s);if(Math.abs(den)<1e-12)continue;const t=cross(q,s)/den,u=cross(q,r)/den;if(t<-1e-9||t>1+1e-9||u<-1e-9||u>1+1e-9)continue;const p=[Math.fround(a.a[0]+t*r[0]),Math.fround(a.a[1]+t*r[1])];a.cuts.push({t,p});b.cuts.push({t:u,p});}
 const boundary=[];
 for(const e of edges){e.cuts.sort((a,b)=>a.t-b.t);for(let i=1;i<e.cuts.length;i++){const a=e.cuts[i-1].p,b=e.cuts[i].p;if(key(a)===key(b))continue;const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(polys.some((p,k)=>k!==e.poly&&inside(mid,p)))continue;boundary.push([a,b]);}}
 const loops=[],unused=new Set(boundary.map((_,i)=>i));
 while(unused.size){const first=unused.values().next().value,start=boundary[first][0],loop=[start];let current=first,closed=false;for(let n=0;n<=boundary.length;n++){unused.delete(current);const end=boundary[current][1];if(key(end)===key(start)){closed=true;break;}loop.push(end);const next=[...unused].find(i=>key(boundary[i][0])===key(end));if(next===undefined)throw Error('New water union boundary not closed');current=next;}if(!closed)throw Error('New water union boundary chain exhausted before closure');loops.push(loop);}
 if(loops.length!==1)throw Error('New water union supports exactly one connected hole-free boundary loop');
 const positions=[],indices=[];for(const loop of loops){const offset=positions.length/3;for(const p of loop)positions.push(p[0],-2,p[1]);for(const face of THREE.ShapeUtils.triangulateShape(loop.map(p=>new THREE.Vector2(...p)),[])){const a=loop[face[0]],b=loop[face[1]],c=loop[face[2]];if(cross([b[0]-a[0],b[1]-a[1]],[c[0]-a[0],c[1]-a[1]])>0)[face[1],face[2]]=[face[2],face[1]];indices.push(...face.map(i=>i+offset));}}
 return{positions,indices,boundaryLoops:loops};
}
