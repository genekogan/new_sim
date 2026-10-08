import {Builder,rng,pick} from './kit.ts';
import {lampPost,stall,footprint} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** A festival meadow east of the suburb (x 251..302, z 24..82): a striped circus big-top, food stalls, a helter-skelter, hot-air
 * balloons (two tethered here; the three aloft drift in the atmosphere layer), bunting poles and a little stage. */
export const FAIR_BOUNDS=[251,24,302,82] as const;
const C={x:277,z:52};
export function fairPads(t:Terrain){t.pad(253,27,300,78,2,8);}
const STRIPES=['#c43a2a','#f3eee2'];
export function buildFairground(b:Builder,t:Terrain,trees:Trees){const r=rng(9801),G=(x:number,z:number)=>t.height(x,z);
 const y0=G(C.x,C.z);
 // big top: striped drum, striped cone roof, central and side poles, a flag
 {b.push(C.x,y0,C.z,0);footprint(b,22,22,'big-top');const R=11,seg=24;for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,c=(i+1)/seg*Math.PI*2,col=STRIPES[i%2];
   b.quad('cloth',[Math.cos(a)*R,0,Math.sin(a)*R],[Math.cos(c)*R,0,Math.sin(c)*R],[Math.cos(c)*R,3.4,Math.sin(c)*R],[Math.cos(a)*R,3.4,Math.sin(a)*R],col);
   b.quad('cloth',[Math.cos(a)*R,3.4,Math.sin(a)*R],[Math.cos(c)*R,3.4,Math.sin(c)*R],[Math.cos(c)*2.2,8.6,Math.sin(c)*2.2],[Math.cos(a)*2.2,8.6,Math.sin(a)*2.2],col);
   b.tri('cloth',[Math.cos(a)*2.2,8.6,Math.sin(a)*2.2],[Math.cos(c)*2.2,8.6,Math.sin(c)*2.2],[0,10.2,0],'#c43a2a');}
  b.cyl('metal',0,10,0,.08,2,4,'#c9a440',false);b.tri('cloth',[0,12,0],[0,11.4,0],[1.2,11.7,0],'#f0c040');
  b.quad('dressing',[-1.6,0,R+.05],[1.6,0,R+.05],[1.6,2.8,R+.05],[-1.6,2.8,R+.05],'#2a1a14');b.box('dressing',0,2.9,R+.1,4.6,.7,.06,'#f0c040');
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2;b.box('dressing',Math.cos(a)*(R+2.4),0,Math.sin(a)*(R+2.4),.12,1,.12,'#6e4a30');}b.pop();}
 // helter-skelter: tower with a spiral slide
 {const x=C.x-17,z=C.z-12,y=G(x,z);b.push(x,y,z,0);footprint(b,4,4,'helter-skelter');b.cyl('plaster',0,0,0,1.6,9,10,'#f0c040',false,1.3);b.cone('roof',0,9,0,1.9,2.4,10,'#3d8ab0');
  for(let i=0;i<40;i++){const a0=i*.32,a1=(i+1)*.32,y0b=8.6-i*.21,y1=8.6-(i+1)*.21;b.quad('cloth',[Math.cos(a0)*1.7,y0b,Math.sin(a0)*1.7],[Math.cos(a1)*1.7,y1,Math.sin(a1)*1.7],[Math.cos(a1)*2.6,y1,Math.sin(a1)*2.6],[Math.cos(a0)*2.6,y0b,Math.sin(a0)*2.6],i%2?'#c43a2a':'#f3eee2');}b.pop();}
 // food and game stalls in an arc
 for(let i=0;i<8;i++){const a=-Math.PI*.85+i/7*Math.PI*.7,x=C.x+Math.cos(a)*18,z=C.z+Math.sin(a)*18;b.push(x,G(x,z),z,Math.atan2(C.x-x,C.z-z)+Math.PI);stall(b,3,pick(r,['#c43a2a','#3d8ab0','#5aa070','#f0c040','#7a4a8a']),'#f3eee2',r);b.pop();}
 // small stage with a striped backdrop
 {const x=C.x+18,z=C.z-14,y=G(x,z);b.push(x,y,z,-Math.PI*.75);footprint(b,8,5,'stage');b.box('timber',0,0,0,8,1,5,'#8a5a36');b.box('cloth',0,1,-2.4,8,4,.1,'#3d5a80');for(let i=0;i<8;i++)b.box('cloth',-3.5+i,4.6,-2.4,.9,.5,.12,i%2?'#f0c040':'#c43a2a');for(const s of [-1,1])b.box('metal',s*4,0,-2.4,.15,5,.15,'#3a3a3a');b.pop();}
 // tethered and drifting hot-air balloons
 const balloon=(x:number,y:number,z:number,s:number,cols:string[])=>{b.push(x,y,z,r()*6);for(let j=0;j<5;j++){const p0=-Math.PI/2+j/5*Math.PI,p1=-Math.PI/2+(j+1)/5*Math.PI;for(let i=0;i<12;i++){const a=i/12*Math.PI*2,c=(i+1)/12*Math.PI*2,R0=Math.cos(p0)*(j===0?.35:1)*s,R1=Math.cos(p1)*s,Y0=Math.sin(p0)*s*1.15,Y1=Math.sin(p1)*s*1.15;
   b.quad('cloth',[Math.cos(a)*R0,Y0,Math.sin(a)*R0],[Math.cos(c)*R0,Y0,Math.sin(c)*R0],[Math.cos(c)*R1,Y1,Math.sin(c)*R1],[Math.cos(a)*R1,Y1,Math.sin(a)*R1],cols[i%cols.length]);}}
  b.box('dressing',0,-s*1.15-1.6,0,s*.35,s*.25,s*.35,'#8a5a36');for(const [dx,dz] of [[-1,-1],[1,-1],[1,1],[-1,1]] as [number,number][])b.quad('dressing',[dx*s*.15,-s*1.15-1.35,dz*s*.15],[dx*s*.35,-s*1.1+.2,dz*s*.35],[dx*s*.35+.03,-s*1.1+.2,dz*s*.35],[dx*s*.15+.03,-s*1.15-1.35,dz*s*.15],'#5b4030');b.pop();};
 balloon(C.x-6,y0+9,C.z+18,3.4,['#e05a3a','#f0c040']);balloon(C.x+8,y0+10,C.z+19,3.2,['#3d8ab0','#f3eee2','#5aa070']);
 for(const [x,z] of [[C.x-6,C.z+18],[C.x+8,C.z+19]] as [number,number][]){const y=G(x,z);b.quad('dressing',[x,y,z],[x+.04,y,z],[x+.04,y+5.6,z],[x,y+5.6,z],'#3a3a3a');b.box('timber',x,y,z,.4,.4,.4,'#6e4a30');}
 // The three balloons aloft now drift (apps/web/src/atmosphere/balloons.ts); consume their rng draws so the rest of the fair is unchanged.
 r();r();r();
 // lamps and string-light poles around the meadow, a trodden path from the abbey lane
 for(let i=0;i<10;i++){const a=i/10*Math.PI*2,x=C.x+Math.cos(a)*23,z=C.z+Math.sin(a)*23;if(i%2){b.push(x,G(x,z),z,0);lampPost(b,3.4,'#3a3f42');b.pop();}else b.cyl('timber',x,G(x,z),z,.1,5,5,'#6e4a30',false);}
 for(let i=0;i<10;i+=2){const a=i/10*Math.PI*2,a2=(i+2)/10*Math.PI*2,x=C.x+Math.cos(a)*23,z=C.z+Math.sin(a)*23,x2=C.x+Math.cos(a2)*23,z2=C.z+Math.sin(a2)*23,ya=G(x,z)+4.9,yb=G(x2,z2)+4.9;
  for(let k=1;k<14;k++){const u=k/14;b.tri('cloth',[x+(x2-x)*u-.2,ya+(yb-ya)*u-Math.sin(u*Math.PI)*1.2,z+(z2-z)*u],[x+(x2-x)*u+.2,ya+(yb-ya)*u-Math.sin(u*Math.PI)*1.2,z+(z2-z)*u],[x+(x2-x)*u,ya+(yb-ya)*u-Math.sin(u*Math.PI)*1.2-.4,z+(z2-z)*u],pick(r,['#e05a3a','#f0c040','#3d8ab0','#5aa070','#f3eee2']));}}
 t.ribbon(b,[[244,74],[262,68],[C.x,C.z+11.5]],2.4,'#c2b79c','path',.1,1.2);
 for(let i=0;i<14;i++){const x=252+r()*48,z=26+r()*54;if(Math.hypot(x-C.x,z-C.z)<27)continue;trees.add(x,G(x,z),z,1+r()*.4,pick(r,['round','poplar','conifer'] as const),pick(r,['#5f8a46','#6f9a4e','#3f6a3c']),r()*6);}
}
