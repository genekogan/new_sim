import * as T from 'three';
import {componentMeshes} from './cad-components';
import {Kit,layers} from './kit';
import {gallery2026Mounts} from './gallery-2026-anchors';
import {photoTexture} from './archive-photos';

export const AUDITORIUM_2026_SOURCES=[33334,33350,33355,33354];
/** Source-backed portable auditorium arrangement. Tier geometry and screen
 * wood1985 remain imported CAD. No fixed theatre-chair rows are invented. */
export function add2026AuditoriumDetails(root:T.Group){
 // Donor lower-room baked glowing-screen monitors duplicated the runtime
 // receiver-mounted LCDs. Their owner IDs and editable records are retained.
 for(const id of ['2293','2321','2323','2325']){const o=componentMeshes(root,'cad_component-'+id).owner;if(o){o.visible=false;o.userData.walkNoCollision=true;o.userData.sourceCorrection='Source-mounted runtime LCD replaces duplicate donor Glowing Screen Test display';}}
 const prior=root.getObjectByName('Chiba auditorium · photographed furnishings');if(prior)return [prior];
 const host=root.getObjectByName('Chiba');if(!host)return [];
 // c33350 shows a broad pale projection wall, not the narrow portrait
 // screen baked into a later CAD display proxy. Retain both stable IDs.
 for(const id of ['cad_component-2244','wood_component-1985']){
  const {owner,meshes}=componentMeshes(host,id);if(!owner)continue;
  if(id==='cad_component-2244'){owner.visible=false;owner.userData.walkNoCollision=true;}
  else for(const mesh of meshes){
   mesh.material=new T.MeshStandardMaterial({color:'#e6dfd0',roughness:.95,side:T.DoubleSide});
   // The CAD display proxy floated above the deck and stopped below the roof.
   // c1041 exposes full plywood backing; Gene confirms a whole partition.
   mesh.updateWorldMatrix(true,false);const geometry=mesh.geometry.clone(),position=geometry.getAttribute('position'),inverse=mesh.matrixWorld.clone().invert(),point=new T.Vector3();
   const bounds=new T.Box3().setFromObject(mesh),lo=bounds.min.y,hi=bounds.max.y;
   for(let i=0;i<position.count;i++){point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);point.y=.37+(point.y-lo)/(hi-lo)*(5.98-.37);point.applyMatrix4(inverse);position.setXYZ(i,point.x,point.y,point.z);}
   geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;
  }
  owner.userData.reviewSource='c1041/c33350 and Gene firsthand: full plywood projection partition, original CAD wall retained';
 }
 host.updateWorldMatrix(true,true);
 const k=new Kit(2026),g=k.assembly('auditorium-2026-furnishings','Chiba auditorium · photographed furnishings',[-8.47875,0,8.925],-Math.atan2(.4265,.9045),
  '2026 c33334/c33350/c33355 finals/ThunderTalk photographs: portable folding chairs and cushions on bare tiers, adjacent navy sofas, cream-purple projector tablecloth, covered front equipment, warm globe strings. Positions fitted to retained CAD tiers/screen; not exact event census.');
 g.updateMatrix();const world=host.matrixWorld.clone().multiply(g.matrix);
 // c1041 records the reverse plywood face with exposed horizontal battens;
 // front remains the pale full projection surface. Separate faces preserve
 // the original thin partition ID and its fitted deck-to-roof height.
 k.box(g,'Chiba projection partition reverse plywood',[.020,5.61,3.658],[12.867,3.175,-5.6945],'#b79d75',layers.wall);
 for(const y of [.70,1.72,2.74,3.76,4.78,5.80])k.box(g,'Chiba projection reverse horizontal timber batten',[.045,.070,3.658],[12.900,y,-5.6945],'#ae8f62',layers.detail);
 for(const z of [-5.10,-6.30])k.box(g,'Chiba projection reverse plywood panel seam',[.003,5.60,.007],[12.879,3.175,z],'#8d7351',layers.detail);
 // (u,v) is the measured rack plane; group z reverses v for right-handed Y-up.
 const support=(u:number,v:number,ceiling:number)=>{
  const origin=new T.Vector3(u,ceiling,-v).applyMatrix4(world),ray=new T.Raycaster(origin,new T.Vector3(0,-1,0),0,ceiling+.2);
  for(const h of ray.intersectObject(host,true))if(h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.8)return h.point.y;
  return undefined;
 };
 const box=(name:string,size:[number,number,number],p:[number,number,number],color:string|T.Material)=>k.box(g,name,size,[p[0],p[1],-p[2]],color,layers.detail);
 const chair=(u:number,v:number,top:number)=>{const y=support(u,v,top);if(y===undefined)return;
  box('auditorium loose black folding chair seat',[.43,.045,.46],[u,y+.43,v],'#333a3c');
  box('auditorium folding chair back',[.045,.38,.46],[u-.22,y+.66,v],'#333a3c');
  for(const vv of [v-.19,v+.19])for(const direction of [-1,1])k.rod(g,'auditorium folding chair crossed steel leg',[u-.21*direction,y,-vv],[u+.18*direction,y+.44,-vv],.013,'#565d5b',layers.detail);
 };
 // Deep tiers admit loose folding chairs; keep their leading edges and
 // adjacent gallery aisles clear. Coordinates sit inside individual treads.
 chair(4.0,4.65,3.1);chair(6.9,6.6,2.05);chair(8.05,4.65,1.55);
 for(const [u,v,c] of [[9.95,6.25,'#b9ada1'],[8.94,5.1,'#819c9e'],[7.92,6.75,'#c7b6a3'],[5.89,5.7,'#9b8464']] as const){const y=support(u,v,3.1);if(y===undefined)continue;const m=new T.Mesh(new T.SphereGeometry(1,12,8),k.mat(c));m.scale.set(.30,.09,.23);m.position.set(u,y+.09,-v);k.tag(g,m,'auditorium loose tier cushion',layers.detail);}
 // c33355: soft seating occupies adjacent level-floor gallery bay, not a
 // replacement of the tier structure. Two observed navy couch forms.
 for(const u of [5.65,8.0]){const v=9.2,y=support(u,v,.65);if(y===undefined)continue;
  for(const uu of [u-.32,u+.32])for(const vv of [v-.78,v+.78])box('auditorium sofa short foot',[.08,.095,.08],[uu,y+.0475,vv],'#373c36');
  box('auditorium adjacent navy sofa base',[.86,.27,1.9],[u,y+.23,v],'#343f45');
  box('auditorium adjacent navy sofa back',[.19,.58,1.9],[u-.40,y+.59,v],'#343f45');
  for(const vv of [v-.87,v+.87])box('auditorium navy sofa arm',[.90,.36,.16],[u,y+.49,vv],'#343f45');
  box('auditorium sofa pale throw cushion',[.29,.16,.40],[u-.14,y+.48,v+.48],'#bbb5a2');
 }
 const tableU=11.48,tableV=5.72,floor=support(tableU,tableV,.7);
 if(floor!==undefined){
  box('auditorium projector table top',[.72,.045,1.16],[tableU,floor+.73,tableV],'#b9a78b');
  for(const u of [tableU-.30,tableU+.30])for(const v of [tableV-.50,tableV+.50])box('auditorium projector table slender leg',[.025,.70,.025],[u,floor+.35,v],'#3d4542');
  box('auditorium cream tablecloth top',[.74,.012,1.18],[tableU,floor+.76,tableV],'#d1bda4');
  box('auditorium cream cloth audience drape',[.012,.46,1.18],[tableU-.373,floor+.53,tableV],'#d1bda4');
  box('auditorium purple table runner',[.75,.014,.35],[tableU,floor+.775,tableV],'#5f5878');
  box('auditorium purple runner drape',[.014,.40,.35],[tableU-.382,floor+.565,tableV],'#5f5878');
  box('auditorium white projector',[.32,.115,.28],[tableU+.10,floor+.845,tableV+.24],'#d6d6ca');
  const lens=new T.Mesh(new T.CylinderGeometry(.042,.042,.035,16),k.mat('#303e43'));lens.rotation.z=Math.PI/2;lens.position.set(tableU+.28,floor+.85,-tableV-.24);k.tag(g,lens,'auditorium projector lens facing existing screen',layers.detail);
  box('auditorium presenter laptop base',[.25,.017,.32],[tableU-.12,floor+.79,tableV-.30],'#39494f');
  const laptop=box('auditorium presenter laptop display',[.015,.19,.32],[tableU+.005,floor+.88,tableV-.30],'#30444d');laptop.rotation.z=-.15;
  // c33350 presenter uses a short timber box next to table, not a lectern.
  box('auditorium presenter timber box seat',[.50,.41,.46],[11.35,floor+.205,4.76],'#bba37c');
 }
 // c33334/c33355 bulky front item covered with pale patterned cloth. Do
 // not claim hidden object identity; keep outside center presentation line.
 const coverY=support(11.8,7.08,.7);if(coverY!==undefined){box('auditorium cloth-covered front equipment',[.71,.87,.72],[11.8,coverY+.435,7.08],'#ccc7bb');}
 // Warm bulbs seen around perimeter and under gallery tiers. Emissive mesh
 // only, no per-bulb point lights or expensive shadows.
 const warm=new T.MeshStandardMaterial({color:'#f1ddae',emissive:'#e0ac54',emissiveIntensity:.6});
 for(const v of [3.90,7.45])for(let i=0;i<9;i++){
  const u=3.5+i*1.05,y=3.11-.08*Math.sin(i*Math.PI/8);const bulb=new T.Mesh(new T.SphereGeometry(.043,8,6),warm);bulb.position.set(u,y,-v);k.tag(g,bulb,'auditorium warm string globe',layers.detail);bulb.userData.walkNoCollision=true;
  if(i)k.rod(g,'auditorium string light cable',[u-1.05,3.15-.08*Math.sin((i-1)*Math.PI/8),-v],[u,y+.04,-v],.004,'#3d4037',layers.detail);
 }
 // c1050/c33355: individual pale gallery mounting panels with small screens
 // line the adjacent outer wall. Display imagery is deliberately not invented.
 for(const [i,u] of [3.45,5.02,6.59,8.16,9.73,11.30].entries()){
  box('auditorium gallery pale backing panel',[1.38,1.02,.032],[u,1.73,11.595],'#d2c8b7');
  box('auditorium gallery small screen bezel',[.49,.32,.035],[u,1.78,11.56],'#262e32');
  box('auditorium gallery screen surface',[.445,.272,.012],[u,1.78,11.534],'#496470');
  const source=new T.Mesh(new T.PlaneGeometry(1.30,.94),k.mat('#d2c8b7'));source.position.set(u,1.73,-11.572);k.tag(g,source,'Chiba gallery native c80 installation panel '+i,layers.detail);source.userData.walkNoCollision=true;source.userData.source='c80 native installation crop; perspective retained. Panel order representative, not all exhibits claimed at identical date.';
  const hood=box('auditorium gallery angled panel hood',[1.43,.055,.25],[u,2.285,11.49],'#c9bda6');hood.rotation.x=.25;
 }
 // The recognizable upper-gallery portrait uses source pixels from c33334,
 // not a synthetic imitation. Crop retains photographed perspective.
 const art=new T.MeshBasicMaterial({map:photoTexture('/history/2026/auditorium-source-portrait.webp'),side:T.DoubleSide});art.name='2026 auditorium source portrait c33334';art.map!.colorSpace=T.SRGBColorSpace;
 const portrait=new T.Mesh(new T.PlaneGeometry(.80,1.10),art);portrait.position.set(8.0,3.85,-.20);k.tag(g,portrait,'auditorium upper gallery source portrait',layers.detail);portrait.userData.walkNoCollision=true;
 g.userData.accuracy='All furniture supported on actual CAD surfaces. Portable counts/layout fitted to multiple2026 photographs, not a single exact event; screen content not reconstructed.';
 for(let i=0;i<6;i++)for(const x of [-.38,.38])box('auditorium gallery source stand-off mount bracket',[.035,.055,.10],[i+x,0,0],'#66675d');
 k.finalize();host.add(g);root.updateWorldMatrix(true,true);
 const mounts=gallery2026Mounts(root),inv=g.matrixWorld.clone().invert();
 for(const kind of ['auditorium gallery pale backing panel','auditorium gallery small screen bezel','auditorium gallery screen surface']){
  const parts=g.children.filter(o=>o.userData.kind===kind);
  parts.forEach((o,i)=>{const a=mounts[i];if(!a){o.visible=false;o.userData.missingReceiver=true;return;}const m=o as T.Mesh;
   m.geometry=new T.BoxGeometry(...(kind==='auditorium gallery pale backing panel'?[1.38,1.02,.035]:kind==='auditorium gallery small screen bezel'?[.53,.36,.055]:[.445,.272,.008]) as [number,number,number]);
   const offset=a.standOff+(kind==='auditorium gallery pale backing panel'?.020:kind==='auditorium gallery small screen bezel'?.070:.102);
   o.position.copy(a.point.clone().addScaledVector(a.normal,offset).applyMatrix4(inv));o.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),a.normal.clone().transformDirection(inv));o.userData.receiverId=a.receiverId;o.userData.receiverMounted20261001=true;o.userData.measuredRackStandOff=a.standOff;
  });
 }
 const brackets=g.children.filter(o=>o.userData.kind==='auditorium gallery source stand-off mount bracket');brackets.forEach((o,j)=>{const a=mounts[Math.floor(j/2)];if(!a){o.visible=false;return;}const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),a.normal),side=new T.Vector3(j%2?.38:-.38,0,0).applyQuaternion(q),depth=a.standOff+.002;(o as T.Mesh).geometry=new T.BoxGeometry(.035,.055,Math.max(.002,depth));o.position.copy(a.point.clone().add(side).addScaledVector(a.normal,depth/2).applyMatrix4(inv));o.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),a.normal.clone().transformDirection(inv));o.userData.receiverId=a.receiverId;});
 for(const o of g.children)if(/Chiba gallery native c80 installation panel|auditorium gallery angled panel hood/.test(o.userData.kind??'')){o.visible=false;o.userData.walkNoCollision=true;o.userData.sourceCorrection='Gene Oct1 actual small LCDs on plain mounted wood pads; whole room-photo/monitor duplicates hidden, IDs retained';}
 // Gene Oct1: native painted wall belongs across the upper room. These
 // person/monitor-free source patches are on retained wood, not display pads.
 const opposite=gallery2026Mounts(root,true);
 const proxies=g.children.filter(o=>/Chiba gallery native c80 installation panel/.test(o.userData.kind??''));
 for(const [i,o] of proxies.slice(0,2).entries()){
  const a=opposite[i+1];if(!a)continue;const m=o as T.Mesh;
  m.geometry=new T.PlaneGeometry(i===0?1.30:1.30,i===0?1.10:1.70);
  m.material=k.photo(i===0?'/history/2026/accuracy/upper-native-black-paint.webp':'/history/2026/accuracy/upper-native-green-paint.webp');
  o.position.copy(a.point.clone().addScaledVector(a.normal,.004).applyMatrix4(inv));
  o.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),a.normal.clone().transformDirection(inv));
  o.visible=true;o.userData.receiverId=a.receiverId;o.userData.nativeUpperOppositePaint=true;
  o.userData.sourceCorrection='c80 painting-only native crop, opposite upper room per Gene Oct1; cropped perspective/extent fitted, not whole-room display texture';
 }
 return [g];
}
