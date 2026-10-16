import {Builder,type Col} from './kit.ts';
import * as F from './furniture.ts';
const {C}=F;
const PI=Math.PI;
/** New buildings with real interiors on free native ground (Y0). Each is authored in a local frame:
 * origin at the footprint centre, front wall (with the door) facing local +Z, interior floor at FLOOR.
 * `yaw` turns that frame into the world (0: front faces +Z/south, -π/2: front faces -X/west,
 * π/2: front faces +X/east, π: front faces -Z/north). Shells (walls/floor/roof/glass) of every new
 * building are merged into one shared Builder; each interior gets its own. */
export const FLOOR=.15,T=.2;
type Side='front'|'back'|'left'|'right';
type Opening={side:Side;at:number;w:number;sill?:number;top?:number};
export type NewBuilding={id:string;name:string;cx:number;cz:number;yaw:number;w:number;d:number;h:number;
 ext:Col;int:Col;roof:Col;trim:Col;sign:Col;door:Opening;windows:Opening[];interior(b:Builder):void;
 exterior?(b:Builder):void};
/** World rect [x0,z0,x1,z1] of a local rect in a building frame (yaw multiples of π/2). */
export function worldRect(k:NewBuilding,x0:number,z0:number,x1:number,z1:number):[number,number,number,number]{
 const c=Math.round(Math.cos(k.yaw)),s=Math.round(Math.sin(k.yaw));const pts=[[x0,z0],[x1,z1]].map(([x,z])=>[k.cx+c*x+s*z,k.cz-s*x+c*z]);
 return [Math.min(pts[0][0],pts[1][0]),Math.min(pts[0][1],pts[1][1]),Math.max(pts[0][0],pts[1][0]),Math.max(pts[0][1],pts[1][1])];}
export const interiorRect=(k:NewBuilding)=>worldRect(k,-k.w/2+T,-k.d/2+T,k.w/2-T,k.d/2-T);
export const footprint=(k:NewBuilding)=>worldRect(k,-k.w/2-.3,-k.d/2-.3,k.w/2+.3,k.d/2+.3);
/** Local-frame door clear zone (1 m inside, 1 m outside). */
export const doorZone=(k:NewBuilding)=>{const dz=k.d/2;return worldRect(k,k.door.at-k.door.w/2-.2,dz-T-1,k.door.at+k.door.w/2+.2,dz+1);};
/** Draw the shell of `k` into `b` (in world space; frames pushed here). */
export function shell(b:Builder,k:NewBuilding){b.label='shell '+k.id;b.push(k.cx,0,k.cz,k.yaw);try{
 const {w,d,h}=k,top=FLOOR+h;
 // plinth/floor slab + boards
 b.box(0,0,0,w,FLOOR,d,'#9d968a','floor');
 for(let z=-d/2+T,i=0;z<d/2-T-1e-6;z+=.22,i++){const dd=Math.min(.22,d/2-T-z)-.006;b.box(0,FLOOR,z+dd/2+.003,w-2*T,.01,dd,i%3===0?'#a77c52':i%3===1?'#b88d60':'#ae8358','floor');}
 // ceiling
 b.box(0,top,0,w,.11,d,k.int,'wall');  // E2 #9: its top stays inside the eaves trim below (no shared plane)
 // walls: each side as a run along its own axis with openings cut
 const sides:[Side,number][]= [['front',w],['back',w],['left',d-2*T],['right',d-2*T]];
 for(const [side,len] of sides){
  const ops=[...(k.door.side===side?[{...k.door,sill:0,top:2.25}]:[]),...k.windows.filter(o=>o.side===side).map(o=>({...o,sill:o.sill??.95,top:o.top??2.15}))].sort((a,b)=>a.at-b.at);
  // frame: run along local X' with wall centre at z' = depth; map to building frame
  const yaw=side==='front'?0:side==='back'?PI:side==='left'?-PI/2:PI/2,depth=(side==='front'||side==='back'?d:w)/2-T/2;
  b.at(0,0,0,yaw,()=>{
   const seg=(a:number,c:number,y0:number,y1:number)=>{if(c-a<1e-3||y1-y0<1e-3)return;const x=(a+c)/2;
    b.box(x,FLOOR+y0,depth+T/4,c-a,y1-y0,T/2,k.ext,'wall');b.box(x,FLOOR+y0,depth-T/4,c-a,y1-y0,T/2,k.int,'wall');};
   let x=-len/2;for(const o of ops){const a=o.at-o.w/2,c=o.at+o.w/2;seg(x,a,0,h);seg(a,c,0,o.sill!);seg(a,c,o.top!,h);
    if(o.sill!>0){b.box(o.at,FLOOR+o.sill!,depth,o.w,o.top!-o.sill!,.02,'#bcd6e0','glass');b.box(o.at,FLOOR+o.sill!-.04,depth+T/2+.05,o.w+.1,.05,.14,k.trim,'furn');
     b.box(o.at,FLOOR+o.sill!,depth+.03,.05,o.top!-o.sill!,.05,k.trim,'furn');b.box(o.at,FLOOR+(o.sill!+o.top!)/2,depth+.03,o.w,.05,.05,k.trim,'furn');}
    // E2 #9: the frame stands 5 mm proud of the wall's reveal (jambs into the opening, head below the lintel) so the two never share a face
    else{for(const sx of[-1,1])b.box(o.at+sx*(o.w/2+.035),FLOOR+.002,depth,.08,o.top!+.058,T+.04,k.trim,'furn');b.box(o.at,FLOOR+o.top!-.005,depth,o.w+.16,.085,T+.04,k.trim,'furn');}
    x=c;}
   seg(x,len/2,0,h);});
 }
 // gable roof, ridge along local X, eaves .3
 b.at(0,top+.12,0,PI/2,()=>b.prism(0,0,0,d+.6,Math.min(1.8,d*.38),w+.6,k.roof,'roof'));
 b.box(0,top+.01,0,w+.08,.11,d+.08,k.trim,'roof');  // E2 #9: the eaves trim sits 1 cm above the ceiling's underside, not in its plane
 // step, sign board, lantern
 const dz=d/2;b.box(k.door.at,0,dz+.3,k.door.w+.5,FLOOR,.6,'#8f8a80','floor');
 b.label='sign '+k.id;b.box(k.door.at,FLOOR+2.38,dz+.05,Math.min(1.6,k.door.w+.6),.36,.06,k.sign,'furn');b.box(k.door.at,FLOOR+2.45,dz+.085,Math.min(1.3,k.door.w+.3),.22,.01,C.cream,'glow');
 for(const sx of[-1,1]){b.box(k.door.at+sx*(k.door.w/2+.35),FLOOR+1.9,dz+.1,.06,.06,.16,C.iron,'furn');b.box(k.door.at+sx*(k.door.w/2+.35),FLOOR+1.72,dz+.2,.14,.22,.14,C.lampWarm,'glow');}
 k.exterior?.(b);
}finally{b.pop();}}
// ---------------------------------------------------------------- the buildings
const W=-PI/2;// front faces west
export const NEW_BUILDINGS:readonly NewBuilding[]=[
 {id:'int-cafe',name:'Corner café',cx:101.5,cz:25,yaw:W,w:8,d:6,h:3,ext:'#e7d2b0',int:'#f3ead9',roof:'#9b4a35',trim:'#3f5f57',sign:'#3f5f57',
  door:{side:'front',at:0,w:1.2},windows:[{side:'front',at:-2.6,w:1.8,sill:.7},{side:'front',at:2.6,w:1.8,sill:.7},{side:'left',at:.6,w:1.4},{side:'right',at:.8,w:1.4}],
  interior(b){
   b.label='cafe counter';b.at(-1,0,-1.6,0,()=>{F.counter(b,4,.66,1.02,C.ash,'#3f5f57');b.at(-1.2,1.02,0,0,()=>F.espresso(b));b.at(.4,1.02,.05,0,()=>F.cakeStand(b,C.rose));b.at(1.2,1.02,.05,0,()=>F.cakeStand(b,C.ochre));
    b.at(-.3,1.02,0,0,()=>{b.box(0,0,0,.6,.35,.45,'#d9ecf2','glass');b.box(0,0,0,.6,.02,.45,C.ash);for(let i=0;i<5;i++)F.loaf(b,-.22+i*.11,.03,(i%2)*.1-.05,()=>(i*.37)%1);});
    b.at(1.75,1.02,.1,0,()=>{b.box(0,0,0,.3,.18,.25,C.iron);b.box(0,.18,-.05,.26,.12,.04,C.screen,'glow');});});
   b.label='cafe back shelves';b.at(-2.4,0,-2.8+.18,0,()=>F.shelving(b,2.2,1.9,.34,4,C.walnut,(x,y,j)=>{if(j===0)b.box(x,y,0,.16,.2,.2,C.terracotta);else if(j<3)b.at(x,y,0,0,()=>F.cup(b,j===1?C.white:C.teal));else b.cyl(x,y,0,.06,.06,.2,[C.ochre,C.rust,C.sage][(x*10|0)&1?1:2],'furn',8);},.2));
   b.label='cafe menu';b.at(.6,0,-2.8,0,()=>F.chalkboard(b,1.2,.8,2.4));
   b.label='cafe stools';for(const x of[-2.6,-1.8])b.at(x,0,-.85,PI,()=>F.stool(b,.7,C.iron,C.walnut));
   b.label='cafe tables';for(const [x,z] of[[-2.7,1.3],[2.5,1.35]] as const)b.at(x,0,z,0,()=>{F.roundTable(b,.4,.75,C.cream,C.iron);b.at(-.62,0,0,PI/2,()=>F.chair(b,C.iron,C.rust));b.at(.62,0,0,-PI/2,()=>F.chair(b,C.iron,C.rust));b.at(0,.75,0,0,()=>{F.cup(b,C.white);b.at(.16,0,.08,0,()=>F.plate(b,C.bread));b.at(-.05,0,-.2,0,()=>F.candle(b,.1));});});
   b.label='cafe sofa nook';b.at(3.8-.43,0,-1.55,-PI/2,()=>F.sofa(b,1.8,C.teal));b.at(2.55,0,-1.55,0,()=>{F.table(b,.5,.9,.45,C.walnut,C.walnut);b.at(0,.45,.1,0,()=>F.cup(b,C.ochre));});b.at(2.2,0,-2.8+.17,0,()=>F.bookshelf(b,.9,1.6,.3,C.walnut,91));
   b.label='cafe rug';b.at(2.9,0,-1.55,0,()=>F.rug(b,1.7,1.8,C.rust,C.cream));
   b.label='cafe plants';b.at(-3.35,0,2.35,0,()=>F.plant(b,1.1));b.at(3.3,0,2.3,0,()=>F.tallPlant(b));
   b.label='cafe pendants';for(const [x,z] of[[-2.7,1.3],[2.5,1.35],[-1.6,-1.6],[.2,-1.6],[2.8,-1.5]] as const)b.at(x,0,z,0,()=>F.pendant(b,3,.8,C.lampWarm,.17));
   b.label='cafe pictures';b.at(-3.8,0,-1.2,PI/2,()=>F.picture(b,.8,.6,1.9,95));
  },
  exterior(b){b.label='ext cafe awning';b.tilt(0,FLOOR+2.88,3.68,2.2,.05,.9,.35,0,C.rose,'cloth');for(const sx of[-1,1])b.tilt(sx*1.1,FLOOR+2.73,3.62,.03,.4,.9,.35,0,C.cream,'cloth');
   b.label='ext cafe planters';for(const x of[-1.25,1.25])b.at(x,0,3.35,0,()=>F.plant(b,.8,C.slate));}},
 {id:'int-music-room',name:'Music room',cx:101.1,cz:59,yaw:W,w:7,d:5,h:3.1,ext:'#cfd8dc',int:'#efe6d2',roof:'#4b5258',trim:'#7a4a6a',sign:'#7a4a6a',
  door:{side:'front',at:0,w:1.2},windows:[{side:'front',at:-2.2,w:1.3},{side:'front',at:2.2,w:1.3},{side:'left',at:0,w:1.6},{side:'right',at:0,w:1.6},{side:'back',at:1.6,w:1.2,sill:1.3}],
  interior(b){
   b.label='music piano';b.at(-1.6,0,-2.3+.31,0,()=>F.piano(b,'#2a1d18'));
   b.label='music drums';b.at(2.2,0,-1.25,-PI/5,()=>F.drumKit(b));
   b.label='music guitars';for(const [z,c] of[[-.4,C.oak],[.3,C.rust]] as const)b.at(3.3-.25,0,z,-PI/2,()=>{b.box(0,0,0,.3,.06,.3,C.iron);F.guitar(b,c);});
   b.label='music stands and chairs';for(const [x,z,a] of[[-1.2,.4,.5],[0,.6,0],[1.2,.4,-.5]] as const){b.at(x,0,z-.55,a,()=>F.musicStand(b));b.at(x,0,z+.2,a+PI,()=>F.chair(b,C.walnut,C.plum));}
   b.label='music rug';b.at(0,0,.6,0,()=>F.roundRug(b,1.7,C.plum,C.ochre));
   b.label='music panels';for(const [x,side] of[[-3.3,PI/2],[3.3,-PI/2]] as const)for(const z of[-1.5,1.5])b.at(x,0,z,side,()=>{b.box(0,1,.03,.8,1.1,.06,side>0?C.teal:C.navy);});
   b.label='music shelf';b.at(-3.3+.17,0,0,PI/2,()=>F.shelving(b,1.3,1.2,.32,3,C.walnut,(x,y)=>{b.box(x,y,0,.03,.3,.24,[C.cream,C.ochre,C.white][(x*7|0)&1?0:2]);},.06));
   b.label='music pendants';for(const [x,z] of[[-1.6,-1.2],[0,.6],[2,-.8]] as const)b.at(x,0,z,0,()=>F.pendant(b,3.1,.9,C.lampHot,.18));
   b.label='music plant';b.at(-3.0,0,2,0,()=>F.plant(b,1));
  }},
 {id:'int-games-room',name:'Games room',cx:86.5,cz:-19.5,yaw:0,w:5,d:4,h:2.9,ext:'#d49a8c',int:'#f2e6cf',roof:'#5a5f66',trim:'#3b5a7a',sign:'#3b5a7a',
  door:{side:'front',at:.4,w:1.1},windows:[{side:'front',at:-1.5,w:1.2},{side:'left',at:0,w:1.2},{side:'right',at:.2,w:1.2},{side:'back',at:1.2,w:1.2}],
  interior(b){
   b.label='games chess';b.at(-1.45,0,-.75,0,()=>{F.chessTable(b);b.at(0,0,-.58,0,()=>F.chair(b,C.walnut,C.sage));b.at(0,0,.58,PI,()=>F.chair(b,C.walnut,C.sage));});
   b.label='games card table';b.at(1.15,0,-.45,0,()=>{F.table(b,.85,.85,.74,'#2e6b4e',C.walnut);for(const [x,z,a] of[[0,-.62,0],[0,.62,PI],[-.62,0,PI/2],[.62,0,-PI/2]] as const)b.at(x,0,z,a,()=>F.chair(b,C.walnut,C.rust));
    b.at(0,.74,0,0,()=>{for(let i=0;i<4;i++)b.box(-.2+i*.13,0,(i%2)*.1-.05,.06,.004,.09,C.white);b.box(.25,0,.2,.07,.03,.1,C.navy);});});
   b.label='games shelf';b.at(.05,0,-1.8+.17,0,()=>F.shelving(b,1.1,1.4,.32,3,C.oak,(x,y,j)=>{b.box(x,y,0,.18,.06+(j%2)*.05,.26,[C.rust,C.navy,C.ochre,C.sage][(j+(x*10|0))&3]);},.22));
   b.label='games darts';b.at(2.3,0,1.05,-PI/2,()=>{b.box(0,1.5,.02,.48,.48,.04,C.black);b.box(0,1.56,.045,.36,.36,.01,'#e9dcc0');b.box(0,1.7,.055,.1,.1,.01,C.rust);});
   b.label='games armchair';b.at(-1.75,0,1.15,PI*.8,()=>F.armchair(b,C.ochre));
   b.label='games pendants';for(const [x,z] of[[-1.45,-.75],[1.15,-.45]] as const)b.at(x,0,z,0,()=>F.pendant(b,2.9,.75,C.lampWarm,.2));
   b.label='games rug';b.at(-.2,0,-.3,0,()=>F.rug(b,3.6,2.2,C.navy,C.ochre,C.cream));
  }},
 {id:'int-bakery',name:'Bakery',cx:77.5,cz:-15.5,yaw:PI/2,w:5,d:4,h:2.9,ext:'#f0e2c4',int:'#f6eedc',roof:'#b5603c',trim:'#8c5a2c',sign:'#8c5a2c',
  door:{side:'front',at:0,w:1.1},windows:[{side:'front',at:-1.6,w:1.1,sill:.8},{side:'front',at:1.6,w:1.1,sill:.8},{side:'left',at:.6,w:1},{side:'right',at:.6,w:1}],
  interior(b){
   b.label='bakery oven';b.at(-1.4,0,-1.2,0,()=>F.oven(b,1.6));
   b.label='bakery bread shelves';b.at(1.25,0,-1.8+.2,0,()=>F.shelving(b,1.9,1.8,.4,4,C.pine,(x,y,j)=>{F.loaf(b,x,y,0,()=>((x*13.7+j*.31)%1+1)%1);},.17));
   b.label='bakery counter';b.at(1.3,0,.25,0,()=>{F.counter(b,1.7,.6,.98,C.ash,'#8c5a2c');b.at(-.45,.98,0,0,()=>{b.cyl(0,0,0,.2,.16,.12,'#b98d5a','furn',10);for(let i=0;i<4;i++)F.loaf(b,-.08+i*.06,.06,(i%2)*.08-.04,()=>i*.3);});b.at(.25,.98,0,0,()=>F.cakeStand(b,C.cream));b.at(.65,.98,.05,0,()=>{b.box(0,0,0,.26,.16,.22,C.brass);});});
   b.label='bakery kneading table';b.at(-1.9,0,.65,0,()=>{F.table(b,.7,1.2,.86,C.ash,C.pine);b.at(0,.86,0,0,()=>{b.ball(0,.04,-.15,.16,.06,.14,'#efe2c8');b.cylX(.1,.04,.3,.035,.38,C.pine,'furn',8);b.box(0,0,.05,.5,.006,.5,'#f4efe4');});});
   b.label='bakery sacks';for(const [x,z] of[[-.95,1.45],[-1.35,1.5]] as const)b.at(x,0,z,0,()=>F.sack(b,'#e2d2b0'));
   b.label='bakery pendants';for(const [x,z] of[[1.2,.3],[-1.8,.6]] as const)b.at(x,0,z,0,()=>F.pendant(b,2.9,.7,C.lampWarm,.16));
  },
  exterior(b){b.label='ext bakery bench';b.at(1.7,0,2.75,0,()=>F.bench(b,1.2,C.pine));}},
 // WN5: four more kinds of building on the remaining free native sites (occupancy raster, 1 m margin).
 {id:'int-chapel',name:'Chapel',cx:86.5,cz:82,yaw:W,w:4.4,d:5.4,h:3.4,ext:'#f1ede4',int:'#f6f1e6',roof:'#4d5560',trim:'#6b4f3a',sign:'#6b4f3a',
  door:{side:'front',at:0,w:1.2},windows:[{side:'left',at:-1.2,w:.7,sill:1,top:2.7},{side:'left',at:1.1,w:.7,sill:1,top:2.7},{side:'right',at:-1.2,w:.7,sill:1,top:2.7},{side:'right',at:1.1,w:.7,sill:1,top:2.7},{side:'back',at:0,w:.9,sill:1.5,top:2.9}],
  interior(b){
   b.label='chapel pews';for(const z of[-.6,.3,1.1])for(const sx of[-1,1])b.at(sx*1.05,0,z,PI,()=>F.pew(b,1.3,C.walnut));
   b.label='chapel runner';b.at(0,0,.35,0,()=>F.rug(b,.8,3.4,C.rust,C.ochre));
   b.label='chapel altar';b.at(0,0,-2.05,0,()=>{b.box(0,0,0,1.3,.95,.5,C.cream);b.box(0,.95,0,1.36,.04,.56,C.white,'cloth');b.box(0,.6,.27,.5,.35,.01,C.rust,'cloth');
    for(const x of[-.45,.45])b.at(x,.99,0,0,()=>{b.cyl(0,0,0,.05,.06,.04,C.brass,'furn',8);F.candle(b,.28);});b.at(0,.99,-.1,0,()=>F.plant(b,.6,C.brass,C.leaf2));});
   b.label='chapel candle stands';for(const sx of[-1,1])b.at(sx*1.55,0,-1.85,0,()=>{b.cyl(0,0,0,.12,.16,.04,C.brass,'furn',8);b.cyl(0,.04,0,.025,.025,1.05,C.brass,'furn',6);b.cyl(0,1.09,0,.1,.06,.04,C.brass,'furn',8);F.candle(b,.22);});
   b.label='chapel lectern';b.at(-1.2,0,-1.45,PI*.85,()=>{b.box(0,0,0,.36,.06,.32,C.walnut);b.box(0,.06,0,.1,1,.1,C.walnut);b.tilt(0,1.1,0,.5,.04,.38,-.35,0,C.walnut);});
   b.label='chapel flowers';for(const sx of[-1,1])b.at(sx*1.55,0,2.1,0,()=>F.plant(b,.9,C.slate,C.leaf2));
   b.label='chapel pendants';for(const z of[-1.2,.9])b.at(0,0,z,0,()=>F.pendant(b,3.4,1.1,C.lampWarm,.16));
  },
  exterior(b){b.label='shell int-chapel';// the bell-cote is part of the shell (it sits into the ridge)
   const top=FLOOR+3.4+.12+1.8;b.box(0,top-.25,0,.7,.95,.7,'#f1ede4','wall');b.cone(0,top+.7,0,.62,.8,'#4d5560','roof',4);
   b.box(0,top+.05,.36,.34,.5,.02,'#3a3a3a','furn');b.ball(0,top+.18,.32,.12,.14,.06,C.brass);
   b.label='ext chapel bench';b.at(1.5,0,3.45,PI,()=>F.bench(b,1.1,C.walnut));}},
 {id:'int-clinic',name:'Clinic',cx:64.5,cz:-8.5,yaw:0,w:4.4,d:5.4,h:2.9,ext:'#e8eef0',int:'#f4f7f6',roof:'#5d6b73',trim:'#3f8a6a',sign:'#3f8a6a',
  door:{side:'front',at:-.6,w:1.1},windows:[{side:'front',at:1.25,w:1.1},{side:'left',at:.6,w:1.2},{side:'right',at:-.8,w:1.2},{side:'back',at:-.9,w:1}],
  interior(b){
   b.label='clinic desk';b.at(1.15,0,1.15,PI,()=>{F.desk(b,1.1,.55,C.ash);b.at(0,.75,0,0,()=>{b.box(-.2,0,0,.3,.04,.22,C.cream);b.cyl(.25,0,.05,.05,.05,.1,C.teal,'furn',8);});});
   b.label='clinic desk chair';b.at(1.15,0,.45,0,()=>F.chair(b,C.iron,C.sage));
   b.label='clinic waiting chairs';for(const z of[.3,.95,1.6])b.at(-1.7,0,z,PI/2,()=>F.chair(b,C.oak,C.teal));
   b.label='clinic cot';b.at(-1.15,0,-1.45,0,()=>F.cot(b,C.sage));
   b.label='clinic screen';b.at(.05,0,-1.6,PI/2,()=>F.screenFold(b,C.cream));
   b.label='clinic cabinet';b.at(1.25,0,-2.5+.24,0,()=>{F.cabinet(b,1.2,.9,.42,C.white,C.iron);b.at(0,.9,0,0,()=>{for(let i=0;i<4;i++)b.cyl(-.4+i*.25,0,0,.06,.06,.18+(i%2)*.06,[C.white,C.teal,C.ochre,C.rose][i],'furn',8);});});
   b.label='clinic basin';b.at(1.75,0,-1.2,-PI/2,()=>F.washbasin(b));
   b.label='clinic clock';b.at(-.6,0,-2.5,0,()=>F.clock(b,2.2));
   b.label='clinic plant';b.at(-1.65,0,2.2,0,()=>F.plant(b,.9));
   b.label='clinic pendants';for(const [x,z] of[[1.1,1],[-1.1,-1.3]] as const)b.at(x,0,z,0,()=>F.pendant(b,2.9,.7,C.lampHot,.17));
  },
  exterior(b){b.label='ext clinic cross';b.box(1.25,FLOOR+2.5,2.79,.42,.12,.02,'#3fae6a','glow');b.box(1.25,FLOOR+2.35,2.79,.12,.42,.02,'#3fae6a','glow');
   b.label='ext clinic bench';b.at(1.3,0,3.4,PI,()=>F.bench(b,1.2,C.oak));}},
 {id:'int-bathhouse',name:'Bathhouse and laundry',cx:83.5,cz:-10.5,yaw:0,w:4.4,d:5.4,h:2.9,ext:'#cfe3e6',int:'#eef4f2',roof:'#6e7c86',trim:'#2f6f8a',sign:'#2f6f8a',
  door:{side:'front',at:0,w:1.1},windows:[{side:'front',at:-1.4,w:.9,sill:1.3},{side:'front',at:1.4,w:.9,sill:1.3},{side:'left',at:-1,w:1,sill:1.4},{side:'right',at:-1,w:1,sill:1.4},{side:'back',at:0,w:1.2,sill:1.5}],
  interior(b){
   b.label='bath tubs';for(const sx of[-1,1])b.at(sx*1.25,0,-1.55,0,()=>F.bathtub(b));
   b.label='bath screen';b.at(0,0,-1.75,PI/2,()=>F.screenFold(b,C.teal));
   b.label='bath basins';for(const z of[.1,.9])b.at(1.79,0,z,-PI/2,()=>F.washbasin(b));
   b.label='bath towels';b.at(-1.83,0,.3,PI/2,()=>F.shelving(b,1.2,1.5,.34,4,C.pine,(x,y,j)=>{b.box(x,y,0,.26,.08+(j%2)*.04,.24,[C.cream,C.teal,C.white,C.rose][(j+(x*10|0))&3],'cloth');},.3));
   b.label='laundry tub';b.at(-1.4,0,1.75,0,()=>{F.barrel(b,.3,.6,C.pine);b.cyl(0,.6,0,.27,.27,.02,'#b9d3da','furn',10);});
   b.label='laundry basket';b.at(1.05,0,2.15,0,()=>{b.cyl(0,0,0,.24,.2,.36,C.hay,'furn',10);b.box(0,.32,0,.32,.08,.32,C.white,'cloth');});
   b.label='bath bench';b.at(.2,0,.35,0,()=>F.bench(b,1.1,C.pine));
   b.label='bath mirror';b.at(1.99,0,.5,-PI/2,()=>F.mirror(b,.6,.7,1.9));
   b.label='bath plant';b.at(1.6,0,1.95,0,()=>F.tallPlant(b,C.slate));
   b.label='bath pendants';for(const z of[-1.4,.8])b.at(0,0,z,0,()=>F.pendant(b,2.9,.7,C.lampWarm,.17));
  },
  exterior(b){b.label='ext laundry line';for(const z of[-1.5,1.5])b.box(2.9,0,z,.06,1.9,.06,C.oak);b.box(2.9,1.85,0,.01,.01,3,C.white);
   for(const [z,c] of[[-1,C.teal],[-.35,C.white],[.3,C.rose],[.95,C.ochre]] as const)b.box(2.9,1.45,z,.01,.4,.45,c,'cloth');}},
 {id:'int-potting-shed',name:'Potting shed',cx:44,cz:82.5,yaw:PI,w:4.4,d:4.4,h:2.75,ext:'#7f8f5a',int:'#e4d9c2',roof:'#8a5a3c',trim:'#e9e2cf',sign:'#4f6a3a',
  door:{side:'front',at:.6,w:1.1},windows:[{side:'front',at:-1.2,w:1,sill:.9},{side:'left',at:0,w:2.2,sill:.9},{side:'right',at:0,w:2.2,sill:.9}],
  interior(b){
   b.label='potting bench';b.at(0,0,-2+.42,0,()=>{F.workbench(b,2.4,.7,11);b.at(0,.94,0,0,()=>{for(let i=0;i<6;i++)b.cyl(-1+i*.38,0,(i%2)*.15-.08,.09,.07,.12,C.terracotta,'furn',8);for(let i=0;i<3;i++)b.at(-.8+i*.75,.12,.1,0,()=>F.plant(b,.45,C.terracotta,C.leaf2));});});
   b.label='potting shelves';b.at(-1.79,0,.3,PI/2,()=>F.shelving(b,1.4,1.6,.34,4,C.pine,(x,y,j)=>{b.cyl(x,y,0,.08,.06,.12,C.terracotta,'furn',8);if(j%2)b.ball(x,y+.16,0,.09,.07,.09,C.leaf,'furn');},.24));
   b.label='potting sacks';for(const [x,z] of[[1.6,-.5],[1.6,.1]] as const)b.at(x,0,z,0,()=>F.sack(b,'#8a6a48'));
   b.label='potting can';b.at(1.55,0,.75,0,()=>{b.cyl(0,0,0,.13,.13,.26,'#6f8f8a','furn',10);b.tilt(.16,.2,0,.24,.03,.03,0,.7,'#6f8f8a');});
   b.label='potting tall plant';b.at(-1.5,0,1.5,0,()=>F.tallPlant(b));
   b.label='potting stool';b.at(.2,0,-.75,0,()=>F.stool(b,.62,C.oak,C.pine));
   b.label='potting pendant';b.at(0,0,-.6,0,()=>F.pendant(b,2.75,.6,C.lampWarm,.16));
  },
  exterior(b){b.label='ext potting pots';for(const [x,s] of[[-1.4,.9],[-1.75,.7],[1.75,.8]] as const)b.at(x,0,2.75,0,()=>F.plant(b,s,C.terracotta,C.leaf2));
   b.label='ext potting crate';b.at(-.8,0,2.85,.3,()=>F.crate(b,.45));}},
];
