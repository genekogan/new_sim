import {Builder,rng,pick,PLASTER,ROOFS,TIMBER,STONE} from './kit.ts';
import {house,aframe,lampPost,bench,tower,fence,lowWall,stall} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** North of the expansion (z −65..−160): terraced vineyard + orchard with a
 * hill villa, a campus / library annex around a quad, and an artists' village. */
export const VINE_BOUNDS=[20,-160,112,-66] as const,CAMPUS_BOUNDS=[-44,-128,18,-66] as const,ARTS_BOUNDS=[-104,-136,-46,-66] as const;
export const NORTH_AVENUE:[number,number][]=[[-100,-69.5],[109,-69.5],[109,-40]];
export function northPads(t:Terrain){
 t.pad(-104,-128,18,-66,0,6);// campus + artists' village level
 t.pad(20,-72,112,-66,0,3);// avenue strip before the terraces start
}
/** Terrace height in the vineyard band (mirrors terrain relief: 1.4 m steps every ~10.8 m). */
export function buildNorthAvenue(b:Builder,t:Terrain,trees:Trees){const r=rng(2001);
 t.ribbon(b,NORTH_AVENUE,5,'#9d9584','path',.04,2);
 t.ribbon(b,[[8.4,-58.5],[8.4,-62.4],[10,-64.5],[10,-67]],2,'#b6b09b','path',.05);
 for(let x=-96;x<106;x+=10){if(Math.abs(x-10)<3||Math.abs(x+9)<3)continue;trees.add(x,0,-66.6,.9+r()*.25,'round',pick(r,['#6f9a4e','#5f8a46','#7fa84f']),r()*6);if((x+96)%20===0){b.push(x+5,0,-72.6,0);lampPost(b);b.pop();}}
}
export function buildVineyard(b:Builder,t:Terrain,trees:Trees){const r=rng(2101),G=(x:number,z:number)=>t.height(x,z);
 // Terrace bands: z from −72 to −150. Vines E–W on each band (x 24..68), orchard grid (x 72..108).
 const band=10.77;for(let k=0;k<8;k++){const zTop=-65-band*(k+1),zBot=-65-band*k;// zBot is nearer the town
  const zA=zBot-1.2,zB=zTop+3.2;if(zB>zA-1)continue;
  for(let z=zA;z>zB;z-=1.8){const y=G(46,z);for(let x=24;x<68;x+=11){const yy=G(x+5,z);b.box('foliage',x+5,yy+.05,z,10.2,1.1,.42,pick(r,['#5f8a46','#6f9a4e','#4f7a3c']));
     for(let p=0;p<=10;p+=2.5)b.box('timber',x+p,yy,z,.07,1.35,.07,'#6e4a30');}void y;}
  for(let x=74;x<108;x+=5.5)for(let z=zA-1;z>zB;z-=5.5){if(r()<.08)continue;trees.add(x+(r()-.5),G(x,z),z,.75+r()*.15,'fruit',pick(r,['#7d9a4a','#6f9a4e','#8aa850']),r()*6);
   if(r()<.25)b.box('flower',x+(r()-.5)*.8,G(x,z)+2.2,z+(r()-.5)*.8,.25,.25,.25,pick(r,['#d0485a','#e8a33c']));}
  // retaining wall at the top of each bank
  const zw=zTop+band*.06;lowWall(b,[[22,zw],[110,zw]],.7,'#b9ae96',G,.5);
 }
 // central cypress avenue climbing to a hill villa with a tower
 for(let z=-72;z>-142;z-=5){trees.add(69.5,G(69.5,z),z,1,'cypress','#3f6a3c',0);trees.add(72.5,G(72.5,z),z,1,'cypress','#3f6a3c',0);}
 t.ribbon(b,[[71,-69.5],[71,-145]],2.4,'#c2b79c','path',.12,1);
 const vy=G(71,-152);b.push(71,vy,-152,0);house(b,{w:16,d:10,floors:2,plinth:3,wallC:'#e6c86e',roof:'hip',roofC:'#b86a45',shutters:true,trim:'#3a5a4a',veranda:true,flowerbox:true,chimney:true},r);b.pop();
 b.push(82.6,G(82.6,-150),-150,0);tower(b,2.4,12,'cone','#e6c86e','#b86a45',r,'plaster');b.pop();
 b.push(58,G(58,-149),-149,Math.PI/2);house(b,{w:9,d:7,floors:1,fh:3.6,wall:'stone',wallC:'#c4b9a2',roof:'gable',roofC:'#a8553a',noWindows:true,barnDoor:true,door:false},r);b.pop();
 for(let i=0;i<8;i++)b.cyl('timber',56+i*1.1,G(56+i*1.1,-143.5),-143.5,.45,.95,8,'#7a5a3a');
}
export function buildCampus(b:Builder,t:Terrain,trees:Trees){const r=rng(2201);
 const qx=-12,qz=-97;// quad lawn 34×24
 b.box('soil',qx,0,qz,34,.04,24,'#7fa858');t.ribbon(b,[[qx-17,qz],[qx+17,qz]],2.6,'#d3c8ac','path',.06);t.ribbon(b,[[qx,qz-12],[qx,qz+12]],2.6,'#d3c8ac','path',.06);
 t.ribbon(b,[[qx-19,qz-14],[qx+19,qz-14],[qx+19,qz+14],[qx-19,qz+14],[qx-19,qz-14]],3,'#d3c8ac','path',.06);
 b.cyl('stone',qx,0,qz,2.6,.5,14,'#c4b9a2');b.cyl('stone',qx,.5,qz,.6,2.6,8,'#b9b0a0');b.dome('stone',qx,3.1,qz,.8,8,3,'#8f877a');
 // library annex (north side) with a dome and portico
 b.push(qx,0,qz-24,0);b.box('stone',0,-.8,0,26,1.2,13,'#bdb3a0');b.box('plaster',0,.4,0,24,7.5,11,'#efe4cf');for(let x=-10.5;x<=10.5;x+=3){b.panel('glass',x,4.2,5.53,1.3,4.6,'#2d3c46');}
  b.cyl('plaster',0,7.9,0,4.2,2.4,14,'#efe4cf',false);b.dome('roof',0,10.3,0,4.4,14,4,'#7a8a8f');b.box('stone',0,7.9,0,24.4,.5,11.4,'#c4b9a2');
  b.box('stone',0,0,7.5,12,.45,4,'#c4b9a2');for(const x of [-5,-2.5,0,2.5,5])b.cyl('stone',x,.45,8.6,.4,6.6,8,'#f3eee2');b.box('stone',0,7.05,7.8,12.4,.8,2.4,'#e8e2d2');b.push(0,7.85,7.8,0);b.gable('roof',0,0,0,12.4,2.4,1.5,'#7a8a8f','stone','#e8e2d2',.1);b.pop();b.panel('timber',0,1.9,5.53,2.2,3.2,'#4a3a2a');b.pop();
 // two lecture halls (east/west) with arcades facing the quad
 for(const s of [-1,1]){b.push(qx+s*25,0,qz,s>0?-Math.PI/2:Math.PI/2);house(b,{w:24,d:10,floors:2,fh:3.6,wall:'stone',wallC:pick(r,['#b9785a','#a0563f','#c49a6c']),roof:'gable',roofC:'#5a5f66',trim:'#efe9dc',band:true,dormer:true},r);
  for(let x=-11;x<=11;x+=2.75)b.box('stone',x,0,6.6,.45,3.4,.45,'#efe9dc');b.box('stone',0,3.4,6.1,23,.5,1.6,'#efe9dc');b.shed('roof',0,3.9,6.1,23,1.6,.25,'#5a5f66');b.pop();}
 // clock tower at the south gate + an arched gate onto the avenue
 b.push(qx+11,0,qz+19,0);tower(b,2,15,'cone','#b9785a','#5a5f66',r,'stone');b.cyl('dressing',0,12.5,2.02,1,.05,16,'#f3eee2');b.pop();
 b.push(qx,0,qz+20,0);b.box('stone',-3.2,0,0,1.4,5,1.4,'#c4b9a2');b.box('stone',3.2,0,0,1.4,5,1.4,'#c4b9a2');b.box('stone',0,4.2,0,7.8,1.3,1.6,'#c4b9a2');b.pop();
 t.ribbon(b,[[qx,qz+14],[qx,-71]],3,'#d3c8ac','path',.06);
 // students' life: benches, bike racks, trees in rows
 for(const [x,z,yaw] of [[qx-8,qz-4,0],[qx+8,qz-4,0],[qx-8,qz+4,Math.PI],[qx+8,qz+4,Math.PI]] as [number,number,number][]){b.push(x,0,z,yaw);bench(b,'#7a5a3a');b.pop();}
 for(let x=qx-15;x<=qx+15;x+=6){trees.add(x,0,qz-12.5,1,'round','#5f8a46',r()*6);trees.add(x,0,qz+12.5,1,'round','#6f9a4e',r()*6);}
 for(let i=0;i<7;i++){const x=qx-17+i*.9;b.box('metal',x,0,qz+16.5,.04,.8,.6,'#2f3436');if(r()<.7)b.box('dressing',x,.35,qz+16.5,.05,.6,1.6,pick(r,['#c45a4a','#3d5a80','#2f2f2f','#e0b04a']));}
 // dormitory row (small houses) on the campus west side
 for(const [i,dx] of [[0,-36],[1,12]] as [number,number][]){b.push(dx,0,-119,Math.PI/2);house(b,{w:9,d:7,floors:3,wallC:pick(r,['#efe4cf','#e8d8b8','#c7b6d6','#a9c3b0']),roof:'flat',roofGarden:i%2===0,balcony:true,trim:'#3a5a4a'},r);b.pop();}
 void PLASTER;void STONE;void TIMBER;void ROOFS;void fence;
}
export function buildArtists(b:Builder,t:Terrain,trees:Trees){const r=rng(2301),G=(x:number,z:number)=>t.height(x,z);
 const gx=-74,gz=-98;// village green
 b.cyl('soil',gx,0,gz,9,.04,18,'#86ad5c');
 // big sculpture: stacked painted spheres + a ring
 b.cyl('stone',gx,0,gz,1.6,.6,10,'#c4b9a2');let y=.6;for(const [rr,c] of [[1.2,'#e05a3a'],[.9,'#3d8ab0'],[.65,'#f0c040'],[.45,'#5aa070']] as [number,string][]){b.dome('plaster',gx,y+rr,gz,rr,10,3,c);b.dome('plaster',gx,y+rr,gz,rr,10,3,c,-1);y+=rr*2;}
 b.push(gx+3.5,0,gz+2,.4);for(let i=0;i<16;i++){const a=i/16*Math.PI*2,a2=(i+1)/16*Math.PI*2;b.quad('metal',[Math.cos(a)*1.6,1.8+Math.sin(a)*1.6,0],[Math.cos(a2)*1.6,1.8+Math.sin(a2)*1.6,0],[Math.cos(a2)*1.6,1.8+Math.sin(a2)*1.6,.3],[Math.cos(a)*1.6,1.8+Math.sin(a)*1.6,.3],'#c9a440');}b.pop();
 // studios around the green: A-frames, colourful cottages with big north windows, a sawtooth warehouse
 const ring=12;for(let i=0;i<9;i++){const a=i/9*Math.PI*2+.2,x=gx+Math.cos(a)*(ring+9),z=gz+Math.sin(a)*(ring+9),yaw=Math.atan2(gx-x,gz-z);if(x>-50||z<-130)continue;
  b.push(x,G(x,z),z,yaw);const rr=rng(2400+i);
  if(i%3===0)aframe(b,6,7,6.5,rr);else house(b,{w:7,d:6.5,floors:1+(i%2),fh:3.4,wall:i%4===1?'timber':'plaster',wallC:pick(rr,['#e05a3a','#3d8ab0','#f0c040','#5aa070','#e88aa0','#7a4a8a','#2f6f6f','#d9a85e']),roof:pick(rr,['shed','gable','flat'] as const),roofC:pick(rr,['#2f2f2f','#3f4448','#efe9dc','#c43a2a']),trim:'#f3eee2',roofGarden:true,awning:pick(rr,['#f0c040','#e05a3a','#3d8ab0'])},rr);
  // easel + canvas by each door
  b.push(1.8,0,4.6,.3);b.box('timber',0,0,0,.05,1.6,.05,'#6e4a30');b.box('timber',-.3,0,-.3,.05,1.5,.05,'#6e4a30');b.box('timber',.3,0,-.3,.05,1.5,.05,'#6e4a30');b.box('dressing',0,.8,.03,.9,.7,.04,pick(rr,['#e05a3a','#3d8ab0','#f0c040','#e88aa0']));b.pop();
  b.pop();}
 // sawtooth-roof warehouse studio (north-west), mural wall along the avenue
 b.push(-92,0,-118,0);b.box('stone',0,-.6,0,20,1,12,'#a59d8e');b.box('stone',0,.4,0,19,5,11,'#9a4a36');for(let k=0;k<4;k++){const x=-9.5+k*4.75;b.quad('roof',[x,5.4,-5.5],[x+4.75,5.4,-5.5],[x+4.75,5.4,5.5],[x,5.4,5.5],'#3f4448');b.quad('roof',[x,5.4,5.5],[x+4.75,5.4,5.5],[x+4.75,7.4,5.5],[x,7.4,5.5],'#3f4448');
  b.quad('roof',[x,5.4,-5.5],[x,7.4,-5.5],[x+4.75,7.4,-5.5],[x+4.75,5.4,-5.5],'#3f4448');b.quad('glass',[x+.1,5.4,-5.6],[x+.1,7.3,-5.6],[x+4.65,7.3,-5.6],[x+4.65,5.4,-5.6],'#9ab8c8');b.quad('roof',[x,7.4,-5.5],[x+4.75,7.4,-5.5],[x+4.75,7.4,5.5],[x,7.4,5.5],'#3f4448');}
  b.panel('timber',0,2.4,5.53,4,4,'#2f6f6f');for(const x of [-7,-4,4,7])b.panel('glass',x,2.8,5.53,2,2.4,'#2d3c46');b.pop();
 {const x0=-102,x1=-50,z=-72.8;const n=13;for(let i=0;i<n;i++){const xa=x0+i*(x1-x0)/n;b.box('stone',xa+(x1-x0)/n/2,0,z,(x1-x0)/n,2.6,.4,pick(r,['#e05a3a','#3d8ab0','#f0c040','#5aa070','#e88aa0','#7a4a8a','#f3eee2']));b.box('dressing',xa+(x1-x0)/n/2,.6+r()*1.2,z+.21,(x1-x0)/n*.6,.4+r()*.6,.02,pick(r,['#2f2f2f','#f3eee2','#c43a2a','#3d5a80']));}}
 // string lights across the green (posts + see-through bulbs line)
 for(let i=0;i<6;i++){const a=i/6*Math.PI*2,x=gx+Math.cos(a)*9.5,z=gz+Math.sin(a)*9.5;b.cyl('timber',x,0,z,.08,4,5,'#6e4a30',false);const a2=(i+1)/6*Math.PI*2,x2=gx+Math.cos(a2)*9.5,z2=gz+Math.sin(a2)*9.5;for(let k=1;k<10;k++){const u=k/10,sag=Math.sin(u*Math.PI)*.6;b.box('dressing',x+(x2-x)*u,3.9-sag,z+(z2-z)*u,.12,.12,.12,pick(r,['#f8e08a','#f3a6c0','#9ad0f0']));}}
 // a little outdoor market of crafts + picnic tables
 for(let i=0;i<4;i++){b.push(gx-6+i*4,0,gz+12.5,Math.PI);stall(b,3,pick(r,['#7a4a8a','#2f6f6f','#e05a3a','#f0c040']),'#f3eee2',r);b.pop();}
 for(let i=0;i<3;i++){const x=gx-4+i*4,z=gz-5.5;b.box('timber',x,.72,z,1.8,.06,.8,'#8a5a36');for(const s of [-1,1])b.box('timber',x,.42,z+s*.65,1.8,.05,.28,'#8a5a36');b.box('timber',x,0,z,.1,.72,.1,'#6e4a30');}
 t.ribbon(b,[[gx,gz+9],[gx,-71]],2.4,'#c2b79c','path',.06);t.ribbon(b,[[gx-9,gz],[-92,-112]],2,'#c2b79c','path',.06);
 for(let i=0;i<26;i++){const x=-102+r()*56,z=-134+r()*60;if(Math.hypot(x-gx,z-gz)<24||(x<-80&&z<-110)||z>-75)continue;trees.add(x,G(x,z),z,.9+r()*.5,pick(r,['round','poplar','fruit'] as const),pick(r,['#6f9a4e','#8aa850','#5f8a46','#a0b050']),r()*6);}
 void fence;void TIMBER;
}
export const NORTH_EXPLORE=[{id:'vineyard-terraces',camera:[52,10,-62],target:[70,6,-110]},{id:'campus-quad',camera:[-12,9,-74],target:[-12,3,-105]},{id:'artists-village',camera:[-60,9,-80],target:[-76,3,-100]}];
