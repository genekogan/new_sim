import {Builder,rng,pick,ROOFS,STONE,type Col} from './kit.ts';
import {house,lampPost,bench,tower,fence,lowWall} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** West (x −104..−200, z 52..136): an abbey on a knoll with a cloister and a
 * walled garden, and a Mediterranean courtyard-house quarter. North-east
 * (x 114..176, z −64..−124): a makers' yard with workshops, containers, a
 * water tower and market-garden greenhouses. */
export const ABBEY_BOUNDS=[-200,52,-104,136] as const,YARD_BOUNDS=[114,-124,176,-62] as const;
const ABBEY={x:-160,z:100};
export function abbeyPads(t:Terrain){
 t.pad(ABBEY.x-24,ABBEY.z-20,ABBEY.x+24,ABBEY.z+28,2.5,12);// a gentle knoll
 t.pad(-150,52,-106,88,0,6);// courtyard quarter
 t.pad(114,-124,176,-62,0,6);
}
/** Courtyard house: four wings round an open court, shed roofs falling inwards, arcade on the court side. */
export function courtyardHouse(b:Builder,W:number,D:number,wing:number,floors:number,wallC:Col,roofC:Col,r:()=>number,trees?:{add:(x:number,y:number,z:number)=>void},arcade=true){
 const fh=3.1,H=floors*fh;b.box('stone',0,-2,0,W+.3,2.35,D+.3,pick(r,STONE));
 const wings:[number,number,number,number][]=[[0,-D/2+wing/2,W,wing],[0,D/2-wing/2,W,wing],[-W/2+wing/2,0,wing,D-2*wing],[W/2-wing/2,0,wing,D-2*wing]];
 for(const [x,z,w,d] of wings){b.box('plaster',x,.35,z,w,H-.35,d,wallC);}
 // roofs: outer edge high, sloping into the court
 b.push(0,0,-D/2+wing/2,Math.PI);b.shed('roof',0,H,0,W,wing,1.2,roofC,.3);b.pop();b.push(0,0,D/2-wing/2,0);b.shed('roof',0,H,0,W,wing,1.2,roofC,.3);b.pop();
 b.push(-W/2+wing/2,0,0,-Math.PI/2);b.shed('roof',0,H,0,D-2*wing,wing,1.2,roofC,.3);b.pop();b.push(W/2-wing/2,0,0,Math.PI/2);b.shed('roof',0,H,0,D-2*wing,wing,1.2,roofC,.3);b.pop();
 // outer windows (small, deep) and a gateway in the front wing
 for(const [yaw,len,off] of [[0,W,D/2],[Math.PI,W,D/2],[Math.PI/2,D,W/2],[-Math.PI/2,D,W/2]] as [number,number,number][]){b.push(0,0,0,yaw);const n=Math.floor(len/2.6);for(let f=0;f<floors;f++)for(let i=0;i<n;i++){const x=-len/2+(i+.5)*len/n;if(yaw===0&&f===0&&Math.abs(x)<1.6)continue;b.panel('glass',x,f*fh+1.7,off+.03,.7,1,r()<.5?'#2d3c46':'#3b4a52');b.panel('timber',x-.5,f*fh+1.7,off+.04,.3,1.05,'#3a5a4a');b.panel('timber',x+.5,f*fh+1.7,off+.04,.3,1.05,'#3a5a4a');}b.pop();}
 b.panel('timber',0,1.55,D/2+.03,2.2,2.6,'#5b3a29');b.box('stone',0,2.85,D/2+.05,2.8,.3,.15,'#e8e2d2');
 // the court: paving, a small fountain, a lemon tree, arcade posts on two sides
 const cw=W-2*wing,cd=D-2*wing;b.box('stone',0,0,0,cw,.08,cd,'#d8c9a8');b.cyl('stone',cw*.2,0,0,.9,.5,10,'#c4b9a2');b.disc('water',cw*.2,.52,0,.75,10,'#5f93a3');
 if(trees)trees.add(-cw*.2,0,0);
 if(arcade)for(let i=0;i<=Math.floor(cw/2.4);i++){const x=-cw/2+.3+i*(cw-.6)/Math.floor(cw/2.4);b.box('stone',x,0,-cd/2+.3,.3,2.6,.3,'#efe9dc');b.box('stone',x,0,cd/2-.3,.3,2.6,.3,'#efe9dc');}
 if(arcade){b.box('roof',0,2.6,-cd/2+.6,cw,.12,1.2,roofC);b.box('roof',0,2.6,cd/2-.6,cw,.12,1.2,roofC);}
}
export function buildAbbey(b:Builder,t:Terrain,trees:Trees){const r=rng(5101),G=(x:number,z:number)=>t.height(x,z);
 const y=G(ABBEY.x,ABBEY.z);b.push(ABBEY.x,y,ABBEY.z,Math.PI/2);// church faces east toward the world (local +z → world +x)
 // church: nave, aisles, apse, west tower; cloister to the south
 const st='#c9bfa8';b.box('stone',0,-2,0,10,2.4,26,'#b9b0a0');b.box('stone',0,.3,0,8,9,24,st);b.push(0,9.3,0,Math.PI/2);b.gable('roof',0,0,0,24,8,4.2,'#5a5f66','stone',st,.4);b.pop();
 for(const s of [-1,1]){b.box('stone',s*5.5,.3,0,3,5.4,22,st);b.push(s*5.5,5.7,0,s>0?Math.PI/2:-Math.PI/2);b.shed('roof',0,0,0,22,3,1.1,'#5a5f66',.2);b.pop();
  for(let z=-9;z<=9;z+=4.5){b.push(s*7.02,0,z,s>0?Math.PI/2:-Math.PI/2);b.panel('glass',0,3,0,1,2.6,'#3b4a52');b.pop();b.push(s*4.02,0,z,s>0?Math.PI/2:-Math.PI/2);b.panel('glass',0,7.3,0,1,1.8,'#3b4a52');b.pop();}}
 b.cyl('stone',0,.3,-12,4,8.2,12,st,false);b.dome('roof',0,8.5,-12,4.1,12,3,'#5a5f66',.7);
 b.push(0,0,12.5,0);tower(b,2.6,20,'cone','#c9bfa8','#5a5f66',r,'stone');b.pop();
 b.panel('timber',0,2.2,15.15,1.9,3.2,'#4a3a2a');
 b.pop();
 b.push(ABBEY.x-2,G(ABBEY.x-2,ABBEY.z+17.5),ABBEY.z+17.5,0);courtyardHouse(b,18,16,4.5,2,'#d8c9a8','#a8553a',r,{add:(x,_,z)=>trees.add(ABBEY.x-2+x,y,ABBEY.z+17.5+z,.8,'cypress','#3f6a3c',0)},true);b.pop();
 // walled kitchen garden + orchard rows on the knoll's north side, steps down to the quarter
 lowWall(b,[[ABBEY.x-20,ABBEY.z-18],[ABBEY.x+4,ABBEY.z-18],[ABBEY.x+4,ABBEY.z-8]],1.6,'#b9ae96',G,.5);
 for(let i=0;i<6;i++)b.box('soil',ABBEY.x-17+i*3.6,G(ABBEY.x-17+i*3.6,ABBEY.z-13),ABBEY.z-13,2.4,.25,7,'#5a4632');
 for(let i=0;i<6;i++)for(let j=0;j<7;j++)b.box('foliage',ABBEY.x-17.8+i*3.6+(j%2)*.8,G(ABBEY.x-17+i*3.6,ABBEY.z-13)+.25,ABBEY.z-16+j*1,.5,.35,.5,pick(r,['#5f8a46','#7fae4a','#9ab04a','#6f9a4e']));
 for(let i=0;i<14;i++){const x=ABBEY.x+8+(i%7)*4,z=ABBEY.z-14+Math.floor(i/7)*5;trees.add(x,G(x,z),z,.75,'fruit',pick(r,['#7d9a4a','#6f9a4e']),r()*6);}
 for(let z=ABBEY.z+20;z<ABBEY.z+40;z+=5){trees.add(ABBEY.x+9,G(ABBEY.x+9,z),z,1,'cypress','#3f6a3c',0);trees.add(ABBEY.x+15,G(ABBEY.x+15,z),z,1,'cypress','#3f6a3c',0);}
 t.ribbon(b,[[-106,90.5],[-128,92],[ABBEY.x+14,ABBEY.z]],3,'#c2b79c','path',.1,1.2);t.ribbon(b,[[ABBEY.x+12,ABBEY.z+40],[ABBEY.x+12,ABBEY.z+16]],2.4,'#c2b79c','path',.1,1.2);
 for(const [x,z] of [[ABBEY.x+16,ABBEY.z-5],[ABBEY.x+16,ABBEY.z+5]] as [number,number][]){b.push(x,G(x,z),z,-Math.PI/2);bench(b,'#7a5a3a');b.pop();}
 // lavender field below the knoll (purple rows)
 for(let i=0;i<14;i++){const x=-196+i*2.2;for(let z=58;z<96;z+=1.6){const yy=G(x,z);b.box('flower',x,yy,z,1.1,.55,.9,i%3?'#8a6ab0':'#9a7ac0');}}
}
export function buildCourtyards(b:Builder,t:Terrain,trees:Trees){const r=rng(5201);
 const cols=['#efe4cf','#e6c86e','#e9b07a','#d49a8c','#f0d9a8','#c96f4a','#efe9dc'];let i=0;
 for(const [x,z,W,D,yaw] of [[-116,60,16,13,0],[-136,60,14,13,0],[-116,80,16,13,Math.PI],[-138,80,18,13,Math.PI]] as [number,number,number,number,number][]){const rr=rng(5300+i++*17);
  b.push(x,0,z,yaw);courtyardHouse(b,W,D,4,1+(rr()<.5?1:0),pick(rr,cols),pick(rr,['#a8553a','#b86a45','#c27a52']),rr,{add:(lx,_,lz)=>trees.add(x+lz*Math.sin(yaw)+lx*Math.cos(yaw),0,z+lz*Math.cos(yaw)-lx*Math.sin(yaw),.6,'fruit','#7d9a4a',0)},rr()<.6);b.pop();}
 t.ribbon(b,[[-104,70],[-150,70]],3.4,'#cfc2a0','path',.06,1.5);t.ribbon(b,[[-104,90.5],[-104,52]],2.4,'#cfc2a0','path',.06);
 for(let x=-112;x>-150;x-=9){b.push(x,0,70,0);lampPost(b,3.2,'#3a3f42');b.pop();}
 for(const [x,z] of [[-127,70.8],[-145,69.2]] as [number,number][])trees.add(x,0,z,.9,'round','#6f9a4e',0);
 void fence;void house;void ROOFS;
}
export function buildMakersYard(b:Builder,t:Terrain,trees:Trees){const r=rng(5401);
 // workshops: three long sheds with roller doors
 for(let i=0;i<3;i++){const x=122+i*16;b.push(x,0,-74,Math.PI);house(b,{w:13,d:9,floors:1,fh:5,wall:'timber',wallC:pick(r,['#5f6b73','#8a5a36','#3f5a6a','#7a2f2a']),roof:'gable',roofH:2.2,roofC:'#5a5f66',noWindows:true,door:false,barnDoor:true,trim:'#e8e2d2'},r);b.pop();}
 // stacked shipping containers
 for(let k=0;k<9;k++){const x=166+Math.floor(k/3)*0,z=-70-(k%3)*2.7,lv=Math.floor(k/3);b.push(x+lv*0,lv*2.6,z,0);b.box('metal',0,0,0,6,2.6,2.5,pick(r,['#c43a2a','#2f6f8f','#e0b04a','#3a7a5a','#8a8a8a','#d06a2a']));for(let q=-2.7;q<=2.7;q+=.45)b.box('metal',q,.05,1.26,.08,2.5,.02,'#4a4a4a');b.pop();}
 // water tower on legs
 {const x=130,z=-96;for(const [dx,dz] of [[-2,-2],[2,-2],[-2,2],[2,2]] as [number,number][])b.box('metal',x+dx,0,z+dz,.25,12,.25,'#6a6f72');b.cyl('metal',x,12,z,3.2,4.5,12,'#a8b0b0');b.cone('roof',x,16.5,z,3.4,1.6,12,'#5a5f66');b.box('dressing',x,14,z+3.25,2.2,.6,.05,'#2f4f5f');}
 // market-garden greenhouses (light panes, see-through dressing) and raised beds
 for(let i=0;i<3;i++){const x=148+i*9,z=-98;b.box('stone',x,0,z,7,.4,14,'#a59d8e');b.box('dressing',x,.4,z,6.8,2.4,13.8,'#cfe6ea');b.push(x,2.8,z,Math.PI/2);b.gable('dressing',0,0,0,14,6.8,1.8,'#dff0f2','dressing','#cfe6ea',.05);b.pop();
  for(let j=0;j<4;j++)b.box('foliage',x-2.4+j*1.6,.4,z,.8,.6+r()*.4,12,pick(r,['#5f8a46','#7fae4a','#6f9a4e']));}
 for(let i=0;i<8;i++){b.box('timber',120+i*4.5,0,-114,3,.5,8,'#8a5a36');b.box('foliage',120+i*4.5,.5,-114,2.6,.4,7.4,pick(r,['#5f8a46','#7fae4a','#9ab04a']));}
 // yard surface, a forklift-ish cart, pallets, bench; access lane from the station
 b.box('soil',146,0,-84,60,.04,22,'#9a9488');for(let k=0;k<10;k++)b.box('timber',150+(k%5)*1.4,0+Math.floor(k/5)*.15,-86+Math.floor(k/5)*0,1.2,.14,1.2,'#b08a5f');
 {b.push(152,0,-80,.5);b.box('metal',0,.3,0,1.4,1,2.2,'#e0b04a');b.box('metal',0,1.3,-.3,1.2,1.2,.08,'#2a2a2a');b.box('metal',0,0,1.3,1,.1,1,'#555');b.pop();}
 b.push(140,0,-90,0);bench(b,'#5f6b73');b.pop();
 t.ribbon(b,[[132,-58],[134,-66],[146,-84]],3,'#9d9584','path',.07);
 for(let i=0;i<10;i++){const x=116+r()*58,z=-122+r()*10;trees.add(x,0,z,.9+r()*.3,'poplar','#5f8a46',0);}
}
export const ABBEY_EXPLORE=[{id:'abbey',camera:[-128,14,104],target:[-160,6,100]},{id:'courtyard-quarter',camera:[-108,9,70],target:[-130,1,70]},{id:'makers-yard',camera:[118,10,-62],target:[146,2,-88]}];
