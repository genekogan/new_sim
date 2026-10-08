/** Original flat-deck wooden punt over one exact uninstalled shore proposal. */
import * as THREE from 'three';
import type {ShoreDesign} from '../../shore-preview.ts';
export type ContentView={readonly group:THREE.Group;dispose():void};
type Anchor={id:string;p:number[];yaw:number;pelvisContactLocal:number[];feetContactsLocal:number[][]};
type Boat=ShoreDesign['boat']&{id:string;sizeXYZ:number[];deck:ShoreDesign['boat']['deck']&{boundsLocalXZ:number[]};localPassengerAnchors:Anchor[];localBoardingAnchor:{id:string;p:number[];landingPatchLocalXZ:number[]};waterlineLocalY:number;draftMetres:number;freeboardToDeckMetres:number;occupantEnvelopeProposal:{standingRadius:number;standingHeight:number;seatedRootRadius:number;seatedHeightAboveDeck:number}};
// Numeric tuples own exactly their required indices and ordinary array length, never extra metadata.
const dense=(a:unknown,n:number):a is number[]=>Array.isArray(a)&&a.length===n&&Reflect.ownKeys(a).length===n+1&&Array.from({length:n},(_,i)=>i).every(i=>Object.hasOwn(a,i)&&typeof a[i]==='number'&&Number.isFinite(a[i])&&Math.abs(a[i])<=10000);
const exact=(a:unknown,w:readonly number[])=>dense(a,w.length)&&a.every((v,i)=>Math.abs(v-w[i])<1e-9);
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=96;
function validated(boat:ShoreDesign['boat']):Boat{
 const b=boat as Boat;
 if(!b||!id(b.id)||!exact(b.sizeXYZ,[3,.8,1.3])||!exact(b.hullEnvelopeLocal?.minXYZ,[-1.5,-.4,-.65])||!exact(b.hullEnvelopeLocal?.maxXYZ,[1.5,.4,.65])||!exact(b.deck?.boundsLocalXZ,[-1.5,-.65,1.5,.65])||b.deck?.topLocalY!==.4||b.deck?.visualThickness!==.08||!dense(b.poseProposal?.p,3)||typeof b.poseProposal?.yaw!=='number'||!Number.isFinite(b.poseProposal.yaw)||b.waterlineLocalY!==-.1||b.draftMetres!==.3||b.freeboardToDeckMetres!==.5||!Array.isArray(b.localPassengerAnchors)||b.localPassengerAnchors.length!==2)throw Error('Unsupported exact shore boat proposal');
 const ids=new Set<string>([b.id]);
 for(let i=0;i<2;i++){const a=b.localPassengerAnchors[i],x=i?.65:-.65,fx=i?1.05:-1.05;if(!a||!id(a.id)||ids.has(a.id)||!exact(a.p,[x,.4,0])||!exact(a.pelvisContactLocal,[x,.8,0])||!Array.isArray(a.feetContactsLocal)||a.feetContactsLocal.length!==2||!exact(a.feetContactsLocal[0],[fx,.4,-.12])||!exact(a.feetContactsLocal[1],[fx,.4,.12])||a.yaw!==(i?0:Math.PI))throw Error('Inconsistent passenger proposal');ids.add(a.id);}
 const a=b.localBoardingAnchor,e=b.occupantEnvelopeProposal;if(!a||!id(a.id)||ids.has(a.id)||!exact(a.p,[0,.4,-.25])||!exact(a.landingPatchLocalXZ,[-.3,-.55,.3,.05])||!e||e.standingRadius!==.28||e.standingHeight!==1.75||e.seatedRootRadius!==.28||e.seatedHeightAboveDeck!==1.35)throw Error('Inconsistent boarding/occupant proposal');return b;
}
type Part={name:string;p:number[];size:number[];colour:string;category:'hull-and-deck'|'raised-fixtures'};
export function inspectShoreBoat(boat:ShoreDesign['boat']){
 const b=validated(boat),parts:Part[]=[];
 const box=(name:string,p:number[],size:number[],colour:string,category:Part['category'])=>parts.push({name,p,size,colour,category});
 // Raked bow(+X), less-raked transom(-X), flat exact rectangular deck of a small punt.
 for(let i=0;i<10;i++)box('deck-slat:'+i,[-1.35+i*.3,.36,0],[.3,.08,1.3],i%3?'#a7784f':'#a79880','hull-and-deck');
 // Dark narrow seams are embedded, never raised above feet/deck plane.
 for(let i=1;i<10;i++)box('embedded-deck-seam:'+i,[-1.5+i*.3,.399,0],[.008,.002,1.3],'#70533b','hull-and-deck');
 for(const [i,a]of b.localPassengerAnchors.entries()){
  box('seat-surface:'+i,[a.p[0],.77,0],[.5,.06,.58],'#a7784f','raised-fixtures');
  for(const z of [-.20,.20])box('seat-support:'+i+':'+z,[a.p[0],.585,z],[.10,.37,.07],'#70533b','raised-fixtures');
 }
 // Starboard rail and interrupted port rail leave boarding patch and leg contacts empty.
 box('starboard-rail',[0,.65,.61],[2.6,.06,.07],'#70533b','raised-fixtures');
 for(const x of [-.94,.94])box('port-rail:'+x,[x,.65,-.61],[.72,.06,.07],'#70533b','raised-fixtures');
 for(const x of [-1.3,1.3])for(const z of [-.61,.61])box('rail-post:'+x+':'+z,[x,.525,z],[.055,.25,.055],'#776f60','raised-fixtures');
 box('bow-cap',[1.46,.425,0],[.08,.05,1.3],'#a79880','raised-fixtures');
 box('stern-cap',[-1.46,.425,0],[.08,.05,1.3],'#70533b','raised-fixtures');
 return {status:'uninstalled-proposal',origin:'boat-local frame; caller pose/-yaw',hullEnvelope:structuredClone(b.hullEnvelopeLocal),deck:structuredClone(b.deck),poseProposal:structuredClone(b.poseProposal),passengers:structuredClone(b.localPassengerAnchors),boarding:structuredClone(b.localBoardingAnchor),waterline:b.waterlineLocalY,draft:b.draftMetres,parts,wholeVisualBounds:{min:[-1.5,-.4,-.65],max:[1.5,.8,.65]},raisedFixtureBounds:{min:[-1.5,.4,-.65],max:[1.5,.8,.65]},clearances:[{name:'boarding-patch',min:[-.3,.4,-.55],max:[.3,2.15,.05]},...b.localPassengerAnchors.flatMap((a,i)=>a.feetContactsLocal.map((p,j)=>({name:'feet:'+i+':'+j,min:[p[0]-.07,.4,p[2]-.07],max:[p[0]+.07,.62,p[2]+.07]}))),...b.localPassengerAnchors.map((a,i)=>({name:'above-seat:'+i,min:[a.p[0]-.24,.8,-.27],max:[a.p[0]+.24,1.75,.27]}))]};
}
function hullGeometry(){
 const upper=[[-1.5,.32,-.65],[1.5,.32,-.65],[1.5,.32,.65],[-1.5,.32,.65]],lower=[[-1.28,-.4,-.38],[1.14,-.4,-.38],[1.14,-.4,.38],[-1.28,-.4,.38]],v=[...lower,...upper],indices=[0,1,2,0,2,3,4,7,6,4,6,5,0,4,5,0,5,1,1,5,6,1,6,2,2,6,7,2,7,3,3,7,4,3,4,0];
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(v.flat(),3));g.setIndex(indices);const flat=g.toNonIndexed();g.dispose();flat.computeVertexNormals();return flat;
}
export function createShoreBoat(boat:ShoreDesign['boat']):ContentView{
 const spec=inspectShoreBoat(boat);const group=new THREE.Group();group.name='shore-boat:uninstalled';group.userData.inspection=spec;
 const hull=new THREE.Group(),raised=new THREE.Group();hull.name='hull-and-deck';raised.name='raised-fixtures';group.add(hull,raised);
 const instances:THREE.InstancedMesh[]=[],cube=new THREE.BoxGeometry(1,1,1),materials=new Map<string,THREE.MeshStandardMaterial>();const mat=(colour:string)=>{let m=materials.get(colour);if(!m){m=new THREE.MeshStandardMaterial({color:colour,roughness:.9});materials.set(colour,m);}return m;};
 const shell=new THREE.Mesh(hullGeometry(),mat('#70533b'));shell.name='raked-wooden-hull';shell.castShadow=shell.receiveShadow=true;hull.add(shell);
 const batches=new Map<string,Part[]>();for(const p of spec.parts){const key=p.category+':'+p.colour,list=batches.get(key)??[];list.push(p);batches.set(key,list);}
 const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),q=new THREE.Quaternion();
 for(const [key,parts]of batches){const m=new THREE.InstancedMesh(cube,mat(parts[0].colour),parts.length);m.name=key;m.userData.partNames=parts.map(p=>p.name);parts.forEach((p,i)=>{matrix.compose(position.fromArray(p.p),q,scale.fromArray(p.size));m.setMatrixAt(i,matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingBox();m.computeBoundingSphere();m.castShadow=m.receiveShadow=true;(parts[0].category==='hull-and-deck'?hull:raised).add(m);instances.push(m);}
 const geometries=new Set<THREE.BufferGeometry>([cube,shell.geometry]),members:THREE.Object3D[]=[];group.traverse(o=>{if(o!==group)members.push(o);});
 let closed=false;return {group,dispose(){
  if(closed)return;closed=true;
  const failures:unknown[]=[],attempt=(operation:()=>void)=>{try{operation();}catch(error){failures.push(error);}};
  attempt(()=>group.removeFromParent());
  // Snapshot only factory-owned resources; throwing listeners cannot prevent the remaining release attempts.
  for(const m of instances)attempt(()=>m.dispose());for(const g of geometries)attempt(()=>g.dispose());for(const m of materials.values())attempt(()=>m.dispose());
  for(const member of members)attempt(()=>member.removeFromParent());for(const child of group.children.slice())attempt(()=>group.remove(child));
  instances.length=members.length=0;geometries.clear();materials.clear();
  if(failures.length)throw new AggregateError(failures,'Shore boat cleanup failed');
 }};
}
