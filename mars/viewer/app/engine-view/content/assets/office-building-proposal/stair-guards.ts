import * as THREE from 'three';
import {officeStairGuardBoxes,type OfficeGuardBox} from '../../../../../lib/office-stair-guards.ts';
type Part={name:string;p:[number,number,number];size:[number,number,number];rotationX?:number};

/** New assembly only: the existing office floors, stairs and furnishings keep their original geometry. */
export function officeStairAssemblyParts(guards:readonly OfficeGuardBox[]):Part[]{
 const parts:Part[]=[],box=(name:string,p:Part['p'],size:Part['size'],rotationX?:number)=>parts.push({name,p,size,...(rotationX!==undefined?{rotationX}:{})});
 for(const guard of guards){
  const westEast=guard.max[2]-guard.min[2]>guard.max[0]-guard.min[0],length=westEast?guard.max[2]-guard.min[2]:guard.max[0]-guard.min[0];
  const x=(guard.min[0]+guard.max[0])/2,z=(guard.min[2]+guard.max[2])/2,y=guard.floorY;
  for(const height of[.5,1.02])box(guard.id+':rail:'+height,[x,y+height,z],westEast?[.06,.06,length]:[length,.06,.06]);
  const count=Math.ceil(length/.2);
  for(let i=0;i<=count;i++){
   const at=-length/2+.0275+(length-.055)*i/count;box(guard.id+':upright:'+i,[x+(westEast?0:at),y+.515,z+(westEast?at:0)],[.055,1.03,.055]);
  }
 }
 const beam=(name:string,x:number,y0:number,z0:number,y1:number,z1:number)=>{
  const dy=y1-y0,dz=z1-z0;box(name,[x,(y0+y1)/2,(z0+z1)/2],[.1,.16,Math.hypot(dy,dz)],Math.atan2(-dy,dz));
 };
 for(const base of[.1,3.1]){
  // Centreline beam ends sit under the first/last rigid treads, touching their risers and underside.
  for(const x of[87.28,87.92])beam(`stringer:lower:${base}:${x}`,x,base+.08,16.2,base+1.48,14.24);
  for(const x of[88.28,88.92])beam(`stringer:upper:${base}:${x}`,x,base+1.68,14.24,base+2.88,15.92);
  for(const z of[13.58,14.02])box(`landing-beam:${base}:${z}`,[88.1,base+1.4,z],[1.8,.16,.12]);
  // Hang the switchback landing from the upper floor rim; no column reaches the ground below it.
  for(const z of[13.58,14.02])box(`rim-hanger:${base}:${z}`,[87.17,base+2.21,z],[.06,1.58,.06]);
  box(`exit-rim-beam:${base}`,[88.6,base+2.83,16.4],[.8,.16,.12]);
 }
 return parts;
}

export function createOfficeStairGuardAssembly(guards:readonly OfficeGuardBox[]){
 const expected=officeStairGuardBoxes();
 if(guards.length!==expected.length||guards.some((g,i)=>g.id!==expected[i].id||g.buildingId!==expected[i].buildingId||g.floorY!==expected[i].floorY||g.min.some((v,j)=>v!==expected[i].min[j])||g.max.some((v,j)=>v!==expected[i].max[j])))throw new TypeError('Exact captured office guard bands required');
 const group=new THREE.Group(),parts=officeStairAssemblyParts(guards),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#65716b',roughness:.7});
 group.name='eden-office-1:stair-guards';group.userData.officeStairGuards=structuredClone(guards);
 const mesh=new THREE.InstancedMesh(geometry,material,parts.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),axis=new THREE.Vector3(1,0,0),position=new THREE.Vector3(),scale=new THREE.Vector3();
 mesh.name='office guard rails, stringers and suspended landing supports';mesh.userData.parts=structuredClone(parts);
 parts.forEach((p,i)=>{q.setFromAxisAngle(axis,p.rotationX??0);matrix.compose(position.fromArray(p.p),q,scale.fromArray(p.size));mesh.setMatrixAt(i,matrix);});
 mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
 let closed=false;return{group,guards:structuredClone(guards),parts,dispose(){if(closed)return;closed=true;group.removeFromParent();group.clear();mesh.dispose();geometry.dispose();material.dispose();}};
}
