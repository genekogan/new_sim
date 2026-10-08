import {Builder,rng,pick,PLASTER,ROOFS,TIMBER,STONE} from './kit.ts';
import {house,lampPost,bench,fence,tower,lowWall} from './buildings.ts';
import type {Terrain} from './terrain.ts';
import type {Trees} from './trees.ts';
/** A leafy suburb east of the old town (x 174..244, z 30..110): two loops with
 * a cul-de-sac, detached houses on lawns, picket fences, driveways, garages,
 * mailboxes, pools, trampolines, sheds, hedges and street trees. Plus a castle
 * ruin on a far north-western crag as a skyline landmark. */
export const SUBURB_BOUNDS=[172,28,250,118] as const;
export const SUBURB_STREETS:[number,number][][]=[
 [[172,34],[244,34]],[[172,74],[244,74]],[[172,112],[244,112]],[[206,34],[206,112]],
];
const CASTLE={x:-165,z:-185};
export function suburbPads(t:Terrain){t.pad(172,28,250,118,0,8);t.pad(CASTLE.x-16,CASTLE.z-16,CASTLE.x+16,CASTLE.z+16,undefined,10);}
export function buildSuburb(b:Builder,t:Terrain,trees:Trees){const r=rng(6101);
 for(const s of SUBURB_STREETS)t.ribbon(b,s,6,'#8f8a80','path',.05+SUBURB_STREETS.indexOf(s)*.002,2);
 // sidewalks (lighter strips) along both sides
 for(const [[ax,az],[bx,bz]] of SUBURB_STREETS){const ux=bx-ax,uz=bz-az,L=Math.hypot(ux,uz),px=-uz/L,pz=ux/L;for(const s of [-1,1])t.ribbon(b,[[ax+px*4*s,az+pz*4*s],[bx+px*4*s,bz+pz*4*s]],1.6,'#c9c2b2','path',.06,2);}
 // lots: along each street, both sides, 14 m frontage
 const lots:{x:number;z:number;yaw:number}[]=[];
 const along=(ax:number,az:number,bx:number,bz:number)=>{const L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L;for(let s=8;s<L-6;s+=13)for(const side of [1,-1]){const x=ax+ux*s-uz*12*side,z=az+uz*s+ux*12*side;
   if(x<174||x>248||z<40||z>106)continue;if(lots.some(l=>Math.hypot(l.x-x,l.z-z)<12))continue;if(SUBURB_STREETS.some(st=>{const [[sx,sz],[ex,ez]]=st,dx=ex-sx,dz=ez-sz,L2=dx*dx+dz*dz,q=Math.max(0,Math.min(1,((x-sx)*dx+(z-sz)*dz)/L2));return Math.hypot(x-sx-dx*q,z-sz-dz*q)<8.4;}))continue;
   lots.push({x,z,yaw:Math.atan2(ax+ux*s-x,az+uz*s-z)});}};
 for(const [[ax,az],[bx,bz]] of SUBURB_STREETS)along(ax,az,bx,bz);
 (globalThis as {__suburbLots?:number}).__suburbLots=lots.length;
 lots.forEach((l,i)=>{const rr=rng(6200+i*13);b.push(l.x,0,l.z,l.yaw);
  const w=7+rr()*1.5,d=7+rr()*2;house(b,{w,d,floors:1+(rr()<.55?1:0),wall:rr()<.35?'timber':'plaster',wallC:pick(rr,[...PLASTER,'#e8e2d2','#b9c9d6','#d9e0c8']),roof:pick(rr,['gable','hip','cross','gable'] as const),roofC:pick(rr,ROOFS),
   shutters:rr()<.5,veranda:rr()<.35,dormer:rr()<.3,chimney:rr()<.5,flowerbox:rr()<.4,plinth:.5,trim:pick(rr,['#f3eee2','#2f4f5f','#7a2f2a','#355e3b'])},rr);
  // garage + driveway to the street
  b.push(w/2+2.1,0,0,0);house(b,{w:3.4,d:6,floors:1,fh:2.7,wallC:'#e8e2d2',roof:'gable',roofC:'#5a5f66',noWindows:true,barnDoor:true,door:false,plinth:.3},rr);b.pop();
  b.box('path',w/2+2.1,0,d/2+3.2,3,.06,6.4,'#a8a296');b.box('path',-.0,0,d/2+3,1.2,.05,6,'#c9c2b2');
  // front lawn fence + mailbox
  if(rr()<.6){const fz=d/2+6.1;for(const [a0,a1] of [[-w/2-1,-.8],[.8,w/2+.8]] as [number,number][])for(let x=a0;x<=a1;x+=.3)b.box('timber',x,0,fz,.07,.9,.05,'#f3eee2');b.box('timber',(-w/2-1-.8)/2,.6,fz,w/2+.2,.06,.04,'#f3eee2');b.box('timber',(.8+w/2+.8)/2,.6,fz,w/2,.06,.04,'#f3eee2');}
  b.box('metal',.9,0,d/2+6.3,.08,1,.08,'#3a3a3a');b.box('metal',.9,1,d/2+6.3,.26,.24,.45,pick(rr,['#c43a2a','#2f4f5f','#3a3a3a','#e8e2d2']));
  // back garden: one of pool / trampoline / shed+veg / swing set; hedge at the back
  const k=Math.floor(rr()*4);b.push(0,0,-d/2-5.5,0);
  if(k===0){b.box('stone',0,-.05,0,6,.2,3.6,'#e8e2d2');b.box('water',0,.12,0,5.4,.02,3,'#4aa8c8');b.box('timber',-4.2,0,0,1.6,.4,.7,'#efe9dc');}
  else if(k===1){for(let q=0;q<8;q++){const a=q/8*Math.PI*2;b.box('metal',Math.cos(a)*1.7,0,Math.sin(a)*1.7,.06,.8,.06,'#2a2a2a');}b.cyl('dressing',0,.8,0,1.8,.06,12,'#2a2a2a');b.cyl('dressing',0,.86,0,1.5,.02,12,'#3d5a80');}
  else if(k===2){b.box('timber',2,0,0,2,2,1.6,pick(rr,TIMBER));b.shed('roof',2,2,0,2,1.6,.3,'#3f4448',.1);for(let q=0;q<3;q++)b.box('foliage',-1.5+q*1.1,0,0,.8,.4,2.4,'#6f9a4e');}
  else{b.box('metal',-1.2,0,0,.08,2.1,.08,'#c43a2a');b.box('metal',1.2,0,0,.08,2.1,.08,'#c43a2a');b.box('metal',0,2.1,0,2.5,.08,.08,'#c43a2a');b.box('timber',-.5,.5,0,.45,.05,.2,'#e0b04a');b.box('timber',.5,.5,0,.45,.05,.2,'#e0b04a');}
  b.pop();b.box('foliage',0,0,-d/2-8.8,w+6,1.4,.9,'#4f7a3c');
  if(rr()<.7)trees.add(l.x-Math.sin(l.yaw)*(d/2+4)+Math.cos(l.yaw)*(-w/2-2),0,l.z-Math.cos(l.yaw)*(d/2+4)-Math.sin(l.yaw)*(-w/2-2),.9+rr()*.4,pick(rr,['round','fruit','conifer'] as const),pick(rr,['#6f9a4e','#5f8a46','#7d9a4a','#3f6a3c']),rr()*6);
  b.pop();});
 // street trees and lamps along the sidewalks
 for(const [[ax,az],[bx,bz]] of SUBURB_STREETS){const L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L;for(let s=5;s<L;s+=11)for(const side of [1,-1]){const x=ax+ux*s-uz*5.4*side,z=az+uz*s+ux*5.4*side;
   if(((s/11)|0)%2)trees.add(x,0,z,.9,'round',pick(r,['#6f9a4e','#7fa84f','#5f8a46']),r()*6);else{b.push(x,0,z,0);lampPost(b,4,'#3a3f42');b.pop();}}}
 
 t.ribbon(b,[[160,54],[172,54]],3,'#9d9584','path',.05);t.ribbon(b,[[172,34],[160,26],[160,-8]],3,'#9d9584','path',.05);
 void fence;void STONE;
}
export function buildCastle(b:Builder,t:Terrain,trees:Trees){const r=rng(6301),G=(x:number,z:number)=>t.height(x,z);
 const y=G(CASTLE.x,CASTLE.z),st='#9a9284';b.push(CASTLE.x,y,CASTLE.z,.5);
 // curtain walls (with broken gaps), four round towers (one ruined), a keep
 const W=22;for(const [x0,z0,x1,z1,h] of [[-W/2,-W/2,W/2,-W/2,7],[W/2,-W/2,W/2,W/2,6],[W/2,W/2,2,W/2,7],[-4,W/2,-W/2,W/2,5],[-W/2,W/2,-W/2,-W/2,6.5]] as [number,number,number,number,number][]){
  const L=Math.hypot(x1-x0,z1-z0),n=Math.ceil(L/2);for(let i=0;i<n;i++){const u=(i+.5)/n,x=x0+(x1-x0)*u,z=z0+(z1-z0)*u,hh=h-(r()<.25?r()*3:0);b.push(x,0,z,-Math.atan2(z1-z0,x1-x0));b.box('stone',0,-2,0,L/n+.05,hh+2,1.4,st);if(i%2===0)b.box('stone',0,hh,0,L/n*.5,.8,1.4,st);b.pop();}}
 for(const [x,z,h] of [[-W/2,-W/2,12],[W/2,-W/2,10],[W/2,W/2,13],[-W/2,W/2,6]] as [number,number,number][]){b.cyl('stone',x,-2,z,2.6,h+2,10,st,true);for(let i=0;i<10;i+=2){const a=i/10*Math.PI*2;b.box('stone',x+Math.cos(a)*2.4,h,z+Math.sin(a)*2.4,.9,.8,.9,st);}}
 b.box('stone',2,-2,-2,9,18,9,'#a39b8c');for(let i=0;i<4;i++)b.box('stone',2+(i%2?3.6:-3.6),16,-2+(i<2?3.6:-3.6),1.4,1.2,1.4,'#a39b8c');
 b.push(2,0,-2,0);for(const [yaw] of [[0],[Math.PI/2],[Math.PI],[-Math.PI/2]] as [number][]){b.push(0,0,0,yaw);for(const yy of [6,10.5])b.panel('glass',0,yy,4.53,.5,1.2,'#151515');b.pop();}b.pop();
 b.pop();
 for(let i=0;i<20;i++){const a=r()*Math.PI*2,d=20+r()*14,x=CASTLE.x+Math.cos(a)*d,z=CASTLE.z+Math.sin(a)*d;trees.add(x,G(x,z),z,1.1,'conifer','#3f6a3c',r()*6);}
 void tower;void lowWall;
}
export const SUBURB_EXPLORE=[{id:'suburb',camera:[178,12,66],target:[206,1,80]},{id:'castle-ruin',camera:[-130,30,-140],target:[-165,15,-185]}];
