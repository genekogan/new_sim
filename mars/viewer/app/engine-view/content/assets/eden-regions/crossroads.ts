import {Builder,rng,pick,PLASTER,ROOFS} from './kit.ts';
import {house,lampPost,bench,footprint} from './buildings.ts';
import {car} from './life.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** A roadside crossroads hamlet on the east country road (x 266..300, z −34..14): a petrol station with a
 * canopy and pumps, a pub with a beer garden, a bus shelter, a billboard, cottages and telegraph poles. */
export const CROSS_BOUNDS=[264,-36,302,16] as const;
const Y=11;
export function crossPads(t:Terrain){t.pad(266,-34,300,14,Y,8);}
export function buildCrossroads(b:Builder,t:Terrain,trees:Trees){const r=rng(9601),G=(x:number,z:number)=>t.height(x,z);
 // side lane north–south through the crossroads
 t.ribbon(b,[[283,-34],[283,14]],3.4,'#a39a86','path',.1,2);
 // petrol station (south-west quadrant)
 {b.push(274,Y,-2,0);footprint(b,10,8,'petrol');b.box('path',0,0,0,12,.06,10,'#8f8a80');for(const x of [-4,4])for(const z of [-2.5,2.5])b.box('metal',x,0,z,.3,4.2,.3,'#efe9dc');b.box('metal',0,4.2,0,10,.6,7,'#e8e2d2');b.box('metal',0,4.25,3.52,10,.5,.04,'#c43a2a');
  for(const x of [-2,2]){b.box('metal',x,0,0,.8,1.6,.5,'#c43a2a');b.box('dressing',x,1.1,.26,.5,.35,.02,'#f3eee2');b.box('stone',x,0,0,1.4,.2,1,'#bdb3a0');}
  b.pop();b.push(274,Y,-11,0);house(b,{w:7,d:5,floors:1,fh:3,wallC:'#f3eee2',roof:'flat',flatC:'#c43a2a',awning:'#c43a2a',door:true,plinth:1},r);b.pop();
  b.box('metal',268,Y,4.5,.25,6,.25,'#5a5f66');b.box('dressing',268,Y+5,4.5,1.6,1.6,.15,'#c43a2a');b.box('dressing',268,Y+5.1,4.6,1.2,1,.02,'#f3eee2');}
 // pub with a hanging sign and beer garden (north-east quadrant)
 {b.push(292,Y,-14,Math.PI/2);house(b,{w:12,d:8,floors:2,wall:'stone',wallC:'#b9ae96',roof:'gable',roofC:'#3f4a3a',trim:'#2f4f3f',chimney:true,flowerbox:true,shutters:true,plinth:1},r);b.pop();
  b.box('timber',286.7,Y+2.8,-11,.08,.08,1.4,'#3a2a22');b.box('dressing',286.7,Y+2.1,-10.6,.06,1,.8,'#2f4f3f');
  for(let i=0;i<4;i++){const x=291+(i%2)*3.4,z=-24-Math.floor(i/2)*3;b.box('timber',x,Y+.72,z,1.8,.06,.8,'#8a5a36');for(const s of [-1,1])b.box('timber',x,Y+.42,z+s*.65,1.8,.05,.28,'#8a5a36');b.cyl('metal',x,Y+.78,z,.03,1.5,4,'#ddd',false);b.cone('cloth',x,Y+2.2,z,1.3,.45,8,i%2?'#2f4f3f':'#efe9dc');}
  trees.add(297,Y,-30,1.1,'round','#5f8a46',0);}
 // bus shelter + stop sign on the main road, billboard on the hill
 {b.push(280,Y,-9.5,Math.atan2(38,12)+Math.PI);b.box('metal',0,0,0,3.2,.08,1.4,'#5a5f66');for(const x of [-1.5,1.5])b.box('metal',x,0,-.6,.08,2.4,.08,'#2f4f5f');b.box('dressing',0,0,-.65,3,2.3,.04,'#cfe6ea');b.box('metal',0,2.4,0,3.4,.1,1.6,'#2f4f5f');b.box('timber',0,.45,-.4,2.6,.06,.4,'#8a5a36');
  b.box('metal',2.3,0,.5,.07,2.6,.07,'#5a5f66');b.box('dressing',2.3,2.4,.5,.6,.6,.05,'#3d5a80');b.pop();}
 {const x=262,z=-28,y=G(x,z);b.box('metal',x-2.5,y,z,.25,5,.25,'#5a5f66');b.box('metal',x+2.5,y,z,.25,5,.25,'#5a5f66');b.box('dressing',x,y+3.4,z,7,3,.15,'#f0c040');b.box('dressing',x-1,y+3.9,z+.08,4,1.2,.02,'#3d5a80');b.box('dressing',x+2.2,y+3.4,z+.08,1.6,1.6,.02,'#c43a2a');}
 // cottages along the side lane
 for(const [x,z,yaw] of [[276,8,Math.PI/2],[290,8,-Math.PI/2],[290,-34+2,-Math.PI/2]] as [number,number,number][]){const rr=rng(Math.round(x*3+z));b.push(x,Y,z,yaw);house(b,{w:7,d:6,floors:1+(rr()<.5?1:0),wallC:pick(rr,PLASTER),roof:pick(rr,['gable','hip'] as const),roofC:pick(rr,ROOFS),veranda:rr()<.5,chimney:true,plinth:1.5},rr);b.pop();}
 // telegraph poles along the main road through the hamlet; parked cars at the pumps and pub
 for(let i=0;i<8;i++){const x=258+i*6,z=-17.3+i*1.9+3.5;b.cyl('timber',x,G(x,z),z,.12,7,5,'#5b4636',false);b.box('timber',x,G(x,z)+6.4,z,.12,.12,1.6,'#5b4636');}
 b.push(274,Y,-2,0);car(b,'#2f4f5f');b.pop();b.push(287,Y,-26,0);car(b,'#d9a441');b.pop();b.push(287,Y,-20.5,0);car(b,'#3a3a3a',true);b.pop();
 for(const [x,z] of [[279,2],[286,-5]] as [number,number][]){b.push(x,Y,z,0);lampPost(b,4,'#3a3f42');b.pop();}
 b.push(292,Y,-7,0);bench(b,'#2f4f3f');b.pop();
}
