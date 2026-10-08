import {Builder,rng,pick,STONE} from './kit.ts';
import {house,aframe,lampPost,bench,lowWall,stairs} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
import {RAIL} from './country.ts';
/** Hillside village climbing the east hill (summit 226,-22) to a lookout temple. */
export const HILL_BOUNDS=[166,-72,262,26] as const;
export const HILL_ROAD:[number,number][]=[[160,-8],[170,-9],[180,-14],[188,-26],[192,-40],[200,-52],[212,-55],[220,-46],[214,-34],[204,-26],[202,-14],[210,-4],[222,-2],[234,-8],[238,-20],[232,-28],[226,-24]];
const SUMMIT=[226,-22] as const;
type Lot={x:number;z:number;yaw:number;w:number;d:number;dist:number};
function segDist(px:number,pz:number,pts:[number,number][]){let best=1e9;for(let i=1;i<pts.length;i++){const [ax,az]=pts[i-1],[bx,bz]=pts[i],dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/L2));best=Math.min(best,Math.hypot(px-ax-dx*t,pz-az-dz*t));}return best;}
let lots:Lot[]=[];
/** Choose lots and level their pads (must run before any terrain sampling for building). */
export function hillPads(t:Terrain){
 lots=[];const r=rng(31337);t.road(HILL_ROAD,3.6);
 // Summit lookout terrace.
 t.pad(SUMMIT[0]-9,SUMMIT[1]-9,SUMMIT[0]+9,SUMMIT[1]+9,Math.round(t.natural(SUMMIT[0],SUMMIT[1])),5);
 // Candidate lots on a jittered grid over the hill: 10..24 m from the lane, facing its nearest point.
 const near=(x:number,z:number)=>{let best=1e9,bx=0,bz=0;for(let i=1;i<HILL_ROAD.length;i++){const [ax,az]=HILL_ROAD[i-1],[cx,cz]=HILL_ROAD[i],dx=cx-ax,dz=cz-az,L2=dx*dx+dz*dz,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L2)),qx=ax+dx*u,qz=az+dz*u,d=Math.hypot(x-qx,z-qz);if(d<best){best=d;bx=qx;bz=qz;}}return {d:best,x:bx,z:bz};};
 for(let gx=180;gx<258;gx+=10)for(let gz=-70;gz<24;gz+=10){const x=gx+(r()-.5)*4,z=gz+(r()-.5)*4,n=near(x,z);
  if(n.d<10||n.d>30||segDist(x,z,RAIL)<12||Math.hypot(x-SUMMIT[0],z-SUMMIT[1])<15||r()<.12)continue;if(lots.some(l=>Math.hypot(l.x-x,l.z-z)<10.5))continue;
  const w=6+r()*3,d=5.5+r()*2.5;lots.push({x,z,yaw:faceYaw(x,z,n.x,n.z),w,d,dist:n.d});}
 for(const l of lots){const R=Math.max(l.w,l.d)/2+1;t.pad(l.x-R,l.z-R,l.x+R,l.z+R,undefined,4);}
}
/** Yaw that turns local +z toward (tx,tz). */
const faceYaw=(x:number,z:number,tx:number,tz:number)=>Math.atan2(tx-x,tz-z);
export function buildHillVillage(b:Builder,t:Terrain,trees:Trees){
 const r=rng(4242),G=(x:number,z:number)=>t.height(x,z);
 t.ribbon(b,HILL_ROAD,3.6,'#b6ab92','path',.2,1.2);
 // Cypress and olive along the road edge, low stone walls on the downhill side.
 for(let i=1;i<HILL_ROAD.length;i++){const [ax,az]=HILL_ROAD[i-1],[bx,bz]=HILL_ROAD[i],L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L;
  for(let s=2;s<L;s+=6){const x=ax+ux*s+uz*2.9,z=az+uz*s-ux*2.9;if(lots.every(l=>Math.hypot(l.x-x,l.z-z)>6)&&r()<.6)trees.add(x,G(x,z),z,.8+r()*.4,r()<.6?'cypress':'round',r()<.6?'#3f6a3c':'#7d8f55',r()*6);}
  if(i%2===0)lowWall(b,[[ax-uz*2.3,az+ux*2.3],[bx-uz*2.3,bz+ux*2.3]],.55,'#b9ae96',G,.4);
  if(i%3===1){const x=ax+ux*L/2-uz*2.4,z=az+uz*L/2+ux*2.4;b.push(x,G(x,z),z,0);lampPost(b,3.2,'#3a3f42');b.pop();}}
 const hillPal=['#efe9dc','#e8d8b8','#e6c86e','#e9b07a','#d49a8c','#c96f4a','#f0d9a8','#9db8c9','#a9c3b0','#efe4cf'];
 lots.forEach((l,i)=>{const y=G(l.x,l.z),rr=rng(900+i);b.push(l.x,y,l.z,l.yaw);
  if(rr()<.12){aframe(b,l.w*.8,l.d+1,l.w*.9,rr);}
  else house(b,{w:l.w,d:l.d,floors:rr()<.45?2:1,plinth:3.2,wallC:pick(rr,hillPal),roof:pick(rr,['gable','hip','hip','gable','flat','shed'] as const),roofC:pick(rr,['#a8553a','#b86a45','#9c4a32','#c27a52','#8a3a2a']),shutters:rr()<.6,flowerbox:rr()<.5,
   veranda:rr()<.25,balcony:rr()<.35,chimney:rr()<.5,roofGarden:rr()<.6,trim:pick(rr,['#2f4f5f','#355e3b','#7a2f2a','#efe9dc','#3d5a80'])},rr);
  // garden behind: fruit tree, laundry-line posts, a bench by the door
  b.push(0,0,-l.d/2-2.6,0);if(rr()<.7)trees.add(l.x-Math.sin(l.yaw)*(l.d/2+2.6)+(rr()-.5)*3,y,l.z-Math.cos(l.yaw)*(l.d/2+2.6)+(rr()-.5)*3,.7+rr()*.3,rr()<.5?'fruit':'round',pick(rr,['#7d8f55','#6f9a4e','#8aa850']),rr()*6);
  if(rr()<.5){b.box('timber',-1.6,0,0,.08,1.9,.08,'#6e4a30');b.box('timber',1.6,0,0,.08,1.9,.08,'#6e4a30');for(let k=0;k<4;k++)b.panel('cloth',-1.2+k*.8,1.45,0,.55,.7,pick(rr,['#e8e2d2','#c45a4a','#3d5a80','#e0b04a','#7fae4a']));}
  b.pop();if(rr()<.4){b.push(l.w/2-.6,0,l.d/2+.9,0);bench(b,'#6e4a30');b.pop();}
  b.pop();const fx=l.x+Math.sin(l.yaw)*(l.d/2+.8),fz=l.z+Math.cos(l.yaw)*(l.d/2+.8);t.ribbon(b,[[fx,fz],[l.x+Math.sin(l.yaw)*(l.dist-1.6),l.z+Math.cos(l.yaw)*(l.dist-1.6)]],1.2,'#c2b79c','path',.1,1);});
 // Summit lookout: a round colonnaded temple on a walled terrace, steps from the road.
 const [sx,sz]=SUMMIT,sy=G(sx,sz);b.push(sx,sy,sz,0);
 b.cyl('stone',0,-2,0,8.4,2.25,20,'#c9c0ae');b.cyl('stone',0,.25,0,8.5,.6,20,'#b9b0a0',false);
 b.cyl('stone',0,.25,0,5.2,.5,16,'#e8e2d2');b.cyl('stone',0,.75,0,4.8,.35,16,'#efe9dc');
 for(let i=0;i<12;i++){const a=i/12*Math.PI*2;b.cyl('stone',Math.cos(a)*4.2,1.1,Math.sin(a)*4.2,.32,4.2,8,'#f3eee2');}
 b.cyl('stone',0,5.3,0,4.7,.7,16,'#efe9dc');b.dome('roof',0,6,0,4.6,16,4,'#b08a5f',.7);b.cyl('metal',0,9.1,0,.1,1.4,4,'#c9a440',false);
 for(let i=0;i<6;i++){const a=i/6*Math.PI*2+.3;b.push(Math.cos(a)*7.2,.85,Math.sin(a)*7.2,-a+Math.PI/2);bench(b,'#8a8a80');b.pop();}
 b.pop();
 b.push(sx-8.5,G(sx-12,sz),sz,Math.PI/2);stairs(b,2.6,4,0,sy-G(sx-12,sz)+.25,pick(r,STONE));b.pop();
 // terraced vegetable plots and vines on the hill's south shoulder
 for(let k=0;k<7;k++){const x=196+k*6.5,z=-64+(k%2)*2;if(lots.some(l=>Math.hypot(l.x-x,l.z-z)<9)||segDist(x,z,RAIL)<9)continue;const y=G(x,z);for(let j=0;j<5;j++)b.box('foliage',x-2+j*1,y,z,.35,.9,4.5,j%2?'#5f8a46':'#6f9a4e');}
}
export const HILL_EXPLORE=[{id:'hillside-village',camera:[176,14,-4],target:[205,10,-30]},{id:'lookout-temple',camera:[214,30,-12],target:[226,25,-22]}];
