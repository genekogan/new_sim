/** Exact office guard geometry in world metres. Upper-floor barriers never become ground columns. */
export type OfficeGuardBox={id:string;buildingId:'eden-office-1';floorY:number;min:[number,number,number];max:[number,number,number]};
export const OFFICE_STAIR_GUARD_VERSION='office-stair-guards/1';
export function officeStairGuardBoxes():OfficeGuardBox[]{
 const guards:OfficeGuardBox[]=[];
 for(const floorY of[3.1,6.1]){
  const add=(side:string,minX:number,minZ:number,maxX:number,maxZ:number)=>guards.push({id:`eden-office-1:${floorY}:${side}`,buildingId:'eden-office-1',floorY,min:[minX,floorY,minZ],max:[maxX,floorY+1.05,maxZ]});
  add('west',87.14,13.44,87.2,16.5);add('north',87.14,13.44,89.06,13.5);add('east',89,13.44,89.06,16.5);
 }
 return guards;
}

/** Conservative sphere sweep via expanded 3D slabs, including fast diagonal moves. */
export function officeGuardSweepFraction(guards:readonly OfficeGuardBox[],from:readonly number[],to:readonly number[],radius:number,belowEye=0,aboveEye=0):number{
 if(from.length!==3||to.length!==3||![...from,...to,radius,belowEye,aboveEye].every(Number.isFinite)||radius<0||belowEye<0||aboveEye<0)return 0;
 let fraction=1;
 for(const guard of guards){
  let entry=0,exit=1,inside=true,valid=true;
  for(let axis=0;axis<3;axis++){
   const lo=guard.min[axis]-radius-(axis===1?aboveEye:0),hi=guard.max[axis]+radius+(axis===1?belowEye:0),d=to[axis]-from[axis];
   if(from[axis]<lo||from[axis]>hi)inside=false;
   if(Math.abs(d)<1e-12){if(from[axis]<lo||from[axis]>hi){valid=false;break;}continue;}
   const a=(lo-from[axis])/d,b=(hi-from[axis])/d;entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
   if(entry>exit){valid=false;break;}
  }
  if(valid&&inside){
   // An explicit frame/selection inside a newly installed guard may escape through its nearest face.
   // Moving deeper or sideways inside the band stays blocked.
   let depth=Infinity,escapeAxis=0,escapeDirection=0;
   for(let axis=0;axis<3;axis++)for(const direction of[-1,1]){
    const face=direction<0?guard.min[axis]-radius-(axis===1?aboveEye:0):guard.max[axis]+radius+(axis===1?belowEye:0),distance=(face-from[axis])*direction;
    if(distance<depth){depth=distance;escapeAxis=axis;escapeDirection=direction;}
   }
   if((to[escapeAxis]-from[escapeAxis])*escapeDirection<=0)fraction=0;
  }else if(valid&&exit>=0&&entry<=1)fraction=Math.min(fraction,Math.max(0,entry-1e-6));
 }
 return fraction;
}
