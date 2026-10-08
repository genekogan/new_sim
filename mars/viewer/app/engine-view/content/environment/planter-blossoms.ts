// Original single-batch ornamental flower, never produce or native inventory.
import * as THREE from 'three';
import { ThreeResources } from '../../../../lib/three-resources.ts';
import type { ContentView } from './commons.ts';
export type PlanterBlossom={id:string;p:[number,number,number];width:number;height:number;yaw:number};
export function createPlanterBlossoms(input:readonly PlanterBlossom[]):ContentView{
  const ids=new Set<string>();
  if(!Array.isArray(input)||input.length>64)throw Error('Invalid planter blossom budget');
  for(const b of input){if(!b||typeof b.id!=='string'||!b.id||ids.has(b.id)||!Array.isArray(b.p)||b.p.length!==3||Array.from(b.p).some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>10000)||!Number.isFinite(b.width)||b.width<=0||b.width>.35||!Number.isFinite(b.height)||b.height<=0||b.height>.35||!Number.isFinite(b.yaw))throw Error('Invalid planter blossom');ids.add(b.id);}
  // No geometry/material allocation before full dense input validation.
  const group=new THREE.Group();group.name='Original cream lavender planter blossoms';const resources=new ThreeResources();let mesh:THREE.InstancedMesh|undefined;
  if(input.length){const positions:number[]=[],colors:number[]=[];
    const triangle=(a:number[],b:number[],c:number[],color:string)=>{positions.push(...a,...b,...c);const rgb=new THREE.Color(color);for(let i=0;i<3;i++)colors.push(rgb.r,rgb.g,rgb.b);};
    const octa=(x:number,y:number,z:number,sx:number,sy:number,sz:number,color:string)=>{const v=[[x+sx,y,z],[x-sx,y,z],[x,y+sy,z],[x,y-sy,z],[x,y,z+sz],[x,y,z-sz]];for(const [a,b,c]of [[2,0,4],[2,4,1],[2,1,5],[2,5,0],[3,4,0],[3,1,4],[3,5,1],[3,0,5]])triangle(v[a],v[b],v[c],color);};
    octa(0,.39,0,.035,.39,.035,'#52734a');
    octa(.12,.34,0,.13,.07,.075,'#78945c');octa(-.12,.48,0,.13,.07,.075,'#52734a');
    for(let i=0;i<5;i++){const a=i*Math.PI*2/5;octa(Math.cos(a)*.24,.86,Math.sin(a)*.24,.17,.07,.17,i%2?'#b7abc2':'#e1d5b6');}
    octa(0,.89,0,.13,.09,.13,'#b7a06e');
    const geo=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(positions,3)).setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
    mesh=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),input.length);const m=new THREE.Matrix4(),q=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0);
    input.forEach((b,i)=>{q.setFromAxisAngle(axis,-b.yaw);m.compose(new THREE.Vector3(...b.p),q,new THREE.Vector3(b.width,b.height,b.width));mesh!.setMatrixAt(i,m);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;mesh.name='instanced ornamental blossoms';group.add(mesh);resources.object(mesh);
  }
  let closed=false;return{group,dispose(){if(closed)return;closed=true;group.removeFromParent();mesh?.dispose();resources.dispose();group.clear();}};
}
