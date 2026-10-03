import * as T from 'three';
import {Kit,BAY,layers} from './kit';

/** Finished/occupied sources supplement the retained February roof-plane fit.
 * All dimensions and hidden room assignments remain explicitly photographic fits. */
export function reconcile2022Source(k:Kit){
 k.finalize();
 k.root.traverse(o=>{if(o.userData.component_id){const prefix=String(o.userData.assembly_id)+'-';o.userData.named_id=String(o.userData.component_id).slice(prefix.length);}});
 const find=(id:string)=>{let g:T.Object3D|undefined;k.root.traverse(o=>{if(o.userData.assembly_id===id&&!o.userData.layer)g??=o;});if(!g)throw Error(id);return g;};
 const rack=(id:string)=>find(id).children.find(o=>o.userData.layer===layers.steel&&o.type==='Group')!;
 const hide=(o:T.Object3D,why:string)=>{o.visible=false;o.userData.walkNoCollision=true;o.userData.source_quarantine=why;};
 const box=(g:T.Object3D,id:string,s:[number,number,number],p:[number,number,number],c:string,layer:string=layers.detail)=>k.named(k.box(g,`2022 ${id}`,s,p,c,layer),`2022-${id.replace(/(^| )-/g,'$1minus-')}`);
 const rod=(g:T.Object3D,id:string,a:[number,number,number],b:[number,number,number],r=.016,c='#454c47',layer:string=layers.detail)=>k.named(k.rod(g,`2022 ${id}`,a,b,r,c,layer),`2022-${id.replace(/(^| )-/g,'$1minus-')}`);
 const floor=.2525,depth=4.572;
 const table=(g:T.Object3D,id:string,x:number,z:number,w:number,d:number,top:number,base=floor,color='#d1d5c9')=>{
  box(g,`${id} top`,[w,.055,d],[x,top,z],color);
  for(const xx of [-1,1])for(const zz of [-1,1])box(g,`${id} leg ${xx} ${zz}`,[.03,top-.0275-base,.03],[x+xx*(w/2-.12),(base+top-.0275)/2,z+zz*(d/2-.1)],'#58615c');
 };
 const chair=(g:T.Object3D,id:string,x:number,z:number,base=floor)=>{
  box(g,`${id} seat`,[.45,.055,.44],[x,base+.46,z],'#3d4642');
  for(const xx of [-.18,.18])for(const zz of [-.17,.17])box(g,`${id} foot ${xx} ${zz}`,[.035,.4325,.035],[x+xx,base+.21625,z+zz],'#37443d');
  for(const xx of [-.20,.20])box(g,`${id} back stile ${xx}`,[.035,.57,.035],[x+xx,base+.72,z-.2],'#37443d');
  for(let j=0;j<3;j++)box(g,`${id} back rail ${j}`,[.40,.05,.035],[x,base+.66+j*.14,z-.2],'#37443d');
 };
 const canGeo=new T.CylinderGeometry(.07,.07,.17,10),potGeo=new T.CylinderGeometry(.19,.18,.28,12),jugGeo=new T.CylinderGeometry(.17,.17,.40,12);
 const cylinder=(g:T.Object3D,id:string,geo:T.BufferGeometry,p:[number,number,number],c:string)=>{const m=new T.Mesh(geo,k.mat(c));m.position.set(...p);k.named(k.tag(g,m,`2022 ${id}`,layers.detail),`2022-${id}`);return m;};
 const lights=(g:T.Object3D,id:string,base:number)=>{
  const bulb=new T.SphereGeometry(.045,6,4),bulbMaterial=new T.MeshStandardMaterial({color:'#ddd3a8',emissive:'#6f6238',emissiveIntensity:.18,roughness:.7});
  for(let row=0;row<2;row++)for(let j=0;j<9;j++){
   const x=-BAY+j*BAY/4,y=base-.12-.13*Math.sin(Math.PI*j/8),z=row?1.3:-1.3;
   if(j<8)rod(g,`${id} cable ${row} ${j}`,[x,y,z],[x+BAY/4,base-.12-.13*Math.sin(Math.PI*(j+1)/8),z],.006,'#353b34');
   const m=cylinder(g,`${id} bulb ${row} ${j}`,bulb,[x,y-.07,z],'#ddd3a8');m.material=bulbMaterial;
  }
 };
 // Cahuilla: source red mini fridge and triple commercial sink, not the generic
 // standing white appliance and three repeating pantry tiers.
 const kitchen=rack('east-house');
 const proxy=new Set(['white refrigerator','freezer door seam','fridge handle','stored food crate','pantry shelf','pantry jar','stainless sink rim','sink bowl','tap','tap spout','cooking pot','cup','table top','table leg']);
 for(const o of kitchen.children)if(proxy.has(o.name))hide(o,'c145 February2 and March9 c56223/24 finished Cahuilla kitchen inventory supersedes generic kitchen recipe');
 for(const o of kitchen.children)if(['three-basin stainless sink','sink basin','kitchen tap'].includes(o.name)){o.position.y+=.0425;o.position.z-=.05;}
 const sinkBody=kitchen.children.find(o=>o.name==='three-basin stainless sink') as T.Mesh;
 sinkBody.geometry=sinkBody.geometry.clone();sinkBody.geometry.scale(1,.23/.72,1);sinkBody.position.y=.8575;
 for(const o of kitchen.children)if(o.name==='blue water jug')hide(o,'source water dispenser bottle stands upright on furniture; tiny generic cuboids replaced');
 // March22 teardown supplies finished paint only, not the removed roof/PV.
 const paint=box(kitchen,'Cahuilla native contour strip',[1.5*BAY,1.05,.015],[.25*BAY,1.95,depth/2+.045],'#5996b8',layers.wall) as T.Mesh;
 paint.material=k.photo('/history/2022/reconciliation-cahuilla-contour-strip.webp');paint.userData.source='c33159 March22/23 native top contour/animal paint crop; panel moved during teardown. Artwork only, original occupied face retained, vertical/lateral strip registration fitted.';
 const detail=k.assembly('2022-cahuilla-kitchen-detail','Cahuilla · occupied cooking/water area');kitchen.add(detail);
 detail.userData.source='c145 February2 occupied kitchen, c55394/95 December31 infrastructure, c56223/24 March9 finished pantry. Relative fixtures and equipment observed; exact bay, coordinates and dimensions fitted.';
 for(const xx of [-1.52,.82])for(const zz of [-2.026,-1.546])box(detail,`commercial sink leg ${xx} ${zz}`,[.05,.49,.05],[xx,.4975,zz],'#a3aeab');
 table(detail,'central kitchen prep table',0,.18,1.0,1.95,1.05);
 table(detail,'red fridge worktop',-2.0,-.93,1.05,.74,1.15);
 box(detail,'Cahuilla red mini refrigerator',[.63,.79,.60],[-2.0,floor+.395,-.93],'#9c352f');
 box(detail,'red fridge handle',[.27,.025,.025],[-2.0,1.00,-.615],'#aeb4ae');
 table(detail,'pantry cream folding table',2.30,.65,.74,1.9,1.04);
 box(detail,'black yellow pantry tote',[.66,.47,.51],[2.05,floor+.235,.84],'#303833');
 box(detail,'pantry yellow lid',[.70,.045,.55],[2.05,floor+.4925,.84],'#bc9a37');
 // The March9 four wire baskets stand on the dividing plywood panel.
 box(detail,'pantry short partition',[1.48,.89,.045],[2.03,1.56,-.68],'#b49773',layers.wall);
 for(let row=0;row<2;row++)for(let col=0;col<2;col++){
  const x=1.65+col*.66,y=1.17+row*.43;
  box(detail,`pantry wire basket base ${row} ${col}`,[.53,.025,.21],[x,y,-.53],'#343a34');
  for(const xx of [-.25,.25])rod(detail,`pantry basket edge ${row} ${col} ${xx}`,[x+xx,y,-.64],[x+xx,y+.22,-.44],.009);
  for(let j=0;j<3;j++)box(detail,`basket food bag ${row} ${col} ${j}`,[.13,.14+(j%2)*.07,.11],[x-.16+j*.16,y+.10,-.53],['#c5b69a','#91a388','#a06d46'][j]);
 }
 box(detail,'sink high ingredient shelf',[2.9,.045,.27],[-.3,1.98,-depth/2+.18],'#a18864');
 for(let j=0;j<10;j++)cylinder(detail,`Cahuilla shelf tin ${j}`,canGeo,[-1.5+j*.26,2.0875,-depth/2+.2],['#a2986d','#6d8064','#9a6942'][j%3]);
 box(detail,'sink white paper notice',[.25,.26,.012],[.90,1.56,-depth/2+.04],'#d5d4bc');
 cylinder(detail,'stockpot',potGeo,[0,1.2175,.22],'#919e9d');
 cylinder(detail,'water dispenser bottle',jugGeo,[-2.03,1.7425,.86],'#7d9290');
 table(detail,'water dispenser stand',-2.03,.86,.5,.5,1.25);
 cylinder(detail,'water dispenser urn',potGeo,[-2.03,1.4025,.86],'#a2acab');
 cylinder(detail,'coffee tin',canGeo,[2.05,1.1525,.64],'#a09152');
 box(detail,'portable cooker black base',[.34,.07,.34],[2.05,1.105,-.15],'#303735');
 cylinder(detail,'electric kettle',new T.CylinderGeometry(.13,.12,.27,12),[2.05,1.275,-.15],'#a4b4b3');
 lights(detail,'Cahuilla occupied string',2.36);
 // Ba Sing Se: occupied study inventory is visually established, while precise
 // library-to-wing registration remains fitted; no screenshots with fake content.
 const classroom=rack('chiba');
 for(const o of classroom.children)if(['classroom bench','bench foot','table top','table leg','screen bezel','display content'].includes(o.name))hide(o,'c487 occupied study room has ladder chairs/books and presentation wall rather than generic benches/portal screenshot');
 const study=k.assembly('2022-bss-study-detail','Ba Sing Se · fitted occupied study/library room');classroom.add(study);
 study.userData.source='c487 January24 occupied Mars library; building and eastern bay assignment fitted inside retained Ba Sing Se role, not proven by filename. c63403 upper table/red swags remain source-bound independently.';
 box(study,'study yellow board',[1.35,1.08,.025],[-BAY,1.62,-depth/2+.07],'#b99e57',layers.wall);
 box(study,'study projection plane',[1.7,1.28,.026],[BAY-.2,1.72,-depth/2+.07],'#d4d6cb',layers.wall);
 table(study,'study presentation table',BAY-.2,-1.03,1.5,.55,1.0);
 for(let j=0;j<5;j++)box(study,`study bookshelf level ${j}`,[1.86,.045,.28],[0,floor+.25+j*.34,-depth/2+.18],'#aa906a');
 for(const xx of [-.95,.95])box(study,`bookshelf upright ${xx}`,[.055,1.86,.28],[xx,floor+.93,-depth/2+.18],'#aa906a');
 for(let row=0;row<4;row++)for(let j=0;j<13;j++)box(study,`book ${row} ${j}`,[.105,.20+(j%3)*.027,.19],[-.82+j*.135,floor+.38+row*.34,-depth/2+.18],['#5c6e66','#b6a48a','#836a55','#8c936b','#455457'][j%5]);
 for(let row=0;row<2;row++)for(let col=0;col<4;col++)chair(study,`study chair ${row} ${col}`,-2.4+col*1.25,-.20+row*1.22);
 lights(study,'BSS study string',2.36);
 // Source upper BSS table legs: frozen Kit's .1 base floated above this deck.
 const upper=find('ba-sing-se-upper-room');for(const o of upper.children)if(o.name==='table leg'&&o instanceof T.Mesh){o.geometry=o.geometry.clone();o.geometry.scale(1,(.64+.0675)/.64,1);o.position.y-=.03375;}
 chair(upper,'BSS upper dark chair',-1.20,.45,.0325);
 lights(upper,'BSS upper occupied string',2.22);
 for(const o of classroom.children)if(o.name==='Ba Sing Se red ceiling fabric')hide(o,'c63403 wide red cloth replaces cylindrical rope proxy; original source owners retained');
 const clothMaterial=new T.MeshStandardMaterial({color:'#a33e37',roughness:1,side:T.DoubleSide});
 for(let row=0;row<2;row++){const pos:number[]=[],ix:number[]=[];for(let j=0;j<=12;j++){const z=-depth/2+j*depth/12,y=4.70-.62*Math.sin(Math.PI*j/12),x=row*BAY;pos.push(x-.14,y,z,x+.14,y-.08*Math.sin(Math.PI*j/12),z);if(j<12){const b=j*2;ix.push(b,b+1,b+2,b+1,b+3,b+2);}}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setIndex(ix);geo.computeVertexNormals();k.named(k.tag(classroom,new T.Mesh(geo,clothMaterial),'2022 BSS red cloth ribbon',layers.detail),`2022-bss-cloth-ribbon-${row}`);}
 // Huaqiangbei: pale projection facade is preserved; upper room equipped from
 // c477/c63123 occupied event photographs, with geometry rather than light grids.
 const hqb=rack('west-house'),dj=k.assembly('2022-hqb-upper-detail','Huaqiangbei · upper DJ/presentation bay',[0,2.46,0]);hqb.add(dj);
 for(const o of hqb.children)if(o.name==='DJ shelf support'&&o instanceof T.Mesh){o.geometry=o.geometry.clone();o.geometry.scale(1,.6675/.68,1);o.position.y=2.82625;}
 dj.userData.source='c477 February19 fire-event facade and c63123 January16 Thunder Talks upper opening: table, chairs and string bulbs. Coordinates/dimensions fitted; projected color is temporary and omitted from permanent walls.';
 box(dj,'upper DJ mixer',[.77,.11,.38],[0,.835,depth/2-.62],'#303934');
 for(let j=0;j<5;j++)box(dj,`mixer fader ${j}`,[.027,.015,.07],[-.24+j*.12,.898,depth/2-.57],'#abae9e');
 chair(dj,'HQB upper chair left',-1.1,.4,.0325);chair(dj,'HQB upper chair right',1.15,.4,.0325);
 lights(dj,'HQB upper event string',2.22);
 // Chatsubo's occupied bar has foil front, a single shelf and an open roof.
 const chatsubo=rack('kitchen'),bar=k.assembly('2022-chatsubo-occupied-detail','Chatsubo · occupied bar');chatsubo.add(bar);
 for(const o of chatsubo.children)if(o instanceof T.Mesh){
  if(o.name==='bar counter support'){o.geometry=o.geometry.clone();o.geometry.scale(1,.6675/.82,1);o.position.y=.58625;}
  if(o.name==='Chatsubo reflective bar front'){o.geometry=o.geometry.clone();o.geometry.scale(1,.6625/.69,1);o.position.y=.58375;}
 }
 bar.userData.source='c55445 February8 occupied bar; c395 night event. One high roof bay and open lower roof are retained from February c273; exact intermediate terrace rises remain unresolved rather than guessed.';
 box(bar,'Chatsubo rear ingredient shelf',[2.85,.045,.31],[-.3,1.77,-depth/2+.18],'#a58a64');
 for(let j=0;j<12;j++)cylinder(bar,`Chatsubo bottle tin ${j}`,canGeo,[-1.55+j*.23,1.88,-depth/2+.18],['#7a7660','#b5b29d','#855f47'][j%3]);
 box(bar,'bar clear water jug',[.24,.37,.24],[-1.25,1.185,.8],'#9dab9e');
 box(bar,'bar red plastic cup',[.11,.14,.11],[.72,1.07,.8],'#a14642');
 box(bar,'bar blender',[.18,.24,.18],[.15,1.12,.8],'#bfc5b9');
 lights(bar,'Chatsubo string',2.36);
 add2022Fleet(k,box,rod,find,hide);
 add2022SmallForms(k,box,rod);
}

type Box=(g:T.Object3D,id:string,s:[number,number,number],p:[number,number,number],c:string,layer?:string)=>T.Object3D;
type Rod=(g:T.Object3D,id:string,a:[number,number,number],b:[number,number,number],r?:number,c?:string,layer?:string)=>T.Object3D;
function add2022Fleet(k:Kit,box:Box,rod:Rod,find:(id:string)=>T.Object3D,hide:(o:T.Object3D,why:string)=>void){
 const pickups=new Set([1,3,6,14]),vans=new Set([2,7]),roofracks=new Set([5,8]),roadTire=new T.CylinderGeometry(.34,.34,.19,12);
 for(let n=1;n<=14;n++){
  const g=find(`car-${n}`),body=g.children.find(o=>o.name==='vehicle body') as T.Mesh<T.BoxGeometry>,cab=g.children.find(o=>o.name==='vehicle roof') as T.Mesh;
  const glass=g.children.find(o=>o.name==='vehicle windscreen')!;
  for(const wheel of g.children)if(wheel.name==='car road wheel'&&wheel instanceof T.Mesh)wheel.geometry=roadTire;
  g.name=pickups.has(n)?`2022 photographed pickup ${n}`:vans.has(n)?`2022 photographed long van ${n}`:`2022 photographed car/SUV ${n}`;
  g.userData.source='c273 February14-posted native control-point crop; individual position/heading preserved from roof-plane fit. Vehicle class/color observed; precise models/hidden sides/dimensions fitted.';
  if(pickups.has(n)){
   hide(body,'native c273 pickup has an open/loaded bed, not a full-height sedan shell');
   cab.geometry=cab.geometry.clone();cab.geometry.scale(1,1,.64);cab.position.z=.64;glass.position.z=1.23;
   box(g,`pickup ${n} chassis`,[1.90,.46,4.6],[0,.515,0],n===1?'#a34735':n===3?'#aa542e':n===6?'#92714c':'#293b36',layers.context);
   box(g,`pickup ${n} dark bed`,[1.55,.05,1.95],[0,.78,-1.22],'#3b4440',layers.context);
   for(const side of [-1,1])box(g,`pickup ${n} bed rail ${side}`,[.12,.32,1.97],[side*.88,.94,-1.22],n===1?'#a34735':n===3?'#aa542e':n===6?'#92714c':'#293b36',layers.context);
   box(g,`pickup ${n} tailgate`,[1.9,.31,.12],[0,.93,-2.25],n===1?'#a34735':n===3?'#aa542e':n===6?'#92714c':'#293b36',layers.context);
  }else if(vans.has(n)){
   body.geometry=body.geometry.clone();body.geometry.scale(1,1.24,1.13);
   cab.geometry=cab.geometry.clone();cab.geometry.scale(1,1.42,1.58);cab.position.y=1.68;
   glass.position.set(0,1.69,1.64);glass.rotation.x=-.25;
   for(const o of g.children)if(o.name==='car side glazing'&&o instanceof T.Mesh){o.geometry=o.geometry.clone();o.geometry.scale(1,1.4,1.5);o.position.y=1.68;}
  }
  for(const side of [-1,1]){
   rod(g,`vehicle ${n} mirror arm ${side}`,[side*.82,1.53,pickups.has(n)?1.23:.8],[side*1.15,1.53,pickups.has(n)?1.23:.8],.016,'#4b5550',layers.context);
   box(g,`vehicle ${n} mirror ${side}`,[.16,.20,.25],[side*1.19,1.56,pickups.has(n)?1.23:.8],'#4f5b57',layers.context);
   box(g,`vehicle ${n} rear lamp ${side}`,[.24,.16,.035],[side*.64,.82,-2.327],'#923e36',layers.context);
   if(roofracks.has(n))rod(g,`vehicle ${n} roof rail ${side}`,[side*.67,1.96,-1.1],[side*.67,1.96,.72],.018,'#737e79',layers.context);
  }
  if(roofracks.has(n))for(const z of [-.9,.45])rod(g,`vehicle ${n} roof crossrail ${z}`,[-.67,1.96,z],[.67,1.96,z],.016,'#737e79',layers.context);
 }
 for(const n of [1,2,3,4,5,6,8]){
  const rv=find(`rv-${n}`);rv.position.y=-.16;rv.userData.source+='; native c273 individual trailer silhouette; current replica wheels grounded on Studio soil, original frozen construction/takes retained separately byroot';
  for(const zz of [-2.0,1.6])box(rv,`RV ${n} roof vent ${zz}`,[.32,.065,.38],[0,2.8575,zz],'#7b8680',layers.context);
  if(n===2)box(rv,'RV2 second roof air conditioner',[.75,.23,.85],[0,2.94,-1.6],'#bfc6b9',layers.context);
  box(rv,`RV ${n} entry glazing`,[.018,.50,.45],[1.227,1.99,-[0,8.2,7.8,7.5,7.5,6.8,8.1,0,7.8][n]*.27],'#435752',layers.context);
 }
 const slide=find('rv-6');box(slide,'RV6 photographed side projection',[.52,1.46,3.1],[-1.40,1.61,0],'#c5cebd',layers.context);box(slide,'RV6 slideout dark glazing',[.02,.53,1.65],[-1.671,1.90,0],'#3b514d',layers.context);
 const pickup6=find('car-6');for(const z of [-1.7,-.82])box(pickup6,`tan pickup bed panel ${z}`,[1.28,.055,.72],[0,1.13,z],'#405953',layers.context);
 const artPickup=find('car-3');box(artPickup,'orange pickup pale hood paint',[1.50,.014,.61],[0,.752,1.85],'#c6b667',layers.context);
 // c55948 February20 directly identifies the IBC carried by orange/red pickup;
 // c273 car1's pale bed load is consistent, but the exact nadir object is uncertain.
 const water=find('car-1');water.userData.source+='; c55948/55980 February20/10 orange pickup carries IBC; c273 pale bed load identification probable, not certain';
 box(water,'pickup IBC tank',[1.02,1.06,.98],[0,1.335,-1.22],'#d4d7c4',layers.context);
 for(const side of [-1,1]){
  for(const v of [-.46,0,.46])rod(water,`IBC cage vertical ${side} ${v}`,[side*.54,.80,-1.22+v],[side*.54,1.90,-1.22+v],.015,'#7c8680',layers.context);
  for(const y of [.83,1.34,1.87])rod(water,`IBC cage cross ${side} ${y}`,[side*.54,y,-1.74],[side*.54,y,-.70],.015,'#7c8680',layers.context);
 }
 box(water,'IBC blue outlet',[.10,.10,.12],[0,.9,-1.79],'#536d82',layers.context);
 box(water,'IBC black cap',[.18,.025,.18],[0,1.878,-1.22],'#454e43',layers.context);
 // Actual Studio soil is−.16; retained freestanding context must meet it.
 const canopy=find('rear-canopy');for(const o of canopy.children)if(o.name==='shade post'&&o instanceof T.Mesh){o.geometry=o.geometry.clone();o.geometry.scale(1,2.96/2.8,1);o.position.y=1.32;}
 const silver=find('silver-shelter'),shell=silver.children.find(o=>o.name==='silver shelter shell') as T.Mesh;
 shell.geometry=shell.geometry.clone();shell.geometry.scale(1,2.71/2.5,1);shell.position.y=1.195;
 silver.userData.source+='; coarse fitted shell seated on soil while underlying vehicle/shelter type remains unresolved';
 const bus=find('yellow-bus');for(const side of [-1,1]){
  rod(bus,`school bus mirror arm ${side}`,[side*1.2,2.1,4.4],[side*1.60,2.1,4.7],.018,'#414b42',layers.context);
  box(bus,`school bus mirror ${side}`,[.17,.34,.25],[side*1.63,2.13,4.7],'#485349',layers.context);
 }
 // Separate golden/dark work vehicle between rv1/rv6 is not one of the14 picks.
 const tilt=10*Math.PI/180,scale=8.3/(26.1*.3),x=-15.1,z=-14.5;
 const work=k.assembly('2022-additional-work-vehicle','Golden/dark work vehicle · exact type uncertain',[scale*(Math.cos(tilt)*x-Math.sin(tilt)*z),0,scale*(Math.sin(tilt)*x+Math.cos(tilt)*z)],-.10-tilt);
 work.userData.source='c273 native crop between rv1 andrv6: golden/dark long vehicle, pale rectangular rear load. Separate omitted footprint. Dimensions/type/white load identity fitted; no manufacturer or service-box-truck identity asserted.';
 box(work,'gold work chassis',[2.13,.62,6.0],[0,.53,0],'#9c803f',layers.context);
 box(work,'gold work cab',[1.95,1.20,1.7],[0,1.30,1.56],'#585d46',layers.context);
 box(work,'work front glazing',[1.73,.49,.03],[0,1.59,2.43],'#405653',layers.context);
 box(work,'work rear dark deck',[1.96,.10,3.0],[0,.89,-1.26],'#353b34',layers.context);
 box(work,'work pale rear load',[1.35,.12,1.55],[0,1.02,-1.53],'#c3c9ae',layers.context);
 const geo=new T.CylinderGeometry(.37,.37,.20,12);
 for(const side of [-1,1])for(const zz of [-1.9,1.9]){const m=new T.Mesh(geo,k.mat('#29302a'));m.rotation.z=Math.PI/2;m.position.set(side*1.02,.21,zz);k.named(k.tag(work,m,'2022 work vehicle wheel',layers.context),`2022-work-wheel-${side<0?'left':'right'}-${zz<0?'rear':'front'}`);}
}
function add2022SmallForms(k:Kit,_box:Box,rod:Rod){
 // c273 shows two bare timber geometric frames south of Chatsubo, not opaque
 // shelter bodies. Their nominal centers/radii are fitted to the same image plane.
 const tilt=10*Math.PI/180,scale=8.3/(26.1*.3),x=-1.8,z=16.7;
 const forms=k.assembly('2022-timber-geometric-forms','Two timber geometric frames beside Chatsubo',[scale*(Math.cos(tilt)*x-Math.sin(tilt)*z),-.16,scale*(Math.sin(tilt)*x+Math.cos(tilt)*z)],-tilt);
 forms.userData.source='c273 native Chatsubo crop: square pyramidal frame and many-sided timber geometric frame. Form observed; exact identity/radii/centers are fitted, not an invented IBC sculpture.';
 const corners:[number,number,number][]=[[-1.4,.02,-1.4],[1.4,.02,-1.4],[1.4,.02,1.4],[-1.4,.02,1.4]];
 for(let i=0;i<4;i++){rod(forms,`pyramid base ${i}`,corners[i],corners[(i+1)%4],.022,'#b89960',layers.context);rod(forms,`pyramid rib ${i}`,corners[i],[0,1.9,0],.022,'#b89960',layers.context);}
 for(let i=0;i<8;i++){
  const a=i*Math.PI/4,b=(i+1)*Math.PI/4,p:[number,number,number]=[4.0+1.60*Math.cos(a),.02,1.60*Math.sin(a)],q:[number,number,number]=[4.0+1.60*Math.cos(b),.02,1.60*Math.sin(b)],top:[number,number,number]=[4.0+.75*Math.cos(a+.2),1.5,.75*Math.sin(a+.2)];
  rod(forms,`manysided base ${i}`,p,q,.022,'#b89960',layers.context);rod(forms,`manysided rib ${i}`,p,top,.022,'#b89960',layers.context);rod(forms,`manysided diagonal ${i}`,q,top,.022,'#b89960',layers.context);
  rod(forms,`manysided upper ${i}`,top,[4.0+.75*Math.cos(b+.2),1.5,.75*Math.sin(b+.2)],.022,'#b89960',layers.context);
 }

}
