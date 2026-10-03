import * as T from 'three';
import {Kit,layers} from './kit';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {componentMeshes} from './cad-components';
import {cutCompoundOpening} from './details-2026-compound';
import {GROUND} from '../studio/ambience-math';

/** Exact triangle subtraction of a source-supported 3D clearance volume.
 * Attribute interpolation preserves UVs; original shared geometry is untouched. */
function clearKitchenRackVolume(geometry:T.BufferGeometry,toKitchen:T.Matrix4){
 const src=geometry.index?geometry.toNonIndexed():geometry.clone(),names=Object.keys(src.attributes),output:Record<string,number[]>={};for(const n of names)output[n]=[];
 type V={p:T.Vector3,a:Record<string,number[]>};
 const clip=(poly:V[],axis:'x'|'y'|'z',value:number,positive:boolean)=>{const out:V[]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=(a.p[axis]-value)*(positive?1:-1),db=(b.p[axis]-value)*(positive?1:-1);if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db),attrs:Record<string,number[]>={};for(const n of names)attrs[n]=a.a[n].map((v,j)=>v+t*(b.a[n][j]-v));out.push({p:a.p.clone().lerp(b.p,t),a:attrs});}}return out;};
 for(let i=0;i<src.attributes.position.count;i+=3){let remaining:V[]=[];for(let j=0;j<3;j++){const a:Record<string,number[]>={};for(const n of names){const attr=src.getAttribute(n);a[n]=Array.from({length:attr.itemSize},(_,c)=>attr.getComponent(i+j,c));}remaining.push({p:new T.Vector3(...a.position as [number,number,number]).applyMatrix4(toKitchen),a});}const pieces:V[][]=[];
  for(const [axis,value,positive]of [['x',.24,true],['x',3.90,false],['y',.16,true],['y',2.15,false],['z',-4.75,true],['z',3.15,false]] as const){if(!remaining.length)break;pieces.push(clip(remaining,axis,value,!positive));remaining=clip(remaining,axis,value,positive);}
  for(const poly of pieces)for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]])for(const n of names)output[n].push(...v.a[n]);
 }
 const result=new T.BufferGeometry();for(const n of names)result.setAttribute(n,new T.Float32BufferAttribute(output[n],src.getAttribute(n).itemSize));if(result.attributes.position.count){result.computeBoundingBox();result.computeBoundingSphere();}src.dispose();return result;
}

/** Photograph-specific movable interior additions. Coordinates are in the
 * imported Chiba CAD frame (origin CAD177,66; glTF Y up), never campus world.
 * Room registration remains provisional; source CAD furniture is retained.
 * Read review-20260929/CHIBA_INTERIOR.md before changing this arrangement. */
export function add2026ChibaInteriors(root:T.Group){
 const existing=root.getObjectByName('Chiba')??root;
 for(const id of ['kitchen-details','mimos-details']){
  const old=existing.children.find(c=>c.userData.assembly_id===id);if(old)existing.remove(old);
 }
 const k=new Kit(2026),angle=-Math.atan2(.4265,.9045),floor=.37;
 // CAD portable camp-kitchen occupies x163.42–166.63/y71.01–77.90.
 // Its counter runs at localu~0–1.8. Keep it; additions start beyond that run.
 const kitchen=k.assembly('kitchen-details','Kitchen · photographed working aisle',[-11,floor,-8.5],angle,'IMG_3472, DSCF1559, DSCF1563; CAD counter registration; furniture dimensions fitted');
 kitchen.userData.registration='CAD166,74.5 / axes(.9045,-.4265),(.4265,.9045); placement provisional, preserves existing imported counter';
 const metal=k.mat('#a7b3b2',.65);
 const table=(g:T.Group,x:number,z:number,w:number,d:number,y:number)=>{k.box(g,'table top',[w,.045,d],[x,y,z],'#c5ad87',layers.detail);for(const xx of [x-w/2+.10,x+w/2-.10])for(const zz of [z-d/2+.10,z+d/2-.10])k.box(g,'table leg',[.045,y,.045],[xx,y/2,zz],'#535e59',layers.detail);};
 const cylinder=(g:T.Group,kind:string,r:number,h:number,p:number[],color:string|T.Material)=>{const m=new T.Mesh(new T.CylinderGeometry(r,r,h,16),typeof color==='string'?k.mat(color):color);m.position.fromArray(p);k.tag(g,m,kind,layers.detail);return m;};
 // Photo steel island has backsplash along its LONG right edge, leaving
 // the opposite long side open to the working aisle; not a barrier at its end.
 k.box(kitchen,'commissary steel prep top',[1.15,.035,2.30],[3.15,.91,2.30],metal,layers.detail);
 k.box(kitchen,'commissary longitudinal backsplash',[.035,.23,2.30],[3.71,1.045,2.30],metal,layers.detail);
 k.box(kitchen,'commissary steel lower shelf',[1.05,.025,2.16],[3.15,.23,2.30],metal,layers.detail);
 for(const x of [2.65,3.65])for(const z of [1.26,3.34])k.box(kitchen,'commissary steel table leg',[.045,.89,.045],[x,.445,z],metal,layers.detail);
 cylinder(kitchen,'orange utility bucket',.15,.36,[3.35,.42,1.58],'#c1662b');
 cylinder(kitchen,'stored stock pot',.19,.26,[2.95,.375,2.63],metal);
 // Tall commercial cabinet is visible at the right entrance in DSCF1563.
 // c50695: twin stainless basins and two taps under the rear windows.
 for(const x of [1.17,1.88]){
  k.box(kitchen,'kitchen rear double sink basin bottom',[.60,.025,.43],[x,.715,3.96],metal,layers.detail);
  for(const z of [3.745,4.175])k.box(kitchen,'kitchen rear basin front back wall',[.63,.20,.025],[x,.815,z],metal,layers.detail);
  for(const xx of [x-.315,x+.315])k.box(kitchen,'kitchen rear basin side wall',[.025,.20,.43],[xx,.815,3.96],metal,layers.detail);
  k.rod(kitchen,'kitchen rear sink faucet stem',[x,.93,4.21],[x,1.30,4.21],.018,'#b7c4c2',layers.detail);
  k.rod(kitchen,'kitchen rear sink faucet spout',[x,1.30,4.21],[x,1.30,4.03],.018,'#b7c4c2',layers.detail);
 }
 for(const z of [3.69,4.25])k.box(kitchen,'kitchen rear sink counter lip',[1.75,.035,.10],[1.525,.93,z],metal,layers.detail);
 for(const x of [.66,2.39])k.box(kitchen,'kitchen rear sink grounded cabinet leg',[.06,.92,.06],[x,.46,4.1],'#86928d',layers.detail);
 k.box(kitchen,'commercial refrigerator cabinet',[1.25,2.07,.76],[4.15,1.035,-1.50],'#bac0b9',layers.detail);
 for(const x of [3.845,4.455]){
  k.box(kitchen,'commercial refrigerator door',[.59,1.68,.025],[x,.99,-1.105],'#505c58',layers.detail);
  k.box(kitchen,'commercial refrigerator handle',[.028,.37,.055],[x+.20,1.08,-1.075],'#d6dad5',layers.detail);
 }
 k.box(kitchen,'commercial refrigerator upper machinery',[1.25,.31,.77],[4.15,1.91,-1.50],'#a7ada6',layers.detail);
 // DSCF1559: independent chest freezer at the entrance, next to white fridge.
 k.box(kitchen,'commissary chest freezer',[.69,.87,.65],[2.30,.435,-1.50],'#d8ddd5',layers.detail);
 k.box(kitchen,'commissary freezer lid',[.72,.055,.68],[2.30,.898,-1.50],'#e6e7dc',layers.detail);
 // A compact open cart, not another cabinet blocking the far-window aisle.
 for(const x of [.98,1.51])for(const z of [2.23,2.70])k.box(kitchen,'commissary tray cart post',[.025,.87,.025],[x,.49,z],metal,layers.detail);
 for(let i=0;i<5;i++)k.box(kitchen,'commissary tray cart shelf',[.55,.018,.49],[1.245,.14+i*.17,2.465],metal,layers.detail);
 for(const x of [.98,1.51])for(const z of [2.23,2.70])cylinder(kitchen,'commissary tray cart caster',.04,.03,[x,.04,z],'#333d3c');
 // December6 c47686 establishes the shared end wall: two kitchen windows
 // (also IMG3472) and one diner window. Rebuild only that source CAD face,
 // preserving its component ID/material/parent and retaining real apertures.
 const openings=[{x:1.42,w:1.96},{x:3.18,w:1.28},{x:6.20,w:2.12}];
 const wallZ=4.30145,wallMin=-.08280,wallMax=8.14686,wallBottom=-.08919,wallTop=2.34921, sill=.87,head=1.94;
 const wallComponent=componentMeshes(existing,'wood_component-0018');
 for(const baseWall of wallComponent.meshes){
  existing.updateMatrixWorld(true);kitchen.updateMatrix();
  const intoWall=baseWall.matrixWorld.clone().invert().multiply(existing.matrixWorld).multiply(kitchen.matrix);
  const pieces:T.BufferGeometry[]=[];
  const piece=(w:number,h:number,x:number,y:number)=>pieces.push(new T.BoxGeometry(w,h,.024).translate(x,y,-wallZ).applyMatrix4(intoWall));
  piece(wallMax-wallMin,sill-wallBottom,(wallMin+wallMax)/2,(sill+wallBottom)/2);
  piece(wallMax-wallMin,wallTop-head,(wallMin+wallMax)/2,(wallTop+head)/2);
  let cursor=wallMin;
  for(const a of openings){const left=a.x-a.w/2;if(left>cursor)piece(left-cursor,head-sill,(left+cursor)/2,(head+sill)/2);cursor=a.x+a.w/2;}
  if(cursor<wallMax)piece(wallMax-cursor,head-sill,(wallMax+cursor)/2,(head+sill)/2);
  baseWall.geometry=mergeGeometries(pieces,false)!;for(const g of pieces)g.dispose();
  // c47859 later kitchen opens around the pegboard into the northern diner.
  // Remove the early donor third-window sill: this is an internal passage.
  baseWall.geometry=cutCompoundOpening(baseWall.geometry,intoWall.clone().invert(),[wallMin,8.14,wallBottom,2.18],[-4.34,-4.26]);
  baseWall.userData.apertureSource='c47686 dining hall, IMG3472 kitchen; true open window apertures, fitted sizes';
 }
 const frame='#d8dace';
 for(const a of openings){
  for(const x of [a.x-a.w/2,a.x+a.w/2])k.box(kitchen,'kitchen diner window jamb',[.045,head-sill+.045,.06],[x,(head+sill)/2,wallZ],frame,layers.detail);
  for(const y of [sill,head])k.box(kitchen,'kitchen diner window lintel',[a.w+.045,.045,.06],[a.x,y,wallZ],frame,layers.detail);
 }
 // Late kitchen photo IMG3472 has a partition behind the prep island;
 // c47686 early build shows the same rack line open. Preserve its front aisle.
 k.box(kitchen,'late kitchen diner partial partition',[.035,2.35,3.0],[4.12,1.175,2.80],'#b79b75',layers.detail);
 // Jan21 c50691 explicitly thanks painting/reupholstery/table work: three
 // blue tables and four seat-back rows supersede the Jan15 temporary free-pile
 // layout. Bus seats belong to the kitchen/diner, not a generic living room.
 k.box(kitchen,'diner photographed blue side wall',[.018,2.35,7.50],[7.005,1.175,.55],'#245d86',layers.wall);
 const boothX=6.17;
 for(const [i,z]of [-2.35,-.90,1.40,3.50].entries()){
  const directions=i===0?[1]:i===3?[-1]:[-1,1];
  for(const dir of directions){
   const busBack=k.box(kitchen,'diner gray bus seat back',[1.25,.72,.105],[boothX,.86,z+dir*.07],'#626964',layers.detail);
   const outline=new T.Shape();outline.moveTo(-.625,-.36);outline.lineTo(.625,-.36);outline.lineTo(.625,.27);outline.quadraticCurveTo(.625,.36,.535,.36);outline.lineTo(-.535,.36);outline.quadraticCurveTo(-.625,.36,-.625,.27);outline.closePath();busBack.geometry=new T.ExtrudeGeometry(outline,{depth:.105,bevelEnabled:false,curveSegments:4}).translate(0,0,-.0525);

   const color=['#c99752','#cb794d','#b9913c','#b45459'][i];
   k.box(kitchen,'diner reupholstered bus cushion',[1.25,.14,.49],[boothX,.44,z+dir*.34],color,layers.detail);
   for(const x of [boothX-.49,boothX+.49]){
    k.box(kitchen,'diner bolted seat support',[.035,.37,.43],[x,.185,z+dir*.30],'#454b45',layers.detail);
    k.box(kitchen,'diner seat bolt plate',[.085,.018,.12],[x,.009,z+dir*.30],'#6c7167',layers.detail);
   }
  }
 }
 for(const z of [-1.62,0,2.45]){
  k.box(kitchen,'diner blue pedestal tabletop',[1.45,.045,.76],[6.21,.76,z],'#235d84',layers.detail);
  k.box(kitchen,'diner blue outer pedestal',[.10,.7375,.10],[5.54,.36875,z],'#235d84',layers.detail);
  k.box(kitchen,'diner blue wall table cleat',[.055,.12,.72],[6.92,.685,z],'#235d84',layers.detail);
 }
 // DSCF1559: independent white top-refrigerator/bottom-freezer, beside the
 // chest freezer; black kettle above. Leave the .8m central entrance aisle.
 k.box(kitchen,'kitchen white refrigerator carcass',[.72,1.96,.70],[2.30,.98,-.32],'#d2d9d3',layers.detail);
 k.box(kitchen,'kitchen white upper refrigerator door',[.70,1.16,.055],[2.30,1.37,-.6975],'#e1e5db',layers.detail);
 k.box(kitchen,'kitchen white lower freezer door',[.70,.75,.055],[2.30,.385,-.6975],'#d9ded5',layers.detail);
 for(const y of [.42,1.40])k.box(kitchen,'kitchen white refrigerator handle',[.04,.46,.07],[2.01,y,-.752],'#e2e4d9',layers.detail);
 cylinder(kitchen,'kitchen fridge top electric kettle',.115,.24,[2.22,2.08,-.30],'#323c3c');
 // A narrow supply shelf above the retained counter, following c50696. The
 // jars are representative observed dry goods, not invented legible labels.
 k.box(kitchen,'kitchen dry goods long shelf',[.37,.045,5.45],[.42,1.77,.25],'#bca273',layers.detail);
 for(let i=0;i<18;i++){
  const z=-2.25+i*.285,h=.18+(i%3)*.045,r=.067;
  cylinder(kitchen,'kitchen dry goods tub',r,h,[.42,1.795+h/2,z],['#b7a077','#8e8066','#ada783','#8f6b52'][i%4]);
  cylinder(kitchen,'kitchen dry goods tub lid',r+.006,.015,[.42,1.802+h,z],'#d5d8c9');
 }
 // c50692: five hanging pans plus one sieve, against the right prep divider.
 k.box(kitchen,'kitchen tool pegboard',[.035,1.18,2.25],[4.073,1.58,2.76],'#a88659',layers.detail);
 for(const [i,[z,y,r]]of [[2.12,1.76,.12],[2.47,1.70,.17],[2.73,1.19,.20],[3.10,1.04,.17],[3.33,1.61,.14],[3.40,1.05,.13]].entries()){
  const pan=cylinder(kitchen,i===4?'kitchen hanging sieve':'kitchen hanging pan',r,.045,[4.027,y,z],i===4?'#a0aaa3':'#454b45');pan.rotation.z=Math.PI/2;
  k.box(kitchen,'kitchen hanging pan handle',[.035,.24,.035],[4.027,y+r+.11,z],'#343d37',layers.detail);
 }
 // Daily prep objects observed in P1013581: bowls and chopping boards remain
 // on the working surface; they do not block the floor route.
 for(const [x,z,r]of [[2.87,1.58,.14],[3.15,2.75,.17],[3.42,3.08,.12]]){
  const bowl=new T.Mesh(new T.CylinderGeometry(r,r*.55,.09,18,1,true),metal);bowl.position.set(x,.9725,z);k.tag(kitchen,bowl,'kitchen prep mixing bowl',layers.detail);
 }
 for(const z of [1.90,2.43])k.box(kitchen,'kitchen prep chopping board',[.36,.02,.28],[2.94,.9375,z],'#dac697',layers.detail);
 // Source string bulbs follow the diner wall and kitchen shelf; emission only,
 // not dozens of shadow-casting point lights.
 const bulbMat=new T.MeshStandardMaterial({color:'#f1d290',emissive:'#e1ad55',emissiveIntensity:.65,roughness:.4});
 for(const x of [.55,6.92]){
  k.rod(kitchen,'kitchen diner overhead light cable',[x,2.19,-2.6],[x,2.19,3.8],.008,'#333a34',layers.detail);
  for(const z of [-2.2,-.8,.6,2.0,3.4]){cylinder(kitchen,'kitchen diner bulb socket',.024,.065,[x,2.1575,z],'#49493d');const bulb=new T.Mesh(new T.SphereGeometry(.037,8,6),bulbMat);bulb.scale.y=1.4;bulb.position.set(x,2.08,z);k.tag(kitchen,bulb,'kitchen diner warm bulb',layers.detail);}
 }
 kitchen.userData.diningEvidence='c47686 Dec6 empty bay; c47615 Jan15 temporary free pile; c50691 Jan21 blue tables/reupholstered bus booths supersede prior fitted maroon pair. Three observed tables/fourbackrows modeled; placement and dimensions fitted.';
 // Above source measurements use CAD V; glTF Y-up reverses that axis.
 // Reflect once before finalization, including the seat-back inclination.
 for(const o of kitchen.children){o.position.z*=-1;o.rotation.x*=-1;o.rotation.y*=-1;}
 // Freeze established same-role IDs before source-fit room relocation.
 k.finalize();const frozenWorkingIds=new Map<T.Object3D,string>();for(const o of kitchen.children)if(o.userData.component_id)frozenWorkingIds.set(o,o.userData.component_id);
 // Diner continues north opposite the Mimos coffee wall. Move only dining,
 // preserving actual kitchen/counter/stairs shell and all existing IDs.
 for(const o of kitchen.children){const kind=o.userData.kind??'';
  if(kind.startsWith('diner ')||(kind.startsWith('kitchen diner ')&&o.position.x>5)){
   o.position.z-=7.50;o.userData.registration='Northern dining bay on annex0016; reverse Mimos west face. 7.5m rack-V fit to bay stations, not survey';
  }
  if(kind.startsWith('kitchen diner window')&&o.position.x>5){o.visible=false;o.userData.walkNoCollision=true;}
 }
 // Opposite photographic views establish rear windows away from the diner.
 // Rotate working arrangement within the two-bay shell, not the donor racks.
 for(const o of kitchen.children){const kind=o.userData.kind??'';
  if(kind.startsWith('diner ')||(kind.startsWith('kitchen diner ')&&o.position.x>5))continue;
  if(kind.startsWith('kitchen diner window')){o.visible=false;o.userData.walkNoCollision=true;continue;}
  o.position.x=4.12-o.position.x;o.position.z=-1.30-o.position.z;o.rotation.y+=Math.PI;
 }
 const blue=kitchen.children.find(o=>o.userData.kind==='diner photographed blue side wall');if(blue)blue.position.x-=.145;
 // Actual rear two-window face; compass is fitted, opposite-view relation is
 // photographic. Keep the north donor header and open its obsolete sill.
 k.box(kitchen,'kitchen rear exterior plywood sill',[4.12,.87,.035],[2.06,.435,3.0],'#bca57f',layers.wall);
 k.box(kitchen,'kitchen rear exterior plywood header',[4.12,.41,.035],[2.06,2.145,3.0],'#bca57f',layers.wall);
 for(const [a,b]of [[0,.30],[1.58,1.72],[3.68,4.12]])k.box(kitchen,'kitchen rear exterior window pier',[b-a,1.07,.035],[(a+b)/2,1.405,3.0],'#bca57f',layers.wall);
 for(const [x,w]of [[.94,1.28],[2.70,1.96]]){
  for(const xx of [x-w/2,x+w/2])k.box(kitchen,'kitchen rear observed window jamb',[.045,1.11,.06],[xx,1.405,3.0],'#d8dace',layers.detail);
  for(const y of [.87,1.94])k.box(kitchen,'kitchen rear observed window horizontal frame',[w+.045,.045,.06],[x,y,3.0],'#d8dace',layers.detail);
 }
 // Full-shell rays identify donor0547 behind the real rear windows. Cut its
 // actual opaque faces too; a new window frame over a solid wall is invalid.
 existing.updateWorldMatrix(true,true);kitchen.updateMatrix();
 const rearFrame=existing.matrixWorld.clone().multiply(kitchen.matrix).invert();
 // c50144 clear serving hatch: clip only front-aperture diagonals, retain edge posts/header and other source rack faces.
 for(const id of ['rack_member-0444','rack_member-0462','rack_member-0307','rack_member-0304','rack_member-0439','rack_member-0305','rack_member-0440'])for(const m of componentMeshes(existing,id).meshes){const into=rearFrame.clone().multiply(m.matrixWorld);m.geometry=cutCompoundOpening(m.geometry,into,[.24,3.40,.90,2.15],[-4.8,-3.95]);m.userData.servingApertureEvidence='c50144 broad clear serving aperture; front-only unsupported diagonal portions clipped, original owner retained';}
 for(const m of componentMeshes(existing,'wood_component-0547').meshes){const into=rearFrame.clone().multiply(m.matrixWorld);for(const [a,b]of [[.30,1.58],[1.72,3.68]])m.geometry=cutCompoundOpening(m.geometry,into,[a,b,.87,1.94]);m.userData.apertureEvidence='c50695 rear exterior two-window sink face; full-shell ray0547 was opaque, apertures fitted';}
 for(const o of kitchen.children){const kind=o.userData.kind??'';if(kind.startsWith('kitchen rear exterior plywood')||kind==='kitchen rear exterior window pier'){o.visible=false;o.userData.walkNoCollision=true;}if(kind.startsWith('kitchen rear observed window'))o.position.z=3.30;}
 kitchen.userData.roomPlan='Kitchen retains western donor shell; dining continues north on annex0016 opposite Mimos coffee wall. c47859 internal passage; c50691 three stations; Gene reverse-face topology. Translation fitted.';
 // Retained portable-kitchen donor bank was arranged across the rear face.
 // Fit the original cabinet/appliance parts as the long left bank observed in
 // c50695, retaining every owner ID and cloning shared geometry before change.
 existing.updateWorldMatrix(true,true);
 existing.traverse(owner=>{const id=owner.userData.component_id,kind=owner.userData.kind;if(!id||!['wood_component','cad_component'].includes(kind)||owner.userData.kitchenCounterFit)return;
  if(kind==='wood_component'&&Number(id.split('-').at(-1))<19)return;
  const bounds=new T.Box3().setFromObject(owner),c=bounds.getCenter(new T.Vector3()),u=.9045*c.x+.4265*c.z,v=.4265*c.x-.9045*c.z;
  if(u< -13.8||u> -6.7||v<-.60||v>.90||bounds.min.y<.02||bounds.max.y>2.2)return;
  owner.traverse(child=>{const mesh=child as T.Mesh;if(!mesh.isMesh)return;mesh.updateWorldMatrix(true,false);const geom=mesh.geometry.clone(),p=geom.attributes.position,inv=mesh.matrixWorld.clone().invert(),q=new T.Vector3();
   for(let i=0;i<p.count;i++){q.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);const a=.9045*q.x+.4265*q.z,b=.4265*q.x-.9045*q.z,nu=-9.76-(b-.27),nv=3.80+(a+10.10);q.x=.9045*nu+.4265*nv;q.z=.4265*nu-.9045*nv;q.applyMatrix4(inv);p.setXYZ(i,q.x,q.y,q.z);}geom.computeVertexNormals();geom.computeBoundingBox();geom.computeBoundingSphere();mesh.geometry=geom;
  });owner.userData.kitchenCounterFit='c50695 long left bank perpendicular to rear windows; donor appliance shapes retained, plan registration fitted';
 });
 kitchen.userData.retainedBankIds=[];existing.traverse(o=>{if(o.userData.kitchenCounterFit)kitchen.userData.retainedBankIds.push(o.userData.component_id);});
 // c50144 exterior serving hatch: restore kitchen-front infill erased by
 // the formerly over-wide passage cut. Dining circulation x4.12–8.14 stays
 // open to ground; this front hatch is opposite the rear sink windows.
 k.box(kitchen,'kitchen source front serving lower plywood',[3.46,.84,.045],[1.79,.42,-4.285],'#732a24',layers.wall);
 for(const x of [.12,3.46])k.box(kitchen,'kitchen source serving hatch jamb',[.08,2.22,.08],[x,1.11,-4.285],'#a38b63',layers.wall);
 k.box(kitchen,'kitchen source serving hatch header',[3.42,.16,.08],[1.79,2.18,-4.285],'#a38b63',layers.wall);
 k.box(kitchen,'kitchen source serving above-hatch plywood fascia',[3.46,.48,.045],[1.79,2.50,-4.285],'#816b4b',layers.wall);
 k.box(kitchen,'kitchen source exterior serving shelf',[3.52,.045,.40],[1.79,.86,-4.47],'#af945f',layers.detail);
 for(const x of [.30,3.28])k.rod(kitchen,'kitchen serving shelf timber bracket',[x,.63,-4.29],[x,.82,-4.63],.022,'#967d53',layers.detail);
 const servingLeaf=new T.Group();servingLeaf.userData={...kitchen.userData};servingLeaf.position.set(3.54,0,-4.285);servingLeaf.rotation.y=-.95;kitchen.add(servingLeaf);
 k.box(servingLeaf,'kitchen source red front door',[.55,2.08,.04],[.275,1.04,0],'#aa3028',layers.wall);
 k.box(servingLeaf,'kitchen red front door round handle',[.035,.08,.055],[.48,.94,-.03],'#68543b',layers.detail);
 const gong=new T.Mesh(new T.CircleGeometry(.20,24),k.mat('#9c7b39',.6));gong.position.set(3.14,1.88,-3.98);gong.rotation.y=Math.PI;k.tag(kitchen,gong,'kitchen serving source suspended bronze gong c50144',layers.detail);k.rod(kitchen,'kitchen serving gong suspension cord',[3.14,2.28,-3.98],[3.14,2.07,-3.98],.005,'#a47e50',layers.detail);
 // c50691 source paint: two exposed plywood patches within the blue wall.
 for(const [name,z,w,h,y]of [['diner-large-wood-patch',-10.25,1.25,.98,1.35],['diner-small-wood-patch',-7.0,.64,.61,1.13]] as [string,number,number,number,number][]){const patch=new T.Mesh(new T.PlaneGeometry(w,h),k.photo(`/history/2026/accuracy/${name}.webp`));patch.position.set(6.823,y,z);patch.rotation.y=-Math.PI/2;k.tag(kitchen,patch,'diner native blue wall plywood patch '+name,layers.detail);patch.userData.walkNoCollision=true;}
 const glow=new T.MeshStandardMaterial({color:'#f5e6b8',emissive:'#d1ae61',emissiveIntensity:.5});
 for(let i=0;i<13;i++){const z=-11.55+i*.60;const bulb=new T.Mesh(new T.SphereGeometry(.03,8,6),glow);bulb.position.set(6.76,2.17-(i%2)*.04,z);k.tag(kitchen,bulb,'diner source perimeter string bulb',layers.detail);bulb.userData.walkNoCollision=true;if(i)k.rod(kitchen,'diner source wall string cable',[6.78,2.24,z-.60],[6.78,2.24,z],.0035,'#383a33',layers.detail);}
 const cafe=k.assembly('mimos-details','Mimos · source coffee counter and gallery',[2.05645,floor,-8.92635],angle+Math.PI/2,'DSCF0863, IMG0317, DSCF1259, IMG6074; room registration from archived CAD, provisional');
 cafe.userData.registration='CAD179.05645,74.92635; counter long axis parallel solarium; CAD raycast floor.37, glazed seating is ground level; exact service-wall position provisional';
 // Keep the glazed side / central route clear; service furnishings stay on
 // plywood side. All bottom heights are relative to the CAD floor datum.
 table(cafe,0,-.85,2.60,.65,.90);
 const top=.935;
 k.box(cafe,'Mimos espresso machine body',[.33,.46,.33],[.24,top+.23,-.85],'#272e2e',layers.detail);
 k.box(cafe,'Mimos espresso metal face',[.29,.31,.016],[.24,top+.27,-.675],metal,layers.detail);
 k.box(cafe,'Mimos espresso drip tray',[.34,.04,.20],[.24,top+.02,-.56],'#303b3a',layers.detail);
 k.rod(cafe,'Mimos portafilter handle',[.24,top+.16,-.65],[.24,top+.16,-.45],.022,'#242a29',layers.detail);
 cylinder(cafe,'Mimos grinder base',.105,.25,[-.12,top+.125,-.85],'#303837');
 const hopper=new T.Mesh(new T.CylinderGeometry(.12,.075,.18,14),k.mat('#796f59'));hopper.position.set(-.12,top+.34,-.85);k.tag(cafe,hopper,'Mimos grinder hopper',layers.detail);
 cylinder(cafe,'Mimos gravity water filter',.155,.69,[-.64,top+.345,-.85],metal);
 cylinder(cafe,'Mimos filter chamber seam',.161,.018,[-.64,top+.345,-.85],'#525e5b');
 k.rod(cafe,'Mimos filter spigot',[-.64,top+.08,-.69],[-.64,top+.08,-.55],.018,'#424a47',layers.detail);
 // c50691 completed dining far end: broad white-framed opening in a
 // plywood surround, never a free-standing frame. Northern receiver bay fit.
 for(const [a,b] of [[4.12,4.55],[6.78,7.005]])k.box(kitchen,'diner completed far end plywood pier',[b-a,2.35,.045],[(a+b)/2,1.175,-11.80],'#b69b73',layers.wall);
 for(const [a,b] of [[0,.82],[1.98,2.35]])k.box(kitchen,'diner completed far end plywood sill header',[2.885,b-a,.045],[5.5625,(a+b)/2,-11.80],'#b69b73',layers.wall);
 for(const x of [4.55,5.665,6.78])k.box(kitchen,'diner completed far end white window jamb',[.055,1.22,.07],[x,1.40,-11.815],'#deded0',layers.wall);
 for(const y of [.82,1.98])k.box(kitchen,'diner completed far end white window sill header',[2.28,.055,.07],[5.665,y,-11.815],'#deded0',layers.wall);
 const dinerGlass=k.box(kitchen,'diner completed far end window glazing',[2.17,1.10,.012],[5.665,1.40,-11.79],new T.MeshStandardMaterial({color:'#9ab8bd',transparent:true,opacity:.20,roughness:.15,side:T.DoubleSide}),layers.wall);dinerGlass.userData.walkNoCollision=true;
 // Narrow open timber tea pantry, clearly photographed alongside counter.
 for(const x of [-1.69,-1.12])for(const z of [-1.10,-.71])k.box(cafe,'Mimos tea pantry upright',[.045,1.83,.045],[x,.915,z],'#d2bb8c',layers.detail);
 for(let i=0;i<5;i++)k.box(cafe,'Mimos tea pantry shelf',[.61,.035,.44],[-1.405,.16+i*.37,-.90],'#d2bb8c',layers.detail);
 for(const [x,y,z,color] of [[-1.58,1.70,-.90,'#c6aa61'],[-1.34,1.70,-.90,'#8b9b65'],[-1.56,1.30,-.90,'#8c7364'],[-1.31,.94,-.90,'#dad3bf']] as const)k.box(cafe,'Mimos tea supplies',[.17,.18,.17],[x,y,z],color,layers.detail);
 k.box(cafe,'Mimos red mini refrigerator',[.48,.81,.48],[2.20,.405,-.86],'#af302d',layers.detail);
 k.box(cafe,'Mimos mini refrigerator handle',[.022,.21,.032],[2.38,.60,-.60],'#d7d9cd',layers.detail);
 // Actual photographed sign, including handmade lettering; no generic font.
 const sign=new T.Mesh(new T.PlaneGeometry(1.90,.67),k.photo('/history/2026/review-20260929/mimos-sign.webp'));sign.position.set(-.05,1.98,-1.22);k.tag(cafe,sign,'Mimos photographed cutout sign',layers.detail);sign.userData.walkNoCollision=true;
 sign.userData.source='IMG_0317-31B52.jpg source crop pixels220,240–760,430; retained photographed backing; not invented lettering';
 const art=new T.Mesh(new T.PlaneGeometry(.67,1.08),k.photo('/history/2026/review-20260929/mimos-gallery.webp'));art.position.set(2.42,1.59,-1.22);k.tag(cafe,art,'Mimos photographed framed gallery',layers.detail);art.userData.walkNoCollision=true;art.userData.source='DSCF1259 left-wall source frames; arrangement crop, placement along same service wall fitted';
 // Source IMG6074 shows a low shared table in the glazed bay, with the
 // primary route along its side. Exact chair census changes with activity.
 const beforeLowTable=new Set(cafe.children);
 table(cafe,.15,1.62,1.25,.75,.50);
 k.box(cafe,'Mimos low table gray cloth',[1.29,.016,.79],[.15,.542,1.62],'#959b93',layers.detail);
 cylinder(cafe,'Mimos table kettle',.10,.19,[.38,.645,1.62],metal);
 k.rod(cafe,'Mimos kettle handle',[.29,.71,1.62],[.46,.71,1.62],.025,'#303835',layers.detail);
 for(const x of [-.25,.03])cylinder(cafe,'Mimos table cup',.045,.075,[x,.588,1.62],'#ddd6c6');
 // IMG6074 shows the glazed seating bay on mats over sand beside raised
 // plywood. CAD floor rays confirm no raised deck here. Lower only this set.
 for(const o of cafe.children)if(!beforeLowTable.has(o)){o.position.y-=floor;o.userData.support='ground-level glazed bay, IMG6074';}
 k.box(cafe,'Mimos glazed bay ground mat',[2.35,.014,1.75],[.15,-floor+.007,1.62],'#746f5e',layers.detail);
 // Gene Oct1: counters continue to the serving face; entry is a real
 // blue wall with a doorway rather than the formerly full-width opening.
 k.box(kitchen,'kitchen source continued left perimeter counter top',[.70,.04,5.42],[3.50,.91,-1.50],metal,layers.detail);
 for(const z of [-4.06,-2.30,-.55,.98])for(const x of [3.20,3.78])k.box(kitchen,'kitchen continued wood counter leg',[.055,.87,.055],[x,.435,z],'#a78a60',layers.detail);
 k.box(kitchen,'kitchen source serving inside counter return',[2.56,.04,.46],[1.83,.91,-4.02],metal,layers.detail);
 for(const x of [.65,1.84,3.0])k.box(kitchen,'kitchen serving return timber leg',[.055,.87,.055],[x,.435,-4.02],'#a78a60',layers.detail);
 k.box(kitchen,'kitchen entry blue wall left of door',[1.53,2.32,.04],[4.885,1.16,-4.285],'#234f73',layers.wall);
 k.box(kitchen,'kitchen entry blue wall right of door',[1.54,2.32,.04],[7.37,1.16,-4.285],'#234f73',layers.wall);
 k.box(kitchen,'kitchen blue entry door header',[.95,.24,.04],[6.125,2.20,-4.285],'#234f73',layers.wall);
 const entryLeaf=k.box(kitchen,'kitchen blue entry door open leaf',[.95,2.08,.035],[5.65,1.04,-4.285],'#d8d8c9',layers.detail);entryLeaf.geometry=entryLeaf.geometry.clone().translate(.475,0,0);entryLeaf.rotation.y=1.40;
 kitchen.userData.critique20261001='Source counters to serving-window perimeter; actual blue entry wall with95cm open doorway, source topology firsthand and dimensions fitted';
 k.finalize();for(const o of kitchen.children){if(/kitchen serving.*gong/.test(o.userData.kind??''))o.position.x-=2.70;if(/kitchen source front serving lower plywood|kitchen source serving above-hatch plywood fascia|kitchen source serving top header/.test(o.userData.kind??''))o.position.z=-4.45;}for(const [o,id]of frozenWorkingIds)o.userData.component_id=id;
 for(const o of kitchen.children)if(o instanceof T.Mesh&&o.userData.kind==='diner bolted seat support')o.geometry=new T.CylinderGeometry(.018,.018,.37,6);

 // Preserve existing IDs while seating the ground-bay set on the actual
 // Studio sand datum; the raised service deck remains at CAD .37m.
 for(const o of cafe.children)if(o.userData.support==='ground-level glazed bay, IMG6074'||o.userData.kind==='Mimos glazed bay ground mat')o.position.y+=GROUND;
 // Native cafe views put the red cabinet beside the service shelving. The
 // earlier x2.20 location had no CAD deck beneath it; retain IDs and move the
 // three-piece cabinet onto the measured raised floor at the counter's end.
 for(const o of cafe.children)if(o.userData.kind==='Mimos red mini refrigerator'||o.userData.kind==='Mimos mini refrigerator handle'){
  o.position.x-=4.35;o.userData.registration='Moved onto retained .3635m deck beside pantry; source DSCF1259, exact furniture placement fitted';
 }
 existing.add(...k.root.children);root.updateWorldMatrix(true,true);
 // c50144/c50695 completed kitchen has no transverse blue cage through
 // hatch, working aisle or rear glazing. Subtract ONLY observed clear volume,
 // preserving edge posts, side frames, orange ceiling headers and ground ties.
 const intoKitchen=kitchen.matrixWorld.clone().invert(),clearanceBox=new T.Box3(new T.Vector3(.24,.16,-4.75),new T.Vector3(3.90,2.15,3.15)),clearedOwners=new Set<string>();
 existing.traverse(owner=>{if(owner.userData.kind!=='rack_member')return;owner.traverse(o=>{const m=o as T.Mesh;if(!m.isMesh)return;const into=intoKitchen.clone().multiply(m.matrixWorld);m.geometry.computeBoundingBox();if(!m.geometry.boundingBox!.clone().applyMatrix4(into).intersectsBox(clearanceBox))return;const corrected=clearKitchenRackVolume(m.geometry,into);if(corrected.attributes.position.count){m.geometry=corrected;}else{corrected.dispose();m.visible=false;m.userData.walkNoCollision=true;}m.userData.sourceClearance='c50144/c50695 observed clear kitchen hatch/working aisle/rear windows; bounded 3D subtraction; all edges/ceiling/ground outside volume retained';clearedOwners.add(owner.userData.component_id);});});
 kitchen.userData.sourceKitchenRackClearanceOwners=[...clearedOwners].sort();root.updateWorldMatrix(true,true);
 // Counter perimeter fits around source steel; never remove real rack to
 // make a continuous furnishing. Clone and notch only the countertop.
 const tops=kitchen.children.filter(o=>/kitchen source continued left perimeter counter top|kitchen source serving inside counter return/.test(o.userData.kind??'')) as T.Mesh[];
 for(const top of tops){if(top.userData.kind.includes('continued')){top.geometry=new T.BoxGeometry(.94,.04,5.42);top.position.x=3.62;}else{top.geometry=new T.BoxGeometry(2.56,.04,.82);top.position.z=-4.00;}top.updateMatrix();}root.updateWorldMatrix(true,true);
 root.traverse(owner=>{if(owner.userData.kind!=='rack_member')return;owner.traverse(o=>{const rack=o as T.Mesh;if(!rack.isMesh)return;for(const top of tops){
  rack.geometry.computeBoundingBox();const b=rack.geometry.boundingBox!.clone().applyMatrix4(kitchen.matrixWorld.clone().invert().multiply(rack.matrixWorld));
  if(b.min.y>.932||b.max.y<.888)continue;top.geometry.computeBoundingBox();const tb=top.geometry.boundingBox!.clone().applyMatrix4(top.matrix);if(!tb.intersectsBox(b))continue;
  top.geometry=cutCompoundOpening(top.geometry,new T.Matrix4().makeRotationX(Math.PI/2).multiply(top.matrix),[b.min.x-.006,b.max.x+.006,-b.max.z-.006,-b.min.z+.006],[.88,.94]);
  top.userData.sourceCounterNotches='Fitted around retained rack, source perimeter counter; steel IDs unchanged';
 } });});return [kitchen,cafe];
}
