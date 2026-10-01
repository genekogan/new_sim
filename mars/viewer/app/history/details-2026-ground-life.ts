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
