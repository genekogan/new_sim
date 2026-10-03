import * as T from 'three';
import {Kit,layers} from './kit';
import {componentMeshes} from './cad-components';
import {GROUND} from '../studio/ambience-math';
/** Native c49195/c49457 furniture forms, fitted portable placement. */
export function add2026GroundLife(root:T.Group){
 if(root.getObjectByName('Chiba field · photographed seating'))return;
 const k=new Kit(2026),g=k.assembly('chiba-field-seating','Chiba field · photographed seating',[2.05645,GROUND,-8.92635],-Math.atan2(.4265,.9045)+Math.PI/2,'c49195: gray beanbag, log armchairs, red/dark household chairs, teal sofa between Chiba and trailers. Portable positions fitted to west courtyard; not surveyed/event census.');
 const chiba=root.getObjectByName('Chiba');if(!chiba)return;chiba.add(g);
 const chair=(x:number,z:number,yaw:number,color:string,log=false)=>{
  const a=k.assembly('field-chair-'+x,'Field source chair',[x,0,z],yaw,'c49195 mismatched chair forms');g.add(a);
  k.box(a,'field chair seat',[.48,.07,.47],[0,.43,0],color,layers.detail);
  for(const xx of [-.20,.20])for(const zz of [-.18,.18])k.rod(a,'field chair grounded leg',[xx,.02,zz],[xx,.44,zz],log?.043:.017,log?'#a18763':'#474f49',layers.detail);
  for(const xx of [-.21,.21])k.rod(a,'field chair back upright',[xx,.38,-.19],[xx,.95,-.25],log?.042:.017,color,layers.detail);
  for(const y of [.64,.80,.94])k.box(a,'field chair back slat',[.45,.06,.04],[0,y,-.235],color,layers.detail);
  if(log)for(const xx of [-.30,.30]){k.rod(a,'field log chair arm',[xx,.64,-.25],[xx,.64,.32],.046,'#b79c74',layers.detail);k.rod(a,'field log chair front arm support',[xx,.02,.23],[xx,.64,.23],.04,'#a78c68',layers.detail);}
 };
 chair(-2.6,-8.0,.40,'#9c4e3c');chair(-.65,-8.5,-.50,'#383e39');chair(2.2,-8.3,-.65,'#b89d74',true);chair(-3.2,-6.4,1.0,'#b89d74',true);
 const bag=new T.Mesh(new T.SphereGeometry(1,16,10),k.mat('#817e78'));bag.scale.set(.83,.44,.77);bag.position.set(.2,.35,-7.6);k.tag(g,bag,'field gray large beanbag chair',layers.detail);
 const sofa=k.assembly('field-teal-sofa','Field teal source sofa',[3.8,0,-8.6],-.25,'c49195 teal upholstered couch');g.add(sofa);k.box(sofa,'field teal sofa base',[1.96,.30,.85],[0,.24,0],'#337b7b',layers.detail);k.box(sofa,'field teal sofa back',[1.96,.62,.17],[0,.65,-.38],'#397f7d',layers.detail);for(const x of [-.89,.89])k.box(sofa,'field teal sofa arm',[.18,.39,.88],[x,.50,0],'#347471',layers.detail);
 const fire=new T.Mesh(new T.CylinderGeometry(.42,.42,.52,16,1,true),k.mat('#353936'));fire.material=fire.material.clone();(fire.material as T.Material).side=T.DoubleSide;fire.position.set(-1.7,.42,-7.1);k.tag(g,fire,'field observed black fire bowl',layers.detail);
 for(const x of [-1.98,-1.42])k.rod(g,'field fire bowl grounded stand',[x,.02,-7.1],[x,.30,-7.1],.025,'#3d403a',layers.detail);
 // Source color/form audit preserves detailed CAD shells, ribs and roofs.
 // Both retained banks use the same portable-toilet donor and fitted location.
 const body=['2159','2203','2242','2281','2285','2289'];
 for(const n of body){const {owner,meshes}=componentMeshes(root,'cad_component-'+n);for(const m of meshes)m.material=new T.MeshStandardMaterial({color:'#e4b963',roughness:.83,side:T.DoubleSide});if(owner)owner.userData.reviewSource='c49192 pale-yellow molded/ribbed portable toilet bodies; original shell geometry retained';}
 // c49192 has rounded-top molded doors, not donor diagonal embossing.
 root.updateWorldMatrix(true,true);
 // Complete donor units: base, shell, cap, interior and separate door.
 // Settle whole units rigidly rather than inventing tall ground plinths.
 const toiletUnits=[['2148','2159','2170','2181','3556'],['2192','2203','2214','2225','3557'],['2233','2242','2245','2246','3558'],['2280','2281','2282','2283','3559'],['2284','2285','2286','2287','3560'],['2288','2289','2290','2291','3561']];
 for(const ids of toiletUnits){const base=componentMeshes(root,'cad_component-'+ids[0]).owner;if(!base)continue;const dy=GROUND-new T.Box3().setFromObject(base).min.y;for(const id of ids){const o=componentMeshes(root,'cad_component-'+id).owner;if(o){o.position.y+=dy;o.userData.toiletGroundSettlement=dy;}}const oldDoor=componentMeshes(root,'cad_component-'+ids[4]).owner;if(oldDoor){oldDoor.visible=false;oldDoor.userData.walkNoCollision=true;oldDoor.userData.sourceCorrection='c49192 molded arched closed-door form replaces donor angular embossing; original ID retained';}}
 root.updateWorldMatrix(true,true);
 const toiletSet=k.assembly('source-toilet-fronts','Portable toilets · native arched fronts',[0,0,0],0,'c49192 arched inset door, native sign, pale molded front and black ground plinth; dimensions fitted to retained shells');root.add(toiletSet);
 for(const [i,n] of body.entries()){
  const {owner,meshes}=componentMeshes(root,'cad_component-'+n);if(!owner)continue;
  const normal=new T.Vector3(...(i<3?[-.839,0,.544]:[-.995,0,-.098]) as [number,number,number]).normalize(),b=new T.Box3().setFromObject(owner),center=b.getCenter(new T.Vector3());let plane=-Infinity;
  for(const m of meshes){const p=m.geometry.attributes.position;for(let j=0;j<p.count;j++)plane=Math.max(plane,new T.Vector3().fromBufferAttribute(p,j).applyMatrix4(m.matrixWorld).dot(normal));}
  const a=k.assembly('toilet-front-'+n,'Native molded toilet front '+n,[0,0,0],0,'c49192');toiletSet.add(a);a.position.copy(center);a.position.y=b.min.y;a.position.addScaledVector(normal,plane-center.dot(normal)+.016);a.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),normal);
  k.box(a,'toilet source pale front skin',[1.12,2.09,.025],[0,1.045,0],'#e7c381',layers.detail);
  const shape=new T.Shape();shape.moveTo(-.43,.07);shape.lineTo(.43,.07);shape.lineTo(.43,1.67);shape.quadraticCurveTo(.43,1.97,0,2.03);shape.quadraticCurveTo(-.43,1.97,-.43,1.67);shape.closePath();
  const door=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.018,bevelThickness:.012,curveSegments:8}),k.mat('#edcd90'));door.position.z=.02;k.tag(a,door,'toilet source rounded arch molded door',layers.detail);door.userData.sourceOwner='cad_component-'+n;
  for(const x of [-.365,.365])k.box(a,'toilet molded door vertical relief',[.030,1.46,.025],[x,.87,.071],'#d9b477',layers.detail);
  k.box(a,'toilet molded door lower relief',[.74,.032,.025],[0,.20,.071],'#d9b477',layers.detail);
  k.box(a,'toilet molded door middle relief',[.74,.024,.025],[0,.84,.071],'#d9b477',layers.detail);
  const label=new T.Mesh(new T.PlaneGeometry(.27,.25),k.photo('/history/2026/accuracy/toilet-native-sign.webp'));label.position.set(0,1.48,.076);k.tag(a,label,'toilet source native sanitation label',layers.detail);label.userData.walkNoCollision=true;
  k.box(a,'toilet dark door latch',[.035,.13,.035],[.34,.89,.09],'#4d514c',layers.detail);

 }
 for(const n of ['2170','2214','2245','2282','2286','2290']){const {owner,meshes}=componentMeshes(root,'cad_component-'+n);for(const m of meshes)m.material=new T.MeshStandardMaterial({color:'#eee9dd',roughness:.88,side:T.DoubleSide});if(owner)owner.userData.reviewSource='c49192 white peaked molded toilet roof; original cap geometry retained';}
 const og=k.assembly('og-east-life','OG · east dinner frontage',[-110.91,GROUND,.04],-.65,'c49457: eastern open rack frontage, hanging warm strings, folding tables/chairs and griddle. Placement fit from retained OG frame.');root.add(og);
 k.box(og,'OG east folding dinner table',[1.20,.04,.60],[2.75,.73,-5.95],'#b8aa8c',layers.detail);for(const x of [2.25,3.25])for(const z of [-6.15,-5.75])k.rod(og,'OG dinner table folding leg',[x,.02,z],[x,.71,z],.017,'#464e48',layers.detail);
 for(const [i,x]of [1.7,2.7,3.7].entries()){
  const z=-6.70;k.box(og,'OG east folding chair seat',[.43,.035,.42],[x,.44,z],i===1?'#84977b':'#4f574b',layers.detail);k.box(og,'OG east folding chair fabric back',[.43,.39,.025],[x,.79,z-.19],'#7b856c',layers.detail);
  for(const xx of [x-.19,x+.19]){k.rod(og,'OG east folding chair crossed leg',[xx,.02,z-.18],[xx,.48,z+.17],.015,'#535952',layers.detail);k.rod(og,'OG east folding chair crossed leg',[xx,.02,z+.18],[xx,.94,z-.20],.015,'#535952',layers.detail);}
 }
 // c49457 visible underside: retained1911/1912 plywood roof datum is
 // 2.984m. Add its narrow timber joists instead of another floating roof.
 for(let i=0;i<9;i++)k.box(og,'OG east retained plywood ceiling underside joist',[3.66,.11,.045],[2.375,3.089,-3.55+i*.43],'#ad906a',layers.roof);
 og.userData.ceilingEvidence='c49457 plywood underside/wood joists; retained1911/1912 roof underside2.984m unchanged, nine joists contact it; no new roof outline';
 const warm=new T.MeshStandardMaterial({color:'#f6d8a0',emissive:'#c49c5b',emissiveIntensity:.45});for(let i=0;i<7;i++){const b=new T.Mesh(new T.SphereGeometry(.035,8,6),warm);b.position.set(-3+i,2.42,-3.69);k.tag(og,b,'OG east frontage warm string globe',layers.detail);b.userData.walkNoCollision=true;if(i)k.rod(og,'OG east frontage festoon cable',[-4+i,2.48,-3.69],[-3+i,2.48,-3.69],.004,'#333932',layers.detail);}
 k.finalize();g.translateZ(-12.0);g.userData.registration='c49195 external courtyard furniture; moved12m west beyond completed kitchen/diner envelope, portable positions fitted';return g;
}
