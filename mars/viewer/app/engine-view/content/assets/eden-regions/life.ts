import {Builder,rng,pick} from './kit.ts';
import {boat} from './buildings.ts';
import {WATER,type Terrain} from './terrain.ts';
import {SUBURB_STREETS} from './suburb.ts';
/** Lived-in details across the Regions: bunting over the market street and plaza, laundry lines
 * across the canal back lane, parked cars and vans, and sailboats out on the sea. */
const FLAGS=['#e05a3a','#f0c040','#3d8ab0','#5aa070','#e88aa0','#f3eee2','#7a4a8a'];
function bunting(b:Builder,r:()=>number,ax:number,az:number,ay:number,bx:number,bz:number,by:number,sag=.8){const L=Math.hypot(bx-ax,bz-az),n=Math.max(4,Math.round(L/.7)),ux=(bx-ax)/L,uz=(bz-az)/L;
 for(let i=0;i<n;i++){const u=(i+.5)/n,x=ax+(bx-ax)*u,z=az+(bz-az)*u,y=ay+(by-ay)*u-Math.sin(u*Math.PI)*sag;b.tri('cloth',[x-ux*.22,y,z-uz*.22],[x+ux*.22,y,z+uz*.22],[x,y-.42,z],pick(r,FLAGS));}
 for(let i=0;i<n;i++){const u0=i/n,u1=(i+1)/n,y0=ay+(by-ay)*u0-Math.sin(u0*Math.PI)*sag,y1=ay+(by-ay)*u1-Math.sin(u1*Math.PI)*sag;b.quad('dressing',[ax+(bx-ax)*u0,y0,az+(bz-az)*u0],[ax+(bx-ax)*u1,y1,az+(bz-az)*u1],[ax+(bx-ax)*u1,y1+.02,az+(bz-az)*u1],[ax+(bx-ax)*u0,y0+.02,az+(bz-az)*u0],'#3a3a3a');}}
/** Small car (local +z forward), 4.2 m long. */
export function car(b:Builder,c:string,van=false){const L=van?5:4.2,W=1.8;b.box('metal',0,.3,0,W,.75,L,c);if(van){b.box('metal',0,1.05,-.4,W,1.2,L-1.4,c);b.box('glass',0,1.2,L/2-1.15,W-.1,.6,.06,'#2d3c46');}
 else{b.box('metal',0,1.05,-.2,W-.2,.6,L*.5,c);b.box('glass',0,1.1,L*.25-.18,W-.3,.45,.04,'#2d3c46');b.box('glass',0,1.1,-L*.25-.22,W-.3,.45,.04,'#2d3c46');}
 for(const x of [-W/2,W/2])for(const z of [-L*.32,L*.32]){b.push(x,.32,z,0);b.pushRot('z',Math.PI/2);b.cyl('dressing',0,-.12,0,.32,.24,8,'#1e1e1e');b.pop();b.pop();}
 b.box('dressing',0,.55,L/2+.01,W*.8,.12,.02,'#f3e3a8');}
export function buildLife(b:Builder,t:Terrain){const r=rng(8101);
 // bunting zig-zagging over the market street and across the plaza
 for(let x=113;x<166;x+=9)bunting(b,r,x,93.6,3.6,x+4.5,100.6,4.2);
 for(let x=122;x<158;x+=12)bunting(b,r,x,61,5.2,x+6,85,5.2,1.4);
 // laundry lines across the east back lane (between the east canal row and the second ring)
 for(let z=-26;z<52;z+=11){const y=5+r()*2;b.quad('dressing',[157.6,y,z],[161.4,y,z],[161.4,y+.02,z],[157.6,y+.02,z],'#d8d8d8');for(let k=0;k<5;k++){const x=157.9+k*.7+r()*.2;b.panel('cloth',x,y-.4,z,.5,.7,pick(r,['#f3f3f3','#e05a3a','#3d8ab0','#f0c040','#e88aa0','#5aa070']));}}
 // parked cars along the suburb streets, at the station and the farmsteads' yard; a delivery van at the market
 const cols=['#c43a2a','#2f4f5f','#e8e2d2','#3a3a3a','#5a8a6a','#d9a441','#7a8a9a','#3d5a80'];
 for(const [[ax,az],[bx,bz]] of SUBURB_STREETS){const L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L;for(let s=12;s<L-8;s+=17+r()*10){if(r()<.35)continue;const side=r()<.5?-1:1,x=ax+ux*s-uz*2.1*side,z=az+uz*s+ux*2.1*side;
   b.push(x,0,z,Math.atan2(ux*side,uz*side));car(b,pick(r,cols));b.pop();}}
 for(let i=0;i<5;i++){b.push(118+i*3,0,-36.5,0);car(b,pick(r,cols));b.pop();}
 b.push(168.5,0,97.5,0);car(b,'#e8e2d2',true);b.pop();
 // sailboats and a ferry out on the sea
 for(let i=0;i<9;i++){const x=-80+r()*260,z=200+r()*120;b.push(x,WATER.bay-.1,z,r()*6.28);boat(b,6+r()*3,pick(r,['#f3f3ee','#2f4f5f','#7a2f2a']),r,false);b.cyl('metal',0,.5,0,.06,6,5,'#e8e8e8',false);b.tri('cloth',[.1,1.5,0],[.1,6.3,0],[3.2,1.6,0],pick(r,['#f3f3ee','#e05a3a','#3d8ab0','#f0c040']));b.pop();}
 {b.push(40,WATER.bay,260,.3);b.box('metal',0,-.5,0,6,1.6,22,'#f3f3ee');b.box('metal',0,1.1,-2,5,2.2,12,'#e8e2d2');b.box('glass',0,1.6,-2,5.05,.6,11,'#2d3c46');b.box('metal',0,3.3,-4,1.2,1.5,1.2,'#c43a2a');b.pop();}
 void t;
}
