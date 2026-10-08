import {Builder,rng,pick} from './kit.ts';
import {house,bench,footprint} from './buildings.ts';
import {car} from './life.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** A small golf course in the north-eastern meadows (x 180..258, z −112..−184): five fairways with
 * tees, greens and flags, sand bunkers, a water hazard, a clubhouse with a terrace and golf carts. */
export const GOLF_BOUNDS=[178,-186,260,-110] as const;
const HOLES:{tee:[number,number];green:[number,number]}[]=[
 {tee:[192,-118],green:[236,-126]},{tee:[244,-134],green:[214,-150]},{tee:[204,-158],green:[246,-170]},{tee:[238,-180],green:[196,-178]},{tee:[188,-168],green:[190,-132]}];
const POND={x:222,z:-139,rx:7,rz:4};
export function golfPads(t:Terrain){t.pad(180,-118,192,-110,undefined,4);t.cuts.push((x,z)=>{const e=((x-POND.x)/POND.rx)**2+((z-POND.z)/POND.rz)**2;return e<1?-1*Math.min(1,(1-e)*3):0;});}
export function buildGolf(b:Builder,t:Terrain,trees:Trees){const r=rng(9701),G=(x:number,z:number)=>t.height(x,z);
 const disc=(x:number,z:number,rad:number,c:string,lift:number,seg=14)=>{for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,c2=(i+1)/seg*Math.PI*2,P=(q:number)=>{const px=x+Math.cos(q)*rad,pz=z+Math.sin(q)*rad*.8;return [px,G(px,pz)+lift,pz];};b.tri('soil',[x,G(x,z)+lift,z],P(c2),P(a),c);}};
 HOLES.forEach((h,i)=>{t.ribbon(b,[h.tee,h.green],11,'#8cc060','path',.4,1.5);// fairway with mowing stripes
  const [ax,az]=h.tee,[bx,bz]=h.green,L=Math.hypot(bx-ax,bz-az);for(let s=6;s<L-6;s+=6)t.ribbon(b,[[ax+(bx-ax)*s/L,az+(bz-az)*s/L],[ax+(bx-ax)*(s+3)/L,az+(bz-az)*(s+3)/L]],10.6,'#98c86a','path',.43,1.5);
  disc(bx,bz,5,'#a8d878',.46,16);b.box('dressing',ax,G(ax,az)+.05,az,3,.06,3,'#9ccc6c');
  const fy=G(bx,bz);b.cyl('metal',bx,fy,bz,.03,2.2,4,'#f3f3ee',false);b.tri('cloth',[bx,fy+2.2,bz],[bx,fy+1.75,bz],[bx+.7,fy+1.98,bz],i%2?'#e05a3a':'#f0c040');
  for(let k=0;k<2;k++){const a=r()*Math.PI*2,x=bx+Math.cos(a)*7.2,z=bz+Math.sin(a)*6;disc(x,z,2+r(),'#e8dcb0',.45,10);}
  b.box('dressing',ax+1.8,G(ax,az),az,.3,.9,.3,'#3d5a80');});
 // water hazard with reeds
 for(let i=0;i<20;i++){const a=i/20*Math.PI*2,c=(i+1)/20*Math.PI*2;b.tri('water',[POND.x,-.4+G(POND.x+POND.rx+2,POND.z),POND.z],[POND.x+Math.cos(c)*POND.rx,-.4+G(POND.x+POND.rx+2,POND.z),POND.z+Math.sin(c)*POND.rz],[POND.x+Math.cos(a)*POND.rx,-.4+G(POND.x+POND.rx+2,POND.z),POND.z+Math.sin(a)*POND.rz],'#4f8a8a');}
 // clubhouse with a terrace, carts and a car park
 {const y=G(186,-114);b.push(186,y,-114,Math.PI/2);house(b,{w:12,d:7,floors:1,fh:3.4,wallC:'#efe9dc',roof:'hip',roofC:'#3f5a4a',veranda:true,trim:'#3f5a4a',plinth:2,awning:'#3f5a4a'},r);b.pop();
  for(let i=0;i<4;i++){b.push(194+i*2.2,G(194+i*2.2,-111.5),-111.5,0);b.box('metal',0,.25,0,1.2,.6,2.2,'#f3f3ee');b.box('metal',0,.85,-.2,1.1,.06,1.6,'#f3f3ee');for(const x of [-.5,.5])b.box('metal',x,.85,.5,.05,1,.05,'#ccc');b.box('roof',0,1.85,-.1,1.3,.08,1.9,'#3f5a4a');b.pop();}
  for(let i=0;i<3;i++){b.push(176-i*3,G(176-i*3,-118),-118,0);car(b,pick(r,['#2f4f5f','#e8e2d2','#3a3a3a','#7a8a9a']));b.pop();}
  b.push(190,G(190,-121),-121,Math.PI);bench(b,'#3f5a4a');b.pop();}
 t.ribbon(b,[[160,-58],[172,-80],[180,-110],[184,-116]],3,'#a39a86','path',.1,2);
 // trees along the fairways
 for(let i=0;i<60;i++){const x=180+r()*78,z=-184+r()*74;if(HOLES.some(h=>{const [ax,az]=h.tee,[bx,bz]=h.green,dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L2));return Math.hypot(x-ax-dx*u,z-az-dz*u)<9;})||((x-POND.x)/(POND.rx+2))**2+((z-POND.z)/(POND.rz+2))**2<1||(x<200&&z>-122))continue;
  trees.add(x,G(x,z),z,.9+r()*.5,pick(r,['round','conifer','poplar','round'] as const),pick(r,['#5f8a46','#4f7a3c','#6f9a4e','#3f6a3c']),r()*6);}
 void footprint;
}
