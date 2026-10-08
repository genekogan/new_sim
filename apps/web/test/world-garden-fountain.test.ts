import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {createEdenGardenFountain} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/garden-fountain.ts';

const make=()=>createEdenGardenFountain([0,0,0],()=>0)!;
const waterOf=(owner:ReturnType<typeof make>)=>owner.group.children.find((o)=>o instanceof THREE.Mesh && (o.material as THREE.MeshStandardMaterial).roughness===.25) as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
const hits=(mesh:THREE.Mesh,x:number,z:number)=>new THREE.Raycaster(new THREE.Vector3(x,2,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh).length>0;
type Point=[number,number];
const area=(points:Point[])=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
// Clip each actual triangle against the pedestal square, including triangles whose vertices all lie outside it.
function overlap(points:Point[]){
 for(const[axis,bound,sign]of[[0,-.25,1],[0,.25,-1],[1,-.25,1],[1,.25,-1]] as const){
  const next:Point[]=[];
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],insideA=sign*(a[axis]-bound)>=0,insideB=sign*(b[axis]-bound)>=0;
   if(insideA)next.push(a);
   if(insideA!==insideB){const t=(bound-a[axis])/(b[axis]-a[axis]);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }
  points=next;
 }
 return area(points);
}
void test('water reaches the actual pedestal at the waterline without exposed dry wedges',()=>{
 const owner=make();try{
  owner.group.updateMatrixWorld(true);const water=waterOf(owner),pedestal=owner.group.children.find((o)=>o.userData.inspection)?.getObjectByProperty('isInstancedMesh',true) as THREE.InstancedMesh;
  // Inspect the real rendered sculpture instances, rather than its larger submerged base footprint.
  const boxes:THREE.Box3[]=[];
  owner.group.traverse((o)=>{if(!(o instanceof THREE.InstancedMesh))return;for(let i=0;i<o.count;i++){const matrix=new THREE.Matrix4();o.getMatrixAt(i,matrix);boxes.push(new THREE.Box3().setFromBufferAttribute(o.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(matrix).applyMatrix4(o.matrixWorld));}});
  assert.ok(pedestal);const wet=boxes.filter((b)=>b.min.y<.43 && b.max.y>.43);assert.equal(wet.length,1);
  assert.deepEqual([wet[0].min.x,wet[0].min.z,wet[0].max.x,wet[0].max.z],[-.25,-.25,.25,.25]);
  for(const side of[-1,1])for(const along of[-.24,0,.24]){assert.ok(hits(water,side*.251,along),'water meets each pedestal side');assert.ok(hits(water,along,side*.251));}
  for(let x=-.95;x<=.95;x+=.025)for(let z=-.95;z<=.95;z+=.025){
   if(Math.abs(x)<.252 && Math.abs(z)<.252)continue;
   const inside=Array.from({length:12},(_,i)=>Math.cos((i+.5)*Math.PI/6)*x+Math.sin((i+.5)*Math.PI/6)*z<1.07*Math.cos(Math.PI/12)-.002).every(Boolean);
   if(inside)assert.ok(hits(water,x,z),`no exposed gap at ${x},${z}`);
  }
 }finally{owner.dispose();}
});
void test('actual water triangles stay flat inside the basin and never cross the pedestal footprint',()=>{
 const owner=make();try{
  const geometry=waterOf(owner).geometry.clone(),position=geometry.getAttribute('position');let surfaceArea=0;
  try{for(let i=0;i<position.count;i+=3){
   const triangle:Point[]=[];
   for(let j=0;j<3;j++){const x=position.getX(i+j),y=position.getY(i+j),z=position.getZ(i+j);assert.ok(Math.abs(y-.43)<1e-7);triangle.push([x,z]);for(let edge=0;edge<12;edge++)assert.ok(x*Math.cos((edge+.5)*Math.PI/6)+z*Math.sin((edge+.5)*Math.PI/6)<=1.07*Math.cos(Math.PI/12)+1e-7,'inside each basin inner wall');}
   assert.ok(overlap(triangle)<1e-9,'no water triangle intersects the solid pedestal');surfaceArea+=area(triangle);
   const a=new THREE.Vector3().fromBufferAttribute(position,i),b=new THREE.Vector3().fromBufferAttribute(position,i+1),c=new THREE.Vector3().fromBufferAttribute(position,i+2);assert.ok(b.sub(a).cross(c.sub(a)).y>0,'water faces upward');
  }
  assert.ok(Math.abs(surfaceArea-(3*1.07**2-.5**2))<1e-6,'entire twelve-sided basin minus exactly the pedestal');
  }finally{geometry.dispose();}
 }finally{owner.dispose();}
});
void test('water boundary uses the rim vertices and the plan describes the square opening',()=>{
 const owner=make();try{
  assert.equal(owner.plan.waterLocalY,.43);assert.equal(owner.plan.waterOuterRadius,1.07);assert.equal(owner.plan.waterOuterSegments,12);assert.deepEqual(owner.plan.waterPedestalFootprintXZ,[-.25,-.25,.25,.25]);
  const vertices=waterOf(owner).geometry.getAttribute('position');
  for(let i=0;i<12;i++){const x=1.07*Math.cos(i*Math.PI/6),z=1.07*Math.sin(i*Math.PI/6);assert.ok(Array.from({length:vertices.count},(_,j)=>Math.hypot(vertices.getX(j)-x,vertices.getZ(j)-z)<1e-7).some(Boolean));}
  assert.equal(owner.shimmerDescriptor(12)?.geometryDisplacement,0);
 }finally{owner.dispose();owner.dispose();}
});
