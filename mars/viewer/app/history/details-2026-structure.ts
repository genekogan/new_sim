import * as T from 'three';
import {Kit,layers} from './kit';
import {cutCompoundOpening} from './details-2026-compound';

/** Restore photographed roof load path missing from the recovered CAD.
 * c24 exposes orange rack beams and standing timber joists before sheathing.
 * Endpoints follow existing CAD posts; section sizes and joist spacing are fits.
 */
export function add2026RoofStructure(root:T.Group){
 const chiba=root.getObjectByName('Chiba');
 if(!chiba || chiba.getObjectByName('Chiba · roof beams and joists'))return;
 root.updateMatrixWorld(true);
 const inv=chiba.matrixWorld.clone().invert(),u=new T.Vector3(.9045,0,.4265).normalize(),v=new T.Vector3(.4265,0,-.9045).normalize();
 const origin=new T.Vector3(168.52125-177,0,-(57.075-66));
 const posts:{id:string;p:T.Vector3;u:number;v:number;top:number}[]=[];
 chiba.traverse(o=>{
  if(o.userData.kind!=='rack_member')return;
  const b=new T.Box3().setFromObject(o),size=b.getSize(new T.Vector3());
  if(size.y<5.5||size.x>.2||size.z>.2||Math.abs(b.max.y-5.97914)>.02)return;
  const p=b.getCenter(new T.Vector3()).applyMatrix4(inv),q=p.clone().sub(origin);
  posts.push({id:o.userData.component_id,p,u:q.dot(u),v:q.dot(v),top:b.max.y});
 });
 if(posts.length<30)return; // Do not invent a frame when the expected CAD is absent.
 const k=new Kit(2026),g=k.assembly('chiba-roof-supports','Chiba · roof beams and joists',[0,0,0],0,
  'c24 build photograph: orange transverse rack beams and timber roof joists; March23 DJI0029 intact roof. CAD post endpoints retained; cross-sections/spacing fitted, not stock certification');
 const strips:number[]=[];
 for(const p of posts.sort((a,b)=>a.u-b.u))if(!strips.some(x=>Math.abs(x-p.u)<.25))strips.push(p.u);
 for(const strip of strips){
  const row=posts.filter(p=>Math.abs(p.u-strip)<.25).sort((a,b)=>a.v-b.v);
  for(let i=1;i<row.length;i++){
   const a=row[i-1],b=row[i],d=b.p.clone().sub(a.p),length=Math.hypot(d.x,d.z);
   if(length<3||length>4.1)continue;
   const center=a.p.clone().add(b.p).multiplyScalar(.5);center.y=Math.min(a.top,b.top)-.0625;
   const beam=k.box(g,'observed roof orange rack beam',[.09,.125,length],[center.x,center.y,center.z],'#a94a29',layers.steel);
   beam.rotation.y=Math.atan2(d.x,d.z);beam.userData.support_post_ids=[a.id,b.id];
  }
 }
 const minU=Math.min(...posts.map(p=>p.u)),maxU=Math.max(...posts.map(p=>p.u));
 const minV=Math.min(...posts.map(p=>p.v)),maxV=Math.max(...posts.map(p=>p.v));
 const depth=6.162167-5.979141;
 for(let vv=minV+.10;vv<maxV;vv+=.61){
  const center=origin.clone().addScaledVector(u,(minU+maxU)/2).addScaledVector(v,vv);center.y=5.979141+depth/2;
  const joist=k.box(g,'observed standing timber roof joist',[maxU-minU,.183026,.045],[center.x,center.y,center.z],'#b59b71',layers.roof);
  joist.rotation.y=-Math.atan2(u.z,u.x);
  joist.userData.accuracy='Depth closes existing CAD roof/post gap; .61m spacing and .045m width are nominal fits to c24, not measured.';
  // The eastern CAD sheets are one thin sheet higher; short packing boards close that gap.
  const start=9.72;
  if(maxU>start){const p=origin.clone().addScaledVector(u,(start+maxU)/2).addScaledVector(v,vv);p.y=6.17679;
   const packing=k.box(g,'roof sheet packing strip',[maxU-start,.02925,.045],[p.x,p.y,p.z],'#b59b71',layers.roof);packing.rotation.y=joist.rotation.y;
   packing.userData.accuracy='Packing is an inferred contact repair for the second CAD sheet course, not an observed fastening detail.';
  }
 }
 k.finalize();chiba.add(g);return g;
}

/** Gene's September30 correction: blue upright frames, orange span beams.
 * Frame ties remain blue; classify the long horizontal rack spans separately.
 * Preserve every original geometry/transform/ID and isolate shared materials.
 */
export function correct2026RackFinish(root:T.Group){
 root.updateMatrixWorld(true);
 const colors={blue:new T.MeshStandardMaterial({color:'#237ba5',roughness:.72,metalness:.20}),orange:new T.MeshStandardMaterial({color:'#c35b2d',roughness:.72,metalness:.20})};
 let count=0;
 root.traverse(o=>{
  if(o.userData.kind!=='rack_member'||o.userData.rackFinish20260930)return;
  const size=new T.Box3().setFromObject(o).getSize(new T.Vector3());
  const beam=size.y<.22&&Math.hypot(size.x,size.z)>2;
  o.traverse(child=>{const mesh=child as T.Mesh;if(mesh.isMesh)mesh.material=beam?colors.orange:colors.blue;});
  o.userData.rackFinish20260930=beam?'orange span beam':'blue upright frame and ties';
  o.userData.finishEvidence='Gene Sep30 firsthand correction; c6695 DJI0016 confirms blue frames/orange horizontal spans. Color values fitted, no metric geometry change.';
  count++;
 });
 return count;
}

/** Open the retained intermediate deck over the lower west stair flight.
 * c6695/c6701 show a clear stairwell between the existing stringers; the CAD
 * deck currently crosses that flight. Clip only this deck in its rack frame.
 */
export function correct2026WestStairOpening(root:T.Group){
 let deck:T.Object3D|undefined;
 root.traverse(o=>{if(o.userData.component_id==='wood_component-0014')deck=o;});
 if(!deck||deck.userData.westStairOpening20260930)return false;
 root.updateMatrixWorld(true);
 // Rack-plane axes from the retained CAD. Aperture follows the two original
 // lower-flight stringers wood1908/1909, preserving the adjoining landing.
 const frame=new T.Matrix4().set(.9045,0,.4265,0,.4265,0,-.9045,0,0,1,0,0,0,0,0,1);
 deck.traverse(o=>{const mesh=o as T.Mesh;if(mesh.isMesh)mesh.geometry=cutCompoundOpening(mesh.geometry,frame.clone().multiply(mesh.matrixWorld),[-2.42,-1.48,.01,2.78]);});
 deck.userData.westStairOpening20260930=true;
 deck.userData.apertureEvidence='c6695 DJI0016/c6701 DJI0015 and Gene Sep30: open lower stair flight through intermediate deck. Bounds follow CAD stringers1908/1909, adjoining landing retained; aperture tolerance fitted.';
 return true;
}

/** Smaller west canopy: connect each retained upright to the actual underside
 * of roof0017, rather than assuming the main hall's horizontal roof elevation. */
export function add2026WestCanopyContact(root:T.Group){
 const host=root.getObjectByName('Chiba');if(!host||host.getObjectByName('Chiba · west canopy contact'))return;
 let roof:T.Object3D|undefined;host.traverse(o=>{if(o.userData.component_id==='wood_component-0017')roof=o;});if(!roof)return;
 root.updateMatrixWorld(true);const k=new Kit(2026),g=k.assembly('west-canopy-contact','Chiba · west canopy contact',[0,0,0],0,'c6695/c6701 canopy roof and Gene floating-roof correction; retained post centers/roof underside, timber blocking section fitted.');
 const inv=host.matrixWorld.clone().invert(),ray=new T.Raycaster();
 host.traverse(o=>{if(o.userData.kind!=='rack_member')return;const b=new T.Box3().setFromObject(o),s=b.getSize(new T.Vector3());if(s.y<2.5||s.x>.20||s.z>.20)return;const p=b.getCenter(new T.Vector3());ray.set(new T.Vector3(p.x,b.max.y+1,p.z),new T.Vector3(0,-1,0));ray.far=1;
  const hits=ray.intersectObject(roof!,true).filter(h=>h.point.y>b.max.y+.035);if(!hits.length)return;const y=Math.min(...hits.map(h=>h.point.y)),height=y-b.max.y;if(height>.6)return;
  const center=new T.Vector3(p.x,(y+b.max.y)/2,p.z).applyMatrix4(inv);const block=k.box(g,'West canopy timber upright roof contact',[.09,height,.09],center.toArray() as [number,number,number],'#bda173',layers.roof);block.userData.support_post_id=o.userData.component_id;block.userData.roof_component_id='wood_component-0017';
 });
 k.finalize();host.add(g);return g;
}

/** c6695/c6701: short blue-topped approach below the long west flight and
 * timber transfer onto the main roof. Existing recovered treads are retained;
 * only the missing approach/arrival gaps are filled. Dimensions fitted. */
export function add2026WestStairTransfers(root:T.Group){
 if(root.getObjectByName('Chiba · west stair approach and roof transfer'))return;
 const k=new Kit(2026),g=k.assembly('west-stair-source-transfers','Chiba · west stair approach and roof transfer',[0,0,0],0,'c6695/c6701: blue-topped low approach porch and timber roof threshold; actual recovered tread/roof datums, fitted section sizes.');
 const yaw=-Math.atan2(.4265,.9045),up=new T.Vector3(-.4265,0,.9045).normalize(),first=new T.Vector3(-.72694,.725,-3.02763);
 const porch=first.clone().addScaledVector(up,-.36);porch.y=.695;
 const deck=k.box(g,'West stair source blue approach porch',[1.50,.06,.85],porch.toArray() as [number,number,number],'#3473a6',layers.floor);deck.rotation.y=yaw;
 for(const side of [-.64,.64])for(const along of [-.33,.33]){const p=porch.clone().add(new T.Vector3(side,0,along).applyAxisAngle(new T.Vector3(0,1,0),yaw));p.y=.2525;k.box(g,'West approach porch grounded timber leg',[.07,.825,.07],p.toArray() as [number,number,number],'#9c8462',layers.floor);}
 for(let i=0;i<3;i++){const height=.505-i*.22,p=porch.clone().addScaledVector(up,-(.56+i*.28));p.y=height-.025;const tread=k.box(g,'West approach short grounded tread',[1.12,.05,.30],p.toArray() as [number,number,number],i===0?'#3473a6':'#a88f6c',layers.floor);tread.rotation.y=yaw;for(const side of [-.48,.48]){const leg=p.clone().add(new T.Vector3(side,0,0).applyAxisAngle(new T.Vector3(0,1,0),yaw));leg.y=(height-.05-.16)/2;k.box(g,'West approach step grounded leg',[.065,height+.11,.065],leg.toArray() as [number,number,number],'#947d5f',layers.floor);}}
 // Existing0820 arrival top6.11893 -> actual0563 roof6.19144. The short
 // wooden threshold overlaps each receiver; no large invented platform.
 k.box(g,'West stair roof timber transfer threshold',[.70,.0725,.90],[-2.72,6.15519,-1.05],'#b99d75',layers.floor);
 k.finalize();root.add(g);return g;
}
