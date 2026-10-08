import * as THREE from 'three';
import type {Ground} from './venue.ts';
type V=[number,number,number];
/** Village features on clear, flat native eden-east-ground (Y0): windmill,
 * greenhouse, bandstand and market kiosks. Visual scenery only: no native
 * support, collision, seat, food, trade, place or route authority. */
export const EDEN_VILLAGE_FEATURES_PLAN=Object.freeze({
 id:'eden-village-features',
 status:'scenery only; inside native eden-east-ground [30,-30,105,85]; no physical or economic admission',
 windmill:{root:[88,0,27.75] as V,yaw:-Math.PI/4},
 greenhouse:{root:[69,0,35] as V,size:[10,4.6] as [number,number]},
 bandstand:{root:[38.5,0,-26] as V,radius:3},
 kiosks:{root:[57.5,0,-26.5] as V,count:3,spacing:2.8},
 footprints:[[85.5,25,90.5,30.5],[63.8,32.5,74.2,37.5],[35.3,-29.2,41.7,-22.8],[53.6,-28.2,61.4,-24.8]] as [number,number,number,number][],
});
export function createEdenVillageFeatures(ground:Ground){
 if(typeof ground!=='function')return null;
 for(const [x0,z0,x1,z1] of EDEN_VILLAGE_FEATURES_PLAN.footprints)for(let x=x0;x<=x1+1e-9;x+=.5)for(let z=z0;z<=z1+1e-9;z+=.5){const y=ground(x,z);if(typeof y!=='number'||!Number.isFinite(y)||Math.abs(y)>1e-5)return null;}
 const P=EDEN_VILLAGE_FEATURES_PLAN,group=new THREE.Group();group.name='Eden village features (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];let closed=false;
 const mat=<M extends THREE.Material>(m:M)=>{mats.push(m);return m;},geo=<G extends THREE.BufferGeometry>(g:G)=>{geos.push(g);return g;};
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();group.clear();};
 const solid=(g:THREE.BufferGeometry,m:THREE.Material,name:string,at:V,parent:THREE.Object3D)=>{const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.position.fromArray(at);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 try{
  const whitewash=mat(new THREE.MeshStandardMaterial({color:'#efe8da',roughness:.92})),timber=mat(new THREE.MeshStandardMaterial({color:'#7f5532',roughness:.85}));
  const shingle=mat(new THREE.MeshStandardMaterial({color:'#5d4a3f',roughness:.9})),sail=mat(new THREE.MeshStandardMaterial({color:'#f3eedf',roughness:.95,side:THREE.DoubleSide}));
  const iron=mat(new THREE.MeshStandardMaterial({color:'#3f4a46',roughness:.5,metalness:.6})),stone=mat(new THREE.MeshStandardMaterial({color:'#b9ad97',roughness:.95}));
  const glass=mat(new THREE.MeshStandardMaterial({color:'#cfe8e2',roughness:.08,metalness:0,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide}));
  const red=mat(new THREE.MeshStandardMaterial({color:'#b8473a',roughness:.85,side:THREE.DoubleSide})),cream=mat(new THREE.MeshStandardMaterial({color:'#f1e6cf',roughness:.85,side:THREE.DoubleSide}));
  const teal=mat(new THREE.MeshStandardMaterial({color:'#3f8481',roughness:.85,side:THREE.DoubleSide})),ochre=mat(new THREE.MeshStandardMaterial({color:'#d9a441',roughness:.85,side:THREE.DoubleSide}));
  // 1. Tower windmill: tapered whitewashed tower, conical cap, four lattice sails.
  const w=P.windmill,mill=new THREE.Group();mill.name='windmill';mill.position.fromArray(w.root);mill.rotation.y=w.yaw;group.add(mill);
  // WN8: enterable — open tower with a doorway gap at +Z (front), a floor, a ceiling under the cap; the door stands open.
  const whitewashIn=mat(new THREE.MeshStandardMaterial({color:'#efe8da',roughness:.92,side:THREE.DoubleSide})),millGap=1.0/2.1;
  solid(geo(new THREE.CylinderGeometry(1.5,2.1,7,16,1,true,millGap/2,Math.PI*2-millGap)),whitewashIn,'windmill-tower',[0,3.5,0],mill);
  solid(geo(new THREE.CylinderGeometry(2.04,2.04,.08,16)),timber,'windmill-floor',[0,.04,0],mill);
  solid(geo(new THREE.CylinderGeometry(1.52,1.52,.1,16)),timber,'windmill-loft-floor',[0,6.95,0],mill);
  solid(geo(new THREE.ConeGeometry(1.8,1.8,16)),shingle,'windmill-cap',[0,7.9,0],mill);
  solid(geo(new THREE.BoxGeometry(1.2,.16,.2)),timber,'windmill-door-lintel',[0,1.98,2.0],mill);
  solid(geo(new THREE.BoxGeometry(.9,1.8,.06)),timber,'windmill-door',[-.45+.45*Math.cos(1.25),.98,2.0-.45*Math.sin(1.25)],mill).rotation.y=1.25;
  const hub=new THREE.Group();hub.name='windmill-sails';hub.position.set(0,7.2,1.95);hub.rotation.z=.35;mill.add(hub);
  solid(geo(new THREE.CylinderGeometry(.18,.18,.5,10).rotateX(Math.PI/2)),timber,'windmill-hub',[0,0,0],hub);
  const spars=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(.14,4.6,.12)),timber,4),cloths=new THREE.InstancedMesh(geo(new THREE.PlaneGeometry(.9,3.6)),sail,4);spars.name='windmill-spars';cloths.name='windmill-sail-cloths';
  {const mm=new THREE.Matrix4(),rot=new THREE.Matrix4();for(let i=0;i<4;i++){rot.makeRotationZ(i*Math.PI/2);spars.setMatrixAt(i,mm.makeTranslation(0,2.4,.08).premultiply(rot));cloths.setMatrixAt(i,mm.makeTranslation(.52,2.75,.1).premultiply(rot));}}
  for(const x of[spars,cloths]){x.instanceMatrix.needsUpdate=true;x.computeBoundingSphere();x.castShadow=true;hub.add(x);}
  // 2. Greenhouse: stone plinth, iron frame, glass skin (camera-transparent), planting benches inside.
  const g=P.greenhouse,[gw,gd]=g.size,house=new THREE.Group();house.name='greenhouse';house.position.fromArray(g.root);group.add(house);
  solid(geo(new THREE.BoxGeometry(gw,.45,gd)),stone,'greenhouse-plinth',[0,.225,0],house);
  const frame:THREE.Vector3[][]=[],eave=2.6,ridge=3.8;
  for(let i=0;i<=6;i++){const x=-gw/2+i*gw/6;frame.push([new THREE.Vector3(x,.45,-gd/2),new THREE.Vector3(x,eave,-gd/2)],[new THREE.Vector3(x,.45,gd/2),new THREE.Vector3(x,eave,gd/2)],[new THREE.Vector3(x,eave,-gd/2),new THREE.Vector3(x,ridge,0)],[new THREE.Vector3(x,eave,gd/2),new THREE.Vector3(x,ridge,0)]);}
  frame.push([new THREE.Vector3(-gw/2,ridge,0),new THREE.Vector3(gw/2,ridge,0)],[new THREE.Vector3(-gw/2,eave,-gd/2),new THREE.Vector3(gw/2,eave,-gd/2)],[new THREE.Vector3(-gw/2,eave,gd/2),new THREE.Vector3(gw/2,eave,gd/2)]);
  const bars=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(.07,1,.07)),iron,frame.length);bars.name='greenhouse-frame';const m=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),s=new THREE.Vector3();
  frame.forEach(([a,b],i)=>{const d=b.clone().sub(a),len=d.length();q.setFromUnitVectors(up,d.normalize());m.compose(a.clone().add(b).multiplyScalar(.5),q,s.set(1,len,1));bars.setMatrixAt(i,m);});bars.instanceMatrix.needsUpdate=true;bars.computeBoundingSphere();bars.castShadow=true;house.add(bars);
  const skin:number[]=[],quad=(a:number[],b:number[],c:number[],d:number[])=>skin.push(...a,...b,...c,...a,...c,...d);const X=gw/2,Z=gd/2;
  quad([-X,.45,-Z],[X,.45,-Z],[X,eave,-Z],[-X,eave,-Z]);quad([-X,.45,Z],[-X,eave,Z],[X,eave,Z],[X,.45,Z]);quad([-X,eave,-Z],[X,eave,-Z],[X,ridge,0],[-X,ridge,0]);quad([-X,eave,Z],[-X,ridge,0],[X,ridge,0],[X,eave,Z]);
  // East gable whole; west gable (x=-X) has a doorway 1.1 m wide × 1.85 m (floor .45 → 2.3) on the centre aisle.
 const DW=.55,DT=2.3;skin.push(X,.45,-Z,X,.45,Z,X,eave,Z,X,.45,-Z,X,eave,Z,X,eave,-Z,X,eave,-Z,X,eave,Z,X,ridge,0);
 quad([-X,.45,-Z],[-X,.45,-DW],[-X,eave,-DW],[-X,eave,-Z]);quad([-X,.45,DW],[-X,.45,Z],[-X,eave,Z],[-X,eave,DW]);quad([-X,DT,-DW],[-X,DT,DW],[-X,eave,DW],[-X,eave,-DW]);skin.push(-X,eave,-Z,-X,eave,Z,-X,ridge,0);
  const skinGeometry=geo(new THREE.BufferGeometry());skinGeometry.setAttribute('position',new THREE.Float32BufferAttribute(skin,3));skinGeometry.computeVertexNormals();
  const glassSkin=new THREE.Mesh(skinGeometry,glass);glassSkin.name='greenhouse-glass';glassSkin.userData.cameraTransparent=true;glassSkin.renderOrder=1;house.add(glassSkin);
  for(const z of[-1.1,1.1])solid(geo(new THREE.BoxGeometry(gw-1.4,.75,.9)),timber,'greenhouse-bench',[0,.45+.375,z],house);
  // Door: iron frame, a glazed leaf standing open outward, and a stone step up to the plinth floor.
  {const leaf=new THREE.Matrix4().compose(new THREE.Vector3(-X,.45,DW),new THREE.Quaternion().setFromAxisAngle(up,1.9),new THREE.Vector3(1,1,1)),one=new THREE.Quaternion();
   // [x,y,z, sx,sy,sz, in leaf space?]: jambs and head in the gable, then the open leaf's four edges (unit box, one draw).
   const parts:[number,number,number,number,number,number,boolean][]=[[-X,(DT+.45)/2,-DW,.08,DT-.45,.08,false],[-X,(DT+.45)/2,DW,.08,DT-.45,.08,false],[-X,DT,0,.08,.08,DW*2+.08,false],
    [0,.93,-.025,.05,1.82,.05,true],[0,.93,-1.035,.05,1.82,.05,true],[0,.03,-.53,.05,.05,1.06,true],[0,1.83,-.53,.05,.05,1.06,true]];
   const door=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1,1,1)),iron,parts.length);door.name='greenhouse-door-frame';
   parts.forEach(([x,y,z,sx,sy,sz,inLeaf],i)=>{m.compose(new THREE.Vector3(x,y,z),one,s.set(sx,sy,sz));if(inLeaf)m.premultiply(leaf);door.setMatrixAt(i,m);});door.instanceMatrix.needsUpdate=true;door.computeBoundingSphere();door.castShadow=true;house.add(door);
   const pane=new THREE.Mesh(geo(new THREE.BoxGeometry(.03,1.76,.98)),glass);pane.name='greenhouse-door-glass';pane.applyMatrix4(new THREE.Matrix4().makeTranslation(0,.93,-.53).premultiply(leaf));pane.userData.cameraTransparent=true;pane.renderOrder=1;house.add(pane);}
  solid(geo(new THREE.BoxGeometry(.5,.22,1.4)),stone,'greenhouse-step',[-X-.25,.11,0],house);
  const pots=new THREE.InstancedMesh(geo(new THREE.SphereGeometry(.28,8,6)),mat(new THREE.MeshStandardMaterial({color:'#4f7f3a',roughness:.9})),16);pots.name='greenhouse-plants';
  for(let i=0;i<16;i++){const x=-gw/2+1.2+(i%8)*(gw-2.4)/7,z=i<8?-1.1:1.1;m.compose(new THREE.Vector3(x,1.45,z),q.identity(),s.set(1,.8+(i*7%5)*.1,1));pots.setMatrixAt(i,m);}pots.instanceMatrix.needsUpdate=true;pots.computeBoundingSphere();pots.castShadow=true;house.add(pots);
  // 3. Octagonal bandstand: low platform, eight iron columns, painted ogee roof.
  const b=P.bandstand,band=new THREE.Group();band.name='bandstand';band.position.fromArray(b.root);group.add(band);
  solid(geo(new THREE.CylinderGeometry(b.radius,b.radius,.35,8)),stone,'bandstand-platform',[0,.175,0],band);
  const cols=new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(.08,.1,2.7,8)),iron,8);cols.name='bandstand-columns';for(let i=0;i<8;i++){const t=i*Math.PI/4+Math.PI/8;m.makeTranslation(Math.cos(t)*(b.radius-.3),.35+1.35,Math.sin(t)*(b.radius-.3));cols.setMatrixAt(i,m);}cols.instanceMatrix.needsUpdate=true;cols.computeBoundingSphere();cols.castShadow=true;band.add(cols);
  const roofProfile=[new THREE.Vector2(b.radius+.35,0),new THREE.Vector2(b.radius,.25),new THREE.Vector2(b.radius*.6,.8),new THREE.Vector2(b.radius*.25,1.4),new THREE.Vector2(.12,1.9),new THREE.Vector2(0,2.1)];
  solid(geo(new THREE.LatheGeometry(roofProfile,8)),teal,'bandstand-roof',[0,3.05,0],band);
  // Rail open on the +Z bay (facing the classroom and the commons) between two columns, with a step up (OBSTACLES-v1).
  solid(geo(new THREE.TorusGeometry(b.radius-.3,.05,6,7,Math.PI*7/4).rotateZ(Math.PI*5/8).rotateX(Math.PI/2)),ochre,'bandstand-rail',[0,1.25,0],band);
  solid(geo(new THREE.BoxGeometry(1.7,.18,.55)),stone,'bandstand-step',[0,.09,b.radius*Math.cos(Math.PI/8)+.2],band);
  // 4. Market kiosks: three timber stalls with striped awnings and counters.
  const k=P.kiosks,row=new THREE.Group();row.name='market-kiosks';row.position.fromArray(k.root);group.add(row);
  const stripes=[red,cream,teal,cream,ochre,cream];
  // Counters, posts and awning stripes are instanced (one draw per material).
  const counters=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(2.1,.95,.7)),timber,k.count),posts=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(.1,2.3,.1)),timber,k.count*4);counters.name='kiosk-counters';posts.name='kiosk-posts';
  const stripeGeometry=geo(new THREE.PlaneGeometry(2.4/6,1.6)),stripeCells=new Map<THREE.Material,THREE.Matrix4[]>(),tilt=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2+.35,0,0)),one=new THREE.Vector3(1,1,1);
  for(let i=0;i<k.count;i++){const x=(i-(k.count-1)/2)*k.spacing;counters.setMatrixAt(i,m.makeTranslation(x,.475,.35));let n=0;for(const px of[-1,1])for(const pz of[-.6,.7])posts.setMatrixAt(i*4+n++,m.makeTranslation(x+px,1.15,pz));
   for(let j=0;j<6;j++){const material=stripes[(j+i)%stripes.length];if(!stripeCells.has(material))stripeCells.set(material,[]);stripeCells.get(material)!.push(new THREE.Matrix4().compose(new THREE.Vector3(x-1.2+(j+.5)*2.4/6,2.3,.1),tilt,one));}}
  for(const x of[counters,posts]){x.instanceMatrix.needsUpdate=true;x.computeBoundingSphere();x.castShadow=true;x.receiveShadow=true;row.add(x);}
  for(const [material,cells] of stripeCells){const stripe=new THREE.InstancedMesh(stripeGeometry,material,cells.length);stripe.name='kiosk-awning-stripes';cells.forEach((c,i)=>stripe.setMatrixAt(i,c));stripe.instanceMatrix.needsUpdate=true;stripe.computeBoundingSphere();stripe.castShadow=true;row.add(stripe);}
 }catch(error){dispose();throw error;}
 return {group,plan:EDEN_VILLAGE_FEATURES_PLAN,dispose};
}
