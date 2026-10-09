import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createCourtyardHouseProposal,inspectCourtyardHouseProposal} from '../../../mars/viewer/app/engine-view/content/assets/courtyard-house-proposal/house.ts';
import {createHouseThreeRoofAccess} from '../../../mars/viewer/app/engine-view/content/assets/eden-expansion-assets/house-three-roof-access.ts';
import {FIXTURES} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/interior-plan.ts';
import {modelGeometry,PackSoup} from '../../../mars/viewer/app/engine-view/content/assets/eden-imports/assets.ts';
type Part={name:string;p:number[];size:number[]};
function drawnPart(root:THREE.Group,name:string){
 let bounds:THREE.Box3|null=null;root.updateMatrixWorld(true);
 root.traverse(o=>{const m=o as THREE.InstancedMesh;if(!m.isInstancedMesh)return;const parts=m.userData.parts as Part[]|undefined,index=parts?.findIndex(p=>p.name===name)??-1;if(index<0)return;const matrix=new THREE.Matrix4();m.getMatrixAt(index,matrix);matrix.premultiply(m.matrixWorld);bounds=new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(matrix);});
 assert.ok(bounds,'actual drawn part '+name);return bounds as THREE.Box3;
}
function auditDoor(root:THREE.Group){
 for(const z of[2.1,4.9])for(const side of[-1,1]){
  const wall=drawnPart(root,'south-entry-pier:'+z+':'+side),trim=drawnPart(root,'entry-trim:'+z+':'+side);
  assert.ok(trim.max.z-wall.max.z>.029,'casing front stands proud of wall');
  const sharedZ=Math.max(0,Math.min(trim.max.z,wall.max.z)-Math.max(trim.min.z,wall.min.z));
  const sharedY=Math.max(0,Math.min(trim.max.y,wall.max.y)-Math.max(trim.min.y,wall.min.y));
  assert.ok(sharedZ*sharedY<1e-6,'no positive-area coincident opening-side face');
  assert.ok(side>0?trim.min.x>=.8999999:trim.max.x<=-.8999999,'trim leaves the architectural opening clear');
 }
 for(const x of[-.89,0,.89])for(const direction of[-1,1]){
  const ray=new THREE.Raycaster(new THREE.Vector3(x,1.3,direction>0?1.8:5.4),new THREE.Vector3(0,0,direction),0,3.7);
  assert.equal(ray.intersectObject(root,true).length,0,'actual door passage remains clear from both sides');
 }
}
await test('both courtyard variants and selected House3 render raised front trim without shared opening-side planes',()=>{
 for(const variant of['warm-timber','stone-pale'] as const){const owner=createCourtyardHouseProposal(variant);try{auditDoor(owner.group);const spec=inspectCourtyardHouseProposal(variant);assert.equal(spec.floor.topY,.1);assert.deepEqual(spec.entry.x,[-.9,.9]);assert.deepEqual(spec.entry.outerZ,[4.8,5]);assert.equal(spec.bounds.max[2],5.03);}finally{owner.dispose();}}
 const house3=createHouseThreeRoofAccess(()=>true);assert.ok(house3);try{auditDoor(house3.group);}finally{house3.dispose();}
});
await test('actual imported round rug flat faces clear both installed house floors after production packing',async()=>{
 const data=readFileSync(new URL('../../../mars/viewer/public/modular/environment/eden-interior.glb',import.meta.url));
 const gltf=await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
 const source=modelGeometry(gltf,'int-carpet-round');assert.ok(source);const p=source.getAttribute('position');let flat=0;
 for(let i=0;i<p.count;i+=3)if(p.getY(i)===0&&p.getY(i+1)===0&&p.getY(i+2)===0)flat++;
 assert.ok(flat>0,'real source includes flat zero-height triangles; bounding-box height alone misses these');
 try{for(const f of FIXTURES){const owner=createCourtyardHouseProposal(f.id.startsWith('house3')?'warm-timber':'stone-pale');const floor=drawnPart(owner.group,'ground-floor:south');const packed=new PackSoup();packed.add(source,[f.at[0],f.y,f.at[1]],f.yaw,f.scale);const drawn=packed.geometry();try{const vertices=drawn.getAttribute('position');for(let i=0;i<vertices.count;i++)assert.ok(vertices.getY(i)-floor.max.y>.0099,'every drawn rug vertex clears the actual floor');assert.equal(drawn.getAttribute('position').count,source.getAttribute('position').count,'no geometry duplication or extra triangles');}finally{drawn.dispose();owner.dispose();}}}finally{source.dispose();}
});
