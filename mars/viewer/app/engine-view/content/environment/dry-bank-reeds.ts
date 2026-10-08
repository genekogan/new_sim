// Original static three-stem dry-bank tufts. Appearance, never water plants/physics.
import * as THREE from 'three';
import { designHeightAt, type ShoreDesign } from '../../shore-preview.ts';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import { commonsPlantFits, type ContentView } from './commons.ts';
import { dryShoreInspection } from './dry-shore.ts';
import { shoreGardenInspection } from './shore-gardens.ts';
export type DryBankReedPlacement={id:string;kind:'reed-tuft';p:[number,number,number];size:[number,number,number];yaw:number;seed:number};
type Omission={id:string;reason:'strip-or-domain'|'wet-envelope'|'commons-or-route'|'grove-envelope'|'garden-envelope'|'root-not-dry'};
const anchors:readonly [number,number][]=[
 [.63,-8.7],[.95,-8.45],[.69,-8.12],[.91,-7.88], [.64,-7.5],[.96,-7.22],[.7,-6.95],[.89,-6.61],
 [.65,-5.6],[.94,-5.28],[.68,-4.95],[.91,-4.66], [.62,-3.8],[.94,-3.46],[.7,-3.12],[.9,-2.84],
 [.63,-.65],[.95,-.33],[.69,.02],[.9,.36], [.64,1.8],[.94,2.09],[.68,2.4],[.91,2.72],
 [.62,7.25],[.95,7.55],[.69,7.86],[.9,8.16], [.64,8.55],[.94,8.87],[.68,9.2],[.92,9.55],
];
export function inspectDryBankReeds(design:ShoreDesign):{plants:readonly DryBankReedPlacement[];omitted:readonly Omission[];candidateCount:number}{
  const grove=dryShoreInspection(design).plants,gardens=shoreGardenInspection(design).beds,plants:DryBankReedPlacement[]=[],omitted:Omission[]=[];
  anchors.forEach(([x,z],i)=>{const id='dry-bank-reeds-'+i,size:[number,number,number]=[.24,.55+(i%6)*.1,.22],r=Math.hypot(size[0],size[2])/2;
    const reject=(reason:Omission['reason'])=>omitted.push({id,reason});
    if(x-r<.4||x+r>1.2||!((z-r>=-9&&z+r<=3)||(z-r>=7&&z+r<=10))){reject('strip-or-domain');return;}
    if(x-r<=0){reject('wet-envelope');return;}
    if(!commonsPlantFits(x,z,r)){reject('commons-or-route');return;}
    if(grove.some(p=>Math.hypot(x-p.p[0],z-p.p[2])<=r+Math.hypot(p.size[0],p.size[2])/2)){reject('grove-envelope');return;}
    if(gardens.some(b=>Math.hypot(x-b.centreXZ[0],z-b.centreXZ[1])<=r+b.radius)){reject('garden-envelope');return;}
    const y=designHeightAt(design.terrain,x,z);if(y===null||!Number.isFinite(y))throw Error('Missing dry-bank root');
    if(y<=design.water.datumY+.05){reject('root-not-dry');return;}
    plants.push({id,kind:'reed-tuft',p:[x,y,z],size,yaw:(i*.71)%(Math.PI*2),seed:3100+i});
  });return {plants,omitted,candidateCount:anchors.length};
}
export function createDryBankReeds(design:ShoreDesign):ContentView{
  const {plants}=inspectDryBankReeds(design); // complete grid/domain/root preflight before resources
  const group=new THREE.Group();group.name='Dry-bank original reed tuft proposal';const resources=new ThreeResources();const meshes:THREE.InstancedMesh[]=[];
  if(plants.length){const geometry=new THREE.CylinderGeometry(1,1,1,3);const stems=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:'#6f875b',roughness:1}),plants.length*3),heads=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:'#b7a16c',roughness:1}),plants.length*3);
    const root=new THREE.Matrix4(),part=new THREE.Matrix4(),q=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);let instance=0;
    for(const p of plants){q.setFromAxisAngle(axis,-p.yaw);root.compose(new THREE.Vector3(...p.p),q,new THREE.Vector3(...p.size));for(let j=0;j<3;j++){const a=(p.seed%11)*.2+j*2.3,x=Math.cos(a)*.29,z=Math.sin(a)*.25,h=.55+((p.seed+j)%4)*.1;part.makeScale(.022,h,.022);part.setPosition(x,h/2,z);stems.setMatrixAt(instance,root.clone().multiply(part));part.makeScale(.052,.10,.052);part.setPosition(x,h+.05,z);heads.setMatrixAt(instance,root.clone().multiply(part));instance++;}}
    for(const [mesh,name]of [[stems,'dry-bank reed stems'],[heads,'dry-bank warm seedheads']] as const){mesh.name=name;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);resources.object(mesh);meshes.push(mesh);}
  }
  let closed=false;return{group,dispose(){if(closed)return;closed=true;group.removeFromParent();meshes.forEach(m=>m.dispose());resources.dispose();group.clear();}};
}
