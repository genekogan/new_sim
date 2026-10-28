import type {Flight,FootState} from './stair-gait.ts';
/** Actual drawn sole points, all retained. Heel/toe overhang over lower/open
 * space is allowed; the next higher riser must remain clear. */
export function stairSoleFit(f:Flight,foot:FootState,vertices:readonly {x:number;y:number;z:number}[]):{along:number;lift:number}{
  if(!f.supports||!f.contactTops||!vertices.length)return {along:0,lift:0};
  const points=vertices.map(p=>{const x=p.x-f.o[0],z=p.z-f.o[1];return {s:x*f.dir[0]+z*f.dir[1],lat:-x*f.dir[1]+z*f.dir[0],y:p.y};});
  const next=foot.k<=0?f.supports[0]:f.supports[foot.k];
  const low=next?points.filter(p=>p.y<next.y+.003&&p.lat>=next.left&&p.lat<=next.right):[];
  const along=foot.planted&&next&&low.length?Math.min(0,next.lo-.004-Math.max(...low.map(p=>p.s))):0;
  let lift=0;
  for(const p of points){
    const s=p.s+along,z=p.lat;
    // The lower approach is the existing terrain, independently checked by the adapter.
    if(s<f.supports[0].lo&&Math.abs(z)<f.width/2)lift=Math.max(lift,f.yBottom+.003-p.y);
    for(const t of f.contactTops){
      const c=(a:number[],b:number[])=>(b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(s-a[0]),a=c(t[0],t[1]),b=c(t[1],t[2]),d=c(t[2],t[0]);
      if(a>=-1e-7&&b>=-1e-7&&d>=-1e-7||a<=1e-7&&b<=1e-7&&d<=1e-7)lift=Math.max(lift,Math.max(...t.map(q=>q[1]))+.003-p.y);
    }
  }
  return {along,lift:Math.max(0,lift)};
}
