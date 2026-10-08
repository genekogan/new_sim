import {Builder,rng,pick} from './kit.ts';
import {house,lampPost,bench,boat,footprint,stairs} from './buildings.ts';
import {WATER,type Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** A whitewashed cliff village on the eastern coast (x 254..304, z 88..132): cube houses with blue
 * doors and shutters stepping down the slope to the sea, a blue-domed chapel, two round windmills,
 * bougainvillea, and a tiny harbour with a breakwater below. */
export const CLIFF_BOUNDS=[252,84,306,160] as const;
type Lot={x:number;z:number;w:number;d:number;y:number};
let lots:Lot[]=[];
const CHAPEL={x:279,z:104},MILLS:[number,number][]=[[296,92],[262,90]];
export function cliffPads(t:Terrain){lots=[];const r=rng(9401);
 t.pad(CHAPEL.x-6,CHAPEL.z-6,CHAPEL.x+6,CHAPEL.z+6,undefined,3);for(const [x,z] of MILLS)t.pad(x-3.5,z-3.5,x+3.5,z+3.5,undefined,3);t.pad(262,127,300,133.5,.4,2);
 t.cuts.push((x,z)=>{if(x<250||x>316||z<132)return 0;const sm=(a:number,b:number,v:number)=>{const q=Math.max(0,Math.min(1,(v-a)/(b-a)));return q*q*(3-2*q);};return -2*sm(132,136,z)*sm(250,258,x)*(1-sm(308,316,x));});
 for(let gx=256;gx<304;gx+=7)for(let gz=94;gz<128;gz+=6.5){const x=gx+(r()-.5)*2,z=gz+(r()-.5)*1.6;if(Math.hypot(x-CHAPEL.x,z-CHAPEL.z)<10||MILLS.some(([mx,mz])=>Math.hypot(x-mx,z-mz)<7)||r()<.15)continue;
  const w=4.5+r()*2,d=4+r()*1.5,y=Math.max(.6,Math.round(t.natural(x,z)*2)/2);lots.push({x,z,w,d,y});t.pad(x-w/2-.6,z-d/2-.6,x+w/2+.6,z+d/2+2.6,y,2.5);}}
const BLUE=['#1f5fa8','#2a6fb8','#16508f','#3d8ab0'],WHITE=['#f6f4ee','#f2efe6','#faf8f2','#efe9dc'];
export function buildCliffVillage(b:Builder,t:Terrain,trees:Trees){const r=rng(9501),G=(x:number,z:number)=>t.height(x,z);
 for(const l of lots){const rr=rng(Math.round(l.x*13+l.z*7));b.push(l.x,l.y,l.z,0);
  const floors=rr()<.35?2:1;house(b,{w:l.w,d:l.d,floors,fh:2.7,wallC:pick(rr,WHITE),roof:'flat',flatC:'#f2efe6',trim:pick(rr,BLUE),shutters:true,plinth:4,roofGarden:rr()<.25,flowerbox:rr()<.4},rr);
  const H=floors*2.7;if(rr()<.18){b.dome('roof',0,H+.35,0,Math.min(l.w,l.d)*.32,10,3,pick(rr,BLUE));}
  // terrace wall and outside stair, bougainvillea on a corner
  b.box('plaster',0,-.1,l.d/2+1,l.w+.4,.5,2,pick(rr,WHITE));b.box('plaster',0,.4,l.d/2+1.95,l.w+.4,.5,.12,pick(rr,WHITE));
  if(rr()<.6)b.box('flower',l.w/2-.2,.3,l.d/2+.1,.8,1.8+rr(),.5,pick(rr,['#c2287a','#d63a8a','#e0508a','#b8306a']));
  b.pop();}
 // lanes: stepped white paths running downhill between the lots
 for(const x of [266,282,298])t.ribbon(b,[[x,92],[x,128]],1.8,'#e8e2d4','path',.12,1.2);
 t.ribbon(b,[[244,128],[262,129],[302,129]],3,'#d8d0bc','path',.08,2);
 // chapel: white nave, blue dome on a drum, bell gable
 {const y=G(CHAPEL.x,CHAPEL.z);b.push(CHAPEL.x,y,CHAPEL.z,0);footprint(b,6,9,'chapel');b.box('stone',0,-2.5,0,6.6,2.8,9.6,'#d8d2c4');b.box('plaster',0,.3,0,6,4.2,9,'#faf8f2');b.box('plaster',0,4.5,0,6.2,.3,9.2,'#f2efe6');
  b.cyl('plaster',0,4.8,0,2.2,1.2,12,'#faf8f2',false);b.dome('roof',0,6,0,2.3,12,4,'#1f5fa8');b.cyl('metal',0,8.3,0,.05,.9,4,'#e8e2d2',false);b.box('metal',0,8.9,0,.5,.06,.06,'#e8e2d2');
  b.box('plaster',0,4.5,4.4,2.6,2.4,.4,'#faf8f2');b.panel('dressing',0,5.4,4.62,.6,.8,'#2a2a2a');b.panel('timber',0,1.5,4.53,1.3,2.4,'#1f5fa8');b.pop();}
 // round windmills with thatch caps and white sails
 for(const [x,z] of MILLS){const y=G(x,z);b.push(x,y,z,.4);footprint(b,4.4,4.4,'windmill');b.cyl('stone',0,-2,0,2.3,2.2,12,'#d8d2c4');b.cyl('plaster',0,0,0,2.1,6.5,12,'#faf8f2',false,1.9);b.cone('roof',0,6.5,0,2.2,2,12,'#8a6a42');
  b.push(0,5.6,2.15,0);for(let k=0;k<6;k++){const a=k*Math.PI/3+.2;b.quad('cloth',[0,0,.05],[Math.cos(a)*.4,Math.sin(a)*.4,.05],[Math.cos(a+.2)*4.4,Math.sin(a+.2)*4.4,.05],[Math.cos(a)*4.6,Math.sin(a)*4.6,.05],'#f6f4ee');b.quad('timber',[0,0,0],[Math.cos(a)*4.6,Math.sin(a)*4.6,0],[Math.cos(a)*4.6,Math.sin(a)*4.6+.08,0],[0,.08,0],'#6e4a30');}b.pop();
  b.panel('timber',0,1.2,2.13,1,2,'#1f5fa8');b.pop();}
 // harbour: quay, breakwater, fishing boats, café tables on the quay
 b.box('stone',281,-1.4,133,40,1.9,4,'#cfc8b6');
 for(let i=0;i<6;i++){b.push(268+i*5.5,WATER.bay-.1,139+r()*3,Math.PI/2+(r()-.5)*.3);boat(b,4.5+r()*1.5,pick(r,['#1f5fa8','#f6f4ee','#e05a3a','#f0c040','#3d8ab0']),r,r()<.3);b.pop();}
 for(let i=0;i<5;i++){const x=266+i*7,z=131.6;b.box('timber',x,.4+.72,z,.8,.05,.8,'#f6f4ee');b.box('metal',x,.4,z,.05,.72,.05,'#2a2a2a');for(const s of [-1,1])b.box('timber',x+s*.65,.4+.45,z,.4,.05,.4,'#1f5fa8');b.cyl('metal',x,.4+.77,z,.03,1.5,4,'#ddd',false);b.cone('cloth',x,.4+2.1,z,1.2,.4,8,i%2?'#1f5fa8':'#f6f4ee');}
 for(const x of [262,286,300]){b.push(x,.4,129.8,0);lampPost(b,3.2,'#1f5fa8');b.pop();}
 b.push(274,.4,130.8,Math.PI);bench(b,'#1f5fa8');b.pop();
 b.push(266,G(266,126.5),126.5,Math.PI);stairs(b,1.8,2,0,.5,'#e8e2d4');b.pop();
 // olive and cypress among the houses
 for(let i=0;i<26;i++){const x=254+r()*50,z=86+r()*42;if(lots.some(l=>Math.abs(l.x-x)<l.w/2+2.4&&Math.abs(l.z-z)<l.d/2+3.2)||Math.hypot(x-CHAPEL.x,z-CHAPEL.z)<8||MILLS.some(([mx,mz])=>Math.hypot(x-mx,z-mz)<6)||[266,282,298].some(px=>Math.abs(px-x)<2))continue;
  trees.add(x,G(x,z),z,.7+r()*.3,r()<.5?'cypress':'round',r()<.5?'#3f6a3c':'#7d8f55',r()*6);}
}
