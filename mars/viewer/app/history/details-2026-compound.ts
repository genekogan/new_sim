import * as T from 'three';
const cadId=(o:T.Object3D)=>o.userData.component_id??o.parent?.userData.component_id;
import {Kit,layers} from './kit';

/** Freeside detail registration: DJI_0002 t504 (2026-03-19) matches the CAD
 * northeast compound's three roof footprints. Placement remains an aerial/CAD
 * fit, not a survey. Do not copy these furnishings into Chiba's kitchen. */
export const COMPOUND_2026_EVIDENCE={
 aerial:'media/drone/2026/DJI_0002.MP4 @504s',
 kitchenPlan:47947, kitchenPhotos:[47911,47912,47948], courtyardPhotos:[33330,49032],
 kitchenPlanFeet:[37,12],
 registration:'northeast-compound local northern roof; center(-.1,-4.2), yaw-.324; approximate CAD/photo association',
 unresolved:['Bodywork/CoLab room identities and hidden partitions','Later furniture positions','Exact glazing apertures in existing CAD wall'],
};

/** Subtract an axis-aligned facade opening by clipping triangles, preserving
 * interpolated vertex attributes. The caller passes a cloned geometry, so
 * shared imported mesh definitions and the disk GLB remain unchanged. */
export function cutCompoundOpening(geometry:T.BufferGeometry,toFacade:T.Matrix4,rect:[number,number,number,number],depth?:[number,number]){
 const src=geometry.index?geometry.toNonIndexed():geometry.clone();
 const names=Object.keys(src.attributes),output:Record<string,number[]>={};for(const n of names)output[n]=[];
 type V={a:Record<string,number[]>;p:T.Vector3};
 const clip=(poly:V[],axis:'x'|'y',value:number,positive:boolean)=>{
  const out:V[]=[];for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length],da=(a.p[axis]-value)*(positive?1:-1),db=(b.p[axis]-value)*(positive?1:-1);
   if(da>=0)out.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db),attrs:Record<string,number[]>={};for(const n of names)attrs[n]=a.a[n].map((v,j)=>v+t*(b.a[n][j]-v));out.push({a:attrs,p:a.p.clone().lerp(b.p,t)});}
  }return out;
 };
 for(let i=0;i<src.getAttribute('position').count;i+=3){
  let remaining:V[]=[];for(let j=0;j<3;j++){const a:Record<string,number[]>={};for(const n of names){const attr=src.getAttribute(n);a[n]=Array.from({length:attr.itemSize},(_,c)=>attr.getComponent(i+j,c));}remaining.push({a,p:new T.Vector3(...a.position as [number,number,number]).applyMatrix4(toFacade)});}
  if(depth&&!remaining.every(v=>v.p.z>=depth[0]&&v.p.z<=depth[1])){for(const v of remaining)for(const n of names)output[n].push(...v.a[n]);continue;}
  const pieces:V[][]=[];
  for(const [axis,value,positive] of [['x',rect[0],true],['x',rect[1],false],['y',rect[2],true],['y',rect[3],false]] as const){
   if(!remaining.length)break;pieces.push(clip(remaining,axis,value,!positive));remaining=clip(remaining,axis,value,positive);
  }
  for(const poly of pieces)for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]])for(const n of names)output[n].push(...v.a[n]);
 }
 const result=new T.BufferGeometry();for(const n of names)result.setAttribute(n,new T.Float32BufferAttribute(output[n],src.getAttribute(n).itemSize));result.computeBoundingBox();result.computeBoundingSphere();src.dispose();return result;
}

/** Non-destructive details only. Returns groups attached to the existing
 * northeast compound (or an explicit registered fallback at44,0,-95). */
export function add2026CompoundDetails(root:T.Group){
 const existing=root.getObjectByName('Freeside · observed compound details');if(existing)return [existing];
 let host:T.Object3D|undefined;root.traverse(o=>{if(o.userData.assembly_id==='northeast-compound'&&!o.userData.component_id)host=o;});
 // c47948 and c47947: broad serving aperture in the left kitchen front.
 // CAD already contains the right-hand entry opening; retain it unchanged.
 if(host){host.updateWorldMatrix(true,true);const facade=new T.Matrix4().compose(new T.Vector3(-.1,0,-4.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.324),new T.Vector3(1,1,1));
  const intoFacade=facade.invert().multiply(new T.Matrix4().copy(host.matrixWorld).invert());
  host.traverse(o=>{if(!(o instanceof T.Mesh)||(o.userData.component_id??o.parent?.userData.component_id)!=='wood_component-1633'||o.userData.compoundOpeningCorrected)return;
   o.geometry=cutCompoundOpening(o.geometry,new T.Matrix4().copy(intoFacade).multiply(o.matrixWorld),[-4.45,-1.40,1.05,2.38]);
   o.userData.compoundOpeningCorrected=true;o.userData.apertureEvidence='c47948 real serving window; c47947 front-left placement. Bounds fitted, existing right entry retained.';
  });
 }
 // CoLab west facade is a solid imported panel although c28 shows a long
 // horizontal glazed band. Clip only that exact panel, in its own plane.
 if(host){const frame=new T.Matrix4().compose(new T.Vector3(3.35,0,14.97),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.736),new T.Vector3(1,1,1)).invert().multiply(new T.Matrix4().copy(host.matrixWorld).invert());
  const swap=new T.Matrix4().set(0,0,1,0,0,1,0,0,1,0,0,0,0,0,0,1);
  host.traverse(o=>{if(!(o instanceof T.Mesh)||(o.userData.component_id??o.parent?.userData.component_id)!=='wood_component-1830'||o.userData.compoundOpeningCorrected)return;
   o.geometry=cutCompoundOpening(o.geometry,new T.Matrix4().copy(swap).multiply(frame).multiply(o.matrixWorld),[-3.30,2.75,1.0,2.10]);
   o.userData.compoundOpeningCorrected=true;o.userData.apertureEvidence='c28 IMG_6110: broad glazed band on library-facing CoLab wall. Bounds fitted to CAD frame.';
  });
 }
 if(host){const frame=new T.Matrix4().compose(new T.Vector3(-2.9,0,5.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.56),new T.Vector3(1,1,1)).invert().multiply(new T.Matrix4().copy(host.matrixWorld).invert());
  host.traverse(o=>{if(!(o instanceof T.Mesh)||(o.userData.component_id??o.parent?.userData.component_id)!=='wood_component-1145'||o.userData.compoundOpeningCorrected)return;
   o.geometry=cutCompoundOpening(o.geometry,new T.Matrix4().copy(frame).multiply(o.matrixWorld),[-1.12,3.32,.95,2.03]);
   o.userData.compoundOpeningCorrected=true;o.userData.apertureEvidence='c50418 IMG_6111: broad library front glazing left of existing screen door. Fitted bounds; original doorway retained.';
  });
 }
 const k=new Kit(2026);
 const g=k.assembly('freeside-2026-observed-details','Freeside · observed compound details',[-.1,0,-4.2],-.324,
  'DJI_0002t504 March19 roof correspondence; c47947 measured planning sketch; c47911/47912 wash equipment; c33330 last open mic. Dimensions/placement fitted; portable event items represent uncertain capture date (April14 is upload only).');
 g.userData.evidence=COMPOUND_2026_EVIDENCE;
 const cylinder=(name:string,r:number,h:number,p:[number,number,number],color:string)=>{
  const m=new T.Mesh(new T.CylinderGeometry(r,r,h,20),k.mat(color));m.position.set(...p);return k.tag(g,m,name,layers.detail);
 };
 // c50121/c22 north-entry occupied exterior, native sign and three blue
 // hydroponic pipes on wheeled wirecart; portable placement fitted.
 const cart=k.assembly('freeside-north-hydro-cart','Freeside source hydroponic cart',[-3.20,-.16,2.75],0,'c50121 three blue growing pipes/wire cart; c22 washer; placement fitted outside kitchen glazing');g.add(cart);
 for(const x of [-.69,.69])for(const z of [-.27,.27]){k.rod(cart,'Freeside hydro cart chrome upright',[x,.12,z],[x,1.87,z],.012,'#a2afae',layers.detail);const w=new T.Mesh(new T.CylinderGeometry(.06,.06,.035,8),k.mat('#393d38'));w.rotation.z=Math.PI/2;w.position.set(x,.06,z);k.tag(cart,w,'Freeside hydro cart caster',layers.detail);}
 for(const y of [.20,.57,1.05,1.50]){for(const z of [-.27,.27])k.rod(cart,'Freeside hydro cart shelf side rail',[-.69,y,z],[.69,y,z],.009,'#9da9a8',layers.detail);for(let x=-.65;x<=.66;x+=.13)k.rod(cart,'Freeside hydro wire shelf cross rod',[x,y,-.27],[x,y,.27],.004,'#9da9a8',layers.detail);}
 for(const y of [.43,.94,1.43]){const pipe=new T.Mesh(new T.CylinderGeometry(.075,.075,1.31,12),k.mat('#216ac3'));pipe.rotation.z=Math.PI/2;pipe.position.set(0,y,0);k.tag(cart,pipe,'Freeside hydro source blue growing pipe',layers.detail);for(const x of [-.52,-.26,0,.26,.52]){const pot=new T.Mesh(new T.CylinderGeometry(.042,.03,.025,8),k.mat('#263731'));pot.position.set(x,y+.065,0);k.tag(cart,pot,'Freeside hydro black net pot',layers.detail);}}
 k.box(g,'Freeside source blue water jerrycan',[.29,.39,.18],[-3.82,.035,3.33],'#2165c5',layers.detail);k.box(g,'Freeside blue can molded handle',[.19,.045,.07],[-3.82,.25,3.33],'#2874d4',layers.detail);
 k.box(g,'Freeside source white washer body',[.60,.82,.57],[-4.35,.25,2.63],'#dbded0',layers.detail);const washDoor=new T.Mesh(new T.CylinderGeometry(.18,.18,.025,16),k.mat('#667a7e'));washDoor.rotation.x=Math.PI/2;washDoor.position.set(-4.35,.27,2.93);k.tag(g,washDoor,'Freeside washer circular front door',layers.detail);
 const bread=new T.Mesh(new T.PlaneGeometry(.63,1.0),k.photo('/history/2026/accuracy/freeside-native-bread-sign.webp'));bread.position.set(4.10,2.11,2.05);k.tag(g,bread,'Freeside native LOTA BREAD sign c50121',layers.detail);bread.userData.walkNoCollision=true;
 // c47911: fluorescent yellow gravity dispenser, black cap/spigot, mirror,
 // white drain buckets and cleaning bottles. Existing CAD sink is retained.
 cylinder('Freeside yellow wash dispenser',.22,.52,[-2.8,1.24,-1.30],'#bccb31');
 cylinder('Freeside dispenser black lid',.23,.045,[-2.8,1.52,-1.30],'#242624');
 k.box(g,'Freeside dispenser tap',[.07,.055,.10],[-2.8,1.06,-1.03],'#222622');
 for(const x of [-2.38,-1.82]){
  cylinder('Freeside white drain bucket',.17,.36,[x,.25,-1.27],'#e7e6df');
  cylinder('Freeside bucket rim',.185,.022,[x,.44,-1.27],'#f0eee6');
 }
 k.box(g,'Freeside wash mirror timber frame',[.42,.64,.04],[-2.10,1.37,-1.52],'#ae905b');
 k.box(g,'Freeside wash mirror',[.33,.53,.014],[-2.10,1.37,-1.491],k.mat('#a7bbc4',.85));
 for(const x of [-1.79,-1.59]){
  k.box(g,'Freeside cleaning bottle',[.08,.20,.08],[x,1.04,-1.10],'#e4e7cf');
  k.box(g,'Freeside spray nozzle',[.085,.025,.035],[x,1.16,-1.075],'#436c96');
 }
 // c33330: red triangular motif, high circular wheel/clock, circular light
 // beside entrance and lower dartboard. These sit proud of the CAD facade;
 // they are decorative surfaces, not substitute window openings.
 const disc=(name:string,x:number,y:number,r:number,color:string)=>{
  const m=new T.Mesh(new T.CircleGeometry(r,32),k.mat(color));m.position.set(x,y,2.015);k.tag(g,m,name,layers.detail);m.userData.walkNoCollision=true;return m;
 };
 disc('Freeside facade wheel dark rim',.1,3.43,.29,'#62533b');disc('Freeside facade wheel inset',.1,3.43,.265,'#bda572').position.z+=.004;
 for(let i=0;i<8;i++){const a=i*Math.PI/4;k.rod(g,'Freeside facade wheel spoke',[.1,3.43,2.026],[.1+.25*Math.cos(a),3.43+.25*Math.sin(a),2.026],.008,'#64573b',layers.detail);}
 const triangle=new T.Shape();triangle.moveTo(-.85,0);triangle.lineTo(.85,0);triangle.lineTo(0,.56);triangle.closePath();
 const painted=new T.Mesh(new T.ShapeGeometry(triangle),k.mat('#b65945'));painted.position.set(2.85,2.64,2.026);k.tag(g,painted,'Freeside red triangle above entrance',layers.detail);painted.userData.walkNoCollision=true;
 disc('Freeside entrance circular pale light',4.20,2.28,.18,'#e6e3c5');
 disc('Freeside dartboard outer disc',4.65,1.67,.24,'#625447');disc('Freeside dartboard inset',4.65,1.67,.20,'#b69567').position.z+=.006;
 // Portable last-open-mic arrangement (c33330/c49032), separate from fixed
 // building geometry. Four cable-spool tables, lime sofa and pale mattresses.
 const spool=(x:number,z:number)=>{cylinder('Freeside cable spool table foot',.52,.075,[x,.105,z],'#a68c63');cylinder('Freeside cable spool table core',.23,.48,[x,.38,z],'#ad9064');cylinder('Freeside cable spool table top',.59,.065,[x,.655,z],'#b99b70');};
 for(const [x,z] of [[-2.9,3.4],[.2,3.15],[3.7,3.6],[5.1,6.3]])spool(x,z);
 k.box(g,'Freeside lime sofa base',[2.18,.30,.84],[1.10,.25,4.3],'#a7ac63');
 k.box(g,'Freeside lime sofa back',[2.18,.49,.18],[1.10,.63,3.94],'#a7ac63');
 for(const x of [.07,2.13])k.box(g,'Freeside lime sofa arm',[.14,.43,.84],[x,.52,4.3],'#a7ac63');
 for(const x of [.25,1.95])for(const z of [3.99,4.61])k.box(g,'Freeside open mic sofa short grounded foot',[.045,.03,.045],[x,.085,z],'#655b43',layers.detail);
 for(const [x,z,w] of [[1.10,5.25,2.1],[4.4,5.15,1.65]])k.box(g,'Freeside open mic pale mattress',[w,.14,1.04],[x,.13,z],'#c9bca6');
 // Small pallet stage faces west toward the courtyard, as in c33330. Keep
 // ground furniture/event state explicit; no added enclosed room or roof.
 for(let i=0;i<3;i++)k.box(g,'Freeside open mic pallet stage',[1.15,.15,1.15],[7.1,.145,3.8+i*1.16],'#a68e68',layers.floor);
 for(const z of [3.2,7.2]){
  k.box(g,'Freeside open mic speaker',[.43,.68,.40],[6.65,1.40,z],'#282c2d');k.rod(g,'open mic speaker tripod mast',[6.65,.15,z],[6.65,1.18,z],.022,'#3c4544',layers.detail);
  for(let n=0;n<3;n++){const a=n*Math.PI*2/3;k.rod(g,'open mic speaker tripod foot',[6.65,.58,z],[6.65+.40*Math.cos(a),.06,z+.40*Math.sin(a)],.018,'#3c4544',layers.detail);}
 }
 // c38/c49687: reed-blind backdrop suspended from two timber posts,
 // with a draped shade edge. Open mic is a portable south-side event state.
 for(const z of [3.62,6.54])k.box(g,'open mic backdrop timber post',[.07,2.45,.07],[7.66,1.225,z],'#a38c6a',layers.detail);
 k.box(g,'open mic backdrop header',[.07,.07,3.02],[7.66,2.48,5.08],'#b59a70',layers.detail);
 for(let i=0;i<38;i++)k.box(g,'open mic reed blind vertical slat',[.025,1.72,.035],[7.69,1.42,3.68+i*.074],'#9d865e',layers.detail);
 k.box(g,'open mic dark shade strip',[.04,.30,3.01],[7.72,2.18,5.08],'#5b5344',layers.detail);
 k.rod(g,'open mic microphone stand',[7.03,.24,5.18],[7.03,1.42,5.18],.012,'#353e3f',layers.detail);k.rod(g,'open mic microphone boom',[7.03,1.40,5.18],[6.66,1.52,5.18],.012,'#353e3f',layers.detail);
 k.box(g,'open mic portable folding table',[.64,.04,1.40],[7.09,.90,5.15],'#bfae93',layers.detail);for(const z of [4.58,5.72])for(const x of [6.87,7.31])k.box(g,'open mic table slender legs',[.025,.73,.025],[x,.515,z],'#474e4a',layers.detail);
 for(let i=0;i<3;i++){const a=i*Math.PI*2/3;k.rod(g,'open mic microphone tripod foot',[7.03,.24,5.18],[7.03+.20*Math.cos(a),.23,5.18+.20*Math.sin(a)],.008,'#353e3f',layers.detail);}
 // c38 occupied performance: three folding seats on the pallets and the
 // separate black-draped electronics table beside the band, not another room.
 for(const z of [4.10,5.15,6.20]){
  k.box(g,'open mic performer folding chair seat',[.40,.035,.40],[7.28,.64,z],'#555d54',layers.detail);
  k.box(g,'open mic performer folding chair back',[.025,.34,.40],[7.46,.94,z],'#555d54',layers.detail);
  for(const zz of [z-.17,z+.17]){
   k.rod(g,'open mic performer folding chair crossed leg',[7.10,.22,zz],[7.45,.62,zz],.012,'#626b61',layers.detail);
   k.rod(g,'open mic performer folding chair crossed leg',[7.45,.22,zz],[7.10,.62,zz],.012,'#626b61',layers.detail);
  }
 }
 k.box(g,'open mic keyboard narrow housing',[.26,.055,.92],[7.05,.947,4.61],'#343b38',layers.detail);
 for(let i=0;i<20;i++)k.box(g,'open mic keyboard pale key',[.13,.013,.032],[6.96,.979,4.28+i*.033],'#dddccf',layers.detail);
 k.box(g,'open mic separate black draped DJ table',[.72,.79,1.15],[6.65,.465,7.52],'#27292b',layers.detail);
 k.box(g,'open mic DJ table top',[.74,.045,1.19],[6.65,.88,7.52],'#393c3a',layers.detail);
 k.box(g,'open mic DJ laptop base',[.25,.025,.35],[6.65,.917,7.52],'#8a8e89',layers.detail);
 k.box(g,'open mic DJ laptop screen',[.025,.24,.35],[6.78,1.04,7.52],'#59656b',layers.detail);
 // Feb17 post and c50416–19/c28 identify metal
 // roofing on kitchen, library and CoLab. Preserve all original CAD pieces.
 const finishes=k.assembly('compound-2026-metal-roofs','Freeside and Bodywork/CoLab · observed metal roofs',[0,0,0],0,
  'Feb17 roofing post; c50416–19/c28; DJI_0002t504. Roof geometry retained from CAD, silver finish observed.');
 // c28: shallow living-house metal roof close to Bodywork roof elevation;
 // donor3.13–3.67m roof contradicts finished facade/near-level connector.
 // Preserve footprint/owner IDs and genuine high steel post stubs.
 if(host){host.updateWorldMatrix(true,true);host.traverse(o=>{if(!(o instanceof T.Mesh)||!['wood_component-1143','wood_component-1148','wood_component-1464'].includes(cadId(o)))return;const geom=o.geometry.clone(),pos=geom.getAttribute('position'),inv=o.matrixWorld.clone().invert();for(let i=0;i<pos.count;i++){const p=new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);p.y=cadId(o)==='wood_component-1143'?2.36+(p.y-3.13115)*.15:2.45+(p.y-3.46472)*.40;p.applyMatrix4(inv);pos.setXYZ(i,p.x,p.y,p.z);}geom.computeVertexNormals();geom.computeBoundingBox();geom.computeBoundingSphere();o.geometry=geom;o.userData.sourceRoofFit='c28 shallow completed living roof near-level Bodywork bridge; living2.36–2.44m/kitchen2.45–2.75m source-fitted, not surveyed.';});}
 // Reconcile retained plywood wall tops with those completed shallow roofs.
 // Known shell panels only; tall steel uprights and door/window heights remain.
 if(host){const groups=[{roof:['wood_component-1143'],walls:['wood_component-1144','wood_component-1145','wood_component-1146','wood_component-1147']},{roof:['wood_component-1148','wood_component-1464'],walls:['wood_component-1465','wood_component-1466','wood_component-1467','wood_component-1468','wood_component-1469','wood_component-1633']}];for(const group of groups){const roofs:T.Object3D[]=[];host.traverse(o=>{if(o instanceof T.Mesh&&group.roof.includes(cadId(o)))roofs.push(o);});host.traverse(o=>{if(!(o instanceof T.Mesh)||!group.walls.includes(cadId(o)))return;const geom=o.geometry.clone(),pos=geom.getAttribute('position'),inv=o.matrixWorld.clone().invert();for(let i=0;i<pos.count;i++){const p=new T.Vector3().fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);if(p.y>2.30){let top:number|undefined;for(const dx of [0,-.18,.18])for(const dz of [0,-.18,.18]){const hit=new T.Raycaster(new T.Vector3(p.x+dx,8,p.z+dz),new T.Vector3(0,-1,0),0,12).intersectObjects(roofs,true)[0];if(hit)top=Math.max(top??-Infinity,hit.point.y);}p.y=Math.min(p.y,(top??(group.roof[0]==='wood_component-1143'?2.40:2.60))-.012);}p.applyMatrix4(inv);pos.setXYZ(i,p.x,p.y,p.z);}geom.computeVertexNormals();geom.computeBoundingBox();geom.computeBoundingSphere();o.geometry=geom;o.userData.completedRoofWallContact='c22/c28 finished shell plywood top clipped to actual fitted shallow roof; original IDs/apertures retained';});}}
 const roofIds=['wood_component-1143','wood_component-1148','wood_component-1464','wood_component-1835','wood_component-1836','wood_component-1837','wood_component-1838'];
 if(host){host.updateWorldMatrix(true,true);const inv=new T.Matrix4().copy(host.matrixWorld).invert();
  host.traverse(o=>{if(!(o instanceof T.Mesh)||!roofIds.includes(cadId(o)))return;
   const m=new T.Mesh(o.geometry.clone(),k.mat('#b6c5d0',.62));m.matrix.copy(inv).multiply(o.matrixWorld);m.matrix.decompose(m.position,m.quaternion,m.scale);m.position.y+=.018;
   k.named(k.tag(finishes,m,'observed compound metal roof finish',layers.roof),`metal-${cadId(o)}${o.userData.component_id?'':'-child'+(o.parent?.children.indexOf(o)??0)}`);
   m.userData.sourceComponent=cadId(o);m.userData.walkNoCollision=true;
  });
 }
 // c28: straight exterior side stair to CoLab roof beside the entry. Local
 // frame follows the CAD square; precise run/tread count remain fitted.
 const colab=k.assembly('colab-2026-roof-access','Bodywork/CoLab · exterior roof access',[3.35,0,14.97],-.736,
  'c28 IMG_6110 in Feb17 roofing post: straight side stair to square CoLab roof beside white entry door and glazed sidelight. CAD frame fit; count/rise approximate.');
 const n=12,run=3.8,rise=2.40;
 for(let i=0;i<n;i++)k.box(colab,'CoLab exterior open stair tread',[run/n+.02,.06,.90],[-.55+(i+.5)*run/n,.06+(i+1)*(rise-.06)/n,-4.10],'#a98f69',layers.floor);
 for(const z of [-4.48,-3.72])k.rod(colab,'CoLab exterior stair timber stringer',[-.55,.03,z],[3.25,2.30,z],.055,'#a18360',layers.floor);
 // c28 shows the pale wall-side handrail parallel to the real stair run.
 k.rod(colab,'CoLab photographed pale stair handrail',[-.55,.98,-3.63],[2.70,2.27,-3.63],.028,'#d6d0bd',layers.detail);
 for(let i=0;i<4;i++){const x=-.55+i*3.25/3,y=.98+i*1.29/3;const bracket=k.rod(colab,'CoLab stair handrail wall bracket',[x,y,-3.63],[x,y,-3.585],.014,'#d6d0bd',layers.detail);if(i===1||i===2){bracket.visible=false;bracket.userData.walkNoCollision=true;}bracket.userData.source='c28: two visible wall fixings; prior inferred intermediate fixings retained hidden for stable IDs';}
 k.rod(colab,'Bodywork c28 vertical white pipe',[-4.20,.12,-3.67],[-4.20,2.35,-3.67],.035,'#dedbd0',layers.detail);
 // c28: source-facing entrance has the stair at image-left (positive local
 // x), a tall sidelight and white door to its right. The imported frame has
 // the opening but lacks these photographed front infill panels.
 for(const [a,b] of [[-4.48,-3.30],[-.86,.58]])k.box(colab,'CoLab photographed front plywood infill',[b-a,.0+2.44,.035],[(a+b)/2,1.22,-3.585],'#b49a72',layers.wall);
 k.box(colab,'CoLab entry lintel plywood',[3.88,.19,.035],[-1.36,2.345,-3.585],'#b49a72',layers.wall);
 const glass=k.mat('#899f9e',.28);glass.transparent=true;glass.opacity=.30;
 k.box(colab,'CoLab tall entry sidelight',[1.12,2.19,.012],[-1.49,1.13,-3.592],glass,layers.wall);
 for(const x of [-3.30,-2.08,-.90])k.box(colab,'CoLab entry timber jamb',[.055,2.24,.07],[x,1.12,-3.595],'#d5cbb5',layers.wall);
 // Door leaf left open for the walkthrough; its observed white lower panel
 // and upper glazing are retained, with opening angle explicitly fitted.
 const leaf=new T.Group();leaf.userData={...colab.userData};leaf.position.set(-3.25,0,-3.60);leaf.rotation.y=.95;colab.add(leaf);
 k.box(leaf,'CoLab white entry door lower panel',[1.12,.92,.045],[.56,.49,0],'#e2dfd4',layers.wall);
 k.box(leaf,'CoLab white entry door upper rail',[1.12,.09,.045],[.56,2.14,0],'#e2dfd4',layers.wall);
 for(const x of [.035,1.085])k.box(leaf,'CoLab white entry door stile',[.07,1.18,.045],[x,1.53,0],'#e2dfd4',layers.wall);
 k.box(leaf,'CoLab door upper glazing',[.98,1.10,.012],[.56,1.53,0],glass,layers.wall);
 k.box(colab,'CoLab library side window band',[.012,1.10,6.05],[-4.478,1.55,-.275],glass,layers.wall);
 for(const z of [-3.30,-1.78,-.26,1.26,2.75])k.box(colab,'CoLab side window timber mullion',[.065,1.15,.055],[-4.48,1.55,z],'#887655',layers.wall);
 // DJI0002 t504 and native DJI0010 show the southern house occupied and
 // enclosed on the rear/right, rather than CAD's two-wall proxy. Unknown
 // small apertures on these sides remain explicit fitted envelope details.
 k.box(colab,'CoLab completed rear plywood enclosure',[8.66,2.44,.035],[-.14,1.22,3.875],'#b49a72',layers.wall);
 k.box(colab,'CoLab completed east plywood enclosure',[.035,2.44,7.44],[4.20,1.22,.15],'#b49a72',layers.wall);
 // March24 c47830 in CoLab channel: taupe sofa, actual brown drawer coffee
 // table and curtains. Room assignment/layout fitted within southern house,
 // not a triangulated interior floor plan or copied Chiba furnishings.
 const sofaX=-.35,sofaZ=2.85;
 k.box(colab,'CoLab photographed taupe sofa base',[2.75,.30,.88],[sofaX,.40,sofaZ],'#a7977f',layers.detail);
 k.box(colab,'CoLab photographed taupe sofa back',[2.75,.48,.19],[sofaX,.79,sofaZ+.36],'#a7977f',layers.detail);
 for(const x of [sofaX-1.28,sofaX+1.28])k.box(colab,'CoLab taupe sofa arm',[.20,.40,.88],[x,.67,sofaZ],'#b2a188',layers.detail);
 for(const x of [sofaX-.89,sofaX,sofaX+.89])k.box(colab,'CoLab sofa cushion',[.83,.14,.68],[x,.61,sofaZ-.06],'#b2a188',layers.detail);
 for(const x of [sofaX-1.12,sofaX+1.12])for(const z of [sofaZ-.29,sofaZ+.29])k.box(colab,'CoLab sofa foot',[.10,.20,.10],[x,.285,z],'#53483b',layers.detail);
 k.box(colab,'CoLab brown drawer coffee tabletop',[1.65,.08,.90],[sofaX,.69,1.55],'#986342',layers.detail);
 for(const x of [sofaX-.69,sofaX+.69])for(const z of [1.22,1.88])k.box(colab,'CoLab coffee table foot',[.09,.47,.09],[x,.42,z],'#85583c',layers.detail);
 for(const x of [sofaX-.54,sofaX,sofaX+.54]){
  k.box(colab,'CoLab coffee table drawer front',[.49,.22,.035],[x,.53,1.09],'#986342',layers.detail);
  k.box(colab,'CoLab coffee table drawer handle',[.12,.025,.045],[x,.53,1.063],'#423b32',layers.detail);
 }
 // c47830 occupied communal room: patterned curtain on sofa's left,
 // teal curtain on right, white side lamp; native pattern excludes people.
 const curtain=new T.Mesh(new T.PlaneGeometry(.78,2.18),k.photo('/history/2026/accuracy/colab-native-curtain.webp'));curtain.position.set(-2.29,1.26,3.851);curtain.rotation.y=Math.PI;k.tag(colab,curtain,'CoLab native patterned left curtain c47830',layers.detail);curtain.userData.walkNoCollision=true;
 k.box(colab,'CoLab source teal hanging curtain',[1.13,1.83,.022],[1.37,1.49,3.85],'#7dadae',layers.detail);
 k.box(colab,'CoLab source white side floor lamp shade',[.31,.42,.14],[-2.16,1.43,2.81],'#dedfd1',layers.detail);
 k.rod(colab,'CoLab source slender lamp stand',[-2.16,.13,2.81],[-2.16,1.20,2.81],.012,'#585948',layers.detail);
 for(const z of [-4.48,-3.72])k.box(colab,'Bodywork stair grounded foot block',[.20,.20,.20],[-.55,-.06,z],'#796b55',layers.floor);
 const library=k.assembly('library-2026-front','Freeside living house · reused LIBARY facade',[-2.9,0,5.2],-.56,
  'c50418 IMG_6111: broad front glazing and screen entrance with two circular ornaments. Original CAD doorway retained, aperture bounds fitted.');
 // Completed living-house envelope: source aerial shows an enclosed room.
 // LIBARY is a retained sign, not2026 functional library attribution; Gene
 // places the active library in Tool Camp's upstairs northeast bay.
 // CAD omitted its rear wall. Fit each rear panel up to the actual retained
 // roof, rather than placing a generic low wall with daylight above it.
 if(host){
  const roofObjects:T.Object3D[]=[];host.traverse(o=>{if(o instanceof T.Mesh&&['wood_component-1143','wood_component-1148'].includes(cadId(o)))roofObjects.push(o);});
  const libraryFrame=new T.Matrix4().compose(new T.Vector3(-2.9,0,5.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.56),new T.Vector3(1,1,1));
  const world=host.matrixWorld.clone().multiply(libraryFrame),invWorld=world.clone().invert();
  const roofHeight=(x:number)=>{const origin=new T.Vector3(x,10,1.72).applyMatrix4(world),down=new T.Vector3(0,-1,0).transformDirection(world);const hits=new T.Raycaster(origin,down,0,15).intersectObjects(roofObjects,true);return hits.length?hits[0].point.clone().applyMatrix4(invWorld).y:3.10;};
  for(const [a,b] of [[-3.68,0],[0,3.60]]){
   const ya=roofHeight(a+.03),yb=roofHeight(b-.03),geom=new T.BufferGeometry();
   geom.setAttribute('position',new T.Float32BufferAttribute([a,.06,1.76,b,.06,1.76,b,yb,1.76,a,ya,1.76],3));geom.setIndex([0,1,2,0,2,3]);geom.computeVertexNormals();
   const mat=k.mat('#b49a72').clone();mat.side=T.DoubleSide;
   const panel=new T.Mesh(geom,mat);k.tag(library,panel,'Library completed rear envelope fitted to retained roof',layers.wall);
   panel.userData.uncertainty='Completed enclosure confirmed by Gene/aerial; rear apertures unresolved, roof profile follows CAD. Not surveyed.';
  }
 }
 // c22/c50119 north-entry view sees the narrow end of the living room,
 // opposite the kitchen wash end, not the long LIBARY-sign facade.
 if(host){const frame=new T.Matrix4().compose(new T.Vector3(-2.9,0,5.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.56),new T.Vector3(1,1,1)).invert().multiply(host.matrixWorld.clone().invert()),swap=new T.Matrix4().set(0,0,1,0,0,1,0,0,1,0,0,0,0,0,0,1);host.traverse(o=>{if(o instanceof T.Mesh&&cadId(o)==='wood_component-1144'){o.geometry=cutCompoundOpening(o.geometry,swap.clone().multiply(frame).multiply(o.matrixWorld),[-1.67,1.66,.87,2.03]);o.userData.apertureEvidence='c22/c50119 completed broad white-framed north-entry end glazing, bounds fitted';}});}
 k.box(library,'Freeside north entry living end broad glazing',[.012,1.16,3.33],[-3.66,1.45,-.005],glass,layers.wall);
 for(const z of [-1.67,-.005,1.66])k.box(library,'Freeside north entry white window mullion',[.055,1.22,.055],[-3.68,1.45,z],'#d5d5c7',layers.wall);
 for(const y of [.87,2.03])k.box(library,'Freeside north entry white sill header',[.055,.055,3.40],[-3.68,y,-.015],'#d5d5c7',layers.wall);
 // c22: reused FREESIDE painted leaf beside open entry; native pixels
 // contain only its painted panel, no people. Posed against the side post.
 k.box(library,'Freeside north entry reused painted door backing',[.035,2.10,.88],[-3.73,1.00,-2.10],'#8a785d',layers.wall);
 const signFace=new T.Mesh(new T.PlaneGeometry(.84,2.05),k.photo('/history/2026/accuracy/freeside-native-entry-paint.webp'));signFace.position.set(-3.752,1.00,-2.10);signFace.rotation.y=-Math.PI/2;k.tag(library,signFace,'Freeside native north entry paint c22',layers.detail);signFace.userData.walkNoCollision=true;
 // Outside-right IBC in c22, molded translucent white tank/metal cage.
 k.box(library,'Freeside source north entry IBC black plinth',[1.15,.13,1.02],[-4.72,-.095,.68],'#363c39',layers.detail);
 k.box(library,'Freeside source north entry IBC white tank',[1.06,.98,.94],[-4.72,.455,.68],'#d9ddd3',layers.detail);
 for(const x of [-5.28,-4.16])for(const z of [.18,1.18])k.rod(library,'Freeside IBC cage vertical',[x,-.02,z],[x,.99,z],.012,'#8b9290',layers.detail);
 for(const y of [.05,.36,.67,.98]){for(const z of [.18,1.18])k.rod(library,'Freeside IBC cage horizontal',[-5.28,y,z],[-4.16,y,z],.009,'#8b9290',layers.detail);for(const x of [-5.28,-4.16])k.rod(library,'Freeside IBC cage horizontal',[x,y,.18],[x,y,1.18],.009,'#8b9290',layers.detail);}
 k.box(library,'Library broad front glazing',[4.44,1.08,.012],[1.10,1.49,-1.857],glass,layers.wall);
 for(const x of [-1.12,.36,1.84,3.32])k.box(library,'Library front window timber mullion',[.055,1.14,.055],[x,1.49,-1.86],'#8e795a',layers.wall);
 k.box(library,'Library green signboard',[.64,.44,.025],[-.66,.70,-1.885],'#547367',layers.detail);
 for(const x of [-1.78,-2.65]){
  const ring=new T.Mesh(new T.TorusGeometry(.20,.016,8,32),k.mat('#8a7553'));ring.position.set(x,2.68,-1.87);k.tag(library,ring,'Library circular wall ornament',layers.detail);
 }
 const bridge=k.box(finishes,'library CoLab connecting access plank',[3.55,.07,.75],[-.55,2.45,8.12],'#bda170',layers.floor);bridge.rotation.y=-.05;
 bridge.userData.source='c28/c50418 and DJI_0002t504: narrow timber bridge linking library and CoLab; span/height fitted';
 // c28 corrugated sheets: slender ridges supply visible scale without textures
 // or tessellating the whole roof. Underlying fitted CAD plane remains datum.
 for(let i=0;i<44;i++)k.box(colab,'Bodywork corrugated roof slender ridge',[.022,.018,7.40],[-4.44+i*.198,2.465,.15],'#aabac2',layers.roof);
 // Small pale tarp portion explicitly distinct from corrugated sheets.
 const tarp=k.box(colab,'Bodywork roof pale tarp patch',[8.60,.012,2.20],[-.14,2.478,-2.42],'#b8b7aa',layers.roof);tarp.userData.source='c28: mixed corrugated/tarp surface; patch boundary fitted';
 k.finalize();
 // Connect the narrow photographed bridge to real retained roof receivers.
 if(host){
  const bridgeHost=host;const roofMeshes=(ids:string[])=>{const out:T.Object3D[]=[];bridgeHost.traverse(o=>{if(o instanceof T.Mesh&&ids.includes(cadId(o)))out.push(o);});return out;};
  const samples=(roofs:T.Object3D[])=>{const box=new T.Box3();for(const o of roofs)box.union(new T.Box3().setFromObject(o));const points:T.Vector3[]=[];for(let x=box.min.x+.30;x<box.max.x-.30;x+=.20)for(let z=box.min.z+.30;z<box.max.z-.30;z+=.20){const hit=new T.Raycaster(new T.Vector3(x,8,z),new T.Vector3(0,-1,0),0,12).intersectObjects(roofs,true)[0];if(hit)points.push(hit.point.clone());}return points;};
  const aa=samples(roofMeshes(['wood_component-1143'])),bb=samples(roofMeshes(['wood_component-1836']));let pair:[T.Vector3,T.Vector3]|undefined,best=Infinity;
  for(const a of aa)for(const b of bb){const d=Math.hypot(a.x-b.x,a.z-b.z);if(d<best){best=d;pair=[a,b];}}
  const kitchenPoints=samples(roofMeshes(['wood_component-1148','wood_component-1464']));let entryPair:[T.Vector3,T.Vector3]|undefined,entryBest=Infinity;
  for(const a of aa)for(const b of kitchenPoints){const d=Math.hypot(a.x-b.x,a.z-b.z);if(d<entryBest){entryBest=d;entryPair=[a,b];}}
  if(entryPair){const inv=host.matrixWorld.clone().invert(),a=entryPair[0].clone().add(new T.Vector3(0,.045,0)).applyMatrix4(inv),b=entryPair[1].clone().add(new T.Vector3(0,.045,0)).applyMatrix4(inv),d=b.clone().sub(a);const entry=k.box(finishes,'Freeside north entrance broad upper timber bridge',[d.length()+.25,.09,2.35],a.clone().addScaledVector(d,.5).toArray() as [number,number,number],'#b49c70',layers.floor);entry.userData.component_id='compound-2026-metal-roofs-north-entrance-upper-bridge';entry.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),d.normalize());entry.userData.roofContactEndpoints=entryPair.map(p=>p.toArray());entry.userData.source='c22/c50119/c50121: broad timber bridge over open north entry, linking kitchen and living house. Span/width fitted to retained roof receiver footprints.';}
  if(pair){const inv=host.matrixWorld.clone().invert(),a=pair[0].clone().add(new T.Vector3(0,.035,0)).applyMatrix4(inv),b=pair[1].clone().add(new T.Vector3(0,.035,0)).applyMatrix4(inv),delta=b.clone().sub(a);
   bridge.geometry=new T.BoxGeometry(delta.length()+.20,.07,.75);bridge.position.copy(a).addScaledVector(delta,.5);bridge.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),delta.normalize());bridge.userData.roofContactEndpoints=pair.map(p=>p.toArray());bridge.userData.source='c28 narrow Bodywork/Freeside connection: actual roof receivers sampled; slope/width fitted, not surveyed.';
  }
 }
 // c22 looks at kitchen's narrow west end: source inventory belongs
 // outside that glazing, not against its long serving facade.
 cart.position.set(-5.78,-.16,0);cart.rotation.y=Math.PI/2;
 bread.position.set(-4.94,2.02,1.45);bread.rotation.y=-Math.PI/2;
 for(const o of g.children){if(o.userData.kind==='Freeside source blue water jerrycan')o.position.set(-5.68,.035,-1.10);if(o.userData.kind==='Freeside blue can molded handle')o.position.set(-5.68,.25,-1.10);if(o.userData.kind==='Freeside source white washer body'){o.position.set(-5.42,.25,-2.18);o.rotation.y=Math.PI/2;}if(o.userData.kind==='Freeside washer circular front door'){o.position.set(-5.72,.27,-2.18);o.rotation.set(0,0,Math.PI/2);}}
 // c22 open middle entry has no low three-beam barrier. Retain owner IDs
 // as hidden provenance; these inferred beam candidates cross the passage.
 root.traverse(o=>{if(['beam_candidate-0055','beam_candidate-0056','beam_candidate-0057','beam_candidate-0058','beam_candidate-0059','beam_candidate-0060'].includes(cadId(o))){o.visible=false;o.userData.walkNoCollision=true;o.userData.sourceCorrection='c22/c50119 unobstructed central ground-level entry; inferred low donor barrier omitted';}});
 // c38/c49687 stage is outside the SOUTH of the living house, not in
 // c22's north kitchen/living entry. Portable event placement remains fitted.
 for(const o of g.children)if(/open mic|Freeside lime|Freeside.*spool/.test(o.userData.kind??'')){
  // Set the fitted pallet underside (.07m) onto Studio sand (−.16m).
  // Same-role transforms occur after ID finalization; source IDs stay frozen.
  if(o instanceof T.Mesh&&o.userData.kind==='open mic table slender legs'){
   o.geometry=o.geometry.clone();o.scale.y*=.66/.73;o.position.y+=.035;
  }
  // The full retained Bodywork shell extends farther south than the new
  // shallow roof proxies. +10 remained under1829/1836; +24 clears its actual
  // rear face. Portable event location remains a fitted source interpretation.
  o.position.z+=24;o.position.y-=.23;
  o.userData.eventPlacement='c38/c49687 south-side outdoor event beyond retained Bodywork shell; pallet underside meets sand, table feet meet pallet top; portable layout fitted';
 }
 // c38 pale U-shaped cloth swag over reed blind. New explicit owner after
 // finalization leaves all prior event IDs fixed; portable fitted extent.
 const clothPositions:number[]=[],clothIndices:number[]=[];
 for(let i=0;i<=12;i++){const t=i/12,sag=Math.sin(Math.PI*t),z=27.62+2.92*t,y=2.24-.86*sag;clothPositions.push(7.625-.015*Math.sin(t*Math.PI*6),y,z,7.61-.025*Math.sin(t*Math.PI*6),y-.36-.09*sag,z);if(i<12){const j=i*2;clothIndices.push(j,j+1,j+2,j+1,j+3,j+2);}}
 const clothGeometry=new T.BufferGeometry();clothGeometry.setAttribute('position',new T.Float32BufferAttribute(clothPositions,3));clothGeometry.setIndex(clothIndices);clothGeometry.computeVertexNormals();
 const cloth=new T.Mesh(clothGeometry,new T.MeshStandardMaterial({color:'#d5d0bd',roughness:.95,side:T.DoubleSide}));cloth.name='Open mic · native pale sagging backdrop cloth';cloth.userData={component_id:'freeside-native-open-mic-sagging-cloth-20261001',assembly_id:g.userData.assembly_id,kind:'open mic pale native sagging cloth',definition_id:'open mic source cloth swag',layer:layers.detail,source:'c38 native pale U-shaped swag over reed backdrop; extent/sag fitted, no source people'};g.add(cloth);
 // Same-role source corrections after ID finalization retain frozen identifiers.
 const pipe=colab.children.find(o=>o.userData.kind==='Bodywork c28 vertical white pipe');if(pipe)pipe.position.x=3.50;
 const rail=colab.children.find(o=>o.userData.kind==='CoLab photographed pale stair handrail');if(rail instanceof T.Mesh){
  const a=new T.Vector3(-.55,.98,-3.75),b=new T.Vector3(2.70,2.27,-3.75),d=b.clone().sub(a);rail.geometry=rail.geometry.clone();rail.geometry.computeBoundingBox();rail.scale.y=d.length()/Math.max(.001,rail.geometry.boundingBox!.max.y-rail.geometry.boundingBox!.min.y);rail.position.copy(a).addScaledVector(d,.5);rail.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());
 }
 for(const o of colab.children)if(o instanceof T.Mesh&&o.userData.kind==='CoLab stair handrail wall bracket'){o.geometry=o.geometry.clone();o.position.z-=.09;}
 if(host){for(const child of k.root.children.slice())host.add(child);}else{
  const anchor=new T.Group();anchor.name='Freeside compound registration fallback';anchor.position.set(44,0,-95);anchor.add(...k.root.children);root.add(anchor);
 }
 return [g,finishes,colab,library,...add2026CompletedKitchen(root),...add2026DojoDetails(root),...add2026CabinDetails(root)];
}

/** Dojo is the isolated square between Tool Camp and Freeside, not the
 * square CoLab residence. Registration: DJI_0010 March19 + March5 urban-plan
 * aerial; interior identity explicitly captioned in Discord c50580/c50720. */
export function add2026DojoDetails(root:T.Group){
 const prior=root.getObjectByName('Dojo · photographed 2026 interior');if(prior)return [prior];
 let host:T.Object3D|undefined;root.traverse(o=>{if(o.userData.assembly_id==='north-rack-building'&&!o.userData.component_id)host=o;});if(!host)return [];
 const k=new Kit(2026),g=k.assembly('dojo-2026-observed-interior','Dojo · photographed 2026 interior',[-.80,0,.45],-.020,
  'DJI_0010 March19 and March5 aerial register isolated square Dojo between Tool/Freeside. c50580 Feb7 explicitly captioned gong in dojo; c50720 March17 explicitly in dojo; c48391 same gong/mirrors. Details fitted to retained CAD frame, not measured survey.');
 // The reference shows dark interlocking foam covering the floor. Individual
 // tiles make the observed joins visible; exact grid count is fitted.
 const tile=.61;
 for(let ix=0;ix<12;ix++)for(let iz=0;iz<12;iz++)k.box(g,'Dojo dark interlocking foam floor tile',[tile-.004,.023,tile-.004],[(ix-5.5)*tile,.035,(iz-5.5)*tile],(ix+iz)%3?'#555858':'#505454',layers.floor);
 // CAD has side panels and overhead members but omits these end infills.
 // Preserve the high roof gap visible in both February and March interiors.
 const w=7.36,wallH=3.94,front=3.72,back=-3.67,doorX=-1.80,doorW=1.55,doorH=2.25;
 for(const [a,b] of [[-w/2,doorX-doorW/2],[doorX+doorW/2,w/2]])k.box(g,'Dojo front plywood beside rack-bay entry',[b-a,wallH,.035],[(a+b)/2,wallH/2+.03,front],'#c4aa7d',layers.wall);
 k.box(g,'Dojo plywood above entry',[doorW,wallH-doorH,.035],[doorX,doorH+(wallH-doorH)/2+.03,front],'#c4aa7d',layers.wall);
 k.box(g,'Dojo rear plywood wall',[w,wallH,.035],[0,wallH/2+.03,back],'#c4aa7d',layers.wall);
 for(const x of [doorX-doorW/2,doorX+doorW/2])k.box(g,'Dojo entry timber jamb',[.055,doorH,.075],[x,doorH/2+.03,front],'#8e795b',layers.wall);
 for(const x of [-3.68,3.68])k.box(g,'Dojo upper side plywood below narrow clerestory',[.035,.43,7.38],[x,3.755,.025],'#c4aa7d',layers.wall);
 // Tall mirrors and same gong appear together in c48391; c50720 confirms
 // reflected rack/paper-wall configuration. Positions are fitted interior
 // layout, not independently triangulated mirror coordinates.
 const mirror=k.mat('#a7b8b9',.90);
 for(const x of [1.30,2.16,3.02]){
  k.box(g,'Dojo tall leaning mirror pale frame',[.78,2.17,.055],[x,1.13,3.56],'#ded6be',layers.detail);
  k.box(g,'Dojo tall mirror glass',[.70,2.07,.018],[x,1.13,3.525],mirror,layers.detail);
 }
 const gong=new T.Mesh(new T.CircleGeometry(.30,48),k.mat('#756244',.5));gong.position.set(.06,1.63,-.20);k.tag(g,gong,'Dojo suspended gong',layers.detail);
 const boss=new T.Mesh(new T.SphereGeometry(.10,20,12),k.mat('#6d614c',.6));boss.scale.z=.4;boss.position.set(.06,1.63,-.16);k.tag(g,boss,'Dojo gong central boss',layers.detail);
 for(const r of [.25,.28,.295]){const ring=new T.Mesh(new T.TorusGeometry(r,.004,5,40),k.mat('#c4a572'));ring.position.set(.06,1.63,-.191);k.tag(g,ring,'Dojo gong concentric engraving',layers.detail);}
 for(const x of [-.15,.27])k.rod(g,'Dojo gong suspension cord',[.06,2.35,-.20],[x,1.84,-.20],.007,'#c5b391',layers.detail);
 k.rod(g,'Dojo suspended mallet shaft',[.53,2.30,-.18],[.53,1.65,-.18],.012,'#675e4c',layers.detail);
 k.box(g,'Dojo mallet padded head',[.105,.11,.09],[.53,1.65,-.18],'#343a3a',layers.detail);
 const cloth=new T.Mesh(new T.PlaneGeometry(1.4,1.2),k.mat('#e4ded1'));cloth.position.set(.18,1.70,-3.63);cloth.rotation.z=-.26;k.tag(g,cloth,'Dojo white drape on rear rack',layers.detail);cloth.userData.walkNoCollision=true;
 for(let row=0;row<3;row++)for(let col=0;col<5;col++)k.box(g,'Dojo workshop paper on rear plywood',[.28,.22,.006],[-2.2+col*.34,1.68+row*.26,-3.644],row===2?'#73a7b2':'#b45b61',layers.detail);
 const rolled=new T.Mesh(new T.CylinderGeometry(.11,.11,.65,16),k.mat('#8b9395'));rolled.rotation.z=Math.PI/2;rolled.position.set(-2.5,.15,-3.2);k.tag(g,rolled,'Dojo rolled foam mat',layers.detail);
 k.finalize();host.add(g);return [g];
}

/** Existing CAD row, not newly invented placements. Five mono-pitch huts plus
 * distinct pentapod1839 are corroborated by DJI0010 and DJI0036t60. */
export function add2026CabinDetails(root:T.Group){
 if(root.getObjectByName('CoLab huts · photographed door and roof details'))return [];
 let host:T.Object3D|undefined;root.traverse(o=>{if(o.userData.assembly_id==='site-context'&&!o.userData.component_id)host=o;});if(!host)return [];
 const ids=['wood_component-1984','wood_component-1980','wood_component-1981','wood_component-1983','wood_component-1982'];
 const k=new Kit(2026),group=k.assembly('colab-huts-2026','CoLab huts · photographed door and roof details',[0,0,0],0,
  'Existing five CAD cabin placements confirmed DJI0010/March19 and DJI0036t60/March30. c50706/c50707 show high-front doorway, rear high window, single-slope metal roof. Aperture/eave dimensions fitted; window applies only likely adjacent-pentapod cabin1980.');
 host.updateWorldMatrix(true,true);const inv=new T.Matrix4().copy(host.matrixWorld).invert();
 const huts:T.Mesh[]=[];host.traverse(o=>{if(o instanceof T.Mesh&&ids.includes(cadId(o)))huts.push(o);});
 for(const hut of huts){
  const local=new T.Matrix4().copy(inv).multiply(hut.matrixWorld),center=new T.Vector3().setFromMatrixPosition(local),yaw=cadId(hut)==='wood_component-1984'?-.78366:-.69813,frame=new T.Matrix4().compose(new T.Vector3(center.x,0,center.z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw),new T.Vector3(1,1,1));
  // Existing wedge has low roof vertices at absolute1.219m, which cannot
  // match photographed rear window/eave. Raise only that vertex ring.
  const corrected=hut.geometry.clone(),pos=corrected.getAttribute('position');for(let i=0;i<pos.count;i++)if(Math.abs(pos.getY(i))<.01)pos.setY(i,.731);corrected.computeVertexNormals();
  const intoFrame=frame.clone().invert().multiply(local);
  let geom=cutCompoundOpening(corrected,intoFrame,[-.92,-.10,.08,2.08],[-1.27,-1.17]);corrected.dispose();
  if(cadId(hut)==='wood_component-1980'){const next=cutCompoundOpening(geom,intoFrame,[-.91,-.12,1.42,1.94],[1.17,1.27]);geom.dispose();geom=next;}
  hut.geometry=geom;hut.userData.cabinEvidence='c50706/c50707; five existing placements, low eave corrected to1.95m, highfrontdoor fitted; no footprint/ID changes';
  const cabin=new T.Group();cabin.userData={...group.userData};cabin.position.set(center.x,0,center.z);cabin.rotation.y=yaw;group.add(cabin);
  // White door leaves visible in March aerials. Posed open rather than
  // blocking walkthrough; angles fitted, actual opening states variable.
  const leaf=new T.Group();leaf.userData={...group.userData};leaf.position.set(-.92,.08,-1.24);leaf.rotation.y=Math.PI/2;cabin.add(leaf);
  k.box(leaf,'CoLab cabin white door leaf',[.78,1.96,.035],[.39,.98,0],'#e3dfd1',layers.wall);
  for(const x of [-.95,-.065])k.box(cabin,'CoLab cabin door timber jamb',[.055,2.04,.06],[x,1.10,-1.243],'#a88e61',layers.wall);
  k.box(cabin,'CoLab cabin door timber header',[.94,.055,.06],[-.51,2.105,-1.243],'#a88e61',layers.wall);
  if(cadId(hut)==='wood_component-1980'){
   const roof=k.box(cabin,'Photographed hut corrugated metal roof',[2.55,.025,2.56],[0,2.208,0],'#8e9ba0',layers.roof);roof.rotation.x=.198;
   for(const x of [-.93,-.10])k.box(cabin,'Photographed hut high rear window jamb',[.035,.55,.05],[x,1.68,1.23],'#a88e61',layers.wall);
  }
 }
 k.finalize();host.add(group);return [group];
}

/** March22 source c48576: kitchen glazing exists in both rear corners and the
 * wash end; central rear plywood carries pans. Unlike Jan15 construction source,
 * these are complete apertures/glazing, not open rack bays. Dimensions fitted. */
export function add2026CompletedKitchen(root:T.Group){
 const prior=root.getObjectByName('Freeside · completed kitchen enclosure');if(prior)return [prior];
 let host:T.Object3D|undefined;root.traverse(o=>{if(o.userData.assembly_id==='northeast-compound'&&!o.userData.component_id)host=o;});if(!host)return [];
 host.updateWorldMatrix(true,true);
 const frame=new T.Matrix4().compose(new T.Vector3(-.1,0,-4.2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-.324),new T.Vector3(1,1,1));
 const into=frame.clone().invert().multiply(host.matrixWorld.clone().invert());
 const rear:[number,number,number,number][]=[[-4.55,-1.85,1.12,2.32],[1.60,4.50,1.12,2.32]];
 host.traverse(o=>{if(!(o instanceof T.Mesh)||o.userData.completedKitchenEnclosure)return;
  if(cadId(o)==='wood_component-1469'){
   const matrix=into.clone().multiply(o.matrixWorld);let geom=o.geometry.clone();
   for(const rect of rear){const next=cutCompoundOpening(geom,matrix,rect);geom.dispose();geom=next;}o.geometry=geom;o.userData.completedKitchenEnclosure=true;o.userData.apertureEvidence='c48576 March22 rear corner glazing, central plywood/pans retained; fitted bounds';
  }
  if(cadId(o)==='wood_component-1468'){
   const swap=new T.Matrix4().set(0,0,1,0,0,1,0,0,1,0,0,0,0,0,0,1);
   o.geometry=cutCompoundOpening(o.geometry,swap.multiply(into.clone()).multiply(o.matrixWorld),[-1.40,1.40,1.12,2.32]);o.userData.completedKitchenEnclosure=true;o.userData.apertureEvidence='c48576 March22 broad wash-end glazing; fitted bounds';
  }
 });
 const k=new Kit(2026),g=k.assembly('freeside-2026-completed-enclosure','Freeside · completed kitchen enclosure',[-.1,0,-4.2],-.324,'c48576 PXL20260322: rear corner and wash-end glazing, hanging pans/string lights; c47857 March26 paired doors. Fitted aperture sizes/placement, complete occupied phase.');
 const glass=k.mat('#a5c0bd',.12);glass.transparent=true;glass.opacity=.25;
 for(const [a,b,lo,hi] of rear){
  k.box(g,'Freeside completed rear window glass',[b-a,hi-lo,.012],[(a+b)/2,(lo+hi)/2,-1.825],glass,layers.wall);
  for(const x of [a,(a+b)/2,b])k.box(g,'Freeside rear window timber mullion',[.045,hi-lo+.07,.065],[x,(lo+hi)/2,-1.825],'#b69c72',layers.wall);
  for(const y of [lo,hi])k.box(g,'Freeside rear window sill header',[b-a+.07,.045,.065],[(a+b)/2,y,-1.825],'#b69c72',layers.wall);
 }
 k.box(g,'Freeside completed wash-end window',[.012,1.2,2.8],[-4.876,1.72,0],glass,layers.wall);
 for(const z of [-1.4,0,1.4])k.box(g,'Freeside wash-end window mullion',[.065,1.27,.045],[-4.876,1.72,z],'#dddccf',layers.wall);
 for(const y of [1.12,2.32])k.box(g,'Freeside wash-end window sill header',[.065,.045,2.87],[-4.876,y,0],'#dddccf',layers.wall);
 // Actual photo shows mixed pans and sieve on the central plywood, not a
 // continuous transparent wall. Simple shared cylinders retain performance.
 for(const [x,r] of [[-1.48,.15],[-.82,.22],[-.20,.20],[.60,.19],[1.18,.21]] as [number,number][]){
  const pan=new T.Mesh(new T.CylinderGeometry(r,r,.04,16),k.mat(x<0?'#757d7d':'#303635',.5));pan.rotation.x=Math.PI/2;pan.position.set(x,1.98,-1.74);k.tag(g,pan,'Freeside photographed hanging pan',layers.detail);
  k.box(g,'Freeside hanging pan handle',[.045,.27,.04],[x,2.24,-1.74],'#424b48',layers.detail);
 }
 // c47857 March26: tan/yellow reused paired doors; opening angles fitted.
 for(const [x,angle,color] of [[2.24,-1.3,'#ad9475'],[4.34,1.3,'#d5ad35']] as [number,number,string][]){
  const leaf=new T.Group();leaf.userData={...g.userData};leaf.position.set(x,.04,1.78);leaf.rotation.y=angle;g.add(leaf);const sign=x<3?1:-1;
  k.box(leaf,'Freeside reused entry door lower panel',[1.02,1.12,.045],[sign*.51,.56,0],color,layers.wall);
  for(const xx of [sign*.035,sign*.985])k.box(leaf,'Freeside reused door upper stile',[.07,.97,.045],[xx,1.61,0],color,layers.wall);
  k.box(leaf,'Freeside reused entry door upper rail',[1.02,.08,.045],[sign*.51,2.065,0],color,layers.wall);
  const paint=typeof document==='undefined'?null:new T.TextureLoader().load(x<3?'/history/2026/completion/tan-door-paint.webp':'/history/2026/completion/yellow-door-paint.webp');if(paint)paint.colorSpace=T.SRGBColorSpace;
  const panelMat=new T.MeshStandardMaterial({map:paint,roughness:.94});
  k.box(leaf,'Freeside reused entry door painted upper panel',[.88,.84,.015],[sign*.51,1.59,0],panelMat,layers.wall);
  k.box(leaf,'Freeside entry door handle',[.035,.18,.065],[sign*.89,1.02,.04],'#554e3c',layers.detail);
 }
 k.finalize();host.add(g);return [g];
}
