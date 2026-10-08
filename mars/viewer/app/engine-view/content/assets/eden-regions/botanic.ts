import {Builder,rng,pick} from './kit.ts';
import {house,lampPost,bench,tower,lowWall,footprint} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** Botanic garden north of the artists' village (x −104..−40, z −168..−138): a Japanese garden with a
 * koi pond, red bridge, torii, five-storey pagoda, tea house and raked-gravel court, plus a palm house.
 * And an observatory on the plateau above the vineyard (around [92,−188]). */
export const BOTANIC_BOUNDS=[-104,-170,-40,-136] as const,OBS_BOUNDS=[78,-200,106,-176] as const;
const POND={x:-70,z:-152,rx:10,rz:6};
export function botanicPads(t:Terrain){t.pad(-104,-170,-40,-136,0,6);t.cuts.push((x,z)=>{const e=((x-POND.x)/POND.rx)**2+((z-POND.z)/POND.rz)**2;return e<1?-1.2*Math.min(1,(1-e)*3):0;});t.pad(80,-198,104,-178,undefined,8);}
const RED='#b8322a',DARK='#3a2a22';
export function buildBotanic(b:Builder,t:Terrain,trees:Trees){const r=rng(7101);
 // koi pond: water, edging rocks, stepping stones, koi dots, a red arched bridge
 for(let i=0;i<24;i++){const a=i/24*Math.PI*2,c=(i+1)/24*Math.PI*2;b.tri('water',[POND.x,-.4,POND.z],[POND.x+Math.cos(c)*POND.rx*.97,-.4,POND.z+Math.sin(c)*POND.rz*.97],[POND.x+Math.cos(a)*POND.rx*.97,-.4,POND.z+Math.sin(a)*POND.rz*.97],'#4f7f78');
  if(i%2===0)b.box('stone',POND.x+Math.cos(a)*POND.rx,-.5,POND.z+Math.sin(a)*POND.rz,.9+r()*.6,.7+r()*.3,.8+r()*.5,pick(r,['#8f877a','#7c766c','#a59d8e']));}
 for(let i=0;i<9;i++)b.box('flower',POND.x-6+r()*12,-.38,POND.z-3+r()*6,.35,.05,.15,pick(r,['#e8702a','#f3eee2','#e8a33c']));
 for(let i=0;i<5;i++)b.cyl('stone',POND.x+5.5+i*.9,-.5,POND.z+2.5-i*.5,.35,.6,7,'#a59d8e');
 {b.push(POND.x-3,0,POND.z,Math.PI/2);const seg=8,L=12,W=1.8;for(let i=0;i<seg;i++){const a=i/seg,c=(i+1)/seg,za=-L/2+L*a,zc=-L/2+L*c,ya=.2+Math.sin(a*Math.PI)*1.3,yc=.2+Math.sin(c*Math.PI)*1.3;
   b.quad('timber',[-W/2,ya,za],[W/2,ya,za],[W/2,yc,zc],[-W/2,yc,zc],RED);for(const s of [-1,1]){b.quad('timber',[s*W/2,ya+.75,za],[s*W/2,yc+.75,zc],[s*W/2,yc+.82,zc],[s*W/2,ya+.82,za],RED);if(i%2===0)b.box('timber',s*W/2,ya,za,.08,.85,.08,RED);}}b.pop();}
 // torii gate at the garden entrance (from the artists' village path)
 {b.push(-72,0,-138.5,0);for(const x of [-2.2,2.2])b.cyl('timber',x,0,0,.22,4.2,8,RED,false);b.box('timber',0,3.4,0,5.6,.3,.35,RED);b.box('timber',0,4.1,0,6.8,.35,.5,DARK);b.box('timber',0,4.45,0,7.2,.14,.6,DARK);b.box('timber',0,3.7,0,.3,.7,.3,RED);b.pop();}
 t.ribbon(b,[[-74,-134],[-72,-139],[-72,-144]],2.2,'#cfc6b2','path',.06);
 // five-storey pagoda
 {const x=-88,z=-158;b.push(x,0,z,.3);footprint(b,5,5,'pagoda');b.box('stone',0,-.6,0,6.4,1,6.4,'#a59d8e');let y=.4;for(let k=0;k<5;k++){const s=4.4-k*.55;b.box('plaster',0,y,0,s,2.1,s,'#efe4cf');b.box('timber',0,y,0,s+.12,.25,s+.12,RED);
   for(let q=0;q<4;q++){b.push(0,0,0,q*Math.PI/2);b.panel('timber',0,y+1.1,s/2+.03,.9,1.2,RED);b.pop();}b.hip('roof',0,y+2.1,0,s+1.4,s+1.4,.9,DARK,.2,0);y+=2.6;}b.cyl('metal',0,y-.3,0,.12,3,6,'#c9a440',false);for(let k=0;k<5;k++)b.cyl('metal',0,y+.2+k*.5,0,.35,.12,8,'#c9a440');b.pop();}
 // tea house on the pond's east bank with an engawa veranda and a stone lantern
 {b.push(-56,0,-153,-Math.PI/2);house(b,{w:8,d:6,floors:1,fh:2.8,wall:'timber',wallC:'#d8c9a8',roof:'hip',roofH:2.2,roofC:DARK,trim:DARK,veranda:true,door:true,plinth:.6},r);b.pop();
  b.push(-60.5,0,-146,0);b.box('stone',0,0,0,.6,.6,.6,'#a59d8e');b.box('stone',0,.6,0,.25,.6,.25,'#a59d8e');b.box('stone',0,1.2,0,.7,.5,.7,'#bdb3a0');b.box('glass',0,1.3,0,.3,.3,.72,'#f3e3a8');b.hip('stone',0,1.7,0,.9,.9,.4,'#8f877a',.1,0);b.pop();}
 // raked-gravel court with three rocks (zen garden), fenced by a low bamboo screen
 {const x=-50,z=-162;b.box('soil',x,0,z,10,.05,7,'#d9d3c2');for(let i=0;i<14;i++)b.box('dressing',x,.055,z-3.3+i*.5,9.6,.01,.05,'#c4bca8');for(const [dx,dz,s] of [[-2.5,-1,1.1],[1.5,1.2,.8],[3,-1.5,.6]] as [number,number,number][]){b.box('stone',x+dx,0,z+dz,s*1.3,s,s,'#6f6a62');for(let i=0;i<10;i++){const a=i/10*Math.PI*2;b.box('dressing',x+dx+Math.cos(a)*s*1.2,.056,z+dz+Math.sin(a)*s*1.1,.3,.01,.05,'#c4bca8');}}
  for(let i=0;i<=20;i++)b.box('foliage',x-5+i*.5,0,z-3.8,.12,1.4,.12,'#9ab04a');}
 // palm house: glass barrel vault + central dome (light see-through panes), white ribs
 {const x=-94,z=-145;b.push(x,0,z,0);footprint(b,16,9,'palm-house');b.box('stone',0,-.3,0,16.4,.7,9.4,'#e8e2d2');const R=4.5;for(let i=0;i<12;i++){const a0=i/12*Math.PI,a1=(i+1)/12*Math.PI;b.quad('dressing',[-8,.4+Math.sin(a0)*R,Math.cos(a0)*R],[8,.4+Math.sin(a0)*R,Math.cos(a0)*R],[8,.4+Math.sin(a1)*R,Math.cos(a1)*R],[-8,.4+Math.sin(a1)*R,Math.cos(a1)*R],'#d6ecef');}
  for(let x2=-8;x2<=8;x2+=2)for(let i=0;i<12;i++){const a0=i/12*Math.PI,a1=(i+1)/12*Math.PI;b.quad('metal',[x2,.4+Math.sin(a0)*R,Math.cos(a0)*R],[x2,.4+Math.sin(a1)*R,Math.cos(a1)*R],[x2+.08,.4+Math.sin(a1)*R,Math.cos(a1)*R],[x2+.08,.4+Math.sin(a0)*R,Math.cos(a0)*R],'#f3f3ee');}
  b.dome('dressing',0,.4+R-.6,0,3.2,12,4,'#cfe6ea');b.pop();
  trees.add(x-4,0,z,1.1,'poplar','#4f8a3c',0);trees.add(x+4,0,z,1,'round','#3f7a3c',0);}
 // maples, cherries and bamboo
 for(let i=0;i<34;i++){const x=-102+r()*60,z=-168+r()*30;if(((x-POND.x)/(POND.rx+3))**2+((z-POND.z)/(POND.rz+3))**2<1||Math.hypot(x+88,z+158)<5||Math.hypot(x+94,z+145)<10||Math.hypot(x+56,z+153)<7||(x>-56&&z<-157))continue;
  const k=r();trees.add(x,0,z,.7+r()*.3,k<.25?'poplar':'round',k<.25?'#7aa84a':k<.6?pick(r,['#c8462a','#d8642a','#b83a2a']):pick(r,['#f0b8c8','#e8a0b8','#f8d0dc']),r()*6);}
 for(const [x,z] of [[-66,-139],[-76,-139]] as [number,number][]){b.push(x,0,z,0);lampPost(b,3,'#3a2a22');b.pop();}
 for(const [x,z,yaw] of [[-70,-144,Math.PI],[-82,-150,Math.PI/2]] as [number,number,number][]){b.push(x,0,z,yaw);bench(b,'#6e4a30');b.pop();}
 lowWall(b,[[-104,-169],[-40,-169]],1.2,'#8f877a',(x,z)=>t.height(x,z),.4);
}
export function buildObservatory(b:Builder,t:Terrain,trees:Trees){const r=rng(7201),G=(x:number,z:number)=>t.height(x,z);
 const x=92,z=-188,y=G(x,z);b.push(x,y,z,0);footprint(b,9,9,'observatory');
 b.cyl('stone',0,-2,0,4.6,2.3,16,'#bdb3a0');b.cyl('plaster',0,.3,0,4.2,5,16,'#f3f3ee',false);b.dome('metal',0,5.3,0,4.3,16,5,'#e8ecee');
 b.box('dressing',0,5.3,3.2,1.4,4.2,1.6,'#2a2e33');b.box('glass',0,2.6,4.23,.9,1.1,.05,'#3b4a52');b.panel('timber',0,1.4,4.24,1.1,2.2,'#2f4f5f');b.pop();
 b.push(x-9,y,z+2,Math.PI/2);house(b,{w:7,d:5,floors:1,wallC:'#efe9dc',roof:'flat',trim:'#2f4f5f',plinth:2.4},r);b.pop();
 b.push(x+7,y,z+5,0);tower(b,.6,6,'cone','#f3f3ee','#c43a2a',r,'plaster');b.pop();
 t.ribbon(b,[[71,-158],[76,-166],[86,-172],[90,-182]],2,'#c2b79c','path',.15,1);
 for(let i=0;i<8;i++){const a=r()*Math.PI*2,d=10+r()*6;trees.add(x+Math.cos(a)*d,G(x+Math.cos(a)*d,z+Math.sin(a)*d),z+Math.sin(a)*d,1,'conifer','#3f6a3c',r()*6);}
}
