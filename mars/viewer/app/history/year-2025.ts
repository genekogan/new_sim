import * as T from 'three';
import {add2025Reconciliation} from './details-2025-reconciliation';
import {Kit, BAY, layers} from './kit';



import {hall, roofRails, kitchenBuilding} from './historical-helpers';
export function make2025(k:Kit){
 const w=3*BAY,d=3*BAY,g=k.assembly('chiba','Chiba · central steps and red wings');
 k.frame(g,3,3,4.8768,true,d);k.deck(g,w,d,.22);
 // The middle of the auditorium stays hollow (c46581 and Gene's correction).
 for(const o of g.children.slice())if(o.name==='12 foot orange beam'&&Math.abs(o.position.x)<.1&&Math.abs(o.position.y-2.48)<.01&&o.position.z>-d/2+.05)g.remove(o);
 g.userData.source='c72593–c72600 Jan 31 cardinal series (three front rack bays), c47305 Feb 22 roof orbit, c46581 Jan 29 auditorium; site topology from c509 panorama, c538 and c47305 orbit; Gene correction: Tool Camp across courtyard, Freeside lateral west';
 g.userData.measurement='Three 12-foot bays across (c72595 front upright sequence); 3-bay depth supported by nine 4-foot plywood sheets in c72596 east facade; nominal bay scale, not surveyed';
 // The January front is three steel rack bays across: open stair/bleacher bay
 // between two enclosed wings. The roof is a broad white deck in February,
 // not two disconnected timber terraces (c47305 frames 48–152).
 for(const o of g.children.slice())if(o.userData.layer===layers.roof)g.remove(o);
 for(const side of [-1,1]){k.deck(g,BAY,d,2.48,side*BAY,0,true);k.deck(g,BAY,d,4.86,side*BAY,0,true);k.wall(g,BAY,2.2,side*BAY,d/2,1.35,'#ba342d');}
 // c47268 completed frontage: red upper room fronts sit BELOW the low
 // terrace, rather than a bare rack opening. Central entrance remains open.
 for(const side of [-1,1]){
  const panel=k.wall(g,BAY,1.30,side*BAY,d/2-.035,3.13,'#ba342d');
  panel.userData.source='c47268 occupied front and c549 west/south: red upper wing panels below lowered terraces; height fitted to nominal upper floor';
  // c46813 late doorway and c47305 t142.5: reused glazed doors are infill
  // beside a real central opening, joined to the roof by a continuous header.
  const opening=1.10,doorWidth=.78,doorX=side*(opening/2+doorWidth/2),doorHeight=2.10;
  const entrance=k.box(g,'upper entrance reused door',[doorWidth,doorHeight,.06],[doorX,2.43+doorHeight/2,d/2-.08],'#e2ded1',layers.wall);
  entrance.userData.source='c46813 late occupied door wall; c47305 t142.5 pale glazed reused doors beside dark interior opening; widths fitted to 12ft rack bay';
  const infillWidth=BAY/2-opening/2-doorWidth;
  k.box(g,'upper entrance outer plywood infill',[infillWidth,doorHeight,.06],[side*(BAY/2-infillWidth/2),2.43+doorHeight/2,d/2-.08],'#b79c74',layers.wall);
  k.box(g,'upper entrance inset window',[.48,.67,.018],[doorX,3.92,d/2-.043],'#485758',layers.detail);
  k.box(g,'upper entrance window mullion',[.035,.67,.022],[doorX,3.92,d/2-.029],'#ddd8c9',layers.detail);
  k.box(g,'upper entrance door handle',[.065,.19,.035],[doorX-side*.28,3.18,d/2-.015],'#877044',layers.detail);
 }
 k.box(g,'upper entrance continuous header',[BAY,.33,.065],[0,4.695,d/2-.08],'#b79c74',layers.wall);
 // No black plane seals the central opening. A narrow physical sill joins
 // the exterior landing through the thickness of the wall.
 k.box(g,'upper entrance threshold',[1.10,.065,.20],[0,2.43,d/2-.04],'#b99c70',layers.floor);
 // c72606: central void continues to the north plywood wall; no upper rear bridge.
 k.deck(g,BAY,d,4.86,0,0,true);
 for(const side of [-1,1])k.box(g,'white roof membrane',[BAY-.025,.035,d-.025],[side*BAY,4.91,0],'#efede8',layers.roof);
 k.box(g,'white roof membrane',[BAY-.025,.035,d-.025],[0,4.91,0],'#efede8',layers.roof);
 // c46522 skeleton + c46118 t9: broad equal-span rack seating staggered
 // laterally; the sixth/top level is the enclosure roof/shared landing below.
 // Dimensions are fitted, not surveyed; never taper these into a tiny stair.
 const stairOffsets=[2.65,2.55,2.40,2.25,2.10],stairWidth=BAY-.08;
 const stairPlank=(kind:string,a:number[],b:number[],width:number,depth:number,color:string)=>{
  const av=new T.Vector3().fromArray(a),bv=new T.Vector3().fromArray(b),delta=bv.clone().sub(av);
  const m=k.box(g,kind,[width,delta.length(),depth],av.clone().add(bv).multiplyScalar(.5).toArray(),color,layers.floor);
  m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize());return m;
 };
 for(let i=0;i<5;i++){
  const y=.28+i*.43,z=d/2+5.7-i*1.02,x=stairOffsets[i];
  const platform=k.box(g,'staggered rack stair platform',[stairWidth,.075,1.1],[x,y,z],['#bd9b70','#967083','#bd9b70','#d5b766','#bd9b70'][i],layers.floor);
  platform.userData.source='c46522 exposed rack spans; c46118 t9 equal-width seating with triangular corner steps; fitted offsets';
  k.box(g,'stair orange rack beam',[stairWidth+.08,.12,.08],[x,y-.12,z+.48],'#b84c26',layers.steel);
  for(const side of [-1,1]){
   const xx=x+side*(stairWidth+.08)/2;
   k.box(g,'stair rack upright',[.065,y+1,.065],[xx,(y+1)/2,z+.48],'#344943',layers.steel);
   if(i>0)k.rod(g,'stair rack end diagonal',[xx,.07,z-.48],[xx,y-.16,z+.48],.018,'#344943',layers.steel);
  }
  // Horizontal triangular half-height treads on the exposed western edge.
  const shape=new T.Shape();shape.moveTo(0,0);shape.lineTo(.72,0);shape.lineTo(0,.75);shape.closePath();
  const m=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false}),k.mat('#bfa36f'));
  m.rotation.x=-Math.PI/2;m.position.set(x-stairWidth/2-.28,y+.21,z+.40);k.tag(g,m,'triangular intermediate stair tread',layers.floor);
  if(i<4)for(const side of [-1,1])stairPlank('front stair timber handrail',[x+side*stairWidth/2,y+.93,z+.48],[stairOffsets[i+1]+side*stairWidth/2,y+1.36,z-.54],.075,.10,'#bea16c');
 }
 // Late occupied c47305 t135/t142.5: TWO deep lowered platforms before the
 // continuous white roof. The former four thin strips mixed building phases.
 for(const side of [-1,1]){
  const lowX=side*.45,highX=side*(BAY/2+.10),z=d/2+1.72,count=side<0?4:6;
  for(let i=0;i<count;i++)k.box(g,'upper flight open timber tread',[Math.abs(highX-lowX)/count+.035,.065,.90],[lowX+(highX-lowX)*(i+.5)/count,2.43+(i+1)*(3.88-2.43)/count,z],'#b89a75',layers.floor);
  // c72612/c72610 show wide rectangular timber stringers, not round poles.
  // c46869 close-up resolves a continuous notched plank directly UNDER
  // every tread. The previous box cross-section put its width across the
  // staircase instead of in the vertical stair plane, making it a flat strip.
  const run=Math.abs(highX-lowX),rise=3.88-2.43,stringerShape=new T.Shape();
  stringerShape.moveTo(0,-.12);stringerShape.lineTo(0,rise/count-.0325);
  for(let i=0;i<count;i++){
   stringerShape.lineTo(run*(i+1)/count,rise*(i+1)/count-.0325);
   if(i<count-1)stringerShape.lineTo(run*(i+1)/count,rise*(i+2)/count-.0325);
  }
  stringerShape.lineTo(run,rise-.30);stringerShape.closePath();
  const stringerGeometry=new T.ExtrudeGeometry(stringerShape,{depth:.065,bevelEnabled:false});
  for(const dz of [-.43,.43]){
   const m=new T.Mesh(stringerGeometry,k.mat('#ac8f69'));m.scale.x=side;m.position.set(lowX,2.43,z+dz-.0325);
   k.tag(g,m,'upper flight timber stringer',layers.floor);m.userData.source='c46869: continuous notched timber support board beneath treads; .065m thickness and lower edge fitted';
  }
  for(const [y,zz] of [[3.88,d/2+1.83],[4.40,d/2+.61]]){
   const deck=k.box(g,'upper side terrace tread',[BAY,.075,1.22],[side*BAY,y,zz],side===-1&&y===4.40?'#785d90':'#bca075',layers.floor);
   deck.userData.source='c47305 t142.5: bare lower standing platform, purple intermediate seating platform, white roof above; heights/depth nominal rack fit';
   k.box(g,'upper side terrace rack beam',[BAY,.12,.08],[side*BAY,y-.10,zz+.58],'#b84c26',layers.steel);
  }
  // c72593/c46522 expose paired full-height rack end frames carrying the
  // terraces, not floating shelves. Nominal post heights are fitted; source
  // shows their tops above the main roof and diagonal ties in the end planes.
  for(const xx of [side*BAY/2,side*1.5*BAY]){
   for(const zz of [d/2+1.18,d/2+2.40]){
    const post=k.box(g,'front terrace rack upright',[.075,5.40,.075],[xx,2.70,zz],'#344943',layers.steel);
    post.userData.source='c72593/c46522 full-height paired terrace end uprights; footprint and5.40m height fitted to nominal rack';
   }
   for(const y of [.20,2.43,4.80,5.15])k.rod(g,'front terrace end horizontal tie',[xx,y,d/2+1.18],[xx,y,d/2+2.40],.023,'#344943',layers.steel);
   for(const [y0,y1,reverse] of [[.20,2.43,0],[2.43,4.80,1]])k.rod(g,'front terrace end diagonal',[xx,y0,d/2+(reverse?2.40:1.18)],[xx,y1,d/2+(reverse?1.18:2.40)],.023,'#344943',layers.steel);
  }
  k.box(g,'front terrace upper guard beam',[BAY,.12,.08],[side*BAY,4.80,d/2+2.40],'#b84c26',layers.steel);
 }
 // c72601 looks upward toward the open south facade; c72606 looks back
 // down toward the north plywood screen wall. Entry is the HIGH seating end.
 // Six tier depths/heights are a nominal fit, not a surveyed stair schedule.
 const auditoriumEntryTop=2.43+.065/2;
 for(let i=0;i<6;i++){
  const y=.42+i*(auditoriumEntryTop-.045-.42)/5,z=d/2-.58-(5-i)*1.15;
  const tier=k.box(g,'auditorium tiered timber platform',[BAY-.12,.09,1.16],[0,y,z],'#a98b64',layers.floor);
  tier.userData.source='c72601/c72606/c46581: open plywood seating rises south to entrance; top surface continuous with shared landing, exact intermediate spacing fitted';
  k.box(g,'auditorium tier supporting beam',[BAY-.12,.12,.08],[0,y-.10,z-.5],'#b84c26',layers.steel);
 }
 // c549/c72595: projecting enclosure under the landing, with passage to its east.
 const roomFront=d/2+2.2,roomLeft=-BAY/2,roomRight=.15,roomHeight=2.18;
 for(const x of [roomLeft,roomRight])k.wall(g,2.2,roomHeight,x,d/2+1.1,roomHeight/2+.22,'#b99b75',Math.PI/2);
 const doorX=-.80,doorW=.88;
 for(const [x,width] of [[(roomLeft+doorX-doorW/2)/2,doorX-doorW/2-roomLeft],[(doorX+doorW/2+roomRight)/2,roomRight-doorX-doorW/2]])k.wall(g,width,roomHeight,x,roomFront,roomHeight/2+.22,'#b99b75');
 k.box(g,'projecting room door',[doorW,1.94,.045],[doorX,1.19,roomFront+.04],'#998b76',layers.wall);
 k.box(g,'projecting room door lintel',[roomRight-roomLeft,.24,.06],[(roomLeft+roomRight)/2,2.27,roomFront],'#bfa17b',layers.wall);
 const sharedLanding=k.box(g,'projecting enclosure roof',[BAY,.065,2.2],[0,2.43,d/2+1.1],'#bfa17b',layers.floor);
 sharedLanding.userData.source='c46522/c72612: broad shared stair landing also roofs the projecting room; not three coplanar overlapping decks';
 const roomFrontArt=new T.Mesh(new T.PlaneGeometry(roomRight-roomLeft,roomHeight),k.photo('/history/2025/review6-room-front.webp'));
 roomFrontArt.position.set((roomLeft+roomRight)/2,roomHeight/2+.22,roomFront+.085);
 k.tag(g,roomFrontArt,'projecting room stickered door source',layers.detail);roomFrontArt.userData.walkNoCollision=true;
 roomFrontArt.userData.source='c549 native quadrilateral (2541,2058)(2901,2065)(2910,2436)(2544,2427): closed six-panel door and sticker-covered plywood, rectified source pixels';
 const roomSideArt=new T.Mesh(new T.PlaneGeometry(2.2,roomHeight),k.photo('/history/2025/review6-room-side.webp'));
 roomSideArt.position.set(roomLeft-.035,roomHeight/2+.22,d/2+1.1);roomSideArt.rotation.y=-Math.PI/2;
 k.tag(g,roomSideArt,'projecting room portrait source',layers.detail);roomSideArt.userData.walkNoCollision=true;
 roomSideArt.userData.source='c549 native quad (2384,2066)(2541,2058)(2544,2427)(2404,2425): painted portrait on protruding west wall; rectified visible source face';
 k.box(g,'projecting door handle',[.055,.09,.055],[doorX-doorW*.37,1.18,roomFront+.10],'#393b36',layers.detail);
 // c549: upholstered two-seat sofa with arms, not a freestanding pink bench.
 k.box(g,'front pink sofa seat',[1.75,.39,.70],[.55,.095,roomFront+.6],'#dc81a9',layers.detail);
 k.box(g,'front pink sofa back',[1.75,.65,.16],[.55,.61,roomFront+.28],'#dc81a9',layers.detail);
 for(const side of [-1,1])k.box(g,'pink sofa upholstered arm',[.16,.50,.72],[.55+side*.80,.24,roomFront+.60],'#d7799f',layers.detail);
 for(const x of [-.15,1.25])for(const z of [roomFront+.33,roomFront+.88])k.box(g,'pink sofa foot',[.09,.06,.09],[x,-.13,z],'#8f6c68',layers.detail);
 k.box(g,'pink sofa center cushion seam',[.009,.007,.51],[.55,.294,roomFront+.60],'#bc648e',layers.detail);
 for(const x of [-BAY/2,BAY/2])k.box(g,'19 foot central upright',[.075,5.7912,.075],[x,2.8956,d/2],'#293c45',layers.steel);
 k.box(g,'raised center crossbeam',[BAY,.12,.08],[0,5.67,d/2],'#b84c26',layers.steel);
 roofRails(k,g,w,d,4.7);
 // One south-facing roof row (c72608 and c46119 f12), and the red roof
 // constellation visible in the February orbit; neither belongs to the Jan
 // 31 unfinished facade state.
 // c46119 12s resolves eight portrait panels: two banks of four and a central gap.
 for(const side of [-1,1])for(let i=0;i<4;i++)k.solar(g,1.02,1.94,side*(.7+i*1.04),5.65,-d/2+.85,.82);
 // c47305 75s (rear elevation): four landscape plywood sheets form the
 // back of the north solar bank. They stand above the white roof; the
 // January facade photograph alone does not contain this later detail.
 for(let i=0;i<4;i++){
  const panel=k.box(g,'north solar plywood back',[2.425,1.2192,.035],[(i-1.5)*2.4384,5.56,-d/2+.22],'#b99b75',layers.roof);
  panel.userData.source='c47305 75s, rear orbit: four landscape plywood sheets above roof behind solar';
 }
 // Five separate pentagonal petals around a white pentagon, not radial triangles.
 for(let i=0;i<5;i++){
  const angle=i*2*Math.PI/5+Math.PI/2;
  const petal=new T.Mesh(new T.CircleGeometry(1.13,5,angle),k.mat('#b93435'));
  petal.rotation.x=-Math.PI/2;petal.position.set(1.79*Math.cos(angle),4.936,-.55-1.79*Math.sin(angle));petal.userData.walkNoCollision=true;k.tag(g,petal,'red pentagonal roof petal',layers.roof);
 }
 // Front-center shelf and the two photographed ornaments (c74008; c47305).
 k.box(g,'front roof ornament shelf',[2.4384,.08,1.2192],[0,5.78,d/2-.30],'#b79a70',layers.roof).userData.source='c47305 t0/t142.5 and c549: broad plywood shelf on raised central beam; nominal8x4ft fit, not measured';
 // c549 close detail shows tangled open red lobes, not a solid polyhedron.
 const redLoopGeometry=new T.TorusKnotGeometry(.22,.028,36,4,2,5);
 const orb=new T.Mesh(redLoopGeometry,k.mat('#d32137'));orb.position.set(0,6.20,d/2+.04);k.tag(g,orb,'red geometric roof ornament',layers.detail);
 orb.userData.source='c549 red open curled sculpture: low-poly loop interpretation, exact weave unresolved';
 for(const side of [-1,1]){const lobe=new T.Mesh(redLoopGeometry,k.mat('#d32137'));lobe.scale.setScalar(.70);lobe.position.set(side*.23,6.02,d/2+.07);k.tag(g,lobe,'red ornament lower curled lobe',layers.detail);lobe.userData.source=orb.userData.source;}
 for(let level=0;level<7;level++)for(let side=0;side<4;side++){
  const t=side*Math.PI/2,r=.22+level*.025,y=5.45+level*.32;
  k.rod(g,'branching wire roof ornament',[r*Math.cos(t),y,d/2+.62+r*Math.sin(t)],[r*Math.cos(t+.9),y+.45,d/2+.62+r*Math.sin(t+.9)],.009,'#796756',layers.detail);
 }
 k.wall(g,d,2.25,-w/2,0,1.37,'#b63229',Math.PI/2);k.wall(g,3.4,2.2,-w/2,-2,3.64,k.photo('/history/2025/flower.webp'),Math.PI/2);
 // Gene-labeled c72598 is the west face, not a generic red wall. Place its
 // full painted surface just outside the existing editable wall pieces.
 const west=k.box(g,'Chiba west painted facade photo',[d,4.5,.008],[-w/2-.065,2.35,0],k.photo('/history/2025/chiba-west-c549.webp'),layers.wall);
 west.rotation.y=Math.PI/2;west.userData.walkNoCollision=true;west.userData.source='Gene-labeled c549 west/south view; rectified occupied-season west painting, corroborated by c47305 105s';
 // c72596: open east doorway near north end, one sheet wide. Preserve
 // the same wall's transform/id while replacing its geometry with a real gap.
 const eastDoorCenter=3.84,eastDoorWidth=.99,eastDoorTop=2.45;
 const eastWall=k.wall(g,d,2.2,w/2,0,1.35,'#ae9772',Math.PI/2);
 const eastPieces:T.Shape[]=[];
 for(const [lo,hi] of [[-d/2,eastDoorCenter-eastDoorWidth/2],[eastDoorCenter+eastDoorWidth/2,d/2]]){
  const sh=new T.Shape();sh.moveTo(lo,-1.1);sh.lineTo(hi,-1.1);sh.lineTo(hi,1.1);sh.lineTo(lo,1.1);sh.closePath();eastPieces.push(sh);
 }
 eastWall.geometry=new T.ExtrudeGeometry(eastPieces,{depth:.055,bevelEnabled:false});eastWall.geometry.translate(0,0,-.0275);
 eastWall.userData.source='c72596 Jan31: doorway near north end, approximately one4ft panel wide; source doorway remains open';
 k.wall(g,d,2.35,w/2,0,3.625,'#bda17b',Math.PI/2).userData.source='c72596 continuous upper east plywood enclosure above lower panel/door course';
 const east=k.box(g,'Chiba east plywood facade photo',[d,4.5,.008],[w/2+.067,2.35,0],k.photo('/history/2025/chiba-east-c72596.webp'),layers.wall);
 east.rotation.y=Math.PI/2;east.userData.walkNoCollision=true;east.userData.source='c72596 Jan 31 east side, rectified crop; mixed white/stenciled lower panels and unfinished upper plywood';
 // Match the photographic plane to the physical opening, including UVs.
 // The existing single billboard painted black doorway pixels over solid wall.
 const ep:number[]=[],eu:number[]=[],ei:number[]=[];
 for(const [x0,x1,y0,y1] of [[-d/2,eastDoorCenter-eastDoorWidth/2,-2.25,2.25],[eastDoorCenter+eastDoorWidth/2,d/2,-2.25,2.25],[eastDoorCenter-eastDoorWidth/2,eastDoorCenter+eastDoorWidth/2,eastDoorTop-2.35,2.25]]){
  const base=ep.length/3;
  for(const [x,y] of [[x0,y0],[x1,y0],[x1,y1],[x0,y1]]){ep.push(x,y,0);eu.push(x/d+.5,y/4.5+.5);}
  ei.push(base,base+1,base+2,base,base+2,base+3);
 }
 east.geometry=new T.BufferGeometry();east.geometry.setAttribute('position',new T.Float32BufferAttribute(ep,3));east.geometry.setAttribute('uv',new T.Float32BufferAttribute(eu,2));east.geometry.setIndex(ei);east.geometry.computeVertexNormals();

 const north=k.box(g,'Chiba north patchwork facade photo',[w,4.5,.008],[0,2.35,-d/2-.067],k.photo('/history/2025/chiba-north-c72594.webp'),layers.wall);
 north.rotation.y=Math.PI;north.userData.walkNoCollision=true;north.userData.source='c72594 Jan 31 north/back face, rectified crop including eye mural';
 // c72606/c72601 establish the low north presenter end; high south entrance
 // up the seating terraces. A screen on the north wall contradicted that
 // evidence. Its projection surface is outside this photograph, so do not
 // invent its position. The visible low-end projector sits on a board.
 const presenter=k.assembly('presenter-station','Auditorium north presenter station',[0,0,-d/2+.75]);g.add(presenter);
 presenter.userData.source='c46581/c72606: presenter at low north end, audience rises toward south entrance; equipment coordinates fitted';
 k.table(presenter,0,0,1.8,.7,.72);
 k.box(presenter,'white tabletop projector',[.36,.10,.28],[-.5,.795,0],'#e9e8e4',layers.detail);
 k.box(presenter,'open laptop base',[.31,.02,.22],[.42,.753,0],'#57595b',layers.detail);
 const laptop=k.box(presenter,'open laptop screen',[.31,.22,.014],[.42,.86,-.1],'#33383b',layers.detail);laptop.rotation.x=-.18;
 const talk=k.assembly('classroom','Chiba lounge and workspace',[-BAY,0,0]);k.table(talk,0,-1.2,2,.7);k.screen(talk,0,1.3,-1.6,1.1);k.box(talk,'pink sofa seat',[2,.38,.85],[0,.48,2],'#a35e75');k.box(talk,'pink sofa back',[2,.58,.15],[0,.82,2.35],'#a35e75');
 // c538 Jan 31: Freeside has three major bays, a high middle loft and a
 // kitchen/living room below. c509/c538 and the roof orbit put it west of Chiba; the attached
 // small pods stand to its west, unlike the former south-site booths.
 const free=kitchenBuilding(k,-17.1,18.9,2025,'freeside_2025');
 free.userData.source='c538 Jan 31 aerial, c46842 living room, c44513/c44558 kitchen, c509 panorama, c538 south oblique, c47305 37.5–60s; c509 low roof plane2.55m fit: center(-17.1,18.9), west/southwest of Chiba; spacing fitted, not surveyed';
 // c538/c537: open lounge at grade, no broad staircase in front of Freeside.
 for(const o of free.children.slice()){
  if(o.name.startsWith('stair ')||(o.name==='12 foot orange beam'&&o.position.y>3))free.remove(o);
  // c538 shows unbroken plywood roof surfaces; the orange support beams sit
  // under the2.46m-centered65mm sheets, including the visible outer edge beams.
  if(o.name==='12 foot orange beam'&&Math.abs(o.position.y-2.48)<.01)o.position.y=2.365;
  if(o.name==='central rooftop canopy'){o.rotation.x=.62;o.position.y=4.04;}
 }
 // c538 Jan31: four LANDSCAPE modules, two columns by two rows, on right roof.
 // Remove only2025 generic solar/front bands and inherited2023 artwork.
 for(const o of free.children.slice()){
  if(['solar panel','photovoltaic cells'].includes(o.userData.kind))free.remove(o);
  if(o.userData.kind==='plywood wall'&&Math.abs(o.position.z-BAY)<.01&&Math.abs(o.position.x)>BAY/2)free.remove(o);
 }
 free.traverse(o=>{if(o instanceof T.Mesh&&o.parent?.userData.assembly_id==='cafe'&&['café painted counter','plywood wall'].includes(o.userData.kind))o.material=k.mat('#bca07c');});
 for(const col of [-1,1])for(const row of [-1,1]){
  const xx=BAY+col*.81,zz=1.55+row*.53,yy=2.78-(zz-1.55)*Math.sin(.15);
  const panel=k.box(free,'solar panel',[1.59,.045,1.03],[xx,yy,zz],'#a6abb1',layers.roof);panel.rotation.x=.15;
  const cells=k.box(free,'photovoltaic cells',[1.53,.008,.97],[xx,yy+.03,zz+.0045],'#1c344b',layers.roof);cells.rotation.x=.15;
  panel.userData.source='c538 Jan31: four landscape photovoltaic modules,2columns×2rows';
 }
 // Left single window: plywood below/above and narrow side piers, not open lattice.
 for(const side of [-1,1])k.wall(free,.78,2.23,-BAY+side*1.43,BAY,1.365,'#bba584');
 k.wall(free,2.06,.62,-BAY,BAY,.57,'#bba584');
 k.wall(free,2.06,.48,-BAY,BAY,2.24,'#bba584');
 const leftGlass=k.box(free,'Freeside left glazed window',[1.95,1.1,.04],[-BAY,1.435,BAY+.01],new T.MeshStandardMaterial({color:'#70817b',metalness:.25,roughness:.25,transparent:true,opacity:.65}),layers.wall);
 leftGlass.userData.source='c538: single wide rectangular glazed opening in leftfront bay';
 for(const yy of [.86,2.01])k.box(free,'Freeside window timber frame',[2.08,.06,.08],[-BAY,yy,BAY+.04],'#ded0af',layers.wall);
 for(const dx of [-1.02,1.02])k.box(free,'Freeside window timber frame',[.06,1.2,.08],[-BAY+dx,1.435,BAY+.04],'#ded0af',layers.wall);
 // Right bay: a narrow art-covered door left of the broad horizontal service hatch.
 const serviceX=BAY+.58,serviceW=2.15;
 k.wall(free,BAY,.50,BAY,BAY,2.23,'#ba9b70');
 k.wall(free,serviceW,.88,serviceX,BAY,.70,'#bba584');
 for(const xx of [BAY-1.78,BAY-.61,BAY+1.78])k.wall(free,.13,2.23,xx,BAY,1.365,'#b99b75');
 k.box(free,'Freeside service counter sill',[2.25,.07,.32],[serviceX,1.16,BAY+.13],'#c9b58a',layers.detail);
 k.box(free,'Freeside service opening dark interior',[serviceW,.84,.035],[serviceX,1.59,BAY-.35],'#292d29',layers.detail);
 // Open pose requested by Gene for navigation; c538 supplies the leaf artwork,
 // not evidence that it historically stood at this angle.
 const freeDoor=new T.Group();freeDoor.userData={...free.userData};freeDoor.position.set(BAY-1.70,0,BAY+.035);freeDoor.rotation.y=-Math.PI/2;free.add(freeDoor);
 k.box(freeDoor,'Freeside painted door',[1.02,2.08,.07],[.51,1.30,0],'#d3c6ac',layers.wall).userData.source='Gene requested open inspection pose; c538 painted leaf';
 // Direct source-image UVs preserve the actual white/black painting without importing2023 artwork.
 const artGeometry=new T.PlaneGeometry(.98,1.84),artUV=artGeometry.attributes.uv;
 [[1237,480],[1314,487],[1234,620],[1315,626]].forEach(([x,y],n)=>artUV.setXY(n,x/1900,1-y/1069));
 const art=new T.Mesh(artGeometry,k.photo('/history/2025/c538-freeside-source.jpg'));art.position.set(.51,1.36,.043);
 k.tag(freeDoor,art,'Freeside photographed black white door art',layers.wall);art.userData.source='c538 Jan31 visible painted door immediatelyleftofservicewindow; oblique source UV mapping';
 k.box(free,'green rooftop lounge carpet',[BAY-.15,.025,2.9],[0,2.55,.95],'#3d6644',layers.detail);
 k.box(free,'rooftop lounge rear backrest',[BAY-.12,1.2,.08],[0,3.12,-.85],'#a88a60',layers.wall);
 k.box(free,'rooftop lounge cushion',[1.3,.4,.85],[.3,2.76,.25],'#727583',layers.detail);
 // Review4: c46748 rear construction, c44578 kitchen, c46842 living room.
 // Cut openings into the original meshes (same wall/assembly IDs), rather than
 // painting opaque rectangles over plywood. Nominal frame sizes are photo fits.
 const freeGlass=new T.MeshStandardMaterial({color:'#adc7c3',roughness:.16,metalness:.08,transparent:true,opacity:.24,side:T.DoubleSide,depthWrite:false});
 type FreeOpening={x:number;y:number;w:number;h:number;round?:boolean;door?:boolean};
 const freeOpenWall=(wall:T.Mesh,width:number,openings:FreeOpening[],source:string)=>{
  // Doorways are not enclosed Shape holes: the contour opens all the way
  // through the wall bottom. No artificial sill/frame may block feet.
  const shape=new T.Shape();shape.moveTo(-width/2,-1.125);
  for(const a of openings.filter(a=>a.door).sort((a,b)=>a.x-b.x)){
   const top=a.y-wall.position.y+a.h/2;
   shape.lineTo(a.x-a.w/2,-1.125);shape.lineTo(a.x-a.w/2,top);
   shape.lineTo(a.x+a.w/2,top);shape.lineTo(a.x+a.w/2,-1.125);
  }
  shape.lineTo(width/2,-1.125);shape.lineTo(width/2,1.125);shape.lineTo(-width/2,1.125);shape.closePath();
  for(const a of openings){
   const hole=new T.Path(),cy=a.y-wall.position.y;
   if(a.round)hole.absellipse(a.x,cy,a.w/2,a.h/2,0,Math.PI*2,true,0);
   else{hole.moveTo(a.x-a.w/2,cy-a.h/2);hole.lineTo(a.x-a.w/2,cy+a.h/2);hole.lineTo(a.x+a.w/2,cy+a.h/2);hole.lineTo(a.x+a.w/2,cy-a.h/2);hole.closePath();}
   if(!a.door)shape.holes.push(hole);
   const pt=(xx:number,yy:number)=>new T.Vector3(xx,yy-wall.position.y,0).applyAxisAngle(new T.Vector3(0,1,0),wall.rotation.y).add(wall.position);
   if(!a.door){
    const glass=new T.Mesh(a.round?new T.CircleGeometry(a.w/2,48):new T.PlaneGeometry(a.w,a.h),freeGlass);glass.position.copy(pt(a.x,a.y));glass.rotation.y=wall.rotation.y;
    k.tag(free,glass,a.round?'Freeside rear round glazing':'Freeside salvaged window glazing',layers.wall);glass.userData.source=source;
   }
   if(a.round){const ring=new T.Mesh(new T.TorusGeometry(a.w/2,.045,8,48),k.mat('#c8a777'));ring.position.copy(pt(a.x,a.y));ring.rotation.y=wall.rotation.y;k.tag(free,ring,'Freeside round window timber rim',layers.wall);}
   else for(const [xx,yy,ww,hh] of [[a.x,a.y-a.h/2,a.w+.07,.055],[a.x,a.y+a.h/2,a.w+.07,.055],[a.x-a.w/2,a.y,.055,a.h],[a.x+a.w/2,a.y,.055,a.h]]){if(a.door&&yy<a.y-a.h/2+.01)continue;const p=pt(xx,yy),frame=k.box(free,'Freeside salvaged window frame',[ww,hh,.075],[p.x,p.y,p.z],'#d9d7c7',layers.wall);frame.rotation.y=wall.rotation.y;frame.userData.source=source;}
  }
  wall.geometry=new T.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false,curveSegments:32});wall.geometry.translate(0,0,-.0275);wall.userData.source=source;
 };
 for(const o of free.children.slice())if(o instanceof T.Mesh&&o.userData.kind==='plywood wall'){
  if(Math.abs(o.position.z+BAY)<.01&&Math.abs(o.position.x)<.01){
   freeOpenWall(o,3*BAY,[
    {x:-BAY,y:1.40,w:1.95,h:.95}, // living-room rear, c46748
    {x:-.83,y:1.85,w:.74,h:.74,round:true},
    {x:.72,y:1.30,w:.86,h:2.04,door:true},
    {x:BAY+.45,y:1.26,w:1.14,h:1.80},
    ...[-.95,.02,.99].map(dx=>({x:BAY+dx,y:2.22,w:.88,h:.35})),
   ],'c46748 rear build view; c44578 tall kitchen pane and clerestory row; rear center door/round window positions approximate');
  }else if(Math.abs(o.position.x-1.5*BAY)<.01){
   freeOpenWall(o,2*BAY,[{x:-2.03,y:1.56,w:1.80,h:1.05},{x:.05,y:1.37,w:1.50,h:1.50},{x:2.06,y:1.38,w:1.16,h:1.72}], 'Gene: right kitchen/dining side extensively glazed; c44513/c44541/c44576/c46748, salvaged panes vary; exact side spacing provisional');
  }else if(Math.abs(o.position.x+1.5*BAY)<.01){
   freeOpenWall(o,2*BAY,[{x:-1.60,y:1.47,w:1.92,h:1.12}], 'c46842 living room west window overlooking adjacent pods; one broad side opening, rest plywood');
  }
 }
 // Room partitions retain the open front central lounge: solid living-room
 // boundary (c46842), reused sliding glazing on kitchen boundary (c44578).
 const livingPartition=k.wall(free,2*BAY,2.25,-BAY/2,0,1.36,'#b99b75',Math.PI/2);
 freeOpenWall(livingPartition,2*BAY,[{x:2.4,y:1.30,w:.9,h:2.04,door:true}], 'c46842 solid inner living-room plywood wall; rear access position provisional');
 const kitchenPartition=k.wall(free,2*BAY,2.25,BAY/2,0,1.36,'#b99b75',Math.PI/2);
 freeOpenWall(kitchenPartition,2*BAY,[{x:2.25,y:1.30,w:1.55,h:2.04,door:true},{x:.4,y:1.34,w:1.3,h:1.84}], 'c44578 reused sliding glazed frame on kitchen-to-center boundary; doorway position provisional');
 // The generic helper had kitchen and living room reversed. Group moves leave
 // their child component IDs intact; no campus placement change is involved.
 const freeKitchen=free.children.find(o=>o.userData.assembly_id==='kitchen-interior');
 if(freeKitchen){freeKitchen.position.x=BAY;freeKitchen.userData.source='Gene correction; c44513/c44576/c44578: kitchen in right/front bay';
  // Generic left counter/crates crossed both access routes; their placement
  // was not source recovered. Remove the placeholders instead of blocking entry.
  for(const o of freeKitchen.children.slice())if(o.position.x<-1.0&&['table top','table leg','stored food crate'].includes(o.userData.kind))freeKitchen.remove(o);
 }
 const freeLiving=free.children.find(o=>o.userData.assembly_id==='cafe');
 if(freeLiving){
  freeLiving.position.x=-BAY;freeLiving.name='Freeside living room / libaby';freeLiving.userData.source='c46842/c45110: enclosed plywood lounge, sofas/chairs and low coffee table';
  // Unsupported inherited2023 counter, wall and screen are retired, not renamed
  // into unrelated2025 objects. Keep its existing table as a secondary table.
  for(const o of freeLiving.children.slice())if(['café painted counter','plywood wall','screen','display content'].includes(o.userData.kind))freeLiving.remove(o);
  k.box(freeLiving,'Freeside living room sofa seat',[.80,.32,2.1],[-1.30,.48,.20],'#baad7e',layers.detail);
  k.box(freeLiving,'Freeside living room sofa back',[.16,.58,2.1],[-1.65,.84,.20],'#b2a36f',layers.detail);
  k.box(freeLiving,'Freeside living room low table',[.85,.07,1.30],[0,.53,-.4],'#806043',layers.detail);
  for(const x of [-.34,.34])for(const z of [-.95,.15])k.box(freeLiving,'Freeside coffee table leg',[.055,.42,.055],[x,.29,z],'#765438',layers.detail);
 }
 // Actual kitchen service opening: transparent glazing, not an opaque black
 // backing that concealed the corrected kitchen from the courtyard.
 const serviceBacking=free.children.find(o=>o.name==='Freeside service opening dark interior');
 if(serviceBacking instanceof T.Mesh)serviceBacking.material=freeGlass;
 const booths=k.assembly('utility-booths','Freeside living pods',[-27,0,30],.5);
 booths.userData.entity_id='freeside_2025';booths.userData.source='c538 Jan 31 west-of-Freeside small room row; c47347/c46384 living pods';
 for(let i=0;i<3;i++){const x=i*3.3;
  // The old 'pod wall' was a solid 2.6m-deep block. Build a hollow shell
  // with an actual entry; hidden interior fittings remain unspecified.
  const front=k.box(booths,'pod wall',[2.3,2.25,.065],[x,1.13,1.30],'#b99b75',layers.wall);
  const shape=new T.Shape();shape.moveTo(-1.15,-1.125);shape.lineTo(-.44,-1.125);shape.lineTo(-.44,.93);shape.lineTo(.44,.93);shape.lineTo(.44,-1.125);shape.lineTo(1.15,-1.125);shape.lineTo(.70,1.125);shape.lineTo(-.70,1.125);shape.closePath();
  front.geometry=new T.ExtrudeGeometry(shape,{depth:.065,bevelEnabled:false});front.geometry.translate(0,0,-.0325);
  for(const side of [-1,1]){
   const wall=k.box(booths,'pod side wall',[.065,2.25,2.6],[x+side*1.15,1.13,0],'#b99b75',layers.wall);wall.geometry=wall.geometry.clone();const pos=wall.geometry.getAttribute('position');
   for(let j=0;j<pos.count;j++)pos.setX(j,pos.getX(j)-side*.45*(pos.getY(j)+1.125)/2.25);wall.geometry.computeVertexNormals();wall.userData.source='c46384 three flat-topped pods with inward-sloping sides; nominal width/height fitted';
  }
  const rear=k.box(booths,'pod rear wall',[2.3,2.25,.065],[x,1.13,-1.3],'#b99b75',layers.wall);rear.geometry=rear.geometry.clone();const rearPos=rear.geometry.getAttribute('position');for(let j=0;j<rearPos.count;j++)rearPos.setX(j,rearPos.getX(j)*(1-.45/1.15*(rearPos.getY(j)+1.125)/2.25));rear.geometry.computeVertexNormals();
  k.box(booths,'pod flat roof',[1.5,.09,2.7],[x,2.3,0],'#a39c8d',layers.roof);
  const leaf=k.box(booths,'pod door',[.82,2.03,.06],[x-.44,1.03,1.75],i===0?'#c8a65f':'#d1d0c5',layers.wall);leaf.geometry=leaf.geometry.clone();leaf.geometry.translate(.41,0,0);leaf.position.z=1.34;leaf.rotation.y=-Math.PI/2;
  leaf.userData.source='Gene requested open inspection pose; c46384 tan first door, pale later doors; tapered shells observed, nominal size/position fitted, concealed interiors unmodeled';
  if(i===0){
   const clothGeometry=new T.PlaneGeometry(.70,.90),uv=clothGeometry.attributes.uv;
   [[252,800],[390,752],[275,1005],[403,944]].forEach(([u,v],n)=>uv.setXY(n,u/1920,1-v/1280));
   const cloth=new T.Mesh(clothGeometry,k.photo('/history/2025/reconciliation/pods-c46384-native.webp'));cloth.position.set(.41,.34,.041);leaf.add(cloth);k.tag(leaf,cloth,'Freeside first pod actual red patterned door curtain',layers.detail);cloth.userData.walkNoCollision=true;cloth.userData.source='c46384 native cloth corners; follows open leaf for inspection';
  }
 }
 // Bodywork is its own low dojo: c45835–38
 // show the black exercise floor, low rafters and cloth-lined wall; c543 and
 // c564 place its long plywood shell between Chiba and Tool Camp.
 const body=k.assembly('bodywork-dojo','Mars Bodywork Residency · dojo',[24,0,10],-Math.PI/2+.25);
 body.userData.entity_id='mars_bodywork_residency_2025';body.userData.source='Gene notes c45835–38, c543/c564; c45838 steel interior uprights override registry column-free claim; c509 spherical roof-plane fit review3: center(24,10), long axis approximately north-south;4×2-bay envelope nominal, location uncertain by several meters';
 // c45835/c45838 directly contradict the registry's column-free description:
 // blue rack frames with diagonal ties visibly stand inside the black-mat room.
 k.frame(body,4,2,3.66,false,2*BAY);
 for(const z of [-BAY,BAY])k.box(body,'perimeter roof beam',[4*BAY,.12,.12],[0,3.55,z],'#a48661',layers.steel);
 k.deck(body,4*BAY,2*BAY,.22);
 k.box(body,'black dojo mat',[4*BAY-.45,.05,2*BAY-.42],[0,.3,0],'#292b2d',layers.floor);
 k.box(body,'low patchwork roof',[4*BAY,.09,2*BAY],[0,3.61,0],'#aaa492',layers.roof);
 // Source photograph UVs, not generated artwork: c509 Jan23 black roof with
 // white line drawings/text. The spherical panorama is only approximately planar.
 // Source c509 is reused printed banners, not a generated painting. The old
 // two-triangle UV mapping introduced a diagonal kink and distorted its text.
 const roofArtGeometry=new T.PlaneGeometry(4*BAY-.04,2*BAY-.04,32,16);roofArtGeometry.rotateX(-Math.PI/2);
 const roofUV=roofArtGeometry.attributes.uv,roofPos=roofArtGeometry.attributes.position;
 const H=[-.115607208683,-.341533893099,.841052631579,-.121126356748,-.213131271759,.62,-.210116731518,-.373540856031];
 for(let i=0;i<roofUV.count;i++){
  const u=roofPos.getX(i)/(4*BAY-.04)+.5,v=roofPos.getZ(i)/(2*BAY-.04)+.5,den=H[6]*u+H[7]*v+1;
  roofUV.setXY(i,(H[0]*u+H[1]*v+H[2])/den,1-(H[3]*u+H[4]*v+H[5])/den);
 }
 const roofArt=new T.Mesh(roofArtGeometry,k.photo('/history/2025/c509-roof-source.jpg'));roofArt.position.y=3.661;
 k.tag(body,roofArt,'Bodywork photographed black roof artwork',layers.roof);
 roofArt.userData.source='c509 Jan23 panorama, four manual roof-corner UVs in review3/panorama-fit.json; stitched projection distortion retained';

 k.wall(body,4*BAY,2.3,0,-BAY,1.3,'#ad926c');
 for(const side of [-1,1])k.wall(body,2*BAY,2.3,side*2*BAY,0,1.3,'#b29a78',Math.PI/2);
 k.wall(body,1.25*BAY,2.3,-1.38,BAY,1.3,'#b7a27d');
 k.wall(body,1.25*BAY,2.3,1.38,BAY,1.3,'#b7a27d');
 // c543/c564 west-courtyard elevation: the four-bay low hall is enclosed
 // in brown patchwork plywood, with a pair of small high daylight openings.
 // The prior two overlapping center panels left BOTH outer bays entirely open.
 // Preserve those existing panels/ids; close their uncovered outer intervals.
 const occupiedFacade='c543 occupied west elevation; c564 independent broadside: full brown cladding, pale door/patches, small high openings; panel boundaries fitted';
 for(const side of [-1,1]){
  const outer=k.wall(body,BAY,2.3,side*1.5*BAY,BAY,1.3,side<0?'#ad865e':'#b99a71');outer.userData.source=occupiedFacade;
  if(side<0){
   // Cut the photographed doorway through the actual plywood, not just a
   // pale rectangle over a solid wall. Retain the component and provenance.
   const shape=new T.Shape();shape.moveTo(-BAY/2,-1.15);shape.lineTo(BAY/2,-1.15);shape.lineTo(BAY/2,1.15);shape.lineTo(-BAY/2,1.15);shape.closePath();
   const cx=-.08*BAY,hole=new T.Path();hole.moveTo(cx-.475,-1.05);hole.lineTo(cx-.475,1.03);hole.lineTo(cx+.475,1.03);hole.lineTo(cx+.475,-1.05);hole.closePath();shape.holes.push(hole);
   outer.geometry.dispose();outer.geometry=new T.ExtrudeGeometry(shape,{depth:.058,bevelEnabled:false});outer.geometry.translate(0,0,-.029);
   outer.userData.source+='; c45838 pale entrance, actual cut opening; dimensions fitted';
  }
 }
 const addBodyCladding=(width:number,height:number,x:number,y:number,color:string)=>{
  const panel=k.box(body,'Bodywork courtyard upper plywood cladding',[width,height,.058],[x,y,BAY+.002],color,layers.wall);panel.userData.source=occupiedFacade;
 };
 addBodyCladding(4*BAY,.35,0,2.625,'#ac885e');
 addBodyCladding(4*BAY,.31,0,3.505,'#a8855e');
 // Two0.82m-wide openings remain between the three upper plywood sections.
 for(const [lo,hi] of [[-2*BAY,-BAY-.41],[-BAY+.41,BAY-.41],[BAY+.41,2*BAY]])
  addBodyCladding(hi-lo,.55,(lo+hi)/2,3.075,'#b28f65');
 const paleDoor=k.box(body,'Bodywork pale courtyard door',[.95,2.08,.025],[-1.58*BAY,1.29,BAY+.043],'#d5cbb8',layers.wall);paleDoor.geometry=paleDoor.geometry.clone();paleDoor.geometry.translate(.475,0,0);paleDoor.position.x-=.475;paleDoor.rotation.y=-Math.PI/2;paleDoor.userData.source=occupiedFacade+'; open inspection pose, hinge and width fitted';
 const palePatch=k.box(body,'Bodywork pale plywood patch',[1.65,1.92,.025],[.83*BAY,1.21,BAY+.044],'#d9d7cc',layers.wall);palePatch.userData.source=occupiedFacade;
 k.box(body,'dojo fabric liner',[4*BAY-.4,1.8,.035],[0,1.3,-BAY+.09],'#576b61',layers.detail);
 // High unglazed daylight bands and ceiling fabric, visible in c45838.
 for(const z of [-BAY,BAY]){
  const band=k.box(body,'dojo high daylight band',[4*BAY-.3,.62,.035],[0,3.04,z],'#9baab0',layers.detail);
  band.material=new T.MeshStandardMaterial({color:'#c4d2ce',transparent:true,opacity:.23,roughness:.25,side:T.DoubleSide});band.userData.walkNoCollision=true;
  band.userData.source='c45838 bright upper daylight openings; front apertures follow c543/c564 plywood, translucent glazing fitted';
 }
 for(const x of [-BAY,BAY]){
  const cloth=k.box(body,'dojo ceiling fabric',[BAY-.4,.028,2*BAY-.5],[x,3.35,0],'#d8d6c9',layers.detail);
  const geometry=new T.PlaneGeometry(BAY-.4,2*BAY-.5,8,16);geometry.rotateX(-Math.PI/2);const vertices=geometry.getAttribute('position');
  for(let i=0;i<vertices.count;i++){const u=vertices.getX(i)/(BAY-.4)+.5,v=vertices.getZ(i)/(2*BAY-.5)+.5;vertices.setY(i,-.32*Math.sin(Math.PI*u)*Math.sin(Math.PI*v));}geometry.computeVertexNormals();cloth.geometry.dispose();cloth.geometry=geometry;(cloth.material as T.Material).side=T.DoubleSide;cloth.userData.walkNoCollision=true;cloth.userData.source='c45838 white cloth hangs in shallow swags below the roof; fitted sag, not a solid ceiling slab';
 }
 const toolDepth=8.5344,toolSouth=toolDepth/2;
 const dorm=hall(k,'secondary-house','Tool Camp · workshop and south solar wall',12.7,36.1,3,2,4.8768,false,toolDepth);
 dorm.rotation.y=.32;
 dorm.userData.entity_id='tool_camp_2025';dorm.userData.source='Registry states 36×28×16 ft; c518/c505/c46376/c46379 Apr 3 south solar facade and patchwork enclosure; c509 roof-plane fit review3: center(12.7,36.1), yaw0.32rad; uncertain by several meters';
 // User correction + c546: open middle through the upper deck; retain existing
 // left/right plywood sheets (and their IDs), rather than rebuilding the whole floor.
 for(const o of dorm.children.slice())if(o.userData.kind==='plywood deck sheet'&&Math.abs(o.position.y-2.46)<.01&&Math.abs(o.position.x)<BAY/2)dorm.remove(o);
 // Passage into the greenhouse behind the solar slope, with side-wall cladding.
 for(const side of [-1,1])k.wall(dorm,BAY,2.3,side*BAY,toolSouth,1.36);
 for(const side of [-1,1])k.wall(dorm,BAY,1.3,side*BAY,toolSouth,3.25,'#b39b77');
 // c46972: continuous white belt below the north clerestory, with a ground door.
 for(const side of [-1,1])k.wall(dorm,(3*BAY-1.05)/2,2.28,side*(3*BAY+1.05)/4,-toolSouth,1.35,'#b9a27e');
 k.wall(dorm,3*BAY,1.05,0,-toolSouth,3.0,'#d2d1c8');
 k.box(dorm,'north open clerestory dark interior',[3*BAY-.8,.65,.03],[.3,3.93,-toolSouth+.08],'#2b3030',layers.detail);
 k.box(dorm,'north door header',[1.05,.28,.08],[0,2.51,-toolSouth],'#ae936f',layers.wall);
 for(const side of [-1,1]){k.wall(dorm,toolDepth,2.24,side*1.5*BAY,0,1.34,'#af956f',Math.PI/2);
  k.box(dorm,'Tool Camp upper window strip',[.04,.56,3.4],[side*(1.5*BAY+.05),3.55,0],'#475258',layers.wall);
  // c543/c564 occupied-season side walls are clad above the lower floor;
  // the earlier open skeleton must not remain as the March facade. Window extent is fitted.
  k.wall(dorm,toolDepth,.78,side*1.5*BAY,0,2.88,'#ae9064',Math.PI/2);
  k.wall(dorm,toolDepth,.85,side*1.5*BAY,0,4.255,'#ad8d61',Math.PI/2);
  for(const end of [-1,1])k.wall(dorm,(toolDepth-3.4)/2,2.18,side*1.5*BAY,end*(toolDepth+3.4)/4,3.59,'#b19470',Math.PI/2);}
 k.deck(dorm,3*BAY,toolDepth,4.68,0,0,true);
 k.box(dorm,'dark tarp roof',[3*BAY,.055,toolDepth],[0,4.75,0],'#333536',layers.roof);
 // c505 resolves four horizontal courses, two banks separated by a clear access strip.
 for(let row=0;row<4;row++)for(let col=0;col<13;col++){
  const x=col<7?-4.9+col*.72:.88+(col-7)*.72,dz=(row-1.5)*1.49;
  k.solar(dorm,.71,1.44,x,2.35-dz*Math.sin(.65),toolSouth+2.3+dz*Math.cos(.65),.65);
 }

 // Interior review4: only Tool Camp canonical images, not adjacent Freeside meals.
 // c534: substantial wood benches, a left-wall machine line, and a rolling center bench.
 const toolEvidence='c534/DSCF7600 workshop; c554/DSCF7599 and c546/DSCF7622 hydroponics; user correction open center and upper side floors; dimensions/partition position fitted';
 const bench=(x:number,z:number,width:number,depth:number)=>{
  k.box(dorm,'Tool Camp workbench top',[width,.085,depth],[x,.98,z],'#d2b482',layers.detail);
  for(const sx of [-1,1])for(const sz of [-1,1])k.box(dorm,'Tool Camp timber bench leg',[.095,.685,.095],[x+sx*(width/2-.1),.595,z+sz*(depth/2-.1)],'#aa8157',layers.detail);
  k.box(dorm,'Tool Camp bench lower shelf',[width-.1,.06,depth-.08],[x,.42,z],'#ae8d63',layers.detail);
 };
 bench(-4.65,-.4,1.0,5.2);bench(-2.65,.15,1.55,2.5);bench(3.95,-.7,2.2,.75);
 // Distinct silhouettes, not a pile of anonymous cubes: photographed woodworking machines.
 const disc=(kind:string,x:number,y:number,z:number,r:number,color:string)=>{
  const m=new T.Mesh(new T.CylinderGeometry(r,r,.055,20),k.mat(color,.5));m.rotation.x=Math.PI/2;m.position.set(x,y,z);k.tag(dorm,m,kind,layers.detail);return m;
 };
 k.box(dorm,'Tool Camp miter saw base',[.72,.12,.55],[-4.65,1.08,-2.0],'#4c5557',layers.detail);
 disc('Tool Camp miter saw blade',-4.65,1.48,-2.0,.27,'#bfc5c3');
 k.rod(dorm,'Tool Camp saw pivot arm',[-4.65,1.12,-2.25],[-4.65,1.57,-2.18],.055,'#465053',layers.detail);
 k.box(dorm,'Tool Camp saw motor',[.32,.22,.27],[-4.42,1.42,-2.2],'#873e33',layers.detail);
 k.rod(dorm,'Tool Camp drill press column',[-4.65,1.06,-.75],[-4.65,1.85,-.75],.055,'#626b69',layers.detail);
 k.box(dorm,'Tool Camp drill press head',[.36,.23,.50],[-4.65,1.86,-.68],'#4c5251',layers.detail);
 k.box(dorm,'Tool Camp drill table',[.40,.045,.37],[-4.65,1.42,-.53],'#aaaca4',layers.detail);
 k.rod(dorm,'Tool Camp drill spindle',[-4.65,1.5,-.47],[-4.65,1.75,-.47],.025,'#bcbdb3',layers.detail);
 k.box(dorm,'Tool Camp belt sander',[.18,.72,.34],[-4.65,1.39,.28],'#76665f',layers.detail);
 disc('Tool Camp disc sander',-4.65,1.21,.63,.18,'#918d82');
 k.box(dorm,'Tool Camp grinder motor',[.30,.23,.24],[-4.65,1.18,1.42],'#3c4644',layers.detail);
 for(const z of [1.16,1.68])disc('Tool Camp grinder wheel',-4.65,1.2,z,.14,'#505655');
 k.box(dorm,'Tool Camp stored table saw',[.76,.49,.64],[-2.65,.69,.28],'#637375',layers.detail);
 k.box(dorm,'Tool Camp table saw top',[.89,.07,.77],[-2.65,.96,.28],'#313937',layers.detail);
 k.box(dorm,'Tool Camp handheld circular saw',[.30,.23,.30],[-2.4,1.15,.55],'#a6aa26',layers.detail);
 k.box(dorm,'Tool Camp timber tool rail',[.065,.10,1.65],[-5.28,1.93,1.15],'#9d7e54',layers.detail);
 for(let i=0;i<9;i++){
  const z=.43+i*.17;k.rod(dorm,'Tool Camp hanging hand tool',[-5.21,1.88,z],[-5.21,1.55+(i%3)*.05,z],.025,['#d4b526','#355986','#b85935'][i%3],layers.detail);
 }
 for(const x of [-4.65,-2.65,3.95])k.box(dorm,'Tool Camp loose parts box',[.42,.25,.32],[x,1.15,1.0],'#958367',layers.detail);
 k.box(dorm,'Tool Camp electronics shelf',[2.8,.07,.62],[3.85,1.35,-2.1],'#b29b76',layers.detail);
 for(let i=0;i<4;i++)k.box(dorm,'Tool Camp electronics organizer',[.43,.22,.36],[2.8+i*.55,1.495,-2.1],'#c4c7bd',layers.detail);
 // User identifies upstairs pod; c505 confirms enclosed left upper portion. Interior contents unobserved.
 for(const side of [-1,1])k.wall(dorm,.965,1.95,-BAY+side*.8925,1.0,3.5,'#c2b59c');
 k.wall(dorm,.82,.22,-BAY,1.0,4.365,'#c2b59c');
 for(const side of [-1,1])k.wall(dorm,2.4,1.95,-BAY+side*1.375,2.2,3.5,'#b2a58d',Math.PI/2);
 k.box(dorm,'Tool Camp upper pod doorway',[.82,.12,.04],[-BAY,4.25,.955],'#413e36',layers.wall);
 // c554/c546: shaded growing area on sand behind the inclined solar modules.
 // White PV backs, timber battens and a clear central strip are visible from inside.
 const greenhouseZ=toolSouth+1.28;
 for(const side of [-1,1]){
  const backing=k.box(dorm,'Tool Camp solar white backing',[4.48,.025,5.9],[side*2.95,2.31,toolSouth+2.3],'#dad9cb',layers.roof);backing.rotation.x=.65;
 }
 for(const x of [-5.35,-.3,.72,5.32])k.rod(dorm,'Tool Camp sloped solar timber support',[x,4.40,toolSouth-.05],[x,.53,toolSouth+4.67],.055,'#b99a66',layers.steel);
 const clearSlope=k.box(dorm,'Tool Camp solar clear middle strip',[1.02,.022,5.90],[.20,2.34,toolSouth+2.3],new T.MeshStandardMaterial({color:'#dbdfd4',transparent:true,opacity:.26,side:T.DoubleSide}),layers.roof);clearSlope.rotation.x=.65;
 for(let i=0;i<6;i++)k.box(dorm,'Tool Camp greenhouse timber batten',[1.10,.055,.09],[.2,4.05-i*.61,toolSouth+.07+i*.77],'#b89664',layers.steel);
 const tube=(name:string,x:number,y:number,z:number,length:number,color:string)=>k.rod(dorm,name,[x-length/2,y,z],[x+length/2,y,z],.065,color,layers.detail);
 // Left freestanding four-tier white PVC hydroponic rig.
 for(const x of [-1.50,.05])k.rod(dorm,'Tool Camp white grow rack upright',[x,0,greenhouseZ+.50],[x,1.68,greenhouseZ-.15],.027,'#d6d3bf',layers.detail);
 for(let tier=0;tier<4;tier++){
  const yy=.4+tier*.38,zz=greenhouseZ+.48-tier*.18;tube('Tool Camp white grow channel',-.72,yy,zz,1.55,'#d8d3be');
  for(let pot=0;pot<6;pot++){
   const xx=-1.36+pot*.25;const ring=new T.Mesh(new T.TorusGeometry(.045,.011,5,10),k.mat('#7b7560'));ring.rotation.x=Math.PI/2;ring.position.set(xx,yy+.065,zz);k.tag(dorm,ring,'Tool Camp grow net pot',layers.detail);
   if((pot+tier)%3!==0){k.rod(dorm,'Tool Camp seedling stem',[xx,yy+.07,zz],[xx,yy+.25,zz],.007,'#668644',layers.detail);const leaf=k.box(dorm,'Tool Camp seedling leaf',[.13,.014,.06],[xx+.035,yy+.2,zz],'#73964c',layers.detail);leaf.rotation.z=.4;}
  }
 }
 // Right wire rack, three paired dark-blue channels, reservoir below, grow lights above.
 for(const x of [1.0,2.9])for(const z of [greenhouseZ-.18,greenhouseZ+.55])k.rod(dorm,'Tool Camp wire grow rack upright',[x,0,z],[x,2.1,z],.018,'#a5aaa5',layers.detail);
 for(let tier=0;tier<3;tier++){
  const yy=.55+tier*.55;for(const zz of [greenhouseZ,greenhouseZ+.35])tube('Tool Camp blue grow channel',1.95,yy,zz,1.8,'#274f65');
  for(let i=0;i<7;i++)k.rod(dorm,'Tool Camp wire grow shelf',[1.0,yy-.1,greenhouseZ-.18+i*.12],[2.9,yy-.1,greenhouseZ-.18+i*.12],.009,'#a4aaa5',layers.detail);
  for(const xx of [1.45,2.45]){k.box(dorm,'Tool Camp grow light bar',[.47,.04,.06],[xx,yy+.36,greenhouseZ+.15],'#dbdccc',layers.detail);k.box(dorm,'Tool Camp grow light crossbar',[.06,.04,.42],[xx,yy+.36,greenhouseZ+.15],'#dbdccc',layers.detail);}
 }
 for(let pot=0;pot<6;pot++){
  const xx=1.2+pot*.29;k.rod(dorm,'Tool Camp blue rack plant stem',[xx,1.71,greenhouseZ],[xx,2.16,greenhouseZ],.008,'#658547',layers.detail);
  for(const side of [-1,1]){const leaf=k.box(dorm,'Tool Camp blue rack plant leaf',[.20,.015,.08],[xx+side*.07,1.95+side*.09,greenhouseZ],'#6d9248',layers.detail);leaf.rotation.z=side*.45;}
 }
 for(const [x,w] of [[-.65,1.1],[1.95,1.8]])k.box(dorm,'Tool Camp nutrient reservoir',[w,.38,.75],[x,.19,greenhouseZ+.2],'#323b39',layers.detail);
 // c46549: mixed equipment behind/beside the blue bus; positions within work yard estimated.
 for(let i=0;i<3;i++)k.box(dorm,'Tool Camp yard equipment tote',[.70,.42,.48],[-8.7+i*.75,.21,-1.4],'#3b4141',layers.context);
 k.box(dorm,'Tool Camp yard timber stack',[.65,.22,2.8],[-8.0,.11,-2.5],'#a58a63',layers.context);
 for(const x of [-9.0,-7.8])for(const z of [-4.1,-3.3])k.rod(dorm,'Tool Camp yard equipment rack',[x,0,z],[x,1.55,z],.025,'#a0a79f',layers.context);
 for(const y of [.15,.75,1.5])k.box(dorm,'Tool Camp yard equipment shelf',[1.25,.04,.85],[-8.4,y,-3.7],'#a8ada5',layers.context);
 dorm.traverse(o=>{if(o.userData.kind?.startsWith('Tool Camp'))o.userData.source=toolEvidence;});
 // Individually resolved Jan23 c509 panorama vehicles, recorded in
 // year-2025/review2/vehicle-census.json. Coordinates are a bearing/scale fit;
 // the count is source-derived and does not imply every later-season vehicle.
 const rv:[number,number,number,number][]=[
  [-35.8,23.1,-.5,8],[-35.4,14.0,-.5,8],[-32.6,4.4,-.5,8],[-27.8,-4.2,-.5,8],
  [-4,-14,0,7.5],[5,-13,0,7.6],[15,-18,Math.PI/2,7.0],
  [11,-35,0,4.8],[16,-39,0,6.0],
 ];
 rv.forEach(([x,z,angle,length],i)=>{const t=k.rv(`rv-${i+1}`,x,z,angle,length);t.userData.source=`c509 Jan23 individually resolved camping unit ${i+1}; last two distant class uncertain; position fit`});
 const vehicleTire2025=new T.CylinderGeometry(.36,.36,.17,10,1,false,Math.PI/10);vehicleTire2025.translate(-.20,0,0); // old wheel ids retained; seat tire bottoms at ground−.16
 const vehicle=(id:string,name:string,x:number,z:number,angle:number,length:number,color:string,bus=false)=>{
  const v=k.assembly(id,name,[x,0,z],angle);v.userData.source='c509 Jan23 four panorama sectors; discrete observed vehicle, fitted position';
  const width=bus?2.45:1.9,van=/van/.test(name),pickup=/pickup/.test(name),top=bus?2.55:van?2.10:1.55,hood=bus?1.55:van?1.25:.90;
  const body=k.box(v,'vehicle body',[width,bus?2.3:1.3,length],[0,bus?1.4:.9,0],color,layers.context);
  const profile:[number,number][]=[[-length/2,.25],[-length/2,pickup?.88:top-.23],[-length*.36,pickup?.88:top],[-length*.20,top],[length*.16,top],[length*.33,hood],[length/2,hood-.10],[length/2,.25]];
  const outline=new T.Shape();profile.forEach(([z,y],i)=>i?outline.lineTo(-z,y-body.position.y):outline.moveTo(-z,y-body.position.y));outline.closePath();
  body.geometry=new T.ExtrudeGeometry(outline,{depth:width,bevelEnabled:false});body.geometry.rotateY(Math.PI/2);body.geometry.translate(-width/2,0,0);
  const windshield=k.box(v,'vehicle windshield',[bus?2.15:1.65,.6,.05],[0,bus?1.8:1.25,length/2+.03],'#3c4e59',layers.context);
  windshield.geometry=windshield.geometry.clone();windshield.geometry.rotateX(-.65);windshield.geometry.translate(0,bus?.25:van?.32:-.015,-length*.255);
  for(const side of [-1,1])for(const zz of [-length*.3,length*.3]){const wheel=new T.Mesh(vehicleTire2025,k.mat('#272827'));wheel.rotation.z=Math.PI/2;wheel.position.set(side*(bus?1.24:.97),.4,zz);k.tag(v,wheel,'vehicle wheel',layers.context);}
  for(const side of [-1,1]){
   k.box(v,'vehicle side glazing',[.025,bus?.63:.45,length*(bus?.58:pickup?.33:.43)],[side*(width/2+.014),bus?2.06:van?1.68:1.25,pickup?0:-length*.10],'#3c4e59',layers.context);
   k.box(v,'vehicle headlamp',[.29,.16,.04],[side*width*.33,bus?1.03:.68,length/2+.025],'#e6e1c4',layers.context);
  }
  k.box(v,'vehicle front bumper',[width+.06,.15,.13],[0,.44,length/2+.025],'#555c5d',layers.context);
  if(pickup)k.box(v,'pickup open bed interior',[width-.17,.025,length*.29],[0,.90,-length*.345],'#494e4b',layers.context);
  v.userData.source+='; low-poly vehicle class, hood/glazing and trim proportions approximate; no inferred manufacturer';
  return v;
 };
 vehicle('rv-10','Solar Sam bus west of Tool Camp',2.6,40.6,.32,7.6,'#286b9a',true);
 vehicle('observed-black-bus','Dark bus northwest of Chiba',-12,-17,Math.PI/2,7,'#343331',true);
 const small:[number,number,number,string,string][]=[
  [-4,-7,Math.PI/2,'white row-end panel van','#deddd8'],[-44,-5,0,'dark west-row car','#373b39'],
  [-14,-23,Math.PI/2,'light car behind dark bus','#adb7b2'],[6,-48,Math.PI/2,'distant light utility vehicle','#c4c9c0'],[12,-47,Math.PI/2,'distant dark vehicle','#303c41'],
  [18,-32,Math.PI/2,'pickup near distant campers','#65716d'],[18,1,0,'east grey sedan','#67645f'],[22,2,0,'east white pickup','#e1e2db'],
  [21,11,Math.PI/2,'white van behind Bodywork','#d8dfdc'],[29,6,Math.PI/2,'dark east car','#333d3b'],
 ];
 small.forEach(([x,z,angle,name,color],i)=>vehicle(`observed-car-${i+1}`,name,x,z,angle,i===0||i===8?5.4:4.6,color));
 add2025Reconciliation(k,g,free,body,dorm);
}
