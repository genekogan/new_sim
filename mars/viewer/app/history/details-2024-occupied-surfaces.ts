import * as T from 'three';
import {Kit,BAY,layers,slug} from './kit';

/** Occupied January/March evidence corrections. Existing owners stay intact;
 * January parking is retained with March frontage, explicitly a phase blend. */
export function add2024OccupiedSurfaces(k:Kit,chiba:T.Group,free:T.Group){
 const add=(g:T.Object3D,name:string,size:[number,number,number],at:[number,number,number],color:string,source:string,layer:string=layers.detail)=>{const m=k.box(g,name,size,at,color,layer);m.userData.source=source;return m;};
 // Kit.screen's default2020 portal still is not evidence for2024 media.
 k.root.traverse(o=>{if(o.userData.kind==='display content'){o.visible=false;o.userData.walkNoCollision=true;o.userData.historicalQuarantine=true;o.userData.source='2024 auditorium/projection source supports screen surface but not default2020 portal still; media image quarantined, component ID and black screen bezel retained.';}});
 const paint='c43729 build and c42690 March3 occupied Chiba: blue/navy-grey uprights and braces with orange beams; nominal color under neutral viewer lighting';
 k.root.traverse(o=>{if(o instanceof T.Mesh&&/^(?:rack upright|upright bracing|rack diagonal brace)$/.test(o.userData.kind||'')){o.material=k.mat('#4d6274',.55);o.userData.source=(o.userData.source||'')+'; '+paint;}});
 // c42696/A7400889 March3 independently establishes the lower east mural.
 // It is not the unsupported cross-year2022 texture formerly reused here.
 const eastArt=new T.Mesh(new T.PlaneGeometry(3*BAY,2.24),k.photo('/history/2024/occupied-20261001/chiba-east-march-native.webp'));eastArt.rotation.y=Math.PI/2;eastArt.position.set(3*BAY+.065,1.38,0);(eastArt.material as T.Material).transparent=true;(eastArt.material as T.Material).alphaTest=.3;k.tag(chiba,eastArt,'2024 Chiba native March east mural',layers.wall);eastArt.userData.walkNoCollision=true;eastArt.userData.source='c42696/A7400889-D50F7 March3 finished frontage/east: photographed blue/black/white arches on lower east face. Native quad on1920preview(1292,739)(1293,824)(1424,822)(1428,738), scaled to7008px original; left foreground person and ground alpha-masked; extent fitted to existing nominal lower east wall. Phase blend with January plan, not2022 artwork.';
 const west=k.root.children.find(o=>o.userData.assembly_id==='freeside-west-wing'),east=k.root.children.find(o=>o.userData.assembly_id==='freeside-wing');
 const finished='c42691/A7400848-F9C89 March3 occupied view from north Chiba stairs: completed Freeside front, west painted panels/two open doors; east plywood, blue and white panels. Nominal January footprint retained; door dimensions/coordinates fitted.';
 for(const wing of [west,east]){
  if(!wing)continue;
  // The aggregate solid booth pierced the source door routes. Retain its ID
  // invisibly; source-directed wall panels now describe this room envelope.
  for(const o of wing.children)if(o.userData.kind==='front utility booth'){o.visible=false;o.userData.walkNoCollision=true;o.userData.historicalQuarantine=true;o.userData.source=finished+' Old aggregate solid booth proxy omitted to preserve actual door openings; ID retained.';}
  const wall=wing.children.find(o=>o instanceof T.Mesh&&o.userData.kind==='plywood wall'&&Math.abs(o.position.z-BAY)<.02) as T.Mesh|undefined;
  if(!wall)continue;
  const openings=wing===west?[{x:-1.62,w:.80},{x:1.00,w:1.10}]:[{x:.63,w:.85}];
  const shape=new T.Shape();shape.moveTo(-BAY,-.95);shape.lineTo(BAY,-.95);shape.lineTo(BAY,.95);shape.lineTo(-BAY,.95);shape.closePath();
  for(const door of openings){const hole=new T.Path();hole.moveTo(door.x-door.w/2,-.94);hole.lineTo(door.x-door.w/2,.88);hole.lineTo(door.x+door.w/2,.88);hole.lineTo(door.x+door.w/2,-.94);hole.closePath();shape.holes.push(hole);}
  if(wing===west){const hole=new T.Path();hole.moveTo(1.62,-.18);hole.lineTo(1.62,.50);hole.lineTo(1.99,.50);hole.lineTo(1.99,-.18);hole.closePath();shape.holes.push(hole);}
  if(wing===east)for(const x of [1.79,2.79]){const hole=new T.Path();hole.moveTo(x-.335,.31);hole.lineTo(x-.335,.79);hole.lineTo(x+.335,.79);hole.lineTo(x+.335,.31);hole.closePath();shape.holes.push(hole);}
  const geometry=new T.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false});geometry.translate(0,0,-.0275);wall.geometry=geometry;wall.userData.source=finished;
  for(const door of openings){
   for(const side of [-1,1])add(wing,'2024 Freeside occupied door jamb',[.045,1.87,.07],[door.x+side*door.w/2,1.19,BAY+.018],'#dad3bf',finished,layers.wall);
   add(wing,'2024 Freeside occupied door header',[door.w+.06,.045,.07],[door.x,2.07,BAY+.018],'#dad3bf',finished,layers.wall);
  }
  if(wing===west){
   add(wing,'2024 Freeside finished white front panels',[1.62,1.90,.022],[-2.84,1.17,BAY+.04],'#e3e1d8',finished,layers.wall);
   for(const [x,width,url] of [[-.40,1.61,'freeside-west-green-mural'],[2.60,1.99,'freeside-west-red-mural']] as const){const m:T.Mesh=new T.Mesh(new T.PlaneGeometry(width,1.88),k.photo(`/history/2024/occupied-20261001/${url}.webp`));m.position.set(x,1.17,BAY+.051);k.tag(wing,m,'2024 Freeside native occupied west mural',layers.wall);(m.material as T.Material).transparent=true;(m.material as T.Material).alphaTest=.3;if(url==='freeside-west-red-mural'){const panel=new T.Shape();panel.moveTo(-width/2,-.94);panel.lineTo(width/2,-.94);panel.lineTo(width/2,.94);panel.lineTo(-width/2,.94);panel.closePath();const hole=new T.Path();hole.moveTo(1.62-x,-.18);hole.lineTo(1.62-x,.50);hole.lineTo(1.99-x,.50);hole.lineTo(1.99-x,-.18);hole.closePath();panel.holes.push(hole);const geo=new T.ShapeGeometry(panel),pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/width+.5,pos.getY(i)/1.88+.5);m.geometry=geo;}m.userData.walkNoCollision=true;m.userData.source=finished+' Native wall panels from March3 source, fitted rectification; green-panel tarp/chair/table occlusions alpha-masked rather than copied as artwork; no projected light copied.';}
   const window=add(wing,'2024 Freeside occupied west window',[.37,.68,.024],[1.805,1.33,BAY+.057],'#3b4648',finished+' Narrow black-framed window physically cut through original wall and native red mural; dimensions fitted from native panel.',layers.wall);window.material=new T.MeshStandardMaterial({color:'#43585e',transparent:true,opacity:.24,roughness:.35,side:T.DoubleSide});
   for(const dx of [-.195,.195])add(wing,'2024 Freeside west window frame',[.024,.72,.035],[1.805+dx,1.33,BAY+.07],'#222b2c',finished,layers.wall);
   add(wing,'2024 Freeside west window crossbar',[.38,.025,.035],[1.805,1.24,BAY+.07],'#222b2c',finished,layers.wall);
  }else{
   add(wing,'2024 Freeside occupied blue door panel',[.90,1.9,.026],[.63,1.17,BAY+.045],'#5a62a2',finished,layers.wall);
   // Open inspection pose follows the physical doorway, not a closed box.
   const leaf=wing.children.at(-1) as T.Mesh;leaf.geometry=leaf.geometry.clone();leaf.geometry.translate(.45,0,0);leaf.position.x-=.45;leaf.rotation.y=-Math.PI/2;
   const white=add(wing,'2024 Freeside occupied white east wall',[2.55,1.9,.022],[2.34,1.17,BAY+.04],'#dcded8',finished,layers.wall),skin=new T.Shape();skin.moveTo(-1.275,-.95);skin.lineTo(1.275,-.95);skin.lineTo(1.275,.95);skin.lineTo(-1.275,.95);skin.closePath();for(const x of [1.79,2.79]){const cx=x-2.34,hole=new T.Path();hole.moveTo(cx-.335,.31);hole.lineTo(cx-.335,.79);hole.lineTo(cx+.335,.79);hole.lineTo(cx+.335,.31);hole.closePath();skin.holes.push(hole);}white.geometry=new T.ExtrudeGeometry(skin,{depth:.022,bevelEnabled:false});white.geometry.translate(0,0,-.011);
   for(const x of [1.79,2.79]){
    const glass=add(wing,'2024 Freeside occupied east window',[.67,.48,.024],[x,1.72,BAY+.057],'#566873',finished,layers.wall);glass.material=new T.MeshStandardMaterial({color:'#91a5aa',transparent:true,opacity:.24,roughness:.35,side:T.DoubleSide});
    for(const dx of [-.35,.35])add(wing,'2024 Freeside east window frame',[.035,.53,.033],[x+dx,1.72,BAY+.07],'#d9d6c6',finished,layers.wall);
   }
  }
  // c30786 resolves three differently rounded west tents and three east
  // canvas cabins with truncated tops, not six identical pointed pyramids.
  const roofs=wing.children.filter(o=>o instanceof T.Mesh&&o.userData.kind==='peaked canvas shelter roof') as T.Mesh[];
  for(let i=0;i<roofs.length;i++){
   const r=roofs[i];
   if(wing===west){const geometry=new T.SphereGeometry(1,12,6,0,2*Math.PI,0,Math.PI/2);geometry.scale(i===1?1.02:1.30,1.02,i===1?1.45:1.32);geometry.translate(0,-.51,0);r.geometry=geometry;}
   else r.geometry=new T.CylinderGeometry(.72,1.45,1.02,4,1,false,Math.PI/4);
   r.userData.source='c30786 Jan22 original Freeside roof crop: three rounded/differing west tents and three flat-topped beige east canvas shelters. Existing centers/IDs retained; fabric curves and dimensions fitted.';
  }
 }
 // March3 gallery: the circular rainbow is projected light, not persistent
 // paint. Add only its physical furnishing and white side cloth.
 const gallery=chiba.children.find(o=>o.userData.assembly_id==='upper-gallery');
 if(gallery){
  const src='c42690/A7400844-DF009 March3 occupied upper gallery: side pin-up wall/shelf, two brown upholstered chairs, red cabinet, art/display boxes, white side cloth and hanging lights. Exact bay allocation remains a proxy; rainbow is projected light, not paint.';
  add(gallery,'2024 gallery observed side pinup wall',[.025,2.14,2*BAY-.18],[-BAY+.08,1.14,0],'#dfded4',src,layers.wall);
  add(gallery,'2024 gallery observed side shelf',[.35,.055,2*BAY-.30],[-BAY+.25,1.08,0],'#c0ac90',src);
  for(const z of [-2.6,-1.2,.2,1.6,2.8]){const paper=add(gallery,'2024 gallery observed pinup sheet',[.006,.32,.22],[-BAY+.10,1.64,z],'#e7e5d9',src);paper.userData.walkNoCollision=true;}
  for(const x of [-.7,1.15]){
   add(gallery,'2024 gallery brown chair back',[.78,.65,.15],[x,.77,.43],'#674434',src);
   for(const side of [-1,1])add(gallery,'2024 gallery brown chair arm',[.13,.25,.82],[x+side*.36,.66,.75],'#684837',src);
  }
  for(const [x,z,w,h,d] of [[-.8,-.7,.65,.53,.62],[-.35,.25,.77,.66,.65],[.15,1.18,.65,.31,.59],[.7,1.85,.55,.25,.48]] as const){add(gallery,'2024 gallery observed art display box',[w,h,d],[x,h/2+.24,z],'#a98d68',src);add(gallery,'2024 gallery display box paper label',[w*.46,.09,.004],[x,h*.61+.24,z+d/2+.003],'#e6e1d1',src).userData.walkNoCollision=true;}
  // Rack-edge curtain intentionally does not seal the open overlook.
  const curtain=add(gallery,'2024 gallery white hanging side cloth',[.015,1.72,1.12],[BAY-.15,1.49,-1.65],'#d8d7ca',src);curtain.userData.walkNoCollision=true;
  const bulbMat=new T.MeshStandardMaterial({color:'#ece6d1',emissive:'#e8caa0',emissiveIntensity:.3});
  for(const z of [-2.6,-1.3,0,1.3,2.6]){const bulb=new T.Mesh(new T.SphereGeometry(.035,8,6),bulbMat);bulb.position.set(BAY-.22,2.14,z);k.tag(gallery,bulb,'2024 gallery occupied hanging bulb',layers.detail);bulb.userData.walkNoCollision=true;bulb.userData.source=src;}
 }
 const dojo=chiba.children.find(o=>o.userData.assembly_id==='dojo');
 if(dojo){
  const src='c1016/PXL_20240208_235134591 Feb8 occupied upper east dojo, mislabeled2023 folder: hanging white/pink mandala cloth over plywood, black foam mats, two red/blue yoga mats and low plywood shelf. Native cloth quad on1824preview(448,152)(477,553)(948,536)(977,209) scaled to4080original; extents fitted.';
  const wall=dojo.children.find(o=>o.userData.kind==='plywood wall');if(wall instanceof T.Mesh){wall.material=k.mat('#b59a78');wall.userData.source=src+' Wood remains visible outside hanging textile, not a solid pink wall.';}
  const textile=new T.Mesh(new T.PlaneGeometry(BAY-.46,1.85),k.photo('/history/2024/occupied-20261001/dojo-pink-native.webp'));textile.position.set(0,1.13,-1.5*BAY+.05);k.tag(dojo,textile,'2024 dojo native photographed pink textile',layers.detail);textile.userData.source=src;textile.userData.walkNoCollision=true;
  add(dojo,'2024 dojo observed low plywood shelf',[2.8,.12,.46],[0,.18,-1.5*BAY+.60],'#a98c66',src);
  for(const [x,color] of [[-.76,'#a15e60'],[.76,'#687e8b']] as const)add(dojo,'2024 dojo observed yoga mat',[1.42,.008,.62],[x,.062,-1.5*BAY+1.20],color,src,layers.floor).userData.walkNoCollision=true;
 }
 const solarium=chiba.children.find(o=>o.userData.assembly_id==='solarium');
 if(solarium){
  const src='A7400852-C8287 March3 occupied southeast solarium: beige upholstered chair/sofa, potted plants and hanging planter under real clear sloping glazing. Nominal furnishing dimensions/placement fitted away from retained east door; no occupant recreation.';
  add(solarium,'2024 solarium beige sofa back',[2.50,.63,.17],[0,.75,-2.01],'#b7a78d',src);
  for(const side of [-1,1])add(solarium,'2024 solarium beige sofa arm',[.15,.30,.85],[side*1.17,.67,-1.65],'#b9a88e',src);
  add(solarium,'2024 solarium observed beige chair seat',[.80,.18,.82],[-.55,.56,-.40],'#bba88c',src);
  add(solarium,'2024 solarium observed beige chair back',[.80,.69,.17],[-.55,.97,-.73],'#b7a58a',src);
  for(const side of [-1,1])add(solarium,'2024 solarium observed beige chair arm',[.13,.27,.82],[-.55+side*.36,.74,-.40],'#bba88c',src);
  for(const [i,[x,z]] of [[-1.32,.82],[-1.30,1.40]].entries()){
   const pot=new T.Mesh(new T.CylinderGeometry(.15,.12,.31,10),k.mat('#404c40'));pot.position.set(x,.47,z);k.tag(solarium,pot,'2024 solarium observed plant pot',layers.detail);pot.userData.source=src;
   const stem=k.rod(solarium,'2024 solarium observed plant stem',[x,.62,z],[x,.62+.28+i*.09,z],.007,'#637747',layers.detail);stem.userData.source=src;
   for(const side of [-1,1]){const leaf=add(solarium,'2024 solarium plant broad leaf',[.20,.012,.07],[x+side*.07,.77+i*.06,z],'#708748',src);leaf.rotation.z=side*.42;leaf.userData.walkNoCollision=true;}
  }
 }
 const kitchen=chiba.children.find(o=>o.userData.assembly_id==='chiba-kitchen');
 if(kitchen){
  const src='c42862/IMG_1891-FF3F1 Feb21 Gene-labeled Chiba kitchen: metal-grate floor, red under-counter refrigerator and prep counter with large oil jar/bowl. Bay remains proxy; platform/grate placement fitted above nominal floor, not measured.';
  // Previously the grating lived below the whole-hall plywood deck. Raise
  // the complete local furnishing together so the source surface is exposed.
  kitchen.position.y=.17;kitchen.userData.source+='; '+src;
  for(let x=-1.40;x<=1.41;x+=.14)add(kitchen,'2024 kitchen metal grate slot',[.032,.004,2.19],[x,.127,0],'#414b4c',src,layers.floor).userData.walkNoCollision=true;
  for(let z=-1.07;z<=1.08;z+=.14)add(kitchen,'2024 kitchen metal grate slot',[2.83,.004,.027],[0,.128,z],'#414b4c',src,layers.floor).userData.walkNoCollision=true;
  add(kitchen,'2024 kitchen red refrigerator handle',[.24,.026,.045],[.8,.52,-.23],'#a1a9a6',src);
  const bowl=new T.Mesh(new T.CylinderGeometry(.24,.19,.09,12),k.mat('#a6aeaa',.4));bowl.position.set(-.48,1.035,-.62);k.tag(kitchen,bowl,'2024 kitchen observed prep bowl',layers.detail);bowl.userData.source=src;
  add(kitchen,'2024 kitchen observed large oil jar',[.16,.30,.16],[.98,1.14,-.51],'#c4ba70',src);
  add(kitchen,'2024 kitchen oil jar dark cap',[.095,.035,.095],[.98,1.31,-.51],'#3b4f4f',src);
 }
 const courtyard='c42691 March3 north-stair view: pink four-post lounge with curtains and blue seating in courtyard. Four-post envelope/soft furnishings observed; 2.8×2.1m and position between Chiba/Freeside fitted, not surveyed.';
 const lounge=k.assembly('courtyard-pink-lounge-2024','Courtyard · occupied pink lounge',[0,0,-24],0,courtyard);
 add(lounge,'2024 courtyard pink lounge deck',[2.8,.17,2.1],[0,.16,0],'#bc7190',courtyard,layers.floor);
 for(const x of [-1.35,1.35])for(const z of [-1.0,1.0])add(lounge,'2024 courtyard pink lounge upright',[.065,2.15,.065],[x,1.25,z],'#b66a8f',courtyard);
 for(const z of [-1,1])add(lounge,'2024 courtyard pink lounge top bar',[2.75,.055,.055],[0,2.33,z],'#bc7190',courtyard);
 for(const x of [-1.35,1.35])add(lounge,'2024 courtyard pink lounge top bar',[.055,.055,2.05],[x,2.33,0],'#bc7190',courtyard);
 for(const x of [-1.24,1.24])add(lounge,'2024 courtyard gathered pink curtain',[.18,1.86,1.90],[x,1.38,0],'#bd86a0',courtyard).userData.walkNoCollision=true;
 add(lounge,'2024 courtyard lounge blue seat',[2.35,.21,.82],[0,.47,-.49],'#627990',courtyard);
 add(lounge,'2024 courtyard lounge blue back',[2.35,.42,.16],[0,.71,-.84],'#627990',courtyard);
 const tankSource='c42691 March3 occupied courtyard: seven visible IBC containers along courtyard edges/vehicle row. Fitted1m cage/container and approximate positions; photograph does not establish contents or all-season count.';
 const tanks:[number,number][]=[[-18,-5],[-18,-20],[-17,-29],[-12,-37],[13,-35],[20,-25],[20,-5]];
 for(const [i,[x,z]] of tanks.entries()){
  const tank=k.assembly(`courtyard-ibc-2024-${i+1}`,'Courtyard · observed IBC',[x,0,z],0,tankSource);
  add(tank,'2024 courtyard IBC container',[.96,1.01,.96],[0,.62,0],'#dce0d9',tankSource);
  add(tank,'2024 courtyard IBC base',[1.06,.12,1.06],[0,.065,0],'#555c59',tankSource);
  add(tank,'2024 courtyard IBC cap',[.15,.055,.15],[0,1.15,0],'#646964',tankSource);
  for(const xx of [-.50,.50])for(const zz of [-.50,.50])k.rod(tank,'2024 courtyard IBC cage upright',[xx,.13,zz],[xx,1.13,zz],.010,'#8d9895',layers.detail);
  for(const y of [.20,.64,1.08])for(const side of [-1,1]){
   k.rod(tank,'2024 courtyard IBC cage ring',[-.5,y,side*.5],[.5,y,side*.5],.009,'#8d9895',layers.detail);
   k.rod(tank,'2024 courtyard IBC cage ring',[side*.5,y,-.5],[side*.5,y,.5],.009,'#8d9895',layers.detail);
  }
 }
 const names=new Map<string,number>();k.root.traverse(o=>{const kind=String(o.userData.kind||'');if(!kind.startsWith('2024 '))return;const key=o.userData.assembly_id+'|'+kind,n=(names.get(key)||0)+1;names.set(key,n);k.named(o,slug(kind)+'-'+String(n).padStart(2,'0'));});
 // Freeside core is used to document the phase blend without moving its
 // calibrated relative layout or counted PV components.
 free.userData.source+='; c42691 March3 occupied front details represented on January22 fitted plan; phase blend explicitly retained';
}
