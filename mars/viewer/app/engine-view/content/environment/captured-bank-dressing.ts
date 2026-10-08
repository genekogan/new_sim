// Optional dressing of supplied captured terrain; no boat metadata or native grants.
import * as THREE from 'three';
import {inspectNativeShoreTerrain,type NativeShoreTerrainInput} from './native-shore-terrain.ts';
import {VegetationViews,type VegetationPlacement,type VegetationKind} from '../../vegetation.ts';
import {createForestUnderstory} from './forest-understory.ts';
type P=[number,number,number];type Fern={id:string;p:P;yaw:number};
type Envelope={id:string;root:P;radius:number;height:number};
export type CapturedBankInspection={status:'proposed captured dry-bank appearance';terrain:NativeShoreTerrainInput;waterDatumY:0;plants:readonly VegetationPlacement[];ferns:readonly Fern[];envelopes:readonly Envelope[];reservedConnector:{min:[number,number];max:[number,number]};bounds:{min:P;max:P};support:'min-min/max-max triangle root samples only; no continuous planting support'};
const trees:readonly [number,number,number,number,number,VegetationKind][]=[
  [3.1,-8.9,3.2,5.6,2.8,'canopy-tree'],[7.6,-9.2,3.6,6.3,3,'conifer'],[12.5,-8.8,3.4,5.9,2.9,'canopy-tree'],
  [4.3,-4.1,3.8,6.5,3.2,'canopy-tree'],[9.2,-4.9,3.1,5.5,2.7,'conifer'],[12.8,-1.1,3.5,6.1,2.9,'canopy-tree'],
  [12.2,4,3.8,6.4,3.2,'canopy-tree'],[3.5,9.5,3.3,5.8,2.8,'canopy-tree'],[8.2,9.1,3.2,6.2,2.7,'conifer'],[12.9,9.2,3.7,6.4,3,'canopy-tree'],
];
const shrubs:readonly [number,number][]=[[1.65,-9.1],[5.2,-9.9],[10.1,-9.3],[14.15,-6.45],[2.1,-5.1],[6.15,-2.25],[10.1,-2.8],[14.3,2.5],[10,6.5],[1.65,8.45],[6,10.2],[14.3,9.7]];
const grass:readonly [number,number][]=[[.85,-9.6],[2,-10.05],[4.6,-10.5],[5.85,-9.55],[9.3,-9.85],[10.8,-10],[13.55,-7.1],[14.75,-6.2],[1.25,-5.55],[2.9,-5.45],[5.35,-2.45],[6.8,-1.85],[9.45,-3.5],[10.65,-2.3],[13.55,2.85],[15,2.0],[9.55,5.8],[10.65,6.95],[.9,8.7],[2.3,8.0],[5.2,10.55],[6.65,10.85],[13.6,10.35],[15.0,9.25]];
const fernRoots:readonly [number,number,number][]=[[2.35,-7.6,.3],[3.0,-6.9,1.9],[5.65,-4.7,2.6],[5.1,-3.65,.8],[11.15,-8.0,4.1],[11.55,-7.3,5.2],[11.35,-.45,2.9],[13.65,.2,1.2],[11.1,4.65,3.3],[2.85,9.0,4.7],[7.1,8.1,2.1],[12.25,10.45,.6]];
/** Own descriptor-validated terrain snapshot before root calculation or allocation. */
export function inspectCapturedBankDressing(input:NativeShoreTerrainInput):CapturedBankInspection{
  const profile=inspectNativeShoreTerrain(input),terrain:NativeShoreTerrainInput={...profile,diagonal:'min-min/max-max'};
  const sample=(x:number,z:number)=>{
    const fx=(x-profile.originXZ[0])/profile.spacingMetres,fz=(z-profile.originXZ[1])/profile.spacingMetres;
    if(!Number.isFinite(fx)||!Number.isFinite(fz)||fx<0||fz<0||fx>profile.columns-1||fz>profile.rows-1)throw Error('Captured bank root outside grid');
    const ix=Math.min(Math.floor(fx),profile.columns-2),iz=Math.min(Math.floor(fz),profile.rows-2),tx=fx-ix,tz=fz-iz,h=profile.heightMetres;
    return tx>=tz?h[iz][ix]*(1-tx)+h[iz][ix+1]*(tx-tz)+h[iz+1][ix+1]*tz:h[iz][ix]*(1-tz)+h[iz+1][ix]*(tz-tx)+h[iz+1][ix+1]*tx;
  };
  const plants:VegetationPlacement[]=[],ferns:Fern[]=[],envelopes:Envelope[]=[];
  const root=(id:string,x:number,z:number,radius:number,height:number):P=>{
    // Full rotation-invariant horizontal envelope, not just a point or trunk.
    if(x-radius<=0||x+radius>16||z-radius< -12||z+radius>12||(x-radius<=8&&z+radius>=3.2&&z-radius<=6.8))throw Error('Captured bank envelope crosses water, bounds or reserved connector');
    const y=sample(x,z);if(!Number.isFinite(y)||y<=0)throw Error('Captured bank root must be above water datum');
    const p:P=[x,y,z];envelopes.push({id,root:[...p],radius,height});return p;
  };
  const add=(kind:VegetationKind,x:number,z:number,w:number,h:number,d:number,seed:number)=>{const id='captured-bank-'+kind+'-'+plants.length;plants.push({id,kind,p:root(id,x,z,Math.hypot(w,d)/2,h),size:[w,h,d],yaw:(seed*.618)%(Math.PI*2),seed});};
  trees.forEach(([x,z,w,h,d,k],i)=>add(k,x,z,w,h,d,4100+i));
  shrubs.forEach(([x,z],i)=>add('shrub',x,z,1.0+i%3*.08,.6+i%4*.045,.86+i%2*.06,4200+i));
  grass.forEach(([x,z],i)=>add('grass',x,z,.55+i%3*.045,.3+i%4*.035,.48,4300+i));
  fernRoots.forEach(([x,z,yaw],i)=>{const id='captured-bank-fern-'+i;ferns.push({id,p:root(id,x,z,.35,.65),yaw});});
  return{status:'proposed captured dry-bank appearance',terrain,waterDatumY:0,plants,ferns,envelopes,reservedConnector:{min:[0,3.2],max:[8,6.8]},bounds:{min:[Math.min(...envelopes.map(p=>p.root[0]-p.radius)),Math.min(...envelopes.map(p=>p.root[1])),Math.min(...envelopes.map(p=>p.root[2]-p.radius))],max:[Math.max(...envelopes.map(p=>p.root[0]+p.radius)),Math.max(...envelopes.map(p=>p.root[1]+p.height)),Math.max(...envelopes.map(p=>p.root[2]+p.radius))]},support:'min-min/max-max triangle root samples only; no continuous planting support'};
}
export function createCapturedBankDressing(terrain:NativeShoreTerrainInput):{group:THREE.Group;dispose():void}{
  const spec=inspectCapturedBankDressing(terrain); // Full strict input and every root before allocation.
  const group=new THREE.Group();group.name='Captured positive-X dry-bank dressing';
  let vegetation:VegetationViews|undefined,prototype:ReturnType<typeof createForestUnderstory>|undefined;const instances:THREE.InstancedMesh[]=[];
  const release=()=>{const errors:unknown[]=[];for(const f of[()=>group.removeFromParent(),()=>vegetation?.dispose(),...instances.map(m=>()=>m.dispose()),()=>prototype?.dispose(),()=>group.clear()])try{f();}catch(e){errors.push(e);}return errors;};
  try{
    vegetation=new VegetationViews(spec.plants);if(vegetation.rejected.length)throw Error('Captured bank library refused plants');group.add(vegetation.group);
    prototype=createForestUnderstory('fern');for(const child of prototype.group.children){const original=child as THREE.Mesh<THREE.BufferGeometry,THREE.Material>,mesh=new THREE.InstancedMesh(original.geometry,original.material,spec.ferns.length);instances.push(mesh);mesh.name='captured-bank-fern '+original.name;mesh.castShadow=original.castShadow;mesh.receiveShadow=original.receiveShadow;for(const[i,f]of spec.ferns.entries())mesh.setMatrixAt(i,new THREE.Matrix4().compose(new THREE.Vector3(...f.p),new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-f.yaw,0)),new THREE.Vector3(1,1,1)));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);}
  }catch(error){const errors=release();if(errors.length)throw new AggregateError([error,...errors],'Captured bank creation and rollback failed',{cause:error});throw error;}
  let closed=false;return{group,dispose(){if(closed)return;closed=true;const errors=release();if(errors.length)throw new AggregateError(errors,'Captured bank disposal failed',{cause:errors[0]});}};
}
