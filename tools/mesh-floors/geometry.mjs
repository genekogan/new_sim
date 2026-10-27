// Offline deterministic floor extraction. A cell must be wholly covered by a
// connected coplanar triangle patch; boundaries (including holes) are never boxed over.
const r=v=>Math.round(v*10000)/10000;
const key=p=>`${r(p[0])},${r(p[2])}`;
const inside=(p,t)=>{
 const cross=(a,b)=>(b[0]-a[0])*(p[1]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
 const a=cross(t[0],t[1]),b=cross(t[1],t[2]),c=cross(t[2],t[0]);
 return (a>=-1e-8&&b>=-1e-8&&c>=-1e-8)||(a<=1e-8&&b<=1e-8&&c<=1e-8);
};
function cuts(a,b,x,z,cell){
 // Liang-Barsky against the open cell, so a floor edge on its border is safe.
 const lo=[x+1e-7,z+1e-7],hi=[x+cell-1e-7,z+cell-1e-7]; let start=0,end=1;
 for(let k=0;k<2;k++){const q=k===0?0:2,d=b[q]-a[q];if(Math.abs(d)<1e-10){if(a[q]<=lo[k]||a[q]>=hi[k])return false;continue;}
  const u=(lo[k]-a[q])/d,v=(hi[k]-a[q])/d;start=Math.max(start,Math.min(u,v));end=Math.min(end,Math.max(u,v));if(start>end)return false;
 }return true;
}
function rectangles(cells,cell){
 const left=new Set(cells),out=[];
 const coords=[...left].map(k=>k.split(',').map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
 for(const [x,z] of coords){if(!left.has(`${x},${z}`))continue;let w=1,h=1;
  while(left.has(`${x+w},${z}`))w++;
  outer:for(;;h++){for(let i=0;i<w;i++)if(!left.has(`${x+i},${z+h}`))break outer;}
  for(let j=0;j<h;j++)for(let i=0;i<w;i++)left.delete(`${x+i},${z+j}`);
  out.push([[r(x*cell),r(z*cell)],[r((x+w)*cell),r(z*cell)],[r((x+w)*cell),r((z+h)*cell)],[r(x*cell),r((z+h)*cell)]]);
 }return out;
}
function clusters(cells){
 const unseen=new Set(cells),out=[];
 for(const start of cells){if(!unseen.delete(start))continue;const queue=[start];
  for(let i=0;i<queue.length;i++){const [x,z]=queue[i].split(',').map(Number);for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]){const k=`${x+dx},${z+dz}`;if(unseen.delete(k))queue.push(k);}}
  out.push(queue);
 }return out;
}
export function extractFloorPatches(triangles,{cell=.15,minArea=1,headroom=1.8,maxCells=250000}={}){
 const bands=new Map(),all=triangles.map(t=>t.points),seen=new Set(),overhead=new Map(),nodeOf=new Map(triangles.map(t=>[t.points,t.node]));
 for(const t of all){const xs=t.map(p=>p[0]),zs=t.map(p=>p[2]);for(let x=Math.floor(Math.min(...xs));x<=Math.floor(Math.max(...xs));x++)for(let z=Math.floor(Math.min(...zs));z<=Math.floor(Math.max(...zs));z++){const k=`${x},${z}`,b=overhead.get(k);if(b)b.push(t);else overhead.set(k,[t]);}}
 for(const tri of triangles){const t=tri.points,[a,b,c]=t,u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
  // Horizontal support only: sloped ramps retain their authored link/override.
  if(len<1e-8||n[1]/len<.9999||Math.max(...t.map(p=>p[1]))-Math.min(...t.map(p=>p[1]))>.01)continue;
  const y=Math.round((a[1]+b[1]+c[1])/3*1000)/1000,k=`${y}:${t.map(key).sort().join('|')}`;if(seen.has(k))continue;seen.add(k);
  const by=Math.round(y*100)/100;let band=bands.get(by);if(!band)bands.set(by,band={y,tris:[],nodes:new Set()});band.y=Math.max(band.y,y);band.tris.push(t);band.nodes.add(tri.node);
 }
 const patches=[];let checked=0;
 for(const band of [...bands.values()].sort((a,b)=>a.y-b.y)){
  const edges=new Map(),buckets=new Map();
  for(const t of band.tris){for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],k=[key(a),key(b)].sort().join('|'),e=edges.get(k);if(e)e.n++;else edges.set(k,{a,b,n:1});}
   const xs=t.map(p=>p[0]),zs=t.map(p=>p[2]);for(let x=Math.floor(Math.min(...xs));x<=Math.floor(Math.max(...xs));x++)for(let z=Math.floor(Math.min(...zs));z<=Math.floor(Math.max(...zs));z++){const k=`${x},${z}`,b=buckets.get(k);if(b)b.push(t);else buckets.set(k,[t]);}
  }
  const boundary=[...edges.values()].filter(e=>e.n!==2),candidates=new Set();
  for(const t of band.tris){const xs=t.map(p=>p[0]),zs=t.map(p=>p[2]);for(let x=Math.floor(Math.min(...xs)/cell);x<Math.ceil(Math.max(...xs)/cell);x++)for(let z=Math.floor(Math.min(...zs)/cell);z<Math.ceil(Math.max(...zs)/cell);z++){candidates.add(`${x},${z}`);if(checked+candidates.size>maxCells)throw Error(`floor extraction exceeds ${maxCells} cells; narrow the input or author an override`);}}
  if((checked+=candidates.size)>maxCells)throw Error(`floor extraction exceeds ${maxCells} cells; narrow the input or author an override`);
  const free=[],provenance=new Map();
  for(const k of candidates){const [i,j]=k.split(',').map(Number),x=i*cell,z=j*cell,p=[x+cell/2,z+cell/2];
   const covering=(buckets.get(`${Math.floor(p[0])},${Math.floor(p[1])}`)??[]).filter(t=>inside(p,t));
   if(!covering.length)continue;
   if(boundary.some(e=>cuts(e.a,e.b,x,z,cell)))continue;
   // Preserve headroom. Any horizontal/tilted surface over the cell's body centre
   // denies support, even when it is a table or shelf rather than an authored wall.
   if((overhead.get(`${Math.floor(p[0])},${Math.floor(p[1])}`)??[]).some(t=>{
    if(Math.max(...t.map(p=>p[1]))<=band.y+.05||Math.min(...t.map(p=>p[1]))>=band.y+headroom||!inside(p,t))return false;
    const [a,b,c]=t,den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(den)<1e-8)return false;
    const u=((b[2]-c[2])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[2]))/den,v=((c[2]-a[2])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[2]))/den,y=u*a[1]+v*b[1]+(1-u-v)*c[1];return y>band.y+.05&&y<band.y+headroom;
   }))continue;
   free.push(k);provenance.set(k,covering.map(t=>nodeOf.get(t)));
  }
  for(const cells of clusters(free)){const area=r(cells.length*cell*cell);if(area<minArea)continue;patches.push({y:band.y,area,nodes:[...new Set(cells.flatMap(k=>provenance.get(k)))].sort(),polygons:rectangles(cells,cell)});}
 }
 return {policy:'mesh-floors/1',cell,headroom,patches};
}
