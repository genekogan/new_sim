import {inPoly,type PlaceIndex} from './places.ts';

type Point=[number,number];
const OUTDOOR = new Set(['walkable','grounds','outdoor','park','garden','plaza','lawn','field','shore','zone']);
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const between=(a:number,b:number,c:number)=>c>=Math.min(a,b)-1e-9&&c<=Math.max(a,b)+1e-9;
const on=(a:Point,b:Point,p:Point)=>Math.abs(cross(a,b,p))<=1e-9&&between(a[0],b[0],p[0])&&between(a[1],b[1],p[1]);
function overlaps(a:Point[],b:Point[]):boolean {
 const box=(p:Point[])=>[Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))];
 const A=box(a),B=box(b);if(A[2]<B[0]||B[2]<A[0]||A[3]<B[1]||B[3]<A[1])return false;
 if(a.some(p=>inPoly(p[0],p[1],b))||b.some(p=>inPoly(p[0],p[1],a)))return true;
 return a.some((p,i)=>b.some((q,j)=>{
  const r=a[(i+1)%a.length],s=b[(j+1)%b.length];
  return on(p,r,q)||on(p,r,s)||on(q,s,p)||on(q,s,r)||cross(p,r,q)*cross(p,r,s)<0&&cross(q,s,p)*cross(q,s,r)<0;
 }));
}
function corners(poly:Point[]):Point[] {
 const same=(a:Point,b:Point)=>Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;
 const points=poly.filter((p,i)=>i===0||!same(p,poly[i-1]));
 if(points.length>1&&same(points[0],points.at(-1)!))points.pop();
 return points.filter((p,i)=>!on(points[(i+points.length-1)%points.length],points[(i+1)%points.length],p));
}
const sameOutline=(A:Point[],B:Point[])=>{const a=corners(A),b=corners(B);return a.length===b.length&&b.some((_,offset)=>[1,-1].some(dir=>a.every((p,i)=>{
 const q=b[(offset+dir*i+b.length)%b.length];return Math.abs(p[0]-q[0])<1e-9&&Math.abs(p[1]-q[1])<1e-9;
})));};
/** Physical membership only: semantic districts never alter where a body must go.
 * An outdoor region excludes overlapping interiors, including buildings parented
 * under a coextensive peer region. One parent tree cannot represent that geometry.
 * This leaves broad town/district destinations and ordinary open-region no-ops alone. */
export function outdoorRegionExclusions(places:PlaceIndex,targetId:string):[number,number][][]|undefined {
 const target=places.byId.get(targetId);
 if(!target||target.enclosed||!OUTDOOR.has(target.kind))return undefined;
 const ancestors=new Set<string>();let parent=target.parent;while(parent&&!ancestors.has(parent)){ancestors.add(parent);parent=places.byId.get(parent)?.parent??null;}
 const interiors=[...places.byId.values()].filter(p=>p.id!==targetId&&!ancestors.has(p.id)&&!p.carrier&&(p.level??0)===(target.level??0)
  &&(p.enclosed||p.kind==='building'||p.kind==='room')&&overlaps(p.polygon,target.polygon)&&!sameOutline(p.polygon,target.polygon));
 // Rooms already covered by their building do not duplicate its outline.
 const ids=new Set(interiors.map(p=>p.id));
 return interiors.filter(p=>{let id=p.parent;const seen=new Set<string>();while(id&&id!==targetId&&!seen.has(id)){if(ids.has(id))return false;seen.add(id);id=places.byId.get(id)?.parent??null;}return true;}).map(p=>p.polygon.map(([x,z])=>[x,z]));
}
