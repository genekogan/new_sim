import * as THREE from 'three';
import {Builder,rng,pick,PLASTER,ROOFS,TIMBER} from './kit.ts';
import {house,lampPost,bench,boat,stall,tower,fence,stairs} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** Canal quarter + old-town plaza + market street, east of the current edge (x 106..170, z -40..112).
 * Canal water x 132.5..140.5 (quay walls 132..133.2 / 139.8..141), z -31..51. */
export const CANAL={x0:132,x1:141,z0:-35,z1:55,water:-.7};
export const CANAL_BOUNDS=[106,-42,172,112] as const;
export function canalPads(t:Terrain){
 // Quarter is level at Y0: one broad pad so the edge undulation never reaches the streets.
 t.pad(105,-40,170,58,0,8);t.pad(105,58,172,112,0,8);
}
export function buildCanalQuarter(b:Builder,t:Terrain,trees:Trees){
 const r=rng(9101),G=(x:number,z:number)=>t.height(x,z);
 const cobble='#a49c8c',quay='#b3ab98',road='#9d9584';
 // ---- streets: promenade (x109), quays, cross streets, link stubs to the existing east edge
 t.ribbon(b,[[109,-40],[109,112]],5,road,'path',.04);
 t.ribbon(b,[[101.5,4],[109,4]],2.5,'#b6b09b');t.ribbon(b,[[102.6,68],[105,69],[109,72]],2,'#b6b09b');
 for(const z of [2,29])t.ribbon(b,[[111.6,z],[132,z]],3.4,cobble,'path',.055);
 for(const z of [2,29])t.ribbon(b,[[141,z],[158.4,z]],3.4,cobble,'path',.055);
 t.ribbon(b,[[129,-33],[129,57]],5.6,quay,'path',.035);t.ribbon(b,[[144,-33],[144,57]],5.6,quay,'path',.035);
 t.ribbon(b,[[160,-38],[160,58]],3,road,'path',.045);t.ribbon(b,[[116,-36],[116,56]],2.4,'#b6b09b','path',.045);
 // ---- canal: walls, water, bridges, moored boats
 const {x0,x1,z0,z1,water}=CANAL,st='#8f877a';
 b.box('stone',x0+.6,-2,(z0+z1)/2,1.2,2.25,z1-z0,st);b.box('stone',x1-.6,-2,(z0+z1)/2,1.2,2.25,z1-z0,st);
 b.box('stone',(x0+x1)/2,-2,z0+1.25,x1-x0,2.25,2.5,st);b.box('stone',(x0+x1)/2,-2,z1-1.25,x1-x0,2.25,2.5,st);
 for(const x of [x0+1.2,x1-1.2])b.box('stone',x,.12,(z0+z1)/2,.3,.18,z1-z0-5,'#c4b9a2');
 b.quad('water',[x0+1.2,water,z0+2.5],[x0+1.2,water,z1-2.5],[x1-1.2,water,z1-2.5],[x1-1.2,water,z0+2.5],'#4f7f8f');
 for(const z of [2,29]){// low arched bridge
  const seg=6,w=3.4,span=[x0-.5,x1+.5];for(let i=0;i<seg;i++){const a=i/seg,c=(i+1)/seg,xa=span[0]+(span[1]-span[0])*a,xc=span[0]+(span[1]-span[0])*c,ya=.25+Math.sin(a*Math.PI)*1.0,yc=.25+Math.sin(c*Math.PI)*1.0;
   b.quad('stone',[xa,ya,z-w/2],[xa,ya,z+w/2],[xc,yc,z+w/2],[xc,yc,z-w/2],'#b9b0a0');for(const s of [-1,1]){b.quad('stone',[xa,ya-.5,z+s*w/2],[xc,yc-.5,z+s*w/2],[xc,yc+.55,z+s*w/2],[xa,ya+.55,z+s*w/2],'#a59d8e');}}
  b.quad('stone',[x0+1.2,-.8,z-w/2],[x1-1.2,-.8,z-w/2],[x1-1.2,.4,z-w/2],[x0+1.2,.4,z-w/2],'#8f877a');b.quad('stone',[x0+1.2,-.8,z+w/2],[x1-1.2,-.8,z+w/2],[x1-1.2,.4,z+w/2],[x0+1.2,.4,z+w/2],'#8f877a');}
 const boatC=['#2f4f5f','#7a2f2a','#355e3b','#d9a441','#e8e2d2','#3d5a80','#8a5a36'];
 for(const [z,side,len,cab] of [[-24,1,6,true],[-12,-1,5,false],[9,1,7,true],[18,-1,4.5,false],[38,1,5.5,false],[45,-1,7.5,true],[-4,-1,4,false]] as [number,number,number,boolean][]){
  b.push(side>0?x0+2.4:x1-2.4,water-.15,z,Math.PI/2+(r()-.5)*.08);boat(b,len,pick(r,boatC),r,cab);b.pop();}
 // ---- row houses lining both quays (fronts face the canal)
 const row=(x:number,yaw:number,za:number,zb:number,seed:number)=>{const rr=rng(seed);let z=za;while(z<zb){let w=4.2+rr()*2.2;if(z+w>zb)w=zb-z;if(w<3.6)break;
   const floors=2+Math.floor(rr()*3),d=8+rr()*1.2,roof=pick(rr,['stepped','stepped','gable','gable','hip','flat'] as const);
   b.push(x,0,z+w/2,yaw);b.push(0,0,-d/2,0);house(b,{w:w-.04,d,floors,roof,roofH:2.6+rr()*1.4,shutters:rr()<.3,flowerbox:rr()<.5,balcony:rr()<.25,band:rr()<.5,awning:floors>2&&rr()<.3?pick(rr,['#c45a4a','#2f6f5f','#e0b04a','#3d5a80']):undefined,
    wall:rr()<.18?'stone':'plaster',wallC:pick(rr,[...PLASTER,'#8a4a36','#7a4536','#a0563f','#5f6b73','#2f4f5f']),roofC:pick(rr,ROOFS),roofGarden:roof==='flat'&&rr()<.7,chimney:rr()<.4},rr);b.pop();b.pop();z+=w;}};
 for(const [a,c] of [[-30,0],[4,27],[31,53]] as [number,number][]){row(125.5,Math.PI/2,a,c,7+a);row(147.5,-Math.PI/2,a,c,77+a);}
 // second ring behind each row: lower houses with yards and a back lane
 for(const [a,c] of [[-36,-6],[8,24],[34,56]] as [number,number][]){let z=a;const rr=rng(500+a);while(z<c){const w=6+rr()*3;if(z+w>c)break;
   // West of the canal: allotment gardens (low beds, a tool shed per plot) instead of a second house ring.
   for(let k=0;k<3;k++)b.box('soil',113.7,0,z+1.2+k*(w-1.6)/3,4,.22,(w-1.6)/3-.5,'#6a5038');
   for(let k=0;k<3;k++)for(let j=0;j<4;j++)b.box('foliage',112.3+j*.9,.22,z+1.2+k*(w-1.6)/3,.5,.25+rr()*.35,(w-1.6)/3-.9,pick(rr,['#5f8a46','#7fae4a','#6f9a4e','#9ab04a']));
   rr();
   fence(b,[[111.6,z+.2],[111.6,z+w-.2]],.9,'#cfc6b4',G);
   b.push(165,0,z+w/2,-Math.PI/2);b.push(0,0,-4,0);house(b,{w:w-.6,d:7,floors:1+Math.floor(rr()*2),roof:pick(rr,['gable','hip','shed'] as const),dormer:rr()<.4,balcony:rr()<.3},rr);b.pop();b.pop();
   if(rr()<.7)trees.add(119+rr()*3,0,z+w/2,.8+rr()*.4,pick(rr,['fruit','round'] as const),pick(rr,['#6f9a4e','#7fa84f','#5f8a46']),rr()*6);
   if(rr()<.7)trees.add(153+rr()*3,0,z+w/2,.8+rr()*.4,pick(rr,['fruit','round','cypress'] as const),pick(rr,['#6f9a4e','#5f8a46','#4f7a3c']),rr()*6);
   z+=w;}}
 // garden fences at the back of the canal rows
 quayClutter(b,r);
 for(const x of [120.5,152.5])for(const [a,c] of [[-30,0],[4,27],[31,53]] as [number,number][])fence(b,[[x,a],[x,c]],1.0,'#e8e2d2',G);
 // ---- quay furniture: lamps, benches, trees, bollards
 for(let z=-28;z<=52;z+=7.5){if(Math.abs(z-2)<3||Math.abs(z-29)<3)continue;for(const [x,_yaw] of [[131.3,-Math.PI/2],[141.7,Math.PI/2]] as [number,number][]){b.push(x,0,z,0);lampPost(b);b.pop();}
  trees.add(127.3,0,z+3.7,.85,'round',pick(r,['#6f9a4e','#5f8a46','#7fa84f']),r()*6);trees.add(145.7,0,z+3.7,.85,'round',pick(r,['#6f9a4e','#5f8a46','#7fa84f']),r()*6);
  b.push(130.8,0,z+2,Math.PI/2);bench(b);b.pop();b.push(142.2,0,z+2,-Math.PI/2);bench(b);b.pop();
  for(const x of [132.4,140.6])b.cyl('metal',x,0,z-2,.12,.6,6,'#2f3436');}
}
export function buildOldTown(b:Builder,t:Terrain,trees:Trees){
 const r=rng(9102),cobble='#a49c8c';
 // ---- canal-head plaza (north end) with a bell tower, and old-town plaza south of the canal
 const pz=[119,62,159,84];t.ribbon(b,[[pz[0],73],[pz[2],73]],pz[3]-pz[1],cobble,'path',.03,2);
 for(let x=pz[0]+2;x<pz[2];x+=4)t.ribbon(b,[[x,pz[1]+.5],[x,pz[3]-.5]],.18,'#8f877a','path',.045,4);
 // fountain
 b.cyl('stone',139,0,73,3.2,.6,16,'#c4b9a2');b.disc('water',139,.63,73,2.9,16,'#5f93a3');b.cyl('stone',139,.5,73,.45,1.6,8,'#b9b0a0');b.cyl('stone',139,2.1,73,1.1,.25,10,'#c4b9a2');b.cyl('stone',139,2.35,73,.18,.8,6,'#b9b0a0');
 // arcades on the plaza's north and south sides
 const arcade=(x0:number,x1:number,z:number,face:number,seed:number)=>{const rr=rng(seed);const bays=Math.round((x1-x0)/3.6),bw=(x1-x0)/bays,d=4,wc=pick(rr,['#e6c86e','#e9b07a','#d9a85e','#efe9dc']),rc=pick(rr,ROOFS);
  b.push(0,0,z,face>0?0:Math.PI);const xm=(x0+x1)/2*(face>0?1:-1);
  b.box('stone',xm,-.8,0,x1-x0,.95,d*2+.6,'#bdb3a0');
  for(let i=0;i<=bays;i++){const x=xm-(x1-x0)/2+i*bw;b.box('stone',x,0,d/2+d*0.5,.55,3.4,.55,'#e8e2d2');}
  b.box('plaster',xm,3.4,d,x1-x0,.9,.5,wc);b.box('plaster',xm,0,0,x1-x0,7.2,d*.5+.4,wc);b.box('plaster',xm,4.3,d*.75,x1-x0,2.9,d*.5,wc);
  for(let i=0;i<bays;i++){const x=xm-(x1-x0)/2+(i+.5)*bw;b.panel('glass',x,5.6,d+.03,.9,1.3,'#2d3c46');b.panel('timber',x,1.6,.62,1.8,2.6,pick(rr,['#5b3a29','#2f4f5f','#7a2f2a']));
   b.quad('stone',[x-bw/2+.28,3.4,d+.26],[x+bw/2-.28,3.4,d+.26],[x+bw/2-.28,2.85,d+.26],[x-bw/2+.28,2.85,d+.26],'#e8e2d2');}
  b.box('timber',xm,3.3,d*.75,x1-x0,.1,d*.5+.6,'#cfc6b4');
  // rear facade (faces away from the plaza): windows on both floors and a few back doors
  {const zr=-(d*.5+.4)/2-.03;for(let i=0;i<bays;i++){const x=xm-(x1-x0)/2+(i+.5)*bw;b.panel('glass',x,5.6,zr,.9,1.3,rr()<.5?'#2d3c46':'#3b4a52',-1);if(i%3===1)b.panel('timber',x,1.4,zr,1.1,2.2,'#5b3a29',-1);else b.panel('glass',x,1.8,zr,1.2,1.4,rr()<.5?'#2d3c46':'#3b4a52',-1);}}
  b.push(xm,7.2,d*.5,0);b.gable('roof',0,0,0,x1-x0,d*1.5,2,rc,'plaster',wc,.4);b.pop();
  b.pop();};
 arcade(120,158,56.5,1,31);arcade(120,158,89.5,-1,32);
 // domed hall on the plaza's east end, bell tower at its west end
 b.push(166,0,73,-Math.PI/2);b.box('stone',0,-1,0,13,1.4,15,'#bdb3a0');b.box('plaster',0,.4,0,11,8,13,'#efe9dc');b.cyl('plaster',0,8.4,0,4.6,2.2,14,'#efe9dc',false);b.dome('roof',0,10.6,0,4.8,14,4,'#5f8a7a');b.cyl('metal',0,15.3,0,.08,1.6,4,'#c9a440',false);
  for(const x of [-3.2,0,3.2])b.panel('glass',x,4.6,6.53,1.1,3,'#2d3c46');b.panel('timber',0,1.9,6.53,2,3,'#5b3a29');b.box('stone',0,.4,7.6,12,7.4,.5,'#e8e2d2');b.box('stone',0,0,9.2,8,.4,3,'#c4b9a2');
  for(const x of [-4.5,-1.5,1.5,4.5])b.cyl('stone',x,.4,8.7,.38,6.6,8,'#efe9dc');b.box('stone',0,7,8.7,11,.8,1.4,'#e8e2d2');b.push(0,7.8,8.7,0);b.gable('roof',0,0,0,11.2,1.4,1.3,'#5f8a7a','stone','#e8e2d2',.1);b.pop();b.pop();
 b.push(114,0,73,0);tower(b,2.2,16,'cone','#d9a85e','#5a5f66',r,'plaster');b.pop();
 // plaza life: benches, planters, market umbrellas, trees in tubs
 for(const [x,z] of [[125,66],[125,80],[153,66],[153,80]] as [number,number][]){b.cyl('stone',x,0,z,1.1,.7,8,'#bdb3a0');trees.add(x,.55,z,.9,'round','#6f9a4e',r()*6);}
 for(const [x,z,yaw] of [[133,68,0],[145,68,0],[133,78,Math.PI],[145,78,Math.PI]] as [number,number,number][]){b.push(x,0,z,yaw);bench(b);b.pop();}
 for(const [x,z] of [[127,73],[151,73],[139,64.5],[139,81.5]] as [number,number][]){b.push(x,0,z,0);lampPost(b,3.8);b.pop();}
 // ---- market street south of the arcade (z 96..110): stalls one side, shops the other
 t.ribbon(b,[[111.6,97],[170,97]],6,cobble,'path',.05,2);
 for(let x=114,i=0;x<166;x+=4.4,i++){b.push(x,0,93.6,Math.PI);stall(b,3.4,pick(r,['#c45a4a','#2f6f5f','#e0b04a','#3d5a80','#7a4a8a']),'#f3eee2',r);b.pop();}
 {let x=110;const rr=rng(77);while(x<168){const w=5+rr()*3;b.push(x+w/2,0,105.5,Math.PI);house(b,{w:w-.3,d:8,floors:2+Math.floor(rr()*2),roof:pick(rr,['gable','hip','flat','cross'] as const),awning:pick(rr,['#c45a4a','#2f6f5f','#e0b04a','#3d5a80','#b8473a','#6a8a3a']),shutters:rr()<.4,balcony:false,flowerbox:true,roofGarden:rr()<.5},rr);b.pop();
  b.box('timber',x+w/2,3.3,101.35,Math.min(w-1.2,3.4),.55,.08,pick(rr,['#2f4f5f','#7a2f2a','#355e3b','#3d3a35','#c9a440']));b.box('dressing',x+w/2,3.45,101.3,Math.min(w-1.2,3.4)*.7,.18,.02,'#f3eee2');x+=w;}}
 for(let x=116;x<168;x+=11){b.push(x,0,99.6,0);lampPost(b);b.pop();}
 // steps from the plaza down to the canal head
 b.push(136.5,-1.6,57,Math.PI);stairs(b,3,2.2,-.1,1.6,'#b9b0a0');b.pop();
 // (quay barrels/crates)
}
function quayClutter(b:Builder,r:()=>number){
 for(let i=0;i<14;i++){const x=r()<.5?126.6:146.4,z=-30+r()*82;if(Math.abs(z-2)<3||Math.abs(z-29)<3)continue;if(r()<.5){b.cyl('timber',x,0,z,.32,.8,7,'#7a5a3a');}else b.box('timber',x,0,z,.7,.55,.7,pick(r,TIMBER));}
 }
export const CANAL_EXPLORE=[{id:'canal-quarter',camera:[118,12,-36],target:[137,1,8]},{id:'old-town-plaza',camera:[124,9,64],target:[150,3,77]},{id:'market-street',camera:[106,5,94],target:[135,2,100]}];
export {THREE};
