/** Original open garden pergola; no installed support, floor or navigation grant. */
import * as THREE from 'three';
import {ThreeResources} from '../../../../lib/three-resources.ts';
import {COMMONS_PALETTE} from './commons-prefabs.ts';
export type ContentView={readonly group:THREE.Group;dispose():void};
type V3=readonly[number,number,number];
type Part={name:string;material:'timber'|'bark';centre:V3;size:V3};
export function inspectGardenPergola(){
 const parts:Part[]=[],contacts:{name:string;centre:V3;size:readonly[number,number];normal:V3;status:'uninstalled-proposal'}[]=[];
 for(const x of [-1.07,1.07])for(const z of [-1.07,1.07]){parts.push({name:'corner-post:'+x+':'+z,material:'timber',centre:[x,1.15,z],size:[.18,2.3,.18]});contacts.push({name:'post-base:'+x+':'+z,centre:[x,0,z],size:[.18,.18],normal:[0,1,0],status:'uninstalled-proposal'});}
 for(const z of [-1.07,1.07])parts.push({name:'long-eave:'+z,material:'bark',centre:[0,2.22,z],size:[2.4,.16,.14]});
 for(const x of [-1.07,1.07])parts.push({name:'cross-eave:'+x,material:'timber',centre:[x,2.22,0],size:[.14,.16,2.4]});
 for(const x of [-1.03,-.72,-.35,0,.35,.72,1.03])parts.push({name:'open-roof-rafter:'+x,material:'timber',centre:[x,2.35,0],size:[.07,.10,2.4]});
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of parts)for(let a=0;a<3;a++){min[a]=Math.min(min[a],p.centre[a]-p.size[a]/2);max[a]=Math.max(max[a],p.centre[a]+p.size[a]/2);}
 return {status:'uninstalled-proposal',origin:'local base centre',units:'metres',parts,bounds:{min,max},eavesUnderside:2.14,postBaseContacts:contacts,openAisle:{name:'central1.4m aisle',min:[-.7,0,-1.2],max:[.7,2.1,1.2],status:'uninstalled-proposal'},roof:'sparse rafters, visible sky; no floor or vines'};
}
export function createGardenPergola():ContentView{
 const spec=inspectGardenPergola(),group=new THREE.Group();group.name='garden-pergola:uninstalled';group.userData.inspection=spec;
 const resources=new ThreeResources(),geo=new THREE.BoxGeometry(1,1,1),meshes:THREE.InstancedMesh[]=[],matrix=new THREE.Matrix4(),v=new THREE.Vector3(),s=new THREE.Vector3(),q=new THREE.Quaternion();
 for(const material of ['timber','bark'] as const){const parts=spec.parts.filter(p=>p.material===material),mat=new THREE.MeshStandardMaterial({color:COMMONS_PALETTE[material],roughness:1}),m=new THREE.InstancedMesh(geo,mat,parts.length);m.name=material;m.userData.partNames=parts.map(p=>p.name);parts.forEach((p,i)=>{matrix.compose(v.fromArray(p.centre),q,s.fromArray(p.size));m.setMatrixAt(i,matrix);});m.instanceMatrix.needsUpdate=true;m.computeBoundingBox();m.computeBoundingSphere();m.castShadow=m.receiveShadow=true;meshes.push(m);group.add(m);}
 resources.object(group);let closed=false;return{group,dispose(){if(closed)return;closed=true;group.removeFromParent();meshes.forEach(m=>m.dispose());resources.dispose();group.clear();}};
}
