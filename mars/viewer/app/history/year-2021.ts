import * as T from 'three';

import {Kit, BAY, layers} from './kit';
import {aluminet2021} from './photographic-corrections';
import {add2021OccupiedDetails} from './details-2021-occupied';


export function make2021(k:Kit){
 // Jan 27 near-nadir c1285 and next-day c6735: 8 (±1) 12-ft rack intervals along the long axis.
 // The 15-ft rack depth and equal-width bare-ground corridor are Gene's corrections, corroborated
 // by the near-overhead. The axes are local to the photographed hall, not a surveyed compass bearing.
 const d=8*BAY,wingDepth=4.572,offset=wingDepth,w=3*wingDepth,g=k.assembly('chiba','Main hall · MARS');
 g.userData.source='c1285 EXIF Jan 27 (posted Jan 28); c6735 Jan 28; c6730 Feb 3; Gene atlas notes on c6735/c6730';
 g.userData.measurement='8 ± 1 rack bays long, 3 × 4.572 m transverse; c1285 pixel ground control in year-2021/RECONSTRUCTION.md';
 // Dense c6730 104/112/339/352s: end bays contain five transverse shelf
 // strips, with the next bay reversing ascent. They are not whole-bay flat decks.
 // Height remains a nominal rack-ratio fit (about ±0.3m), not measured hole counts.
 const lower=[2.14,2.14,2.14,2.14,2.14,2.14,2.14,0];
 for(const side of [-1,1]){
  const wing=new T.Group();wing.userData={...g.userData,layer:layers.steel};wing.position.x=side*offset;wing.rotation.y=Math.PI/2;g.add(wing);
  k.frame(wing,8,2,4.8768,false,wingDepth);
  for(const child of wing.children.slice())if(child.name==='12 foot orange beam'&&child.position.y<1)wing.remove(child);
  // End-bay guard ties step with the transverse shelves (c6730 104/112s),
  // unlike the helper's six uninterrupted 16ft-high rows. Keep central ties.
  for(const beam of wing.children){
   if(beam.name!=='12 foot orange beam')continue;
   const bay=Math.round((beam.position.x+d/2)/BAY-.5);
   const transverse=side*beam.position.z;
   const strip=Math.max(0,Math.min(4,Math.floor((transverse+wingDepth/2-.001)/(wingDepth/5))));
   if(bay===0||bay===6)beam.position.y=2.14*(strip+1)/5+1.0;
   else if(side===1&&(bay===1||bay===5))beam.position.y=Math.min(4.7568,2.14+2.13*(5-strip)/5+1.0);
  }
  const shelf=(bay:number,y:number,strip?:number)=>{
   const z=d/2-(bay+.5)*BAY,depth=strip===undefined?wingDepth:wingDepth/5;
   // strip0 borders the central aisle; strip4 borders the outside utility/RV face.
   const x=side*(offset+(strip===undefined?0:-wingDepth/2+(strip+.5)*depth));
   k.deck(g,depth,BAY-.02,y,x,z,true);
   for(const dx of [-depth/2,depth/2])k.box(g,'terraced rack beam',[.08,.12,BAY],[x+dx,y-.06,z],'#b84c26',layers.steel);
  };
  for(let bay=0;bay<8;bay++){
   if(bay===0||bay===6){
    // Five broad shelf treads climb from the aisle to the outside of the rack.
    for(let strip=0;strip<5;strip++)shelf(bay,2.14*(strip+1)/5,strip);
   }else if(side===1&&(bay===1||bay===5)){
    // Return across the next bay toward the high platform. c6730 t112/96s.
    for(let strip=0;strip<5;strip++)shelf(bay,2.14+2.13*(5-strip)/5,strip);
   }else if(bay<6){
    shelf(bay,2.14);
    if(side===1&&[2,3,4].includes(bay))shelf(bay,4.27);
    // c6730 Feb3 t88/t272: TWO raised patches cover only the aisle-side
    // portion; exposed outer terraces remain. Bay placement is a photo fit.
    if(side===-1&&[1,5].includes(bay)){
     const roofDepth=wingDepth*.6,x=-(wingDepth/2+roofDepth/2),z=d/2-(bay+.5)*BAY;
     k.deck(g,roofDepth,BAY-.02,3.66,x,z,true);
     for(const dx of [-roofDepth/2,roofDepth/2])k.box(g,'partial roof support beam',[.08,.12,BAY],[x+dx,3.60,z],'#b84c26',layers.steel);
    }
   }
   // Rearmost bay is an open shade/dining frame, not a full plywood floor.
  }
  // Ground rooms occupy discrete bays, with openings between them; no continuous blank wall.
  for(const bay of [2,3,5,6]){
   const z=d/2-(bay+.5)*BAY,h=Math.max(1.1,lower[bay]-.08);
   k.wall(g,BAY-.1,h,side*w/2,z,h/2+.1,'#b99b75',Math.PI/2);
  }
  if(side===1){
   // Three banks, each FOUR columns × TWO rows (24 modules), plainly countable in c6735 128s.
   // The panels face out across the wing, not down the length of the campus.
   for(const bay of [2,3,4]){
    const bank=new T.Group();bank.userData={...g.userData,layer:layers.roof};bank.position.set(offset+.5,0,d/2-(bay+.5)*BAY);bank.rotation.y=Math.PI/2;g.add(bank);
    for(let col=0;col<4;col++)for(let row=0;row<2;row++){
     const xx=(col-1.5)*.86,zz=(row-.5)*.96,tilt=.62;
     const p=k.box(bank,'solar panel',[.835,.05,.935],[xx,4.9-zz*Math.sin(tilt),zz*Math.cos(tilt)],'#b8c2c7',layers.roof);p.rotation.x=tilt;
     const cells=k.box(bank,'photovoltaic cells',[.79,.008,.89],[xx,4.94-zz*Math.sin(tilt),zz*Math.cos(tilt)+.024],'#1c344b',layers.roof);cells.rotation.x=tilt;
    }
    for(const x of [-1.7,1.7])k.rod(bank,'solar timber triangle',[x,4.3,-.8],[x,5.5,-.8],.045,'#b99761',layers.roof);
   }
  }
 }
 // c6730 t96: plywood closes the aisle-side part of the solar rear end,
 // with an open outer passage; it is not a full-width room wall.
 k.wall(g,wingDepth*.58,2.1,offset-wingDepth*.21,-d/2,1.15,'#b99b75');
 // c6730 t88: one narrow plywood panel rises above the rear outer wall.
 k.wall(g,1.05,1.52,-w/2,d/2-5.2*BAY,2.90,'#c2a77e',Math.PI/2);
 // c6730 t112: partial room beneath solar return stairs, aisle stays open.
 k.wall(g,wingDepth*.62,1.75,offset+wingDepth*.19,d/2-2*BAY,.975,'#c2a77e');
 aluminet2021(k,g,wingDepth,d*.90);
 // Feb3 aerials: nearly taut silver middle close to the upper deck level,
 // short dropped end aprons. Heights remain photographic estimates.
 const shadeDrop=(z:number)=>1.25*Math.min(1,Math.max(0,(Math.abs(z)-d*.32)/(d*.13)));
 for(const o of g.children){
  if(o.name==='draped silver aluminet'){
   const mesh=o as T.Mesh;mesh.geometry=mesh.geometry.clone();
   const geo=mesh.geometry,p=geo.getAttribute('position');
   for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i),crossSag=1-Math.pow(2*x/wingDepth,2);
    p.setY(i,4.5-.12*crossSag-.025*Math.pow(Math.sin(z*Math.PI/BAY),2)-shadeDrop(z));
   }
   p.needsUpdate=true;geo.computeVertexNormals();geo.computeBoundingBox();geo.computeBoundingSphere();
   const material=(mesh.material as T.MeshStandardMaterial).clone();
   material.color.set('#e5e8e8');material.metalness=.15;material.roughness=.48;mesh.material=material;
   mesh.userData.source='c6730 Feb3 t88/112/272 and Gene aerials: taut silver middle near upper deck, dropped end aprons';
  }else if(o.name==='aluminet tie')o.position.y+=.25-shadeDrop(o.position.z);
 }

 const room=k.assembly('classroom','Open-sided seminar and projector area',[offset,0,2]);
 room.userData.source='2021/detail-review.jpg panorama and c6730 near interior; exact position along wing remains unverified';
 // The panorama shows folding tables, a whiteboard and a small display against exposed racks.
 for(const z of [-2.0,.2,2.4])k.table(room,0,z,2.1,.72,.76);
 k.wall(room,3.2,1.65,0,-3.45,1.38,'#e8e7dc');k.screen(room,.95,1.65,-3.38,.82);
 const lib=k.assembly('library','Library nook',[-offset,0,-6]);for(let i=0;i<4;i++){k.box(lib,'book shelf',[2.8,.05,.32],[0,.45+i*.43,-1]);for(let b=0;b<11;b++)k.box(lib,'book',[.07+(b%3)*.025,.22+(b%2)*.04,.2],[-1.25+b*.23,.6+i*.43,-1],['#b4af94','#806147','#4a6875','#ac6e57'][b%4]);}k.table(lib,0,1.3);
 lib.userData.source='2021/interior.jpg bookshelf; location within west rack wing is provisional';
 // No external front stair: c6730 ~336s shows both end faces and bare ground.
 // Five broad shelf treads and return terraces are modeled inside the rack footprint.
 // The enormous cutout MARS letters belong to the later Feb 16 state (cited photo image2-E12B6).
 const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle='#ddd9c6';ctx.font='bold 300px sans-serif';ctx.textAlign='center';
 // c1464: cutouts nearly reach the 16-ft rack top, with each pair spanning its wing.
 // Fit actual glyph bounds; a 220px font in a 256px canvas previously shrank them to ~10ft.
 for(const [text,x] of [['MA',175],['RS',849]] as const){const m=ctx.measureText(text)||{width:400,actualBoundingBoxAscent:220};const ascent=m.actualBoundingBoxAscent||220;ctx.save();ctx.translate(x,250);ctx.scale(332/(m.width||400),242/ascent);ctx.fillText(text,0,0);ctx.restore();}const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;const mat=new T.MeshStandardMaterial({map:texture,transparent:true,alphaTest:.4,side:T.DoubleSide});const sign=new T.Mesh(new T.PlaneGeometry(w+.2,4.4),mat);sign.position.set(0,2.4,d/2+.55);sign.userData.walkNoCollision=true;k.named(k.tag(g,sign,'MARS cutout letters',layers.wall),'mars-letters');sign.userData.walkNoCollision=true;
 const utility=k.assembly('outdoor-kitchen','Outdoor wash / utility line',[11,0,-1]);
 utility.userData.source='c6730 ~80/96s: low linear wash/storage counter, freestanding black tank, bathtub; no roofed kitchen building';
 for(const z of [-4,-1,2]){
  k.box(utility,'utility counter',[1.05,.08,2.9],[0,1.05,z],'#b99b75');
  k.wall(utility,2.9,.88,.52,z,.61,'#b79b77',Math.PI/2);
  for(const dz of [-1.35,1.35])k.rod(utility,'counter leg',[0,k.surface(utility,[[0,z+dz]],1),z+dz],[0,1.0,z+dz],.035);
 }
 const tank=new T.Mesh(new T.CylinderGeometry(.55,.55,1.8,16),k.mat('#252829'));tank.position.set(1.0,1,-5.2);k.tag(utility,tank,'black water tank',layers.detail);
 k.box(utility,'white bathtub',[.72,.53,1.6],[0,.55,-6.1],'#deded1');
 k.wall(utility,1.05,1.8,0,-5.15,1.1,'#ae8c5d');
 const container=k.assembly('container','White utility container',[10,0,12],Math.PI/2);k.box(container,'shipping container',[6.06,2.59,2.44],[0,1.3,0],'#cac9bc',layers.context);
 // Feb3 dense257: native photographed flower on the near end of the parallel
 // white container. The existing geometry/owner ID faces the hall-front end.
 const containerMural=new T.Mesh(new T.PlaneGeometry(2.20,2.20),k.photo('/history/2021/2021-container-flower.webp'));
 containerMural.position.set(-3.03-.025,1.30,0);containerMural.rotation.y=-Math.PI/2;
 k.tag(container,containerMural,'Mars flower front mural',layers.detail);containerMural.userData.walkNoCollision=true;
 containerMural.userData.source='c6730 Feb3 dense257 t128: native painted flower front, manually rectified, low source resolution';
 // Explicit Jan 27 camp placements from c1285, checked against c6735 frame 42. This snapshot
 // has seven clearly separated full-size travel trailers, a bus and smaller motor vehicles;
 // the former 15-trailer ellipse invented both extra units and an east-side residential arc.
 const trailers:[number,number,number,number][]=[
  [-12.6,6.5,-.35,9],[-15.8,-2.1,-.1,8.7],[-17.6,-12.6,-.7,8.4],
  [-14.4,-21.0,-1.0,8.2],[-7.3,-22.5,-1.5,8.2],[1.9,-23.0,-1.43,8.3],
  [23.9,12.2,.7,8.4],[15.7,14.2,1.5,7.6],
 ];
 trailers.forEach(([x,z,angle,length],i)=>{if(i===3)return; // rv-4's old pixel pick is empty ground; c1285 and c6735 ~164s show FIVE trailers in this arc.
  const rv=k.rv(`rv-${i+1}`,x,z,angle,length);rv.userData.source='c1285 Jan 27 near-nadir and supplied Jan28 obliques; individual roof fittings and facade variation, approximate dimensions';
  // Different roof vent counts and facade bands visible across the trailer arc.
  // Preserve the earlier shell and wheel IDs; these are observed fittings, not brands.
  for(const dz of (i===5?[-2.5,2.4]:i===1?[-2.1,2.2]:[-2.3])){
   k.box(rv,'trailer roof vent',[.45,.09,.45],[0,2.83,dz],'#e7e5dc',layers.context);
  }
  const side=i<6?1:-1;
  k.box(rv,'individual trailer entry door',[.035,1.68,.68],[side*1.2,1.47,-length*.27],'#edece2',layers.context);
  k.box(rv,'entry door window',[.04,.45,.4],[side*1.225,1.91,-length*.27],'#344347',layers.detail);
  k.box(rv,'entry step',[.55,.17,.83],[side*1.44,.17,-length*.27],'#484b48',layers.context);
  if(i===5){ // conspicuous dark curved side graphic on the bus-adjacent trailer.
   for(const s of [-1,1])for(let j=0;j<8;j++){
    const zz=-2.8+j*.65,yy=1.45+.20*Math.sin(j*.62);
    k.box(rv,'dark trailer swoop segment',[.035,.14,.67],[s*1.215,yy,zz],'#373b39',layers.detail);
   }
  }
  if(i===0||i===2)for(const s of [-1,1])k.box(rv,'trailer horizontal siding band',[.03,.035,length-.2],[s*1.215,2.46,0],'#aeb2ae',layers.detail);
 });
 // Distinct contextual fixtures visible in c1285 and c6735 ~164s; not inferred dwellings.
 const toilets=k.assembly('portable-toilets','Two blue portable toilets',[32.3,0,-.6]);
 toilets.userData.source='c1285 roof centers around original pixel3255,2011; independently c6735 ~164s';
 for(const x of [-.65,.65]){
  k.box(toilets,'blue toilet cubicle',[1.1,2.15,1.1],[x,1.16,0],'#439cad',layers.context);
  k.box(toilets,'white toilet roof',[1.15,.15,1.16],[x,2.3,0],'#d8e0d8',layers.context);
  k.box(toilets,'toilet door',[.91,1.85,.04],[x,1.12,.57],'#67b5bd',layers.context);
 }
 const dome=k.assembly('small-dome','Small partly covered geodesic dome',[32.6,0,-10.2]);
 dome.userData.source='c1285 and c6735 ~164s; approximate3.8m diameter,2m high';
 const rows=3,segments=10,r=1.9;
 for(let j=0;j<rows;j++)for(let i=0;i<segments;i++){
  const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments,t=j*Math.PI/(2*rows),u=(j+1)*Math.PI/(2*rows);
  const p:[number,number,number]=[r*Math.cos(t)*Math.cos(a),.1+r*Math.sin(t),r*Math.cos(t)*Math.sin(a)];
  const q:[number,number,number]=[r*Math.cos(t)*Math.cos(b),.1+r*Math.sin(t),r*Math.cos(t)*Math.sin(b)];
  const v:[number,number,number]=[r*Math.cos(u)*Math.cos(a+.3),.1+r*Math.sin(u),r*Math.cos(u)*Math.sin(a+.3)];
  k.rod(dome,'dome strut',p,q,.018,'#86837c',layers.context);k.rod(dome,'dome strut',p,v,.018,'#86837c',layers.context);
 }
 const bus=k.assembly('school-bus','Yellow school bus',[13.4,0,-20.3],.9);
 bus.userData.source='c1285 Jan 27 and c6735 frame 42; orientation and location from overhead';
 k.box(bus,'yellow school bus body',[2.5,2.45,8.9],[0,1.5,0],'#e0ad25',layers.context);
 k.box(bus,'school bus roof',[2.42,.12,8.65],[0,2.79,0],'#e6d7a2',layers.context);
 for(const side of [-1,1])for(let z=-3.3;z<=3.3;z+=1.1)k.box(bus,'school bus window',[.04,.65,.72],[side*1.27,2.02,z],'#34494d',layers.context);
 // Oblique views resolve the conventional hood, front windscreen, black rub
 // rails, folding passenger entry and separate axles of this yellow bus.
 k.box(bus,'school bus hood',[2.0,.88,1.3],[0,1.09,4.95],'#e6b126',layers.context);
 k.box(bus,'bus windscreen',[2.16,.82,.04],[0,2.04,4.49],'#38505a',layers.context);
 k.box(bus,'bus front grille',[1.4,.40,.045],[0,1.0,5.62],'#343939',layers.detail);
 k.box(bus,'bus front bumper',[2.22,.19,.16],[0,.65,5.67],'#313633',layers.context);
 for(const side of [-1,1]){
  for(const y of [1.1,1.35])k.box(bus,'school bus black rub rail',[.045,.08,8.55],[side*1.29,y,0],'#2b2e2b',layers.detail);
  k.box(bus,'bus headlamp',[.30,.25,.06],[side*.82,1.13,5.63],'#e7dfbb',layers.detail);
  k.box(bus,'bus side mirror',[.18,.46,.15],[side*1.55,2.15,4.15],'#303738',layers.detail);
  for(const z of [-2.7,3.2]){
   const wheel=new T.Mesh(new T.CylinderGeometry(.49,.49,.22,16),k.mat('#262925'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.21,.34,z);k.tag(bus,wheel,'school bus wheel',layers.context);
  }
 }
 k.box(bus,'school bus folding entry',[.04,1.73,.92],[1.3,1.43,3.47],'#314044',layers.context);
 k.box(bus,'school bus entry step',[.45,.18,.92],[1.48,.10,3.47],'#353a35',layers.context);
 const pop=k.assembly('popup-camper','Pop-up tent camper',[24.8,0,-27.1],Math.PI/2);
 pop.userData.source='c1285 roof pick and c6727 ~272s show fold-out canvas camper, distinct from the seven full-size trailers and two vans';
 k.box(pop,'popup camper chassis',[2.15,.58,3.4],[0,.55,0],'#d8dcd3',layers.context);
 k.box(pop,'canvas camper sides',[2.1,1.35,4.8],[0,1.5,0],'#b9b8a7',layers.context);
 k.box(pop,'popup white roof',[2.2,.12,3.5],[0,2.21,0],'#e0e0d6',layers.context);
 for(const side of [-1,1])k.box(pop,'canvas window',[.035,.83,2.5],[side*1.07,1.62,0],'#5c605c',layers.context);
 for(const [id,x,z,a] of [['van-1',30.4,-22.9,.14],['van-2',39.3,-15.9,.05]] as const){
  const van=k.assembly(id,'Camper van · approximate',[x,0,z],a);
  van.userData.source='c1285 Jan 27 overhead; distinguishes camper vans from travel trailers';
  k.box(van,'camper van body',[2.2,2.5,5.3],[0,1.55,0],'#e3e2d8',layers.context);
  k.box(van,'camper van windscreen',[1.85,.76,.04],[0,2.05,2.69],'#425359',layers.context);
  for(const side of [-1,1]){
   k.box(van,'camper side glazing',[.04,.65,1.8],[side*1.12,1.96,-.55],'#405256',layers.context);
   for(const z of [-1.65,1.65]){const wheel=new T.Mesh(new T.CylinderGeometry(.34,.34,.17,12),k.mat('#282c29'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.06,.18,z);k.tag(van,wheel,'camper van wheel',layers.context);}
  }
  if(id==='van-1')k.box(van,'camper roof luggage rack',[1.78,.12,2.2],[0,2.87,-.4],'#393e3b',layers.context);
 }
 // c1285 original roof centres mapped through the existing four rack corners.
 // Roof parallax and uncertain headings: ±2m; no manufacturer inference.
 const cars:[string,number,number,number,string,boolean][]=[
  ['olive-pickup',-4.78,-27.33,1.4,'#65735c',true],['red-pickup',2.84,-30.33,1.5,'#a94949',true],
  ['dark-suv',10.21,-27.3,.1,'#334c51',false],['green-car',39.95,-21.41,1.2,'#3e6460',false],
  ['red-suv',40.36,-8.87,.15,'#9e363c',false],['orange-work-pickup',18.69,3.47,1.3,'#b16b3f',true],
  ['white-pickup',34.54,9.08,.6,'#d9deda',true],['front-green-car',9.3,18.78,1.5,'#365553',false],
 ];
 for(const [id,x,z,a,color,pickup] of cars){
  const car=k.assembly(id,pickup?'Observed pickup truck':'Observed passenger vehicle',[x,0,z],a);
  car.userData.source='c1285 Jan27 original roof-center fit; c6735 and supplied obliques distinguish pickups/cars; heading and dimensions approximate';
  k.box(car,'vehicle lower body',[1.9,.68,4.6],[0,.68,0],color,layers.context);
  k.box(car,'vehicle cab',[1.75,.72,pickup?1.8:2.65],[0,1.33,pickup?.25:0],color,layers.context);
  k.box(car,'vehicle windscreen',[1.55,.50,.04],[0,1.37,pickup?1.17:1.35],'#3c525b',layers.context);
  for(const side of [-1,1]){
   k.box(car,'vehicle side window',[.035,.46,pickup?1.35:2.1],[side*.895,1.38,pickup?.25:0],'#3c525b',layers.detail);
   for(const zz of [-1.4,1.4]){const wh=new T.Mesh(new T.CylinderGeometry(.33,.33,.17,12),k.mat('#272a28'));wh.rotation.z=Math.PI/2;wh.position.set(side*.92,.17,zz);k.tag(car,wh,'vehicle wheel',layers.context);}
  }
  if(pickup)k.box(car,'open pickup bed',[1.48,.04,1.6],[0,1.035,-1.42],'#414844',layers.context);
 }
 add2021OccupiedDetails(k);
}
