import * as T from 'three';

import {Kit, BAY, layers} from './kit';
import {frontage2024} from './photographic-corrections';


import {roofRails} from './historical-helpers';
export function make2024(k:Kit){
 // Jan 22 near-nadir c30786: the *main roof* is 750×385 source pixels, or
 // 6×3 nominal 12-ft bays (aspect 1.95). The sloping southern frontage is
 // additional to this rectangle. See year-2024/MEASUREMENT.json.
 const w=6*BAY,d=3*BAY,aisleX=-BAY/2,g=k.assembly('chiba','Chiba · painted frontage, solar and glazing');
 // c42733: access is 0.52 bay west of the main-roof midpoint. It occupies
 // the rack bay [-BAY,0], centered on the seven-bay footprint with terrace.
 k.frame(g,6,3,4.8768,true);k.deck(g,w,d,.22);
 for(const o of g.children.slice())if(o.userData.kind==='12 foot orange beam'&&Math.abs(o.position.x-aisleX)<.01&&Math.abs(o.position.y-2.48)<.01)g.remove(o);
 k.deck(g,2*BAY,d,2.46,-2*BAY,0,true);
 k.deck(g,3*BAY,d,2.46,1.5*BAY,0,true);
 g.userData.source='c30786 Jan 22 near-nadir; c42733 Jan 12 north facade; c41609 Mar 4 south facade';
 g.userData.measurement='6×3 nominal 12-ft bays for main roof; auditorium/access one half-bay west of main-roof center (c42733 measured0.52bay); roof corners ±0.5 bay, campus offsets ±5m';
 k.deck(g,w,d,4.86,0,0,true);roofRails(k,g,w,d,4.7);
 // The north facade is two white walls with a central doorway/landing and
 // straight stairs up from the bare courtyard (c42733); it is not red.
 const northGap=3.2;
 for(const [lo,hi] of [[-w/2,aisleX-northGap/2],[aisleX+northGap/2,w/2]])k.wall(g,hi-lo,4.45,(lo+hi)/2,-d/2,2.43,'#e8e7df');
 const northStairs=new T.Group();northStairs.userData={...g.userData,layer:layers.floor};
 northStairs.position.set(aisleX,0,-d/2-3.66);northStairs.rotation.y=Math.PI;g.add(northStairs);
 k.stairs(northStairs,3.2,7.32,2.22,0,0,9);
 k.wall(g,d,2.3,-w/2,0,1.38,'#b32629',Math.PI/2);k.wall(g,d,2.3,w/2,0,1.38,'#c7bca1',Math.PI/2);
 // March frontage photos + Gene's 2026-09-29 front / solarium photos: vertical inset with straight
 // stairs and the door landing, leaning flaps (PV left, plexiglass solarium right), plexiglass end wall + door.
 frontage2024(k,g,w,d);
 // c42733 north oblique + c30786 nadir: roof access bypasses the north
 // doorway canopy on its EAST side. No source roof hatch supports the former
 // generic south interior flight, which terminated under a continuous deck.
 // These endpoints fit the visible diagonal wedge; exact tread count is unresolved.
 const bypassStart=new T.Vector2(.04,-d/2-.92),bypassEnd=new T.Vector2(1.28,-d/2+.10);
 const bypassDelta=bypassEnd.clone().sub(bypassStart),bypassLength=bypassDelta.length(),bypassDir=bypassDelta.clone().normalize();
 const bypassWidth=.82,bypassBase=2.46+.0325,bypassTop=4.86+.0325,bypassRise=bypassTop-bypassBase,bypassSteps=7;
 const bypassAngle=Math.atan2(-bypassDir.x,-bypassDir.y);
 for(let i=0;i<bypassSteps;i++){
  const t=(i+.5)/bypassSteps,p=bypassStart.clone().addScaledVector(bypassDelta,t),y=bypassBase+(i+1)*bypassRise/bypassSteps;
  const tread=k.box(g,'north roof bypass open tread',[bypassWidth,.065,bypassLength/bypassSteps+.015],[p.x,y-.0325,p.y],'#bca078',layers.floor);tread.rotation.y=bypassAngle;
  tread.userData.source='c42733 north doorway-side access; c30786 diagonal exterior wedge east of canopy.7treads and endpoint fit approximate, topology directly observed';
 }
 const bypassNormal=new T.Vector2(-bypassDir.y,bypassDir.x);
 for(const side of [-1,1]){
  const a=bypassStart.clone().addScaledVector(bypassNormal,side*bypassWidth/2),b=bypassEnd.clone().addScaledVector(bypassNormal,side*bypassWidth/2);
  k.rod(g,'north bypass timber stringer',[a.x,bypassBase-.12,a.y],[b.x,bypassTop-.12,b.y],.055,'#a48661',layers.floor);
  k.rod(g,'north bypass handrail',[a.x,bypassBase+.86,a.y],[b.x,bypassTop+.86,b.y],.028,'#a48661',layers.floor);
 }
 // The north roof guard must leave the observed access route clear.
 for(const o of g.children.slice())if(o.userData.kind==='timber roof railing'&&Math.abs(o.position.z+d/2)<.01)g.remove(o);
 for(const [lo,hi] of [[-w/2,.55],[2.01,w/2]])k.rod(g,'north roof guard beside bypass',[lo,5.65,-d/2],[hi,5.65,-d/2],.04,'#ae9165',layers.roof);

 // c30786 roof silhouette includes a one-bay northward roof-access tongue.
 // The elevated east bay remained open to the desert in Feb (c1013/c1016),
 // with a low timber ceiling, black practice mats and a textile wall.
 // c42733/c30786: this silhouette is stair platforms and a small doorway
 // canopy; the previous full-height projecting roof slab was invented.
 k.box(g,'north doorway canopy',[BAY,.085,2.0],[aisleX,4.6,-d/2-.65],'#c2ab78',layers.roof);
 for(const side of [-1,1])k.wall(g,.57,1.98,aisleX+side*1.3,-d/2-.04,3.45,'#e3e2d8');
 k.deck(g,BAY,1.25,2.46,aisleX,-d/2-.48);
 // c42733 Jan12 and c1039 December build: the west strip is enclosed below
 // its north terrace, but open ABOVE the stepped roof-access decks. It is
 // not a fourth full-height roof frame. Heights remain photographic estimates.
 const westTerrace=k.assembly('west-terrace','West stepped roof access / enclosed north end',[-w/2-BAY/2,0,0]);g.add(westTerrace);
 westTerrace.userData.source='c42733 Jan12 north enclosure and open stepped silhouette; c1039 December north wall; c43740 construction varied-height posts; c30786 Jan22 overhead';
 const terraceHeights=[3.1,3.8,4.86];
 k.frame(westTerrace,1,3,4.8768,false);
 // Keep the supporting rack rhythm, but move its transverse ties to the
 // local deck underside and trim supports: no suspended orange grid over it.
 for(const o of westTerrace.children.slice()){
  const bay=Math.max(0,Math.min(2,Math.floor((o.position.z+d/2)/BAY)));
  const h=terraceHeights[bay],kind=o.userData.kind;
  if(kind==='rack upright'){o.scale.y=h/4.8768;o.position.y=h/2;}
  if(kind==='12 foot orange beam'&&o.position.y>4)o.position.y=h-.12;
  if(kind==='upright bracing'){
   const bounds=new T.Box3().setFromObject(o);
   if(bounds.max.y>h-.08)westTerrace.remove(o);
  }
 }
 for(let i=0;i<3;i++){
  const h=terraceHeights[i],z=(i-1)*BAY;
  k.deck(westTerrace,BAY,BAY,h,0,z,true);
  // Outer west edge timber guard follows each terrace, not the main roof.
  for(const zz of [z-BAY/2,z+BAY/2])k.rod(westTerrace,'terrace guard post',[-BAY/2,h,zz],[-BAY/2,h+.85,zz],.035,'#a48661',layers.floor);
  k.rod(westTerrace,'terrace guard rail',[-BAY/2,h+.85,z-BAY/2],[-BAY/2,h+.85,z+BAY/2],.035,'#a48661',layers.floor);
 }
 k.wall(westTerrace,BAY,terraceHeights[0]-.22,0,-d/2,(terraceHeights[0]+.22)/2,'#e8e7df');
 k.rod(westTerrace,'north terrace guard rail',[-BAY/2,terraceHeights[0]+.85,-d/2],[BAY/2,terraceHeights[0]+.85,-d/2],.035,'#a48661',layers.floor);
 for(let i=0;i<2;i++){
  const f=new T.Group();f.userData={...westTerrace.userData};f.position.set(0,terraceHeights[i]-.24,(i-.5)*BAY);f.rotation.y=Math.PI;westTerrace.add(f);k.stairs(f,2.9,1.7,terraceHeights[i+1]-terraceHeights[i],0,0,5);
 }
 // c33391 native west facade: enclosed white outer wall, horizontal paired
 // windows, two tall doors; yellow upper inset beside the stepped terraces.
 // Opening dimensions are proportional fits; no unsupported cabin roof cut.
 const westOpenings=[{z:-4.40,y:1.30,w:.82,h:2.16},{z:-.65,y:1.60,w:2.20,h:.85},{z:-.65,y:3.03,w:2.20,h:.85},{z:1.18,y:1.60,w:.48,h:.62},{z:3.33,y:1.40,w:.86,h:2.36}];
 for(let bay=0;bay<3;bay++){
  const lo=-d/2+bay*BAY,hi=lo+BAY,top=terraceHeights[bay]-.04;
  const cuts=westOpenings.filter(o=>o.z+o.w/2>lo&&o.z-o.w/2<hi);
  const zs=[lo,hi,...cuts.flatMap(o=>[Math.max(lo,o.z-o.w/2),Math.min(hi,o.z+o.w/2)])].sort((a,b)=>a-b);
  const ys=[.22,top,...cuts.flatMap(o=>[Math.max(.22,o.y-o.h/2),Math.min(top,o.y+o.h/2)])].sort((a,b)=>a-b);
  for(let iz=1;iz<zs.length;iz++)for(let iy=1;iy<ys.length;iy++){
   const z=(zs[iz-1]+zs[iz])/2,y=(ys[iy-1]+ys[iy])/2,width=zs[iz]-zs[iz-1],height=ys[iy]-ys[iy-1];
   if(width<.001||height<.001||cuts.some(o=>Math.abs(z-o.z)<o.w/2&&Math.abs(y-o.y)<o.h/2))continue;
   k.wall(westTerrace,width,height,-BAY/2,z,y,'#e7e8df',Math.PI/2);
  }
 }
 for(const o of westOpenings.filter(o=>o.h<1)){
  const glass=k.box(westTerrace,'west facade window glazing',[.022,o.h,o.w],[-BAY/2-.04,o.y,o.z],'#5e7275',layers.wall);
  glass.userData.source='c33391: paired broad horizontal west windows and small lower square window; glazing appearance obscured, size fitted';
 }
 // The yellow upper wall follows the two lowered terrace levels. Its north
 // door is a real opening onto the lowest terrace, rather than a painted panel.
 for(let bay=0;bay<2;bay++){
  const lo=-d/2+bay*BAY,hi=lo+BAY,base=terraceHeights[bay],top=4.86;
  const doorZ=-4.46,doorW=.83,doorTop=4.78;
  if(bay===0){
   for(const [a,b] of [[lo,doorZ-doorW/2],[doorZ+doorW/2,hi]])k.wall(g,b-a,top-base,-w/2,(a+b)/2,(top+base)/2,'#e4c940',Math.PI/2);
   k.wall(g,doorW,top-doorTop,-w/2,doorZ,(top+doorTop)/2,'#e4c940',Math.PI/2);
  }else k.wall(g,BAY,top-base,-w/2,(lo+hi)/2,(top+base)/2,'#e4c940',Math.PI/2);
 }
 const dojo=k.assembly('dojo','Upper east dojo / practice bay',[w/2-BAY/2,2.46,0]);g.add(dojo);
 dojo.userData.source='Gene c1013/c1016 Feb 8; c1027 Jan 25 and c43093: Chiba top east bay, open east side, black floor mats along entire long bay, hanging textile';
 for(let ix=-1;ix<=1;ix++)for(let iz=-4;iz<=4;iz++)k.box(dojo,'black interlocking floor mat',[1.12,.025,1.12],[ix*1.12,.045,iz*1.12],'#25272b',layers.floor);
 k.wall(dojo,BAY,1.8,0,-d/2,1.0,'#d8b2bd');
 // c42690 shows an occupied upper Chiba gallery: low plywood ceiling,
 // white pin-up walls, long shelf, two brown chairs and a red cabinet. Its
 // precise bay is unproven; this west/central placement is a spatial proxy.
 const gallery=k.assembly('upper-gallery','Upper gallery / reading lounge',[-2*BAY,2.46,0]);g.add(gallery);
 gallery.userData.source='c42690 Mar 3 upper Chiba interior; bay placement tentative';
 k.wall(gallery,2*BAY,2.15,0,-BAY/2,1.12,'#e6e5db');
 k.box(gallery,'long display shelf',[3.6,.08,.35],[-.9,1.04,-BAY/2+.23],'#d5c3a1',layers.detail);
 k.box(gallery,'red storage cabinet',[.9,1.45,.6],[-2.4,.74,-.45],'#a7353e',layers.detail);
 for(const x of [-.7,1.15])k.box(gallery,'brown lounge chair',[.8,.53,.84],[x,.34,.75],'#674434',layers.detail);

 // c32034/c43728/c43729: four open plywood seating terraces on orange beams, a full-height
 // screen at the low south end, and a high north landing. The seven-tread
 // generic auditorium helper obscured this interior section.
 k.screen(g,aisleX,2.55,d/2-.18,3.25,Math.PI,4.15);
 for(let i=0;i<4;i++){
  const y=.35+i*.61,z=1.5-i*1.78;
  k.box(g,'auditorium broad seating terrace',[BAY-.15,.085,1.78],[aisleX,y,z],'#b79973',layers.floor);
  // Open fronts are explicit in c43728/29 and under the occupied lowest
  // seat in c32034. These are beam-supported decks, not solid stair boxes.
  for(const dz of [-.83,.83])k.box(g,'auditorium orange seat support',[BAY,.12,.08],[aisleX,y-.103,z+dz],'#bd4e29',layers.steel);
  for(const dx of [-1.05,0,1.05])k.box(g,'auditorium seat joist',[.045,.09,1.66],[aisleX+dx,y-.087,z],'#d2bd96',layers.floor);
  k.box(g,'auditorium plywood front edge',[BAY-.15,.04,.035],[aisleX,y-.019,z+.89],i===0?'#ded9c7':'#c9b28d',layers.floor);
 }
 k.deck(g,BAY,1.0,2.46,aisleX,-d/2+.4);
 for(const side of [-1,1])k.wall(g,8.9,3.98,aisleX+side*BAY/2,-.6,2.37,side===-1?'#dfdfd5':'#bda17b',Math.PI/2);
 const partition=k.box(g,'painted interior rack partition',[4.1,2.15,.015],[aisleX+BAY/2-.045,3.52,-1.0],k.photo('/history/2024/interior-mural-c43728.webp'),layers.wall);
 partition.rotation.y=Math.PI/2;partition.userData.source='c43727/c43728 interior build partition; auditorium aligns between rack lines x=-BAY and0 per c42733 entrance';partition.userData.walkNoCollision=true;
 // The low-ceiling projection room c43185 is distinct from the tall auditorium.
 const lowRoom=k.assembly('low-projection-room','Low ceiling projection lounge',[-2*BAY,0,-1]);g.add(lowRoom);
 lowRoom.userData.source='c43185 low ceiling, rack-lined projection room; west-side bay allocation tentative';
 k.screen(lowRoom,0,1.3,-2.65,BAY-.25,0,1.96);
 k.box(lowRoom,'low ceiling plywood',[BAY,.065,2*BAY],[0,2.3,0],'#a98a67',layers.floor);
 for(const side of [-1,1])k.wall(lowRoom,2*BAY,2.13,side*BAY/2,0,1.3,'#b7976f',Math.PI/2);
 k.box(lowRoom,'projection lounge floor cushion',[2.3,.18,1.6],[0,.34,.55],'#6d5b67',layers.detail);
 // Gene's c43084 is the southwest entrance/shop, while c42761/c43051/c43052
 // put sofas, tables and a glazed lattice roof in the southeast solarium.
 const shop=k.assembly('neomotion-shop','Southwest workshop / entrance',[-w/2+BAY/2,0,d/2-BAY/2]);g.add(shop);
 shop.userData.source='c43084 Jan 15: southwest Chiba corner, plywood wall, rack and workbench';
 k.wall(shop,BAY,2.2,0,-BAY/2,1.35,'#bb986e');k.table(shop,0,.75,2.5,.8,.8);
 const solarium=k.assembly('solarium','Southeast glazed solarium',[w/2-BAY/2,0,d/2+.65]);g.add(solarium);
 solarium.userData.source='c578/c42761/c43051/c43052 Jan 15–17: southeast glazed enclosure, sofa and meeting table';
 // Keep the east end-wall doorway clear; the room photo does not fix the table's exact XY position.
 k.table(solarium,0,1.35,2.8,1.0,.75);k.box(solarium,'solarium sofa',[2.5,.42,.9],[0,.43,-1.65],'#c4b9a6');
 // Gene c42862 names the kitchen as inside Chiba. The photograph shows a
 // metal-grate floor, counter and red under-counter refrigerator; its exact
 // bay is unknown, so keep the position explicitly tentative.
 const chibaKitchen=k.assembly('chiba-kitchen','Chiba kitchen / counter',[BAY/2,0,-BAY/2]);g.add(chibaKitchen);
 chibaKitchen.userData.source='Gene c42862 Feb 21: Chiba kitchen; bay position approximate';
 k.box(chibaKitchen,'steel grate floor',[2.9,.05,2.25],[0,.1,0],'#657078',layers.floor);
 k.box(chibaKitchen,'kitchen counter',[3,.9,.78],[0,.54,-.65],'#a88968',layers.detail);
 k.box(chibaKitchen,'red under-counter refrigerator',[.68,.72,.62],[.8,.43,-.55],'#922d36',layers.detail);

 // In c30786 Freeside is 7 nominal bays across and approximately 2 deep.
 // Its centre is 4m west and 47m north of Chiba, NOT 35m north. Only its
 // middle ~3 bays have a full plywood roof; the outer wings are open rack
 // shelters with tents and low service boxes. The south-central face is PV.
 const fx=-4.0,fz=-46.7,fc=k.assembly('kitchen','Freeside · covered solar hub',[fx,0,fz]);
 fc.userData.entity_id='freeside_2024';fc.userData.source='c30786 Jan 22 near-nadir and c33391 Jan 12 oblique';
 fc.userData.measurement='whole span ~7 rack bays; center (-4,-47)m relative to Chiba; ±5m site offset';
 fc.scale.x=.8; // c30786: roof core ~one third of total frontage, not3/7.
 k.frame(fc,3,2,4.8768,true);k.deck(fc,3*BAY,2*BAY,.22);
 // c30786: continuous central plywood canopy; the lower wings have tarps.
 k.deck(fc,3*BAY,2*BAY,4.86,0,0,true);
 k.wall(fc,3*BAY,2.2,0,-BAY,1.35,'#bd9a68');
 // c30786 original crop resolves two banks of six panels in two courses.
 for(let row=0;row<2;row++)for(let col=0;col<12;col++){
  const x=-5.05+col*.84+(col>=6?.32:0),dz=(row-.5)*1.9;
  // c41728 / c42483: bottom course bears at ground, not above head height.
  const tilt=1.05,centerY=-.16+1.87*Math.sin(tilt)+.05;
  k.solar(fc,.82,1.84,x,centerY-dz*Math.sin(tilt),BAY+1.5+dz*Math.cos(tilt),tilt);
 }
 const kitchenInterior=k.assembly('kitchen-interior','Freeside service / storage counter',[0,0,-BAY/2]);fc.add(kitchenInterior);
 kitchenInterior.userData.source='c43551 camp-services: water and toilet supplies at a folding table in Freeside; no Freeside cooking evidence';
 k.table(kitchenInterior,0,0,2.9,.8,.78);
 for(const x of [-.9,.9])k.box(kitchenInterior,'water jug',[.35,.55,.35],[x,.52,0],'#91b4bb',layers.detail);
 const cafe=k.assembly('cafe','Freeside shared table',[0,0,BAY/2]);fc.add(cafe);k.table(cafe,0,0,2.8,.8,.8);
 for(const side of [-1,1]){
  const wing=k.assembly(side===1?'freeside-wing':'freeside-west-wing',side===1?'Freeside east tent wing':'Freeside west tent wing',[fx+side*2.35*BAY,0,fz]);
  wing.userData.entity_id='freeside_2024';wing.userData.source='c30786 Jan 22 + c41728 storm panorama: rear tents, lower plywood front rooms and blue tarp covers';
  wing.scale.x=1.15; // preserve total observed span while widening each three-shelter wing.
  k.frame(wing,2,2,2.48,false);k.deck(wing,2*BAY,2*BAY,.22);
  k.wall(wing,2*BAY,1.9,0,BAY,1.17,'#b98c5b');
  k.box(wing,'front wing blue tarp canopy',[2*BAY,.04,2.35],[0,2.49,BAY-1.05],'#427da1',layers.roof);
  for(const [i,color] of (side===1?['#d6c9a8','#dce1db','#e2d5b8']:['#4b8886','#207db3','#8da763']).entries()){
   const x=-2.25+i*2.25;
   k.box(wing,'canvas shelter lower wall',[1.96,1.15,2.25],[x,.8,-1.25],color,layers.context);
   const roof=new T.Mesh(new T.CylinderGeometry(0,1.45,1.02,4,1,false,Math.PI/4),k.mat(color));roof.scale.z=1.15;roof.position.set(x,1.87,-1.25);k.tag(wing,roof,'peaked canvas shelter roof',layers.context);
   k.box(wing,'tent dark entrance',[.76,1.04,.025],[x,.78,-.105],'#333b39',layers.detail);
  }
  k.box(wing,'front utility booth',[2.2,2.0,1.8],[side*2.6,1.2,BAY-.1],'#bb9162',layers.wall);
 }
 // Jan 22 parking is a broad U around Freeside, open through the centre of
 // the two-building courtyard. These are individually placed from c30786,
 // not an ellipse. IDs rv-1…rv-18 retain saved Studio references; smaller
 // van/bus/car shapes are explicitly distinguished from travel trailers.
 const observed:[number,number,number,number,'trailer'|'bus'|'van'|'car'][]=[
  [612,415,-1.0,5.2,'van'],[709,422,-.65,7.6,'trailer'],[675,467,-.15,7.0,'bus'],
  [630,526,-.55,6.3,'bus'],[595,581,1.35,8.1,'trailer'],[585,637,1.42,8.0,'trailer'],
  [598,688,1.38,5.3,'van'],[692,886,-.65,8.0,'trailer'],
  [1136,415,.6,7.8,'trailer'],[1183,464,.75,7.4,'trailer'],[1220,488,1.05,6.7,'trailer'],
  [1252,519,.72,6.1,'van'],[1284,633,1.45,8.7,'bus'],[1260,581,1.15,3.9,'van'],
  [1267,740,1.0,5.1,'van'],[1260,789,.85,6.5,'trailer'],[1188,831,.65,4.7,'car'],[1170,867,.55,7.8,'trailer'],
 ];
 const photoX=974,photoY=946,pxPerM=11.84; // c30786 downscaled 1824×1366 display coords
 // Low-poly source-class silhouettes, not manufacturer-specific models.
 // Shared wheel geometry within this year's fleet; no texture downloads.
 const tire2024=new T.CylinderGeometry(.34,.34,.18,10,1,false,Math.PI/10),tireMat2024=k.mat('#292b2c');
 const shapeVehicle2024=(body:T.Mesh,width:number,length:number,type:string)=>{
  const top=type==='bus'?2.625:type==='van'?2.10:1.63,hood=type==='bus'?1.55:type==='van'?1.3:.92;
  const profile:[number,number][]=[[-length/2,.20],[-length/2,type==='pickup'?.88:top-.25],[-length*.38,type==='pickup'?.88:top],[-length*.20,top], [length*.16,top],[length*.33,hood],[length/2,hood-.12],[length/2,.20]];
  const outline=new T.Shape();profile.forEach(([z,y],i)=>i?outline.lineTo(-z,y-body.position.y):outline.moveTo(-z,y-body.position.y));outline.closePath();
  body.geometry=new T.ExtrudeGeometry(outline,{depth:width,bevelEnabled:false});body.geometry.rotateY(Math.PI/2);body.geometry.translate(-width/2,0,0);
 };
 const detailVehicle2024=(v:T.Group,width:number,length:number,type:string)=>{
  for(const side of [-1,1])for(const zz of [-length*.31,length*.30]){
   const wheel=new T.Mesh(tire2024,tireMat2024);wheel.rotation.z=Math.PI/2;wheel.position.set(side*(width/2-.035),.18,zz);k.tag(v,wheel,'observed vehicle tire',layers.context);
  }
  for(const side of [-1,1]){
   k.box(v,'observed vehicle side glazing',[.024,type==='bus'?.63:.48,length*(type==='bus'?.57:.46)],[side*(width/2+.013),type==='bus'?2.10:type==='van'?1.67:1.31,-length*.1],'#435861',layers.context);
   k.box(v,'observed vehicle headlamp',[.30,.17,.035],[side*width*.33,type==='bus'?1.07:.69,length/2+.025],'#e3ddbf',layers.context);
  }
  k.box(v,'observed vehicle front bumper',[width+.05,.15,.13],[0,.43,length/2+.025],'#555b5b',layers.context);
  v.userData.source+='; low-poly class silhouette and trim approximate, no brand/model identity claimed';
 };

 observed.forEach(([px,py,angle,length,type],i)=>{
  const x=(px-photoX)/pxPerM,z=(py-photoY)/pxPerM,id=`rv-${i+1}`;
  if(type==='trailer'){const rv=k.rv(id,x,z,angle,length);rv.userData.source='c30786 Jan 22 topdown; position ±2m, heading approximate';return;}
  const veh=k.assembly(id,type==='bus'?'School bus / service vehicle':type==='van'?'Camper van':'Car',[x,0,z],angle);
  veh.userData.source='c30786 Jan 22 topdown; vehicle class and position approximate';
  const color=type==='bus'?(i===3?'#2d597e':i===2?'#ded7b8':'#d6b747'):i===13?'#a7312a':type==='car'?'#e4e6e6':'#d7d8d4';
  const body=k.box(veh,`${type} body`,[type==='bus'?2.5:2.2,type==='bus'?2.35:1.9,length],[0,type==='bus'?1.45:1.15,0],color,layers.context);
  shapeVehicle2024(body,type==='bus'?2.5:2.2,length,type);detailVehicle2024(veh,type==='bus'?2.5:2.2,length,type);
  const screen=k.box(veh,`${type} windscreen`,[1.85,.58,.05],[0,1.7,length/2+.04],'#445861',layers.context);
  screen.geometry=screen.geometry.clone();screen.geometry.rotateX(-.55);screen.geometry.translate(0,type==='bus'?.35:.02,-length*.255);
  if(i===2)k.solar(veh,2.1,3.3,0,2.8,0,.02); // solar-roof bus in west camp
 });
 // Separate small cars and work vehicles. Their source-pixel centres, unlike
 // the RV ring's, are in the original 5272×3948 image and listed in the
 // machine-readable ledger. Do not infer their persistence through March.
 const smallCars:[number,number,number,number,string,string][]=[
  [1455,1700,.28,4.8,'grey SUV','#545c61'],[1800,1620,-.28,4.9,'dark SUV','#303a39'],
  [1550,1780,.15,4.7,'blue-roof car','#31618b'],[3180,1125,.06,4.7,'Freeside east car','#354c53'],
  [3930,1810,.1,5.3,'black pickup','#272a2b'],[3930,2390,.4,5.6,'black pickup','#292c30'],
  [3500,2500,1.1,4.6,'white car','#d4d8d7'],[3660,2600,.75,4.9,'white utility car','#c9d5d7'],
  [2119,3015,-.8,5.0,'Chiba west white car','#e4e6dd'],[1804,3340,.1,5.4,'south orange work pickup','#c57236'],
  [1928,3307,.05,4.7,'south black car','#252b2d'],
 ];
 smallCars.forEach(([px,py,angle,length,name,color],i)=>{
  const x=(px-974*(5272/1824))/(pxPerM*(5272/1824)),z=(py-946*(3948/1366))/(pxPerM*(3948/1366));
  const car=k.assembly(`car-${i+1}`,name,[x,0,z],angle);
  car.userData.source='c30786 Jan 22 original source-pixel centre; type and heading approximate';
  const body=k.box(car,'small vehicle body',[2.0,1.42,length],[0,.92,0],color,layers.context);
  shapeVehicle2024(body,2,length,name.includes('pickup')?'pickup':'car');detailVehicle2024(car,2,length,'car');
  if(name.includes('pickup'))k.box(car,'observed pickup bed',[1.83,.025,length*.27],[0,.90,-length*.35],'#4b514e',layers.context);
  const screen=k.box(car,'windscreen',[1.72,.47,.04],[0,1.15,length/2+.03],'#42525a',layers.context);
  screen.geometry=screen.geometry.clone();screen.geometry.rotateX(-.75);screen.geometry.translate(0,.14,-length*.255);
 });
}
