import * as THREE from 'three';
import {Builder,type MatKey,type Col,pick,PLASTER,ROOFS,TIMBER,STONE,TRIM} from './kit.ts';
import {hotelCoreLayout,hotelFlight,type HotelCoreLayout} from './hotel-core.ts';
/** Building archetypes in a LOCAL frame: origin = footprint centre at floor level,
 * front facade faces local +z. Callers b.push(x,y,z,yaw) first. */
export type BalconyLayout={x:number;floorY:number;width:number;depth:number;index:string};
export type RoofKind='gable'|'hip'|'flat'|'shed'|'cross'|'stepped'|'none';
export type HouseSpec={w:number;d:number;floors:number;fh?:number;wall?:MatKey;wallC?:Col;roof?:RoofKind;roofC?:Col;roofH?:number;trim?:Col;
 chimney?:boolean;balcony?:boolean;veranda?:boolean;shutters?:boolean;flowerbox?:boolean;dormer?:boolean;plinth?:number;roofGarden?:boolean;sideDoor?:boolean;noWindows?:boolean;barnDoor?:boolean;flatC?:Col;door?:boolean;awning?:Col;band?:boolean;balconyLayout?:readonly BalconyLayout[];
 /** Seafront hotel inside (hotel-core.ts): an open lobby behind the front door and a stair core up every storey. */
 hotelCore?:boolean;furnishBalconies?:boolean};
const GLASS='#2d3c46',GLASS2='#3b4a52',DOOR=['#5b3a29','#2f4f5f','#7a2f2a','#355e3b','#3d3a35','#8a6a3a'];
/** Window grid on one facade (local plane z=zf facing +z when face=1; use push for other facades). */
function windows(b:Builder,w:number,y0:number,floors:number,fh:number,zf:number,trim:Col,o:{shutters?:boolean;box?:boolean;skipDoor?:boolean;openings?:readonly BalconyLayout[];r:()=>number}){
 const n=Math.max(1,Math.floor((w-.6)/2.1)),gap=w/n;
 for(let f=0;f<floors;f++)for(let i=0;i<n;i++){const x=-w/2+gap*(i+.5),y=y0+f*fh+fh*.55;if(f===0&&o.skipDoor&&Math.abs(x)<gap*.6)continue;
  const tall=f>0&&o.r()<.25;const wh=tall?1.6:1.15,ww=.85;
  const glass=o.r()<.5?GLASS:GLASS2;
  if(o.openings?.some(v=>Math.abs(x-v.x)<(ww+1.2)/2&&y+wh/2>v.floorY&&y-wh/2<v.floorY+2.3))continue;
  b.panel('glass',x,y+(tall?-.2:0),zf+.03,ww,wh,glass);
  b.box('stone',x,y-wh/2-.08+(tall?-.2:0),zf+.06,ww+.2,.08,.14,trim);
  if(o.shutters){b.panel('timber',x-ww/2-.24,y,zf+.05,.4,wh+.05,trim);b.panel('timber',x+ww/2+.24,y,zf+.05,.4,wh+.05,trim);}
  if(o.box&&f===0)b.box('flower',x,y-wh/2-.02,zf+.18,ww,.18,.22,pick(o.r,['#d0485a','#e8a33c','#c45ab0','#f0e04a','#e86a4a']));}
}
/** World-space AABB footprints of every building body built (for the self-overlap test). */
/** Chimney tops (world) of every house built since the last reset (createEdenRegions resets it): smoke sources. */
export const CHIMNEYS:[number,number,number][]=[];
/** Night light anchors (world) since the last reset: [x, groundY, z, kind, scale]. Lamp posts, lanterns, fires and
 * windowed houses; the viewer paints them into its shared night light map (WorldNightLights). Presentation only. */
export const LIGHTS:[number,number,number,string,number][]=[];
const _l=new THREE.Vector3();
/** Record a night light at a local point (y = the ground under it). */
export function lightAt(b:Builder,kind:string,x=0,y=0,z=0,scale=1){_l.set(x,y,z).applyMatrix4(b.m);LIGHTS.push([+_l.x.toFixed(2),+_l.y.toFixed(2),+_l.z.toFixed(2),kind,scale]);}
export const FOOTPRINTS:{x0:number;z0:number;x1:number;z1:number;kind:string;corners:[number,number][]}[]=[];
export function footprint(b:Builder,w:number,d:number,kind:string){const v=new THREE.Vector3();let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;const corners:[number,number][]=[];for(const [x,z] of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]){v.set(x,0,z).applyMatrix4(b.m);corners.push([v.x,v.z]);x0=Math.min(x0,v.x);x1=Math.max(x1,v.x);z0=Math.min(z0,v.z);z1=Math.max(z1,v.z);}FOOTPRINTS.push({x0,z0,x1,z1,kind,corners});}
export function house(b:Builder,s:HouseSpec,r:()=>number){footprint(b,s.w,s.d,'house');
 const fh=s.fh??2.9,H=s.floors*fh,wall=s.wall??'plaster',wc=s.wallC??pick(r,PLASTER),rc=s.roofC??pick(r,ROOFS),trim=s.trim??pick(r,TRIM),pl=s.plinth??1.6,roof=s.roof??'gable';
 // Plinth reaches below the pad so sloping ground never shows a gap.
 // E2 #9: plinth and floor bands stand only 2 cm proud at the sides: row houses sit 4 cm apart, and wider ones overlapped
 // their neighbours' in the same planes (different stone colours flickering along a terrace front).
 const plinthC=pick(r,STONE),core=s.hotelCore&&s.balconyLayout?.length?hotelCoreLayout(s.w,s.d):null;
 if(!core)b.box('stone',0,-pl,0,s.w+.04,pl+.35,s.d+.25,plinthC);
 else{// the same plinth outside; inside, the lobby floor is level with the street and the doorway has no step
  b.box('stone',0,-pl,0,s.w+.04,pl,s.d+.25,plinthC);const [ix0,iz0,ix1,iz1]=core.inner,[d0,d1]=core.door;
  b.box('stone',0,0,(-s.d/2-.125+iz0)/2,s.w+.04,.35,iz0+s.d/2+.125,plinthC);
  for(const [a,c] of [[-s.w/2-.02,d0],[d1,s.w/2+.02]])b.box('stone',(a+c)/2,0,(iz1+s.d/2+.125)/2,c-a,.35,s.d/2+.125-iz1,plinthC);
  for(const side of[-1,1])b.box('stone',side*(s.w/2+.02+ix1)/2,0,0,s.w/2+.02-ix1,.35,iz1-iz0,plinthC);
  b.box('stone',0,-.1,0,ix1-ix0,.12,iz1-iz0,'#d8ccb4');b.box('stone',0,-.1,(iz1+s.d/2)/2,d1-d0,.12,s.d/2-iz1+.125,'#d8ccb4');}
 const balconies=s.balconyLayout??(s.balcony&&s.floors>1?[{x:0,floorY:fh+.04,width:Math.min(s.w-.8,3.2),depth:1.2,index:'first-floor'}]:[]);
 const buildingId='region-house:'+b.m.elements.slice(12,15).map(v=>v.toFixed(3)).join(':');
 const wallBox=(x:number,y:number,z:number,w:number,h:number,d:number,id:string)=>{b.box(wall,x,y,z,w,h,d,wc);b.boundary('wall',x,y,z,w,h,d,buildingId,id);};
 if(balconies.length){
  // Actual hollow shell and rectangular cuts, rather than a doorway painted on a solid building volume.
  const thickness=.18;
  wallBox(0,.35,-s.d/2+thickness/2,s.w,H-.35,thickness,'back');
  for(const floorY of new Set(balconies.map(v=>v.floorY))){if(!core){b.box('stone',0,floorY-.12,0,s.w-2*thickness,.12,s.d-2*thickness,trim,true);continue;} // Rendered floor, no native support registration.
   const [ix0,iz0,ix1,iz1]=core.inner,[wx0,wz0,,wz1]=core.well; // round the stair well
   b.box('stone',0,floorY-.12,(iz0+wz0)/2,ix1-ix0,.12,wz0-iz0,trim,true);b.box('stone',0,floorY-.12,(wz1+iz1)/2,ix1-ix0,.12,iz1-wz1,trim,true);b.box('stone',(ix0+wx0)/2,floorY-.12,(wz0+wz1)/2,wx0-ix0,.12,wz1-wz0,trim,true);}
  for(const side of[-1,1])wallBox(side*(s.w/2-thickness/2),.35,0,thickness,H-.35,s.d-2*thickness,'side:'+side);
  const xs=[...new Set([-s.w/2,s.w/2,...balconies.flatMap(v=>[v.x-.6,v.x+.6])])].sort((a,c)=>a-c);
  const ys=[...new Set([.35,H,...balconies.flatMap(v=>[v.floorY,v.floorY+2.3])])].filter(y=>y>=.35&&y<=H).sort((a,c)=>a-c);
  for(let ix=0;ix<xs.length-1;ix++)for(let iy=0;iy<ys.length-1;iy++){const x=(xs[ix]+xs[ix+1])/2,y=(ys[iy]+ys[iy+1])/2;if(balconies.some(v=>Math.abs(x-v.x)<.6&&y>v.floorY&&y<v.floorY+2.3))continue;
   const id='front:'+ix+':'+iy,z=s.d/2-thickness/2,ww=xs[ix+1]-xs[ix],hh=ys[iy+1]-ys[iy];
   if(core&&iy===0&&xs[ix]<core.door[1]&&xs[ix+1]>core.door[0]){// the lobby's open doorway: the wall band keeps its native registration (the hotel's upper-floors fact opens it)
    b.boundary('wall',x,ys[iy],z,ww,hh,thickness,buildingId,id);const a=Math.max(xs[ix],core.door[0]),c=Math.min(xs[ix+1],core.door[1]);
    if(a>xs[ix])b.box(wall,(xs[ix]+a)/2,ys[iy],z,a-xs[ix],hh,thickness,wc);if(c<xs[ix+1])b.box(wall,(c+xs[ix+1])/2,ys[iy],z,xs[ix+1]-c,hh,thickness,wc);
    b.box(wall,(a+c)/2,core.doorHead,z,c-a,ys[iy]+hh-core.doorHead,thickness,wc);continue;}
   wallBox(x,ys[iy],z,ww,hh,thickness,id);}
 }else b.authoredBox(wall,0,.35,0,s.w,H-.35,s.d,wc,buildingId,'body');
 if(s.band)for(let f=1;f<s.floors;f++)b.box('stone',0,f*fh-.05,0,s.w+.04,.14,s.d+.1,trim);
 // Facades: front and back, then the sides.
 if(!s.noWindows){lightAt(b,'window',0,0,0,Math.min(1.6,Math.max(.6,(s.w+s.d)/14)));windows(b,s.w,0,s.floors,fh,s.d/2,trim,{shutters:s.shutters,box:s.flowerbox,skipDoor:s.door!==false,openings:balconies,r});
 b.push(0,0,0,Math.PI);windows(b,s.w,0,s.floors,fh,s.d/2,trim,{r});b.pop();
 for(const side of [1,-1]){b.push(0,0,0,side*Math.PI/2);windows(b,s.d,0,s.floors,fh,s.w/2,trim,{shutters:s.shutters,r});b.pop();}}
 if(s.barnDoor){const dw=Math.min(s.w*.4,4.2),dh=Math.min(H*.6,4);b.panel('timber',0,.35+dh/2,s.d/2+.04,dw,dh,'#5b2a20');b.box('timber',0,.35+dh/2,s.d/2+.07,dw*1.05,.16,.06,trim);
  b.quad('timber',[-dw/2,.35,s.d/2+.07],[-dw/2+.16,.35,s.d/2+.07],[dw/2,.35+dh,s.d/2+.07],[dw/2-.16,.35+dh,s.d/2+.07],trim);b.panel('glass',0,H-.2,s.d/2+.04,1.2,1,'#2d3c46');}
 if(s.door!==false&&core){// the same door, standing open into the lobby, and a flush threshold instead of the step
  const doorC=pick(r,DOOR),stepC=pick(r,STONE);b.push(core.door[0]+.04,0,s.d/2-.16,-Math.PI/2);b.box('timber',.55,0,0,1.05,2.4,.05,doorC);b.pop();b.box('stone',0,-.2,s.d/2+.45,1.6,.26,.7,stepC);
  b.box('stone',0,2.55,s.d/2+.08,1.35,.1,.16,trim);}
 else if(s.door!==false){b.panel('timber',0,1.05+.35,s.d/2+.035,1.05,2.1,pick(r,DOOR));b.box('stone',0,-.2,s.d/2+.45,1.6,.56,.7,pick(r,STONE));
  b.box('stone',0,2.55,s.d/2+.08,1.35,.1,.16,trim);}
 if(s.awning){b.quad('cloth',[-s.w/2+.3,2.9,s.d/2+.02],[s.w/2-.3,2.9,s.d/2+.02],[s.w/2-.3,2.35,s.d/2+1.3],[-s.w/2+.3,2.35,s.d/2+1.3],s.awning);}
 const rh=s.roofH??Math.min(s.w,s.d)*.42;
 if(roof==='gable'){if(s.w>=s.d)b.gable('roof',0,H,0,s.w,s.d,rh,rc,wall,wc);else{b.push(0,0,0,Math.PI/2);b.gable('roof',0,H,0,s.d,s.w,rh,rc,wall,wc);b.pop();}}
 else if(roof==='hip')b.hip('roof',0,H,0,s.w,s.d,rh*.85,rc);
 else if(roof==='shed')b.shed('roof',0,H,0,s.w,s.d,rh*.6,rc);
 else if(roof==='cross'){b.gable('roof',0,H,0,s.w,s.d,rh,rc,wall,wc);b.push(0,0,0,Math.PI/2);b.gable('roof',0,H,0,s.d,s.w*.55,rh*.95,rc,null,wc);b.pop();}
 else if(roof==='stepped'){// Dutch stepped gable facing front, pitched roof behind.
  b.push(0,0,0,Math.PI/2);b.gable('roof',0,H,0,s.d,s.w,rh,rc,null,wc,.1);b.pop();const steps=4;for(let i=0;i<steps;i++){const ww=s.w*(1-i/steps)+.1;b.box(wall,0,H+i*rh/steps,s.d/2-.12,ww,rh/steps+.02,.3,wc);b.box('stone',0,H+(i+1)*rh/steps,s.d/2-.12,ww+.08,.09,.36,trim);}
  b.panel('glass',0,H+rh*.35,s.d/2+.04,.7,.9,GLASS);}
 else if(roof==='flat'||roof==='none'){if(roof==='flat'){b.box('stone',0,H,0,s.w+.2,.35,s.d+.2,s.flatC??trim);}
  if(s.roofGarden){b.box('soil',0,H+.35,0,s.w-.8,.25,s.d-.8,'#5a4632');for(let i=0;i<5;i++)b.box('foliage',-s.w/2+1+r()*(s.w-2),H+.6,-s.d/2+1+r()*(s.d-2),.7+r()*.6,.5+r()*.6,.7+r()*.6,pick(r,['#5f8a46','#6f9a4e','#4f7a3c']));
   b.box('metal',0,H+.35,s.d/2-.15,s.w,.9,.05,'#3e4446');b.box('cloth',s.w/4,H+2.2,0,2.4,.05,2.4,pick(r,['#d8c3a0','#c45a4a','#e0d07a']));b.box('metal',s.w/4,H+.6,0,.06,1.6,.06,'#444');}}
 if(s.chimney){const cx=s.w*(r()-.5)*.6,cz=-s.d*.18;b.box('stone',cx,H+rh*.4,cz,.6,rh*.7+.6,.6,pick(r,['#8a4a36','#a59d8e','#7a6a5a']));const v=new THREE.Vector3(cx,H+rh*1.1+.65,cz).applyMatrix4(b.m);CHIMNEYS.push([v.x,v.y,v.z]);}
 if(s.dormer&&roof==='gable'&&s.w>=s.d){b.push(0,H+rh*.18,s.d*.2,0);b.box(wall,0,0,0,1.4,1.2,1.2,wc);b.panel('glass',0,.6,.62,.8,.8,GLASS);b.gable('roof',0,1.2,0,1.4,1.3,.6,rc,wall,wc,.15);b.pop();}
 for(const balcony of balconies)buildBalcony(b,balcony,s.d/2,trim,buildingId);
 if(s.furnishBalconies&&balconies.length)furnishBalconyRooms(b,core?balconies.filter(v=>Math.abs(v.x-core.stairColumn)>.01):balconies,s.d,trim);
 if(core)hotelInside(b,core,s.floors,s.fh??2.9,trim,wall,wc);
 if(s.veranda){const vd=2.2;b.box('timber',0,-.1,s.d/2+vd/2,s.w+.4,.3,vd,pick(r,TIMBER));for(const x of [-s.w/2,-s.w/6,s.w/6,s.w/2])b.box('timber',x,.2,s.d/2+vd-.15,.16,2.5,.16,trim);
  b.shed('roof',0,2.6,s.d/2+vd/2,s.w+.4,vd,.45,rc,.15);b.box('timber',0,.2,s.d/2+vd-.15,s.w,.08,.06,trim);b.box('timber',0,.95,s.d/2+vd-.15,s.w,.06,.06,trim);}
 return H+rh;
}
/** The seafront hotel's lobby furniture and its stair core (hotel-core.ts): a dog-leg flight up every storey, landings, and a
 * rail round the well on the upper floors. Decorative: the hotel's upper-floors/1 fact gives the native floors, stairs and solids. */
function hotelInside(b:Builder,c:HotelCoreLayout,floors:number,fh:number,trim:Col,wall:MatKey,wc:Col){
 const d=new Builder('decorative');d.m.copy(b.m);const [wx0,wz0,wx1,wz1]=c.well,tread='#b9a68a',rail='#3e4446',w=c.laneWidth+.1;
 // lobby: a sofa against the west wall facing the room, a low table, the reception desk at the back
 const {x0,z0,z1,depth}=c.sofa;d.box('cloth',x0+depth/2,0,(z0+z1)/2,depth,.42,z1-z0,'#3d5a80');d.box('cloth',x0+.13,0,(z0+z1)/2,.26,.9,z1-z0,'#34506f');
 for(const z of[z0+.1,z1-.1])d.box('cloth',x0+depth/2,0,z,depth,.62,.2,'#34506f');
 const [tx0,tz0,tx1,tz1]=c.table;d.box('timber',(tx0+tx1)/2,.38,(tz0+tz1)/2,tx1-tx0,.06,tz1-tz0,'#8a6545');for(const x of[tx0+.05,tx1-.05])for(const z of[tz0+.05,tz1-.05])d.box('timber',x,0,z,.05,.38,.05,trim);
 const [rx0,rz0,rx1,rz1]=c.reception;d.box('timber',(rx0+rx1)/2,0,(rz0+rz1)/2,rx1-rx0,1.05,rz1-rz0,'#7a5236');d.box('stone',(rx0+rx1)/2,1.05,(rz0+rz1)/2,rx1-rx0+.08,.05,rz1-rz0+.08,'#efe9dc');
 d.box('dressing',rx1-.35,1.1,(rz0+rz1)/2,.22,.04,.16,'#c9a227');
 // the flights: every storey from the ground (lobby floor 0) to the top floor
 for(let f=0;f<floors-1;f++){const base=f===0?0:f*fh+.02,top=(f+1)*fh+.02,pts=hotelFlight(c,base,top),rise=(top-base)/16;
  for(const [k,[x,y,z]] of pts.entries()){if(k===8||k===9)continue;if(k===pts.length-1){d.box('stone',x,y-.12,(z+wz1)/2+.07,w,.12,wz1-z+.14,tread);continue;}
   d.box('stone',x,y-rise-.06,z,w,rise+.06,.3,tread);}
  d.box('stone',(wx0+wx1)/2,base+8*rise-.12,wz0+.3,wx1-wx0,.12,.6,tread); // turn landing
  d.box(wall,(wx0+wx1)/2,base,(wz0+wz1)/2,.08,base+8*rise-base-.12,wz1-wz0-.3,wc); // spine wall between the flights, up to the landing
 }
 // the rail round the well on every upper floor: along its west side and its north end (the south end is the way on and off)
 for(let f=1;f<floors;f++){const y=f*fh+.02;d.box('metal',wx0+.03,y,(wz0+wz1)/2,.05,1.0,wz1-wz0,rail);d.box('metal',(wx0+wx1)/2,y,wz0+.03,wx1-wx0,1.0,.05,rail);}
 d.drain(()=>b);
}
/** Pictured seaside hotel rooms. Decorative contents leave the full door-to-rear centre lane clear.
 * No native floor, seat or furniture action is registered; existing walls and guards are unchanged. */
export function furnishBalconyRooms(b:Builder,rooms:readonly BalconyLayout[],depth:number,trim:Col){
 const d=new Builder('decorative');d.m.copy(b.m);
 for(const room of rooms){const x=room.x,y=room.floorY;
  // A narrow single bed beside the centre lane, with its head toward the rear wall.
  d.box('timber',x-.95,y+.12,-depth/2+1.7,.70,.16,2.05,'#8a6545');
  for(const dx of[-.29,.29])for(const dz of[-.84,.84])d.box('timber',x-.95+dx,y,-depth/2+1.7+dz,.07,.15,.07,trim);
  d.box('cloth',x-.95,y+.28,-depth/2+1.7,.68,.18,2,'#efe9dc');d.box('cloth',x-.95,y+.46,-depth/2+1.08,.6,.09,.36,'#f3eee2');
  d.box('timber',x-.95,y+.12,-depth/2+.63,.74,.62,.06,trim);
  // Writing desk and inward-facing chair on the opposite side.
  d.box('timber',x+1.05,y+.72,-depth/2+2.1,.64,.06,.6,'#c6a57b');
  for(const dx of[-.25,.25])for(const dz of[-.23,.23])d.box('timber',x+1.05+dx,y,-depth/2+2.1+dz,.06,.72,.06,trim);
  d.box('dressing',x+1.05,y+.785,-depth/2+2.1,.29,.015,.2,'#f3eee2');
  d.push(x+1.05,y,-depth/2+3.0,Math.PI);d.box('timber',0,.42,0,.44,.06,.42,trim);d.box('timber',0,.48,-.19,.44,.42,.06,trim);for(const xx of[-.16,.16])for(const zz of[-.16,.16])d.box('timber',xx,0,zz,.06,.42,.06,trim);d.pop();
 }
 d.drain(()=>b);
}
/** Visible solid guard panels match the same three exact height bands; facade/entry stays open. */
export function buildBalcony(b:Builder,v:BalconyLayout,facadeZ:number,trim:Col,buildingId:string){
 const thickness=.08,height=1.05,y=v.floorY,outer=facadeZ+v.depth;
 b.box('stone',v.x,y-.12,facadeZ+v.depth/2,v.width,.12,v.depth,trim,true);
 const guard=(x:number,z:number,w:number,d:number,id:string)=>{b.box('metal',x,y,z,w,height,d,'#d3d9d5');b.box('dressing',x,y+height,z,w,.055,d+.02,trim);b.boundary('guard',x,y,z,w,height,d,buildingId,'balcony:'+v.index+':'+id);};
 guard(v.x,outer-thickness/2,v.width,thickness,'front');
 for(const side of[-1,1])guard(v.x+side*(v.width/2-thickness/2),facadeZ+v.depth/2,thickness,v.depth,'side:'+side);
 // Door jamb/head only. No sill or rail crosses the 1.2×2.3m access opening.
 for(const side of[-1,1])b.box('stone',v.x+side*.64,y,facadeZ+.025,.08,2.3,.08,trim);
 b.box('stone',v.x,y+2.3,facadeZ+.025,1.36,.08,.08,trim);
}
/** A-frame cabin: steep roof to the ground, glazed gable. */
export function aframe(b:Builder,w:number,d:number,h:number,r:()=>number){footprint(b,w,d,'aframe');const rc=pick(r,['#5d4a3f','#3f4448','#6f3a2a','#4f5d4b']),wc=pick(r,['#d9a85e','#c96f4a','#9db8c9','#e8d8b8','#8fb3a8']);
 b.box('stone',0,-3,0,w+.2,3.2,d+.2,pick(r,STONE));b.push(0,0,0,Math.PI/2);b.gable('roof',0,.2,0,d,w,h,rc,null,wc,.25);b.pop();
 // gables (front/back), glazing triangle on the front
 b.push(0,0,0,Math.PI/2);b.pop();
 for(const z of [d/2,-d/2]){b.tri('timber',[-w/2,.2,z],[w/2,.2,z],[0,.2+h-.05,z],wc);}
 b.tri('glass',[-w/4,.2+h*.5,d/2+.03],[w/4,.2+h*.5,d/2+.03],[0,.2+h*.9,d/2+.03],GLASS);b.panel('timber',0,1.3,d/2+.04,1,2.1,pick(r,DOOR));
 b.box('timber',0,-.05,d/2+1,w*.8,.25,2,pick(r,TIMBER));}
/** Round tower with conical or domed cap. */
export function tower(b:Builder,r0:number,h:number,cap:'cone'|'dome',wallC:Col,capC:Col,r:()=>number,wall:MatKey='stone'){footprint(b,r0*2,r0*2,'tower');
 b.cyl('stone',0,-1.4,0,r0+.2,1.6,10,pick(r,STONE),false);b.cyl(wall,0,0,0,r0,h,10,wallC,false);
 b.cyl('stone',0,h,0,r0+.35,.3,10,'#bdb3a0');if(cap==='cone')b.cone('roof',0,h+.3,0,r0+.45,r0*2.2,10,capC);else b.dome('roof',0,h+.3,0,r0+.2,10,4,capC);
 for(let f=1;f*3.2<h-1;f++)for(let i=0;i<3;i++){const a=i*2.09+f;b.push(Math.cos(a)*(r0+.02),0,Math.sin(a)*(r0+.02),Math.PI/2-a);b.panel('glass',0,f*3.2,0.02,.6,1.1,GLASS);b.pop();}
 b.panel('timber',0,1.1,r0+.03,1,2.2,pick(r,DOOR));}
export function lampPost(b:Builder,h=3.4,c:Col='#2f3436',light='lamp'){lightAt(b,light,0,0,0,Math.min(1.4,Math.max(.8,h/3.4)));b.cyl('metal',0,0,0,.07,h,5,c,false);b.box('metal',0,h,0,.32,.08,.32,c);b.box('glass',0,h-.42,0,.24,.42,.24,'#f3e3a8');b.box('metal',0,h-.48,0,.3,.06,.3,c);}
export function bench(b:Builder,c:Col='#8a5a36'){b.box('timber',0,.42,0,1.6,.06,.42,c);b.box('timber',0,.55,-.2,1.6,.4,.05,c);for(const x of [-.7,.7])b.box('metal',x,0,0,.06,.44,.4,'#2f3436');}
export function boat(b:Builder,len:number,hullC:Col,r:()=>number,cabin=false){const w=len*.32,h=.55;
 const P=(x:number,y:number,z:number)=>[x,y,z];const bow=len/2,stern=-len/2;
 // hull: two sides, transom, deck
 b.quad('timber',P(stern,h,w/2),P(bow*.7,h,w/2),P(bow*.7,-.2,w*.35),P(stern,-.2,w*.4),hullC);b.tri('timber',P(bow*.7,h,w/2),P(bow,h+.12,0),P(bow*.7,-.2,w*.35),hullC);
 b.quad('timber',P(stern,h,-w/2),P(stern,-.2,-w*.4),P(bow*.7,-.2,-w*.35),P(bow*.7,h,-w/2),hullC);b.tri('timber',P(bow*.7,h,-w/2),P(bow*.7,-.2,-w*.35),P(bow,h+.12,0),hullC);
 b.quad('timber',P(stern,h,-w/2),P(stern,h,w/2),P(stern,-.2,w*.4),P(stern,-.2,-w*.4),hullC);
 b.quad('timber',P(stern,h-.1,w/2),P(bow*.7,h-.1,w/2),P(bow*.7,h-.1,-w/2),P(stern,h-.1,-w/2),'#b08a5f');b.tri('timber',P(bow*.7,h-.1,w/2),P(bow,h,0),P(bow*.7,h-.1,-w/2),'#b08a5f');
 b.box('timber',0,h-.12,0,len*.8,.07,w*1.02,'#e8e2d2');
 if(cabin){b.box('plaster',-len*.12,h-.1,0,len*.38,.9,w*.7,pick(r,['#e8e2d2','#d9c9a0','#a9c3b0']));b.box('roof',-len*.12,h+.8,0,len*.42,.08,w*.78,pick(r,['#2f4f5f','#7a2f2a','#3f4448']));b.panel('glass',len*.07+.01,h+.45,0,.01,.01,GLASS);
  b.push(len*.07+.02,0,0,Math.PI/2);b.panel('glass',0,h+.45,0,w*.5,.4,GLASS);b.pop();}
 else{b.box('timber',len*.1,h-.15,0,.25,.08,w*.9,'#8a5a36');}}
/** Market stall: timber frame, counter, striped cloth awning. */
export function stall(b:Builder,w:number,c1:Col,c2:Col,r:()=>number,goods=true){const d=2;
 for(const x of [-w/2,w/2])for(const z of [-d/2,d/2])b.box('timber',x,0,z,.1,2.4,.1,'#6e4a30');b.box('timber',0,0,d/2-.2,w,.95,.5,'#8a5a36');
 const n=Math.max(3,Math.round(w/.5));for(let i=0;i<n;i++){const x0=-w/2-.1+i*(w+.2)/n,x1=x0+(w+.2)/n;b.quad('cloth',[x0,2.45,-d/2-.1],[x1,2.45,-d/2-.1],[x1,2.05,d/2+.5],[x0,2.05,d/2+.5],i%2?c1:c2);}
 if(goods)for(let i=0;i<Math.floor(w/.45);i++)b.box('flower',-w/2+.3+i*.45,.95,d/2-.25,.34,.12+r()*.12,.3,pick(r,['#d0485a','#e8a33c','#7fae4a','#f0e04a','#a0522d','#e86a4a','#6a3d7a']));}
export function gazebo(b:Builder,rad:number,c:Col,rc:Col,seg=8){b.cyl('stone',0,-.4,0,rad+.4,.75,seg,'#c9c0ae');for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2;b.box('timber',Math.cos(a)*rad,.35,Math.sin(a)*rad,.16,2.6,.16,c);}
 b.cyl('timber',0,2.9,0,rad+.15,.25,seg,c,false);b.cone('roof',0,3.15,0,rad+.6,rad*.9,seg,rc);b.cyl('metal',0,3.15+rad*.9-.1,0,.05,.7,4,'#3a3a3a',false);
 for(let i=0;i<seg;i++){if(i===seg/4*1)continue;const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2,x0=Math.cos(a0)*rad,z0=Math.sin(a0)*rad,x1=Math.cos(a1)*rad,z1=Math.sin(a1)*rad;b.quad('timber',[x0,1.2,z0],[x1,1.2,z1],[x1,1.28,z1],[x0,1.28,z0],c);b.quad('timber',[x0,.55,z0],[x1,.55,z1],[x1,.6,z1],[x0,.6,z0],c);}}
export function silo(b:Builder,rad:number,h:number,c:Col,cap:Col){b.cyl('metal',0,0,0,rad,h,12,c,false);for(let y=2;y<h;y+=2.2)b.cyl('metal',0,y,0,rad+.04,.12,12,'#8a9090',false);b.dome('metal',0,h,0,rad,12,3,cap,.6);b.box('metal',rad+.15,0,0,.08,h,.5,'#555');}
/** Stairs climbing local +z from (0,y0,0) to (0,y1,len). */
export function stairs(b:Builder,w:number,len:number,y0:number,y1:number,c:Col){const n=Math.max(2,Math.round(Math.abs(y1-y0)/.18)),dz=len/n,dy=(y1-y0)/n;for(let i=0;i<n;i++)b.box('stone',0,y0-.6+dy*i,dz*(i+.5),w,.6+dy,dz+.02,c);}
export function fence(b:Builder,pts:[number,number][],h:number,c:Col,ground:(x:number,z:number)=>number,picket=true){for(let s=1;s<pts.length;s++){const [ax,az]=pts[s-1],[bx,bz]=pts[s],L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.round(L/(picket?.32:2.2)));
 for(let i=0;i<=n;i++){const x=ax+(bx-ax)*i/n,z=az+(bz-az)*i/n,y=ground(x,z);b.box('timber',x,y,z,picket?.07:.12,h,picket?.07:.12,c);}
 for(const yy of picket?[h*.35,h*.8]:[h*.4,h*.85]){const ya=ground(ax,az)+yy,yb=ground(bx,bz)+yy,ux=(bx-ax)/L,uz=(bz-az)/L,t=.03;b.quad('timber',[ax-uz*t,ya,az+ux*t],[bx-uz*t,yb,bz+ux*t],[bx-uz*t,yb+.07,bz+ux*t],[ax-uz*t,ya+.07,az+ux*t],c);}}}
export function lowWall(b:Builder,pts:[number,number][],h:number,c:Col,ground:(x:number,z:number)=>number,t=.45){for(let s=1;s<pts.length;s++){const [ax,az]=pts[s-1],[bx,bz]=pts[s],L=Math.hypot(bx-ax,bz-az),n=Math.max(1,Math.ceil(L/3));
 for(let i=0;i<n;i++){const x=ax+(bx-ax)*(i+.5)/n,z=az+(bz-az)*(i+.5)/n,y=ground(x,z);b.push(x,y,z,-Math.atan2(bz-az,bx-ax));b.box('stone',0,-.5,0,L/n+.05,h+.5,t,c);b.pop();}}}
export const v3=(x:number,y:number,z:number)=>new THREE.Vector3(x,y,z);
