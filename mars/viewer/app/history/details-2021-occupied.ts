import * as T from 'three';
import {Kit, layers} from './kit';

/** Dated occupied details; the host remains a Jan–Mar seasonal composite.
 * Each location is a photographic fit, never a surveyed room registration.
 * All additions use explicit IDs, so existing anonymous component IDs survive.
 */
export function add2021OccupiedDetails(k:Kit) {
 // Freeze original owner IDs BEFORE photographic repositioning. Kit's final
 // pass then retains these identities and assigns separate names to additions.
 k.finalize();
 k.root.traverse(o=>{
  const a=String(o.userData.assembly_id??''),id=String(o.userData.component_id??'');
  if(a&&id.startsWith(`${a}-`))k.named(o,id.slice(a.length+1));
 });
 // Jan29 image2-488D4: dark navy perforated uprights/braces; orange beams.
 // Override only year2021 materials, preserving Kit cache and owner geometry.
 const navy=k.mat('#273748',.45);
 k.root.traverse(o=>{if(o instanceof T.Mesh&&/^(rack upright|upright bracing|upright crossbar)$/.test(o.name))o.material=navy;});
 const assembly=(id:string)=>k.root.children.find(o=>o.userData.assembly_id===id)!;
 const key=(id:string)=>`2021-${id.replace(/(^|\s)-(?=\d)/g,'$1negative')}`;
 const box=(g:T.Object3D,id:string,size:[number,number,number],p:[number,number,number],color:string,layer:string=layers.detail)=>
  k.named(k.box(g,id,size,p,color,layer),key(id));
 const rod=(g:T.Object3D,id:string,a:[number,number,number],b:[number,number,number],r=.018,color='#848d8d')=>
  k.named(k.rod(g,id,a,b,r,color,layers.detail),key(id));
 const utility=assembly('outdoor-kitchen');
 // Feb3 c6730 t96: intermediate utility shelf, IBC cage, bathtub and wash sinks.
 // Match the existing utility counter fit; individual stations are ± one metre.
 box(utility,'utility lower rack shelf',[1.05,.06,8.7],[0,.36,-1],'#bca17c',layers.floor);
 box(utility,'IBC white reservoir',[.94,1.0,.94],[0,1.69,-3.0],'#d0d5cc');
 box(utility,'IBC pallet',[1.08,.10,1.08],[0,1.14,-3.0],'#454e4e');
 for(const s of [-1,1])for(let i=0;i<5;i++) {
  const q=-.5+i*.25;
  rod(utility,`IBC x cage ${s} ${i}`,[q,1.15,-3+s*.53],[q,2.20,-3+s*.53]);
  rod(utility,`IBC z cage ${s} ${i}`,[s*.53,1.15,-3+q],[s*.53,2.20,-3+q]);
 }
 for(const y of [1.2,1.6,2.18])for(const s of [-1,1]) {
  rod(utility,`IBC cross x ${s} ${y}`,[-.53,y,-3+s*.53],[.53,y,-3+s*.53]);
  rod(utility,`IBC cross z ${s} ${y}`,[s*.53,y,-3-.53],[s*.53,y,-3+.53]);
 }
 // A fitted tarp folds over the top; no fake full opaque enclosure of its cage.
 box(utility,'IBC silver top tarp',[1.03,.045,1.03],[0,2.2125,-3],'#b4bdbe');
 for(const z of [.8,2.9]) {
  box(utility,`wash sink rim ${z}`,[.73,.055,.58],[0,1.12,z],'#b0baba');
  box(utility,`wash sink recess ${z}`,[.58,.025,.43],[0,1.155,z],'#4d5a5a');
  rod(utility,`wash tap ${z}`,[.29,1.13,z],[.29,1.4,z],.015);
  rod(utility,`wash spout ${z}`,[.29,1.4,z],[.1,1.4,z],.015);
 }
 const tub=utility.children.find(o=>o.name==='white bathtub') as T.Mesh|undefined;
 if(tub) {
  tub.position.y=1.355; // source t96: tub is ON the rack, not below it.
  const outline=new T.Shape();outline.absellipse(0,0,.36,.80,0,Math.PI*2,false,0);
  const hollow=new T.Path();hollow.absellipse(0,0,.29,.72,0,Math.PI*2,true,0);outline.holes.push(hollow);
  // New geometry only: never mutate Kit's cached original box geometry.
  const shell=new T.ExtrudeGeometry(outline,{depth:.53,steps:1,bevelEnabled:false,curveSegments:6});
  shell.rotateX(-Math.PI/2);shell.translate(0,-.265,0);tub.geometry=shell;
  tub.userData.source='c6730 Feb3 t96: open rounded white bathtub on utility rack; fitted oval outline/height, original owner ID retained';
  const bottomShape=new T.Shape();bottomShape.absellipse(0,0,.29,.72,0,Math.PI*2,false,0);
  const bottom=new T.Mesh(new T.ShapeGeometry(bottomShape,6),k.mat('#deded1'));
  bottom.rotation.x=-Math.PI/2;bottom.position.set(0,1.12,-6.1);
  k.named(k.tag(utility,bottom,'bathtub inner floor',layers.detail),'2021-bathtub-inner-floor');
 }
 box(utility,'bathtub support deck',[1.05,.065,1.72],[0,1.0575,-6.1],'#bca17c',layers.floor);
 for(const z of [-6.8,-5.4])rod(utility,`bathtub support leg ${z}`,[0,.10,z],[0,1.025,z],.035,'#344149');
 // Native painted container faces, independently visible at t104 and t128.
 const container=assembly('container');
 const flower=container.children.find(o=>o.name==='Mars flower front mural') as T.Mesh|undefined;
 if(flower) {
  flower.material=k.photo('/history/2021/2021-container-flower.webp');
  flower.userData.source='c6730 Feb3 dense257 t128: manually rectified full front painted flower, low resolution; no synthetic repaint';
 }
 const honey=k.named(k.box(container,'native honeycomb paint',[5.95,1.10,.018],[0,2.03,1.238],k.photo('/history/2021/2021-container-honeycomb.webp'),layers.detail),'2021-container-honeycomb');
 honey.userData.walkNoCollision=true;
 honey.userData.source='c6730 Feb3 dense209 t104: manually rectified upper long face; lower clutter excluded, opposite face unavailable';
 // The Mar9 library photo shows an unevenly populated shelf, two boards,
 // two ladder-back chairs and a foam reading bench edged in pink fabric.
 const lib=assembly('library');
 for(const o of lib.children.filter(o=>o.name==='table top'||o.name==='table leg')) {
  o.visible=false;o.userData.walkNoCollision=true;
  o.userData.sourceQuarantine='Mar9 library photo has a foam cube between chairs, not the first-pass generic reading table. Owner ID retained.';
 }
 const books=lib.children.filter(o=>o.name==='book');
 const shelves=lib.children.filter(o=>o.name==='book shelf');
 // Mar9: the bookcase hangs above chair-back height under the2.14m deck.
 // Keep original shelf/book IDs while correcting its earlier floor-bookcase fit.
 shelves.forEach((s,row)=>s.position.y=.95+row*.29);
 books.forEach((b,index)=>{
  const height=((b as T.Mesh).geometry as T.BoxGeometry).parameters.height;
  b.position.y=.95+Math.floor(index/11)*.29+.025+height/2;
 });
 for(let row=0;row<4;row++)for(let index=0;index<11;index++)if(index>=[11,9,8,6][row]) {
  const book=books[row*11+index];book.visible=false;book.userData.walkNoCollision=true;
  book.userData.sourceQuarantine='Mar9 library image: shelf right side mostly empty. Original ID retained; surplus first-pass uniform book fill excluded from rendered inventory.';
 }
 box(lib,'library mounted bookcase back',[2.8,1.24,.045],[0,1.48,-1.19],'#bca17c');
 for(let row=0;row<4;row++) {
  const y=.97+row*.29;
  box(lib,`library wood bookend base ${row}`,[.30,.035,.22],[.80,y,-1],'#c2a883');
  const end=box(lib,`library wood bookend slope ${row}`,[.045,.22,.22],[.85,y+.1,-1],'#c2a883');end.rotation.z=-.62;
 }
 box(lib,'library low plywood platform',[4.25,.065,3.1],[0,.0675,.1],'#bca17c',layers.floor);
 for(const x of [-1.75,1.75])for(const z of [-1.18,1.38]) {
  const foot=box(lib,`library low floor support ${x} ${z}`,[.075,.195,.075],[x,-.0625,z],'#344149',layers.steel);
  foot.userData.physicalSupportFit='Fitted short feet under observed raised plywood floor; hidden support details not recovered from source';
 }
 box(lib,'library chalkboard',[.72,1.15,.055],[-1.76,1.12,-.90],'#383d38');
 const board=box(lib,'library whiteboard',[1.15,1.16,.055],[-1.90,1.14,-.08],'#dbdcd0');board.rotation.y=Math.PI/2;
 box(lib,'library foam ottoman',[.66,.67,.64],[0,.44,.48],'#edece4');
 box(lib,'library red rug',[2.7,.012,2.0],[0,.115,.55],'#754747');
 for(const x of [-.88,.88]) {
  box(lib,`reading chair seat ${x}`,[.45,.05,.44],[x,.53,.20],'#444742');
  for(const s of [-1,1])for(const dz of [-.16,.16])rod(lib,`reading chair leg ${x} ${s} ${dz}`,[x+s*.17,.10,.2+dz],[x+s*.17,.51,.2+dz],.019,'#444742');
  for(const s of [-1,1])rod(lib,`reading chair back ${x} ${s}`,[x+s*.2,.53,-.02],[x+s*.2,1.04,-.02],.018,'#444742');
  for(const y of [.75,.88,1.0])box(lib,`reading chair slat ${x} ${y}`,[.40,.045,.025],[x,y,-.02],'#444742');
 }
 box(lib,'reading bench foam',[1.25,.18,.72],[1.25,.68,-.30],'#ebe6d6');
 box(lib,'reading bench pink trim',[1.25,.035,.12],[1.25,.79,0],'#d04289');
 box(lib,'reading bench plywood',[1.25,.05,.72],[1.25,.565,-.30],'#bca17c',layers.floor);
 for(const x of [.73,1.77])for(const z of [-.57,-.03])rod(lib,`reading bench support ${x} ${z}`,[x,.10,z],[x,.54,z],.025,'#344149');
 // Source shows this small modular foam/couch alcove in the front return,
 // corroborated at Feb3 t104. It occupies a wing, never the central corridor.
 const hall=assembly('chiba');
 box(hall,'front return white foam bench',[2.1,.22,.70],[4.7,1.28,8.7],'#e7e2d6');
 box(hall,'front return pink bedding',[.9,.055,.72],[4.2,1.42,8.7],'#be3989');
 // Solar supports resolve as timber triangles in t104/t112, not freestanding poles.
 const banks=hall.children.filter(o=>o instanceof T.Group&&o.children.some(c=>c.name==='solar panel'));
 banks.forEach((bank,i)=>{
  for(const x of [-1.7,1.7]) {
   rod(bank,`solar triangle foot ${i} ${x}`,[x,4.30,-.80],[x,4.30,.80],.04,'#b99761');
   rod(bank,`solar triangle slope ${i} ${x}`,[x,5.50,-.80],[x,4.30,.80],.04,'#b99761');
  }
 });
 // Keep January individually fitted centres. Distinguish the passenger-car
 // rooflines from the taller red/dark SUVs without inventing a make/model.
 for(const id of ['green-car','front-green-car']) {
  const car=assembly(id),cab=car.children.find(o=>o.name==='vehicle cab') as T.Mesh;
  cab.scale.y=.78;cab.scale.z=.89;cab.position.y=1.25;
  const glass=car.children.find(o=>o.name==='vehicle windscreen') as T.Mesh;
  glass.scale.y=.78;glass.position.y=1.28;glass.position.z=1.20;
  for(const side of [-1,1]) {
   const window=car.children.find(o=>o.name==='vehicle side window'&&Math.sign(o.position.x)===side) as T.Mesh;
   window.scale.y=.78;window.scale.z=.89;window.position.y=1.28;
  }
 }
 for(const id of ['olive-pickup','red-pickup','dark-suv','green-car','red-suv','orange-work-pickup','white-pickup','front-green-car']) {
  const car=assembly(id);
  for(const side of [-1,1]) {
   box(car,`vehicle mirror ${side}`,[.15,.12,.22],[side*1.03,1.28,.88],'#384647');
   box(car,`vehicle headlight ${side}`,[.32,.15,.025],[side*.57,.87,2.32],'#d6d9c6');
   box(car,`vehicle rear lamp ${side}`,[.20,.14,.025],[side*.69,.87,-2.32],'#943a38');
  }
  box(car,'vehicle front bumper',[1.8,.12,.08],[0,.46,2.34],'#4d5551');
 }
 const bus=assembly('school-bus');
 box(bus,'school bus rear glazing',[1.92,.68,.035],[0,2.01,-4.47],'#34494d');
 box(bus,'school bus rear bumper',[2.3,.16,.13],[0,.65,-4.54],'#313633');
 // Jan29 image2-488D4: two pastel couches across plywood work tables,
 // keyboard/monitor, sheer end curtain, exposed rack and trailer-side opening.
 const work=k.assembly('2021-cowork-nook','January29 pastel couch work nook',[-4.572,0,5.4],0,
  'image2-488D4 captured Jan29 11:32; room furniture observed, west wing bay placement fitted, not registered');
 for(const [side,color] of [[-1,'#da9d91'],[1,'#c0649c']] as const) {
  box(work,`cowork couch base ${side}`,[.78,.28,2.72],[side*1.15,.21,0],color);
  box(work,`cowork couch seat ${side}`,[.72,.18,2.60],[side*1.15,.44,0],side===1?'#536884':'#e6a596');
  box(work,`cowork couch back ${side}`,[.16,.64,2.72],[side*1.45,.72,0],side===1?'#536884':'#e6a596');
  for(const z of [-1.25,1.25])box(work,`cowork couch arm ${side} ${z}`,[.78,.30,.16],[side*1.15,.62,z],color);
  for(const dx of [-.25,.25])for(const z of [-1.08,1.08])box(work,`cowork couch foot ${side} ${dx} ${z}`,[.07,.23,.07],[side*1.15+dx,-.045,z],'#464942');
 }
 for(const z of [-.75,.75]) {
  box(work,`cowork plywood tabletop ${z}`,[1.05,.055,1.4],[0,.65,z],'#bda276');
  for(const dx of [-.42,.42])for(const dz of [-.59,.59])rod(work,`cowork table leg ${z} ${dx} ${dz}`,[dx,-.16,z+dz],[dx,.6225,z+dz],.022,'#5a5e53');
 }
 box(work,'cowork monitor bezel',[.74,.49,.05],[0,.955,-1.04],'#242b2c');
 box(work,'cowork monitor stand',[.07,.08,.07],[0,.72,-1.04],'#454f50');
 box(work,'cowork music keyboard',[.74,.035,.20],[.09,.696,-.55],'#3a4345');
 for(let i=0;i<12;i++)box(work,`cowork white key ${i}`,[.042,.009,.13],[-.22+i*.052,.718,-.54],'#d6d7cc');
 const curtain=box(work,'cowork pale end curtain',[2.9,1.93,.02],[0,.93,-1.48],'#e1ddcc',layers.wall);
 curtain.userData.walkNoCollision=true;
 // Source-specific library/seminar positions remain provisional: retain host
 // placement rather than rotate the whole hall from unverified compass metadata.
 for(const g of [lib,utility])g.userData.detailReconciliation='2021 occupied sources individually reviewed October1; exact longitudinal stations fitted';
}
