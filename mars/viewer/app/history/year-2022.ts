import * as T from 'three';

import {Kit, BAY, layers} from './kit';
import {stair2022, solarRow2022, TRAILERS_2022, ROOF_TOP_2022} from './photographic-corrections';
import {YEAR_NORTH_AZIMUTH_OFFSET, NORTH_AZIMUTH_OFFSET} from '../../engine/env/sun';

import {roofRails, classroom} from './historical-helpers';
import {reconcile2022Source} from './details-2022-reconciliation';
export function make2022(k:Kit){
 // As-built pinwheel: DJI_0829 overhead, DJI_0806 orbit, March rooftop panorama and aerial-03.
 // Four measured roof footprints, each with an end stair. Corner passages stay open.
 // Nominal rack scale and estimated spacing; no pre-season SketchUp coordinates.
 // 2022 reconciliation (Gene, 2026-09-29 evening; RECONCILIATION_2022.md §a–§f; W51): the buildings are Ba Sing Se,
 // Cahuilla, Chatsubo and Huaqiangbei (display names; the ids are kept so every stable id, plan and pin still resolves:
 // 2022 `chiba` = Ba Sing Se, `east-house` = Cahuilla, `kitchen` = Chatsubo, `west-house` = Huaqiangbei). `shift` −2
 // (was 3) turns the pinwheel clockwise as in both aerials: each house keeps its quadrant, stair end and rotation, and
 // only the overlap reverses (Ba Sing Se's stair end now stands off Cahuilla's north end). Stairs PARALLEL to the house
 // (stair2022); solar rows face south on 45° triangle frames (solarRow2022; Chatsubo none); no table at the corner (Q1);
 // trailers per aerial-03 (TRAILERS_2022).
 const d=4.572;
 // Native c273 roof-control similarity fit,10° image tilt removed. Nominal36ft
 // long-side scale; rooftop centers, not assumed rotational symmetry.
 const bodyCenters:[[number,number],[number,number],[number,number],[number,number]]=[[1.62,-10.65],[10.43,2.23],[-2.8,10.3],[-11.15,-2.62]];
 const roofDepths=[5.4864,6.858,5.4864,5.4864];
 const ids=['chiba','east-house','kitchen','west-house'];
 const names=['Ba Sing Se','Cahuilla','Chatsubo','Huaqiangbei'];
 // south in the 2022 frame (engine/env/sun.ts YEAR_NORTH_AZIMUTH_OFFSET; compass azimuth 180 → x = sin, z = −cos)
 const north=YEAR_NORTH_AZIMUTH_OFFSET[2022]??NORTH_AZIMUTH_OFFSET,south=new T.Vector3(Math.sin((180+north)*Math.PI/180),0,-Math.cos((180+north)*Math.PI/180));
 for(let i=0;i<4;i++){
  const angle=-i*Math.PI/2,origin=new T.Vector3(BAY/2,0,0).applyAxisAngle(new T.Vector3(0,1,0),angle);
  origin.x+=bodyCenters[i][0];origin.z+=bodyCenters[i][1];
  const g=k.assembly(ids[i],names[i],[origin.x,0,origin.z],angle);
  const rack=new T.Group();rack.userData={...g.userData,layer:layers.steel};rack.position.x=-BAY/2;g.add(rack);
  k.frame(rack,3,2,4.8768,true,d);k.deck(rack,3*BAY,d,.22);k.deck(rack,3*BAY,d,2.46,0,0,true);
  // The kitchen has a smaller high roof and a broad open lower terrace.
  k.deck(rack,(i===2?1:3)*BAY,roofDepths[i],4.86,i===2?-BAY:0,0,true);
  g.userData.source='c273 same-height roof corners,10° corrected similarity fit, year-2022/review-2/roof-fit.json; steel depth retained provisionally, roof overhang measured separately';
  // Exposed timber ceiling joists appear in c55395; Gene confirmed roof framing.
  // These are visible members below the retained nominal deck surfaces, not a change
  // to the engine-wide floor datum or construction recipe.
  for(let x=-1.5*BAY+.12;x<1.5*BAY;x+=.6096){
   k.box(rack,'upper floor timber joist',[.038,.089,d],[x,2.37,0],'#ae9068',layers.steel);
   if(i!==2||x<-.5*BAY)k.box(rack,'roof timber joist',[.038,.089,roofDepths[i]],[x,4.77,0],'#ae9068',layers.roof);
  }
  if(i!==2){
   for(const z of [-roofDepths[i]/2,roofDepths[i]/2]){
    for(const x of [-1.5*BAY,-.5*BAY,.5*BAY,1.5*BAY])k.rod(rack,'roof guard post',[x,4.86,z],[x,5.75,z],.025,'#88734f',layers.roof);
    for(const y of [5.16,5.46,5.75])k.rod(rack,'roof guard cable',[-1.5*BAY,y,z],[1.5*BAY,y,z],.005,'#62645c',layers.roof);
   }
  }

  // Solar (Q13 / Q28 default): the house side that faces south (rack-local ±x / ±z, world normal within 45° of south).
  const side=([[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]).find(([x,z])=>new T.Vector3(x,0,z).applyAxisAngle(new T.Vector3(0,1,0),angle).dot(south)>Math.SQRT1_2)!;
  if(i===3)solarRow2022(k,rack,[1,0],side,[0,side[1]*(d/2-.05)],ROOF_TOP_2022,10,3*BAY/10);
  if(i===1){
   // c273 native crop: nine larger modules along courtyard edge, eight smaller
   // modules in the shorter outer row, plus a loose blue module between rows.
   solarRow2022(k,rack,[1,0],side,[0,1.02],ROOF_TOP_2022,9,1.05);
   solarRow2022(k,rack,[1,0],side,[-2.2,-1.95],ROOF_TOP_2022,8,.68);
   k.box(rack,'loose blue solar module',[1.0,.06,.6],[.5,ROOF_TOP_2022+.06,.1],'#183858',layers.roof);
  }
  if(i===0)for(const [xc,zc] of [[-4.4,.45],[-1.6,0],[1.2,-.45]] as [number,number][])solarRow2022(k,rack,[0,1],side,[xc+side[0]*.58,zc],ROOF_TOP_2022,3); // three short stepped rows across the house
  stair2022(k,g,1.5*BAY,d,BAY-.12);
  // c63403 (`Mars_Houses_bss`), with the 2022 street-art caption naming Ba Sing Se,
  // fixes the blue/green arch mural on that wing. The previous scene put this
  // very same image on Cahuilla's courtyard wall.
  const outer=k.wall(rack,3*BAY,2.23,0,-d/2,1.365,'#b99b75');
  outer.userData.source='Review5: exterior plywood retained; c63403/c33157 place Ba Sing Se mural on courtyard face, not this rear face';
  const endWall=k.wall(rack,d,2.23,-1.5*BAY,0,1.365,i===3?'#517e9c':'#b99b75',Math.PI/2);
  if(i===0||i===1){
   // Completed end mural extends to the high roof. March22 image supplies
   // paint only; its teardown-time removed panels do not govern occupied coverage.
   endWall.geometry=new T.BoxGeometry(d,4.60,.055);endWall.geometry.translate(0,1.185,0);
   endWall.material=k.photo(i===0?'/history/2022/review5-bss-end.webp':'/history/2022/review5-cahuilla-end.webp');
   endWall.userData.source=i===0?'c33157 March22: Ba Sing Se full-height blue-green end mural; paint retained from occupied state':'c33159 March22 completed Cahuilla blue/green end mural; c57008 March9 painting corroborates later-season finish';
  }
  if(i===0){
   const classroomStart=rack.children.length;
   classroom(k,rack,3*BAY,d);
   // classroom() adds a rear wall already supplied by `outer`; one physical
   // wall avoids coincident pale/wood faces and checkerboard z-fighting.
   for(const o of rack.children.slice(classroomStart))if(o.userData.kind==='plywood wall'&&Math.abs(o.position.z+d/2)<.001)rack.remove(o);
   const left=k.wall(rack,BAY,4.60,-BAY,d/2,2.55,k.photo('/history/2022/review5-bss-left.webp'));
   left.userData.source='c63403 February12 completed Ba Sing Se courtyard mural: full-height left pier, open upper two bays';
   const right=k.wall(rack,BAY,2.23,BAY,d/2,1.365,k.photo('/history/2022/review5-bss-right.webp'));
   right.userData.source='c63403 right lower courtyard mural panel';
   const middle=k.wall(rack,1.55*BAY,2.23,.08,d/2+.35,1.365,k.photo('/history/2022/review5-bss-center.webp'));
   middle.userData.source='c63403 finished projecting middle arch panel; c33157 teardown shows same panel shifted outward; depth approximate';
   // Red ceiling swags and upper-room table are visible in the completed Feb12 photo.
   for(const xx of [0,BAY]){
    for(let j=0;j<12;j++){
     const z1=-d/2+j*d/12,z2=-d/2+(j+1)*d/12;
     const y1=4.70-.62*Math.sin(Math.PI*j/12),y2=4.70-.62*Math.sin(Math.PI*(j+1)/12);
     k.rod(rack,'Ba Sing Se red ceiling fabric',[xx,y1,z1],[xx,y2,z2],.065,'#a13c34',layers.detail);
    }
   }
   const upperRoom=k.assembly('ba-sing-se-upper-room','Ba Sing Se upper occupied room',[0,2.46,0]);rack.add(upperRoom);k.table(upperRoom,0,0,1.6,.75,.74);
   // Narrow wooden ladder at the far-right upper room; no new ground stair.
   for(const xx of [BAY-.32,BAY+.32])k.rod(rack,'Ba Sing Se upper roof ladder stile',[xx,2.49,-d/2+.85],[xx,4.95,-d/2+.05],.035,'#b09268',layers.detail);
   for(let j=0;j<8;j++){const t=(j+.5)/8;k.rod(rack,'Ba Sing Se upper roof ladder rung',[BAY-.32,2.49+2.46*t,-d/2+.85-.8*t],[BAY+.32,2.49+2.46*t,-d/2+.85-.8*t],.025,'#b09268',layers.detail);}
  }
  if(i===1){
   const finishedFront=k.wall(rack,3*BAY,2.23,0,d/2,1.365,'#5996b8');
   finishedFront.userData.source='c57008 March9 painting; c33159 March22 completed blue contour facade. Later-season paint, not January build state';
   const contour=k.box(rack,'Cahuilla photographed contour panel',[BAY-.03,2.20,.014],[-BAY,1.365,d/2+.037],k.photo('/history/2022/review5-cahuilla-front.webp'),layers.wall);
   contour.userData.source='c33159 left lower courtyard panel; source includes the contemporary hand-lettered white task board; remaining facade fine artwork unresolved';
   // Gene's Cahuilla kitchen photo c55395 shows the work area between rack
   // posts, with a long three-basin stainless sink, water jugs and open shelving.
   k.kitchen(rack,6,d);
   const ev='Gene human label c55395: Cahuilla kitchen/water area, 2021-12-31 photo; location within this wing provisional';
   const sink=k.box(rack,'three-basin stainless sink',[2.55,.72,.72],[-.35,.57,-d/2+.55],k.mat('#9babad',.65),layers.detail);sink.userData.source=ev;
   for(const x of [-1.12,-.35,.42]){const basin=k.box(rack,'sink basin',[.65,.035,.54],[x,.94,-d/2+.55],'#535f60',layers.detail);basin.userData.source=ev;}
   for(const x of [-1.12,-.35,.42]){const tap=k.rod(rack,'kitchen tap',[x,1.0,-d/2+.2],[x,1.3,-d/2+.2],.016,'#b3bec0',layers.detail);tap.userData.source=ev;}
   for(const x of [-1.5,-1.1,-.7]){const jug=k.box(rack,'blue water jug',[.33,.53,.33],[x,.34,d/2-.42],'#607b92',layers.detail);jug.userData.source=ev;}
  }
  if(i===2){
   // Chatsubo is the bar / Dance Laboratory, not the three-basin Cahuilla
   // kitchen. Gene labeled c395 as the Chatsubo bar; the open serving bay is
   // visible beneath exposed rack beams and magenta/green event lighting.
   const ev='Gene human label c395: Chatsubo bar, 2022; counter position is a photographic estimate';
   const bar=k.box(rack,'Chatsubo bar counter',[2.9,.08,.7],[-.3,.96,.8],'#b59669',layers.detail);bar.userData.source=ev;
   const foil=k.box(rack,'Chatsubo reflective bar front',[2.80,.69,.025],[-.3,.57,1.165],k.mat('#c2bca4',.62),layers.detail);foil.userData.source='c55445 February8 Chatsubo occupied counter has reflective foil front; precise counter position approximate';
   for(const x of [-1.6,.95]){const leg=k.box(rack,'bar counter support',[.08,.82,.55],[x,.51,.8],'#95734e',layers.detail);leg.userData.source=ev;}
   k.wall(rack,BAY,2.23,-BAY,d/2,1.365);k.wall(rack,BAY,.9,BAY,d/2,.75);roofRails(k,rack,3*BAY,d,2.5);
  }
  if(i===3){
   // Huaqiangbei's courtyard face: Gene's c247 identifies this as the projection/DJ wall.
   // c111 and c477 show the same two solid end piers, an open upper middle bay, and a
   // lower plywood projection panel standing proud of the face. The projected colors
   // belong to a night event; the physical wall is pale plywood in c477.
   const ev='Gene atlas c247 (Huaqiangbei), corroborated by c111/c477 courtyard photos; February 2022 event state; panel depth is a photographic estimate';
   for(const x of [-BAY,BAY]){
    const pier=k.wall(rack,BAY,2.23,x,d/2,1.365,'#d3c9b9');pier.userData.source=ev;
    const upper=k.wall(rack,BAY,2.36,x,d/2,3.67,'#d3c9b9');upper.userData.source=ev;
   }
   const panel=k.wall(rack,1.65*BAY,1.95,0,d/2+.42,1.195,'#d4cabc');panel.userData.source=ev;
   const cap=k.box(rack,'projecting panel cap',[1.65*BAY,.075,.57],[0,2.19,d/2+.42],'#b99b75',layers.wall);cap.userData.source=ev;
   const dj=k.box(rack,'upper DJ booth shelf',[2.0,.08,.75],[0,3.18,d/2-.62],'#735b48',layers.detail);dj.userData.source=ev;
   for(const x of [-.88,.88]){const leg=k.box(rack,'DJ shelf support',[.055,.68,.055],[x,2.82,d/2-.62],'#735b48',layers.detail);leg.userData.source=ev;}
  }
 }
 // c273: seven full-size travel trailers. The former rv-7 is a pale canopy,
 // and rv-9 a long silver-roof shelter; neither is evidenced as a generic white RV.
 for(const [id,x,z,a,l] of TRAILERS_2022)if(id!=='rv-7'&&id!=='rv-9')k.rv(id,x,z,a,l);
 const canopy=k.assembly('rear-canopy','Pale canopy behind Ba Sing Se',[4.9,0,-16.6],-.2);
 canopy.userData.source='c273 upper-right of Ba Sing Se; c56834 initial view shows freestanding shade frontage';
 k.box(canopy,'pale shade roof',[6.0,.04,3.0],[0,2.8,0],'#bbd5db',layers.context);
 for(const x of [-3,3])for(const z of [-1.5,1.5])k.rod(canopy,'shade post',[x,0,z],[x,2.8,z],.025,'#967d59',layers.context);
 const silver=k.assembly('silver-shelter','Long silver-roof shelter · type uncertain',[18.9,0,15.1],.8);
 silver.userData.source='c273 native crop, formerly misclassified rv-9; length/height visual fit, underlying vehicle status unverified';
 k.box(silver,'silver shelter shell',[2.5,2.5,9.0],[0,1.3,0],'#999e96',layers.context);
 k.box(silver,'silver shelter roof',[2.65,.10,9.1],[0,2.6,0],'#c2c5ba',layers.context);
 k.box(silver,'shelter end awning',[2.65,.08,1.4],[0,2.55,5.15],'#b6ac91',layers.context);
 const bus=k.assembly('yellow-bus','Yellow school bus with rooftop deck',[25.6,0,-4.5],.06);
 bus.userData.source='c273 east side; c6649 1.5/24/36s independently shows bus rooftop platform and rail framing';
 k.box(bus,'yellow bus body',[2.55,2.4,9.1],[0,1.55,0],'#d9ad32',layers.context);
 k.box(bus,'bus hood',[2.1,1.0,1.1],[0,1.1,5.1],'#d9ad32',layers.context);
 k.box(bus,'bus front windscreen',[2.18,.84,.045],[0,2.04,4.59],'#37454a',layers.context);
 k.box(bus,'bus front bumper',[2.28,.19,.15],[0,.51,5.71],'#353b38',layers.context);
 k.box(bus,'bus radiator grille',[1.3,.43,.045],[0,1.05,5.68],'#343a35',layers.detail);
 const busWheelGeometry=new T.CylinderGeometry(.49,.49,.24,12);
 for(const side of [-1,1]){
  for(const z of [-2.75,3.15]){const wheel=new T.Mesh(busWheelGeometry,k.mat('#242825'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.28,.33,z);k.tag(bus,wheel,'bus road wheel',layers.context);}
  k.box(bus,'bus black rub rail',[.04,.105,8.8],[side*1.30,1.20,0],'#333832',layers.detail);
  k.box(bus,'bus headlight',[.29,.26,.05],[side*.83,1.13,5.70],'#e7dfba',layers.detail);
 }
 k.box(bus,'bus passenger entry',[.035,1.72,.81],[1.305,1.43,3.48],'#37454a',layers.context);
 for(const side of [-1,1])for(let z=-3.5;z<4;z+=1.0)k.box(bus,'bus side window',[.04,.7,.78],[side*1.29,2.05,z],'#37454a',layers.context);
 k.deck(bus,2.7,8.7,2.84);
 for(const side of [-1,1]){
  k.rod(bus,'bus roof handrail',[side*1.35,3.75,-4.35],[side*1.35,3.75,4.35],.025,'#343b3a',layers.context);
  for(const z of [-4.35,-2,0,2,4.35])k.rod(bus,'bus rail post',[side*1.35,2.84,z],[side*1.35,3.75,z],.025,'#343b3a',layers.context);
 }
 const hut=k.assembly('detached-shelter','Detached plywood shelter / camper annex',[17.8,0,-17.7],.3);
 hut.userData.source='c273 and c6649 1.5s foreground shelter; identity unknown, keep separate from the four named houses';
 k.deck(hut,4.5,4.8,.22);k.deck(hut,4.5,4.8,2.7);
 k.wall(hut,4.5,2.45,0,-2.4,1.46,'#b79b6d');k.wall(hut,4.8,2.45,-2.25,0,1.46,'#ad9268',Math.PI/2);
 for(const x of [-1.7,1.7])k.wall(hut,1.1,2.45,x,2.4,1.46,'#b89a6a');
 // Fourteen smaller vehicles picked in the same c273 overhead. Body types
 // are coarse; preserve their distinct footprint and placement instead of adding RVs.
 const cars:[number,number,number,string][]=[[-29.04,-10.84,0.1,'#a96a60'],[-25.66,-20.48,1.0,'#283847'],[-19.04,-23.37,-0.3,'#a35e4e'],[-11.08,-31.93,0.8,'#b9bdb7'],[-5.66,-36.51,1.3,'#c7be9d'],[2.77,-33.25,1.4,'#6b6148'],[-1.57,-26.27,0.8,'#afb6ac'],[-3.98,-20.48,0.3,'#d6dedb'],[0.96,-21.69,0.6,'#e1e3d9'],[14.22,-25.30,0.3,'#b8c7c3'],[28.19,7.35,1.2,'#cad7c9'],[27.95,10.72,1.2,'#696e60'],[25.90,14.10,1.3,'#2c3333'],[-28.67,-0.48,0,'#263435']];
 const roadWheelGeometry=new T.CylinderGeometry(.34,.34,.19,10);
 const cabGeometry=new T.BufferGeometry();
 cabGeometry.setAttribute('position',new T.Float32BufferAttribute([
  -.825,-.30,-1.2,.825,-.30,-1.2,.825,-.30,1.2,-.825,-.30,1.2,
  -.76,.30,-.80,.76,.30,-.80,.76,.30,.63,-.76,.30,.63,
 ],3));
 cabGeometry.setIndex([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);cabGeometry.computeVertexNormals();
 cars.forEach(([x,z,a,color],j)=>{
  const car=k.assembly(`car-${j+1}`,'Parked car / pickup · approximate',[x,0,z],a);car.userData.source='c273 overhead: individual small-vehicle footprint; generic shell, not exact vehicle model';
  k.box(car,'vehicle body',[1.9,1.05,4.6],[0,.8,0],color,layers.context);
  const cab=k.box(car,'vehicle roof',[1.65,.6,2.4],[0,1.55,-.2],color,layers.context);cab.geometry=cabGeometry;
  const glass=k.box(car,'vehicle windscreen',[1.46,.59,.035],[0,1.55,.70],'#33484d',layers.context);glass.rotation.x=-.76;
  for(const side of [-1,1]){
   for(const zz of [-1.43,1.43]){const wheel=new T.Mesh(roadWheelGeometry,k.mat('#252a28'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*.96,.18,zz);k.tag(car,wheel,'car road wheel',layers.context);}
   k.box(car,'car side glazing',[.025,.43,1.22],[side*.80,1.53,-.29],'#33484d',layers.context);
   k.box(car,'car headlight',[.31,.20,.04],[side*.61,.95,2.325],'#e1dfc6',layers.detail);
  }
  k.box(car,'car front bumper',[1.84,.16,.09],[0,.49,2.345],'#5a605d',layers.detail);
 });

 // Reproject old photo-derived context centers into the same tilt-corrected plane.
 // Their generic shell dimensions remain approximate; this only aligns site layout.
 const tilt=10*Math.PI/180,scale=8.3/(26.1*.3);
 for(const q of k.root.children){
  if(ids.includes(q.userData.assembly_id))continue;
  const x=q.position.x,z=q.position.z;
  q.position.x=scale*(Math.cos(tilt)*x-Math.sin(tilt)*z);
  q.position.z=scale*(Math.sin(tilt)*x+Math.cos(tilt)*z);
  q.rotation.y-=tilt;
 }

 reconcile2022Source(k);

}
