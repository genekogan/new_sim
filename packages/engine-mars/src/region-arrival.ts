type Point=[number,number];
/** A bounded, replayable physical exclusion mask supplied by the place binding. */
export function regionArrivalMask(raw:unknown,radius=0.55):{outside:(x:number,z:number)=>boolean}|null {
 if(raw===undefined)return{outside:()=>true};
 if(!Array.isArray(raw)||raw.length>128)return null;
 let vertices=0;
 for(const p of raw){if(!Array.isArray(p)||p.length<3||p.length>512||p.some(v=>!Array.isArray(v)||v.length!==2||!v.every(Number.isFinite)))return null;vertices+=p.length;}
 if(vertices>8192)return null;
 const polygons=raw as Point[][];
 return{outside:(x,z)=>!polygons.some(poly=>{
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
   const [ax,az]=poly[j],[bx,bz]=poly[i],dx=bx-ax,dz=bz-az;
   if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
   const length2=dx*dx+dz*dz,t=length2?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/length2)):0;
   // A full standing body must clear the building outline, not just its centre.
   if((x-ax-t*dx)**2+(z-az-t*dz)**2<radius**2)return true;
  }
  return inside;
 })};
}
