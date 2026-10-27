// Conservative stair access from extracted mesh support. A flight needs at least
// three consecutive, similarly directed rises; an isolated table is not a stair.
const r=v=>Math.round(v*1000)/1000;
const bounds=p=>{const v=p.polygons.flat();return [Math.min(...v.map(q=>q[0])),Math.min(...v.map(q=>q[1])),Math.max(...v.map(q=>q[0])),Math.max(...v.map(q=>q[1]))];};
const on=(p,q)=>p.polygons.some(v=>q[0]>=v[0][0]-1e-6&&q[0]<=v[2][0]+1e-6&&q[1]>=v[0][1]-1e-6&&q[1]<=v[2][1]+1e-6);
const fits=(p,q)=>[[0,0],[.34,0],[-.34,0],[0,.34],[0,-.34]].every(([x,z])=>on(p,[q[0]+x,q[1]+z]));
function inside(p,t){const cross=(a,b)=>(b[0]-a[0])*(p[1]-a[2])-(b[2]-a[2])*(p[0]-a[0]);const a=cross(t[0],t[1]),b=cross(t[1],t[2]),c=cross(t[2],t[0]);return a>=-1e-7&&b>=-1e-7&&c>=-1e-7||a<=1e-7&&b<=1e-7&&c<=1e-7;}
export function stairAccess(patches,triangles){
 const boxes=patches.map(bounds),horizontal=triangles.filter(({points:t})=>Math.max(...t.map(p=>p[1]))-Math.min(...t.map(p=>p[1]))<.01 && (t[1][2]-t[0][2])*(t[2][0]-t[0][0])-(t[1][0]-t[0][0])*(t[2][2]-t[0][2])>1e-8);
 const pair=(i,j,offsets=[0,.3,-.3,.6,-.6])=>{
  const a=patches[i],b=patches[j],A=boxes[i],B=boxes[j];
  for(const axis of [0,1])for(const dir of [-1,1]){
   const cross=1-axis,edgeA=A[axis+(dir>0?2:0)],edgeB=B[axis+(dir>0?0:2)],gap=(edgeB-edgeA)*dir;
   const lo=Math.max(A[cross],B[cross]),hi=Math.min(A[cross+2],B[cross+2]);
   if(gap<-.01||gap>.31||hi-lo<.899)continue;
   const faces=horizontal.filter(({points:t})=>[a.y,b.y].some(y=>Math.abs(t[0][1]-y)<.02));
   for(const offset of offsets){
    const centre=(lo+hi)/2+offset;if(centre<lo+.4||centre>hi-.4)continue;
    const from=[],to=[];from[axis]=edgeA-dir*(a.y<=.45?.8:.52);to[axis]=edgeB+dir*.52;from[cross]=to[cross]=centre;
    if(!fits(a,from)||!fits(b,to))continue;
    // Raster erosion may leave a 30 cm gap between two pieces of the SAME
    // rendered sheet. Prove the intervening mesh actually supports the crossing;
    // at most a 12 cm physical seam is allowed, never a courtyard or missing slab.
    const distance=Math.hypot(to[0]-from[0],to[1]-from[1]),n=Math.ceil(distance/.02);let maxUnsupported=0;
    for(const lateral of [-.34,0,.34]){let unsupported=0;
      for(let k=0;k<=n;k++){const q=[from[0]+(to[0]-from[0])*k/n,from[1]+(to[1]-from[1])*k/n];q[cross]+=lateral;
        unsupported=faces.some(t=>inside(q,t.points))?0:unsupported+distance/n;maxUnsupported=Math.max(maxUnsupported,unsupported);}
    }
    if(maxUnsupported>.121)continue;
    return {i,j,axis,dir,from:from.map(r),to:to.map(r),width:.68,rise:r(b.y-a.y)};
   }
  }return null;
 };
 const edges=[];
 for(let i=0;i<patches.length;i++)for(let j=0;j<patches.length;j++){
  const rise=patches[j].y-patches[i].y;if(rise<.15||rise>.45)continue;
  const edge=pair(i,j);if(edge)edges.push(edge);
 }
 const chosen=new Map(),reached=new Set(patches.flatMap((p,i)=>p.y>=0&&p.y<=.45?[i]:[]));
 const chain=(i,axis,dir,seen=new Set())=>{
  if(seen.has(i))return [];seen=new Set([...seen,i]);let best=[];
  for(const e of edges.filter(e=>e.i===i&&(axis===undefined||e.axis===axis&&e.dir===dir))){const tail=[e,...chain(e.j,e.axis,e.dir,seen)];if(tail.length>best.length)best=tail;}return best;
 };
 for(const start of [...reached])for(const entry of edges.filter(e=>e.i===start)) {
  // The first tread may be entered from its side. The flight itself must still
  // contain three consecutive rises in one direction beyond that entrance.
  const tail=chain(entry.j), flight=[entry,...tail];
  if(tail.length<3)continue;
  for(const e of flight){chosen.set(`${e.i}:${e.j}`,e);reached.add(e.j);}
 }
 // The verified flight may open onto a deck made of several coplanar sheets.
 // Connect only mesh-proven seams at the same height, retaining separate patches.
 for(let pass=0;pass<patches.length;pass++){let changed=false;for(const i of [...reached]){
  if(patches[i].y<=.45)continue;
  for(let j=0;j<patches.length;j++){if(reached.has(j)||Math.abs(patches[j].y-patches[i].y)>.025)continue;const e=pair(i,j);if(!e)continue;chosen.set(`${i}:${j}`,e);reached.add(j);changed=true;}
 }if(!changed)break;}
 // Wide stair feet may be partly occupied by authored furniture. Preserve
 // several independently mesh-proven entry lanes; native collision checks choose
 // a clear one, and a fully barricaded flight stays inaccessible.
 for(const e of [...chosen.values()]) if(patches[e.i].y<=.45) for(const offset of [-1.2,-.6,.6,1.2]) {
  const alt=pair(e.i,e.j,[offset]);if(alt)chosen.set(`${e.i}:${e.j}:${offset}`,alt);
 }
 const links=[...chosen.values()].map((e,k)=>({id:`mesh-step:${e.i}:${e.j}:${k}`,kind:'stairs',from:e.i,to:e.j,path:[e.from,e.to],width:e.width,y0:patches[e.i].y,y1:patches[e.j].y}));
 return {reached:[...reached].sort((a,b)=>a-b),links,provenance:[...chosen.values()].map(e=>({from:e.i,to:e.j,rise:e.rise,axis:e.axis,direction:e.dir,proof:'three-rise flight or mesh-supported landing seam'}))};
}
