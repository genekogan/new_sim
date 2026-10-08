import * as THREE from 'three';
import type {Ground} from './venue.ts';
type V=[number,number,number];
/** Three small landmarks on clear, flat native eden-east-ground (Y0). Visual
 * scenery only: no native support, collision, seat, place or route authority. */
export const EDEN_LANDMARKS_PLAN=Object.freeze({
 id:'eden-landmarks',
 status:'scenery only; inside native eden-east-ground [30,-30,105,85]; no physical admission (amphitheatre steps are not seats)',
 amphitheatre:{stage:[76,0,80.6] as V,inner:2.7,outer:4.2,steps:3},
 observatory:{root:[36.5,0,82] as V,radius:2,height:3.6},
 stoneGarden:{root:[57,0,-10] as V,ring:3.4,stones:7},
 footprints:[[71.6,80,80.4,84.9],[34.3,79.8,38.7,84.2],[53.2,-13.8,60.8,-6.2]] as [number,number,number,number][],
});
const PAINT=['#c96f4a','#e2b552','#4f8f8c','#f1e6cf','#7a5c9e','#2f5d7c'];
export function createEdenLandmarks(ground:Ground){
 if(typeof ground!=='function')return null;
 for(const [x0,z0,x1,z1] of EDEN_LANDMARKS_PLAN.footprints)for(let x=x0;x<=x1+1e-9;x+=.5)for(let z=z0;z<=z1+1e-9;z+=.5){const y=ground(x,z);if(typeof y!=='number'||!Number.isFinite(y)||Math.abs(y)>1e-5)return null;}
 const group=new THREE.Group();group.name='Eden landmarks (scenery only)';
 const geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];let closed=false;
 const mat=(m:THREE.Material)=>{mats.push(m);return m;},geo=<G extends THREE.BufferGeometry>(g:G)=>{geos.push(g);return g;};
 const dispose=()=>{if(closed)return;closed=true;group.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();group.clear();};
 const shade=(mesh:THREE.Mesh)=>{mesh.castShadow=true;mesh.receiveShadow=true;return mesh;};
 try{
  const stone=mat(new THREE.MeshStandardMaterial({color:'#b9ad97',roughness:.95})),darkStone=mat(new THREE.MeshStandardMaterial({color:'#8d8273',roughness:1}));
  const plaster=mat(new THREE.MeshStandardMaterial({color:'#efe6d2',roughness:.9})),copper=mat(new THREE.MeshStandardMaterial({color:'#6e9c8c',roughness:.5,metalness:.35}));
  const paint=mat(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8}));
  // 1. Amphitheatre: three curved stone steps facing a painted stage disc to the north.
  const a=EDEN_LANDMARKS_PLAN.amphitheatre,amph=new THREE.Group();amph.name='amphitheatre';amph.position.fromArray(a.stage);group.add(amph);
  const width=(a.outer-a.inner)/a.steps;
  for(let i=0;i<a.steps;i++){const r0=a.inner+i*width,r1=r0+width,h=.16+i*.16;
   // Half annulus on the +Z (south) side, extruded upward; open toward the stage.
   const shape=new THREE.Shape();shape.absarc(0,0,r1,.18,Math.PI-.18,false);shape.absarc(0,0,r0,Math.PI-.18,.18,true);
   const g=geo(new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,curveSegments:18}));g.rotateX(Math.PI/2);g.translate(0,h,0);
   const step=shade(new THREE.Mesh(g,i%2?darkStone:stone));step.name='amphitheatre-step-'+(i+1);amph.add(step);}
  const stagePositions:number[]=[],stageColours:number[]=[],c=new THREE.Color();const segments=24;
  for(let k=0;k<segments;k++){const t0=k/segments*Math.PI*2,t1=(k+1)/segments*Math.PI*2;c.set(PAINT[k%PAINT.length]);
   for(const [r,t] of [[0,0],[1.5,t1],[1.5,t0]] as [number,number][]){stagePositions.push(r*Math.cos(t),.025,r*Math.sin(t));stageColours.push(c.r,c.g,c.b);}}
  const stageGeometry=geo(new THREE.BufferGeometry());stageGeometry.setAttribute('position',new THREE.Float32BufferAttribute(stagePositions,3));stageGeometry.setAttribute('color',new THREE.Float32BufferAttribute(stageColours,3));stageGeometry.computeVertexNormals();
  const stage=new THREE.Mesh(stageGeometry,paint);stage.name='amphitheatre-painted-stage';stage.receiveShadow=true;amph.add(stage);
  // 2. Observatory: plaster drum, copper cornice and dome, painted door.
  const o=EDEN_LANDMARKS_PLAN.observatory,obs=new THREE.Group();obs.name='observatory';obs.position.fromArray(o.root);group.add(obs);
  // WN8: enterable — the drum is open with a doorway gap on its north (-Z) side, the dome is seen from inside, the door stands open.
  const plasterIn=mat(new THREE.MeshStandardMaterial({color:'#efe6d2',roughness:.9,side:THREE.DoubleSide})),copperIn=mat(new THREE.MeshStandardMaterial({color:'#6e9c8c',roughness:.5,metalness:.35,side:THREE.DoubleSide}));
  const gap=1.1/o.radius,drum=shade(new THREE.Mesh(geo(new THREE.CylinderGeometry(o.radius,o.radius*1.04,o.height,24,1,true,Math.PI+gap/2,Math.PI*2-gap)),plasterIn));drum.position.y=o.height/2;drum.name='observatory-drum';obs.add(drum);
  const floor=shade(new THREE.Mesh(geo(new THREE.CylinderGeometry(o.radius-.02,o.radius-.02,.08,24)),darkStone));floor.position.y=.04;floor.name='observatory-floor';obs.add(floor);
  const lintel=shade(new THREE.Mesh(geo(new THREE.BoxGeometry(1.3,.18,.2)),copper));lintel.position.set(0,2.12,-o.radius);lintel.name='observatory-door-lintel';obs.add(lintel);
  const band=shade(new THREE.Mesh(geo(new THREE.CylinderGeometry(o.radius+.03,o.radius+.03,.28,24,1,true)),copper));band.position.y=o.height-.14;band.name='observatory-cornice';obs.add(band);
  const dome=shade(new THREE.Mesh(geo(new THREE.SphereGeometry(o.radius+.05,24,12,0,Math.PI*2,0,Math.PI/2)),copperIn));dome.position.y=o.height;dome.name='observatory-dome';obs.add(dome);
  const door=shade(new THREE.Mesh(geo(new THREE.BoxGeometry(.95,2,.06)),darkStone));door.position.set(-.5+.475*Math.cos(1.25),1.04,-o.radius+.04+.475*Math.sin(1.25));door.rotation.y=-1.25;door.name='observatory-door';obs.add(door);
  // 3. Stone garden: a ring of standing stones around a round-topped gate arch.
  const s=EDEN_LANDMARKS_PLAN.stoneGarden,garden=new THREE.Group();garden.name='stone-garden';garden.position.fromArray(s.root);group.add(garden);
  const stones=new THREE.InstancedMesh(geo(new THREE.BoxGeometry(.7,1,.45)),stone,s.stones);stones.name='standing-stones';const m=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3();
  for(let i=0;i<s.stones;i++){const t=i/s.stones*Math.PI*2+.3,h=1.3+((i*37)%5)*.22;q.setFromEuler(new THREE.Euler(0,-t+Math.PI/2,((i%3)-1)*.04));m.compose(new THREE.Vector3(Math.cos(t)*s.ring,h/2,Math.sin(t)*s.ring),q,sc.set(1,h,1));stones.setMatrixAt(i,m);}
  stones.instanceMatrix.needsUpdate=true;stones.computeBoundingSphere();stones.castShadow=true;stones.receiveShadow=true;garden.add(stones);
  const pier=geo(new THREE.BoxGeometry(.55,2.6,.55));for(const x of[-1.3,1.3]){const p=shade(new THREE.Mesh(pier,darkStone));p.position.set(x,1.3,0);p.name='gate-pier';garden.add(p);}
  const arch=shade(new THREE.Mesh(geo(new THREE.TorusGeometry(1.3,.24,8,20,Math.PI)),darkStone));arch.position.y=2.6;arch.name='gate-arch';garden.add(arch);
  const path=new THREE.Mesh(geo(new THREE.CircleGeometry(s.ring-.6,28).rotateX(-Math.PI/2)),stone);path.position.y=.015;path.name='stone-garden-paving';path.receiveShadow=true;garden.add(path);
 }catch(error){dispose();throw error;}
 return {group,plan:EDEN_LANDMARKS_PLAN,dispose};
}
