import {Builder,rng,pick,PLASTER,ROOFS,TIMBER} from './kit.ts';
import {house,lampPost,bench,boat,gazebo,silo,fence,tower,stall,lightAt} from './buildings.ts';
import {WATER,type Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
import {SPORTS_LAYOUT} from './sports-layout.ts';
/** South of the expansion (z 85..175): park with pond, playground and sports
 * ground, farm hamlet with silos, beach + boardwalk harbour on the sea. */
export const PARK_BOUNDS=[-42,86,32,134] as const,SPORTS_BOUNDS=[33,86,106,134] as const,FARM_BOUNDS=[-104,86,-44,136] as const,HARBOUR_BOUNDS=[-104,134,130,190] as const;
const POND={x:-6,z:112,rx:13,rz:8.5};
export const SOUTH_AVENUE:[number,number][]=[[-96,90.5],[106.5,90.5]];
export function southPads(t:Terrain){
 t.pad(-100,86,106,137,0,6);
 t.cuts.push(pondDepth);
}
/** Pond basin cut into the park pad (applied as a terrain "cut" after pads). */
export function pondDepth(x:number,z:number){const e=((x-POND.x)/POND.rx)**2+((z-POND.z)/POND.rz)**2;return e<1?-1.4*Math.min(1,(1-e)*3):0;}
export function buildSouthAvenue(b:Builder,t:Terrain,trees:Trees){const r=rng(808);
 t.ribbon(b,SOUTH_AVENUE,5,'#9d9584','path',.04,2);
 for(const [x0,z0] of [[0,79],[26,79],[-13,77],[59,78]] as [number,number][])t.ribbon(b,[[x0,z0],[x0,88]],2.2,'#b6b09b','path',.05);
 for(let x=-92;x<104;x+=9){if(Math.abs(x)<3||Math.abs(x-26)<3||Math.abs(x+13)<3||Math.abs(x-59)<3)continue;trees.add(x,0,87.4,.95+r()*.2,'round',pick(r,['#6f9a4e','#5f8a46','#7fa84f']),r()*6);
  if((x+92)%18===0){b.push(x+4.5,0,93.6,0);lampPost(b);b.pop();}}
}
export function buildPark(b:Builder,t:Terrain,trees:Trees){const r=rng(1201),G=(x:number,z:number)=>t.height(x,z);
 // pond: water, stone edging, a little wooden jetty, reeds, ducks-as-dots
 const seg=28;for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,c=(i+1)/seg*Math.PI*2;b.tri('water',[POND.x,-.45,POND.z],[POND.x+Math.cos(c)*POND.rx*.98,-.45,POND.z+Math.sin(c)*POND.rz*.98],[POND.x+Math.cos(a)*POND.rx*.98,-.45,POND.z+Math.sin(a)*POND.rz*.98],'#5a8f8a');
  const x=POND.x+Math.cos(a)*POND.rx,z=POND.z+Math.sin(a)*POND.rz;b.push(x,0,z,-a+Math.PI/2);b.box('stone',0,-.6,0,POND.rx*Math.PI*2/seg*1.1,.72,.5,'#b9b0a0');b.pop();
  if(i%3===0)for(let k=0;k<5;k++)b.box('foliage',x*.97+POND.x*.03+(r()-.5)*1.2,-.5,z*.97+POND.z*.03+(r()-.5)*1.2,.08,.9+r()*.6,.08,'#6f8a3c');}
 b.push(POND.x+POND.rx-1,0,POND.z,Math.PI/2);b.box('timber',0,-.1,1.5,1.4,.15,4,'#8a6a4a');for(const z of [0.5,3])for(const x of [-.6,.6])b.box('timber',x,-1,z,.12,1,.12,'#5b4030');b.pop();
 for(let i=0;i<5;i++){const a=r()*6.28,rr=r()*.6;b.box('flower',POND.x+Math.cos(a)*POND.rx*rr,-.44,POND.z+Math.sin(a)*POND.rz*rr,.3,.18,.18,i%2?'#e8e2d2':'#5f4a32');}
 // gazebo on a lawn west of the pond, bandstand-style
 b.push(-28,0,110,0);gazebo(b,3.2,'#efe9dc','#5f8a7a');b.pop();
 // a lantern hanging in the gazebo, and park lamps round the pond walk (between the benches)
 b.box('metal',-28,2.62,110,.03,.28,.03,'#2f3436');b.box('glass',-28,2.3,110,.26,.32,.26,'#f3e3a8');lightAt(b,'lantern',-28,0,110,1.2);
 for(let k=0;k<4;k++){const a=.59+k*Math.PI/2,x=POND.x+Math.cos(a)*(POND.rx+5),z=POND.z+Math.sin(a)*(POND.rz+5);b.push(x,0,z,0);lampPost(b,3.2,'#2f4f5f','park-lamp');b.pop();}
 // loop path round the pond + diagonals
 const loop:[number,number][]=[];for(let i=0;i<=24;i++){const a=i/24*Math.PI*2;loop.push([POND.x+Math.cos(a)*(POND.rx+3.5),POND.z+Math.sin(a)*(POND.rz+3.5)]);}t.ribbon(b,loop,2.2,'#c2b79c','path',.05,1.5);
 t.ribbon(b,[[0,88],[-2,100]],2.2,'#c2b79c','path',.05);t.ribbon(b,[[-13,88],[-24,106],[-28,110]],2.2,'#c2b79c','path',.05);t.ribbon(b,[[-6,124],[-6,132],[10,138]],2.2,'#c2b79c','path',.05);
 // benches facing the pond
 for(let i=0;i<8;i++){const a=i/8*Math.PI*2+.2,x=POND.x+Math.cos(a)*(POND.rx+5.3),z=POND.z+Math.sin(a)*(POND.rz+5.3);b.push(x,0,z,Math.atan2(POND.x-x,POND.z-z));bench(b,'#7a5a3a');b.pop();}
 // flower beds and specimen trees
 for(const [x,z,c] of [[-18,96,'#d0485a'],[8,96,'#e8a33c'],[-30,124,'#c45ab0'],[16,126,'#f0e04a']] as [number,number,string][]){b.cyl('soil',x,0,z,2.4,.25,10,'#5a4632');for(let k=0;k<14;k++){const a=r()*6.28,d=r()*2.1;b.box('flower',x+Math.cos(a)*d,.25,z+Math.sin(a)*d,.25,.25,.25,k%3?c:'#efe9dc');}}
 for(let i=0;i<34;i++){const x=-40+r()*70,z=88+r()*44;if(pondDepth(x,z)<0||((x-POND.x)/(POND.rx+6))**2+((z-POND.z)/(POND.rz+6))**2<1||Math.hypot(x+28,z-110)<6||(x>8&&x<30&&z>94&&z<112))continue;
  trees.add(x,G(x,z),z,.9+r()*.6,pick(r,['round','round','poplar','conifer'] as const),pick(r,['#6f9a4e','#5f8a46','#7fa84f','#4f7a3c','#8aa850']),r()*6);}
 // playground (x 10..28, z 96..110): sandpit, swings, slide, climbing frame, see-saw, fence
 b.box('soil',19,0,103,16,.06,12,'#d8c79a');fence(b,[[11,97],[27,97],[27,109],[11,109],[11,101]],.9,'#e05a3a',G);
 {b.push(14,0,100,0);for(const x of [-1.6,1.6])for(const z of [-.7,.7])b.box('metal',x,0,z,.08,2.3,.08,'#3d5a80');b.box('metal',0,2.3,0,3.4,.1,.1,'#3d5a80');for(const x of [-.7,.7]){b.box('metal',x,.9,0,.02,1.4,.02,'#999');b.box('timber',x,.5,0,.5,.06,.25,'#e0b04a');}b.pop();}
 {b.push(20,0,99.5,0);b.box('metal',0,0,0,1.4,1.8,1.4,'#c45a4a');b.box('timber',0,1.8,0,1.6,.1,1.6,'#e0b04a');b.quad('metal',[-.4,1.85,.8],[.4,1.85,.8],[.4,.1,3.6],[-.4,.1,3.6],'#e8c84a');b.box('metal',0,1.9,0,1.6,.8,.06,'#3d5a80');b.cone('roof',0,2.6,0,1.1,.9,4,'#c45a4a');b.pop();}
 {b.push(24,0,105,.3);for(let i=0;i<4;i++)for(let j=0;j<3;j++){b.box('metal',-1.5+i,0,-1+j,.06,2,.06,'#3a7a5a');}for(let y=.6;y<2.1;y+=.7){b.box('metal',0,y,-1,3,.05,.05,'#3a7a5a');b.box('metal',0,y,1,3,.05,.05,'#3a7a5a');}b.pop();}
 {b.push(15,0,106,0);b.box('metal',0,0,0,.3,.45,.3,'#555');b.push(0,.5,0,0);b.pushRot('z',.18);b.box('timber',0,0,0,3.2,.08,.3,'#e05a3a');b.pop();b.pop();b.pop();}
 for(const [x,z,yaw] of [[12,111,0],[26,111,0]] as [number,number,number][]){b.push(x,0,z,yaw);bench(b,'#3d5a80');b.pop();}
 // ice-cream kiosk and a drinking fountain near the avenue
 b.push(-6,0,95.5,Math.PI);stall(b,2.6,'#f3a6c0','#ffffff',r,false);b.pop();b.cyl('stone',4,0,94.5,.3,.95,6,'#b9b0a0');
}
export function buildSports(b:Builder,t:Terrain,trees:Trees){const r=rng(1301),G=(x:number,z:number)=>t.height(x,z);
 // Scaled football pitch, with clear goal run-off before the courts and western sidewalk.
 const {x:cx,z:cz,length:L,width:W}=SPORTS_LAYOUT.pitch;b.box('soil',cx,0,cz,L+8,.03,W+6,'#6f9a4a');
 for(let i=0;i<8;i++)b.box('soil',cx-L/2+L/16+i*L/8,.031,cz,L/16,.004,W,'#7aa654');
 const line=(x0:number,z0:number,x1:number,z1:number)=>b.box('dressing',(x0+x1)/2,.036,(z0+z1)/2,Math.abs(x1-x0)+.12,.01,Math.abs(z1-z0)+.12,'#f3f3ee');
 line(cx-L/2,cz-W/2,cx+L/2,cz-W/2);line(cx-L/2,cz+W/2,cx+L/2,cz+W/2);line(cx-L/2,cz-W/2,cx-L/2,cz+W/2);line(cx+L/2,cz-W/2,cx+L/2,cz+W/2);line(cx,cz-W/2,cx,cz+W/2);
 for(const s of [-1,1]){line(cx+s*L/2,cz-8,cx+s*(L/2-9),cz-8);line(cx+s*L/2,cz+8,cx+s*(L/2-9),cz+8);line(cx+s*(L/2-9),cz-8,cx+s*(L/2-9),cz+8);
  b.push(cx+s*(L/2+.05),0,cz,s>0?-Math.PI/2:Math.PI/2);b.box('metal',-3.66,0,0,.12,2.44,.12,'#f3f3ee');b.box('metal',3.66,0,0,.12,2.44,.12,'#f3f3ee');b.box('metal',0,2.38,0,7.44,.12,.12,'#f3f3ee');
  // Actual open grid across the back, both sides and roof; the goal mouth stays open.
  for(let x=-3.66;x<=3.67;x+=.305){b.box('dressing',x,0,-1.6,.014,2.44,.014,'#e8e8e8');b.box('dressing',x,2.43,-.8,.014,.014,1.6,'#e8e8e8');}
  for(let y=.244;y<2.45;y+=.244){b.box('dressing',0,y,-1.6,7.32,.014,.014,'#e8e8e8');for(const x of[-3.66,3.66])b.box('dressing',x,y,-.8,.014,.014,1.6,'#e8e8e8');}
  for(let z=-1.6;z<.01;z+=.32){for(const x of[-3.66,3.66])b.box('dressing',x,0,z,.014,2.44,.014,'#e8e8e8');b.box('dressing',0,2.43,z,7.32,.014,.014,'#e8e8e8');}b.pop();}
 {const N=24;for(let i=0;i<=N;i++){const a=i/N*Math.PI*2;line(cx+Math.cos(a)*4.5,cz+Math.sin(a)*4.5,cx+Math.cos(a)*4.5+.1,cz+Math.sin(a)*4.5+.1);}}
 // grandstand
 b.push(cx,0,cz-W/2-6.5,0);for(let k=0;k<5;k++)b.box('timber',0,k*.45,-k*.8,30,.45,.8,k%2?'#8a5a36':'#a0764e');for(let k=0;k<5;k++)b.box('dressing',0,k*.45+.45,-k*.8+.1,29,.05,.3,pick(r,['#3d5a80','#c45a4a']));
  for(const x of [-15,-5,5,15])b.box('metal',x,0,-3.1,.15,4.6,.15,'#5a6268');b.shed('roof',0,4.6,-1.1,31,4,.6,'#3f4448');b.pop();
 // Two complete scaled tennis courts; singles/doubles sidelines and all four service boxes.
 SPORTS_LAYOUT.courts.forEach(({x,z},i)=>{b.box('soil',x,0,z,12,.04,18,i?'#b8603e':'#4a7aa0');
  const courtLine=(xa:number,za:number,xb:number,zb:number)=>b.box('dressing',(xa+xb)/2,.051,(za+zb)/2,Math.abs(xb-xa)+.07,.008,Math.abs(zb-za)+.07,'#f3f3ee');
  for(const zz of[-8,8])courtLine(x-5,z+zz,x+5,z+zz);
  for(const xx of[-5,-3.7,3.7,5])courtLine(x+xx,z-8,x+xx,z+8);
  for(const zz of[-4.4,4.4])courtLine(x-3.7,z+zz,x+3.7,z+zz);courtLine(x,z-4.4,x,z+4.4);
  for(const zz of[-8,8])courtLine(x,z+zz,x,z+zz+(zz>0?-.18:.18));
  for(let xx=-5.5;xx<=5.51;xx+=.25)b.box('dressing',x+xx,0,z,.016,1,.016,'#d3d6d1');for(let y=.2;y<=1.01;y+=.2)b.box('dressing',x,y,z,11,.014,.014,'#d3d6d1');
  const fence=(px:number,pz:number,sx:number,sz:number,part:string)=>{b.box('metal',px,0,pz,sx,3,sz,'#3a5a4a');b.boundary('guard',px,0,pz,sx,3,sz,'region-sports-court:'+i,part);};
  for(const xx of[-6.5,6.5])fence(x+xx,z,.06,19,'side:'+xx);fence(x,z-9.5,13,.06,'rear');
  // Front gate remains 1.4 m wide, outside the playing baseline.
  for(const s of[-1,1])fence(x+s*3.6,z+9.5,5.8,.06,'front:'+s);
 });
 // clubhouse with a veranda
 b.push(SPORTS_LAYOUT.clubhouse.x,0,SPORTS_LAYOUT.clubhouse.z,Math.PI/2);house(b,{w:10,d:6,floors:1,roof:'gable',veranda:true,wallC:'#efe9dc',roofC:'#3f6a3c',trim:'#3a5a4a'},r);b.pop();
 for(let x=38;x<92;x+=8){trees.add(x,0,133.5,.9,'poplar','#6f9a4e',0);}
 for(const [x,z] of [[34,95],[94,95],[34,129],[92,131]] as [number,number][]){b.push(x,0,z,0);lampPost(b,6,'#5a6268');b.pop();}
 t.ribbon(b,[[59,88],[59,94.5]],2.2,'#b6b09b','path',.05);
 void G;void PLASTER;void TIMBER;void ROOFS;
}
export function buildFarm(b:Builder,t:Terrain,trees:Trees){const r=rng(1401),G=(x:number,z:number)=>t.height(x,z);
 // crop fields: soil with green/gold rows, separated by hedges
 const fields:[number,number,number,number,string][]=[[-102,94,-82,112,'#7fae4a'],[-80,94,-62,112,'#d8b84a'],[-102,116,-84,134,'#5f8a46'],[-60,94,-46,110,'#9ab04a']];
 for(const [x0,z0,x1,z1,c] of fields){b.box('soil',(x0+x1)/2,0,(z0+z1)/2,x1-x0,.08,z1-z0,'#6a5038');for(let x=x0+1;x<x1;x+=1.4)b.box('foliage',x,.08,(z0+z1)/2,.6,.35+r()*.1,z1-z0-1.4,c);
  t.ribbon(b,[[x0-.8,z0-1],[x1+.8,z0-1]],.9,'#4f7a3c','path',.4,2);}
 // farmyard: red barn, farmhouse, three silos, haystacks, tractor, windmill
 b.push(-70,0,124,0);house(b,{w:12,d:9,floors:2,fh:3.2,wall:'timber',wallC:'#8e3326',roof:'gable',roofH:4.6,roofC:'#4a4440',trim:'#e9dfcc',door:false,noWindows:true,barnDoor:true,plinth:.6},r);b.pop();
 b.push(-54,0,127,-Math.PI/2);house(b,{w:8,d:7,floors:2,wallC:'#efe4cf',roof:'hip',roofC:'#5a5f66',veranda:true,shutters:true,chimney:true,flowerbox:true},r);b.pop();
 for(const [x,h] of [[-82,11],[-78.5,13],[-75,10]] as [number,number][]){b.push(x,0,128,0);silo(b,1.6,h,'#b8c0c0','#8a9090');b.pop();}
 for(let i=0;i<6;i++){const x=-98+i*3.2,z=129+(i%2)*2.4;b.push(x,0,z,0);b.pushRot('z',Math.PI/2);b.cyl('foliage',0,-.7,0,.75,1.4,8,'#d8c070');b.pop();b.pop();}
 {b.push(-62,0,118,.6);b.box('metal',0,.5,0,2.4,.9,1.3,'#c43a2a');b.box('metal',-.4,1.4,0,1,1.1,1.1,'#c43a2a');b.box('glass',-.4,1.5,0,.9,.8,1.12,'#2d3c46');
  for(const [x,rr2] of [[.8,.45],[-.9,.75]] as [number,number][])for(const z of [-.75,.75]){b.push(x,rr2,z,0);b.pushRot('x',Math.PI/2);b.cyl('dressing',0,-.2,0,rr2,.4,10,'#2a2a2a');b.pop();b.pop();}b.pop();}
 {b.push(-94,G(-94,104),104,Math.PI/2);b.cyl('stone',0,0,0,2.4,9,10,'#efe9dc',false,1.6);b.cone('roof',0,9,0,2,2.6,10,'#5d4a3f');b.push(0,7.8,2.1,0);for(let k=0;k<4;k++){const a=k*Math.PI/2+.3;b.quad('timber',[0,0,0],[Math.cos(a)*.5,Math.sin(a)*.5,.05],[Math.cos(a)*6+Math.cos(a+1.57)*.7,Math.sin(a)*6+Math.sin(a+1.57)*.7,.05],[Math.cos(a)*6,Math.sin(a)*6,.05],'#e8e2d2');}b.pop();b.pop();}
 fence(b,[[-104,92.5],[-46,92.5]],1.1,'#a0764e',G,false);fence(b,[[-66,114],[-46,114],[-46,134]],1.1,'#a0764e',G,false);
 for(let i=0;i<10;i++)trees.add(-100+r()*50,0,113.6+r()*.5,.9+r()*.3,'round',pick(r,['#6f9a4e','#5f8a46']),r()*6);
 t.ribbon(b,[[-70,93],[-70,118],[-62,124],[-58,127]],3,'#b6a582','path',.05);
}
export function buildHarbour(b:Builder,t:Terrain,trees:Trees){const r=rng(1501),G=(x:number,z:number)=>t.height(x,z);
 // boardwalk deck along the shore (z 137..141) on posts, from x -40 to 100
 const z0=136.5,z1=141.5,y=.55;b.box('timber',30,y-.18,(z0+z1)/2,140,.18,z1-z0,'#a0764e');for(let x=-40;x<=100;x+=1)b.box('timber',x,y-.17,(z0+z1)/2,.04,.012,z1-z0,'#7a5a3a');
 for(let x=-40;x<=100;x+=4)for(const z of [z0+.2,z1-.2])b.box('timber',x,-2,z,.22,2.4,.22,'#5b4030');for(const [a,z] of [[-40,8.4],[11.6,60.4],[63.6,100]])b.box('timber',(a+z)/2,y,z1-.1,z-a,.9,.08,'#e8e2d2');
 for(let x=-38;x<=100;x+=2.5)if(!((x>=8.4&&x<=11.6)||(x>=60.4&&x<=63.6)))b.box('timber',x,y,z1-.1,.08,.9,.08,'#e8e2d2');
 for(let x=-36;x<100;x+=12){b.push(x,y,z0+.8,Math.PI);bench(b,'#7a5a3a');b.pop();b.push(x+6,y,z1-.5,0);lampPost(b,3.4,'#2f4f5f');b.pop();}
 // two piers out over the water with moored boats; a lighthouse on a breakwater
 for(const [px,len] of [[10,26],[62,34]] as [number,number][]){b.box('timber',px,y-.18,z1+len/2,3.2,.18,len,'#a0764e');for(let z=z1;z<z1+len;z+=4)for(const x of [-1.4,1.4])b.box('timber',px+x,-3,z,.25,3.6,.25,'#5b4030');
  for(let z=z1+4;z<z1+len;z+=6)for(const s of [-1,1]){if(r()<.25)continue;b.push(px+s*4,WATER.bay-.1,z,0);boat(b,4+r()*4,pick(r,['#2f4f5f','#7a2f2a','#355e3b','#e8e2d2','#d9a441','#3d5a80']),r,r()<.4);b.pop();}
  b.push(px,y,z1+len-1,0);lampPost(b,3.6,'#2f4f5f');b.pop();}
 b.box('stone',96,-3,170,5,3.8,40,'#8f877a');for(let i=0;i<12;i++)b.box('stone',93.5+r()*5,-1.5,152+r()*36,1.4+r(),1.2+r()*.6,1.3+r(),'#7c766c');
 b.push(96,.8,188,0);tower(b,2.1,13,'cone','#efe9dc','#c43a2a',r,'plaster');b.box('glass',0,13.3,0,2.6,1.4,2.6,'#f3e3a8');b.pop();
 b.push(96,.8,188,0);for(let k=0;k<5;k++)b.cyl('plaster',0,2+k*2.4,0,2.13,1.1,10,'#c43a2a',false);b.pop();
 // beach: huts, umbrellas, towels (x -100..-44 along the shore)
 for(let x=-98,i=0;x<-46;x+=4.2,i++){const z=134.5,c=pick(r,['#e05a3a','#3d8ab0','#f0c040','#5aa070','#e88aa0','#efe9dc']);b.push(x,G(x,z),z,Math.PI);b.box('timber',0,0,0,2.4,2.2,2.2,c);b.gable('roof',0,2.2,0,2.4,2.2,.8,'#efe9dc','timber',c,.15);b.panel('timber',0,1,-1.11,.8,1.7,'#efe9dc',-1);b.pop();}
 for(let i=0;i<14;i++){const x=-96+r()*52,z=139+r()*5,yy=G(x,z);if(yy<WATER.bay+.1)continue;b.cyl('metal',x,yy,z,.03,2,4,'#ddd',false);b.cone('cloth',x,yy+1.8,z,1.1,.45,8,pick(r,['#e05a3a','#3d8ab0','#f0c040','#efe9dc','#5aa070']));b.box('cloth',x+1,yy+.02,z+.4,.8,.02,1.8,pick(r,['#e05a3a','#3d8ab0','#f0c040','#ffffff']));}
 // seafront kiosks and a fish market shed
 for(const [x,c] of [[-30,'#3d8ab0'],[44,'#e05a3a'],[84,'#f0c040']] as [number,string][]){b.push(x,0,133.2,Math.PI);stall(b,3,c,'#ffffff',r,true);b.pop();}
 b.push(SPORTS_LAYOUT.fishMarket.x,0,SPORTS_LAYOUT.fishMarket.z,0);house(b,{w:14,d:6,floors:1,fh:4,wall:'timber',wallC:'#5f7f8f',roof:'gable',roofC:'#3f4448',door:true},r);b.pop();
 for(let x=-36;x<100;x+=9)trees.add(x+4.5,0,132.2,.8,'poplar','#5f8a46',0);
 for(const x of [-36,31])t.ribbon(b,[[x,93],[x,136.4]],2.4,'#c2b79c','path',.05);
 void TIMBER;
}
export const SOUTH_EXPLORE=[{id:'park-pond',camera:[-24,8,92],target:[-6,0,112]},{id:'sports-ground',camera:[40,10,92],target:[64,1,112]},{id:'farm-hamlet',camera:[-56,12,100],target:[-76,4,124]},{id:'harbour-boardwalk',camera:[20,8,124],target:[40,1,150]},{id:'lighthouse',camera:[70,10,150],target:[96,8,186]}];
