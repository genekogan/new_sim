// Original optional low meadow depiction on verified flat native Y0, no plant obstacles.
import * as THREE from 'three';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import { commonsPlantFits, type GroundSample, type ContentView } from './commons.ts';
type MeadowKind='grass'|'clover'|'cream-bloom';
export type MeadowPlacement={id:string;kind:MeadowKind;p:[number,number,number];size:[number,number,number];yaw:number;seed:number};
const pockets:readonly [number,number][]=[[-12.8,-8.4],[-10.2,-9.5],[-6.6,-9.6],[-2.1,-9.8],[2.6,-10.4],[6,-10.7],[10.4,-10.5],[13.7,-9.9],[-13.7,-3.7],[-10.5,-2.4],[-13.1,1.6],[-8.4,1.5],[-4.6,.7],[-.7,-2.1],[2.8,-4.2],[-12.5,6.5],[-8.1,7.5],[-3.5,8.7],[.8,9],[4.4,9.4],[13.5,9.3],[-7.2,-4.1],[-10.6,3.7],[-5.8,4.3],[-2,4.5]];
const offsets:readonly [number,number][]=[[0,0],[-.63,-.38],[.59,-.48],[-.36,.63],[.68,.37],[-1.08,.19],[.16,-.94],[.04,1.02]];
/** Every accepted full rotated envelope is inspected/sampled before any resources. */
export function inspectCommonsMeadow(sample:GroundSample){
  if(typeof sample!=='function')throw Error('Missing flat commons sampler');const plants:MeadowPlacement[]=[],omitted:string[]=[];let samples=0;
  for(const [pi,[px,pz]]of pockets.entries())for(const [i,[dx,dz]]of offsets.entries()){
    const id='commons-meadow-'+pi+'-'+i,x=px+dx,z=pz+dz,kind:MeadowKind=i===7&&pi%3===0?'cream-bloom':i%3===0?'clover':'grass',w=kind==='cream-bloom'?.22:.38+(pi%3)*.035,d=kind==='cream-bloom'?.22:.34,height=kind==='grass'?.13+(i%3)*.022:kind==='clover'?.075:.13,r=Math.hypot(w,d)/2;
    if(!commonsPlantFits(x,z,r)){omitted.push(id);continue;}
    for(const [sx,sz]of [[x,z],[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r]]){const y=sample(sx,sz);samples++;if(typeof y!=='number'||!Number.isFinite(y)||y!==0)throw Error('Meadow requires complete flat native Y0 samples');}
    plants.push({id,kind,p:[x,0,z],size:[w,height,d],yaw:pi*.53+i*.77,seed:4200+pi*8+i});
  }return{plants,omitted,candidateCount:pockets.length*offsets.length,sampleCount:samples,nativeGroundY:0,cosmeticLiftY:.002};
}
function shape(kind:MeadowKind){const positions:number[]=[];const tri=(a:number[],b:number[],c:number[])=>positions.push(...a,...b,...c);
  if(kind==='grass'){for(let i=0;i<3;i++){const a=i*2.1,c=Math.cos(a),s=Math.sin(a),x=Math.cos(i*2.4)*.18,z=Math.sin(i*2.4)*.18;tri([x-c*.09,0,z-s*.09],[x+c*.09,0,z+s*.09],[x+.05,1-i*.12,z+.04]);tri([x+c*.09,0,z+s*.09],[x+.13,.45,z-.04],[x+.05,1-i*.12,z+.04]);}}
  else if(kind==='clover'){for(let i=0;i<3;i++){const a=i*Math.PI*2/3,u=[Math.cos(a),Math.sin(a)],v=[-u[1],u[0]],a0=[0,.12,0],b=[u[0]*.24+v[0]*.17,.38,u[1]*.24+v[1]*.17],c=[u[0]*.47,.3,u[1]*.47],d=[u[0]*.24-v[0]*.17,.38,u[1]*.24-v[1]*.17];tri(a0,b,c);tri(a0,c,d);}}
  else{tri([-.018,0,0],[.018,0,0],[.018,.85,0]);tri([-.018,0,0],[.018,.85,0],[-.018,.85,0]);for(let i=0;i<5;i++){const a=i*Math.PI*2/5,b=(i+1)*Math.PI*2/5;tri([0,.85,0],[Math.cos(a)*.33,.90,Math.sin(a)*.33],[Math.cos(b)*.33,.85,Math.sin(b)*.33]);}}
  if(kind==='clover')for(let i=0;i<positions.length;i+=3){positions[i]*=.78;positions[i+2]*=.78;}
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}
export function createCommonsMeadow(sample:GroundSample):ContentView{
  const data=inspectCommonsMeadow(sample),group=new THREE.Group(),resources=new ThreeResources(),meshes:THREE.InstancedMesh[]=[];group.name='Optional low commons meadow cosmetic layer';
  for(const [kind,color]of [['grass','#708652'],['clover','#658149'],['cream-bloom','#ded3af']] as const){const plants=data.plants.filter(p=>p.kind===kind);if(!plants.length)continue;const mesh=new THREE.InstancedMesh(shape(kind),new THREE.MeshStandardMaterial({color,roughness:1,side:THREE.DoubleSide}),plants.length),matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();plants.forEach((p,i)=>{rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),-p.yaw);matrix.compose(new THREE.Vector3(p.p[0],data.cosmeticLiftY,p.p[2]),rotation,new THREE.Vector3(...p.size));mesh.setMatrixAt(i,matrix);});mesh.name='commons meadow '+kind;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);resources.object(mesh);meshes.push(mesh);}
  let closed=false;return{group,dispose(){if(closed)return;closed=true;group.removeFromParent();meshes.forEach(m=>m.dispose());resources.dispose();group.clear();}};
}
