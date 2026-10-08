/** CN5's declared render floors. Native nav/1 remains flat; this never changes world state. */
export type PlatformFloor={id:string;c:[number,number];top:number;half?:[number,number];yaw?:number;r?:number;segments?:number;step?:{c:[number,number];half:[number,number];top?:number};ramp?:{c:[number,number];half:[number,number];from?:number;to?:number;dir?:[number,number]}};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const v2=(v:unknown):v is [number,number]=>Array.isArray(v)&&v.length===2&&v.every(finite);
const positive2=(v:unknown)=>v2(v)&&v.every(n=>n>0&&n<=100);
const height=(v:unknown):v is number=>finite(v)&&v>=0&&v<3;
/** Renderer boundary for captured or explicitly current metadata. Invalid entries never create floors. */
export function parsePlatformFloors(value:unknown):PlatformFloor[]{
 if(!Array.isArray(value))return [];
 return value.filter((p):p is PlatformFloor=>obj(p)&&typeof p.id==='string'&&!!p.id&&v2(p.c)&&height(p.top)&&p.top>0&&
  (positive2(p.half)||finite(p.r)&&p.r>.3&&p.r<50)&&(p.yaw===undefined||finite(p.yaw))&&
  (p.segments===undefined||finite(p.segments)&&Number.isInteger(p.segments)&&p.segments>=3&&p.segments<=64)&&
  [p.step,p.ramp].every(a=>a===undefined||obj(a)&&v2(a.c)&&positive2(a.half)&&['top','from','to'].every(k=>a[k]===undefined||height(a[k]))&&(a.dir===undefined||v2(a.dir)&&Math.hypot(...a.dir)>1e-6)));
}
const insideBox=(x:number,z:number,c:readonly[number,number],half:readonly[number,number],yaw=0)=>{
 const dx=x-c[0],dz=z-c[1],cs=Math.cos(yaw),sn=Math.sin(yaw);
 return Math.abs(dx*cs+dz*sn)<=half[0]+1e-6&&Math.abs(-dx*sn+dz*cs)<=half[1]+1e-6;
};
function insideDeck(q:PlatformFloor,x:number,z:number){
 if(q.half)return insideBox(x,z,q.c,q.half,q.yaw);
 if(q.r===undefined)return false;const dx=x-q.c[0],dz=z-q.c[1];
 if(!q.segments)return Math.hypot(dx,dz)<=q.r+1e-6;
 for(let i=0;i<q.segments;i++){const a=i*2*Math.PI/q.segments+(q.yaw??0),b=(i+1)*2*Math.PI/q.segments+(q.yaw??0),ax=Math.cos(a)*q.r,az=Math.sin(a)*q.r,bx=Math.cos(b)*q.r,bz=Math.sin(b)*q.r;if((bx-ax)*(dz-az)-(bz-az)*(dx-ax)<-1e-6)return false;}
 return true;
}
/** Offset only on the original base floor. Native raised-level, beam and vehicle exclusions belong to the caller. */
export function platformFloorOffset(platforms:readonly PlatformFloor[],x:number,z:number,recordedY:number,baseY=0):number{
 if(![x,z,recordedY,baseY].every(Number.isFinite)||Math.abs(recordedY-baseY)>.005)return 0;
 let top=0;
 for(const q of platforms){
  if(insideDeck(q,x,z))top=Math.max(top,q.top);
  if(q.step&&insideBox(x,z,q.step.c,q.step.half)){
   const dx=q.c[0]-q.step.c[0],dz=q.c[1]-q.step.c[1],length=Math.hypot(dx,dz);
   const dir=length>1e-6?[dx/length,dz/length]:[0,1],extent=Math.abs(dir[0])*q.step.half[0]+Math.abs(dir[1])*q.step.half[1];
   const u=Math.max(0,Math.min(1,((x-q.step.c[0])*dir[0]+(z-q.step.c[1])*dir[1]+extent)/extent));
   top=Math.max(top,(q.step.top??q.top/2)*u);
  }
  if(q.ramp&&insideBox(x,z,q.ramp.c,q.ramp.half)){
   const raw=q.ramp.dir??[q.c[0]-q.ramp.c[0],q.c[1]-q.ramp.c[1]],length=Math.hypot(...raw);if(length<1e-6)continue;
   const dx=raw[0]/length,dz=raw[1]/length,extent=Math.abs(dx)*q.ramp.half[0]+Math.abs(dz)*q.ramp.half[1];
   const u=Math.max(0,Math.min(1,((x-q.ramp.c[0])*dx+(z-q.ramp.c[1])*dz+extent)/(2*extent)));
   top=Math.max(top,(q.ramp.from??0)+((q.ramp.to??q.top)-(q.ramp.from??0))*u);
  }
 }
 return top;
}
