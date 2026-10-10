import {drawDecoration,type DecorationSink} from '../decorative-motion.ts';
import {Builder,rng,pick,PLASTER,TIMBER} from './kit.ts';
import {house,aframe,lampPost,bench,boat,stall,fence,lightAt} from './buildings.ts';
import {WATER,type Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** Seaside resort (south-east, x 106..206, z 112..190) and the west lake
 * shore (x −104..−200): lakeside hamlet, boathouses and a campsite. */
export const RESORT_BOUNDS=[106,112,206,192] as const,LAKE_BOUNDS=[-204,-74,-102,60] as const,CAMP_BOUNDS=[-176,-136,-106,-74] as const;
export function resortPads(t:Terrain){t.pad(106,112,206,137,0,6);t.pad(-176,-136,-106,-62,0,6);}
const sail=(b:Builder,len:number,c:string)=>{b.cyl('metal',0,0,0,.06,len*1.3,5,'#e8e8e8',false);b.tri('cloth',[.1,len*.2,0],[.1,len*1.25,0],[len*.55,len*.22,0],c);b.tri('cloth',[-.1,len*.25,0],[-.1,len*1.05,0],[-len*.35,len*.26,0],'#f3f3ee');};
export function buildResort(b:Builder,t:Terrain,trees:Trees,motion?:DecorationSink){const r=rng(3101);
 // promenade along the shore (continues the boardwalk eastwards on land), palms/lamps
 t.ribbon(b,[[109,112],[109,128],[118,134],[206,134]],5,'#cfc2a0','path',.05,2);
 for(let x=122;x<204;x+=8){b.push(x,0,131.4,0);lampPost(b,3.6,'#2f4f5f');b.pop();trees.add(x+4,0,131.6,1,'poplar','#5f8a46',0);if((x/8|0)%2){b.push(x+2,0,136.4,Math.PI);bench(b,'#efe9dc');b.pop();}}
 // seafront hotels: tall white/pastel blocks with balconies on every floor
 let x=114;while(x<170){const w=10+r()*5,floors=4+Math.floor(r()*3),c=pick(r,['#f3eee2','#efe4cf','#f0d9a8','#cfe3e8','#f3d3c8','#e8f0d8']);
  const balconyLayout=Array.from({length:floors-1},(_,f)=>Array.from({length:Math.floor(w/3.3)},(_,i)=>({x:-w/2+1.7+i*3.3,floorY:(f+1)*3.1+.02,width:2.6,depth:1.2,index:(f+1)+':'+i}))).flat();
  b.push(x+w/2,0,121,0);house(b,{balconyLayout,furnishBalconies:true,w,d:10,floors,fh:3.1,wallC:c,roof:'flat',roofGarden:r()<.5,trim:pick(r,['#2f6f8f','#3d5a80','#c45a4a','#5a8a6a']),door:true,awning:pick(r,['#2f6f8f','#e05a3a','#f0c040'])},r);

  b.pop();x+=w+3;}
 // ferris wheel on the beach (axle 16 m), carousel, a striped beach café
 {const cx=184,cz=124,R=13,hub=16;b.push(cx,0,cz,0);
  for(const z of [-1.2,1.2]){drawDecoration(b,motion,{kind:'wheel',pivot:[cx,hub,cz]},b=>{for(let i=0;i<32;i++){const a=i/32*Math.PI*2,a2=(i+1)/32*Math.PI*2;b.quad('metal',[Math.cos(a)*R,hub+Math.sin(a)*R,z],[Math.cos(a2)*R,hub+Math.sin(a2)*R,z],[Math.cos(a2)*(R-.4),hub+Math.sin(a2)*(R-.4),z],[Math.cos(a)*(R-.4),hub+Math.sin(a)*(R-.4),z],'#f3f3ee');}
   for(let i=0;i<16;i++){const a=i/16*Math.PI*2;b.quad('metal',[Math.cos(a)*.3,hub+Math.sin(a)*.3,z],[Math.cos(a)*R,hub+Math.sin(a)*R,z],[Math.cos(a)*R+.12,hub+Math.sin(a)*R+.12,z],[Math.cos(a)*.3+.12,hub+Math.sin(a)*.3+.12,z],'#dfe3e6');}
  });
  b.quad('metal',[-.4,hub,z*1.6],[.4,hub,z*1.6],[6,0,z*2.6],[4.8,0,z*2.6],'#c43a2a');b.quad('metal',[-.4,hub,z*1.6],[.4,hub,z*1.6],[-4.8,0,z*2.6],[-6,0,z*2.6],'#c43a2a');}
  b.cyl('metal',0,hub-.4,-2,.5,.8,8,'#555',true);
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2,gx=Math.cos(a)*R,gy=hub+Math.sin(a)*R;drawDecoration(b,motion,{kind:'gondola',pivot:[cx+gx,gy,cz]},b=>{b.box('metal',gx,gy-1.9,0,1.4,1.4,1.6,pick(r,['#e05a3a','#3d8ab0','#f0c040','#5aa070','#e88aa0','#7a4a8a']));b.box('roof',gx,gy-.55,0,1.6,.15,1.8,'#f3f3ee');b.box('metal',gx,gy-.5,0,.06,.5,.06,'#999');});}
  b.box('timber',0,0,5,8,.4,4,'#a0764e');b.box('plaster',3,.4,5.5,2,2.4,2,'#f0c040');b.pop();}
 {const cx=164,cz=127;b.push(cx,0,cz,0);b.cyl('stone',0,0,0,6,.5,16,'#e8e2d2');b.cyl('timber',0,.5,0,5.6,.2,16,'#a0764e');b.cyl('plaster',0,.7,0,1.2,3.4,10,'#f3d3c8',false);
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2;b.cyl('metal',Math.cos(a)*4.3,.7,Math.sin(a)*4.3,.05,3.3,4,'#c9a440',false);b.push(Math.cos(a)*4.3,1.3+(i%2)*.4,Math.sin(a)*4.3,-a);b.box('plaster',0,0,0,.35,.6,1.1,pick(r,['#f3eee2','#d0a070','#5a3a2a','#e8c8c8']));b.box('plaster',0,.55,.45,.3,.45,.3,'#f3eee2');b.pop();}
  b.cyl('roof',0,4,0,6,.4,16,'#e05a3a',false);for(let i=0;i<16;i++){const a=i/16*Math.PI*2,a2=(i+1)/16*Math.PI*2;b.tri('roof',[Math.cos(a)*6.2,4.4,Math.sin(a)*6.2],[Math.cos(a2)*6.2,4.4,Math.sin(a2)*6.2],[0,6.8,0],i%2?'#e05a3a':'#f3eee2');}
  b.cyl('metal',0,6.8,0,.05,.9,4,'#c9a440',false);b.pop();}
 for(let i=0;i<3;i++){b.push(130+i*12,0,129,Math.PI);stall(b,3.2,pick(r,['#3d8ab0','#e05a3a','#f0c040']),'#ffffff',r);b.pop();}
 // café terrace with umbrellas between hotels and promenade
 for(let i=0;i<10;i++){const ux=120+i*5.5,uz=127.2;b.box('timber',ux,.72,uz,.9,.05,.9,'#efe9dc');b.box('metal',ux,0,uz,.06,.72,.06,'#555');for(const s of [-1,1])b.box('timber',ux+s*.7,.45,uz,.4,.05,.4,'#6e4a30');
  b.cyl('metal',ux,.72,uz,.03,1.6,4,'#ddd',false);b.cone('cloth',ux,2.1,uz,1.3,.5,8,i%2?'#2f6f8f':'#f3eee2');}
 // marina: pontoons and sailboats east of the lighthouse
 for(let k=0;k<3;k++){const px=120+k*16;b.box('timber',px,.15,152,2,.2,30,'#b08a5f');for(let z=140;z<166;z+=5)for(const s of [-1,1]){if(r()<.2)continue;b.push(px+s*3.2,WATER.bay-.1,z,Math.PI/2);drawDecoration(b,motion,{kind:'moored-boat',pivot:[px+s*3.2,WATER.bay-.1,z],phase:px*.17+z},b=>{boat(b,5+r()*2,pick(r,['#f3f3ee','#e8e2d2','#2f4f5f','#3d5a80']),r,false);b.push(.3,.55,0,0);sail(b,4+r()*1.5,pick(r,['#f3f3ee','#e05a3a','#3d8ab0','#f0c040']));b.pop();});b.pop();}}
 b.box('timber',136,.15,138.5,36,.2,2,'#b08a5f');
 void PLASTER;void TIMBER;void fence;
}
export function buildLakeShore(b:Builder,t:Terrain,trees:Trees){const r=rng(3201),G=(x:number,z:number)=>t.height(x,z),L=WATER.lake;
 // shoreline loop path (follows the lake at ~ −1.4 m contour), cabins and boathouses on the north and south shores
 const ring:[number,number][]=[];for(let i=0;i<=36;i++){const a=i/36*Math.PI*2;const x=-148+Math.cos(a)*51,z=2+Math.sin(a)*49;if(x>-104)continue;ring.push([x,z]);}
 // split the ring where it would cross the existing edge; draw two arcs (north and south)
 const north=ring.filter(([,z])=>z<0).sort((p,q)=>p[0]-q[0]),south=ring.filter(([,z])=>z>=0).sort((p,q)=>p[0]-q[0]);
 for(const arc of [north,south])if(arc.length>1)t.ribbon(b,arc,2.2,'#c2b79c','path',.08,1.5);
 t.ribbon(b,[[-100,-69.5],[-110,-60],[-118,-49]],2.4,'#c2b79c','path',.08);
 // boathouses on stilts at the waterline + rowing boats
 for(const [x,z,yaw] of [[-128,-38,Math.PI*.82],[-168,-40,Math.PI*1.2],[-190,-6,Math.PI*1.5],[-160,44,0],[-124,40,-.4]] as [number,number,number][]){const rr=rng(Math.round(x*7+z));
  b.push(x,L+.6,z,yaw);for(const sx of [-2,2])for(const sz of [-3,0,3])b.box('timber',sx,-2.2,sz,.25,2.4,.25,'#5b4030');b.box('timber',0,0,0,5,.2,8,'#8a6a4a');
  b.box('timber',0,.2,-1,4.6,2.6,5.6,pick(rr,['#7a2f2a','#2f4f5f','#5a6a3a','#8a5a36']));b.gable('roof',0,2.8,-1,4.6,5.6,1.6,pick(rr,['#3f4448','#5a5f66']),'timber','#efe9dc',.3);b.panel('timber',0,1.4,1.82,2.6,2.2,'#efe9dc');
  b.push(0,-.6,6,0);boat(b,4,pick(rr,['#e05a3a','#3d8ab0','#efe9dc']),rr,false);b.pop();b.pop();}
 // lakeside hamlet on the north shore: cabins, an inn with a deck, a sauna by the water
 const lots:[number,number][]=[[-120,-58],[-156,-58],[-168,-55],[-180,-50],[-192,-40],[-198,-26]];
 lots.forEach(([x,z],i)=>{const rr=rng(3300+i*31),y=G(x,z),yaw=Math.atan2(-148-x,2-z);b.push(x,y,z,yaw);
  if(i%3===1)aframe(b,6,7,6.2,rr);else house(b,{w:6.5+rr()*2,d:5.5+rr()*1.5,floors:1,plinth:2.5,wall:'timber',wallC:pick(rr,['#7a2f2a','#5a6a3a','#2f4f5f','#8a5a36','#b08a5f','#d9a85e']),roof:pick(rr,['gable','shed'] as const),roofC:pick(rr,['#3f4448','#2f2f2f','#5a6a3a']),veranda:rr()<.6,chimney:rr()<.6,trim:'#efe9dc'},rr);
  b.pop();});
 {const x=-140,z=-52,y=G(x,z),yaw=Math.atan2(-148-x,2-z);b.push(x,y,z,yaw);house(b,{w:16,d:9,floors:2,plinth:2.5,wall:'timber',wallC:'#efe4cf',roof:'gable',roofC:'#3f4448',veranda:true,balcony:true,chimney:true,dormer:true,trim:'#2f4f5f',awning:'#2f4f5f'},r);
  b.box('timber',0,-.1,9.5,16,.25,5,'#a0764e');for(let i=0;i<4;i++){const ux=-6+i*4;b.box('timber',ux,.15,9.5,1,.06,1,'#efe9dc');b.box('metal',ux,.15,9.5,.05,.7,.05,'#555');b.cyl('metal',ux,.85,9.5,.03,1.4,4,'#ddd',false);b.cone('cloth',ux,2.1,9.5,1.2,.45,8,'#efe9dc');}b.pop();}
 // swimming platform + a diving board out in the lake
 b.box('timber',-150,L+.1,-18,5,.3,5,'#b08a5f');for(const sx of [-2,2])for(const sz of [-2,2])b.box('metal',-150+sx,L-1.5,-18+sz,.1,1.7,.1,'#666');b.box('timber',-150,L+.6,-15.5,.6,.08,2.4,'#efe9dc');
 // lakeside trees and reeds
 for(let i=0;i<90;i++){const a=r()*Math.PI*2,rad=55+r()*22,x=-148+Math.cos(a)*rad,z=2+Math.sin(a)*rad*.95;if(x>-110||lots.some(([lx,lz])=>Math.hypot(lx-x,lz-z)<7)||Math.hypot(x+140,z+52)<12)continue;const y=G(x,z);if(y<L+.3)continue;
  trees.add(x,y,z,.9+r()*.6,pick(r,['round','conifer','poplar','round'] as const),pick(r,['#5f8a46','#4f7a3c','#6f9a4e','#3f6a3c']),r()*6);}
 for(let i=0;i<60;i++){const a=r()*Math.PI*2,x=-148+Math.cos(a)*44.5,z=2+Math.sin(a)*42.5;if(x>-104)continue;for(let k=0;k<4;k++)b.box('foliage',x+(r()-.5)*1.5,L-.3,z+(r()-.5)*1.5,.07,1+r()*.7,.07,'#6f8a3c');}
 void bench;void lampPost;void stall;
}
export function buildCampsite(b:Builder,t:Terrain,trees:Trees){const r=rng(3401),G=(x:number,z:number)=>t.height(x,z);
 const cx=-140,cz=-100;
 // fire circle with log benches
 b.cyl('stone',cx,0,cz,1.2,.3,10,'#7c766c');b.cyl('soil',cx,.05,cz,.9,.3,8,'#3a3028');lightAt(b,'fire',cx,0,cz,.8);for(let i=0;i<5;i++){const a=i/5*Math.PI*2;b.push(cx,0,cz,a);b.box('timber',0,.15,.15,1.1,.25,.12,'#5b4030');b.pop();}
 for(let i=0;i<6;i++){const a=i/6*Math.PI*2+.3;b.push(cx+Math.cos(a)*4,0,cz+Math.sin(a)*4,-a+Math.PI/2);b.pushRot('z',Math.PI/2);b.cyl('bark',0,-1.1,0,.28,2.2,7,'#6e4a30');b.pop();b.pop();}
 // tents: ridge tents and bell tents around the circle
 for(let i=0;i<10;i++){const a=i/10*Math.PI*2,rad=12+(i%2)*5,x=cx+Math.cos(a)*rad,z=cz+Math.sin(a)*rad,c=pick(r,['#e05a3a','#f0c040','#3d8ab0','#5aa070','#e8e2d2','#7a4a8a','#d98a3a']),yaw=Math.atan2(cx-x,cz-z);
  b.push(x,G(x,z),z,yaw);if(i%3===0){b.cyl('cloth',0,0,0,2,1.2,10,c,false);b.cone('cloth',0,1.2,0,2.05,1.6,10,c);}
  else{b.push(0,0,0,Math.PI/2);b.gable('cloth',0,0,0,3.2,2.4,1.5,c,'cloth',c,.05);b.pop();b.tri('cloth',[-.5,0,1.62],[.5,0,1.62],[0,1.1,1.62],'#3a3028');}
  b.pop();}
 // log cabins and a lodge with a stone chimney
 for(const [x,z,w] of [[-162,-86,7],[-162,-112,7],[-118,-122,8]] as [number,number,number][]){const rr=rng(Math.round(x*3-z));b.push(x,G(x,z),z,Math.atan2(cx-x,cz-z));house(b,{w,d:6,floors:1,wall:'timber',wallC:'#6e4a30',roof:'gable',roofC:'#3f4a3a',veranda:true,chimney:true,trim:'#d8c9a8',plinth:2},rr);b.pop();}
 b.push(-122,0,-82,Math.PI*.85);house(b,{w:14,d:9,floors:2,wall:'timber',wallC:'#8a5a36',roof:'gable',roofH:4.5,roofC:'#3f4a3a',veranda:true,balcony:true,chimney:true,trim:'#efe4cf'},r);b.pop();
 // picnic tables + firewood stack
 for(let i=0;i<4;i++){const x=cx-6+i*4,z=cz+20;b.box('timber',x,.72,z,1.8,.06,.8,'#8a5a36');for(const s of [-1,1])b.box('timber',x,.42,z+s*.65,1.8,.05,.28,'#8a5a36');}
 for(let k=0;k<12;k++){b.push(-150,0,-90,0);b.pushRot('x',Math.PI/2);b.cyl('bark',-1+(k%4)*.5,-.8,-.3-Math.floor(k/4)*.45,.22,1.6,6,'#7a5a3a');b.pop();b.pop();}
 for(let i=0;i<70;i++){const x=-176+r()*70,z=-136+r()*60;if(Math.hypot(x-cx,z-cz)<20||Math.hypot(x+122,z+82)<10)continue;trees.add(x,G(x,z),z,1+r()*.6,r()<.75?'conifer':'round',pick(r,['#3f6a3c','#4a7a44','#365e38','#5f8a46']),r()*6);}
 t.ribbon(b,[[-100,-69.5],[-122,-76],[cx,cz+8]],2.4,'#b6a582','path',.06);
}
export const RESORT_EXPLORE=[{id:'seaside-resort',camera:[140,10,140],target:[176,8,124]},{id:'lake-shore',camera:[-104,8,-30],target:[-150,0,-30]},{id:'campsite',camera:[-124,8,-90],target:[-142,1,-102]}];
