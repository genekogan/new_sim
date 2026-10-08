import {Builder,rng,pick,TIMBER} from './kit.ts';
import {house,boat,bench,lampPost,footprint} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** A river comes down from the north-western hills, past a watermill and under a stone bridge on the
 * west country road, and meets the sea at a fishing hamlet of stilt houses and drying nets. */
export const RIVER:[number,number][]=[[-262,-232],[-252,-200],[-240,-170],[-246,-140],[-236,-110],[-228,-84],[-238,-58],[-246,-30],[-236,0],[-226,30],[-232,62],[-242,92],[-236,122],[-230,150],[-226,186]];
export const RIVER_BOUNDS=[-272,-236,-206,192] as const;
const MILL={x:-226,z:-107},BRIDGE={x:-238.6,z:-58};
export function riverPads(t:Terrain){t.river(RIVER,7);t.pad(MILL.x-6,MILL.z-6,MILL.x+6,MILL.z+6,undefined,5);t.pad(-224,118,-204,146,undefined,6);}
export function buildRiver(b:Builder,t:Terrain,trees:Trees){const r=rng(9201),G=(x:number,z:number)=>t.height(x,z);
 // water surface: a ribbon following the river at its level
 for(let i=1;i<RIVER.length;i++){const [ax,az]=RIVER[i-1],[bx,bz]=RIVER[i],L=Math.hypot(bx-ax,bz-az),n=Math.ceil(L/3),ux=(bx-ax)/L,uz=(bz-az)/L,px=-uz*4.2,pz=ux*4.2;
  for(let k=0;k<n;k++){const P=(u:number,s:number)=>{const x=ax+(bx-ax)*u+px*s,z=az+(bz-az)*u+pz*s,c=t.riverAt(ax+(bx-ax)*u,az+(bz-az)*u,1);return [x,(c?c.level:0)-.25,z];};
   b.quad('water',P(k/n,-1),P(k/n,1),P((k+1)/n+.02,1),P((k+1)/n+.02,-1),'#4f8090');}}
 // reeds and boulders along the banks, willows/alders
 for(let i=0;i<150;i++){const seg=1+Math.floor(r()*(RIVER.length-1)),[ax,az]=RIVER[seg-1],[bx,bz]=RIVER[seg],u=r(),L=Math.hypot(bx-ax,bz-az),s=r()<.5?-1:1,off=3.6+r()*1.4,x=ax+(bx-ax)*u-(bz-az)/L*off*s,z=az+(bz-az)*u+(bx-ax)/L*off*s,y=G(x,z);
  if(y<-.5)continue;if(r()<.6){for(let k=0;k<3;k++)b.box('foliage',x+(r()-.5),y-.2,z+(r()-.5),.07,1+r()*.6,.07,'#6f8a3c');}else b.box('stone',x,y-.3,z,.7+r(),.5+r()*.4,.6+r(),pick(r,['#8f877a','#7c766c']));}
 for(let i=0;i<40;i++){const seg=1+Math.floor(r()*(RIVER.length-1)),[ax,az]=RIVER[seg-1],[bx,bz]=RIVER[seg],u=r(),L=Math.hypot(bx-ax,bz-az),s=r()<.5?-1:1,off=8+r()*6,x=ax+(bx-ax)*u-(bz-az)/L*off*s,z=az+(bz-az)*u+(bx-ax)/L*off*s;
  if(G(x,z)<.3)continue;trees.add(x,G(x,z),z,.9+r()*.5,pick(r,['round','poplar','round'] as const),pick(r,['#7a9a4a','#6f9a4e','#8aa850']),r()*6);}
 // stone bridge on the west country road
 {const lv=t.riverAt(BRIDGE.x,BRIDGE.z,1)?.level??0,yd=Math.max(G(BRIDGE.x-9,BRIDGE.z-2),G(BRIDGE.x+9,BRIDGE.z+2),lv+1.6);b.push(BRIDGE.x,0,BRIDGE.z,Math.atan2(-80,18)+Math.PI/2);
  const span=20,w=4.6;for(let i=0;i<10;i++){const a=i/10,c=(i+1)/10,xa=-span/2+span*a,xc=-span/2+span*c,ya=yd+Math.sin(a*Math.PI)*.8,yc=yd+Math.sin(c*Math.PI)*.8;
   b.quad('stone',[xa,ya,-w/2],[xa,ya,w/2],[xc,yc,w/2],[xc,yc,-w/2],'#b9b0a0');for(const s of [-1,1])b.quad('stone',[xa,ya-1.2,s*w/2],[xc,yc-1.2,s*w/2],[xc,yc+.6,s*w/2],[xa,ya+.6,s*w/2],'#a59d8e');}
  for(const x of [-3.5,3.5])b.box('stone',x,lv-1.4,0,1.6,yd-lv+.6,w,'#8f877a');b.pop();}
 // watermill: stone house with a timber upper floor, a big wheel at the water, a millrace
 {const y=G(MILL.x,MILL.z);b.push(MILL.x,y,MILL.z,-Math.PI/2);house(b,{w:9,d:7,floors:2,wall:'stone',wallC:'#b9ae96',roof:'gable',roofC:'#5d4a3f',trim:'#efe9dc',chimney:true,plinth:2.5},r);b.pop();
  const lv=t.riverAt(-234,-112,1)?.level??y-1;b.push(-230,lv+1.5,-112.4,0);b.pushRot('x',Math.PI/2);b.cyl('timber',0,-.6,0,2.9,1.2,14,'#6e4a30',false);for(let i=0;i<14;i++){const a=i/14*Math.PI*2;b.push(Math.cos(a)*2.95,0,Math.sin(a)*2.95,-a);b.box('timber',0,-.6,0,.14,1.2,.7,'#5b4030');b.pop();}b.pop();b.pop();
  b.box('timber',-228.5,y+3.4,-111.6,3.4,.3,1.2,'#7a5a3a');}
 // fishing hamlet at the river mouth: stilt houses over the shore, drying nets, boats on the sand, a little chapel
 const rr=rng(9301);for(const [x,z,yaw] of [[-218,124,Math.PI/2],[-218,134,Math.PI/2],[-210,126,0],[-206,138,-Math.PI/2],[-214,144,Math.PI]] as [number,number,number][]){const y=G(x,z);
  b.push(x,y+1.4,z,yaw);for(const sx of [-2,2])for(const sz of [-2,2])b.box('timber',sx,-3,sz,.22,3.2,.22,'#5b4030');house(b,{w:5.2,d:5.2,floors:1,wall:'timber',wallC:pick(rr,['#3d8ab0','#e05a3a','#f0c040','#5aa070','#efe9dc','#2f6f8f']),roof:'gable',roofC:pick(rr,['#3f4448','#efe9dc','#8a3a2a']),plinth:.2,trim:'#f3eee2'},rr);
  b.box('timber',0,-.15,3.6,5.2,.2,2,pick(rr,TIMBER));b.pop();}
 for(let i=0;i<4;i++){const x=-222+i*4,z=141;if(G(x,z)<0)continue;b.box('timber',x,G(x,z),z,.1,2,.1,'#5b4030');if(i)b.quad('cloth',[x-4,G(x,z)+1.9,z],[x,G(x,z)+1.9,z],[x,G(x,z)+.6,z+.3],[x-4,G(x,z)+.6,z+.3],'#6a7a6a');}
 for(let i=0;i<4;i++){const x=-212+i*3.5,z=152+r()*3;b.push(x,Math.max(G(x,z)+.2,-.65),z,Math.PI/2+r()*.4);boat(b,4,pick(r,['#e05a3a','#3d8ab0','#f0c040','#efe9dc']),r,false);b.pop();}
 {const x=-226,z=116,y=G(x,z);b.push(x,y,z,0);house(b,{w:5,d:8,floors:1,fh:4,wallC:'#f3eee2',roof:'gable',roofH:3,roofC:'#3d5a80',trim:'#3d5a80',plinth:2},r);b.box('plaster',0,4,4.2,1.6,3,1.2,'#f3eee2');b.cone('roof',0,7,4.2,1,2,4,'#3d5a80');b.pop();}
 b.push(-212,G(-212,118),118,0);bench(b,'#3d5a80');b.pop();b.push(-208,G(-208,118),118,0);lampPost(b,3.2,'#2f4f5f');b.pop();
 void footprint;
}
