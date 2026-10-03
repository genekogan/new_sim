import * as T from 'three';
import {Kit,layers} from './kit';
import busCadIds from './og-bus-cad-ids.json';
import {GROUND} from '../studio/ambience-math';

/** Clip each triangle against the Studio sand datum, retaining interpolated vertex data.
 * Above-grade vertices are not moved. The new cut lies on the ground plane;
 * its underside needs no visible cap. Shared CAD geometry remains untouched. */
export function trimOGSolarAtGrade(root:T.Group){
 root.updateMatrixWorld(true);
 const ids=new Set(Array.from({length:14},(_,i)=>`wood_component-${String(i+732).padStart(4,'0')}`));
 const candidates:T.Mesh[]=[];root.traverse(o=>{if(o instanceof T.Mesh&&ids.has(o.userData.component_id??o.parent?.userData.component_id))candidates.push(o);});
 for(const o of candidates){
  if(o.userData.og_grade_trim)continue;
  const original=o.geometry as T.BufferGeometry,src=original.index?original.toNonIndexed():original.clone();
  const attrs=Object.entries(src.attributes),out:Record<string,number[]>={};for(const [name] of attrs)out[name]=[];
  const g=new T.BufferGeometry(),pos=src.getAttribute('position'),world=new T.Vector3();let written=0;
  type V={d:number;values:Record<string,number[]>};
  const read=(i:number):V=>{const values:Record<string,number[]>={};for(const [name,a] of attrs){values[name]=[];for(let k=0;k<a.itemSize;k++)values[name].push(a.getComponent(i,k));}world.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);return {d:world.y-GROUND,values};};
  const mix=(a:V,b:V):V=>{const t=a.d/(a.d-b.d),values:Record<string,number[]>={};for(const [name] of attrs)values[name]=a.values[name].map((v,k)=>v+(b.values[name][k]-v)*t);return {d:0,values};};
  for(let i=0;i<pos.count;i+=3){
   const tri=[read(i),read(i+1),read(i+2)],poly:V[]=[];
   for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3];if(a.d>=0)poly.push(a);if((a.d>=0)!==(b.d>=0))poly.push(mix(a,b));}
   const start=written;
   for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]]){for(const [name] of attrs)out[name].push(...v.values[name]);written++;}
   const material=src.groups.find(group=>i>=group.start&&i<group.start+group.count)?.materialIndex??0;
   if(written>start){const last=g.groups[g.groups.length-1];if(last&&last.materialIndex===material&&last.start+last.count===start)last.count+=written-start;else g.addGroup(start,written-start,material);}
  }
  for(const [name,a] of attrs)g.setAttribute(name,new T.Float32BufferAttribute(out[name],a.itemSize));
  g.computeBoundingBox();g.computeBoundingSphere();o.geometry=g;src.dispose();
  o.userData.og_grade_trim='c48035/c49110 and DJI0002 t396: inclined solar timbers end at soil; clipped CAD below-grade extension at Studio sand−0.16m, above-ground geometry retained';
 }
}

/** c49347 / DSCF2552: a cabin cruiser on a tandem trailer beside occupied OG.
 * CAD placement/heading and hull length retained; small dimensions are photo fits.
 * This augments existing boat nodes instead of exchanging them for a generic RV.
 */
export function add2026OGVehicles(root:T.Group){
 if(root.getObjectByName('OG · boat source details'))return [];
 trimOGSolarAtGrade(root);
 const k=new Kit(2026);
 // c49110 fixes the identity/location of the bus beside OG. Keep the detailed
 // CAD parts and IDs, but fit the visibly shorter Collins-style hood jointly in
 // bus coordinates, avoiding independent per-part scaling or disconnected lamps.
 // This is a silhouette fit, not a manufacturer-exact new vehicle model.
 const busParts=busCadIds.map(id=>root.getObjectByName(id)).filter((o):o is T.Object3D=>!!o);
 if(busParts.length){
  root.updateMatrixWorld(true);
  const bus=new T.Group();bus.name='OG · source-fitted short bus';bus.position.set(-84.834,0,-3.657);bus.rotation.y=2.416943;
  bus.userData.source='c49110 DSCF1353: Collins short bus adjacent OG. CAD Thomas donor retained; .70 hood projection and1.22 height fit provisional, no surveyed dimensions.';
  root.add(bus);bus.updateMatrixWorld(true);
  for(const o of busParts)bus.attach(o);
  bus.updateMatrixWorld(true);
  const inv=new T.Matrix4().copy(bus.matrixWorld).invert(),p=new T.Vector3();
  bus.traverse(o=>{
   if(!(o instanceof T.Mesh))return;
   const m=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld),back=m.clone().invert();
   const g=o.geometry.clone(),a=g.getAttribute('position');
   for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(m);if(p.x>1)p.x=1+(p.x-1)*.70;p.applyMatrix4(back);a.setXYZ(i,p.x,p.y,p.z);}
   a.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();o.geometry=g;
   o.userData.photographic_adjustment='Joint OG Collins silhouette fit; original component identity retained';
  });
  bus.scale.y=1.22;
  root.updateMatrixWorld(true);
  bus.position.y+=GROUND-new T.Box3().setFromObject(bus).min.y;
  bus.userData.groundContact='Whole source-fitted bus settled to Studio sand after joint silhouette correction; original parts stay together';
 }

 const boat=k.assembly('og-boat-details','OG · boat source details',[-83.1,0,-16.6],-.51,
  'c49347 DSCF2552-6BD18.jpg; DJI_0002 t396.00. Existing CAD hull footprint retained; trailer/flybridge dimensions photographic estimates.');
 // The archived yacht already supplies the hull, lower cabin, bow rails and stern
 // ladder. Keep all ten original nodes and IDs; raise as one rigid body to seat on
 // the newly represented road trailer rather than leave its keel at tyre height.
 const oldIds=['transparent_panel-0070','cad_component-2235','cad_component-2236','cad_component-2237','cad_component-2238','cad_component-2239','cad_component-2240','wood_component-1782','wood_component-1783','wood_component-1784'];
 for(const id of oldIds){const o=root.getObjectByName(id);if(o){o.position.y+=.24;o.userData.photographic_adjustment='c49347: cruiser seated on tandem road trailer; CAD hull plan retained';}}
 const metal='#939c9e',white='#deded2',dark='#24343a';
 // Two trailer axles; wheels are real vertical cylinders, not floating discs.
 for(const x of [-.9,-.05]){
  k.rod(boat,'trailer axle',[x,.32,-1.01],[x,.32,1.01],.06,metal,layers.context);
  for(const z of [-1.06,1.06]){
   const tyre=new T.Mesh(new T.CylinderGeometry(.33,.33,.20,20),k.mat('#262827'));
   tyre.rotation.x=Math.PI/2;tyre.position.set(x,.33,z);k.tag(boat,tyre,'tandem trailer tyre',layers.context);
   const hub=new T.Mesh(new T.CylinderGeometry(.16,.16,.205,12),k.mat('#5f6665',.6));hub.rotation.x=Math.PI/2;hub.position.copy(tyre.position);k.tag(boat,hub,'trailer wheel hub',layers.context);
  }
 }
 for(const z of [-.8,.8])k.box(boat,'trailer longitudinal frame',[6.4,.12,.12],[0,.43,z],metal,layers.context);
 for(const x of [-2.4,-1.3,0,1.3,2.4])k.box(boat,'trailer cross member',[.1,.1,1.7],[x,.43,0],metal,layers.context);
 for(const z of [-.8,.8])k.rod(boat,'trailer drawbar',[2.6,.43,z],[4.1,.43,0],.055,metal,layers.context);
 k.box(boat,'trailer coupling',[.3,.13,.13],[4.15,.43,0],metal,layers.context);
 k.rod(boat,'bow winch post',[2.9,.43,0],[2.55,1.25,0],.07,metal,layers.context);
 // Photo shows a conspicuous raised flybridge above the pilothouse. The old
 // small yacht's existing lower windscreen and cabin remain separately editable.
 k.box(boat,'flybridge sole',[1.9,.09,1.75],[-.65,2.77,0],white,layers.context);
 for(const z of [-.85,.85]){
  k.box(boat,'flybridge side coaming',[1.55,.43,.065],[-.5,3.02,z],white,layers.context);
  k.box(boat,'flybridge brown side stripe',[1.3,.07,.015],[-.5,2.91,z+Math.sign(z)*.04],'#786758',layers.context);
  k.box(boat,'flybridge dark side slit',[.48,.055,.018],[-.12,3.1,z+Math.sign(z)*.04],dark,layers.context);
 }
 k.box(boat,'flybridge forward coaming',[.07,.44,1.72],[.3,3.02,0],white,layers.context);
 for(const z of [-.8,.8]){
  k.rod(boat,'flybridge handrail',[-1.6,3.49,z],[.45,3.49,z],.018,metal,layers.context);
  for(const x of [-1.5,.3])k.rod(boat,'flybridge rail upright',[x,3.19,z],[x,3.49,z],.014,metal,layers.context);
 }
 k.rod(boat,'flybridge front rail',[.45,3.49,-.8],[.45,3.49,.8],.018,metal,layers.context);
 // Stern ladder visible up the near pilothouse wall, independent of CAD's lower
 // swim ladder. Its thin open rungs preserve the silhouette of the source.
 for(const z of [-.77,-.28])k.rod(boat,'flybridge ladder stringer',[-1.65,1.9,z],[-1.35,3.39,z],.025,metal,layers.context);
 for(let i=0;i<6;i++){const t=i/5;k.rod(boat,'flybridge ladder rung',[-1.65+.3*t,1.9+1.49*t,-.77],[-1.65+.3*t,1.9+1.49*t,-.28],.018,metal,layers.context);}
 k.rod(boat,'boat antenna',[-.4,3.3,.5],[-.55,4.4,.5],.007,'#b8bcba',layers.context);
 // Ground photo c49346 independently shows this distinctive mobile griddle at
 // the OG clubhouse. Position is a provisional fit at the open front edge, not
 // an inferred shower/room layout from the December proposed plan.
 const og=k.assembly('og-ground-details','OG · breakfast griddle',[-110.91,0,.04],-.65,
  'c49346 DSCF2550-F0B26.jpg; occupied OG identified by c49347 boat and DJI_0002 t396. Placement along clubhouse frontage provisional.');
 const gx=1.8,gz=-4.4;
 k.box(og,'griddle cooktop',[1.05,.06,.57],[gx,.92,gz],'#343a39',layers.detail);
 k.box(og,'griddle front fascia',[1.05,.19,.05],[gx,.81,gz-.29],'#404648',layers.detail);
 for(const x of [-.44,.44])for(const z of [-.21,.21]){
  k.rod(og,'griddle cart leg',[gx+x,.12,gz+z],[gx+x,.89,gz+z],.025,'#343a39',layers.detail);
  const wheel=new T.Mesh(new T.CylinderGeometry(.07,.07,.035,10),k.mat('#242625'));wheel.rotation.x=Math.PI/2;wheel.position.set(gx+x,.07,gz+z);k.tag(og,wheel,'griddle caster',layers.detail);
 }
 const whiteTank=new T.Mesh(new T.CylinderGeometry(.15,.15,.39,12),k.mat('#d6d9cc'));whiteTank.position.set(gx,.445,gz);k.tag(og,whiteTank,'OG griddle source white propane tank',layers.detail);
 const tankShoulder=new T.Mesh(new T.SphereGeometry(.15,12,6,0,Math.PI*2,0,Math.PI/2),k.mat('#e0e1d5'));tankShoulder.position.set(gx,.64,gz);k.tag(og,tankShoulder,'OG propane tank rounded shoulder',layers.detail);
 k.box(og,'OG propane tank valve collar',[.15,.055,.12],[gx,.795,gz],'#d6d9cc',layers.detail);
 for(let i=0;i<8;i++)k.rod(og,'griddle lower shelf wire',[gx-.45+i*.13,.25,gz-.22],[gx-.45+i*.13,.25,gz+.22],.008,'#626966',layers.detail);
 for(const x of [-.32,0,.32]){const knob=new T.Mesh(new T.CylinderGeometry(.033,.033,.035,12),k.mat('#181e20'));knob.rotation.x=Math.PI/2;knob.position.set(gx+x,.82,gz-.33);k.tag(og,knob,'griddle control knob',layers.detail);}
 // Occupied clubhouse c49345: two mismatched open household doors with a
 // central timber post. Frontage registration is provisional; opening geometry
 // is real, with no invisible full wall or sill obstructing entry.
 const club=k.assembly('og-clubhouse-details','OG · occupied clubhouse',[-110.91,0,.04],-.65,
  'c49345 DSCF2535-D41D8.jpg: twin open white doors, timber centre post, blue wall, dark seating and low blue table. Room registration within CAD square is provisional.');
 for(const x of [.425,3.275])k.box(club,'clubhouse entry side panel',[.85,2.96,.055],[x,1.48,-3.65],'#a88d64',layers.wall);
 k.box(club,'clubhouse entry header',[2,.7,.055],[1.85,2.61,-3.65],'#a88d64',layers.wall);
 k.box(club,'clubhouse door central timber post',[.07,2.24,.09],[1.85,1.12,-3.65],'#d0ad79',layers.wall);
 for(const [x,sign] of [[.85,-1],[2.85,1]]){
  const hinge=new T.Group();hinge.position.set(x,0,-3.65);hinge.rotation.y=sign*Math.PI/2;club.add(hinge);
  const leaf=k.box(club,'clubhouse open white door',[.92,2.16,.04],[0,0,0],'#d9d7c8',layers.wall);hinge.add(leaf);leaf.position.set(-sign*.46,1.08,0);
  for(const y of [.5,1.46]){const panel=k.box(club,'clubhouse recessed door panel',[.68,.66,.012],[0,0,0],'#c6c3b7',layers.detail);hinge.add(panel);panel.position.set(-sign*.46,y,-.027);}
 }
 k.box(club,'clubhouse blue inner wall',[.035,2.8,5.6],[3.58,1.4,-.2],'#28627a',layers.wall);
 // Two independently visible dark seats; avoid fabricating a complete seating
 // inventory behind the people and door leaves in this photograph.
 for(const [x,z,angle] of [[2.93,-1.5,-Math.PI/2],[1.8,2.7,0]]){
  const seat=new T.Group();seat.position.set(x,0,z);seat.rotation.y=angle;club.add(seat);
  for(const [name,size,pos] of [['clubhouse sofa seat',[1.6,.28,.65],[0,.4,0]],['clubhouse sofa back',[1.6,.64,.19],[0,.69,.35]],['clubhouse sofa arm',[.15,.43,.72],[-.76,.53,0]],['clubhouse sofa arm',[.15,.43,.72],[.76,.53,0]]]){
   const mesh=k.box(club,name as string,size as [number,number,number],[0,0,0],'#282d2b',layers.detail);seat.add(mesh);mesh.position.set(...pos as [number,number,number]);
  }
 }
 k.box(club,'clubhouse low blue table top',[1.25,.04,.66],[2.27,.61,-1.58],'#235a7b',layers.detail);
 for(const x of [1.8,2.74])k.box(club,'clubhouse blue table slab leg',[.11,.58,.52],[x,.3,-1.58],'#235a7b',layers.detail);
 k.box(club,'clubhouse whiteboard',[.02,.64,.86],[3.55,1.48,.4],'#d2d0bd',layers.detail);
 const kitchen=k.assembly('og-kitchen-details','OG · kitchen source fixtures',[-110.91,0,.04],-.65,
  'c72591 OG solar kitchen counter and c48047 IMG_4858: sink, blue water cooler, closed green camp stove, hanging pans. Provisional placement in opposite clubhouse bay; no claim of complete room survey.');
 for(const [width,x] of [[.11,-3.195],[2.11,-1.505]])k.box(kitchen,'OG kitchen worktop',[width,.05,.67],[x,.91,3.22],'#a98761',layers.detail);
 for(const [depth,z] of [[.085,2.9325],[.165,3.4725]])k.box(kitchen,'OG sink worktop edge',[.58,.05,depth],[-2.85,.91,z],'#a98761',layers.detail);
 for(const x of [-3.1,-.6])k.box(kitchen,'OG counter support',[.07,.89,.6],[x,.445,3.22],'#856c4c',layers.detail);
 // Recessed sink basin: floor and four thin walls, leaving an actual hollow well.
 k.box(kitchen,'OG sink basin bottom',[.57,.025,.43],[-2.85,.75,3.18],metal,layers.detail);
 for(const x of [-3.13,-2.57])k.box(kitchen,'OG sink basin side',[.025,.17,.45],[x,.83,3.18],metal,layers.detail);
 for(const z of [2.97,3.39])k.box(kitchen,'OG sink basin side',[.57,.17,.025],[-2.85,.83,z],metal,layers.detail);
 k.rod(kitchen,'OG faucet upright',[-2.85,.94,3.46],[-2.85,1.17,3.46],.019,metal,layers.detail);
 k.rod(kitchen,'OG faucet spout',[-2.85,1.17,3.46],[-2.85,1.17,3.25],.019,metal,layers.detail);
 const cooler=new T.Mesh(new T.CylinderGeometry(.19,.17,.47,24),k.mat('#235bb0'));cooler.position.set(-2.26,1.17,3.12);k.tag(kitchen,cooler,'OG blue water cooler',layers.detail);
 const lid=new T.Mesh(new T.CylinderGeometry(.195,.195,.045,24),k.mat('#d9d8cc'));lid.position.set(-2.26,1.425,3.12);k.tag(kitchen,lid,'OG cooler white lid',layers.detail);
 k.box(kitchen,'OG closed green camp stove',[.56,.12,.32],[-1.45,.995,3.12],'#263c31',layers.detail);
 k.box(kitchen,'OG hanging pan timber rail',[1.4,.09,.06],[-1.7,1.94,3.53],'#b09066',layers.detail);
 for(let i=0;i<4;i++){
  const pan=new T.Mesh(new T.CylinderGeometry(.13+i*.017,.12+i*.017,.045,18),k.mat(i===2?'#8f9a96':'#343a38',.4));pan.rotation.x=Math.PI/2;pan.position.set(-2.27+i*.37,1.57,3.46);k.tag(kitchen,pan,'OG hanging cooking pan',layers.detail);
  k.rod(kitchen,'OG pan handle',[-2.27+i*.37,1.68,3.46],[-2.27+i*.37,1.94,3.46],.016,'#343a38',layers.detail);
 }
 // c49346 confirms the solar/low bay keeps its open serving shelves. The
 // occupied enclosed clubhouse is the adjacent high bay; mirror registration
 // across the shared centreline without moving any original rack beams.
 club.scale.x=-1;kitchen.scale.x=-1;
 const forklift=k.assembly('campus-mitsubishi-forklift','Campus · turquoise forklift',[-5.2,0,-61.4],.2,
  'c6686 DJI0010 overhead + c33403/c49252 Mitsubishi ground views. Approximate placement from three-building image fit (several metres uncertainty); dimensions/yaw fitted, not surveyed.');
 const turquoise='#58978e',black='#303735';
 k.box(forklift,'forklift chassis',[2.05,.26,1.05],[0,.41,0],turquoise,layers.context);
 k.box(forklift,'forklift rear counterweight',[.48,.62,1.1],[-.87,.73,0],turquoise,layers.context);
 k.box(forklift,'forklift engine cover',[.68,.25,.84],[-.47,.78,0],turquoise,layers.context);
 for(const [x,radius] of [[.65,.36],[-.76,.25]])for(const z of [-.62,.62]){
  const wheel=new T.Mesh(new T.CylinderGeometry(radius,radius,.18,18),k.mat('#30322e'));wheel.rotation.x=Math.PI/2;wheel.position.set(x,radius,z);k.tag(forklift,wheel,'forklift tyre',layers.context);
  const hub=new T.Mesh(new T.CylinderGeometry(radius*.46,radius*.46,.185,12),k.mat('#777e75',.45));hub.rotation.x=Math.PI/2;hub.position.copy(wheel.position);k.tag(forklift,hub,'forklift wheel hub',layers.context);
 }
 k.box(forklift,'forklift black seat',[.48,.14,.55],[-.1,.94,0],black,layers.context);
 k.box(forklift,'forklift seat back',[.12,.43,.55],[-.34,1.19,0],black,layers.context);
 for(const x of [-.63,.72])for(const z of [-.53,.53])k.rod(forklift,'forklift overhead guard post',[x,.63,z],[x,2.12,z],.035,turquoise,layers.context);
 for(const z of [-.56,.56])k.box(forklift,'forklift guard edge',[1.5,.07,.07],[.04,2.15,z],turquoise,layers.context);
 for(let i=0;i<5;i++)k.box(forklift,'forklift overhead guard crossbar',[.045,.06,1.18],[-.66+i*.35,2.15,0],turquoise,layers.context);
 k.rod(forklift,'forklift steering column',[.38,.66,0],[.3,1.16,0],.035,black,layers.context);
 const steering=new T.Mesh(new T.TorusGeometry(.16,.018,6,18),k.mat(black));steering.rotation.x=1.1;steering.position.set(.3,1.17,0);k.tag(forklift,steering,'forklift steering wheel',layers.context);
 const propane=new T.Mesh(new T.CylinderGeometry(.17,.17,.76,18),k.mat('#9aaba5',.45));propane.rotation.x=Math.PI/2;propane.position.set(-.78,1.25,0);k.tag(forklift,propane,'forklift rear propane cylinder',layers.context);
 for(const z of [-.24,.24]){const strap=new T.Mesh(new T.TorusGeometry(.178,.012,6,18),k.mat(black));strap.position.set(-.78,1.25,z);k.tag(forklift,strap,'forklift propane retaining strap',layers.context);}
 for(const z of [-.44,.44])k.box(forklift,'forklift mast upright',[.10,2.55,.10],[1.04,1.4,z],black,layers.context);
 for(const y of [.19,2.65])k.box(forklift,'forklift mast cross member',[.1,.1,.98],[1.04,y,0],black,layers.context);
 k.rod(forklift,'forklift lift ram',[1.0,.28,0],[1.0,2.52,0],.045,'#a3adab',layers.context);
 k.box(forklift,'forklift load carriage',[.13,.55,1.03],[1.16,.46,0],black,layers.context);
 for(const z of [-.34,.34]){
  k.box(forklift,'forklift vertical fork heel',[.07,.52,.13],[1.25,.37,z],black,layers.context);
  k.box(forklift,'forklift horizontal fork',[1.4,.07,.13],[1.92,.145,z],black,layers.context);
 }
 k.finalize();
 // Original hull and new trailer must move together; shifting tyres alone
 // would separate the photographed cruiser from its road trailer.
 boat.position.y=GROUND;
 for(const id of oldIds){const o=root.getObjectByName(id);if(o)o.position.y+=GROUND;}
 forklift.position.y=GROUND;
 boat.userData.groundContact='Four actual trailer tyres meet sand; retained hull follows the rigid road-trailer settlement';
 forklift.userData.groundContact='Actual forklift tyres meet Studio sand; same-role IDs retained';
 og.translateX(3.0);og.position.y=GROUND;og.userData.registration='c49457 griddle to right of open stock bay, outside source rails; portable placement fitted; caster feet meet Studio sand';root.add(...k.root.children);return [boat,og,club,kitchen,forklift];
}
