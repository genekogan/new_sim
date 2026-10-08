/** Original static leaf/stem ornaments entirely inside existing pavilion post colliders. */
import * as THREE from 'three';
import {ThreeResources} from '../../../../lib/three-resources.ts';
export type ContentView={readonly group:THREE.Group;dispose():void};
type Part={post:number;kind:'leaf'|'stem';centre:number[];scale:number[];rotation:number[];colour:string};
const palette=['#637751','#87966a','#a0ad7d','#657052'];
const centres=[[-2.75,-1.75],[2.75,-1.75],[-2.75,1.75],[2.75,1.75]];
const matrix=(p:Part)=>new THREE.Matrix4().compose(new THREE.Vector3(...p.centre),new THREE.Quaternion(...p.rotation),new THREE.Vector3(...p.scale));
const vertices=(kind:Part['kind'])=>kind==='leaf'?[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]:Array.from({length:10},(_,i)=>[Math.sin((i%5)*2*Math.PI/5),i<5?-.5:.5,Math.cos((i%5)*2*Math.PI/5)]);
export function inspectPavilionVines(){
 const parts:Part[]=[];centres.forEach(([x,z],post)=>{const nodes:THREE.Vector3[]=[];for(let i=0;i<16;i++){const angle=i*.87+post*.61,c=Math.cos(angle),s=Math.sin(angle),factor=Math.max(Math.abs(c),Math.abs(s)),y=.30+i*.13;
  nodes.push(new THREE.Vector3(x+.111*c/factor,y,z+.111*s/factor));const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-angle).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),i%2?.28:-.28));
  parts.push({post,kind:'leaf',centre:[x+.115*c/factor,y,z+.115*s/factor],scale:[.045,.082,.012],rotation:q.toArray(),colour:palette[(i+post)%3]});
 }
 for(let i=0;i<15;i++){const a=nodes[i],b=nodes[i+1],delta=b.clone().sub(a),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());parts.push({post,kind:'stem',centre:a.clone().add(b).multiplyScalar(.5).toArray(),scale:[.007,delta.length(),.007],rotation:q.toArray(),colour:palette[3]});}});
 const perPost=centres.map(([x,z],post)=>{const bounds=new THREE.Box3();for(const p of parts.filter(p=>p.post===post)){const m=matrix(p);for(const v of vertices(p.kind))bounds.expandByPoint(new THREE.Vector3(...v).applyMatrix4(m));}return{post,centre:[x,z],collider:{min:[x-.19,0,z-.19],max:[x+.19,2.6,z+.19]},bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},leaves:16,stems:15};});
 return{status:'uninstalled-appearance-overlay',origin:'local base centre; identity; metres/Y-up',palette:[...palette],parts,perPost,counts:{leaves:64,stems:60,total:124},limits:{minY:.16,maxY:2.4},physicalChange:false};
}
export function createPavilionVines():ContentView{
 const spec=inspectPavilionVines(),group=new THREE.Group();group.name='pavilion-vines:uninstalled-overlay';group.userData.inspection=spec;const resources=new ThreeResources(),leaf=new THREE.OctahedronGeometry(1,0),stem=new THREE.CylinderGeometry(1,1,1,5,1,false),meshes:THREE.InstancedMesh[]=[];
 for(const colour of spec.palette){const parts=spec.parts.filter(p=>p.colour===colour),geo=parts[0].kind==='leaf'?leaf:stem,material=new THREE.MeshStandardMaterial({color:colour,roughness:1}),mesh=new THREE.InstancedMesh(geo,material,parts.length);mesh.name='vines:'+colour;mesh.userData.posts=parts.map(p=>p.post);mesh.userData.kinds=parts.map(p=>p.kind);parts.forEach((p,i)=>mesh.setMatrixAt(i,matrix(p)));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);meshes.push(mesh);}
 resources.object(group);let closed=false;return{group,dispose(){if(closed)return;closed=true;group.removeFromParent();meshes.forEach(m=>m.dispose());resources.dispose();group.clear();}};
}
