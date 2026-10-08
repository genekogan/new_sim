import {Builder,rng,pick,PLASTER,ROOFS} from './kit.ts';
import {house,lampPost,bench,silo,fence} from './buildings.ts';
import {outside,type Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** Countryside that ties the districts to "elsewhere": a railway with a
 * station and a parked train, wind turbines on the far ridges, country roads
 * leaving the map with scattered farmsteads, plus old-town café life. */
export const RAIL:[number,number][]=[[112,-49],[150,-49],[176,-50],[200,-56],[226,-74],[246,-98]];
export const STATION_BOUNDS=[114,-60,170,-40] as const;
export const COUNTRY_ROADS:[number,number][][]=[
 [[238,-20],[262,-16],[300,-4],[360,10],[430,20]],// from the hill village summit loop east over the hills
 [[-12,-128],[-14,-150],[-6,-190],[10,-250],[20,-320]],// north from the campus
 [[-100,-69.5],[-180,-70],[-240,-58],[-320,-40],[-430,-30]],// west past the campsite
 [[206,134],[244,128.5]],// east along the coast from the resort to the cliff village harbour lane
];
export function countryPads(t:Terrain){
 t.pad(114,-60,170,-40,0,5);
 // rail bed: levelled corridor, then the roads (corridors follow natural ground across their width)
 t.road(RAIL.slice(1),4.5,4);for(const r of COUNTRY_ROADS)t.road(r,4,3,r===COUNTRY_ROADS[0]);
}
const segAt=(pts:[number,number][],s:number)=>{for(let i=1;i<pts.length;i++){const [ax,az]=pts[i-1],[bx,bz]=pts[i],L=Math.hypot(bx-ax,bz-az);if(s<=L)return{x:ax+(bx-ax)*s/L,z:az+(bz-az)*s/L,ux:(bx-ax)/L,uz:(bz-az)/L};s-=L;}return null;};
const lengthOf=(pts:[number,number][])=>{let L=0;for(let i=1;i<pts.length;i++)L+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);return L;};
export function buildRailway(b:Builder,t:Terrain,trees:Trees){const r=rng(4101),G=(x:number,z:number)=>t.height(x,z);
 const rail=RAIL,L=lengthOf(rail);
 // buffer stop at the west end of the line
 b.box('stone',111,0,-49,1,1,3.4,'#8f877a');b.box('dressing',111.6,.6,-49,.3,.5,2.8,'#c43a2a');
 // ballast bed, sleepers and two rails
 t.ribbon(b,rail,3.2,'#8f877a','stone',.05,2);
 for(let s=0;s<L;s+=.75){const p=segAt(rail,s);if(!p)break;const y=G(p.x,p.z)+.1;b.push(p.x,y,p.z,Math.atan2(p.ux,p.uz));b.box('timber',0,0,0,2.4,.14,.24,'#5b4636');b.pop();}
 for(const off of [-.72,.72]){const pts=rail.map(([x,z],i)=>{const a=rail[Math.max(0,i-1)],c=rail[Math.min(rail.length-1,i+1)],ux=c[0]-a[0],uz=c[1]-a[1],l=Math.hypot(ux,uz);return [x-uz/l*off,z+ux/l*off] as [number,number];});
  t.ribbon(b,pts,.09,'#6a6f72','stone',.3,1.5);}
 // station: platform, building with a clock and a long canopy, benches, lamps, name board
 b.box('stone',142,0,-45.6,40,.85,3.6,'#c4b9a2');b.box('stone',142,.85,-44,40,.06,.3,'#f0e04a');
 b.push(142,0,-40.5,Math.PI);house(b,{w:18,d:6,floors:2,fh:3.4,wall:'stone',wallC:'#b9785a',roof:'hip',roofC:'#5a5f66',trim:'#efe9dc',band:true,chimney:true},r);b.pop();
 b.box('dressing',142,7.2,-43.6,1.4,1.4,.1,'#f3eee2');
 for(let x=124;x<=160;x+=6)b.box('metal',x,.85,-46.6,.14,3.2,.14,'#2f4f5f');b.shed('roof',142,4.05,-45.7,38,4.4,.4,'#2f4f5f',.2);
 for(const x of [128,136,148,156]){b.push(x,.85,-44.8,Math.PI);bench(b,'#2f4f5f');b.pop();}
 b.box('dressing',142,3.1,-47.3,6,.6,.06,'#2f4f5f');b.box('dressing',142,3.15,-47.34,5.6,.4,.02,'#f3eee2');
 for(const x of [122,162]){b.push(x,.85,-44.5,0);lampPost(b,3.2,'#2f4f5f');b.pop();}
 t.ribbon(b,[[109,-42],[124,-41],[132,-38]],3,'#9d9584','path',.05);
 // the train at the platform: locomotive + 4 carriages along the rail (heading east)
 {let s=4;const cars:[number,string][]=[[11,'#2f6f5f'],[13,'#c43a2a'],[13,'#c43a2a'],[13,'#c43a2a'],[13,'#c43a2a']];
  cars.forEach(([len,c],i)=>{const p=segAt(rail,s+len/2)!;const y=G(p.x,p.z)+.35;b.push(p.x,y,p.z,Math.atan2(p.ux,p.uz));
   b.box('metal',0,.25,0,2.6,.5,len,'#2a2a2a');b.box('metal',0,.75,0,2.8,2.6,len-.3,c);b.box('roof',0,3.35,0,2.6,.3,len-.4,'#4a4a4a');
   if(i===0){b.box('metal',0,.75,len/2-.3,2.7,1.6,.4,'#efe9dc');b.cyl('metal',0,3.6,len/2-2.4,.3,.6,6,'#2a2a2a');b.panel('glass',0,2.6,len/2-.12,2,.8,'#2d3c46');}
   else for(let k=-len/2+1.4;k<len/2-1;k+=1.6){b.push(0,0,0,Math.PI/2);b.panel('glass',k,2.3,1.42,1.1,.9,'#2d3c46');b.pop();b.push(0,0,0,-Math.PI/2);b.panel('glass',-k,2.3,1.42,1.1,.9,'#2d3c46');b.pop();}
   for(const z of [-len/2+1.6,len/2-1.6])for(const x of [-.8,.8]){b.push(x,.2,z,Math.PI/2);b.pushRot('z',Math.PI/2);b.cyl('dressing',0,-.15,0,.45,.3,8,'#1e1e1e');b.pop();b.pop();}
   b.pop();s+=len+.6;});}
 // level crossing where the hill lane meets the line, with barriers and a signal
 {const p={x:196.6,z:-53.5};b.push(p.x,G(p.x,p.z),p.z,.4);for(const s of [-1,1]){b.box('metal',s*3.4,0,s*-2.6,.25,1.1,.25,'#efe9dc');b.box('dressing',s*3.4-s*2.2,1,s*-2.6,4.4,.12,.12,'#c43a2a');}b.box('metal',4,0,2.6,.12,3,.12,'#2f3436');b.box('dressing',4,2.8,2.6,.5,.5,.1,'#c43a2a');b.pop();}
 // tunnel portal where the line enters the eastern hills
 {const [ax,az]=RAIL[RAIL.length-2],[ex,ez]=RAIL[RAIL.length-1],yaw=Math.atan2(ax-ex,az-ez),y=G(ex,ez);b.push(ex,y,ez,yaw);
  b.box('stone',-3.6,-1,0,2.4,7,2.5,'#8f877a');b.box('stone',3.6,-1,0,2.4,7,2.5,'#8f877a');b.box('stone',0,4.4,0,9.6,2.6,2.5,'#8f877a');b.box('stone',0,6.8,-.4,11,.5,3.2,'#a59d8e');
  b.panel('glass',0,2.2,-1.0,4.8,4.4,'#151515');b.box('stone',-8,-1,-2,6,5,1.4,'#8f877a');b.box('stone',8,-1,-2,6,5,1.4,'#8f877a');b.pop();}
 // telegraph poles along the line
 for(let s=40;s<L;s+=30){const p=segAt(rail,s);if(!p)break;const x=p.x-p.uz*4,z=p.z+p.ux*4;b.cyl('timber',x,G(x,z),z,.12,6.5,5,'#5b4636',false);b.box('timber',x,G(x,z)+6,z,.12,.12,1.4,'#5b4636');}
 for(let i=0;i<16;i++){const p=segAt(rail,80+r()*(L-90));if(!p)continue;const s=r()<.5?-1:1,x=p.x-p.uz*(7+r()*6)*s,z=p.z+p.ux*(7+r()*6)*s;trees.add(x,G(x,z),z,.9+r()*.4,r()<.5?'poplar':'round','#5f8a46',r()*6);}
 void fence;
}
export function buildCountry(b:Builder,t:Terrain,trees:Trees,free:(x:number,z:number)=>boolean){const r=rng(4201),G=(x:number,z:number)=>t.height(x,z);
 for(const road of COUNTRY_ROADS)t.ribbon(b,road,4,'#a39a86','path',.12,2);
 // farmsteads along the country roads (house + barn + silo + orchard), spaced and set back from the road
 const placed:[number,number][]=[];let n=0;for(const road of COUNTRY_ROADS){const L=lengthOf(road);for(let s=50;s<L-20;s+=55+r()*40){const p=segAt(road,s);if(!p)continue;const side=r()<.5?-1:1,off=18+r()*8,x=p.x-p.uz*off*side,z=p.z+p.ux*off*side;
   if(outside(x,z)<40||!free(x,z)||placed.some(([px,pz])=>Math.hypot(px-x,pz-z)<34))continue;placed.push([x,z]);const yaw=Math.atan2(p.x-x,p.z-z),y0=t.natural(x,z);if(y0>40||y0<.3)continue;const rr=rng(4300+n++);
   b.push(x,G(x,z),z,yaw);house(b,{w:8+rr()*3,d:6.5,floors:1+(rr()<.5?1:0),plinth:3,wallC:pick(rr,PLASTER),roof:pick(rr,['gable','hip','cross'] as const),roofC:pick(rr,ROOFS),chimney:true,veranda:rr()<.5},rr);
    b.push(11,0,-3,Math.PI/2);house(b,{w:10,d:7,floors:1,fh:4.2,plinth:3,wall:'timber',wallC:pick(rr,['#8e3326','#6e4a30','#5a6a3a','#b08a5f']),roof:'gable',roofC:'#4a4440',noWindows:true,barnDoor:true,door:false},rr);b.pop();
    if(rr()<.6){b.push(-8,0,-6,0);silo(b,1.3,8+rr()*3,'#b8c0c0','#8a9090');b.pop();}b.pop();
   t.ribbon(b,[[x+Math.sin(yaw)*4,z+Math.cos(yaw)*4],[p.x-p.uz*2.2*side,p.z+p.ux*2.2*side]],2,'#b6a582','path',.12,1.5);
   for(let k=0;k<8;k++){const tx=x+(rr()-.5)*24,tz=z+(rr()-.5)*24;if(Math.hypot(tx-x,tz-z)<9)continue;trees.add(tx,G(tx,tz),tz,.8+rr()*.3,'fruit',pick(rr,['#7d9a4a','#6f9a4e']),rr()*6);}}}
 // wind turbines on the far ridges (static), white towers 34 m
 for(const [x,z,yaw] of [[-250,-150,.4],[-215,-175,.5],[-180,-200,.45],[300,-120,-.6],[330,-90,-.5],[360,-60,-.55],[-300,40,1.2],[-320,90,1.1]] as [number,number,number][]){const y=G(x,z);b.push(x,y,z,yaw);
  b.cyl('metal',0,-1,0,1.4,36,8,'#eef0f0',false,.7);b.box('metal',0,35,-.6,1.6,1.6,3.6,'#eef0f0');b.push(0,35.8,1.3,0);for(let k=0;k<3;k++){const a=k*Math.PI*2/3+x*.01;b.quad('metal',[0,0,0],[Math.cos(a+.08)*1.4,Math.sin(a+.08)*1.4,.05],[Math.cos(a+.02)*19,Math.sin(a+.02)*19,.05],[Math.cos(a-.02)*19,Math.sin(a-.02)*19,0],'#f6f7f7');}b.pop();b.pop();}
}
/** Café life on the old-town plaza and quays (tables, umbrellas, bikes, planters). */
export function buildTownLife(b:Builder,t:Terrain,trees:Trees){const r=rng(4401);
 const table=(x:number,z:number,c:string)=>{b.cyl('metal',x,0,z,.05,.72,5,'#2f3436',false);b.cyl('timber',x,.72,z,.45,.05,8,'#efe9dc');for(let k=0;k<3;k++){const a=k*2.1+r(),cx=x+Math.cos(a)*.75,cz=z+Math.sin(a)*.75;b.box('timber',cx,.45,cz,.4,.05,.4,'#6e4a30');b.box('timber',cx+Math.cos(a)*.18,.45,cz+Math.sin(a)*.18,.05,.45,.4,'#6e4a30');}
  b.cyl('metal',x,.77,z,.03,1.5,4,'#ddd',false);b.cone('cloth',x,2.1,z,1.25,.45,8,c);};
 for(let i=0;i<6;i++)table(128+i*4.4,65,i%2?'#c45a4a':'#f3eee2');for(let i=0;i<6;i++)table(128+i*4.4,81,i%2?'#2f6f5f':'#f3eee2');
 // bikes along the quays (frame + two wheels)
 const bike=(x:number,z:number,yaw:number,c:string)=>{b.push(x,0,z,yaw);for(const s of [-.5,.5]){b.push(0,.35,s,0);b.pushRot('z',Math.PI/2);b.cyl('dressing',0,-.02,0,.34,.04,10,'#1e1e1e',false);b.pop();b.pop();}b.box('dressing',0,.55,0,.05,.05,1,c);b.box('dressing',0,.35,.05,.05,.45,.05,c);b.box('dressing',0,.85,-.42,.05,.05,.5,'#1e1e1e');b.pop();};
 for(let i=0;i<18;i++){const z=-28+r()*80;if(Math.abs(z-2)<3||Math.abs(z-29)<3)continue;bike(r()<.5?127.2:145.8,z,(r()-.5)*.4,pick(r,['#c43a2a','#3d5a80','#2f2f2f','#e0b04a','#5aa070','#efe9dc']));}
 // planters with flowers by the arcades
 for(let x=122;x<158;x+=6){for(const z of [62.6,83.4]){b.box('stone',x,0,z,1,.45,.5,'#bdb3a0');b.box('flower',x,.45,z,.9,.25,.4,pick(r,['#d0485a','#e8a33c','#c45ab0','#f0e04a']));}}
 // street furniture: hydrants, bins, post boxes along the promenade and avenues; shop signs on the market row
 const hydrant=(x:number,z:number)=>{b.cyl('metal',x,0,z,.14,.6,6,'#c43a2a');b.dome('metal',x,.6,z,.14,6,2,'#c43a2a');b.box('metal',x,.38,z,.42,.1,.1,'#c43a2a');};
 const bin=(x:number,z:number)=>{b.cyl('metal',x,0,z,.28,.9,8,'#355e3b');b.cyl('metal',x,.9,z,.3,.06,8,'#2a3a2a');};
 const post=(x:number,z:number,yaw:number)=>{b.push(x,0,z,yaw);b.box('metal',0,0,0,.1,.8,.1,'#2a2a2a');b.box('metal',0,.8,0,.45,.55,.35,'#c43a2a');b.box('dressing',0,1.2,.18,.28,.04,.02,'#1e1e1e');b.pop();};
 for(let z=-36;z<110;z+=24){hydrant(112,z+3);bin(106.6,z+11);}
 for(let x=-90;x<100;x+=30){hydrant(x+6,93.6);bin(x+15,87.6);}for(let x=-90;x<100;x+=30){hydrant(x+6,-72.6);bin(x+15,-66.6);}
 post(126,-41,0);post(112,94,Math.PI/2);post(158,70,-Math.PI/2);post(-10,-71.4,0);
 void trees;void t;
}
export const COUNTRY_EXPLORE=[{id:'railway-station',camera:[128,6,-30],target:[146,2,-48]},{id:'turbines-north-west',camera:[-120,25,-90],target:[-215,30,-175]}];
